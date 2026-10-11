import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs"; // Import bcryptjs
import { getSupabase } from "./supabase";
import { 
  Staff, 
  Sale, 
  SaleItem,
  User
} from '@shared/schema';

import { runMigrations } from "./migrations/migrationRunner";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SQLite only if needed (not on Render in some cases, but for now we keep it)
let db: any;
export const initSQLite = () => {
  if (db) return db;
  const dataDir = process.env.DATA_DIR 
    ? path.resolve(process.env.DATA_DIR) 
    : path.resolve(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, 'smartpos.db');
  db = new Database(dbPath);
  return db;
};

    // Helper to determine if we should use Cloud (Supabase)
export const useCloud = () => {
  const url = process.env.SUPABASE_URL || "https://yvtdagbiuxmvlesaikts.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_9Wwym8pGkJCa_C1xnDtVBQ_F-QFylwk";
  return !!url && !!key && url !== "" && key !== "";
};

// ================================================================
// CANONICAL SCHEMA DEFINITIONS  (single source of truth)
// SQLite column names match actual usage in INSERT/UPDATE statements.
// Note: Staff deliberately does NOT include deprecated "username".
// ================================================================
type CanonicalColumn = {
  name: string;
  def: string; // e.g. "TEXT NOT NULL DEFAULT 'cashier'"
};

const CANONICAL_SCHEMAS: Record<string, CanonicalColumn[]> = {
  staff: [
    { name: 'id',                def: 'TEXT PRIMARY KEY' },
    { name: 'tenant_id',         def: 'TEXT' },
    { name: 'user_id',           def: 'TEXT' },
    { name: 'firstName',         def: 'TEXT' },
    { name: 'middleName',        def: 'TEXT' },
    { name: 'lastName',          def: 'TEXT' },
    { name: 'name',              def: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'staffId',           def: 'TEXT UNIQUE' },
    { name: 'passkey',           def: 'TEXT' },
    { name: 'role',              def: 'TEXT DEFAULT \'cashier\'' },
    { name: 'branch',            def: 'TEXT' },
    { name: 'department',        def: 'TEXT' },
    { name: 'employmentStatus',  def: 'TEXT DEFAULT \'active\'' },
    { name: 'email',             def: 'TEXT' },
    { name: 'phone',             def: 'TEXT' },
    { name: 'address',           def: 'TEXT' },
    { name: 'birthdate',         def: 'TEXT' },
    { name: 'gender',            def: 'TEXT' },
    { name: 'dateHired',         def: 'TEXT' },
    { name: 'assignedShift',     def: 'TEXT' },
    { name: 'lastLogin',         def: 'TEXT' },
    { name: 'passwordLastChanged', def: 'TEXT' },
    { name: 'permissions',       def: 'TEXT' },
    { name: 'createdBy',         def: 'TEXT' },
    { name: 'createdAt',         def: 'TEXT' },
    { name: 'updatedAt',         def: 'TEXT' },
  ],
  products: [
    { name: 'id',           def: 'TEXT PRIMARY KEY' },
    { name: 'tenant_id',    def: 'TEXT' },
    { name: 'name',         def: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'price',        def: 'REAL NOT NULL DEFAULT 0' },
    { name: 'cost',         def: 'REAL DEFAULT 0' },
    { name: 'category',     def: 'TEXT' },
    { name: 'description',  def: 'TEXT' },
    { name: 'image',        def: 'TEXT' },
    { name: 'quantity',     def: 'INTEGER DEFAULT 0' },
    { name: 'barcode',      def: 'TEXT UNIQUE' },
    { name: 'box_barcode',  def: 'TEXT' },
    { name: 'units_per_box',def: 'INTEGER DEFAULT 1' },
    { name: 'box_cost',     def: 'REAL DEFAULT 0' },
    { name: 'createdAt',    def: 'TEXT' },
    { name: 'updatedAt',    def: 'TEXT' },
  ],
  variants: [
    { name: 'id',           def: 'TEXT PRIMARY KEY' },
    { name: 'tenant_id',    def: 'TEXT' },
    { name: 'product_id',   def: 'TEXT NOT NULL' },
    { name: 'name',         def: 'TEXT NOT NULL DEFAULT \'\'' },
    { name: 'barcode',      def: 'TEXT' },
    { name: 'box_barcode',  def: 'TEXT' },
    { name: 'units_per_box',def: 'INTEGER DEFAULT 1' },
    { name: 'box_cost',     def: 'REAL DEFAULT 0' },
    { name: 'price',        def: 'REAL NOT NULL DEFAULT 0' },
    { name: 'cost',         def: 'REAL NOT NULL DEFAULT 0' },
    { name: 'image',        def: 'TEXT' },
    { name: 'quantity',     def: 'INTEGER DEFAULT 0' },
    { name: 'created_at',   def: 'TEXT' },
    { name: 'updated_at',   def: 'TEXT' },
  ],
  sales: [
    { name: 'id',            def: 'TEXT PRIMARY KEY' },
    { name: 'tenant_id',     def: 'TEXT' },
    { name: 'total',         def: 'REAL NOT NULL DEFAULT 0' },
    { name: 'paymentType',   def: 'TEXT NOT NULL DEFAULT \'cash\'' },
    { name: 'paymentAmount', def: 'REAL NOT NULL DEFAULT 0' },
    { name: 'staffId',       def: 'TEXT' },
    { name: 'remitted',      def: 'INTEGER DEFAULT 0' },
    { name: 'createdAt',     def: 'TEXT' },
  ],
  sale_items: [
    { name: 'id',             def: 'TEXT PRIMARY KEY' },
    { name: 'tenant_id',      def: 'TEXT' },
    { name: 'saleId',         def: 'TEXT NOT NULL' },
    { name: 'productId',      def: 'TEXT NOT NULL' },
    { name: 'quantity',       def: 'INTEGER NOT NULL DEFAULT 1' },
    { name: 'price',          def: 'REAL NOT NULL DEFAULT 0' },
    { name: 'unit',           def: 'TEXT DEFAULT \'pieces\'' },
    { name: 'productName',    def: 'TEXT' },
    { name: 'isNonInventory', def: 'INTEGER DEFAULT 0' },
  ],
  bulk_inventory_transactions: [
    { name: 'id',                def: 'TEXT PRIMARY KEY' },
    { name: 'tenant_id',         def: 'TEXT' },
    { name: 'reference_number',  def: 'TEXT NOT NULL UNIQUE' },
    { name: 'created_by',        def: 'TEXT NOT NULL' },
    { name: 'supplier_company',  def: 'TEXT' },
    { name: 'total_items',       def: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'total_units',       def: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'total_cost',        def: 'REAL NOT NULL DEFAULT 0' },
    { name: 'notes',             def: 'TEXT' },
    { name: 'status',            def: 'TEXT NOT NULL DEFAULT \'completed\'' },
    { name: 'idempotency_key',   def: 'TEXT UNIQUE' },
    { name: 'createdAt',         def: 'TEXT' },
    { name: 'updatedAt',         def: 'TEXT' },
  ],
  bulk_inventory_items: [
    { name: 'id',                         def: 'TEXT PRIMARY KEY' },
    { name: 'tenant_id',                  def: 'TEXT' },
    { name: 'bulk_inventory_id',          def: 'TEXT NOT NULL' },
    { name: 'product_id',                 def: 'TEXT' },
    { name: 'variant_id',                 def: 'TEXT' },
    { name: 'barcode',                    def: 'TEXT' },
    { name: 'box_barcode',                def: 'TEXT' },
    { name: 'piece_barcode',              def: 'TEXT' },
    { name: 'box_count',                  def: 'INTEGER DEFAULT 0' },
    { name: 'units_per_box',              def: 'INTEGER DEFAULT 1' },
    { name: 'cost_per_box',               def: 'REAL DEFAULT 0' },
    { name: 'product_name_snapshot',      def: 'TEXT NOT NULL' },
    { name: 'description_snapshot',       def: 'TEXT' },
    { name: 'quantity',                   def: 'INTEGER NOT NULL' },
    { name: 'cost_snapshot',              def: 'REAL NOT NULL DEFAULT 0' },
    { name: 'selling_price_snapshot',     def: 'REAL DEFAULT 0' },
    { name: 'supplier_company_override',  def: 'TEXT' },
    { name: 'notes',                      def: 'TEXT' },
    { name: 'price_cost_update_confirmed',def: 'INTEGER NOT NULL DEFAULT 0' },
    { name: 'createdAt',                  def: 'TEXT' },
  ],
};

const STAFF_COLUMN_NAMES = CANONICAL_SCHEMAS.staff.map(c => c.name);
const PRODUCTS_COLUMN_NAMES = CANONICAL_SCHEMAS.products.map(c => c.name);
const VARIANTS_COLUMN_NAMES = CANONICAL_SCHEMAS.variants.map(c => c.name);
const SALES_COLUMN_NAMES = CANONICAL_SCHEMAS.sales.map(c => c.name);
const SALE_ITEMS_COLUMN_NAMES = CANONICAL_SCHEMAS.sale_items.map(c => c.name);
const BULK_INV_TX_COLUMN_NAMES = CANONICAL_SCHEMAS.bulk_inventory_transactions.map(c => c.name);
const BULK_INV_ITEMS_COLUMN_NAMES = CANONICAL_SCHEMAS.bulk_inventory_items.map(c => c.name);

// Database service
export const dbService = {
  // ================================================================
  // TASK 1+2+9: initSchema — diagnostics, deterministic migrations,
  // schema verification. All in one.
  // ================================================================
  initSchema: async () => {
    const sqlite = initSQLite();

    // ---------------- TASK 1: STARTUP DIAGNOSTICS ----------------
    const dataDir = process.env.DATA_DIR
      ? path.resolve(process.env.DATA_DIR)
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data');
    const dbPath = path.join(dataDir, 'smartpos.db');
    console.log('============================================');
    console.log('[DB DIAG] SQLite database path:', dbPath);
    console.log('[DB DIAG] DATA_DIR env var:', process.env.DATA_DIR || '(not set)');
    console.log('[DB DIAG] Railway persistent volume check: DATA_DIR is', process.env.DATA_DIR ? 'custom (likely mounted volume)' : 'default (ephemeral or default volume mount)');
    try {
      const allFiles = fs.readdirSync(dataDir);
      const dbFiles = allFiles.filter((f: string) => f.endsWith('.db') || f.endsWith('.sqlite') || f.endsWith('.sqlite3'));
      console.log('[DB DIAG] All DB files in data dir:', dbFiles.length > 0 ? dbFiles : '(none)');
      if (dbFiles.length > 1) {
        console.warn('[DB DIAG] WARNING: More than one DB file detected! The app opens:', dbPath);
      }
    } catch (e: any) {
      console.warn('[DB DIAG] Could not list data dir contents:', e?.message);
    }
    const getCols = (table: string) =>
      sqlite.prepare(`PRAGMA table_info(${table})`).all() as { cid: number; name: string; type: string; notnull: number; dflt_value: any; pk: number }[];

    const criticalTables = ['staff', 'products', 'variants', 'sales', 'sale_items', 'bulk_inventory_transactions', 'bulk_inventory_items'];
    const preMigration: Record<string, string[]> = {};
    for (const t of criticalTables) {
      const cols = getCols(t);
      preMigration[t] = cols.map(c => `${c.name}(${c.type})`);
      console.log(`[DB DIAG] PRE-MIGRATION PRAGMA table_info(${t}): columns = [${cols.map(c => c.name + ':' + c.type).join(', ')}]`);
    }

    // ---------------- TASK 2: DETERMINISTIC MIGRATIONS ----------------
    const migrateTable = (tableName: string, canonical: CanonicalColumn[]) => {
      const existingCols = getCols(tableName);
      const existingNames = existingCols.map(c => c.name);
      const canonicalNames = canonical.map(c => c.name);
      const missing = canonical.filter(c => !existingNames.includes(c.name));

      // If table doesn't exist at all, create it fresh
      if (existingCols.length === 0) {
        const colDefs = canonical.map(c => `  ${c.name} ${c.def}`).join(',\n');
        sqlite.exec(`CREATE TABLE ${tableName} (\n${colDefs}\n)`);
        console.log(`[MIGRATION] Created new table ${tableName}`);
        return;
      }

      // Special: rebuild staff if id column is INTEGER (old schema)
      if (tableName === 'staff') {
        const idCol = existingCols.find(c => c.name === 'id');
        if (idCol && idCol.type === 'INTEGER') {
          console.log(`[MIGRATION] Rebuilding ${tableName} table: id was INTEGER, need TEXT`);
          rebuildTablePreservingData(tableName, canonical, existingNames);
          return;
        }
      }

      // Add missing columns individually (SQLite limitation: only one ADD COLUMN per ALTER)
      if (missing.length > 0) {
        const tx = sqlite.transaction(() => {
          for (const col of missing) {
            try {
              sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.def}`);
              console.log(`[MIGRATION] ${tableName}: added column ${col.name}`);
            } catch (alterErr: any) {
              console.warn(`[MIGRATION] ALTER TABLE ${tableName} ADD COLUMN ${col.name} failed: ${alterErr?.message}. Attempting full rebuild...`);
              rebuildTablePreservingData(tableName, canonical, existingNames);
              return;
            }
          }
        });
        tx();
      }

      // Drop deprecated columns: remove "username" from staff if present
      if (tableName === 'staff' && existingNames.includes('username')) {
        console.log('[MIGRATION] staff: deprecated "username" column present. Preserving via table rebuild (column dropped).');
        rebuildTablePreservingData(tableName, canonical, existingNames.filter(n => n !== 'username'));
      }
    };

    const rebuildTablePreservingData = (tableName: string, canonical: CanonicalColumn[], existingNames: string[]) => {
      sqlite.transaction(() => {
        sqlite.exec('PRAGMA foreign_keys = OFF');
        const overlapCols = canonical
          .map(c => c.name)
          .filter(n => existingNames.includes(n));
        sqlite.exec(`ALTER TABLE ${tableName} RENAME TO ${tableName}_old`);
        const colDefs = canonical.map(c => `  ${c.name} ${c.def}`).join(',\n');
        sqlite.exec(`CREATE TABLE ${tableName} (\n${colDefs}\n)`);
        if (overlapCols.length > 0) {
          const sel = overlapCols.join(', ');
          try {
            sqlite.exec(`INSERT INTO ${tableName} (${sel}) SELECT ${sel} FROM ${tableName}_old`);
            console.log(`[MIGRATION] ${tableName}: preserved ${overlapCols.length} columns during rebuild`);
          } catch (copyErr: any) {
            console.error(`[MIGRATION] ${tableName}: could not copy rows during rebuild: ${copyErr?.message}. Old table kept as ${tableName}_old_backup.`);
            sqlite.exec(`ALTER TABLE ${tableName}_old RENAME TO ${tableName}_old_backup`);
            sqlite.exec('PRAGMA foreign_keys = ON');
            return;
          }
        }
        sqlite.exec(`DROP TABLE IF EXISTS ${tableName}_old`);
        sqlite.exec('PRAGMA foreign_keys = ON');
      })();
      console.log(`[MIGRATION] Rebuilt table ${tableName} successfully`);
    };

    // Run migrations for each critical table inside a transaction
    const migrateCritical = sqlite.transaction(() => {
      for (const [t, cols] of Object.entries(CANONICAL_SCHEMAS)) {
        migrateTable(t, cols);
      }
    });
    try {
      migrateCritical();
    } catch (txErr) {
      console.error('[MIGRATION] Critical table migration failed, retrying individually...', txErr);
      for (const [t, cols] of Object.entries(CANONICAL_SCHEMAS)) {
        try { migrateTable(t, cols); } catch (e) {
          console.error(`[MIGRATION] Could not migrate ${t}:`, e);
          throw new Error(`DATABASE_SCHEMA_MIGRATION_FAILED: table=${t} err=${String(e)}`);
        }
      }
    }

    // Now create all other non-critical tables IF NOT EXISTS (these are lower risk)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        store_name TEXT NOT NULL,
        subdomain TEXT UNIQUE NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        username TEXT UNIQUE,
        email TEXT,
        mobile TEXT,
        password TEXT,
        role TEXT,
        businessName TEXT,
        ownerName TEXT,
        location TEXT,
        profileImage TEXT,
        securityQuestion1 TEXT,
        securityAnswer1 TEXT,
        securityQuestion2 TEXT,
        securityAnswer2 TEXT,
        securityQuestion3 TEXT,
        securityAnswer3 TEXT,
        failedAttemptCount INTEGER DEFAULT 0,
        lockoutUntil TEXT,
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
        last_active_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        name TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        address TEXT,
        credit_rating TEXT NOT NULL DEFAULT 'good',
        photo_url TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS credits (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        customer_id TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        due_date TEXT,
        remarks TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        customer_id TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        payment_method TEXT NOT NULL DEFAULT 'cash',
        remarks TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        customer_id TEXT NOT NULL,
        message_type TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        tenant_id TEXT,
        PRIMARY KEY (key, tenant_id)
      );
      CREATE TABLE IF NOT EXISTS non_inventory_products (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        name TEXT NOT NULL DEFAULT '',
        price REAL NOT NULL DEFAULT 0,
        category TEXT,
        description TEXT,
        image TEXT,
        barcode TEXT UNIQUE,
        barcode_data TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS remittances (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        staff_id TEXT,
        staff_name TEXT,
        amount REAL DEFAULT 0,
        transaction_count INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT,
        confirmed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        user_id TEXT,
        type TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        data TEXT,
        is_read INTEGER DEFAULT 0,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        admin_id TEXT,
        admin_name TEXT,
        action TEXT NOT NULL DEFAULT '',
        staff_id TEXT,
        staff_name TEXT,
        changed_fields TEXT,
        old_values TEXT,
        new_values TEXT,
        ip_address TEXT,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS attendance (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        staff_id TEXT,
        date TEXT,
        clock_in TEXT,
        clock_out TEXT,
        hours_worked REAL,
        is_late INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS login_history (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        staff_id TEXT,
        device_info TEXT,
        ip_address TEXT,
        login_time TEXT,
        logout_time TEXT,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS expenses (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        description TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL DEFAULT 0,
        category TEXT NOT NULL DEFAULT '',
        date TEXT
      );
      CREATE TABLE IF NOT EXISTS purchases (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        productName TEXT NOT NULL DEFAULT '',
        quantity INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        supplier TEXT,
        date TEXT,
        description TEXT,
        details TEXT,
        expirationDate TEXT
      );
      CREATE TABLE IF NOT EXISTS creditors (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        name TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL DEFAULT 0,
        description TEXT,
        dueDate TEXT,
        reminderDate TEXT,
        isPaid INTEGER DEFAULT 0
      );
    `);

    // Ensure tenant_id on all tables that should have it
    const tablesWantTenant = [
      'users', 'customers', 'credits', 'payments', 'reminders',
      'non_inventory_products', 'remittances', 'notifications',
      'audit_logs', 'attendance', 'login_history', 'expenses',
      'purchases', 'creditors', 'settings', 'products', 'variants',
      'staff', 'sales', 'sale_items'
    ];
    sqlite.transaction(() => {
      for (const t of tablesWantTenant) {
        const ex = getCols(t).map(c => c.name);
        if (!ex.includes('tenant_id')) {
          try { sqlite.exec(`ALTER TABLE ${t} ADD COLUMN tenant_id TEXT`); console.log(`[MIGRATION] Added tenant_id to ${t}`); }
          catch (e) { console.warn(`[MIGRATION] Could not add tenant_id to ${t}:`, String(e).slice(0, 200)); }
        }
        if (t === 'users') {
          for (const c of ['email','mobile','location','profileImage','securityQuestion1','securityAnswer1','securityQuestion2','securityAnswer2','securityQuestion3','securityAnswer3','failedAttemptCount','lockoutUntil']) {
            if (!ex.includes(c)) {
              try { sqlite.exec(`ALTER TABLE users ADD COLUMN ${c} TEXT`); } catch {}
            }
          }
        }
      }
    })();

    // Recreate all useful indexes (these are IF NOT EXISTS so safe)
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
      CREATE INDEX IF NOT EXISTS idx_products_tenant ON products(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_variants_product ON variants(product_id);
      CREATE INDEX IF NOT EXISTS idx_variants_tenant ON variants(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_staff_staffId ON staff(staffId);
      CREATE INDEX IF NOT EXISTS idx_staff_tenant ON staff(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_sales_tenant ON sales(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_sales_createdAt ON sales(createdAt);
      CREATE INDEX IF NOT EXISTS idx_sale_items_saleId ON sale_items(saleId);
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
      CREATE INDEX IF NOT EXISTS idx_credits_customer ON credits(customer_id);
      CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
      CREATE INDEX IF NOT EXISTS idx_reminders_customer ON reminders(customer_id);
      CREATE INDEX IF NOT EXISTS idx_remittances_tenant_status ON remittances(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_notifications_tenant_user ON notifications(tenant_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_users_tenant_username ON users(tenant_id, username);
      CREATE INDEX IF NOT EXISTS idx_bulk_inv_tx_tenant ON bulk_inventory_transactions(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_bulk_inv_tx_ref ON bulk_inventory_transactions(reference_number);
      CREATE INDEX IF NOT EXISTS idx_bulk_inv_tx_idem ON bulk_inventory_transactions(idempotency_key);
      CREATE INDEX IF NOT EXISTS idx_bulk_inv_items_parent ON bulk_inventory_items(bulk_inventory_id);
      CREATE INDEX IF NOT EXISTS idx_bulk_inv_items_tenant ON bulk_inventory_items(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_bulk_inv_items_product ON bulk_inventory_items(product_id);
    `);

    // Run modular SQL migrations (e.g. backfills, composite constraints)
    try {
      runMigrations(sqlite);
    } catch (migErr: any) {
      console.warn('[MIGRATIONS] Migration step encountered warning/error:', migErr?.message);
    }

    // ---------------- TASK 9: POST-MIGRATION VERIFICATION ----------------
    console.log('--------------------------------------------------------');
    const verifyRequired = (tableName: string, required: string[]) => {
      const present = new Set(getCols(tableName).map(c => c.name));
      const missing = required.filter(r => !present.has(r));
      if (missing.length === 0) {
        console.log(`[DB SCHEMA] ${tableName}: OK (${present.size} columns)`);
        return true;
      }
      console.error(`[DB SCHEMA] ${tableName}: FAIL — missing columns: [${missing.join(', ')}]`);
      return false;
    };
    const schemaResults: Record<string, boolean> = {};
    schemaResults.staff = verifyRequired('staff', STAFF_COLUMN_NAMES);
    schemaResults.products = verifyRequired('products', PRODUCTS_COLUMN_NAMES);
    schemaResults.variants = verifyRequired('variants', VARIANTS_COLUMN_NAMES);
    schemaResults.sales = verifyRequired('sales', SALES_COLUMN_NAMES);
    schemaResults.sale_items = verifyRequired('sale_items', SALE_ITEMS_COLUMN_NAMES);
    schemaResults.bulk_inventory_transactions = verifyRequired('bulk_inventory_transactions', BULK_INV_TX_COLUMN_NAMES);
    schemaResults.bulk_inventory_items = verifyRequired('bulk_inventory_items', BULK_INV_ITEMS_COLUMN_NAMES);

    const postMigration: Record<string, string[]> = {};
    for (const t of criticalTables) {
      const cols = getCols(t);
      postMigration[t] = cols.map(c => `${c.name}(${c.type})`);
      console.log(`[DB DIAG] POST-MIGRATION PRAGMA table_info(${t}): columns = [${cols.map(c => c.name + ':' + c.type).join(', ')}]`);
    }
    console.log('============================================');

    const allOk = Object.values(schemaResults).every(Boolean);
    if (!allOk) {
      console.error('DATABASE_SCHEMA_MIGRATION_FAILED: one or more critical tables missing required columns');
      console.error('Pre-migration state:', JSON.stringify(preMigration, null, 2));
      console.error('Post-migration state:', JSON.stringify(postMigration, null, 2));
      throw new Error('DATABASE_SCHEMA_MIGRATION_FAILED: see startup logs above for details');
    }
    (dbService as any)._schemaPreMigration = preMigration;
    (dbService as any)._schemaPostMigration = postMigration;
    (dbService as any)._dbPath = dbPath;

    // Cloud restore (if available)
    if (useCloud()) {
      console.log('[DB INIT] Checking for Cloud Backup in Supabase...');
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data: cloudProducts } = await supabase.from('products').select('*');
          if (cloudProducts && cloudProducts.length > 0) {
            dbService.saveProducts(cloudProducts, '');
            console.log(`Restored ${cloudProducts.length} products from Cloud.`);
          }
          const { data: cloudStaff } = await supabase.from('staff').select('*');
          if (cloudStaff && cloudStaff.length > 0) {
            dbService.saveStaff(cloudStaff, '');
            console.log(`Restored ${cloudStaff.length} staff from Cloud.`);
          }
          const { data: cloudUsers } = await supabase.from('users').select('*');
          if (cloudUsers && cloudUsers.length > 0) {
            for (const user of cloudUsers) dbService.saveAdmin(user);
            console.log(`Restored ${cloudUsers.length} admin accounts from Cloud.`);
          }
        } catch (e) {
          console.warn('Could not restore from Cloud backup (non-fatal):', String(e).slice(0, 300));
        }
      }
    }
  },
  // Tenant methods
  getTenantBySubdomain: (subdomain: string) => {
    return db.prepare('SELECT * FROM tenants WHERE subdomain = ?').get(subdomain);
  },
  getTenantById: (id: string) => {
    return db.prepare('SELECT * FROM tenants WHERE id = ?').get(id);
  },
  createTenant: (input: { id: string; store_name: string; subdomain: string }) => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO tenants (id, store_name, subdomain, created_at)
      VALUES (?, ?, ?, ?)
    `).run(input.id, input.store_name, input.subdomain, now);
    return db.prepare('SELECT * FROM tenants WHERE id = ?').get(input.id);
  },
  listTenants: () => {
    return db.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all();
  },
  getDefaultOrOnlyTenantId: (): string | undefined => {
    try {
      const tenants = db.prepare('SELECT id FROM tenants LIMIT 2').all() as any[];
      if (tenants.length === 1 && tenants[0].id) return tenants[0].id;
      const admin = db.prepare('SELECT tenant_id FROM users WHERE tenant_id IS NOT NULL AND tenant_id != \'\' LIMIT 1').get() as any;
      if (admin && admin.tenant_id) return admin.tenant_id;
      return undefined;
    } catch (e) {
      return undefined;
    }
  },
  // Ledger: Customers
  createCustomer: (tenantId: string, input: { id: string; name: string; phone: string; address?: string | null; credit_rating: 'good'|'bad'; photo_url?: string | null; }) => {
    const now = new Date().toISOString();
    const stmt = db.prepare(`INSERT INTO customers (id, tenant_id, name, phone, address, credit_rating, photo_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`);
    stmt.run(input.id, tenantId, input.name, input.phone, input.address ?? null, input.credit_rating, input.photo_url ?? null, now, now);
    return db.prepare(`SELECT * FROM customers WHERE id = ? AND tenant_id = ?`).get(input.id, tenantId);
  },
  updateCustomer: (tenantId: string, id: string, updates: Partial<{ name: string; phone: string; address: string | null; credit_rating: 'good'|'bad'; photo_url: string | null; }>) => {
    const current = db.prepare(`SELECT * FROM customers WHERE id = ? AND tenant_id = ?`).get(id, tenantId) as any;
    if (!current) return undefined;
    const next = {
      name: updates.name ?? current.name,
      phone: updates.phone ?? current.phone,
      address: updates.address ?? current.address,
      credit_rating: updates.credit_rating ?? current.credit_rating,
      photo_url: updates.photo_url ?? current.photo_url,
      updated_at: new Date().toISOString(),
    };
    db.prepare(`UPDATE customers SET name = ?, phone = ?, address = ?, credit_rating = ?, photo_url = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`).run(
      next.name, next.phone, next.address, next.credit_rating, next.photo_url, next.updated_at, id, tenantId
    );
    return db.prepare(`SELECT * FROM customers WHERE id = ? AND tenant_id = ?`).get(id, tenantId);
  },
  deleteCustomer: (tenantId: string, id: string) => {
    const info = db.prepare(`DELETE FROM customers WHERE id = ? AND tenant_id = ?`).run(id, tenantId);
    return info.changes ?? 0;
  },
  getCustomer: (tenantId: string, id: string) => {
    return db.prepare(`SELECT * FROM customers WHERE id = ? AND tenant_id = ?`).get(id, tenantId);
  },
  listCustomers: (tenantId: string) => {
    return db.prepare(`SELECT * FROM customers WHERE tenant_id = ? ORDER BY name ASC`).all(tenantId);
  },
  updateCustomerPhoto: (tenantId: string, id: string, photoUrl: string) => {
    db.prepare(`UPDATE customers SET photo_url = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`).run(photoUrl, new Date().toISOString(), id, tenantId);
    return db.prepare(`SELECT * FROM customers WHERE id = ? AND tenant_id = ?`).get(id, tenantId);
  },

  // Ledger: Credits
  addCredit: (tenantId: string, input: { id: string; customer_id: string; amount: number; remarks?: string | null; created_at?: string }) => {
    const created = input.created_at ?? new Date().toISOString();
    db.prepare(`INSERT INTO credits (id, tenant_id, customer_id, amount, due_date, remarks, created_at) VALUES (?,?,?,?,?,?,?)`).run(
      input.id, tenantId, input.customer_id, input.amount, null, input.remarks ?? null, created
    );
    return db.prepare(`SELECT * FROM credits WHERE id = ? AND tenant_id = ?`).get(input.id, tenantId);
  },
  updateCredit: (tenantId: string, id: string, updates: Partial<{ amount: number; due_date: string | null; remarks: string | null }>) => {
    const current = db.prepare(`SELECT * FROM credits WHERE id = ? AND tenant_id = ?`).get(id, tenantId) as any;
    if (!current) return undefined;
    const next = {
      amount: updates.amount ?? current.amount,
      due_date: updates.due_date ?? current.due_date ?? null,
      remarks: updates.remarks ?? current.remarks,
    };
    db.prepare(`UPDATE credits SET amount = ?, due_date = ?, remarks = ? WHERE id = ? AND tenant_id = ?`).run(next.amount, next.due_date, next.remarks, id, tenantId);
    return db.prepare(`SELECT * FROM credits WHERE id = ? AND tenant_id = ?`).get(id, tenantId);
  },
  deleteCredit: (tenantId: string, id: string) => {
    const info = db.prepare(`DELETE FROM credits WHERE id = ? AND tenant_id = ?`).run(id, tenantId);
    return info.changes ?? 0;
  },
  listCredits: (tenantId: string, customerId: string) => {
    return db.prepare(`SELECT * FROM credits WHERE customer_id = ? AND tenant_id = ? ORDER BY datetime(created_at) DESC`).all(customerId, tenantId);
  },
  sumCredits: (tenantId: string, customerId: string) => {
    const row = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM credits WHERE customer_id = ? AND tenant_id = ?`).get(customerId, tenantId) as any;
    return row?.total ?? 0;
  },

  // Ledger: Payments
  addPayment: (tenantId: string, input: { id: string; customer_id: string; amount: number; payment_method: string; remarks?: string | null; created_at?: string }) => {
    const created = input.created_at ?? new Date().toISOString();
    db.prepare(`INSERT INTO payments (id, tenant_id, customer_id, amount, payment_method, remarks, created_at) VALUES (?,?,?,?,?,?,?)`).run(
      input.id, tenantId, input.customer_id, input.amount, input.payment_method, input.remarks ?? null, created
    );
    return db.prepare(`SELECT * FROM payments WHERE id = ? AND tenant_id = ?`).get(input.id, tenantId);
  },
  updatePayment: (tenantId: string, id: string, updates: Partial<{ amount: number; payment_method: string; remarks: string | null }>) => {
    const current = db.prepare(`SELECT * FROM payments WHERE id = ? AND tenant_id = ?`).get(id, tenantId) as any;
    if (!current) return undefined;
    const next = {
      amount: updates.amount ?? current.amount,
      payment_method: updates.payment_method ?? current.payment_method,
      remarks: updates.remarks ?? current.remarks,
    };
    db.prepare(`UPDATE payments SET amount = ?, payment_method = ?, remarks = ? WHERE id = ? AND tenant_id = ?`).run(next.amount, next.payment_method, next.remarks, id, tenantId);
    return db.prepare(`SELECT * FROM payments WHERE id = ? AND tenant_id = ?`).get(id, tenantId);
  },
  deletePayment: (tenantId: string, id: string) => {
    const info = db.prepare(`DELETE FROM payments WHERE id = ? AND tenant_id = ?`).run(id, tenantId);
    return info.changes ?? 0;
  },
  listPayments: (tenantId: string, customerId: string) => {
    return db.prepare(`SELECT * FROM payments WHERE customer_id = ? AND tenant_id = ? ORDER BY datetime(created_at) DESC`).all(customerId, tenantId);
  },
  sumPayments: (tenantId: string, customerId: string) => {
    const row = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE customer_id = ? AND tenant_id = ?`).get(customerId, tenantId) as any;
    return row?.total ?? 0;
  },

  // Balance
  getBalance: (tenantId: string, customerId: string) => {
    const total_credit = (db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM credits WHERE customer_id = ? AND tenant_id = ?`).get(customerId, tenantId) as any)?.total ?? 0;
    const total_payment = (db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE customer_id = ? AND tenant_id = ?`).get(customerId, tenantId) as any)?.total ?? 0;
    return { total_credit, total_payment, balance: total_credit - total_payment };
  },
  customersCount: (tenantId: string) => {
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM customers WHERE tenant_id = ?`).get(tenantId) as any;
    return row?.cnt ?? 0;
  },
  totalCredits: (tenantId: string) => {
    const row = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM credits WHERE tenant_id = ?`).get(tenantId) as any;
    return row?.total ?? 0;
  },
  totalPayments: (tenantId: string) => {
    const row = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE tenant_id = ?`).get(tenantId) as any;
    return row?.total ?? 0;
  },

  getCreditors: (tenantId: string) => {
    let tid = tenantId;
    if (!tid || tid === 'default-tenant-id' || tid === 'default') {
      tid = dbService.getDefaultOrOnlyTenantId() || tid;
    }

    // 1. Query creditors table if present
    let rawCreditors: any[] = [];
    try {
      rawCreditors = (tid && tid !== 'default-tenant-id' && tid !== 'default'
        ? db.prepare('SELECT * FROM creditors WHERE tenant_id = ? OR tenant_id IS NULL OR tenant_id = \'\'').all(tid)
        : db.prepare('SELECT * FROM creditors').all()) as any[];
    } catch {
      rawCreditors = [];
    }

    // 2. Query customers & credit ledger table
    let customers: any[] = [];
    try {
      customers = (tid && tid !== 'default-tenant-id' && tid !== 'default'
        ? db.prepare('SELECT * FROM customers WHERE tenant_id = ? OR tenant_id IS NULL OR tenant_id = \'\'').all(tid)
        : db.prepare('SELECT * FROM customers').all()) as any[];
    } catch {
      customers = [];
    }

    const customerCreditors = customers.map(c => {
      let totalCredit = 0;
      let totalPayment = 0;
      try {
        const credRow = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM credits WHERE customer_id = ?').get(c.id) as any;
        totalCredit = credRow?.total ?? 0;
      } catch {}
      try {
        const payRow = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE customer_id = ?').get(c.id) as any;
        totalPayment = payRow?.total ?? 0;
      } catch {}

      const totalDebt = Math.max(0, totalCredit - totalPayment);
      return {
        id: String(c.id),
        tenantId: c.tenant_id || tid,
        name: c.name,
        amount: totalDebt > 0 ? totalDebt : (totalCredit || 0),
        totalDebt,
        totalCredit,
        totalPayment,
        phone: c.phone || '',
        address: c.address || '',
        description: c.address || c.phone || 'Customer Credit Account',
        creditRating: c.credit_rating || 'good',
        photoUrl: c.photo_url || null,
        isPaid: totalDebt === 0,
        createdAt: c.created_at || new Date().toISOString(),
        updatedAt: c.updated_at || new Date().toISOString()
      };
    });

    // Combine standalone creditors with customer ledger records without duplicating IDs
    const creditorMap = new Map<string, any>();
    for (const c of rawCreditors) {
      creditorMap.set(String(c.id), {
        id: String(c.id),
        tenantId: c.tenant_id || tid,
        name: c.name,
        amount: Number(c.amount || c.totalDebt || 0),
        description: c.description || null,
        dueDate: c.dueDate || c.due_date || null,
        reminderDate: c.reminderDate || c.reminder_date || null,
        isPaid: Boolean(c.isPaid || c.is_paid)
      });
    }

    for (const cc of customerCreditors) {
      if (!creditorMap.has(cc.id)) {
        creditorMap.set(cc.id, cc);
      }
    }

    return Array.from(creditorMap.values());
  },

  // Reminders
  addReminder: (tenantId: string, input: { id: string; customer_id: string; message_type: string; message: string; status: string; created_at?: string }) => {
    const created = input.created_at ?? new Date().toISOString();
    db.prepare(`INSERT INTO reminders (id, tenant_id, customer_id, message_type, message, status, created_at) VALUES (?,?,?,?,?,?,?)`).run(
      input.id, tenantId, input.customer_id, input.message_type, input.message, input.status, created
    );
    return db.prepare(`SELECT * FROM reminders WHERE id = ? AND tenant_id = ?`).get(input.id, tenantId);
  },
  listReminders: (tenantId: string, customerId: string) => {
    return db.prepare(`SELECT * FROM reminders WHERE customer_id = ? AND tenant_id = ? ORDER BY datetime(created_at) DESC`).all(customerId, tenantId);
  },
  // Settings
  getSettings: (tenantId?: string) => {
    const rows = (tenantId 
      ? db.prepare(`SELECT key, value FROM settings WHERE tenant_id = ?`).all(tenantId) 
      : db.prepare(`SELECT key, value FROM settings`).all()) as any[];
    const obj: Record<string, any> = {};
    for (const r of rows) {
      try {
        obj[r.key] = JSON.parse(r.value);
      } catch {
        obj[r.key] = r.value;
      }
    }
    return obj;
  },
  upsertSettings: (tenantId: string | Record<string, any>, settings?: Record<string, any>) => {
    const effTenantId = typeof tenantId === 'string' ? tenantId : null;
    const settingsObj = typeof tenantId === 'object' ? tenantId : (settings || {});
    const stmt = db.prepare(`INSERT INTO settings (key, value, tenant_id) VALUES (?, ?, ?) ON CONFLICT(key, tenant_id) DO UPDATE SET value = excluded.value`);
    const tx = db.transaction(() => {
      for (const [k, v] of Object.entries(settingsObj)) {
        const val = typeof v === 'string' ? v : JSON.stringify(v);
        stmt.run(k, val, effTenantId);
      }
    });
    tx();
    return dbService.getSettings(effTenantId || undefined);
  },
  // Bulk sync entity getters
  getExpenses: (tenantId: string) => db.prepare('SELECT * FROM expenses WHERE tenant_id = ?').all(tenantId),
  getPurchases: (tenantId: string) => db.prepare('SELECT * FROM purchases WHERE tenant_id = ?').all(tenantId),
  getCustomers: (tenantId: string) => db.prepare('SELECT * FROM customers WHERE tenant_id = ?').all(tenantId),
  getCredits: (tenantId: string) => db.prepare('SELECT * FROM credits WHERE tenant_id = ?').all(tenantId),
  getPayments: (tenantId: string) => db.prepare('SELECT * FROM payments WHERE tenant_id = ?').all(tenantId),
  getReminders: (tenantId: string) => db.prepare('SELECT * FROM reminders WHERE tenant_id = ?').all(tenantId),
  getRemittances: (tenantId: string) => db.prepare('SELECT * FROM remittances WHERE tenant_id = ?').all(tenantId),
  getNotifications: (tenantId: string) => db.prepare('SELECT * FROM notifications WHERE tenant_id = ?').all(tenantId),
  getAttendance: (tenantId: string) => db.prepare('SELECT * FROM attendance WHERE tenant_id = ?').all(tenantId),
  getLoginHistory: (tenantId: string) => db.prepare('SELECT * FROM login_history WHERE tenant_id = ?').all(tenantId),
  getAuditLogs: (tenantId: string) => db.prepare('SELECT * FROM audit_logs WHERE tenant_id = ?').all(tenantId),
  getAllVariantsByTenant: (tenantId: string) => {
    const rows = db.prepare('SELECT * FROM variants WHERE tenant_id = ?').all(tenantId) as any[];
    return rows.map(r => ({
      id: r.id,
      productId: r.product_id,
      name: r.name,
      barcode: r.barcode,
      price: r.price,
      cost: r.cost,
      image: r.image,
      quantity: r.quantity,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      tenantId: r.tenant_id
    }));
  },
  getSales: (tenantId: string) => db.prepare('SELECT * FROM sales WHERE tenant_id = ?').all(tenantId),
  getSaleItems: (tenantId: string) => db.prepare('SELECT * FROM sale_items WHERE saleId IN (SELECT id FROM sales WHERE tenant_id = ?)').all(tenantId),
  // Admin/User methods
  getAdmins: (tenantId?: string) => {
    return tenantId 
      ? db.prepare('SELECT * FROM users WHERE role = ? AND tenant_id = ?').all('admin', tenantId)
      : db.prepare('SELECT * FROM users WHERE role = ?').all('admin');
  },
  getAdmin: (tenantId?: string) => {
    return tenantId 
      ? db.prepare('SELECT * FROM users WHERE role = ? AND tenant_id = ?').get('admin', tenantId)
      : db.prepare('SELECT * FROM users WHERE role = ?').get('admin');
  },
  saveAdmin: (user: any) => {
    const effectiveTenantId = user.tenantId || user.tenant_id;
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO users (id, username, password, role, businessName, ownerName, mobile, createdAt, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(user.id, user.username, user.password, user.role, user.businessName, user.ownerName, user.mobile, user.createdAt, effectiveTenantId);
    
    // Sync to Cloud (Supabase) if available
    if (useCloud()) {
      const supabase = getSupabase();
      if (supabase) {
        const cloudUser = {
          id: user.id,
          username: user.username,
          password: user.password,
          role: user.role,
          business_name: user.businessName || user.business_name,
          owner_name: user.ownerName || user.owner_name,
          mobile: user.mobile,
          profile_image: user.profileImage || user.profile_image,
          tenant_id: effectiveTenantId,
          created_at: user.createdAt || new Date().toISOString()
        };
        supabase.from('users').upsert(cloudUser).then(({ error }) => {
          if (error) console.error('Cloud admin sync error:', error);
          else console.log('Cloud admin sync: 1 admin updated.');
        });
      }
    }
    return user;
  },

  saveSecurityQuestions: async (userId: string, questions: string[], answers: string[]) => {
    const hashedAnswers = await Promise.all(answers.map(answer => bcrypt.hash(answer, 10)));
    const stmt = db.prepare(`
      UPDATE users SET
        securityQuestion1 = ?, securityAnswer1 = ?,
        securityQuestion2 = ?, securityAnswer2 = ?,
        securityQuestion3 = ?, securityAnswer3 = ?
      WHERE id = ?
    `);
    stmt.run(
      questions[0], hashedAnswers[0],
      questions[1], hashedAnswers[1],
      questions[2], hashedAnswers[2],
      userId
    );

    // Sync to Cloud (Supabase) if available
    if (useCloud()) {
      const supabase = getSupabase();
      if (supabase) {
        supabase.from('users').update({
          security_question_1: questions[0],
          security_answer_1: hashedAnswers[0],
          security_question_2: questions[1],
          security_answer_2: hashedAnswers[1],
          security_question_3: questions[2],
          security_answer_3: hashedAnswers[2],
        }).eq('id', userId).then(({ error }) => {
          if (error) console.error('Cloud security questions sync error:', error);
          else console.log('Cloud security questions sync: 1 user updated.');
        });
      }
    }
  },

  getUserByUsername: (username: string, tenantId?: string) => {
    const clean = String(username || '').trim();
    if (!clean) return undefined;

    if (tenantId && tenantId !== 'default-tenant-id') {
      const match = db.prepare(`
        SELECT * FROM users 
        WHERE tenant_id = ? AND (
          LOWER(TRIM(username)) = LOWER(TRIM(?))
          OR LOWER(TRIM(mobile)) = LOWER(TRIM(?))
          OR LOWER(TRIM(email)) = LOWER(TRIM(?))
          OR LOWER(TRIM(ownerName)) = LOWER(TRIM(?))
        )
      `).get(tenantId, clean, clean, clean, clean);
      if (match) return match;
    }

    return db.prepare(`
      SELECT * FROM users 
      WHERE LOWER(TRIM(username)) = LOWER(TRIM(?))
         OR LOWER(TRIM(mobile)) = LOWER(TRIM(?))
         OR LOWER(TRIM(email)) = LOWER(TRIM(?))
         OR LOWER(TRIM(ownerName)) = LOWER(TRIM(?))
      LIMIT 1
    `).get(clean, clean, clean, clean);
  },

  saveOrUpdateUser: (userData: any) => {
    const stmt = db.prepare(`
      INSERT INTO users (id, tenant_id, username, password, role, businessName, ownerName, mobile, email, profileImage, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        tenant_id = COALESCE(excluded.tenant_id, users.tenant_id),
        username = COALESCE(excluded.username, users.username),
        password = COALESCE(excluded.password, users.password),
        role = COALESCE(excluded.role, users.role),
        businessName = COALESCE(excluded.businessName, users.businessName),
        ownerName = COALESCE(excluded.ownerName, users.ownerName),
        mobile = COALESCE(excluded.mobile, users.mobile),
        email = COALESCE(excluded.email, users.email),
        profileImage = COALESCE(excluded.profileImage, users.profileImage)
    `);
    stmt.run(
      userData.id,
      userData.tenant_id || userData.tenantId || null,
      userData.username,
      userData.password,
      userData.role || 'admin',
      userData.businessName || userData.business_name || null,
      userData.ownerName || userData.owner_name || null,
      userData.mobile || null,
      userData.email || null,
      userData.profileImage || userData.profile_image || null,
      userData.createdAt || userData.created_at || new Date().toISOString()
    );
    return db.prepare('SELECT * FROM users WHERE id = ?').get(userData.id);
  },

  getUserById: (id: string) => {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  updateAdmin: (id: string, updates: Partial<User>) => {
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    if (!current) return undefined;

    const next = {
      ...current,
      ...updates
    };

    const stmt = db.prepare(`
      UPDATE users SET
        username = ?, password = ?, role = ?, businessName = ?, 
        ownerName = ?, mobile = ?, createdAt = ?, profileImage = ?
      WHERE id = ?
    `);
    
    stmt.run(
      next.username, next.password, next.role, next.businessName, 
      next.ownerName, next.mobile, next.createdAt, next.profileImage || null, id
    );

    // Sync to Cloud (Supabase) if available
    if (useCloud()) {
      const supabase = getSupabase();
      if (supabase) {
        supabase.from('users').upsert(next).then(({ error }) => {
          if (error) console.error('Cloud admin update sync error:', error);
          else console.log('Cloud admin update sync: 1 admin updated.');
        });
      }
    }
    return next;
  },

  getUserSecurityQuestions: (username: string) => {
    return db.prepare(`
      SELECT securityQuestion1, securityQuestion2, securityQuestion3,
             securityAnswer1, securityAnswer2, securityAnswer3
      FROM users WHERE username = ?
    `).get(username);
  },

  updateUserPassword: async (username: string, newPasswordHash: string) => {
    const stmt = db.prepare(`UPDATE users SET password = ? WHERE username = ?`);
    stmt.run(newPasswordHash, username);

    // Sync to Cloud (Supabase) if available
    if (useCloud()) {
      const supabase = getSupabase();
      if (supabase) {
        supabase.from('users').update({ password: newPasswordHash }).eq('username', username).then(({ error }) => {
          if (error) console.error('Cloud password update sync error:', error);
          else console.log('Cloud password update sync: 1 user updated.');
        });
      }
    }
  },

  recordFailedLoginAttempt: (username: string) => {
    const user = db.prepare('SELECT failedAttemptCount FROM users WHERE username = ?').get(username);
    if (user) {
      const newCount = (user.failedAttemptCount || 0) + 1;
      db.prepare('UPDATE users SET failedAttemptCount = ? WHERE username = ?').run(newCount, username);
      return newCount;
    }
    return 0;
  },

  lockUserAccount: (username: string, lockoutMinutes: number) => {
    const lockoutUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);
    db.prepare('UPDATE users SET lockoutUntil = ? WHERE username = ?').run(lockoutUntil.toISOString(), username);
  },

  resetLoginAttempts: (username: string) => {
    db.prepare('UPDATE users SET failedAttemptCount = 0, lockoutUntil = NULL WHERE username = ?').run(username);
  },

  addSale: (tenantId: string, sale: Sale, saleItems: SaleItem[]) => {
    const result = db.transaction(() => {
      // Insert sale with tenant_id
      db.prepare(`
        INSERT INTO sales (id, tenant_id, total, paymentType, paymentAmount, staffId, remitted, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sale.id, tenantId, sale.total, sale.paymentType, sale.paymentAmount, sale.staffId, sale.remitted ? 1 : 0, sale.createdAt instanceof Date ? sale.createdAt.toISOString() : String(sale.createdAt));

      // Insert sale items and update product/variant quantities
      for (const item of saleItems) {
        // Ensure we have an id and saleId
        const itemId = item.id || randomUUID();
        const itemSaleId = item.saleId || sale.id;
        
        db.prepare(`
          INSERT INTO sale_items (id, tenant_id, saleId, productId, quantity, price, unit, productName, isNonInventory)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(itemId, tenantId, itemSaleId, item.productId, item.quantity, item.price, item.unit, item.productName, item.isNonInventory ? 1 : 0);

        if (!item.isNonInventory) {
          // Deduct from product or variant with tenant_id filter
          const product = db.prepare('SELECT id, quantity FROM products WHERE id = ? AND tenant_id = ?').get(item.productId, tenantId) as { id: string, quantity: number } | undefined;
          if (product) {
            const newQuantity = product.quantity - item.quantity;
            db.prepare('UPDATE products SET quantity = ?, updatedAt = ? WHERE id = ? AND tenant_id = ?').run(newQuantity, new Date().toISOString(), product.id, tenantId);
          } else {
            const variant = db.prepare('SELECT id, quantity FROM variants WHERE id = ? AND tenant_id = ?').get(item.productId, tenantId) as { id: string, quantity: number } | undefined;
            if (variant) {
              const newQuantity = variant.quantity - item.quantity;
              db.prepare('UPDATE variants SET quantity = ?, updated_at = ? WHERE id = ? AND tenant_id = ?').run(newQuantity, new Date().toISOString(), variant.id, tenantId);
            } else {
              console.warn(`Product or variant with ID ${item.productId} not found for inventory deduction during sale ${sale.id}.`);
            }
          }
        }
      }
    })();

    // Sync to Supabase Cloud if enabled
    if (useCloud()) {
      const supabase = getSupabase();
      if (supabase) {
        (async () => {
          try {
            const effectiveTenantId = tenantId || (sale as any).tenantId || (sale as any).tenant_id;
            if (!effectiveTenantId) {
              console.error('[SALE SYNC ERROR] Missing tenant_id before Supabase operation for sale:', sale.id);
              throw new Error(`SALE_SYNC_BLOCKED: Missing tenant_id for sale ${sale.id}`);
            }

            console.log('[SALE SYNC] Preparing sale');
            console.log('[SALE SYNC] sale_id:', sale.id);
            console.log('[SALE SYNC] tenant_id:', effectiveTenantId);
            console.log('[SALE SYNC] staff_id:', sale.staffId || 'N/A');
            console.log('[SALE SYNC] total:', sale.total);

            // Construct canonical sale object satisfying not-null tenant_id constraint
            const cloudSaleData = {
              id: String(sale.id),
              tenant_id: String(effectiveTenantId),
              total: Number(sale.total || 0),
              payment_type: String(sale.paymentType || 'cash'),
              payment_amount: Number(sale.paymentAmount || 0),
              staff_id: sale.staffId && sale.staffId !== 'unknown' ? String(sale.staffId) : null,
              remitted: !!sale.remitted,
              created_at: sale.createdAt instanceof Date ? sale.createdAt.toISOString() : String(sale.createdAt || new Date().toISOString())
            };

            const { error: saleError } = await supabase.from('sales').upsert(cloudSaleData, { onConflict: 'id' });
            if (saleError) {
              console.error('[SALE SYNC ERROR] Failed to upsert sale to Supabase:', saleError);
              return; // Keep local sale safe in SQLite, do not proceed to sync items if parent sale failed
            }

            console.log('[SALE SYNC] Sale header synced successfully, now syncing sale items...');
            
            // Sync Sale Items with tenant_id
            for (const item of saleItems) {
              try {
                const cloudItemData = {
                  id: String(item.id || randomUUID()),
                  tenant_id: String(effectiveTenantId),
                  sale_id: String(item.saleId || sale.id),
                  product_id: String(item.productId),
                  quantity: Number(item.quantity || 1),
                  price: Number(item.price || 0),
                  unit: String(item.unit || 'pieces'),
                  product_name: item.productName ? String(item.productName) : null,
                  is_non_inventory: !!item.isNonInventory
                };

                const { error: itemError } = await supabase.from('sale_items').upsert(cloudItemData, { onConflict: 'id' });
                if (itemError) {
                  console.error(`[SALE SYNC ERROR] Failed to sync sale item ${item.id}:`, itemError);
                }
              } catch (itemErr) {
                console.error(`[SALE SYNC ERROR] Exception syncing sale item ${item.id}:`, itemErr);
              }
            }

            console.log(`[SALE SYNC] Sale ${sale.id} sync complete!`);
          } catch (err) {
            console.error('[SALE SYNC ERROR] Failed to sync sale to Supabase:', err);
          }
        })();
      }
    }
    return result;
  },

  // Non-inventory product methods
  getNonInventoryProducts: (tenantId: string) => {
    return db.prepare('SELECT * FROM non_inventory_products WHERE tenant_id = ?').all(tenantId);
  },

  getNonInventoryProductByBarcode: (barcode: string, tenantId: string) => {
    return db.prepare('SELECT * FROM non_inventory_products WHERE barcode = ? AND tenant_id = ?').get(barcode, tenantId);
  },

  saveNonInventoryProducts: (products: any[], tenantId: string) => {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO non_inventory_products 
      (id, tenant_id, name, price, category, description, image, barcode, barcode_data, created_at, updated_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertMany = db.transaction((products: any[]) => {
      for (const product of products) {
        try {
          insert.run(
            product.id,
            tenantId,
            product.name,
            product.price,
            product.category || 'general',
            product.description || null,
            product.image || null,
            product.barcode,
            product.barcodeData || product.barcode_data || null,
            product.createdAt || new Date().toISOString(),
            product.updatedAt || new Date().toISOString()
          );
        } catch (e) {
          console.error('Failed to upsert non-inventory product', product?.barcode, e);
        }
      }
    });
    
    insertMany(products);

    // // Mirror to Cloud (Supabase) if available
    // if (useCloud()) {
    //   const supabase = getSupabase();
    //   if (supabase) {
    //     const cloudProducts = products.map(p => ({
    //       id: String(p.id),
    //       tenant_id: tenantId,
    //       name: String(p.name || ''),
    //       price: Number(p.price || 0),
    //       category: p.category || 'general',
    //       description: p.description || null,
    //       image: p.image || null,
    //       barcode: String(p.barcode || ''),
    //       barcode_data: p.barcodeData || p.barcode_data || null,
    //       created_at: p.createdAt || new Date().toISOString(),
    //       updated_at: p.updatedAt || new Date().toISOString()
    //     }));
    //     supabase.from('non_inventory_products').upsert(cloudProducts, { onConflict: 'id' }).then(({ error }) => {
    //       if (error) console.error('Cloud non-inventory product sync error:', error);
    //       else console.log(`Cloud non-inventory product sync: ${cloudProducts.length} items updated.`);
    //     });
    //   }
    // }

    return products;
  },

  deleteNonInventoryProduct: (id: string, tenantId: string) => {
    return db.prepare('DELETE FROM non_inventory_products WHERE id = ? AND tenant_id = ?').run(id, tenantId);
  },

  // Clear all table data (products, staff)
  clearAllData: () => {
    const delProducts = db.prepare('DELETE FROM products').run();
    const delStaff = db.prepare('DELETE FROM staff').run();
    return {
      productsDeleted: delProducts.changes ?? 0,
      staffDeleted: delStaff.changes ?? 0,
    };
  },
  // Product methods
  getProducts: (tenantId: string) => {
    let tid = tenantId;
    if (!tid || tid === 'default-tenant-id' || tid === 'default') {
      tid = dbService.getDefaultOrOnlyTenantId() || tid;
    }
    if (!tid || tid === 'default-tenant-id' || tid === 'default') {
      return db.prepare('SELECT * FROM products').all();
    }
    return db.prepare('SELECT * FROM products WHERE tenant_id = ? OR tenant_id IS NULL OR tenant_id = \'\'').all(tid);
  },

  getProductByBarcode: (barcode: string, tenantId: string) => {
    return db.prepare('SELECT * FROM products WHERE barcode = ? AND tenant_id = ?').get(barcode, tenantId);
  },

  getProductById: (id: string, tenantId: string) => {
    return db.prepare('SELECT * FROM products WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  },

  updateStock: (id: string, quantity: number, tenantId: string) => {
    return db.prepare('UPDATE products SET quantity = ?, updatedAt = ? WHERE id = ? AND tenant_id = ?').run(quantity, new Date().toISOString(), id, tenantId);
  },

  saveProducts: (products: any[], tenantId: string) => {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO products 
      (id, tenant_id, name, price, cost, description, barcode, box_barcode, units_per_box, box_cost, category, image, quantity, createdAt, updatedAt) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((products: any[]) => {
      for (const product of products) {
        try {
          const id = String(product.id);
          const name = String(product.name ?? '');
          const price = Number(product.price ?? 0);
          const cost = Number(product.cost ?? 0);
          const description = product.description != null ? String(product.description) : null;
          const barcode = String(product.barcode ?? '').trim() || null;
          const boxBarcode = product.box_barcode || product.boxBarcode || null;
          const unitsPerBox = Number(product.units_per_box ?? product.unitsPerBox ?? 1);
          const boxCost = Number(product.box_cost ?? product.boxCost ?? 0);
          const category = product.category != null ? String(product.category) : null;
          const image = product.image != null ? String(product.image) : null;
          const quantity = Number(product.quantity ?? 0);
          const createdAt = String(product.createdAt ?? new Date().toISOString());
          const updatedAt = String(product.updatedAt ?? new Date().toISOString());

          insert.run(
            id,
            tenantId,
            name,
            price,
            cost,
            description,
            barcode,
            boxBarcode,
            unitsPerBox,
            boxCost,
            category,
            image,
            quantity,
            createdAt,
            updatedAt
          );
        } catch (e) {
          console.error('Failed to upsert product', product?.barcode, e);
        }
      }
    });
    
    insertMany(products);
    
    // Mirror to Cloud (Supabase) if available
    if (useCloud()) {
      const supabase = getSupabase();
      if (supabase) {
        (async () => {
          try {
            console.log('[SYNC] Starting product sync to Supabase for tenant:', tenantId);
            // Process each product individually
            for (const p of products) {
              try {
                // Validate required fields first
                if (!p.id || !tenantId || !p.name || p.price == null) {
                  console.error('[SYNC FAILURE] Invalid product (missing required fields)', {
                    productId: p.id,
                    tenantId,
                    originalProduct: p
                  });
                  continue;
                }

                // Build payload using RAW SQLite values directly (ensure dates are ISO strings)
                const normalizeDate = (d: any) => {
                  if (!d) return new Date().toISOString();
                  if (typeof d === 'number') return new Date(d).toISOString();
                  if (d instanceof Date) return d.toISOString();
                  return String(d);
                };
                const productData = {
                  id: p.id,
                  tenant_id: tenantId,
                  name: p.name,
                  price: p.price,
                  cost: p.cost,
                  description: p.description != null ? String(p.description) : null,
                  barcode: p.barcode,
                  box_barcode: p.box_barcode || p.boxBarcode || null,
                  units_per_box: Number(p.units_per_box ?? p.unitsPerBox ?? 1),
                  box_cost: Number(p.box_cost ?? p.boxCost ?? 0),
                  category: p.category,
                  image: p.image,
                  quantity: p.quantity,
                  created_at: normalizeDate(p.createdAt),
                  updated_at: normalizeDate(p.updatedAt)
                };

                // Log original SQLite product and generated payload BEFORE upsert
                console.log('[SYNC] Preparing to sync product', {
                  productId: p.id,
                  tenantId,
                  originalProduct: p,
                  generatedPayload: productData
                });

                // Perform EXACTLY ONE upsert() per product
                const { error } = await supabase.from('products').upsert(productData, { onConflict: 'id' });

                if (error) {
                  console.error('[SYNC FAILURE]', {
                    productId: p.id,
                    tenantId,
                    originalProduct: p,
                    generatedPayload: productData,
                    errorMessage: error.message,
                    errorDetails: error.details,
                    errorHint: error.hint,
                    errorCode: error.code,
                    tableName: 'products'
                  });
                } else {
                  console.log(`[SYNC SUCCESS] Product ID: ${p.id}, Tenant ID: ${tenantId}`);
                }
              } catch (singleProdErr: any) {
                console.error('[SYNC FAILURE]', {
                  productId: p.id,
                  tenantId,
                  originalProduct: p,
                  errorMessage: singleProdErr.message,
                  errorDetails: singleProdErr.details,
                  errorHint: singleProdErr.hint,
                  errorCode: singleProdErr.code,
                  tableName: 'products'
                });
              }
            }
            console.log('[SYNC] Product sync complete:', products.length, 'products processed.');
          } catch (err) {
            console.error('[SYNC] Cloud product sync error:', err);
          }
        })();
      }
    }
    
    return products;
  },

  getProductsSince: (timestamp: Date, tenantId: string) => {
    return db.prepare('SELECT * FROM products WHERE datetime(updatedAt) > datetime(?) AND tenant_id = ?').all(timestamp.toISOString(), tenantId);
  },

  getVariantsSince: (timestamp: Date, tenantId: string) => {
    const rows = db.prepare('SELECT * FROM variants WHERE datetime(updated_at) > datetime(?) AND tenant_id = ?').all(timestamp.toISOString(), tenantId) as any[];
    return rows.map(r => ({
      id: r.id,
      productId: r.product_id,
      name: r.name,
      barcode: r.barcode,
      price: r.price,
      cost: r.cost,
      image: r.image,
      quantity: r.quantity,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  },

  // Variant methods
  getVariants: (productId: string, tenantId: string) => {
    // Map snake_case columns to camelCase properties to match shared/schema
    const rows = db.prepare('SELECT * FROM variants WHERE product_id = ? AND tenant_id = ?').all(productId, tenantId) as any[];
    return rows.map(r => ({
      id: r.id,
      productId: r.product_id,
      name: r.name,
      barcode: r.barcode,
      price: r.price,
      cost: r.cost,
      image: r.image,
      quantity: r.quantity,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  },

  getVariantById: (id: string, tenantId: string) => {
    const r = db.prepare('SELECT * FROM variants WHERE id = ? AND tenant_id = ?').get(id, tenantId) as any;
    if (!r) return undefined;
    return {
      id: r.id,
      productId: r.product_id,
      name: r.name,
      barcode: r.barcode,
      price: r.price,
      cost: r.cost,
      image: r.image,
      quantity: r.quantity,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  },

  getAllSalesWithStaff: async (tenantId: string) => {
    let sales = db.prepare(`
      SELECT
        s.id AS saleId,
        s.total,
        s.paymentType,
        s.paymentAmount,
        s.staffId,
        s.remitted,
        s.createdAt,
        st.name AS staffName
      FROM sales s
      LEFT JOIN staff st ON (s.staffId = st.staffId AND st.tenant_id = ?)
      WHERE s.tenant_id = ?
      ORDER BY s.createdAt DESC
    `).all(tenantId, tenantId) as any[];

    // If local sales is empty and cloud is available, try fetching from Supabase
    if (sales.length === 0 && useCloud()) {
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data: cloudSales, error: saleError } = await supabase
            .from('sales')
            .select(`
              id,
              total,
              payment_type,
              payment_amount,
              staff_id,
              remitted,
              created_at
            `)
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false });

          if (!saleError && cloudSales) {
            // Also fetch staff names for these sales
            const { data: cloudStaff } = await supabase.from('staff').select('staff_id, name').eq('tenant_id', tenantId);
            const staffMap = new Map((cloudStaff || []).map(s => [s.staff_id, s.name]));

            sales = cloudSales.map(s => ({
              saleId: s.id,
              total: Number(s.total || 0),
              paymentType: s.payment_type || 'cash',
              paymentAmount: Number(s.payment_amount || s.total || 0),
              staffId: s.staff_id,
              remitted: !!s.remitted,
              createdAt: s.created_at,
              staffName: staffMap.get(s.staff_id) || 'Staff'
            }));
          }
        } catch (cloudErr) {
          console.warn('Failed to fetch sales from cloud fallback:', cloudErr);
        }
      }
    }

    const salesWithItems = await Promise.all(sales.map(async (sale) => {
      let items = db.prepare('SELECT * FROM sale_items WHERE saleId = ?').all(sale.saleId);
      
      // If local items is empty and cloud is available, try fetching from Supabase
      if (items.length === 0 && useCloud()) {
        const supabase = getSupabase();
        if (supabase) {
          try {
            const { data: cloudItems } = await supabase
              .from('sale_items')
              .select('*')
              .eq('sale_id', sale.saleId);
            
            if (cloudItems) {
              items = cloudItems.map(it => ({
                id: it.id,
                saleId: it.sale_id,
                productId: it.product_id,
                quantity: it.quantity,
                price: it.price,
                unit: it.unit,
                productName: it.product_name,
                isNonInventory: !!it.is_non_inventory
              }));
            }
          } catch (err) {
            console.error(`Failed to fetch items for sale ${sale.saleId} from Supabase:`, err);
          }
        }
      }

      return {
        id: sale.saleId,
        total: sale.total,
        paymentType: sale.paymentType,
        paymentAmount: sale.paymentAmount,
        staffId: sale.staffId,
        remitted: !!sale.remitted,
        createdAt: sale.createdAt,
        staffName: sale.staffName || 'Staff',
        items: items.map((it: any) => ({
          id: it.id,
          saleId: it.saleId || it.sale_id,
          productId: it.productId || it.product_id,
          quantity: it.quantity,
          price: it.price,
          unit: it.unit,
          productName: it.productName || it.product_name,
          isNonInventory: !!(it.isNonInventory || it.is_non_inventory)
        }))
      };
    }));
    return salesWithItems;
  },

  getAllVariants: () => {
     return db.prepare('SELECT * FROM variants').all();
  },

  saveVariants: (variants: any[], tenantId: string) => {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO variants 
      (id, tenant_id, product_id, name, barcode, price, cost, image, quantity, created_at, updated_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertMany = db.transaction((variants: any[]) => {
      for (const v of variants) {
        try {
          insert.run(
            v.id,
            tenantId,
            v.productId || v.product_id,
            v.name,
            v.barcode || null,
            v.price,
            v.cost,
            v.image || null,
            v.quantity || 0,
            v.createdAt || v.created_at || new Date().toISOString(),
            v.updatedAt || v.updated_at || new Date().toISOString()
          );
        } catch (e: any) {
          if (e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
            console.warn(`Skipping variant ${v?.id} due to missing product_id: ${v.productId || v.product_id}`);
          } else {
            console.error('Failed to upsert variant', v?.id, e);
          }
        }
      }
    });
    
    insertMany(variants);

    if (useCloud()) {
      const supabase = getSupabase();
      if (supabase) {
        (async () => {
          try {
            console.log('[SYNC] Starting variant sync to Supabase for tenant:', tenantId);
            for (const v of variants) {
              try {
                const product_id = v.productId || v.product_id;
                if (!tenantId || !v.id || !product_id || !v.name || v.price == null) {
                  console.error('[SYNC FAILURE] Skipping variant with missing required fields:', {
                    variantId: v.id,
                    tenantId,
                    product_id,
                    name: v.name,
                    price: v.price
                  });
                  continue;
                }
                const variantData = {
                  id: String(v.id),
                  tenant_id: String(tenantId),
                  product_id: String(product_id),
                  name: String(v.name),
                  barcode: v.barcode != null ? String(v.barcode) : null,
                  price: Number(v.price),
                  cost: v.cost != null ? Number(v.cost) : null,
                  image: v.image != null ? String(v.image) : null,
                  quantity: Number(v.quantity ?? 0),
                  created_at: String(v.createdAt || v.created_at || new Date().toISOString()),
                  updated_at: String(v.updatedAt || v.updated_at || new Date().toISOString())
                };
                const { error: varError } = await supabase.from('variants').upsert(variantData, { onConflict: 'id' });
                if (varError) {
                  console.error('[SYNC ERROR] Failed to sync variant:', {
                    variantId: variantData.id,
                    tenant_id: variantData.tenant_id,
                    code: varError.code,
                    message: varError.message,
                    details: varError.details,
                    hint: varError.hint
                  });
                }
              } catch (singleVariantErr) {
                console.error(`[SYNC] Failed to sync variant ${v?.id}`, singleVariantErr);
              }
            }
            console.log(`[SYNC] Variant sync complete: ${variants.length} variants processed.`);
          } catch (err) {
            console.error('[SYNC] Cloud variant sync error:', err);
          }
        })();
      }
    }
    
    return variants;
  },

  // Staff methods
  getStaff: (tenantId: string) => {
    let tid = tenantId;
    if (!tid || tid === 'default-tenant-id' || tid === 'default') {
      tid = dbService.getDefaultOrOnlyTenantId() || tid;
    }
    if (!tid || tid === 'default-tenant-id' || tid === 'default') {
      return db.prepare('SELECT * FROM staff').all();
    }
    return db.prepare('SELECT * FROM staff WHERE tenant_id = ? OR tenant_id IS NULL OR tenant_id = \'\'').all(tid);
  },

  saveStaff: async (staff: any[], tenantId: string) => {
    try {
      const processedStaff = await Promise.all(staff.map(async member => {
        const safeMember: Record<string, any> = { ...member };
        delete safeMember.username;

        let passkey = safeMember.passkey;
        if (passkey && !passkey.startsWith('$2')) {
          passkey = await bcrypt.hash(passkey, 10);
        }
        
        let createdAt = safeMember.createdAt || safeMember.created_at;
        if (createdAt instanceof Date) {
          createdAt = createdAt.toISOString();
        } else if (!createdAt) {
          createdAt = new Date().toISOString();
        }

        const resolvedTenantId = tenantId || safeMember.tenantId || safeMember.tenant_id;
        if (!resolvedTenantId || typeof resolvedTenantId !== 'string' || resolvedTenantId.trim() === '') {
          throw new Error(`DATABASE_SCHEMA_MIGRATION_FAILED: saveStaff() blocked — missing tenant_id for staff. id=${String(safeMember.id || 'unknown')}`);
        }

        return {
          id: String(safeMember.id),
          tenantId: resolvedTenantId,
          userId: safeMember.userId || safeMember.user_id || null,
          firstName: String(safeMember.firstName || ''),
          middleName: safeMember.middleName || null,
          lastName: String(safeMember.lastName || ''),
          name: String(safeMember.name || `${safeMember.firstName || ''} ${safeMember.lastName || ''}`.trim()),
          staffId: String(safeMember.staffId || safeMember.staff_id || ''),
          passkey: passkey,
          role: safeMember.role || 'cashier',
          branch: safeMember.branch || null,
          department: safeMember.department || null,
          employmentStatus: safeMember.employmentStatus || 'active',
          email: safeMember.email || null,
          phone: safeMember.phone || null,
          address: safeMember.address || null,
          birthdate: safeMember.birthdate || null,
          gender: safeMember.gender || null,
          dateHired: safeMember.dateHired || null,
          assignedShift: safeMember.assignedShift || null,
          lastLogin: safeMember.lastLogin || safeMember.last_login || null,
          passwordLastChanged: safeMember.passwordLastChanged || safeMember.password_last_changed || null,
          permissions: safeMember.permissions ? JSON.stringify(safeMember.permissions) : null,
          createdBy: safeMember.createdBy || safeMember.created_by || null,
          createdAt: createdAt,
          updatedAt: new Date().toISOString()
        };
      }));

      const insert = db.prepare(`
        INSERT OR REPLACE INTO staff 
        (id, tenant_id, user_id, firstName, middleName, lastName, name, staffId, passkey, role, branch, department, employmentStatus, email, phone, address, birthdate, gender, dateHired, assignedShift, lastLogin, passwordLastChanged, permissions, createdBy, createdAt, updatedAt) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((staffMembers: any[]) => {
        for (const member of staffMembers) {
          insert.run(
            member.id,
            member.tenantId,
            member.userId,
            member.firstName,
            member.middleName,
            member.lastName,
            member.name,
            member.staffId,
            member.passkey,
            member.role,
            member.branch,
            member.department,
            member.employmentStatus,
            member.email,
            member.phone,
            member.address,
            member.birthdate,
            member.gender,
            member.dateHired,
            member.assignedShift,
            member.lastLogin,
            member.passwordLastChanged,
            member.permissions,
            member.createdBy,
            member.createdAt,
            member.updatedAt
          );
        }
      });
      
      for (const member of processedStaff) {
        console.log(`[STAFF SAVE] tenant_id=${member.tenantId}`);
        console.log(`[STAFF SAVE] staff_id=${member.staffId || member.id}`);
        console.log(`[STAFF SAVE] sqlite columns=26`);
        console.log(`[STAFF SAVE] username ignored=true`);
      }

      insertMany(processedStaff);

      // Mirror to Cloud (Supabase) if available
      if (useCloud()) {
        const supabase = getSupabase();
        if (supabase) {
          await (async () => {
            try {
              for (const m of processedStaff) {
                const effectiveTenantId = m.tenantId || tenantId;
                if (!effectiveTenantId) {
                  console.error('[STAFF SYNC ERROR] Missing tenant_id before Supabase operation for staff:', m.id);
                  continue;
                }

                const item = m as any;
                const cloudStaffData = {
                  id: String(item.id),
                  tenant_id: String(effectiveTenantId),
                  user_id: item.userId || item.user_id || null,
                  first_name: String(item.firstName || item.first_name || 'Staff'),
                  middle_name: item.middleName || item.middle_name || null,
                  last_name: String(item.lastName || item.last_name || 'Member'),
                  name: String(item.name || `${item.firstName || ''} ${item.lastName || ''}`.trim() || 'Staff Member'),
                  staff_id: String(item.staffId || item.staff_id || ''),
                  passkey: item.passkey || null,
                  role: item.role || 'cashier',
                  branch: item.branch || null,
                  department: item.department || null,
                  employment_status: item.employmentStatus || item.employment_status || 'active',
                  email: item.email || null,
                  phone: item.phone || null,
                  address: item.address || null,
                  birthdate: item.birthdate ? (item.birthdate instanceof Date ? item.birthdate.toISOString() : String(item.birthdate)) : null,
                  gender: item.gender || null,
                  date_hired: item.dateHired ? (item.dateHired instanceof Date ? item.dateHired.toISOString() : String(item.dateHired)) : null,
                  assigned_shift: item.assignedShift || item.assigned_shift || null,
                  last_login: item.lastLogin ? (item.lastLogin instanceof Date ? item.lastLogin.toISOString() : String(item.lastLogin)) : null,
                  password_last_changed: item.passwordLastChanged ? (item.passwordLastChanged instanceof Date ? item.passwordLastChanged.toISOString() : String(item.passwordLastChanged)) : null,
                  permissions: item.permissions ? (typeof item.permissions === 'string' ? JSON.parse(item.permissions) : item.permissions) : null,
                  created_by: item.createdBy || item.created_by || null,
                  created_at: item.createdAt ? (item.createdAt instanceof Date ? item.createdAt.toISOString() : String(item.createdAt)) : new Date().toISOString(),
                  updated_at: item.updatedAt ? (item.updatedAt instanceof Date ? item.updatedAt.toISOString() : String(item.updatedAt)) : new Date().toISOString()
                };

                console.log('[STAFF SYNC] Preparing staff');
                console.log('[STAFF SYNC] staff_id:', cloudStaffData.id);
                console.log('[STAFF SYNC] tenant_id:', cloudStaffData.tenant_id);
                console.log('[STAFF SYNC] user_id:', cloudStaffData.user_id);
                console.log('[STAFF SYNC] name:', cloudStaffData.name);
                console.log('[STAFF SYNC] role:', cloudStaffData.role);

                const { error: staffError } = await supabase.from('staff').upsert(cloudStaffData, { onConflict: 'id' });
                if (staffError) {
                  console.error('[STAFF SYNC ERROR]');
                  console.error('staff_id:', cloudStaffData.id);
                  console.error('tenant_id:', cloudStaffData.tenant_id);
                  console.error('code:', staffError.code);
                  console.error('message:', staffError.message);
                  console.error('details:', staffError.details);
                  console.error('hint:', staffError.hint);
                } else {
                  console.log('[STAFF SYNC SUCCESS]');
                  console.log('staff_id:', cloudStaffData.id);
                  console.log('tenant_id:', cloudStaffData.tenant_id);
                }
              }
            } catch (err) {
              console.error('[STAFF SYNC ERROR] Unexpected cloud staff sync exception:', err);
            }
          })();
        }
      }

      return staff;
    } catch (error) {
      console.error('Error in saveStaff:', error);
      throw error;
    }
  },

  getStaffSince: (timestamp: Date, tenantId: string) => {
    return db.prepare('SELECT * FROM staff WHERE datetime(createdAt) > datetime(?) AND tenant_id = ?').all(timestamp.toISOString(), tenantId);
  },

  getStaffById: (id: string, tenantId: string) => {
    const staff = db.prepare('SELECT * FROM staff WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (staff) {
      // Parse permissions JSON if exists
      return {
        ...staff,
        permissions: staff.permissions ? (() => { try { return JSON.parse(staff.permissions); } catch { return [staff.permissions]; } })() : []
      };
    }
    return null;
  },

  updateStaff: async (id: string, tenantId: string, updates: any, adminId?: string, adminName?: string) => {
    // First get current staff to find changed fields
    const currentStaff = db.prepare('SELECT * FROM staff WHERE id = ? AND tenant_id = ?').get(id, tenantId);
    if (!currentStaff) throw new Error('Staff not found');

    // Prepare update data
    const now = new Date().toISOString();
    const fieldsToUpdate = [];
    const values = [];
    const changedFields = [];
    const oldValues: any = {};
    const newValues: any = {};

    const allowedFields = [
      'firstName', 'middleName', 'lastName', 'name', 
      'email', 'phone', 'address', 'role', 'branch', 
      'department', 'employmentStatus', 'birthdate', 'gender',
      'assignedShift', 'permissions'
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        // Handle JSON for permissions
        let value = updates[field];
        if (field === 'permissions') {
          value = JSON.stringify(value);
        }

        // Check if value changed
        if (currentStaff[field] !== value) {
          changedFields.push(field);
          oldValues[field] = currentStaff[field];
          newValues[field] = updates[field];
        }

        fieldsToUpdate.push(`${field} = ?`);
        values.push(value);
      }
    }

    // Always update updatedAt
    fieldsToUpdate.push('updatedAt = ?');
    values.push(now);

    if (fieldsToUpdate.length === 0) return currentStaff;

    // Add id and tenantId to values for WHERE clause
    values.push(id, tenantId);

    // Execute update
    const stmt = db.prepare(`
      UPDATE staff 
      SET ${fieldsToUpdate.join(', ')} 
      WHERE id = ? AND tenant_id = ?
    `);
    stmt.run(...values);

    // Create audit log
    if (changedFields.length > 0) {
      dbService.createAuditLog({
        tenantId,
        adminId,
        adminName,
        action: 'update_staff',
        staffId: id,
        staffName: currentStaff.name,
        changedFields,
        oldValues,
        newValues
      });
    }

    // Sync to cloud
    if (useCloud()) {
      const supabase = getSupabase();
      if (supabase) {
        try {
          // Build cloud data
          const cloudData: any = {};
          for (const field of allowedFields) {
            if (updates[field] !== undefined) {
              if (field === 'permissions') {
                cloudData.permissions = updates[field];
              } else {
                const cloudFieldMap: Record<string, string> = {
                  firstName: 'first_name',
                  middleName: 'middle_name',
                  lastName: 'last_name',
                  employmentStatus: 'employment_status',
                  assignedShift: 'assigned_shift'
                };
                cloudData[cloudFieldMap[field] || field] = updates[field];
              }
            }
          }
          cloudData.updated_at = now;
          await supabase.from('staff').update(cloudData).eq('id', id).eq('tenant_id', tenantId);
        } catch (e) {
          console.error('Cloud update failed:', e);
        }
      }
    }

    // Return updated staff
    return dbService.getStaffById(id, tenantId);
  },

  updateStaffStatus: (id: string, tenantId: string, status: string) => {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE staff 
      SET employmentStatus = ?, updatedAt = ? 
      WHERE id = ? AND tenant_id = ?
    `);
    stmt.run(status, now, id, tenantId);

    if (useCloud()) {
      const supabase = getSupabase();
      if (supabase) {
        supabase.from('staff').update({ employment_status: status, updated_at: now }).eq('id', id).eq('tenant_id', tenantId);
      }
    }

    return dbService.getStaffById(id, tenantId);
  },

  updateStaffPassword: async (id: string, tenantId: string, newPasskeyHash: string) => {
    const now = new Date().toISOString();
    const effectiveTenantId = tenantId || dbService.getDefaultOrOnlyTenantId();
    const stmt = db.prepare(`
      UPDATE staff 
      SET passkey = ?, passwordLastChanged = ?, updatedAt = ? 
      WHERE id = ? OR staffId = ?
    `);
    stmt.run(newPasskeyHash, now, now, id, id);

    if (useCloud()) {
      const supabase = getSupabase();
      if (supabase) {
        try {
          await supabase.from('staff').update({
            passhash: newPasskeyHash,
            passkey: newPasskeyHash,
            pass_key: newPasskeyHash,
            pass_hash: newPasskeyHash,
            password_last_changed: now,
            updated_at: now
          }).or(`id.eq.${id},staff_id.eq.${id}`);
          console.log(`[SUPABASE] Staff password updated in cloud for staff: ${id}`);
        } catch (e) {
          console.error('Cloud staff password update failed:', e);
        }
      }
    }
    return dbService.getStaffById(id, effectiveTenantId || 'default-tenant-id');
  },

  updateStaffPermissions: (id: string, tenantId: string, permissions: string[]) => {
    const now = new Date().toISOString();
    const permissionsJson = JSON.stringify(permissions);
    const stmt = db.prepare(`
      UPDATE staff 
      SET permissions = ?, updatedAt = ? 
      WHERE id = ? AND tenant_id = ?
    `);
    stmt.run(permissionsJson, now, id, tenantId);

    if (useCloud()) {
      const supabase = getSupabase();
      if (supabase) {
        supabase.from('staff').update({ permissions, updated_at: now }).eq('id', id).eq('tenant_id', tenantId);
      }
    }

    return dbService.getStaffById(id, tenantId);
  },

  deleteStaff: async (id: string, tenantId: string) => {
    let tid = tenantId;
    if (!tid || tid === 'default-tenant-id' || tid === 'default') {
      tid = dbService.getDefaultOrOnlyTenantId() || tid;
    }
    const current = db.prepare('SELECT * FROM staff WHERE (id = ? OR staffId = ?) AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = \'\')').get(id, id, tid) as any;
    const targetId = current?.id || id;
    const targetStaffId = current?.staffId || id;

    console.log(`[STAFF DELETE] Removing staff targetId=${targetId}, targetStaffId=${targetStaffId}, tenantId=${tid}`);

    // 1. Delete from SQLite
    db.prepare('DELETE FROM staff WHERE (id = ? OR staffId = ?) AND (tenant_id = ? OR tenant_id IS NULL OR tenant_id = \'\')').run(targetId, targetStaffId, tid);

    // 2. Delete directly from Supabase Cloud
    if (useCloud()) {
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { error } = await supabase.from('staff').delete().or(`id.eq.${targetId},staff_id.eq.${targetStaffId}`);
          if (error) {
            console.error('[STAFF CLOUD DELETE ERROR]', error.message);
          } else {
            console.log(`[STAFF CLOUD DELETE SUCCESS] Deleted staff ${targetId} / ${targetStaffId} directly from Supabase cloud.`);
          }
        } catch (e) {
          console.error('[STAFF CLOUD DELETE EXCEPTION]', e);
        }
      }
    }

    return { success: true, deletedId: targetId };
  },

  // Audit log functions
  createAuditLog: (log: {
    tenantId: string;
    adminId?: string;
    adminName?: string;
    action: string;
    staffId?: string;
    staffName?: string;
    changedFields?: string[];
    oldValues?: any;
    newValues?: any;
    ipAddress?: string;
  }) => {
    const id = randomUUID();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO audit_logs 
      (id, tenant_id, admin_id, admin_name, action, staff_id, staff_name, changed_fields, old_values, new_values, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      log.tenantId,
      log.adminId || null,
      log.adminName || null,
      log.action,
      log.staffId || null,
      log.staffName || null,
      log.changedFields ? JSON.stringify(log.changedFields) : null,
      log.oldValues ? JSON.stringify(log.oldValues) : null,
      log.newValues ? JSON.stringify(log.newValues) : null,
      log.ipAddress || null,
      now
    );
    return { id, ...log, createdAt: now };
  },

  // Staff performance data
  getStaffPerformance: (staffId: string, tenantId: string) => {
    // Calculate today's sales, weekly sales, monthly sales
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.setDate(now.getDate() - now.getDay())).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Today's sales
    const todaySales = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM sales 
      WHERE staffId = ? 
        AND tenant_id = ? 
        AND datetime(createdAt) >= datetime(?)
    `).get(staffId, tenantId, todayStart) as any;

    // Weekly sales
    const weeklySales = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM sales 
      WHERE staffId = ? 
        AND tenant_id = ? 
        AND datetime(createdAt) >= datetime(?)
    `).get(staffId, tenantId, weekStart) as any;

    // Monthly sales
    const monthlySales = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as total
      FROM sales 
      WHERE staffId = ? 
        AND tenant_id = ? 
        AND datetime(createdAt) >= datetime(?)
    `).get(staffId, tenantId, monthStart) as any;

    // Transaction count
    const transactionCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM sales 
      WHERE staffId = ? 
        AND tenant_id = ? 
        AND datetime(createdAt) >= datetime(?)
    `).get(staffId, tenantId, todayStart) as any;

    // Items sold
    const itemsSold = db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as total
      FROM sale_items
      JOIN sales ON sale_items.saleId = sales.id
      WHERE sales.staffId = ? 
        AND sales.tenant_id = ? 
        AND datetime(sales.createdAt) >= datetime(?)
    `).get(staffId, tenantId, todayStart) as any;

    return {
      todaySales: todaySales.total || 0,
      weeklySales: weeklySales.total || 0,
      monthlySales: monthlySales.total || 0,
      transactionCount: transactionCount.count || 0,
      itemsSold: itemsSold.total || 0
    };
  },

  // Staff activity
  getStaffActivity: (staffId: string, tenantId: string) => {
    // Get recent activity (sales)
    const activity = db.prepare(`
      SELECT id, total, createdAt
      FROM sales 
      WHERE staffId = ? 
        AND tenant_id = ? 
      ORDER BY datetime(createdAt) DESC
      LIMIT 20
    `).all(staffId, tenantId);
    return activity;
  },

  // Staff attendance
  getStaffAttendance: (staffId: string, tenantId: string) => {
    // Get today's attendance first
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();

    let attendance = db.prepare(`
      SELECT * FROM attendance 
      WHERE staff_id = ? 
        AND tenant_id = ? 
        AND datetime(date) >= datetime(?)
      ORDER BY datetime(date) DESC
    `).get(staffId, tenantId, todayStart);

    if (!attendance) {
      return {
        date: today.toISOString(),
        clockIn: null,
        clockOut: null,
        hoursWorked: null,
        isLate: false
      };
    }

    return attendance;
  },

  // Staff login history
  getStaffLoginHistory: (staffId: string, tenantId: string) => {
    return db.prepare(`
      SELECT * FROM login_history 
      WHERE staff_id = ? 
        AND tenant_id = ? 
      ORDER BY datetime(login_time) DESC
      LIMIT 20
    `).all(staffId, tenantId);
  },

  recordStaffLogin: (entry: { id: string; staffId: string; tenantId: string; deviceInfo?: string; ipAddress?: string; loginTime?: string }) => {
    const now = new Date().toISOString();
    const loginTime = entry.loginTime || now;
    db.prepare(`
      INSERT INTO login_history
      (id, tenant_id, staff_id, device_info, ip_address, login_time, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.id,
      entry.tenantId,
      entry.staffId,
      entry.deviceInfo || null,
      entry.ipAddress || null,
      loginTime,
      now
    );

    try {
      const supabase = getSupabase();
      if (supabase && entry.tenantId && entry.tenantId !== 'default-tenant-id') {
        (async () => {
          try {
            await supabase.from('login_history').upsert({
              id: entry.id,
              tenant_id: entry.tenantId,
              staff_id: entry.staffId,
              device_info: entry.deviceInfo || null,
              ip_address: entry.ipAddress || null,
              login_time: loginTime,
              created_at: now
            }, { onConflict: 'id' });
          } catch (err: any) {
            console.warn('Supabase login_history sync error:', err?.message);
          }
        })();
      }
    } catch (_) {}
  },

  recordStaffClockIn: (entry: { id: string; staffId: string; tenantId: string; clockIn?: string }) => {
    try {
      const now = entry.clockIn || new Date().toISOString();
      const todayDate = now.split('T')[0];
      const existing = db.prepare(`
        SELECT * FROM attendance 
        WHERE staff_id = ? AND tenant_id = ? AND date = ? AND (clock_out IS NULL OR clock_out = '')
      `).get(entry.staffId, entry.tenantId, todayDate) as any;

      if (!existing) {
        db.prepare(`
          INSERT INTO attendance (id, tenant_id, staff_id, date, clock_in, clock_out, hours_worked, is_late, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?)
        `).run(entry.id, entry.tenantId, entry.staffId, todayDate, now, now, now);

        try {
          const supabase = getSupabase();
          if (supabase && entry.tenantId && entry.tenantId !== 'default-tenant-id') {
            (async () => {
              try {
                await supabase.from('attendance').upsert({
                  id: entry.id,
                  tenant_id: entry.tenantId,
                  staff_id: entry.staffId,
                  date: todayDate,
                  clock_in: now,
                  clock_out: null,
                  hours_worked: null,
                  is_late: 0,
                  created_at: now,
                  updated_at: now
                }, { onConflict: 'id' });
              } catch (err: any) {
                console.warn('Supabase attendance clock-in sync error:', err?.message);
              }
            })();
          }
        } catch (_) {}
      }
    } catch (e) {
      console.error('Error in recordStaffClockIn:', e);
    }
  },

  recordStaffLogout: (staffId: string, tenantId: string) => {
    try {
      const now = new Date().toISOString();
      // 1. Update login_history open record
      const openLogin = db.prepare(`
        SELECT id, login_time FROM login_history 
        WHERE staff_id = ? AND tenant_id = ? AND (logout_time IS NULL OR logout_time = '')
        ORDER BY datetime(login_time) DESC LIMIT 1
      `).get(staffId, tenantId) as any;

      if (openLogin) {
        db.prepare(`
          UPDATE login_history SET logout_time = ? WHERE id = ?
        `).run(now, openLogin.id);

        try {
          const supabase = getSupabase();
          if (supabase && tenantId && tenantId !== 'default-tenant-id') {
            (async () => {
              try {
                await supabase.from('login_history').update({ logout_time: now }).eq('id', openLogin.id);
              } catch (_) {}
            })();
          }
        } catch (_) {}
      }

      // 2. Update attendance open record
      const openAttendance = db.prepare(`
        SELECT id, clock_in FROM attendance 
        WHERE staff_id = ? AND tenant_id = ? AND (clock_out IS NULL OR clock_out = '')
        ORDER BY datetime(created_at) DESC LIMIT 1
      `).get(staffId, tenantId) as any;

      if (openAttendance) {
        let hoursWorked = null;
        if (openAttendance.clock_in) {
          const inTime = new Date(openAttendance.clock_in).getTime();
          const outTime = new Date(now).getTime();
          if (!isNaN(inTime) && !isNaN(outTime) && outTime > inTime) {
            hoursWorked = Math.round(((outTime - inTime) / (1000 * 60 * 60)) * 100) / 100;
          }
        }
        db.prepare(`
          UPDATE attendance SET clock_out = ?, hours_worked = ?, updated_at = ? WHERE id = ?
        `).run(now, hoursWorked, now, openAttendance.id);

        try {
          const supabase = getSupabase();
          if (supabase && tenantId && tenantId !== 'default-tenant-id') {
            (async () => {
              try {
                await supabase.from('attendance').update({
                  clock_out: now,
                  hours_worked: hoursWorked,
                  updated_at: now
                }).eq('id', openAttendance.id);
              } catch (_) {}
            })();
          }
        } catch (_) {}
      }
    } catch (e) {
      console.error('Error in recordStaffLogout:', e);
    }
  },

  getStaffTimestamps: (staffId: string, tenantId: string) => {
    try {
      const historyRows = db.prepare(`
        SELECT * FROM login_history 
        WHERE staff_id = ? AND tenant_id = ?
        ORDER BY datetime(login_time) DESC
      `).all(staffId, tenantId) as any[];

      const attendanceRows = db.prepare(`
        SELECT * FROM attendance 
        WHERE staff_id = ? AND tenant_id = ?
        ORDER BY datetime(created_at) DESC
      `).all(staffId, tenantId) as any[];

      const results: any[] = [];
      const seenTimes = new Set<string>();

      for (const row of historyRows) {
        const timeIn = row.login_time || row.created_at;
        const timeOut = row.logout_time || null;
        const dateStr = timeIn ? timeIn.split('T')[0] : (row.created_at ? row.created_at.split('T')[0] : new Date().toISOString().split('T')[0]);
        let hoursWorked: number | null = null;
        if (timeIn && timeOut) {
          const t1 = new Date(timeIn).getTime();
          const t2 = new Date(timeOut).getTime();
          if (!isNaN(t1) && !isNaN(t2) && t2 > t1) {
            hoursWorked = Math.round(((t2 - t1) / (1000 * 60 * 60)) * 100) / 100;
          }
        }
        const timeKey = `${dateStr}_${timeIn}`;
        seenTimes.add(timeKey);

        results.push({
          id: row.id,
          staffId: row.staff_id,
          date: dateStr,
          timeIn,
          timeOut,
          hoursWorked,
          status: timeOut ? 'Completed' : 'Active',
          deviceInfo: row.device_info || 'Standard Terminal',
          ipAddress: row.ip_address || '',
          source: 'login_history',
          createdAt: row.created_at || timeIn
        });
      }

      for (const att of attendanceRows) {
        const timeIn = att.clock_in || att.created_at;
        const dateStr = att.date || (timeIn ? timeIn.split('T')[0] : '');
        const timeKey = `${dateStr}_${timeIn}`;
        if (!seenTimes.has(timeKey)) {
          const timeOut = att.clock_out || null;
          results.push({
            id: att.id,
            staffId: att.staff_id,
            date: dateStr,
            timeIn,
            timeOut,
            hoursWorked: att.hours_worked ?? null,
            status: timeOut ? 'Completed' : 'Active',
            deviceInfo: 'POS Attendance',
            ipAddress: '',
            source: 'attendance',
            createdAt: att.created_at || timeIn
          });
        }
      }

      results.sort((a, b) => {
        const tA = new Date(a.timeIn || a.createdAt).getTime();
        const tB = new Date(b.timeIn || b.createdAt).getTime();
        return tB - tA;
      });

      return results;
    } catch (e) {
      console.error('Error fetching staff timestamps:', e);
      return [];
    }
  },



  // Auth & Session methods
  getStaffByStaffId: (staffId: string, tenantId?: string) => {
    const sId = (staffId || '').trim();
    if (!sId) return null;
    if (tenantId && tenantId !== 'default-tenant-id') {
      const match = db.prepare('SELECT * FROM staff WHERE (LOWER(staffId) = LOWER(?) OR LOWER(staff_id) = LOWER(?)) AND tenant_id = ?').get(sId, sId, tenantId);
      if (match) return match;
    }
    return db.prepare('SELECT * FROM staff WHERE LOWER(staffId) = LOWER(?) OR LOWER(staff_id) = LOWER(?)').get(sId, sId);
  },

  verifyStaffCredentials: (staffId: string, passkey: string, tenantId?: string) => {
    return dbService.getStaffByStaffId(staffId, tenantId);
  },

  createSession: (session: { id: string; user_id: string; token: string; tenant_id?: string; device_info: string; ip_address: string; created_at: string; last_active_at: string }) => {
    db.prepare(`
      INSERT INTO sessions (id, user_id, tenant_id, token, device_info, ip_address, created_at, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id, session.user_id, session.tenant_id || null, session.token, session.device_info, session.ip_address, session.created_at, session.last_active_at
    );
    return session;
  },

  getSessionByToken: (token: string) => {
    console.log('DB Service: Looking up session for token:', token);
    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
    if (session) {
      console.log('DB Service: Session found for token:', token);
    } else {
      console.warn('DB Service: No session found for token:', token);
    }
    return session;
  },

  getUserSessions: (userId: string) => {
    return db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY last_active_at DESC').all(userId);
  },

  revokeSession: (token: string) => {
    return db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  },

  revokeUserSessions: (userId: string) => {
    return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  },

  updateSessionActivity: (token: string) => {
    const now = new Date().toISOString();
    return db.prepare('UPDATE sessions SET last_active_at = ? WHERE token = ?').run(now, token);
  },
  
  // Admin clear all sessions
  clearAllSessions: () => {
    return db.prepare('DELETE FROM sessions').run();
  },

  cleanupExpiredSessions: (maxAgeHours: number = 24) => {
    // SQLite datetime is in UTC ISO string.
    // We delete sessions where last_active_at < (now - maxAgeHours)
    // SQLite modifiers: '-24 hours'
    return db.prepare(`
      DELETE FROM sessions 
      WHERE datetime(last_active_at) < datetime('now', '-' || ? || ' hours')
    `).run(maxAgeHours);
  },

  // Remittance methods
  createRemittance: (tenantId: string | any, remittance?: any) => {
    const effTenantId = typeof tenantId === 'string' ? tenantId : (remittance?.tenantId || remittance?.tenant_id || null);
    const data = typeof tenantId === 'object' ? tenantId : remittance;
    const stmt = db.prepare(`
      INSERT INTO remittances (id, tenant_id, staff_id, staff_name, amount, transaction_count, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      data.id,
      effTenantId,
      data.staffId || data.staff_id,
      data.staffName || data.staff_name,
      data.amount,
      data.transactionCount || data.transaction_count,
      'pending',
      new Date().toISOString()
    );
    return data;
  },

  getRemittanceById: (tenantId: string | any, id?: string) => {
    const effId = typeof tenantId === 'string' && id ? id : (typeof tenantId === 'string' ? tenantId : id);
    const effTenantId = typeof tenantId === 'string' && id ? tenantId : null;
    return effTenantId 
      ? db.prepare('SELECT * FROM remittances WHERE id = ? AND tenant_id = ?').get(effId, effTenantId)
      : db.prepare('SELECT * FROM remittances WHERE id = ?').get(effId);
  },

  getRemittedSalesForStaff: (tenantId: string | any, staffId?: string) => {
    const effStaffId = typeof tenantId === 'string' && staffId ? staffId : (typeof tenantId === 'string' ? tenantId : staffId);
    const effTenantId = typeof tenantId === 'string' && staffId ? tenantId : null;
    return effTenantId
      ? db.prepare('SELECT id FROM sales WHERE (staffId = ? OR staffId = ?) AND remitted = 1 AND tenant_id = ?').all(effStaffId, effStaffId, effTenantId)
      : db.prepare('SELECT id FROM sales WHERE (staffId = ? OR staffId = ?) AND remitted = 1').all(effStaffId, effStaffId);
  },

  confirmRemittance: (tenantId: string | any, id?: string) => {
    const effId = typeof tenantId === 'string' && id ? id : (typeof tenantId === 'string' ? tenantId : id);
    const effTenantId = typeof tenantId === 'string' && id ? tenantId : null;
    const now = new Date().toISOString();
    
    return db.transaction(() => {
      // Update remittance status
      if (effTenantId) {
        db.prepare(`
          UPDATE remittances 
          SET status = 'confirmed', confirmed_at = ?
          WHERE id = ? AND tenant_id = ?
        `).run(now, effId, effTenantId);
      } else {
        db.prepare(`
          UPDATE remittances 
          SET status = 'confirmed', confirmed_at = ?
          WHERE id = ?
        `).run(now, effId);
      }
      
      const remittance = (effTenantId
        ? db.prepare('SELECT * FROM remittances WHERE id = ? AND tenant_id = ?').get(effId, effTenantId)
        : db.prepare('SELECT * FROM remittances WHERE id = ?').get(effId)) as any;
      if (!remittance) return null;

      // Mark all unremitted sales for this staff as remitted
      if (effTenantId) {
        db.prepare(`
          UPDATE sales 
          SET remitted = 1 
          WHERE (staffId = ? OR staffId = ?) AND remitted = 0 AND tenant_id = ?
        `).run(remittance.staff_id, remittance.staff_id, effTenantId);
      } else {
        db.prepare(`
          UPDATE sales 
          SET remitted = 1 
          WHERE (staffId = ? OR staffId = ?) AND remitted = 0
        `).run(remittance.staff_id, remittance.staff_id);
      }

      return remittance;
    })();
  },

  listPendingRemittances: (tenantId?: string) => {
    return tenantId 
      ? db.prepare("SELECT * FROM remittances WHERE status = 'pending' AND tenant_id = ? ORDER BY created_at DESC").all(tenantId)
      : db.prepare("SELECT * FROM remittances WHERE status = 'pending' ORDER BY created_at DESC").all();
  },

  listConfirmedRemittances: (tenantId?: string) => {
    return tenantId 
      ? db.prepare("SELECT * FROM remittances WHERE status IN ('confirmed', 'completed') AND tenant_id = ? ORDER BY created_at DESC").all(tenantId)
      : db.prepare("SELECT * FROM remittances WHERE status IN ('confirmed', 'completed') ORDER BY created_at DESC").all();
  },

  cancelRemittance: (tenantId: string | any, id?: string) => {
    const effId = typeof tenantId === 'string' && id ? id : (typeof tenantId === 'string' ? tenantId : id);
    const effTenantId = typeof tenantId === 'string' && id ? tenantId : null;
    return db.transaction(() => {
      if (effTenantId) {
        db.prepare(`
          UPDATE remittances 
          SET status = 'cancelled'
          WHERE id = ? AND tenant_id = ?
        `).run(effId, effTenantId);
      } else {
        db.prepare(`
          UPDATE remittances 
          SET status = 'cancelled'
          WHERE id = ?
        `).run(effId);
      }
      
      const remittance = (effTenantId
        ? db.prepare('SELECT * FROM remittances WHERE id = ? AND tenant_id = ?').get(effId, effTenantId)
        : db.prepare('SELECT * FROM remittances WHERE id = ?').get(effId)) as any;
      if (!remittance) return null;

      return remittance;
    })();
  },

  // Notification methods
  createNotification: (tenantId: string | any, notification?: any) => {
    const effTenantId = typeof tenantId === 'string' ? tenantId : (notification?.tenantId || notification?.tenant_id || null);
    const data = typeof tenantId === 'object' ? tenantId : notification;
    const stmt = db.prepare(`
      INSERT INTO notifications (id, tenant_id, user_id, type, message, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const id = randomUUID();
    stmt.run(
      id,
      effTenantId,
      data.userId || data.user_id || null,
      data.type,
      data.message,
      data.data ? JSON.stringify(data.data) : null,
      new Date().toISOString()
    );
    return { id, ...data };
  },

  listNotifications: (tenantId: string | any, userId?: string | null) => {
    const effUserId = typeof tenantId === 'string' ? userId : tenantId;
    const effTenantId = typeof tenantId === 'string' ? tenantId : null;
    if (effTenantId) {
      if (effUserId) {
        return db.prepare('SELECT * FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND tenant_id = ? ORDER BY created_at DESC LIMIT 50').all(effUserId, effTenantId);
      }
      return db.prepare('SELECT * FROM notifications WHERE user_id IS NULL AND tenant_id = ? ORDER BY created_at DESC LIMIT 50').all(effTenantId);
    }
    if (effUserId) {
      return db.prepare('SELECT * FROM notifications WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC LIMIT 50').all(effUserId);
    }
    return db.prepare('SELECT * FROM notifications WHERE user_id IS NULL ORDER BY created_at DESC LIMIT 50').all();
  },

  markNotificationRead: (tenantId: string | any, id?: string) => {
    const effId = typeof tenantId === 'string' && id ? id : (typeof tenantId === 'string' ? tenantId : id);
    const effTenantId = typeof tenantId === 'string' && id ? tenantId : null;
    return effTenantId 
      ? db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND tenant_id = ?').run(effId, effTenantId)
      : db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(effId);
  },

  getUnreadNotificationCount: (tenantId: string | any, userId?: string | null) => {
    const effUserId = typeof tenantId === 'string' ? userId : tenantId;
    const effTenantId = typeof tenantId === 'string' ? tenantId : null;
    if (effTenantId) {
      if (effUserId) {
        const row = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND is_read = 0 AND tenant_id = ?').get(effUserId, effTenantId) as any;
        return row?.count || 0;
      }
      const row = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id IS NULL AND is_read = 0 AND tenant_id = ?').get(effTenantId) as any;
      return row?.count || 0;
    }
    if (effUserId) {
      const row = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND is_read = 0').get(effUserId) as any;
      return row?.count || 0;
    }
    const row = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id IS NULL AND is_read = 0').get() as any;
    return row?.count || 0;
  },

  markAllNotificationsRead: (tenantId: string | any, userId?: string | null) => {
    const effUserId = typeof tenantId === 'string' ? userId : tenantId;
    const effTenantId = typeof tenantId === 'string' ? tenantId : null;
    if (effTenantId) {
      if (effUserId) {
        return db.prepare('UPDATE notifications SET is_read = 1 WHERE (user_id = ? OR user_id IS NULL) AND is_read = 0 AND tenant_id = ?').run(effUserId, effTenantId);
      }
      return db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id IS NULL AND is_read = 0 AND tenant_id = ?').run(effTenantId);
    }
    if (effUserId) {
      return db.prepare('UPDATE notifications SET is_read = 1 WHERE (user_id = ? OR user_id IS NULL) AND is_read = 0').run(effUserId);
    }
    return db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id IS NULL AND is_read = 0').run();
  },

  deleteNotification: (tenantId: string | any, id?: string) => {
    const effId = typeof tenantId === 'string' && id ? id : (typeof tenantId === 'string' ? tenantId : id);
    const effTenantId = typeof tenantId === 'string' && id ? tenantId : null;
    return effTenantId
      ? db.prepare('DELETE FROM notifications WHERE id = ? AND tenant_id = ?').run(effId, effTenantId)
      : db.prepare('DELETE FROM notifications WHERE id = ?').run(effId);
  },

  deleteNotifications: (tenantId: string | string[], ids?: string[]) => {
    const effIds = Array.isArray(tenantId) ? tenantId : (ids || []);
    const effTenantId = typeof tenantId === 'string' ? tenantId : null;
    if (effIds.length === 0) return { changes: 0 };
    const placeholders = effIds.map(() => '?').join(',');
    if (effTenantId) {
      const stmt = db.prepare(`DELETE FROM notifications WHERE id IN (${placeholders}) AND tenant_id = ?`);
      return stmt.run(...effIds, effTenantId);
    }
    const stmt = db.prepare(`DELETE FROM notifications WHERE id IN (${placeholders})`);
    return stmt.run(...effIds);
  },

  // ==============================================
  // Cloud Sync: Push All Data to Supabase
  // ==============================================
  pushAllToCloud: async (tenantId: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not configured');

    console.log('=== Starting full sync to Supabase ===');

    const products = db.prepare('SELECT * FROM products WHERE tenant_id = ?').all(tenantId) as any[];
    if (products.length > 0) {
      for (const p of products) {
        try {
          if (!p.id || !tenantId || !p.name || p.price == null) {
            console.error('[SYNC FAILURE] Skipping product with missing required fields:', {
              productId: p.id,
              tenantId,
              name: p.name,
              price: p.price
            });
            continue;
          }
          const productData = {
            id: String(p.id),
            tenant_id: String(tenantId),
            name: String(p.name || ''),
            price: Number(p.price ?? 0),
            cost: p.cost != null ? Number(p.cost) : null,
            description: p.description != null ? String(p.description) : null,
            category: p.category != null ? String(p.category) : null,
            image: p.image != null ? String(p.image) : null,
            quantity: Number(p.quantity ?? 0),
            barcode: p.barcode != null ? String(p.barcode) : null,
            created_at: String(p.createdAt ?? new Date().toISOString()),
            updated_at: String(p.updatedAt ?? new Date().toISOString())
          };
          const { error: prodError } = await supabase.from('products').upsert(productData, { onConflict: 'id' });
          if (prodError) {
            console.error('[SYNC ERROR] Failed to sync product:', {
              productId: productData.id,
              tenant_id: productData.tenant_id,
              code: prodError.code,
              message: prodError.message,
              details: prodError.details,
              hint: prodError.hint
            });
          }
        } catch (singleProdErr) {
          console.error(`[SYNC] Failed to sync product ${p?.id}`, singleProdErr);
        }
      }
      console.log(`Synced ${products.length} products`);
    }

    const variants = db.prepare('SELECT * FROM variants WHERE tenant_id = ?').all(tenantId) as any[];
    if (variants.length > 0) {
      for (const v of variants) {
        try {
          const product_id = v.productId || v.product_id;
          if (!v.id || !tenantId || !product_id || !v.name || v.price == null) {
            console.error('[SYNC FAILURE] Skipping variant with missing required fields:', {
              variantId: v.id,
              tenantId,
              product_id,
              name: v.name,
              price: v.price
            });
            continue;
          }
          const variantData = {
            id: String(v.id),
            tenant_id: String(tenantId),
            product_id: String(product_id),
            name: String(v.name || ''),
            barcode: v.barcode != null ? String(v.barcode) : null,
            price: Number(v.price ?? 0),
            cost: v.cost != null ? Number(v.cost) : null,
            image: v.image != null ? String(v.image) : null,
            quantity: Number(v.quantity ?? 0),
            created_at: String(v.created_at || v.createdAt || new Date().toISOString()),
            updated_at: String(v.updated_at || v.updatedAt || new Date().toISOString())
          };
          const { error: varError } = await supabase.from('variants').upsert(variantData, { onConflict: 'id' });
          if (varError) {
            console.error('[SYNC ERROR] Failed to sync variant:', {
              variantId: variantData.id,
              tenant_id: variantData.tenant_id,
              code: varError.code,
              message: varError.message,
              details: varError.details,
              hint: varError.hint
            });
          }
        } catch (singleVarErr) {
          console.error(`[SYNC] Failed to sync variant ${v?.id}`, singleVarErr);
        }
      }
      console.log(`Synced ${variants.length} variants`);
    }

    // 3. Sync Staff
    const staff = db.prepare('SELECT * FROM staff WHERE tenant_id = ?').all(tenantId) as any[];
    if (staff.length > 0) {
      for (const s of staff) {
        const cloudStaffData = {
          id: String(s.id),
          tenant_id: String(s.tenant_id || tenantId),
          user_id: s.user_id || s.userId || null,
          first_name: String(s.firstName || s.first_name || 'Staff'),
          middle_name: s.middleName || s.middle_name || null,
          last_name: String(s.lastName || s.last_name || 'Member'),
          name: String(s.name || `${s.firstName || s.first_name || ''} ${s.lastName || s.last_name || ''}`.trim() || 'Staff Member'),
          staff_id: String(s.staffId || s.staff_id || ''),
          passkey: s.passkey || s.passhash || null,
          role: s.role || 'cashier',
          branch: s.branch || null,
          department: s.department || null,
          employment_status: s.employmentStatus || s.employment_status || 'active',
          email: s.email || null,
          phone: s.phone || null,
          address: s.address || null,
          birthdate: s.birthdate || null,
          gender: s.gender || null,
          date_hired: s.dateHired || s.date_hired || null,
          assigned_shift: s.assignedShift || s.assigned_shift || null,
          last_login: s.lastLogin || s.last_login || null,
          password_last_changed: s.passwordLastChanged || s.password_last_changed || null,
          permissions: s.permissions ? (typeof s.permissions === 'string' ? JSON.parse(s.permissions) : s.permissions) : null,
          created_by: s.createdBy || s.created_by || null,
          created_at: s.createdAt || s.created_at || new Date().toISOString(),
          updated_at: s.updatedAt || s.updated_at || new Date().toISOString()
        };

        console.log('[STAFF SYNC] Preparing staff');
        console.log('[STAFF SYNC] staff_id:', cloudStaffData.id);
        console.log('[STAFF SYNC] tenant_id:', cloudStaffData.tenant_id);
        console.log('[STAFF SYNC] user_id:', cloudStaffData.user_id);
        console.log('[STAFF SYNC] name:', cloudStaffData.name);
        console.log('[STAFF SYNC] role:', cloudStaffData.role);

        const { error: staffError } = await supabase.from('staff').upsert(cloudStaffData, { onConflict: 'id' });
        if (staffError) {
          console.error('[STAFF SYNC ERROR]');
          console.error('staff_id:', cloudStaffData.id);
          console.error('tenant_id:', cloudStaffData.tenant_id);
          console.error('code:', staffError.code);
          console.error('message:', staffError.message);
          console.error('details:', staffError.details);
          console.error('hint:', staffError.hint);
        } else {
          console.log('[STAFF SYNC SUCCESS]');
          console.log('staff_id:', cloudStaffData.id);
          console.log('tenant_id:', cloudStaffData.tenant_id);
        }
      }
      console.log(`Synced ${staff.length} staff`);
    }

    const users = db.prepare('SELECT * FROM users WHERE tenant_id = ?').all(tenantId) as any[];
    if (users.length > 0) {
      for (const u of users) {
        try {
          if (!u.id || !tenantId || !u.username || !u.password) {
            console.error('[SYNC FAILURE] Skipping user with missing required fields:', {
              userId: u.id,
              tenantId,
              username: u.username
            });
            continue;
          }
          const userData = {
            id: String(u.id),
            tenant_id: String(tenantId),
            username: String(u.username),
            password: String(u.password),
            role: u.role != null ? String(u.role) : null,
            business_name: u.businessName != null ? String(u.businessName) : null,
            owner_name: u.ownerName != null ? String(u.ownerName) : null,
            mobile: u.mobile != null ? String(u.mobile) : null,
            profile_image: u.profileImage != null ? String(u.profileImage) : null,
            security_question_1: u.securityQuestion1 != null ? String(u.securityQuestion1) : null,
            security_answer_1: u.securityAnswer1 != null ? String(u.securityAnswer1) : null,
            security_question_2: u.securityQuestion2 != null ? String(u.securityQuestion2) : null,
            security_answer_2: u.securityAnswer2 != null ? String(u.securityAnswer2) : null,
            security_question_3: u.securityQuestion3 != null ? String(u.securityQuestion3) : null,
            security_answer_3: u.securityAnswer3 != null ? String(u.securityAnswer3) : null,
            created_at: String(u.createdAt || new Date().toISOString())
          };
          const { error: userError } = await supabase.from('users').upsert(userData, { onConflict: 'id' });
          if (userError) {
            console.error('[SYNC ERROR] Failed to sync user:', {
              userId: userData.id,
              tenant_id: userData.tenant_id,
              code: userError.code,
              message: userError.message,
              details: userError.details,
              hint: userError.hint
            });
          }
        } catch (singleUserErr) {
          console.error(`[SYNC] Failed to sync user ${u?.id}`, singleUserErr);
        }
      }
      console.log(`Synced ${users.length} users`);
    }

    const customers = db.prepare('SELECT * FROM customers WHERE tenant_id = ?').all(tenantId) as any[];
    if (customers.length > 0) {
      for (const c of customers) {
        try {
          if (!c.id || !tenantId || !c.name || !c.phone) {
            console.error('[SYNC FAILURE] Skipping customer with missing required fields:', {
              customerId: c.id,
              tenantId,
              name: c.name,
              phone: c.phone
            });
            continue;
          }
          const customerData = {
            id: String(c.id),
            tenant_id: String(tenantId),
            name: String(c.name || ''),
            phone: String(c.phone || ''),
            address: c.address != null ? String(c.address) : null,
            credit_rating: c.credit_rating != null ? Number(c.credit_rating) : null,
            photo_url: c.photo_url != null ? String(c.photo_url) : null,
            created_at: String(c.created_at || c.createdAt || new Date().toISOString()),
            updated_at: String(c.updated_at || c.updatedAt || new Date().toISOString())
          };
          const { error: custError } = await supabase.from('customers').upsert(customerData, { onConflict: 'id' });
          if (custError) {
            console.error('[SYNC ERROR] Failed to sync customer:', {
              customerId: customerData.id,
              tenant_id: customerData.tenant_id,
              code: custError.code,
              message: custError.message,
              details: custError.details,
              hint: custError.hint
            });
          }
        } catch (singleCustErr) {
          console.error(`[SYNC] Failed to sync customer ${c?.id}`, singleCustErr);
        }
      }
      console.log(`Synced ${customers.length} customers`);
    }

    // 6. Sync Credits (Ledger)
    const credits = db.prepare('SELECT * FROM credits WHERE tenant_id = ?').all(tenantId) as any[];
    if (credits.length > 0) {
      const cloudCredits = credits.map(c => ({
        id: c.id,
        tenant_id: tenantId,
        customer_id: c.customer_id,
        amount: c.amount,
        due_date: c.due_date || null,
        remarks: c.remarks || null,
        created_at: c.created_at || new Date().toISOString()
      }));
      const { error: creditError } = await supabase.from('credits').upsert(cloudCredits, { onConflict: 'id' });
      if (creditError) throw creditError;
      console.log(`Synced ${credits.length} credits`);
    }

    // 7. Sync Payments (Ledger)
    const payments = db.prepare('SELECT * FROM payments WHERE tenant_id = ?').all(tenantId) as any[];
    if (payments.length > 0) {
      const cloudPayments = payments.map(p => ({
        id: p.id,
        tenant_id: tenantId,
        customer_id: p.customer_id,
        amount: p.amount,
        payment_method: p.payment_method,
        remarks: p.remarks || null,
        created_at: p.created_at || new Date().toISOString()
      }));
      const { error: payError } = await supabase.from('payments').upsert(cloudPayments, { onConflict: 'id' });
      if (payError) throw payError;
      console.log(`Synced ${payments.length} payments`);
    }

    // 8. Sync Reminders
    const reminders = db.prepare('SELECT * FROM reminders WHERE tenant_id = ?').all(tenantId) as any[];
    if (reminders.length > 0) {
      const cloudReminders = reminders.map(r => ({
        id: r.id,
        tenant_id: tenantId,
        customer_id: r.customer_id,
        message_type: r.message_type,
        message: r.message,
        status: r.status,
        created_at: r.created_at || new Date().toISOString()
      }));
      const { error: remError } = await supabase.from('reminders').upsert(cloudReminders, { onConflict: 'id' });
      if (remError) throw remError;
      console.log(`Synced ${reminders.length} reminders`);
    }

    // 9. Sync Non-inventory Products
    const nonInvProducts = db.prepare('SELECT * FROM non_inventory_products WHERE tenant_id = ?').all(tenantId) as any[];
    if (nonInvProducts.length > 0) {
      const cloudNonInv = nonInvProducts.map(p => ({
        id: p.id,
        tenant_id: tenantId,
        name: p.name,
        price: p.price,
        category: p.category || null,
        description: p.description || null,
        image: p.image || null,
        barcode: p.barcode,
        barcode_data: p.barcode_data || null,
        created_at: p.created_at || new Date().toISOString(),
        updated_at: p.updated_at || new Date().toISOString()
      }));
      const { error: nonInvError } = await supabase.from('non_inventory_products').upsert(cloudNonInv, { onConflict: 'id' });
      if (nonInvError) throw nonInvError;
      console.log(`Synced ${nonInvProducts.length} non-inventory products`);
    }

    // Helper to validate staff_id against valid cloud staff IDs to avoid foreign key violations
    const getValidStaffIdSet = async () => {
      const validSet = new Set<string>();
      try {
        const { data: cloudStaff } = await supabase.from('staff').select('id, staff_id').eq('tenant_id', tenantId);
        if (cloudStaff) {
          cloudStaff.forEach((s: any) => {
            if (s.id) validSet.add(s.id);
            if (s.staff_id) validSet.add(s.staff_id);
          });
        }
      } catch (e) {
        console.warn('[SYNC STAFF FK CHECK] Failed to fetch cloud staff IDs:', e);
      }
      return validSet;
    };

    // 10. Sync Sales
    const sales = db.prepare('SELECT * FROM sales WHERE tenant_id = ?').all(tenantId) as any[];
    if (sales.length > 0) {
      try {
        const validStaffIds = await getValidStaffIdSet();
        const cloudSales = sales.map(s => {
          const rawStaffId = s.staffId || s.staff_id;
          const validStaffId = rawStaffId && validStaffIds.has(rawStaffId) ? rawStaffId : null;
          return {
            id: String(s.id),
            tenant_id: tenantId,
            total: Number(s.total || 0),
            payment_type: s.paymentType || s.payment_type || 'cash',
            payment_amount: Number(s.paymentAmount || s.payment_amount || 0),
            staff_id: validStaffId,
            remitted: !!s.remitted,
            created_at: s.createdAt || s.created_at || new Date().toISOString()
          };
        });
        const { error: saleError } = await supabase.from('sales').upsert(cloudSales, { onConflict: 'id' });
        if (saleError) {
          console.warn('[SYNC SALES WARNING]', saleError.message);
          const fallbackSales = cloudSales.map(s => ({ ...s, staff_id: null }));
          await supabase.from('sales').upsert(fallbackSales, { onConflict: 'id' });
        }
        console.log(`Synced ${sales.length} sales`);
      } catch (err: any) {
        console.warn('[SYNC SALES EXCEPTION]', err?.message || String(err));
      }
    }

    // 11. Sync Sale Items
    const saleItems = db.prepare('SELECT * FROM sale_items WHERE tenant_id = ?').all(tenantId) as any[];
    if (saleItems.length > 0) {
      try {
        const cloudSaleItems = saleItems.map(i => ({
          id: String(i.id),
          tenant_id: tenantId,
          sale_id: String(i.saleId || i.sale_id),
          product_id: String(i.productId || i.product_id),
          quantity: Number(i.quantity || 0),
          price: Number(i.price || 0),
          unit: i.unit || 'pieces',
          product_name: i.productName || i.product_name || null,
          is_non_inventory: !!(i.isNonInventory || i.is_non_inventory)
        }));
        const { error: itemError } = await supabase.from('sale_items').upsert(cloudSaleItems, { onConflict: 'id' });
        if (itemError) console.warn('[SYNC SALE ITEMS WARNING]', itemError.message);
        else console.log(`Synced ${saleItems.length} sale items`);
      } catch (err: any) {
        console.warn('[SYNC SALE ITEMS EXCEPTION]', err?.message || String(err));
      }
    }

    // 12. Sync Remittances (with FK validation and fallback)
    const remittances = db.prepare('SELECT * FROM remittances WHERE tenant_id = ?').all(tenantId) as any[];
    if (remittances.length > 0) {
      try {
        const validStaffIds = await getValidStaffIdSet();
        const cloudRemittances = remittances.map(r => {
          const rawStaffId = r.staff_id || r.staffId;
          const validStaffId = rawStaffId && validStaffIds.has(rawStaffId) ? rawStaffId : null;
          return {
            id: String(r.id),
            tenant_id: tenantId,
            staff_id: validStaffId,
            staff_name: r.staff_name || r.staffName || 'Staff',
            amount: Number(r.amount || 0),
            transaction_count: Number(r.transaction_count || r.transactionCount || 0),
            status: r.status || 'pending',
            created_at: r.created_at || r.createdAt || new Date().toISOString(),
            confirmed_at: r.confirmed_at || r.confirmedAt || null
          };
        });

        const { error: remitError } = await supabase.from('remittances').upsert(cloudRemittances, { onConflict: 'id' });
        if (remitError) {
          console.warn('[SYNC REMITTANCE WARNING] Upsert failed:', remitError.message, '- retrying with sanitized staff_id=null');
          const fallbackRemittances = cloudRemittances.map(r => ({ ...r, staff_id: null }));
          const { error: fbErr } = await supabase.from('remittances').upsert(fallbackRemittances, { onConflict: 'id' });
          if (fbErr) {
            console.error('[SYNC REMITTANCE ERROR] Fallback remittance sync failed:', fbErr.message);
          } else {
            console.log(`Synced ${remittances.length} remittances (with sanitized staff_id=null)`);
          }
        } else {
          console.log(`Synced ${remittances.length} remittances`);
        }
      } catch (err: any) {
        console.warn('[SYNC REMITTANCE EXCEPTION]', err?.message || String(err));
      }
    }

    // 13. Sync Notifications
    const notifications = db.prepare('SELECT * FROM notifications WHERE tenant_id = ?').all(tenantId) as any[];
    if (notifications.length > 0) {
      try {
        const cloudNotifications = notifications.map(n => ({
          id: String(n.id),
          tenant_id: tenantId,
          user_id: n.user_id || n.userId || null,
          type: n.type || 'system',
          message: String(n.message || ''),
          data: n.data || null,
          is_read: !!(n.is_read || n.isRead),
          created_at: n.created_at || n.createdAt || new Date().toISOString()
        }));
        const { error: notifError } = await supabase.from('notifications').upsert(cloudNotifications, { onConflict: 'id' });
        if (notifError) console.warn('[SYNC NOTIFICATIONS WARNING]', notifError.message);
        else console.log(`Synced ${notifications.length} notifications`);
      } catch (err: any) {
        console.warn('[SYNC NOTIFICATIONS EXCEPTION]', err?.message || String(err));
      }
    }

    // 14. Sync Settings & Logs
    // 14a. Sync staff attendance
    const attendance = db.prepare('SELECT * FROM attendance WHERE tenant_id = ?').all(tenantId) as any[];
    if (attendance.length > 0) {
      try {
        const validStaffIds = await getValidStaffIdSet();
        const cloudAttendance = attendance.map(a => {
          const rawStaffId = a.staff_id || a.staffId;
          const validStaffId = rawStaffId && validStaffIds.has(rawStaffId) ? rawStaffId : null;
          return {
            id: String(a.id),
            tenant_id: tenantId,
            staff_id: validStaffId,
            date: a.date,
            clock_in: a.clock_in || null,
            clock_out: a.clock_out || null,
            hours_worked: a.hours_worked ?? null,
            is_late: !!a.is_late,
            created_at: a.created_at || new Date().toISOString(),
            updated_at: a.updated_at || new Date().toISOString()
          };
        });
        const { error } = await supabase.from('attendance').upsert(cloudAttendance, { onConflict: 'id' });
        if (error) {
          console.warn('[SYNC ATTENDANCE WARNING]', error.message);
          const fallback = cloudAttendance.map(a => ({ ...a, staff_id: null }));
          await supabase.from('attendance').upsert(fallback, { onConflict: 'id' });
        }
      } catch (err: any) {
        console.warn('[SYNC ATTENDANCE EXCEPTION]', err?.message || String(err));
      }
    }

    // 14b. Sync login history
    const loginHistory = db.prepare('SELECT * FROM login_history WHERE tenant_id = ?').all(tenantId) as any[];
    if (loginHistory.length > 0) {
      try {
        const validStaffIds = await getValidStaffIdSet();
        const cloudLoginHistory = loginHistory.map(l => {
          const rawStaffId = l.staff_id || l.staffId;
          const validStaffId = rawStaffId && validStaffIds.has(rawStaffId) ? rawStaffId : null;
          return {
            id: String(l.id),
            tenant_id: tenantId,
            staff_id: validStaffId,
            device_info: l.device_info || null,
            ip_address: l.ip_address || null,
            login_time: l.login_time,
            logout_time: l.logout_time || null,
            created_at: l.created_at || new Date().toISOString()
          };
        });
        const { error } = await supabase.from('login_history').upsert(cloudLoginHistory, { onConflict: 'id' });
        if (error) {
          console.warn('[SYNC LOGIN HISTORY WARNING]', error.message);
          const fallback = cloudLoginHistory.map(l => ({ ...l, staff_id: null }));
          await supabase.from('login_history').upsert(fallback, { onConflict: 'id' });
        }
      } catch (err: any) {
        console.warn('[SYNC LOGIN HISTORY EXCEPTION]', err?.message || String(err));
      }
    }

    // 14c. Sync staff audit history
    const auditLogs = db.prepare('SELECT * FROM audit_logs WHERE tenant_id = ?').all(tenantId) as any[];
    if (auditLogs.length > 0) {
      try {
        const validStaffIds = await getValidStaffIdSet();
        const cloudAuditLogs = auditLogs.map(a => {
          const rawStaffId = a.staff_id || a.staffId;
          const validStaffId = rawStaffId && validStaffIds.has(rawStaffId) ? rawStaffId : null;
          return {
            id: String(a.id),
            tenant_id: tenantId,
            admin_id: a.admin_id || null,
            admin_name: a.admin_name || null,
            action: a.action,
            staff_id: validStaffId,
            staff_name: a.staff_name || null,
            changed_fields: a.changed_fields || null,
            old_values: a.old_values || null,
            new_values: a.new_values || null,
            ip_address: a.ip_address || null,
            created_at: a.created_at || new Date().toISOString()
          };
        });
        const { error } = await supabase.from('audit_logs').upsert(cloudAuditLogs, { onConflict: 'id' });
        if (error) {
          console.warn('[SYNC AUDIT LOGS WARNING]', error.message);
          const fallback = cloudAuditLogs.map(a => ({ ...a, staff_id: null }));
          await supabase.from('audit_logs').upsert(fallback, { onConflict: 'id' });
        }
      } catch (err: any) {
        console.warn('[SYNC AUDIT LOGS EXCEPTION]', err?.message || String(err));
      }
    }

    // 14d. Sync settings
    const settings = db.prepare('SELECT * FROM settings').all() as any[];
    if (settings.length > 0) {
      const cloudSettings = settings.map(s => ({
        id: randomUUID(),
        tenant_id: tenantId,
        key: s.key,
        value: s.value,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));
      const { error: setError } = await supabase.from('settings').upsert(cloudSettings, { onConflict: 'tenant_id,key' });
      if (setError) throw setError;
      console.log(`Synced ${settings.length} settings`);
    }

    // 14e. Sync bulk inventory transactions
    const biTx = db.prepare('SELECT * FROM bulk_inventory_transactions WHERE tenant_id = ?').all(tenantId) as any[];
    if (biTx.length > 0) {
      const cloudBITx = biTx.map(t => ({
        id: t.id,
        tenant_id: tenantId,
        reference_number: t.reference_number,
        created_by: t.created_by,
        supplier_company: t.supplier_company,
        total_items: t.total_items ?? 0,
        total_units: t.total_units ?? 0,
        total_cost: t.total_cost ?? 0,
        notes: t.notes,
        status: t.status ?? 'completed',
        idempotency_key: t.idempotency_key,
        created_at: t.createdAt || t.created_at || new Date().toISOString(),
        updated_at: t.updatedAt || t.updated_at || new Date().toISOString()
      }));
      const { error: bitErr } = await supabase.from('bulk_inventory_transactions').upsert(cloudBITx, { onConflict: 'id' });
      if (bitErr) throw bitErr;
      console.log(`Synced ${biTx.length} bulk inventory transactions`);
    }

    // 14f. Sync bulk inventory items
    const biItems = db.prepare('SELECT * FROM bulk_inventory_items WHERE tenant_id = ?').all(tenantId) as any[];
    if (biItems.length > 0) {
      const cloudBIItems = biItems.map(i => ({
        id: i.id,
        tenant_id: tenantId,
        bulk_inventory_id: i.bulk_inventory_id,
        product_id: i.product_id,
        variant_id: i.variant_id,
        barcode: i.barcode,
        product_name_snapshot: i.product_name_snapshot,
        description_snapshot: i.description_snapshot,
        quantity: i.quantity,
        cost_snapshot: i.cost_snapshot ?? 0,
        selling_price_snapshot: i.selling_price_snapshot ?? 0,
        supplier_company_override: i.supplier_company_override,
        notes: i.notes,
        price_cost_update_confirmed: i.price_cost_update_confirmed ?? 0,
        created_at: i.createdAt || i.created_at || new Date().toISOString()
      }));
      const { error: biiErr } = await supabase.from('bulk_inventory_items').upsert(cloudBIItems, { onConflict: 'id' });
      if (biiErr) throw biiErr;
      console.log(`Synced ${biItems.length} bulk inventory items`);
    }

    console.log('=== Full sync to Supabase complete ===');
    return { success: true, message: 'All data pushed to Supabase' };
  },

  // ==============================================
  // Cloud Sync: Pull All Data from Supabase
  // ==============================================
  pullAllFromCloud: async (tenantId: string) => {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase not configured');

    const _pullStart = Date.now();
    console.log('[PULL START] tenant_id=' + tenantId + ' trigger=pullAllFromCloud');
    console.log('=== Starting full sync from Supabase ===');

    // 1. Pull Products
    try {
      const { data: cloudProducts, error: prodError } = await supabase.from('products').select('*').eq('tenant_id', tenantId);
      if (prodError) throw prodError;
      const _n = cloudProducts?.length ?? 0;
      console.log('[PULL PRODUCTS] rows=' + _n);
      if (_n > 0) {
        dbService.saveProducts(cloudProducts.map(p => ({
          id: p.id,
          name: p.name,
          price: p.price,
          cost: p.cost,
          barcode: p.barcode,
          category: p.category,
          image: p.image,
          quantity: p.quantity,
          createdAt: p.created_at,
          updatedAt: p.updated_at
        })), tenantId);
        console.log('[LOCAL SYNC] entity=products rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} products`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=products tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 2. Pull Variants
    try {
      const { data: cloudVariants, error: varError } = await supabase.from('variants').select('*').eq('tenant_id', tenantId);
      if (varError) throw varError;
      const _n = cloudVariants?.length ?? 0;
      console.log('[PULL VARIANTS] rows=' + _n);
      if (_n > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO variants 
          (id, tenant_id, product_id, name, barcode, price, cost, image, quantity, created_at, updated_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((variants: any[]) => {
          for (const v of variants) {
            insert.run(v.id, tenantId, v.product_id, v.name, v.barcode, v.price, v.cost, v.image, v.quantity, v.created_at, v.updated_at);
          }
        })(cloudVariants);
        console.log('[LOCAL SYNC] entity=variants rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} variants`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=variants tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 3. Pull Staff
    try {
      const { data: cloudStaff, error: staffError } = await supabase.from('staff').select('*').eq('tenant_id', tenantId);
      if (staffError) throw staffError;
      const _n = cloudStaff?.length ?? 0;
      console.log('[PULL STAFF] rows=' + _n);
      if (_n > 0) {
        await dbService.saveStaff(cloudStaff.map(s => ({
          id: s.id,
          tenantId: s.tenant_id,
          userId: s.user_id,
          firstName: s.first_name || '',
          middleName: s.middle_name || null,
          lastName: s.last_name || '',
          name: s.name,
          staffId: s.staff_id,
          passkey: s.passkey || s.passhash,
          role: s.role || 'cashier',
          branch: s.branch || null,
          department: s.department || null,
          employmentStatus: s.employment_status || 'active',
          email: s.email || null,
          phone: s.phone || null,
          address: s.address || null,
          birthdate: s.birthdate || null,
          gender: s.gender || null,
          dateHired: s.date_hired || null,
          assignedShift: s.assigned_shift || null,
          lastLogin: s.last_login || null,
          passwordLastChanged: s.password_last_changed || null,
          permissions: s.permissions || [],
          createdBy: s.created_by,
          createdAt: s.created_at,
          updatedAt: s.updated_at
        })), tenantId);
        console.log('[LOCAL SYNC] entity=staff rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} staff`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=staff tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 4. Pull Users (Admins)
    try {
      const { data: cloudUsers, error: userError } = await supabase.from('users').select('*').eq('tenant_id', tenantId);
      if (userError) throw userError;
      const _n = cloudUsers?.length ?? 0;
      console.log('[PULL USERS] rows=' + _n);
      if (_n > 0) {
        for (const u of cloudUsers) {
          dbService.saveAdmin({
            id: u.id,
            tenantId: u.tenant_id,
            username: u.username,
            password: u.password,
            role: u.role,
            businessName: u.business_name,
            ownerName: u.owner_name,
            mobile: u.mobile,
            profileImage: u.profile_image,
            securityQuestion1: u.security_question_1,
            securityAnswer1: u.security_answer_1,
            securityQuestion2: u.security_question_2,
            securityAnswer2: u.security_answer_2,
            securityQuestion3: u.security_question_3,
            securityAnswer3: u.security_answer_3,
            createdAt: u.created_at
          });
        }
        console.log('[LOCAL SYNC] entity=users rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} users`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=users tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 5. Pull Customers
    try {
      const { data: cloudCustomers, error: custError } = await supabase.from('customers').select('*').eq('tenant_id', tenantId);
      if (custError) throw custError;
      const _n = cloudCustomers?.length ?? 0;
      console.log('[PULL CUSTOMERS] rows=' + _n);
      if (_n > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO customers 
          (id, tenant_id, name, phone, address, credit_rating, photo_url, created_at, updated_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((customers: any[]) => {
          for (const c of customers) {
            insert.run(c.id, tenantId, c.name, c.phone, c.address, c.credit_rating, c.photo_url, c.created_at, c.updated_at);
          }
        })(cloudCustomers);
        console.log('[LOCAL SYNC] entity=customers rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} customers`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=customers tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 6. Pull Credits
    try {
      const { data: cloudCredits, error: creditError } = await supabase.from('credits').select('*').eq('tenant_id', tenantId);
      if (creditError) throw creditError;
      const _n = cloudCredits?.length ?? 0;
      console.log('[PULL CREDITS] rows=' + _n);
      if (_n > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO credits 
          (id, tenant_id, customer_id, amount, due_date, remarks, created_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((credits: any[]) => {
          for (const c of credits) {
            insert.run(c.id, tenantId, c.customer_id, c.amount, c.due_date, c.remarks, c.created_at);
          }
        })(cloudCredits);
        console.log('[LOCAL SYNC] entity=credits rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} credits`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=credits tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 7. Pull Payments
    try {
      const { data: cloudPayments, error: payError } = await supabase.from('payments').select('*').eq('tenant_id', tenantId);
      if (payError) throw payError;
      const _n = cloudPayments?.length ?? 0;
      console.log('[PULL PAYMENTS] rows=' + _n);
      if (_n > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO payments 
          (id, tenant_id, customer_id, amount, payment_method, remarks, created_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((payments: any[]) => {
          for (const p of payments) {
            insert.run(p.id, tenantId, p.customer_id, p.amount, p.payment_method, p.remarks, p.created_at);
          }
        })(cloudPayments);
        console.log('[LOCAL SYNC] entity=payments rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} payments`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=payments tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 8. Pull Reminders
    try {
      const { data: cloudReminders, error: remError } = await supabase.from('reminders').select('*').eq('tenant_id', tenantId);
      if (remError) throw remError;
      const _n = cloudReminders?.length ?? 0;
      console.log('[PULL REMINDERS] rows=' + _n);
      if (_n > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO reminders 
          (id, tenant_id, customer_id, message_type, message, status, created_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((reminders: any[]) => {
          for (const r of reminders) {
            insert.run(r.id, tenantId, r.customer_id, r.message_type, r.message, r.status, r.created_at);
          }
        })(cloudReminders);
        console.log('[LOCAL SYNC] entity=reminders rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} reminders`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=reminders tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 9. Pull Non-inventory Products
    try {
      const { data: cloudNonInv, error: nonInvError } = await supabase.from('non_inventory_products').select('*').eq('tenant_id', tenantId);
      if (nonInvError) throw nonInvError;
      const _n = cloudNonInv?.length ?? 0;
      console.log('[PULL NON_INVENTORY] rows=' + _n);
      if (_n > 0) {
        dbService.saveNonInventoryProducts(cloudNonInv.map(p => ({
          id: p.id,
          name: p.name,
          price: p.price,
          category: p.category,
          description: p.description,
          image: p.image,
          barcode: p.barcode,
          barcodeData: p.barcode_data,
          createdAt: p.created_at,
          updatedAt: p.updated_at
        })), tenantId);
        console.log('[LOCAL SYNC] entity=non_inventory_products rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} non-inventory products`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=non_inventory_products tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 10. Pull Sales
    try {
      const { data: cloudSales, error: saleError } = await supabase.from('sales').select('*').eq('tenant_id', tenantId);
      if (saleError) throw saleError;
      const _n = cloudSales?.length ?? 0;
      console.log('[PULL SALES] rows=' + _n);
      if (_n > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO sales 
          (id, tenant_id, total, paymentType, paymentAmount, staffId, remitted, createdAt) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((sales: any[]) => {
          for (const s of sales) {
            const payType = s.payment_type || s.paymentType || 'cash';
            const payAmount = Number(s.payment_amount || s.paymentAmount || s.total || 0);
            const stfId = s.staff_id || s.staffId || null;
            const createdAt = s.created_at || s.createdAt || new Date().toISOString();
            insert.run(s.id, tenantId, Number(s.total || 0), payType, payAmount, stfId, s.remitted ? 1 : 0, createdAt);
          }
        })(cloudSales);
        console.log('[LOCAL SYNC] entity=sales rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} sales`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=sales tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 11. Pull Sale Items
    try {
      const { data: cloudSaleItems, error: itemError } = await supabase.from('sale_items').select('*').eq('tenant_id', tenantId);
      if (itemError) throw itemError;
      const _n = cloudSaleItems?.length ?? 0;
      console.log('[PULL SALE_ITEMS] rows=' + _n);
      if (_n > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO sale_items 
          (id, tenant_id, saleId, productId, quantity, price, unit, productName, isNonInventory) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((items: any[]) => {
          for (const i of items) {
            const saleId = i.sale_id || i.saleId || '';
            const prodId = i.product_id || i.productId || null;
            const prodName = i.product_name || i.productName || 'Product';
            const isNonInv = i.is_non_inventory || i.isNonInventory ? 1 : 0;
            insert.run(i.id, tenantId, saleId, prodId, Number(i.quantity || 1), Number(i.price || 0), i.unit || null, prodName, isNonInv);
          }
        })(cloudSaleItems);
        console.log('[LOCAL SYNC] entity=sale_items rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} sale items`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=sale_items tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 11a. Pull Expenses
    try {
      const { data: cloudExpenses, error: expErr } = await supabase.from('expenses').select('*').eq('tenant_id', tenantId);
      if (!expErr && cloudExpenses && cloudExpenses.length > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO expenses
          (id, tenant_id, category, description, amount, date, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((rows: any[]) => {
          for (const r of rows) {
            insert.run(r.id, tenantId, r.category || 'General', r.description || '', Number(r.amount || 0), r.date || r.created_at, r.created_at || new Date().toISOString(), r.updated_at || r.created_at);
          }
        })(cloudExpenses);
        console.log('[LOCAL SYNC] entity=expenses rows_saved=' + cloudExpenses.length);
      }
    } catch (e: any) {
      console.warn('[PULL WARNING] entity=expenses tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
    }

    // 11b. Pull Purchases
    try {
      const { data: cloudPurchases, error: purErr } = await supabase.from('purchases').select('*').eq('tenant_id', tenantId);
      if (!purErr && cloudPurchases && cloudPurchases.length > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO purchases
          (id, tenant_id, supplier_name, item_name, quantity, total_cost, date, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((rows: any[]) => {
          for (const r of rows) {
            insert.run(r.id, tenantId, r.supplier_name || r.supplierName || 'Supplier', r.item_name || r.itemName || 'Item', Number(r.quantity || 1), Number(r.total_cost || r.totalCost || 0), r.date || r.created_at, r.created_at || new Date().toISOString(), r.updated_at || r.created_at);
          }
        })(cloudPurchases);
        console.log('[LOCAL SYNC] entity=purchases rows_saved=' + cloudPurchases.length);
      }
    } catch (e: any) {
      console.warn('[PULL WARNING] entity=purchases tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
    }

    // 11c. Pull Creditors
    try {
      const { data: cloudCreditors, error: credErr } = await supabase.from('creditors').select('*').eq('tenant_id', tenantId);
      if (!credErr && cloudCreditors && cloudCreditors.length > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO creditors
          (id, tenant_id, name, phone, address, amount_owed, due_date, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((rows: any[]) => {
          for (const r of rows) {
            insert.run(r.id, tenantId, r.name, r.phone || '', r.address || '', Number(r.amount_owed || r.amountOwed || 0), r.due_date || r.dueDate || null, r.status || 'unpaid', r.created_at || new Date().toISOString(), r.updated_at || r.created_at);
          }
        })(cloudCreditors);
        console.log('[LOCAL SYNC] entity=creditors rows_saved=' + cloudCreditors.length);
      }
    } catch (e: any) {
      console.warn('[PULL WARNING] entity=creditors tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
    }

    // 12. Pull Remittances
    try {
      const { data: cloudRemittances, error: remitError } = await supabase.from('remittances').select('*').eq('tenant_id', tenantId);
      if (remitError) throw remitError;
      const _n = cloudRemittances?.length ?? 0;
      console.log('[PULL REMITTANCES] rows=' + _n);
      if (_n > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO remittances 
          (id, tenant_id, staff_id, staff_name, amount, transaction_count, status, created_at, confirmed_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((remittances: any[]) => {
          for (const r of remittances) {
            insert.run(r.id, tenantId, r.staff_id, r.staff_name, r.amount, r.transaction_count, r.status, r.created_at, r.confirmed_at);
          }
        })(cloudRemittances);
        console.log('[LOCAL SYNC] entity=remittances rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} remittances`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=remittances tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 13. Pull Notifications
    try {
      const { data: cloudNotifications, error: notifError } = await supabase.from('notifications').select('*').eq('tenant_id', tenantId);
      if (notifError) throw notifError;
      const _n = cloudNotifications?.length ?? 0;
      console.log('[PULL NOTIFICATIONS] rows=' + _n);
      if (_n > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO notifications 
          (id, tenant_id, user_id, type, message, data, is_read, created_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((notifs: any[]) => {
          for (const n of notifs) {
            insert.run(n.id, tenantId, n.user_id, n.type, n.message, n.data, n.is_read ? 1 : 0, n.created_at);
          }
        })(cloudNotifications);
        console.log('[LOCAL SYNC] entity=notifications rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} notifications`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=notifications tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 14. Pull Settings
    // 14a. Pull staff attendance
    try {
      const { data: cloudAttendance, error: attendanceError } = await supabase.from('attendance').select('*').eq('tenant_id', tenantId);
      if (attendanceError) throw attendanceError;
      const _n = cloudAttendance?.length ?? 0;
      console.log('[PULL ATTENDANCE] rows=' + _n);
      if (_n > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO attendance
          (id, tenant_id, staff_id, date, clock_in, clock_out, hours_worked, is_late, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((rows: any[]) => rows.forEach(a => insert.run(a.id, tenantId, a.staff_id, a.date, a.clock_in, a.clock_out, a.hours_worked, a.is_late ? 1 : 0, a.created_at, a.updated_at)))(cloudAttendance);
        console.log('[LOCAL SYNC] entity=attendance rows_received=' + _n + ' rows_saved=' + _n);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=attendance tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 14b. Pull login history
    try {
      const { data: cloudLoginHistory, error: loginHistoryError } = await supabase.from('login_history').select('*').eq('tenant_id', tenantId);
      if (loginHistoryError) throw loginHistoryError;
      const _n = cloudLoginHistory?.length ?? 0;
      console.log('[PULL LOGIN_HISTORY] rows=' + _n);
      if (_n > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO login_history
          (id, tenant_id, staff_id, device_info, ip_address, login_time, logout_time, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((rows: any[]) => rows.forEach(l => insert.run(l.id, tenantId, l.staff_id, l.device_info, l.ip_address, l.login_time, l.logout_time, l.created_at)))(cloudLoginHistory);
        console.log('[LOCAL SYNC] entity=login_history rows_received=' + _n + ' rows_saved=' + _n);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=login_history tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 14c. Pull staff audit history
    try {
      const { data: cloudAuditLogs, error: auditError } = await supabase.from('audit_logs').select('*').eq('tenant_id', tenantId);
      if (auditError) throw auditError;
      const _n = cloudAuditLogs?.length ?? 0;
      console.log('[PULL AUDIT_LOGS] rows=' + _n);
      if (_n > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO audit_logs
          (id, tenant_id, admin_id, admin_name, action, staff_id, staff_name, changed_fields, old_values, new_values, ip_address, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((rows: any[]) => rows.forEach(a => insert.run(a.id, tenantId, a.admin_id, a.admin_name, a.action, a.staff_id, a.staff_name, a.changed_fields, a.old_values, a.new_values, a.ip_address, a.created_at)))(cloudAuditLogs);
        console.log('[LOCAL SYNC] entity=audit_logs rows_received=' + _n + ' rows_saved=' + _n);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=audit_logs tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 14d. Pull settings
    try {
      const { data: cloudSettings, error: setError } = await supabase.from('settings').select('*').eq('tenant_id', tenantId);
      if (setError) throw setError;
      const _n = cloudSettings?.length ?? 0;
      console.log('[PULL SETTINGS] rows=' + _n);
      if (_n > 0) {
        const settingsObj: Record<string, any> = {};
        for (const s of cloudSettings) {
          try {
            settingsObj[s.key] = JSON.parse(s.value);
          } catch {
            settingsObj[s.key] = s.value;
          }
        }
        dbService.upsertSettings(tenantId, settingsObj);
        console.log('[LOCAL SYNC] entity=settings rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} settings`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=settings tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 15. Pull Bulk Inventory Transactions
    try {
      const { data: cloudBITx, error: bitErr } = await supabase.from('bulk_inventory_transactions').select('*').eq('tenant_id', tenantId);
      if (bitErr) throw bitErr;
      const _n = cloudBITx?.length ?? 0;
      console.log('[PULL BULK_INV_TX] rows=' + _n);
      if (_n > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO bulk_inventory_transactions
          (id, tenant_id, reference_number, created_by, supplier_company, total_items, total_units, total_cost, notes, status, idempotency_key, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((rows: any[]) => {
          for (const r of rows) {
            insert.run(
              r.id,
              tenantId,
              r.reference_number,
              r.created_by,
              r.supplier_company,
              r.total_items ?? 0,
              r.total_units ?? 0,
              r.total_cost ?? 0,
              r.notes,
              r.status ?? 'completed',
              r.idempotency_key,
              r.created_at,
              r.updated_at
            );
          }
        })(cloudBITx);
        console.log('[LOCAL SYNC] entity=bulk_inventory_transactions rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} bulk inventory transactions`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=bulk_inventory_transactions tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    // 16. Pull Bulk Inventory Items
    try {
      const { data: cloudBIItems, error: biiErr } = await supabase.from('bulk_inventory_items').select('*').eq('tenant_id', tenantId);
      if (biiErr) throw biiErr;
      const _n = cloudBIItems?.length ?? 0;
      console.log('[PULL BULK_INV_ITEMS] rows=' + _n);
      if (_n > 0) {
        const insert = db.prepare(`
          INSERT OR REPLACE INTO bulk_inventory_items
          (id, tenant_id, bulk_inventory_id, product_id, variant_id, barcode, product_name_snapshot, description_snapshot, quantity, cost_snapshot, selling_price_snapshot, supplier_company_override, notes, price_cost_update_confirmed, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction((rows: any[]) => {
          for (const r of rows) {
            insert.run(
              r.id,
              tenantId,
              r.bulk_inventory_id,
              r.product_id,
              r.variant_id,
              r.barcode,
              r.product_name_snapshot,
              r.description_snapshot,
              r.quantity,
              r.cost_snapshot ?? 0,
              r.selling_price_snapshot ?? 0,
              r.supplier_company_override,
              r.notes,
              r.price_cost_update_confirmed ?? 0,
              r.created_at
            );
          }
        })(cloudBIItems);
        console.log('[LOCAL SYNC] entity=bulk_inventory_items rows_received=' + _n + ' rows_saved=' + _n);
        console.log(`Pulled ${_n} bulk inventory items`);
      }
    } catch (e: any) {
      console.error('[PULL ERROR] entity=bulk_inventory_items tenant_id=' + tenantId + ' error=' + (e?.message || String(e)));
      throw e;
    }

    const _pullDur = Date.now() - _pullStart;
    console.log('[PULL COMPLETE] tenant_id=' + tenantId + ' duration_ms=' + _pullDur);
    console.log('=== Full sync from Supabase complete ===');
    return { success: true, message: 'All data pulled from Supabase', duration_ms: _pullDur };
  },

  getBoundTenantId: async (): Promise<string | null> => {
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('device_bound_tenant_id') as any;
      const boundId = row && row.value ? String(row.value) : null;

      // If bound tenant ID exists, verify whether active tenant / user exists in Supabase Cloud or local SQLite
      if (boundId) {
        if (useCloud()) {
          try {
            const supabase = getSupabase();
            if (supabase) {
              const { data: cloudUsers } = await supabase.from('users').select('id, tenant_id').eq('tenant_id', boundId);
              const { data: cloudTenants } = await supabase.from('tenants').select('id').eq('id', boundId);
              
              if ((!cloudUsers || cloudUsers.length === 0) && (!cloudTenants || cloudTenants.length === 0)) {
                console.log(`[DEVICE UNBIND] Bound tenant ${boundId} was deleted in Supabase Cloud. Automatically unbinding device!`);
                dbService.clearBoundTenantId();
                return null;
              }
            }
          } catch (cloudErr) {
            console.warn('[DEVICE UNBIND CHECK] Failed to query Supabase cloud:', cloudErr);
          }
        }

        const localAdmin = db.prepare('SELECT id FROM users WHERE tenant_id = ?').get(boundId);
        if (!localAdmin) {
          const anyAdmin = db.prepare('SELECT tenant_id FROM users WHERE role = ? LIMIT 1').get('admin') as any;
          if (!anyAdmin) {
            dbService.clearBoundTenantId();
            return null;
          }
        }
        return boundId;
      }

      // Check fallback first admin in local SQLite
      const firstAdmin = db.prepare('SELECT tenant_id FROM users WHERE role = ? LIMIT 1').get('admin') as any;
      if (firstAdmin && firstAdmin.tenant_id) return String(firstAdmin.tenant_id);
      return null;
    } catch {
      return null;
    }
  },

  clearBoundTenantId: () => {
    interface UnbindDiagnostics {
      purgedTables: string[];
      skippedTables: string[];
      rowsDeletedPerTable: Record<string, number>;
      tenantScopeId: string | null;
      totalRowsDeleted: number;
    }

    const diagnostics: UnbindDiagnostics = {
      purgedTables: [],
      skippedTables: [],
      rowsDeletedPerTable: {},
      tenantScopeId: null,
      totalRowsDeleted: 0,
    };

    try {
      const boundRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('device_bound_tenant_id') as any;
      const boundTenantId: string | null = boundRow?.value ? String(boundRow.value) : null;
      diagnostics.tenantScopeId = boundTenantId;

      const businessTables = [
        'products', 'variants', 'staff', 'sales', 'sale_items', 'expenses', 'purchases',
        'creditors', 'non_inventory_products', 'remittances', 'notifications', 'customers',
        'credits', 'payments', 'reminders', 'bulk_inventory_transactions',
        'bulk_inventory_items', 'pending_bulk_submissions', 'staff_logins',
        'security_questions'
      ];

      for (const table of businessTables) {
        try {
          const info = db.prepare(`DELETE FROM ${table}`).run();
          diagnostics.purgedTables.push(table);
          const rows = Number(info?.changes ?? 0);
          diagnostics.rowsDeletedPerTable[table] = rows;
          diagnostics.totalRowsDeleted += rows;
        } catch (tblErr: any) {
          diagnostics.skippedTables.push(table);
          console.warn(`[DEVICE UNBIND WARN] Could not purge table ${table}:`, tblErr?.message || String(tblErr));
        }
      }

      try {
        const settingsInfo = db.prepare('DELETE FROM settings').run();
        diagnostics.purgedTables.push('settings');
        const rows = Number(settingsInfo?.changes ?? 0);
        diagnostics.rowsDeletedPerTable['settings'] = rows;
        diagnostics.totalRowsDeleted += rows;
      } catch (sErr: any) {
        diagnostics.skippedTables.push('settings');
        console.warn('[DEVICE UNBIND WARN] Could not purge settings table:', sErr?.message || String(sErr));
      }

      try {
        const usersInfo = db.prepare('DELETE FROM users').run();
        diagnostics.purgedTables.push('users');
        const rows = Number(usersInfo?.changes ?? 0);
        diagnostics.rowsDeletedPerTable['users'] = rows;
        diagnostics.totalRowsDeleted += rows;
      } catch (uErr: any) {
        diagnostics.skippedTables.push('users');
        console.warn('[DEVICE UNBIND WARN] Could not purge users table:', uErr?.message || String(uErr));
      }

      try {
        const sessionsInfo = db.prepare('DELETE FROM sessions').run();
        diagnostics.purgedTables.push('sessions');
        const rows = Number(sessionsInfo?.changes ?? 0);
        diagnostics.rowsDeletedPerTable['sessions'] = rows;
        diagnostics.totalRowsDeleted += rows;
      } catch (sessErr: any) {
        diagnostics.skippedTables.push('sessions');
        console.warn('[DEVICE UNBIND WARN] Could not purge sessions table:', sessErr?.message || String(sessErr));
      }

      console.log(
        `[DEVICE UNBIND SUCCESS - FULL WIPE] purgedTables=[${diagnostics.purgedTables.join(', ')}] ` +
        `skippedTables=[${diagnostics.skippedTables.join(', ')}] ` +
        `totalRowsDeleted=${diagnostics.totalRowsDeleted} ` +
        `tenantScopeId=${diagnostics.tenantScopeId}`
      );

      return diagnostics;
    } catch (e: any) {
      console.error('Failed to clear bound tenant ID (full wipe):', e);
      throw e;
    }
  },

  verifyAdminLocalAndCloud: async (username: string, localAdmin: any): Promise<{ matched: boolean; cloudAdmin?: any }> => {
    if (!useCloud()) {
      return { matched: true, cloudAdmin: null };
    }

    const supabase = getSupabase();
    if (!supabase) {
      return { matched: true, cloudAdmin: null };
    }

    try {
      const clean = String(username || '').trim().toLowerCase();
      const cleanDigits = clean.replace(/\D/g, '');
      const localTenantId = localAdmin?.tenant_id || localAdmin?.tenantId;

      let query = supabase.from('users').select('*');
      if (localTenantId && localTenantId !== 'default-tenant-id') {
        query = query.eq('tenant_id', localTenantId);
      }
      const { data: allUsers, error } = await query;

      if (error) {
        console.warn('[verifyAdminLocalAndCloud] Supabase query error:', error);
        return { matched: true, cloudAdmin: null };
      }

      if (!Array.isArray(allUsers) || allUsers.length === 0) {
        return { matched: false, cloudAdmin: undefined };
      }

      const matched = allUsers.find((u: any) => {
        const uName = String(u.username || '').toLowerCase().trim();
        const uMobile = String(u.mobile || '').replace(/\D/g, '');
        const uEmail = String(u.email || '').toLowerCase().trim();
        const uOwner = String(u.owner_name || u.ownerName || '').toLowerCase().trim();
        const uBiz = String(u.business_name || u.businessName || '').toLowerCase().trim();
        return (
          uName === clean ||
          (cleanDigits && uMobile && uMobile === cleanDigits) ||
          (uEmail && uEmail === clean) ||
          (uOwner && uOwner === clean) ||
          (uBiz && uBiz === clean)
        );
      });

      if (!matched) {
        return { matched: false, cloudAdmin: undefined };
      }

      const cloudAdmin = {
        id: String(matched.id),
        tenant_id: matched.tenant_id || matched.tenantId,
        username: matched.username,
        password: matched.password,
        role: matched.role || 'admin',
        businessName: matched.business_name || matched.businessName,
        ownerName: matched.owner_name || matched.ownerName,
        mobile: matched.mobile,
        email: matched.email,
        profileImage: matched.profile_image || matched.profileImage,
        createdAt: matched.created_at || matched.createdAt || new Date().toISOString()
      };

      return { matched: true, cloudAdmin };
    } catch (e: any) {
      console.warn('[verifyAdminLocalAndCloud] Unexpected error, treating as matched (fail-open for offline):', e?.message || String(e));
      return { matched: true, cloudAdmin: null };
    }
  },

  // ================================================================
  // Bulk Inventory — Getters
  // ================================================================
  getBulkInventoryTransactions: (tenantId: string) =>
    db.prepare('SELECT * FROM bulk_inventory_transactions WHERE tenant_id = ? ORDER BY createdAt DESC').all(tenantId),

  getBulkInventoryItemsByTenant: (tenantId: string) =>
    db.prepare('SELECT * FROM bulk_inventory_items WHERE tenant_id = ?').all(tenantId),

  getBulkInventoryHistoryPaginated: (
    tenantId: string,
    opts: { page?: number; size?: number; reference?: string; supplier?: string; productName?: string; dateFrom?: string; dateTo?: string; createdBy?: string }
  ) => {
    const page = Math.max(1, opts.page ?? 1);
    const size = Math.min(200, Math.max(1, opts.size ?? 50));
    const offset = (page - 1) * size;
    const whereClauses: string[] = ['tenant_id = ?'];
    const params: any[] = [tenantId];

    if (opts.reference && opts.reference.trim()) {
      whereClauses.push('reference_number LIKE ?');
      params.push('%' + opts.reference.trim() + '%');
    }
    if (opts.supplier && opts.supplier.trim()) {
      whereClauses.push('supplier_company LIKE ?');
      params.push('%' + opts.supplier.trim() + '%');
    }
    if (opts.createdBy && opts.createdBy.trim()) {
      whereClauses.push('created_by = ?');
      params.push(opts.createdBy.trim());
    }
    if (opts.dateFrom && opts.dateFrom.trim()) {
      whereClauses.push('createdAt >= ?');
      params.push(opts.dateFrom.trim());
    }
    if (opts.dateTo && opts.dateTo.trim()) {
      whereClauses.push('createdAt <= ?');
      params.push(opts.dateTo.trim());
    }

    let productNameJoin = '';
    if (opts.productName && opts.productName.trim()) {
      productNameJoin = `
        AND id IN (
          SELECT bulk_inventory_id FROM bulk_inventory_items
          WHERE tenant_id = ? AND product_name_snapshot LIKE ?
        )`;
      params.push(tenantId, '%' + opts.productName.trim() + '%');
    }

    const sqlWhere = 'WHERE ' + whereClauses.join(' AND ') + productNameJoin;
    const countSql = 'SELECT COUNT(*) as c FROM bulk_inventory_transactions ' + sqlWhere;
    const totalRow: any = db.prepare(countSql).get(...params);
    const total = Number(totalRow?.c ?? 0);

    const rowsSql =
      'SELECT * FROM bulk_inventory_transactions ' +
      sqlWhere +
      ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    const rows = db.prepare(rowsSql).all(...params, size, offset);

    return {
      rows,
      total,
      page,
      size,
      totalPages: Math.ceil(total / size),
    };
  },

  getBulkInventoryById: (tenantId: string, id: string) => {
    const row: any = db.prepare(
      'SELECT * FROM bulk_inventory_transactions WHERE id = ? AND tenant_id = ?'
    ).get(id, tenantId);
    if (!row) return null;
    const items = db.prepare(
      'SELECT * FROM bulk_inventory_items WHERE bulk_inventory_id = ? AND tenant_id = ? ORDER BY createdAt ASC'
    ).all(id, tenantId);
    return { transaction: row, items };
  },

  // Idempotency lookup — return existing tx if already committed
  getBulkInventoryByIdempotencyKey: (tenantId: string, key: string) => {
    const row: any = db.prepare(
      'SELECT * FROM bulk_inventory_transactions WHERE idempotency_key = ? AND tenant_id = ?'
    ).get(key, tenantId);
    if (!row) return null;
    const items = db.prepare(
      'SELECT * FROM bulk_inventory_items WHERE bulk_inventory_id = ? AND tenant_id = ?'
    ).all(row.id, tenantId);
    return { transaction: row, items };
  },

  // ================================================================
  // Bulk Inventory — Atomic commit
  // ================================================================
  // Returns { success, isIdempotentReplay, transaction, items, counts } OR throws
  commitBulkInventory: (args: {
    tenantId: string;
    createdBy: string;
    idempotencyKey: string;
    supplierCompany: string | null | undefined;
    notes: string | null | undefined;
    items: Array<{
      productId: string | null | undefined;
      variantId: string | null | undefined;
      barcode: string;
      boxBarcode?: string | null | undefined;
      pieceBarcode?: string | null | undefined;
      boxCount?: number;
      unitsPerBox?: number;
      costPerBox?: number;
      isIntakeByBox?: boolean;
      productName: string;
      description: string | null | undefined;
      sellingPrice: number;
      cost: number;
      quantity: number;
      supplierCompanyOverride: string | null | undefined;
      notes: string | null | undefined;
      isVariant: boolean;
      isNewProduct: boolean;
      updateProductPriceCost: boolean;
    }>;
  }) => {
    const { tenantId, createdBy, idempotencyKey, supplierCompany, notes, items: inputItems } = args;

    // 1. Fast-fail idempotency check (outside TX to save work)
    const replay = dbService.getBulkInventoryByIdempotencyKey(tenantId, idempotencyKey);
    if (replay) {
      return {
        success: true,
        isIdempotentReplay: true,
        transaction: replay.transaction,
        items: replay.items,
        counts: {
          items: replay.items.length,
          units: (replay.items as any[]).reduce((a, b) => a + Number(b.quantity || 0), 0),
          newProducts: 0,
          updatedProducts: 0,
          totalCost: Number(replay.transaction.total_cost || 0),
        }
      };
    }

    // 2. Cross-tenant ownership validation BEFORE transaction (fail fast)
    for (let i = 0; i < inputItems.length; i++) {
      const line = inputItems[i];
      if (line.productId && !line.isNewProduct) {
        const p: any = db.prepare(
          'SELECT id, name, quantity, price, cost FROM products WHERE id = ? AND tenant_id = ?'
        ).get(line.productId, tenantId);
        if (!p) {
          throw Object.assign(
            new Error('PRODUCT_NOT_OWNED: product_id ' + line.productId + ' not owned by tenant at line ' + (i + 1)),
            { code: 403, fieldIndex: i, field: 'productId' }
          );
        }
      }
      if (line.variantId) {
        const v: any = db.prepare(
          'SELECT id, product_id, quantity, price, cost FROM variants WHERE id = ? AND tenant_id = ?'
        ).get(line.variantId, tenantId);
        if (!v) {
          throw Object.assign(
            new Error('VARIANT_NOT_OWNED: variant_id ' + line.variantId + ' not owned by tenant at line ' + (i + 1)),
            { code: 403, fieldIndex: i, field: 'variantId' }
          );
        }
      }
    }

    // 3. Internal duplicate detection: same product/variant targeted twice in same batch
    const seenTargets = new Map<string, number>();
    for (let i = 0; i < inputItems.length; i++) {
      const line = inputItems[i];
      let key = null;
      if (line.isVariant && line.variantId) key = 'v:' + line.variantId;
      else if (line.productId && !line.isNewProduct) key = 'p:' + line.productId;
      if (key) {
        if (seenTargets.has(key)) {
          throw Object.assign(
            new Error('DUPLICATE_TARGET: Line ' + (i + 1) + ' targets same ' + (line.isVariant ? 'variant' : 'product') + ' as line ' + (seenTargets.get(key)! + 1) + '. Merge quantities manually.'),
            { code: 400, fieldIndex: i, field: 'productId' }
          );
        }
        seenTargets.set(key, i);
      }
    }

    // 4. Reference number generation (tenant-scoped sequential per calendar year)
    const now = new Date();
    const year = now.getFullYear();
    const seqRow: any = db.prepare(
      `SELECT CAST(COALESCE(MAX(CAST(SUBSTR(reference_number, INSTR(reference_number, '-', 4) + 1) AS INTEGER)), 0) AS INTEGER) AS maxSeq
       FROM bulk_inventory_transactions
       WHERE tenant_id = ? AND reference_number LIKE ?`
    ).get(tenantId, `BI-${year}-%`);
    const nextSeq = Number(seqRow?.maxSeq || 0) + 1;
    const referenceNumber = `BI-${year}-${String(nextSeq).padStart(5, '0')}`;

    const transactionId = crypto.randomUUID ? crypto.randomUUID() : randomUUID();
    const createdAt = now.toISOString();

    // Compute totals
    let totalUnits = 0;
    let totalCost = 0;
    for (const l of inputItems) {
      totalUnits += Number(l.quantity || 0);
      totalCost += Number(l.quantity || 0) * Number(l.cost || 0);
    }

    const txInsert = db.prepare(`
      INSERT INTO bulk_inventory_transactions
      (id, tenant_id, reference_number, created_by, supplier_company, total_items, total_units, total_cost, notes, status, idempotency_key, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)
    `);
    const itemInsert = db.prepare(`
      INSERT INTO bulk_inventory_items
      (id, tenant_id, bulk_inventory_id, product_id, variant_id, barcode, box_barcode, piece_barcode, box_count, units_per_box, cost_per_box, product_name_snapshot, description_snapshot, quantity, cost_snapshot, selling_price_snapshot, supplier_company_override, notes, price_cost_update_confirmed, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateProductQty = db.prepare(
      'UPDATE products SET quantity = quantity + ?, updatedAt = ? WHERE id = ? AND tenant_id = ?'
    );
    const updateProductQtyAndPrice = db.prepare(
      'UPDATE products SET quantity = quantity + ?, price = ?, cost = ?, updatedAt = ? WHERE id = ? AND tenant_id = ?'
    );
    const updateVariantQty = db.prepare(
      'UPDATE variants SET quantity = quantity + ?, updated_at = ? WHERE id = ? AND tenant_id = ?'
    );
    const updateVariantQtyAndPrice = db.prepare(
      'UPDATE variants SET quantity = quantity + ?, price = ?, cost = ?, updated_at = ? WHERE id = ? AND tenant_id = ?'
    );
    const insertProduct = db.prepare(`
      INSERT INTO products (id, tenant_id, name, barcode, box_barcode, units_per_box, box_cost, price, cost, description, quantity, category, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Uncategorized', ?, ?)
    `);

    // 5. Atomic transaction
    let newProducts = 0;
    let updatedProducts = 0;
    const finalItems: any[] = [];

    const doCommit = db.transaction(() => {
      txInsert.run(
        transactionId, tenantId, referenceNumber, createdBy,
        supplierCompany || null, inputItems.length, totalUnits, totalCost,
        notes || null, idempotencyKey, createdAt, createdAt
      );

      for (let i = 0; i < inputItems.length; i++) {
        const line = inputItems[i];
        let finalProductId = line.productId || null;
        let finalVariantId = line.variantId || null;
        const pieceBarcode = line.pieceBarcode || line.barcode || null;
        const boxBarcode = line.boxBarcode || null;
        const unitsPerBox = Number(line.unitsPerBox || 1);
        const costPerBox = Number(line.costPerBox || 0);
        const boxCount = Number(line.boxCount || 0);

        // (a) Brand new product creation
        if (line.isNewProduct && !line.productId) {
          const newId = crypto.randomUUID ? crypto.randomUUID() : randomUUID();
          insertProduct.run(
            newId, tenantId,
            line.productName,
            pieceBarcode,
            boxBarcode,
            unitsPerBox,
            costPerBox,
            Number(line.sellingPrice || 0),
            Number(line.cost || 0),
            line.description || null,
            Number(line.quantity || 0),
            createdAt, createdAt
          );
          finalProductId = newId;
          newProducts++;
          updatedProducts++;
        } else if (line.isVariant && finalVariantId) {
          // (b) Existing variant: increment quantity, optionally price/cost/box fields
          if (boxBarcode) {
            db.prepare(`
              UPDATE variants 
              SET quantity = quantity + ?, price = CASE WHEN ? = 1 THEN ? ELSE price END, cost = CASE WHEN ? = 1 THEN ? ELSE cost END, box_barcode = ?, units_per_box = ?, box_cost = ?, updated_at = ?
              WHERE id = ? AND tenant_id = ?
            `).run(
              Number(line.quantity || 0),
              line.updateProductPriceCost ? 1 : 0,
              Number(line.sellingPrice || 0),
              line.updateProductPriceCost ? 1 : 0,
              Number(line.cost || 0),
              boxBarcode,
              unitsPerBox,
              costPerBox,
              createdAt,
              finalVariantId, tenantId
            );
          } else if (line.updateProductPriceCost) {
            updateVariantQtyAndPrice.run(
              Number(line.quantity || 0),
              Number(line.sellingPrice || 0),
              Number(line.cost || 0),
              createdAt,
              finalVariantId, tenantId
            );
          } else {
            updateVariantQty.run(
              Number(line.quantity || 0),
              createdAt,
              finalVariantId, tenantId
            );
          }
          updatedProducts++;
        } else if (finalProductId) {
          // (c) Existing product: increment quantity, optionally price/cost/box fields
          if (boxBarcode) {
            db.prepare(`
              UPDATE products 
              SET quantity = quantity + ?, price = CASE WHEN ? = 1 THEN ? ELSE price END, cost = CASE WHEN ? = 1 THEN ? ELSE cost END, box_barcode = ?, units_per_box = ?, box_cost = ?, updatedAt = ?
              WHERE id = ? AND tenant_id = ?
            `).run(
              Number(line.quantity || 0),
              line.updateProductPriceCost ? 1 : 0,
              Number(line.sellingPrice || 0),
              line.updateProductPriceCost ? 1 : 0,
              Number(line.cost || 0),
              boxBarcode,
              unitsPerBox,
              costPerBox,
              createdAt,
              finalProductId, tenantId
            );
          } else if (line.updateProductPriceCost) {
            updateProductQtyAndPrice.run(
              Number(line.quantity || 0),
              Number(line.sellingPrice || 0),
              Number(line.cost || 0),
              createdAt,
              finalProductId, tenantId
            );
          } else {
            updateProductQty.run(
              Number(line.quantity || 0),
              createdAt,
              finalProductId, tenantId
            );
          }
          updatedProducts++;
        }

        // (d) Immutable snapshot item row
        const itemId = crypto.randomUUID ? crypto.randomUUID() : randomUUID();
        const finalSupplierOverride = line.supplierCompanyOverride && line.supplierCompanyOverride.trim()
          ? line.supplierCompanyOverride.trim()
          : (supplierCompany || null);
        itemInsert.run(
          itemId, tenantId, transactionId,
          finalProductId, finalVariantId,
          line.barcode || null,
          boxBarcode,
          pieceBarcode,
          boxCount,
          unitsPerBox,
          costPerBox,
          line.productName,
          line.description || null,
          Number(line.quantity || 0),
          Number(line.cost || 0),
          Number(line.sellingPrice || 0),
          finalSupplierOverride,
          line.notes || null,
          line.updateProductPriceCost ? 1 : 0,
          createdAt
        );

        finalItems.push({
          id: itemId,
          tenantId,
          bulkInventoryId: transactionId,
          productId: finalProductId,
          variantId: finalVariantId,
          barcode: line.barcode || null,
          boxBarcode,
          pieceBarcode,
          boxCount,
          unitsPerBox,
          costPerBox,
          productNameSnapshot: line.productName,
          descriptionSnapshot: line.description || null,
          quantity: Number(line.quantity || 0),
          costSnapshot: Number(line.cost || 0),
          sellingPriceSnapshot: Number(line.sellingPrice || 0),
          supplierCompanyOverride: finalSupplierOverride,
          notes: line.notes || null,
          priceCostUpdateConfirmed: line.updateProductPriceCost ? 1 : 0,
          createdAt,
        });
      }
    });

    try {
      doCommit();
    } catch (txErr: any) {
      // SQLite UNIQUE constraint on idempotency_key = racing concurrent submit
      if (txErr && String(txErr.message || '').includes('UNIQUE constraint failed: bulk_inventory_transactions.idempotency_key')) {
        const existing = dbService.getBulkInventoryByIdempotencyKey(tenantId, idempotencyKey);
        if (existing) {
          return {
            success: true,
            isIdempotentReplay: true,
            transaction: existing.transaction,
            items: existing.items,
            counts: {
              items: existing.items.length,
              units: (existing.items as any[]).reduce((a, b) => a + Number(b.quantity || 0), 0),
              newProducts: 0,
              updatedProducts: 0,
              totalCost: Number(existing.transaction.total_cost || 0),
            }
          };
        }
      }
      throw txErr;
    }

    // 6. Re-read committed header
    const committedTx = db.prepare(
      'SELECT * FROM bulk_inventory_transactions WHERE id = ? AND tenant_id = ?'
    ).get(transactionId, tenantId);

    return {
      success: true,
      isIdempotentReplay: false,
      transaction: committedTx,
      items: finalItems,
      counts: {
        items: inputItems.length,
        units: totalUnits,
        newProducts,
        updatedProducts,
        totalCost,
      }
    };
  },

  setBoundTenantId: (tenantId: string) => {
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      stmt.run('device_bound_tenant_id', tenantId);
      console.log(`[DEVICE LOCK] System bound to tenant_id: ${tenantId}`);
    } catch (e) {
      console.error('Failed to set bound tenant ID:', e);
    }
  }
};

export default dbService;
