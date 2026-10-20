import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(tmpdir(), 'smartpos-device-binding-'));
process.env.DATA_DIR = dataDir;

const { dbService, initSQLite } = await import('../server/database.ts');
const sqlite = initSQLite();

before(() => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS device_bindings (
      device_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'bound')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      username TEXT,
      password TEXT,
      role TEXT,
      businessName TEXT,
      ownerName TEXT,
      mobile TEXT,
      email TEXT,
      profileImage TEXT,
      createdAt TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tenant_id TEXT,
      token TEXT UNIQUE NOT NULL,
      device_info TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL,
      last_active_at TEXT NOT NULL,
      device_id TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      tenant_id TEXT,
      PRIMARY KEY (key, tenant_id)
    );
  `);
});

beforeEach(() => {
  sqlite.exec('DELETE FROM sessions; DELETE FROM users; DELETE FROM device_bindings; DELETE FROM settings;');
});

after(() => {
  sqlite.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const registerDevice = (deviceId: string, tenantId: string, accountId: string) => {
  assert.equal(dbService.reserveDeviceRegistration(deviceId, tenantId, accountId), true);
  dbService.commitAdminRegistration(
    deviceId,
    {
      id: accountId,
      tenant_id: tenantId,
      username: `${accountId}@example.test`,
      password: 'hashed-password',
      role: 'admin',
      businessName: `Store ${tenantId}`,
      ownerName: 'Store Owner',
      mobile: '09123456789',
      createdAt: new Date().toISOString(),
    },
    {
      id: `session-${deviceId}`,
      user_id: accountId,
      token: `token-${deviceId}`,
      tenant_id: tenantId,
      device_id: deviceId,
      device_info: 'test browser',
      ip_address: '127.0.0.1',
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
    },
  );
};

test('different devices can register distinct store accounts', () => {
  registerDevice('device-0001', 'tenant-0001', 'account-0001');
  registerDevice('device-0002', 'tenant-0002', 'account-0002');

  assert.equal(dbService.getDeviceBinding('device-0001')?.tenant_id, 'tenant-0001');
  assert.equal(dbService.getDeviceBinding('device-0002')?.tenant_id, 'tenant-0002');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM users').get().count, 2);
});

test('a device reservation prevents duplicate registration for that device only', () => {
  assert.equal(dbService.reserveDeviceRegistration('device-0001', 'tenant-0001', 'account-0001'), true);
  assert.equal(dbService.reserveDeviceRegistration('device-0001', 'tenant-0002', 'account-0002'), false);
  assert.equal(dbService.reserveDeviceRegistration('device-0002', 'tenant-0002', 'account-0002'), true);
});

test('an authenticated login can recover its matching pending reservation', () => {
  assert.equal(dbService.reserveDeviceRegistration('device-0001', 'tenant-0001', 'account-0001'), true);

  dbService.bindDeviceToTenant('device-0001', 'tenant-0001', 'account-0001');

  assert.equal(dbService.getDeviceBinding('device-0001')?.status, 'bound');
  assert.throws(
    () => dbService.bindDeviceToTenant('device-0001', 'tenant-0002', 'account-0002'),
    /already linked to a different store/,
  );
});

test('reset removes only the requested device binding and sessions', () => {
  registerDevice('device-0001', 'tenant-0001', 'account-0001');
  registerDevice('device-0002', 'tenant-0002', 'account-0002');

  dbService.clearDeviceBinding('device-0001', 'tenant-0001', 'account-0001');

  assert.equal(dbService.getDeviceBinding('device-0001'), undefined);
  assert.equal(dbService.getDeviceBinding('device-0002')?.tenant_id, 'tenant-0002');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM sessions WHERE device_id = ?').get('device-0001').count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM sessions WHERE device_id = ?').get('device-0002').count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM users').get().count, 2);
});

test('session-based reset authorization is limited to the matching device and tenant', () => {
  registerDevice('device-0001', 'tenant-0001', 'account-0001');
  registerDevice('device-0002', 'tenant-0002', 'account-0002');

  assert.equal(
    dbService.getDeviceSessionByToken('token-device-0001', 'device-0001', 'tenant-0001')?.user_id,
    'account-0001',
  );
  assert.equal(dbService.getDeviceSessionByToken('token-device-0001', 'device-0002', 'tenant-0001'), undefined);
  assert.equal(dbService.getDeviceSessionByToken('token-device-0001', 'device-0001', 'tenant-0002'), undefined);
});

test('legacy reset removes only the requesting session and preserves shared tenant data', () => {
  registerDevice('device-0001', 'tenant-0001', 'account-0001');
  registerDevice('device-0002', 'tenant-0002', 'account-0002');
  sqlite.prepare('DELETE FROM device_bindings').run();
  sqlite.prepare('INSERT INTO settings (key, value, tenant_id) VALUES (?, ?, NULL)')
    .run('device_bound_tenant_id', 'tenant-0001');

  dbService.clearLegacyDeviceBinding('tenant-0001', 'account-0001', 'token-device-0001');

  assert.equal(dbService.getLegacyBoundTenantId(), null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM sessions WHERE token = ?').get('token-device-0001').count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM sessions WHERE token = ?').get('token-device-0002').count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM users').get().count, 2);
});

test('failed registration can release its pending reservation for retry', () => {
  assert.equal(dbService.reserveDeviceRegistration('device-0001', 'tenant-0001', 'account-0001'), true);

  dbService.releaseDeviceRegistration('device-0001', 'tenant-0001', 'account-0001');

  assert.equal(dbService.getDeviceBinding('device-0001'), undefined);
  assert.equal(dbService.reserveDeviceRegistration('device-0001', 'tenant-0002', 'account-0002'), true);
});
