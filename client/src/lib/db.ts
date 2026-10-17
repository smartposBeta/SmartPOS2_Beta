import Dexie, { Table } from 'dexie';
import bcrypt from 'bcryptjs';
import type {
    User, Product, Sale, Staff, CartItem, SaleItem, Expense, Purchase, Creditor, Variant, NonInventoryProduct, Remittance, Notification,
    BulkInventoryTransaction, BulkInventoryItem, BulkLineInput, BulkInventorySubmitInput
} from '@shared/schema';
import { getUnitMultiplier } from './utils';
import api from './api';

// Helper function for generating UUIDs in browser environment
function generateUUID() {
  // Check if crypto.randomUUID is available
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  
  // Fallback implementation for browsers without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Optimized password hashing for browser environment
async function hashPassword(password: string): Promise<string> {
  try {
    // Use a lower cost factor for better performance in browser
    return await bcrypt.hash(password, 8);
  } catch (error) {
    console.error('Error hashing password:', error);
    throw new Error('Failed to hash password');
  }
}

// Optimized password verification for browser environment
async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    console.error('Error verifying password:', error);
    return false;
  }
}

export class SmartPOSDB extends Dexie {
  users!: Table<User>;
  products!: Table<Product>;
  sales!: Table<Sale>;
  saleItems!: Table<SaleItem>;
  staff!: Table<Staff>;
  expenses!: Table<Expense>;
  purchases!: Table<Purchase>;
  creditors!: Table<Creditor>;
  variants!: Table<Variant>;
  nonInventoryProducts!: Table<NonInventoryProduct>;
  remittances!: Table<Remittance>;
  notifications!: Table<Notification>;
  bulkInventoryTransactions!: Table<any>;
  bulkInventoryItems!: Table<any>;
  pendingBulkSubmissions!: Table<any>;

  constructor() {
    super('SmartPOSDB');
    this.version(1).stores({
      users: 'id, username, email, mobile, role, staffId',
      products: 'id, &barcode, name, category',
      sales: 'id, staffId, createdAt',
      saleItems: 'id, saleId, productId',
      staff: 'id, &staffId, name, createdBy',
      expenses: 'id, description, category, date',
      purchases: 'id, productName, date',
      creditors: 'id, name, dueDate, isPaid',
    });
    this.version(3).stores({
      users: 'id, username, email, mobile, role, staffId',
      products: 'id, &barcode, name, category',
      sales: 'id, staffId, createdAt',
      saleItems: 'id, saleId, productId',
      staff: 'id, &staffId, name, createdBy',
      expenses: 'id, description, category, date',
      purchases: 'id, productName, date, supplier',
      creditors: 'id, name, dueDate, isPaid',
      variants: 'id, productId, name, barcode',
      nonInventoryProducts: 'id, &barcode, name, category',
    });
    this.version(4).stores({
      users: 'id, username, email, mobile, role, staffId',
      products: 'id, &barcode, name, category',
      sales: 'id, staffId, createdAt',
      saleItems: 'id, saleId, productId',
      staff: 'id, &staffId, name, createdBy',
      expenses: 'id, description, category, date',
      purchases: 'id, productName, date, supplier',
      creditors: 'id, name, dueDate, isPaid',
      variants: 'id, productId, name, barcode',
      nonInventoryProducts: 'id, &barcode, name, category',
      remittances: 'id, staffId, status, createdAt',
      notifications: 'id, type, isRead, createdAt'
    });
    this.version(5).stores({
      users: 'id, username, email, mobile, role, staffId',
      products: 'id, &barcode, name, category',
      sales: 'id, staffId, createdAt, remitted',
      saleItems: 'id, saleId, productId',
      staff: 'id, &staffId, name, createdBy',
      expenses: 'id, description, category, date',
      purchases: 'id, productName, date, supplier',
      creditors: 'id, name, dueDate, isPaid',
      variants: 'id, productId, name, barcode',
      nonInventoryProducts: 'id, &barcode, name, category',
      remittances: 'id, staffId, status, createdAt',
      notifications: 'id, type, isRead, createdAt'
    });
    this.version(6).stores({
      users: 'id, username, email, mobile, role, staffId',
      products: 'id, &barcode, name, category',
      sales: 'id, staffId, createdAt, remitted',
      saleItems: 'id, saleId, productId',
      staff: 'id, &staffId, name, firstName, lastName, role, employmentStatus, email, branch, createdBy',
      expenses: 'id, description, category, date',
      purchases: 'id, productName, date, supplier',
      creditors: 'id, name, dueDate, isPaid',
      variants: 'id, productId, name, barcode',
      nonInventoryProducts: 'id, &barcode, name, category',
      remittances: 'id, staffId, status, createdAt',
      notifications: 'id, type, isRead, createdAt'
    });
    this.version(7).stores({
      users: 'id, username, email, mobile, role, staffId',
      products: 'id, &barcode, name, category',
      sales: 'id, staffId, createdAt, remitted',
      saleItems: 'id, saleId, productId',
      staff: 'id, &staffId, name, firstName, lastName, role, employmentStatus, email, branch, createdBy',
      expenses: 'id, description, category, date',
      purchases: 'id, productName, date, supplier',
      creditors: 'id, name, dueDate, isPaid',
      variants: 'id, productId, name, barcode',
      nonInventoryProducts: 'id, &barcode, name, category',
      remittances: 'id, staffId, status, createdAt',
      notifications: 'id, type, isRead, createdAt',
      bulkInventoryTransactions: 'id, tenantId, referenceNumber, createdAt, status',
      bulkInventoryItems: 'id, bulkInventoryId, tenantId, productId, barcode',
      pendingBulkSubmissions: 'id, createdAt, tenantId, status',
    });
    this.version(8).stores({
      users: 'id, username, email, mobile, role, staffId',
      products: 'id, &barcode, boxBarcode, name, category',
      sales: 'id, staffId, createdAt, remitted',
      saleItems: 'id, saleId, productId',
      staff: 'id, &staffId, name, firstName, lastName, role, employmentStatus, email, branch, createdBy',
      expenses: 'id, description, category, date',
      purchases: 'id, productName, date, supplier',
      creditors: 'id, name, dueDate, isPaid',
      variants: 'id, productId, name, barcode, boxBarcode',
      nonInventoryProducts: 'id, &barcode, name, category',
      remittances: 'id, staffId, status, createdAt',
      notifications: 'id, type, isRead, createdAt',
      bulkInventoryTransactions: 'id, tenantId, referenceNumber, createdAt, status',
      bulkInventoryItems: 'id, bulkInventoryId, tenantId, productId, barcode, boxBarcode, pieceBarcode',
      pendingBulkSubmissions: 'id, createdAt, tenantId, status',
    });
  }

  async resetDatabase() {
    await this.delete();
    await this.open();
  }
}

export const db = new SmartPOSDB();

// Notification Service
let lowStockCheckRunning = false;

export const NotificationService = {
  async list(): Promise<Notification[]> {
    try {
      return await api.get<Notification[]>('/api/notifications');
    } catch (e) {
      console.warn('Failed to fetch notifications from server, using local data', e);
      return await db.notifications.orderBy('createdAt').reverse().toArray();
    }
  },
  async getUnreadCount(): Promise<number> {
    try {
      const res = await api.get<{ count: number }>('/api/notifications/unread-count');
      return res.count;
    } catch {
      return await db.notifications.where('isRead').equals(0).count();
    }
  },
  async markAsRead(id: string): Promise<void> {
    try {
      await api.patch(`/api/notifications/${id}/read`, {});
    } catch {}
    await db.notifications.update(id, { isRead: true });
  },
  async markAllAsRead(): Promise<void> {
    try {
      await api.patch('/api/notifications/mark-all-read', {});
    } catch {}
    await db.notifications.where('isRead').equals(0).modify({ isRead: true });
  },
  async delete(id: string): Promise<void> {
    try {
      await api.delete(`/api/notifications/${id}`);
    } catch {}
    await db.notifications.delete(id);
  },
  async deleteMany(ids: string[]): Promise<void> {
    try {
      await api.post('/api/notifications/delete-many', { ids });
    } catch {}
    await db.notifications.bulkDelete(ids);
  },
  async saveLocally(notification: Notification): Promise<void> {
    await db.notifications.put(notification);
  },
  async checkAndGenerateLowStockAlerts(tenantId?: string): Promise<Notification[]> {
    if (lowStockCheckRunning) return [];
    lowStockCheckRunning = true;
    try {
      const effectiveTenant = tenantId || localStorage.getItem('smartpos_tenant_id') || '';
      const [allProducts, allVariants, localNotifications, remoteNotifications] = await Promise.all([
        db.products.toArray(),
        db.variants.toArray(),
        db.notifications.toArray(),
        this.list()
      ]);

      const existingNotifs = Array.from(new Map(
        [...localNotifications, ...remoteNotifications].map(notification => [notification.id, notification])
      ).values());
      const createdAlerts: Notification[] = [];
      const productNames = new Map(allProducts.map(product => [product.id, product.name]));
      const stockByKey = new Map<string, { productId: string; variantId?: string; productName: string; quantity: number }>();

      for (const product of allProducts) {
        if (effectiveTenant && product.tenantId && product.tenantId !== effectiveTenant) continue;
        stockByKey.set(`product:${product.id}`, {
          productId: product.id,
          productName: product.name,
          quantity: Number(product.quantity ?? 0)
        });
      }
      for (const variant of allVariants) {
        if (effectiveTenant && variant.tenantId && variant.tenantId !== effectiveTenant) continue;
        stockByKey.set(`variant:${variant.id}`, {
          productId: variant.productId,
          variantId: variant.id,
          productName: `${productNames.get(variant.productId) || 'Product'} (${variant.name})`,
          quantity: Number(variant.quantity ?? 0)
        });
      }

      const activeAlertKeys = new Set<string>();
      for (const notification of existingNotifs) {
        if (notification.type !== 'inventory_alert') continue;
        if (effectiveTenant && notification.tenantId && notification.tenantId !== effectiveTenant) continue;
        try {
          const data = typeof notification.data === 'string' ? JSON.parse(notification.data) : notification.data;
          let key = data?.variantId
            ? `variant:${data.variantId}`
            : data?.productId
              ? `product:${data.productId}`
              : null;
          if (data?.type !== 'low_stock' && !data?.productId && !data?.variantId) continue;
          if (!key && data?.productName) {
            key = Array.from(stockByKey.entries()).find(([, stock]) =>
              stock.productName === data.productName || notification.message.includes(`"${stock.productName}"`)
            )?.[0] || null;
          }
          if (!key) continue;
          const currentStock = stockByKey.get(key);
          if (!currentStock || currentStock.quantity > 20 || activeAlertKeys.has(key)) {
            await this.delete(notification.id);
            continue;
          }

          activeAlertKeys.add(key);
          if (data.quantity !== currentStock.quantity || data.productName !== currentStock.productName) {
            const isOutOfStock = currentStock.quantity <= 0;
            const updated = {
              ...notification,
              message: `${isOutOfStock ? 'Out of stock' : 'Low stock'}: ${currentStock.productName} (${currentStock.quantity} pieces remaining)`,
              data: JSON.stringify({
                ...data,
                productId: currentStock.productId,
                variantId: currentStock.variantId,
                productName: currentStock.productName,
                quantity: currentStock.quantity,
                isOutOfStock,
                type: 'low_stock'
              }),
              isRead: false
            };
            await db.notifications.put(updated);
            Object.assign(notification, updated);
            try {
              await api.patch(`/api/notifications/${notification.id}`, updated);
            } catch {}
          }
        } catch {}
      }

      // Check standard products
      for (const prod of allProducts) {
        if (effectiveTenant && prod.tenantId && prod.tenantId !== effectiveTenant) continue;
        const qty = Number(prod.quantity ?? 0);
        if (qty <= 20) {
          if (activeAlertKeys.has(`product:${prod.id}`)) continue;
          const isOutOfStock = qty <= 0;
          const msg = isOutOfStock
            ? `🚨 Out of Stock: "${prod.name}" has 0 units remaining! Restock needed.`
            : `⚠️ Low Stock Alert: "${prod.name}" is running low (${qty} unit${qty === 1 ? '' : 's'} left).`;

          // Deduplicate
          const newNotif: Notification = {
            id: generateUUID(),
            tenantId: effectiveTenant,
            userId: null,
            type: 'inventory_alert',
            message: msg,
            data: JSON.stringify({
              productId: prod.id,
              productName: prod.name,
              quantity: qty,
              isOutOfStock,
              type: 'low_stock'
            }),
            isRead: false,
            createdAt: new Date()
          } as any;

          await db.notifications.put(newNotif);
          activeAlertKeys.add(`product:${prod.id}`);
          createdAlerts.push(newNotif);
          try {
            await api.post('/api/notifications', newNotif);
          } catch {}
        }
      }

      // Check variants
      const prodMap = productNames;
      for (const variant of allVariants) {
        if (effectiveTenant && variant.tenantId && variant.tenantId !== effectiveTenant) continue;
        const qty = Number(variant.quantity ?? 0);
        if (qty <= 20) {
          if (activeAlertKeys.has(`variant:${variant.id}`)) continue;
          const isOutOfStock = qty <= 0;
          const parentName = prodMap.get(variant.productId) || 'Product';
          const fullName = `${parentName} (${variant.name})`;
          const msg = isOutOfStock
            ? `🚨 Out of Stock: "${fullName}" has 0 units remaining! Restock needed.`
            : `⚠️ Low Stock Alert: "${fullName}" is running low (${qty} unit${qty === 1 ? '' : 's'} left).`;

          const newNotif: Notification = {
            id: generateUUID(),
            tenantId: effectiveTenant,
            userId: null,
            type: 'inventory_alert',
            message: msg,
            data: JSON.stringify({
              productId: variant.productId,
              variantId: variant.id,
              productName: fullName,
              quantity: qty,
              isOutOfStock,
              type: 'low_stock'
            }),
            isRead: false,
            createdAt: new Date()
          } as any;

          await db.notifications.put(newNotif);
          activeAlertKeys.add(`variant:${variant.id}`);
          createdAlerts.push(newNotif);
          try {
            await api.post('/api/notifications', newNotif);
          } catch {}
        }
      }

      return createdAlerts;
    } catch (err) {
      console.error('Error generating low stock alerts:', err);
      return [];
    } finally {
      lowStockCheckRunning = false;
    }
  }
};

// Remittance Service
export const RemittanceService = {
  async remit(data: { staffId: string; staffName: string; amount: number; transactionCount: number }): Promise<{ success: boolean; remittance: Remittance }> {
    const localRemittance: Remittance = {
      id: generateUUID(),
      tenantId: localStorage.getItem('smartpos_tenant_id') || '',
      staffId: data.staffId,
      staffName: data.staffName,
      amount: data.amount,
      transactionCount: data.transactionCount,
      status: 'pending',
      createdAt: new Date()
    } as any;

    try {
      const res = await api.post<{ success: boolean, remittance: Remittance }>('/api/remit', data);
      if (res && res.success && res.remittance) {
        const mapped = {
          ...res.remittance,
          staffName: (res.remittance as any).staff_name || res.remittance.staffName,
          staffId: (res.remittance as any).staff_id || res.remittance.staffId,
          transactionCount: (res.remittance as any).transaction_count || res.remittance.transactionCount,
          createdAt: (res.remittance as any).created_at ? new Date((res.remittance as any).created_at) : (res.remittance.createdAt ? new Date(res.remittance.createdAt) : new Date())
        };
        await db.remittances.put(mapped);
        return { success: true, remittance: mapped };
      }
    } catch (err) {
      console.warn('[RemittanceService] Server POST /api/remit unreachable or offline, persisting local pending remittance:', err);
    }

    await db.remittances.put(localRemittance);
    return { success: true, remittance: localRemittance };
  },

  async confirm(id: string): Promise<{ success: boolean; remittance: Remittance }> {
    try {
      const res = await api.post<{ success: boolean, remittance: Remittance }>(`/api/remit/confirm/${id}`, {});
      if (res && res.success) {
        await db.remittances.update(id, { status: 'confirmed', confirmedAt: new Date() });
      }
    } catch (err) {
      console.warn('[RemittanceService] Server POST /api/remit/confirm offline, updating local remittance:', err);
    }
    await db.remittances.update(id, { status: 'confirmed', confirmedAt: new Date() });
    const updated = await db.remittances.get(id);
    if (updated) {
      const sales = await db.sales.toArray();
      const staffSales = sales.filter(s => s.staffId === updated.staffId && !s.remitted);
      for (const s of staffSales) {
        await db.sales.update(s.id, { remitted: true });
      }
    }
    return { success: true, remittance: updated as any };
  },

  async cancel(id: string): Promise<{ success: boolean; remittance: Remittance }> {
    try {
      const res = await api.post<{ success: boolean, remittance: Remittance }>(`/api/remit/cancel/${id}`, {});
      if (res && res.success) {
        await db.remittances.update(id, { status: 'cancelled' });
      }
    } catch (err) {
      console.warn('[RemittanceService] Server POST /api/remit/cancel offline, updating local remittance:', err);
    }
    await db.remittances.update(id, { status: 'cancelled' });
    const updated = await db.remittances.get(id);
    return { success: true, remittance: updated as any };
  },

  async listPending(): Promise<Remittance[]> {
    try {
      const res = await api.get<Remittance[]>('/api/remittances/pending');
      if (Array.isArray(res)) {
        const mapped = res.map(r => ({
          ...r,
          id: r.id,
          tenantId: (r as any).tenantId || (r as any).tenant_id || '',
          staffName: (r as any).staff_name || r.staffName || 'Staff',
          staffId: (r as any).staff_id || r.staffId || '',
          amount: Number(r.amount || 0),
          transactionCount: Number((r as any).transaction_count || r.transactionCount || 0),
          status: 'pending' as const,
          createdAt: (r as any).created_at ? new Date((r as any).created_at) : (r.createdAt ? new Date(r.createdAt) : new Date()),
          confirmedAt: (r as any).confirmed_at ? new Date((r as any).confirmed_at) : (r.confirmedAt ? new Date(r.confirmedAt) : null)
        }));

        // Purge or update any local Dexie records that are no longer pending on server
        const pendingServerIds = new Set(mapped.map(m => m.id));
        const localPending = await db.remittances.where('status').equals('pending').toArray();
        for (const lp of localPending) {
          if (!pendingServerIds.has(lp.id)) {
            await db.remittances.update(lp.id, { status: 'confirmed' as any });
          }
        }

        if (mapped.length > 0) {
          await db.remittances.bulkPut(mapped);
        }
        return mapped;
      }
    } catch (err) {
      console.warn('[RemittanceService] Failed to fetch pending remittances from server, returning local Dexie remittances:', err);
    }
    return await db.remittances.where('status').equals('pending').toArray();
  },

  async listConfirmed(): Promise<Remittance[]> {
    try {
      let res: Remittance[] = [];
      try {
        res = await api.get<Remittance[]>('/api/remittances/confirmed');
      } catch {
        res = await api.get<Remittance[]>('/api/remittances/completed');
      }
      if (Array.isArray(res)) {
        const mapped = res.map(r => ({
          ...r,
          id: r.id,
          tenantId: (r as any).tenantId || (r as any).tenant_id || '',
          staffName: (r as any).staff_name || r.staffName || 'Staff',
          staffId: (r as any).staff_id || r.staffId || '',
          amount: Number(r.amount || 0),
          transactionCount: Number((r as any).transaction_count || r.transactionCount || 0),
          status: 'confirmed' as const,
          createdAt: (r as any).created_at ? new Date((r as any).created_at) : (r.createdAt ? new Date(r.createdAt) : new Date()),
          confirmedAt: (r as any).confirmed_at ? new Date((r as any).confirmed_at) : (r.confirmedAt ? new Date(r.confirmedAt) : new Date())
        }));
        if (mapped.length > 0) {
          await db.remittances.bulkPut(mapped);
        }
        return mapped;
      }
    } catch (err) {
      console.warn('[RemittanceService] Failed to fetch confirmed remittances from server, returning local Dexie remittances:', err);
    }
    return await db.remittances.where('status').anyOf('confirmed', 'completed').toArray();
  }
};

// NOTE: When running in Electron native mode we'll replace or augment this
// Dexie-backed `db` with a native SQLite adapter via IPC. The migration
// utility and adapter will be added under `electron/` and wired to the
// renderer through the `nativeApi` preload bridge.

// Auth service
export class AuthService {
  static async purgeLocalState(opts?: { skipApiCall?: boolean }): Promise<{ purged: boolean }> {
    if (typeof localStorage !== 'undefined') {
      try {
        Object.keys(localStorage).forEach((k: string) => localStorage.removeItem(k));
      } catch (_fullClearErr) {
        const preserveKeys = new Set<string>([]);
        const removeKeys = Object.keys(localStorage).filter((k: string) =>
          !preserveKeys.has(k)
        ).concat([
          'smartpos_user',
          'smartpos_token',
          'smartpos_tenant_id',
          'smartpos_tenant',
          'smartpos_guest_mode',
          'smartpos_guest_user_id',
          'smartpos_guest_expiry',
          'smartpos_device_mode',
          'smartpos_external_devices',
          'smartpos_default_printer',
          'admin_username',
          'admin_password',
          'admin_remember_me',
          'customer_checker_tenant_id',
          'customer_checker_store_name',
          'routerUrl'
        ]);
        try {
          removeKeys.forEach((k: string) => localStorage.removeItem(k));
        } catch (_e) { /* ignore */ }
      }
    }

    if (typeof sessionStorage !== 'undefined') {
      try {
        Object.keys(sessionStorage).forEach((k: string) => sessionStorage.removeItem(k));
      } catch (_ssErr) { /* ignore */ }
    }

    try {
      await db.delete();
      console.log('[purgeLocalState] Entire Dexie database SmartPOSDB deleted successfully.');
      await db.open();
      console.log('[purgeLocalState] Dexie database SmartPOSDB re-initialized (fresh, empty).');
    } catch (e) {
      console.error('[purgeLocalState] Full Dexie delete+reopen failed, falling back to table-by-table wipe:', e);
      const tablesToWipe = [
        'users', 'staff', 'products', 'variants', 'sales', 'saleItems',
        'expenses', 'purchases', 'creditors', 'nonInventoryProducts',
        'remittances', 'notifications', 'bulkInventoryTransactions',
        'bulkInventoryItems', 'pendingBulkSubmissions'
      ];
      try {
        const validTables = tablesToWipe.filter(t => typeof (db as any)[t] !== 'undefined');
        if (validTables.length > 0) {
          await db.transaction('rw', validTables as any, async () => {
            for (const t of validTables) {
              try { await (db as any)[t].clear(); } catch (_e) { /* per-table silent */ }
            }
          });
        }
      } catch (e2) {
        console.error('[purgeLocalState] Fallback table wipe also failed:', e2);
      }
    }

    if (typeof window !== 'undefined' && 'indexedDB' in window) {
      try {
        const dbs = await (indexedDB as any).databases?.();
        if (Array.isArray(dbs)) {
          for (const entry of dbs) {
            const dbName = entry?.name;
            if (dbName && (dbName === 'SmartPOSDB' || dbName.toLowerCase().includes('smartpos') || dbName.toLowerCase().includes('dexie'))) {
              try {
                const req = indexedDB.deleteDatabase(dbName);
                req.onerror = () => console.warn('[purgeLocalState] Additional IndexedDB cleanup failed for:', dbName);
              } catch (_idbErr) { /* ignore */ }
            }
          }
        }
      } catch (_idbListErr) { /* ignore - older browsers may not support databases() */ }
    }

    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cacheNames = await caches.keys();
        if (Array.isArray(cacheNames) && cacheNames.length > 0) {
          await Promise.allSettled(
            cacheNames.filter(name =>
              name.toLowerCase().includes('smartpos') || name.toLowerCase().includes('workbox') || name.toLowerCase().includes('vite')
            ).map(name => caches.delete(name).catch(() => false))
          );
        }
      } catch (_cacheErr) { /* ignore */ }
    }

    if (!opts?.skipApiCall) {
      try {
        await api.post('/api/tenants/unbind-device', {});
      } catch (apiErr) {
        console.warn('[purgeLocalState] Server unbind API call failed; client state already clean:', apiErr);
      }
    }

    return { purged: true };
  }

  static async createAdmin(userData: {
    businessName: string;
    ownerName: string;
    mobile: string;
    password: string;
  }): Promise<{ user: User, token?: string }> {
    if (typeof localStorage !== 'undefined' && !localStorage.getItem('smartpos_token')) {
      try {
        const localAdminCount = await db.users.where('role').equals('admin').count();
        if (localAdminCount > 0) {
          console.log('[AuthService.createAdmin] Pre-purging stale Dexie admins (post-unbind state detected).');
          await AuthService.purgeLocalState({ skipApiCall: true });
        }
      } catch (purgeErr) {
        console.warn('[AuthService.createAdmin] Pre-purge guard error, continuing:', purgeErr);
      }
    }

    // Check if mobile number is already used
    const existingUser = await db.users.where('mobile').equals(userData.mobile).first();
    if (existingUser) {
      throw new Error('Mobile number already registered');
    }

    // Check if username (mobile) is already used
    const existingUsername = await db.users.where('username').equals(userData.mobile).first();
    if (existingUsername) {
      throw new Error('Username already registered');
    }

    const hashedPassword = await hashPassword(userData.password);
    
    const user: User = {
      id: generateUUID(),
      tenantId: (userData as any).tenantId || generateUUID(),
      username: userData.mobile,
      email: null,
      mobile: userData.mobile,
      password: hashedPassword,
      role: 'admin',
      staffId: null,
      businessName: userData.businessName,
      ownerName: userData.ownerName,
      location: null,
      profileImage: null,
      securityQuestion1: null,
      securityAnswer1: null,
      securityQuestion2: null,
      securityAnswer2: null,
      securityQuestion3: null,
      securityAnswer3: null,
      failedAttemptCount: 0,
      lockoutUntil: null,
      createdAt: new Date(),
    };

    await db.users.add(user);

    // CRITICAL: Push admin to server to lock the system
    let token: string | undefined;
    try {
      const response = await api.post('/api/auth/register-admin', user);
      console.log('Admin account registered on server');
      token = response.token;
    } catch (err) {
      console.error('Failed to register admin on server:', err);
      // Even if server registration fails, we have it locally,
      // but the server will remain open for others until this succeeds.
    }

    return { user, token };
  }

  static async loginAdmin(username: string, password: string): Promise<{ user: User, token?: string, offlineMode?: boolean, staleData?: boolean } | null> {
    const onlineFromNavigator = typeof navigator !== 'undefined' && navigator.onLine;
    let serverReachable = false;
    if (onlineFromNavigator) {
      try {
        const ctrl = new AbortController();
        const timeoutId = setTimeout(() => ctrl.abort(), 3000);
        const getOrigin = () => (typeof window !== 'undefined' ? window.location.origin : '');
        const healthResp = await fetch(getOrigin() + '/api/health', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal
        });
        clearTimeout(timeoutId);
        serverReachable = !!healthResp && healthResp.ok;
      } catch (healthErr) {
        serverReachable = false;
      }
    }
    const isOnline = onlineFromNavigator && serverReachable;

    if (isOnline) {
      console.log('[loginAdmin] ONLINE mode: verifying against server + cloud gate...');
      try {
        const response = await api.post('/api/auth/admin-login', { username, password, verifyAgainstCloud: true });
        if (response && response.user) {
          await db.users.put(response.user);
          return { user: response.user, token: response.token, staleData: !!response.staleData };
        }
        return null;
      } catch (e: any) {
        if (e && (e.code === 'ADMIN_NOT_IN_CLOUD' || (e.message || '').includes('ADMIN_NOT_IN_CLOUD') || (e.error || '').includes('ADMIN_NOT_IN_CLOUD'))) {
          throw new Error('This local admin account is not registered in Supabase Cloud. Please unbind the device first, or connect to the correct tenant.');
        }
        if (e && String(e.status || '') === '401') {
          throw e;
        }
        console.warn('[loginAdmin] ONLINE server login errored (non-denial), falling back to OFFLINE Dexie bcrypt...', e);
      }
    } else {
      console.log('[loginAdmin] OFFLINE mode detected (navigator.onLine=' + onlineFromNavigator + ' health=' + serverReachable + '). Proceeding with local Dexie verify only.');
    }

    const user = await db.users.where('username').equals(username).first() ||
                await db.users.where('mobile').equals(username).first();

    if (user && user.role === 'admin') {
      const isValid = await verifyPassword(password, user.password);
      if (isValid) return { user, offlineMode: true };
    }

    if (!isOnline) return null;
    return null;
  }

  static async loginStaff(staffId: string, passkey: string): Promise<User | null> {
    const sId = (staffId || '').trim().toLowerCase();
    const allStaff = await db.staff.toArray();
    const staffMember = allStaff.find(s => String(s.staffId || (s as any).staff_id || '').trim().toLowerCase() === sId);
    if (!staffMember) return null;
    
    const storedKey = String(staffMember.passkey || (staffMember as any).passhash || '').trim();
    let isValid = false;
    if (storedKey) {
      if (storedKey.startsWith('$2a$') || storedKey.startsWith('$2b$')) {
        isValid = await verifyPassword(passkey.trim(), storedKey);
      } else {
        isValid = (passkey.trim() === storedKey);
      }
    }
    if (!isValid) return null;

    // Return a user-like object for staff
    return {
      id: staffMember.id,
      tenantId: (staffMember as any).tenantId || (staffMember as any).tenant_id || '',
      username: staffMember.name,
      email: '',
      mobile: '',
      password: '',
      role: 'staff' as const,
      staffId: staffMember.staffId,
      businessName: '',
      ownerName: staffMember.name,
      location: null,
      profileImage: null,
      createdAt: staffMember.createdAt,
      securityQuestion1: null,
      securityAnswer1: null,
      securityQuestion2: null,
      securityAnswer2: null,
      securityQuestion3: null,
      securityAnswer3: null,
      failedAttemptCount: 0,
      lockoutUntil: null,
    };
  }

  static async createStaff(staffData: {
    firstName: string;
    middleName?: string;
    lastName: string;
    name: string;
    staffId: string;
    passkey: string;
    role?: string;
    branch?: string;
    department?: string;
    employmentStatus?: string;
    email?: string;
    phone?: string;
    address?: string;
    birthdate?: string;
    gender?: string;
    dateHired?: string;
    assignedShift?: string;
    permissions?: string[];
    createdBy: string;
    tenantId: string;
  }): Promise<Staff> {
    // Check if staff ID already exists
    const existingStaff = await db.staff.where('staffId').equals(staffData.staffId).first();
    if (existingStaff) {
      throw new Error('Staff ID already exists');
    }

    const hashedPasskey = await hashPassword(staffData.passkey);
    
    const staff: any = {
      id: generateUUID(),
      tenantId: staffData.tenantId,
      firstName: staffData.firstName,
      middleName: staffData.middleName || null,
      lastName: staffData.lastName,
      name: staffData.name,
      staffId: staffData.staffId,
      passkey: hashedPasskey,
      role: staffData.role || 'cashier',
      branch: staffData.branch || null,
      department: staffData.department || null,
      employmentStatus: staffData.employmentStatus || 'active',
      email: staffData.email || null,
      phone: staffData.phone || null,
      address: staffData.address || null,
      birthdate: staffData.birthdate || null,
      gender: staffData.gender || null,
      dateHired: staffData.dateHired || null,
      assignedShift: staffData.assignedShift || null,
      permissions: staffData.permissions || [],
      createdBy: staffData.createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await db.staff.add(staff);

    // Attempt to push to server immediately
    try {
      api.post('/api/staff', [staff]).catch(err => console.warn('Background staff sync failed:', err));
    } catch (e) {
      // Ignore sync errors during creation, local save is priority
    }

    return staff;
  }

  static async updateUser(id: string, updates: Partial<User>): Promise<void> {
    await db.users.update(id, updates);
    try {
      await api.post('/api/auth/update-admin', updates);
    } catch (e) {
      console.warn('Failed to sync user updates to server:', e);
    }
  }

  static async updateProfileImage(id: string, profileImage: string): Promise<void> {
    await db.users.update(id, { profileImage });
    try {
      await api.post('/api/auth/update-admin', { profileImage });
    } catch (e) {
      console.warn('Failed to sync profile image to server:', e);
    }
  }

  static async updateStaffPassword(id: string, newPasskey: string): Promise<void> {
    const hashedPasskey = await hashPassword(newPasskey);
    const now = new Date();
    await db.staff.update(id, {
      passkey: hashedPasskey,
      passwordLastChanged: now,
      updatedAt: now
    });
    try {
      await api.put(`/api/staff/${id}/password`, { newPassword: newPasskey, confirmPassword: newPasskey });
    } catch (e) {
      console.warn('Failed to sync staff password update to server:', e);
    }
  }
}

// Product service
export class ProductService {
  static async getAllProducts(): Promise<Product[]> {
    return await db.products.toArray();
  }

  static async getProductById(id: string): Promise<Product | undefined> {
    return await db.products.get(id);
  }

  static async getProductByBarcode(barcode: string): Promise<Product | undefined> {
    return await db.products.where('barcode').equals(barcode).first();
  }

  // Sync all local products to the server database for customer scanning
  static async syncAllProductsToServer(): Promise<boolean> {
    try {
      const products = await db.products.toArray();
      
      // If no products, return success immediately
      if (products.length === 0) {
        console.log('No products to sync');
        return true;
      }
      
      const formattedProducts = products.map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        cost: (p as any).cost ?? 0,
        barcode: p.barcode,
        category: p.category ?? 'general',
        // Minimize image data size - only include if absolutely necessary
        image: null, // Remove image data to reduce payload size
        quantity: p.quantity ?? 0,
        createdAt: (p as any).createdAt instanceof Date ? (p as any).createdAt.toISOString() : new Date().toISOString(),
        updatedAt: (p as any).updatedAt instanceof Date ? (p as any).updatedAt.toISOString() : new Date().toISOString(),
      }));

      // Use smaller chunks to avoid "request entity too large" errors
      const CHUNK_SIZE = 3; // Reduced from 10 to 3
      let allSuccess = true;
      
      // Process products in smaller chunks
      for (let i = 0; i < formattedProducts.length; i += CHUNK_SIZE) {
        const chunk = formattedProducts.slice(i, i + CHUNK_SIZE);
        
        try {
          await api.post('/api/products', chunk);
          console.log(`Successfully synced products ${i+1}-${i+chunk.length} of ${formattedProducts.length}`);
        } catch (error) {
          console.error(`Network error syncing chunk ${i}-${i+chunk.length}:`, error);
          allSuccess = false;
        }
        
        // Add a small delay between chunks to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Sync variants as well
      await ProductService.syncVariantsToServer();

      return allSuccess;
    } catch (error) {
      console.error('Error syncing products to server:', error);
      return false;
    }
  }

  // Sync all local variants to the server database
  static async syncVariantsToServer(): Promise<boolean> {
    try {
      const variants = await db.variants.toArray();
      
      if (variants.length === 0) {
        return true;
      }
      
      const formattedVariants = variants.map(v => ({
        id: v.id,
        productId: v.productId,
        name: v.name,
        barcode: v.barcode,
        price: v.price,
        cost: v.cost,
        image: null, // Minimize payload
        quantity: v.quantity ?? 0,
        createdAt: (v as any).createdAt instanceof Date ? (v as any).createdAt.toISOString() : new Date().toISOString(),
        updatedAt: (v as any).updatedAt instanceof Date ? (v as any).updatedAt.toISOString() : new Date().toISOString(),
      }));

      const CHUNK_SIZE = 5;
      let allSuccess = true;
      
      for (let i = 0; i < formattedVariants.length; i += CHUNK_SIZE) {
        const chunk = formattedVariants.slice(i, i + CHUNK_SIZE);
        
        try {
          await api.post('/api/variants', chunk);
        } catch (error) {
          allSuccess = false;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      return allSuccess;
    } catch (error) {
      console.error('Error syncing variants to server:', error);
      return false;
    }
  }

  static async addProduct(productData: {
    name: string;
    barcode: string;
    price: number;
    cost?: number;
    quantity: number;
    category?: string;
    description?: string;
    image?: string;
  }): Promise<Product> {
    // Check if product with same barcode already exists
    const existingProduct = await db.products.where('barcode').equals(productData.barcode).first();
    if (existingProduct) {
      throw new Error('Product with this barcode already exists');
    }

    // Validate data
    if (productData.price <= 0) {
      throw new Error('Price must be greater than 0');
    }
    
    if (productData.quantity < 0) {
      throw new Error('Quantity cannot be negative');
    }

    const product: Product = {
      id: generateUUID(),
      tenantId: (productData as any).tenantId || (productData as any).tenant_id || '',
      name: productData.name.trim(),
      barcode: productData.barcode.trim(),
      boxBarcode: (productData as any).boxBarcode || (productData as any).box_barcode || null,
      unitsPerBox: Number((productData as any).unitsPerBox || (productData as any).units_per_box || 1),
      boxCost: Number((productData as any).boxCost || (productData as any).box_cost || 0),
      price: Math.round(productData.price * 100) / 100, // Round to 2 decimal places
      cost: productData.cost ? Math.round(productData.cost * 100) / 100 : 0,
      quantity: Math.floor(productData.quantity), // Ensure integer
      category: productData.category?.trim() || 'general',
      description: productData.description?.trim() || null,
      image: productData.image || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.products.add(product);
    // Sync ONLY this product in background
    api.post('/api/products', [{
      id: product.id,
      name: product.name,
      price: product.price,
      cost: (product as any).cost ?? 0,
      barcode: product.barcode,
      category: product.category ?? 'general',
      image: null,
      quantity: product.quantity ?? 0,
      createdAt: (product as any).createdAt instanceof Date ? (product as any).createdAt.toISOString() : new Date().toISOString(),
      updatedAt: (product as any).updatedAt instanceof Date ? (product as any).updatedAt.toISOString() : new Date().toISOString(),
    }]).catch(error => console.error('Error syncing products after add:', error));
    void NotificationService.checkAndGenerateLowStockAlerts().catch(error => console.warn('Low-stock refresh failed:', error));
    return product;
  }

  static async updateProduct(id: string, updates: Partial<Product>): Promise<void> {
    const existingProduct = await db.products.get(id);
    if (!existingProduct) {
      throw new Error('Product not found');
    }

    // If updating barcode, check for duplicates
    if (updates.barcode && updates.barcode !== existingProduct.barcode) {
      const duplicateProduct = await db.products.where('barcode').equals(updates.barcode).first();
      if (duplicateProduct && duplicateProduct.id !== id) {
        throw new Error('Product with this barcode already exists');
      }
    }

    // Validate updates
    if (updates.price !== undefined && updates.price <= 0) {
      throw new Error('Price must be greater than 0');
    }
    
    if (updates.quantity !== undefined && updates.quantity < 0) {
      throw new Error('Quantity cannot be negative');
    }

    // Clean and validate string fields
    const cleanUpdates: Partial<Product> = { ...updates };
    if (cleanUpdates.name) cleanUpdates.name = cleanUpdates.name.trim();
    if (cleanUpdates.barcode) cleanUpdates.barcode = cleanUpdates.barcode.trim();
    if (cleanUpdates.category) cleanUpdates.category = cleanUpdates.category.trim();
    if (cleanUpdates.price) cleanUpdates.price = Math.round(cleanUpdates.price * 100) / 100;
    if (cleanUpdates.cost !== undefined && cleanUpdates.cost !== null) cleanUpdates.cost = Math.round(cleanUpdates.cost * 100) / 100;
    if (cleanUpdates.quantity) cleanUpdates.quantity = Math.floor(cleanUpdates.quantity);

    await db.products.update(id, { ...cleanUpdates, updatedAt: new Date() });
    // Sync ONLY this product in background
    const updatedProduct = await db.products.get(id);
    if (updatedProduct) {
      api.post('/api/products', [{
        id: updatedProduct.id,
        name: updatedProduct.name,
        price: updatedProduct.price,
        cost: (updatedProduct as any).cost ?? 0,
        barcode: updatedProduct.barcode,
        category: updatedProduct.category ?? 'general',
        image: null,
        quantity: updatedProduct.quantity ?? 0,
        createdAt: (updatedProduct as any).createdAt instanceof Date ? (updatedProduct as any).createdAt.toISOString() : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }]).catch(error => console.error('Error syncing products after update:', error));
    }
    if (cleanUpdates.quantity !== undefined) {
      void NotificationService.checkAndGenerateLowStockAlerts().catch(error => console.warn('Low-stock refresh failed:', error));
    }
  }

  static async deleteProduct(id: string): Promise<void> {
    await db.products.delete(id);
    void NotificationService.checkAndGenerateLowStockAlerts().catch(error => console.warn('Low-stock refresh failed:', error));
    // For delete, we'll rely on periodic sync
    console.warn('Product deleted locally, sync with server will be handled in periodic sync');
  }

  static async updateStock(productId: string, quantityChange: number): Promise<void> {
    const product = await db.products.get(productId);
    if (!product) {
      throw new Error('Product not found');
    }

    const newQuantity = product.quantity + quantityChange;
    if (newQuantity < 0) {
      throw new Error('Insufficient stock');
    }

    await db.products.update(productId, {
      quantity: newQuantity,
      updatedAt: new Date(),
    });

    // Immediate sync to server for stock changes - FIRE IN BACKGROUND
    api.post('/api/products', [{
      ...product,
      quantity: newQuantity,
      updatedAt: new Date().toISOString()
    }]).catch(e => console.warn('Immediate stock sync failed, will rely on periodic sync', e));
    void NotificationService.checkAndGenerateLowStockAlerts().catch(error => console.warn('Low-stock refresh failed:', error));
  }

  static async addVariant(productId: string, data: { name: string; price: number; cost: number; quantity?: number; barcode?: string; boxBarcode?: string; unitsPerBox?: number; boxCost?: number; image?: string | null }): Promise<Variant> {
    const variant: Variant = {
      id: generateUUID(),
      tenantId: localStorage.getItem('smartpos_tenant_id') || '',
      productId,
      name: data.name.trim(),
      price: Math.round(data.price * 100) / 100,
      cost: Math.round(data.cost * 100) / 100,
      barcode: data.barcode?.trim() || null,
      boxBarcode: data.boxBarcode?.trim() || null,
      unitsPerBox: data.unitsPerBox ?? 1,
      boxCost: data.boxCost ?? 0,
      image: data.image || null,
      quantity: Math.floor(data.quantity ?? 0),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Variant;
    await db.variants.add(variant);
    // Sync ONLY this variant in background
    api.post('/api/variants', [{
      id: variant.id,
      productId: variant.productId,
      name: variant.name,
      price: variant.price,
      cost: variant.cost,
      barcode: variant.barcode,
      boxBarcode: (variant as any).boxBarcode,
      unitsPerBox: (variant as any).unitsPerBox,
      image: null,
      quantity: variant.quantity ?? 0,
      createdAt: (variant as any).createdAt instanceof Date ? (variant as any).createdAt.toISOString() : new Date().toISOString(),
      updatedAt: (variant as any).updatedAt instanceof Date ? (variant as any).updatedAt.toISOString() : new Date().toISOString(),
    }]).catch(e => console.error('Failed to sync variant', e));
    void NotificationService.checkAndGenerateLowStockAlerts().catch(error => console.warn('Low-stock refresh failed:', error));
    return variant;
  }

  static async getVariants(productId: string): Promise<Variant[]> {
    return await db.variants.where('productId').equals(productId).toArray();
  }
  
  static async getVariantById(variantId: string): Promise<Variant | undefined> {
    return await db.variants.get(variantId);
  }

  static async updateVariant(id: string, updates: Partial<Variant>): Promise<void> {
    await db.variants.update(id, { ...updates, updatedAt: new Date() });
    // Fire sync in background
    const updated = await db.variants.get(id);
    if (updated) {
      api.post('/api/variants', [{
        ...updated,
        updatedAt: new Date().toISOString()
      }]).catch(e => console.error('Failed to sync variant update', e));
    }
    if (updates.quantity !== undefined) {
      void NotificationService.checkAndGenerateLowStockAlerts().catch(error => console.warn('Low-stock refresh failed:', error));
    }
  }
}

export class NonInventoryProductService {
  static async getAllNonInventoryProducts(): Promise<NonInventoryProduct[]> {
    return await db.nonInventoryProducts.toArray();
  }

  static async getNonInventoryProductById(id: string): Promise<NonInventoryProduct | undefined> {
    return await db.nonInventoryProducts.get(id);
  }

  static async getNonInventoryProductByBarcode(barcode: string): Promise<NonInventoryProduct | undefined> {
    return await db.nonInventoryProducts.where('barcode').equals(barcode).first();
  }

  static async addNonInventoryProduct(productData: {
    name: string;
    price: number;
    category?: string;
    description?: string;
    image?: string;
    barcode: string;
    barcodeData?: string;
  }): Promise<NonInventoryProduct> {
    const existing = await db.nonInventoryProducts.where('barcode').equals(productData.barcode).first();
    if (existing) throw new Error('Product with this barcode already exists');

    const product: NonInventoryProduct = {
      id: generateUUID(),
      tenantId: (productData as any).tenantId || (productData as any).tenant_id || '',
      name: productData.name.trim(),
      price: Math.round(productData.price * 100) / 100,
      category: productData.category?.trim() || 'general',
      description: productData.description?.trim() || null,
      image: productData.image || null,
      barcode: productData.barcode,
      barcodeData: productData.barcodeData || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.nonInventoryProducts.add(product);
    
    // Sync to server
    try {
      await api.post('/api/non-inventory-products', [product]);
    } catch (e) {
      console.warn('Failed to sync non-inventory product to server:', e);
    }
    
    return product;
  }

  static async updateNonInventoryProduct(id: string, updates: Partial<NonInventoryProduct>): Promise<void> {
    const cleanUpdates = { ...updates, updatedAt: new Date() };
    await db.nonInventoryProducts.update(id, cleanUpdates);
    
    // Sync to server
    try {
      const updated = await db.nonInventoryProducts.get(id);
      if (updated) await api.post('/api/non-inventory-products', [updated]);
    } catch (e) {
      console.warn('Failed to sync non-inventory product update to server:', e);
    }
  }

  static async deleteNonInventoryProduct(id: string): Promise<void> {
    await db.nonInventoryProducts.delete(id);
    // Notify server (optional, or rely on full sync)
  }
  
  static async syncAllNonInventoryProductsToServer(): Promise<boolean> {
    try {
      const products = await db.nonInventoryProducts.toArray();
      if (products.length === 0) return true;
      await api.post('/api/non-inventory-products', products);
      return true;
    } catch (e) {
      console.error('Error syncing non-inventory products:', e);
      return false;
    }
  }
}

// Sales service
export class SalesService {
  static async processSale(saleData: {
    items: CartItem[];
    total: number;
    paymentType: 'cash' | 'ewallet' | 'credits';
    paymentAmount: number;
    staffId?: string;
  }): Promise<Sale> {
    // Validate sale data
    if (!saleData.items || saleData.items.length === 0) {
      throw new Error('Cannot process sale with empty cart');
    }

    if (saleData.total <= 0) {
      throw new Error('Sale total must be greater than 0');
    }

    if (saleData.paymentType === 'cash' && saleData.paymentAmount < saleData.total) {
      throw new Error('Insufficient payment amount for cash transaction');
    }
    // For credits, paymentAmount represents amount paid now (usually 0)
    if (saleData.paymentType === 'credits' && saleData.paymentAmount < 0) {
      throw new Error('Payment amount cannot be negative');
    }

    // Check stock availability for all items before processing
    for (const item of saleData.items) {
      if ((item as any).isNonInventory) continue;

      const product = await ProductService.getProductByBarcode(item.productId) ||
                     await db.products.get(item.productId);

      const multiplier = getUnitMultiplier(item.unit);
      const actualQuantity = item.quantity * multiplier;

      if (!product) {
        // Check if it is a variant
        const variant = await db.variants.get(item.productId);
        if (variant) {
          const variantQty = (variant as any).quantity ?? 0;
          if (variantQty < actualQuantity) {
            throw new Error(`Insufficient stock for variant ${item.name}. Available: ${variantQty}, Required: ${actualQuantity}`);
          }
          continue;
        }
        throw new Error(`Product ${item.name} no longer exists`);
      }

      if (product.quantity < actualQuantity) {
        throw new Error(`Insufficient stock for ${item.name}. Available: ${product.quantity}, Required: ${actualQuantity}`);
      }
    }

    const sale: Omit<Sale, 'items'> = {
      id: generateUUID(),
      tenantId: (saleData as any).tenantId || (saleData as any).tenant_id || '',
      total: Math.round(saleData.total * 100) / 100,
      paymentType: saleData.paymentType,
      paymentAmount: Math.round(saleData.paymentAmount * 100) / 100,
      staffId: saleData.staffId || null,
      remitted: false,
      createdAt: new Date(),
    };

    await db.sales.add(sale as Sale);

    // Add sale items
    for (const item of saleData.items) {
        const saleItem: SaleItem = {
            id: generateUUID(),
            tenantId: (saleData as any).tenantId || (saleData as any).tenant_id || '',
            saleId: sale.id,
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
            unit: item.unit,
            productName: item.name,
            isNonInventory: !!item.isNonInventory
        };
        await db.saleItems.add(saleItem);
    }

    // Update inventory (use a transaction-like approach)
    try {
      for (const item of saleData.items) {
        if (item.isNonInventory) continue;
        const multiplier = getUnitMultiplier(item.unit);
        const actualQuantity = item.quantity * multiplier;
        try {
          // Update stock locally ONLY first, don't wait for server sync
          const product = await db.products.get(item.productId);
          if (product) {
            const newQuantity = product.quantity - actualQuantity;
            if (newQuantity < 0) throw new Error(`Insufficient stock for ${product.name}`);
            await db.products.update(product.id, { quantity: newQuantity, updatedAt: new Date() });
            // Fire sync in background
            api.post('/api/products', [{
              ...product,
              quantity: newQuantity,
              updatedAt: new Date().toISOString()
            }]).catch(err => console.warn('Stock sync failed, will sync later:', err));
          } else {
            // Check if it's a variant
            const variant = await db.variants.get(item.productId);
            if (variant) {
              const currentQty = (variant as any).quantity ?? 0;
              const newQty = currentQty - actualQuantity;
              if (newQty < 0) throw new Error(`Insufficient stock for variant ${variant.name}`);
              await db.variants.update(variant.id, { quantity: newQty, updatedAt: new Date() });
              // Fire sync in background
              const updatedVariant = await db.variants.get(variant.id);
              if (updatedVariant) {
                api.post('/api/variants', [{
                  ...updatedVariant,
                  updatedAt: new Date().toISOString()
                }]).catch(err => console.warn('Variant stock sync failed, will sync later:', err));
              }
            } else {
              throw new Error(`Product/variant ${item.name} not found`);
            }
          }
        } catch (e) {
          throw e;
        }
      }
      
      // CRITICAL: Push sale to server for admin visibility - FIRE IN BACKGROUND, DON'T AWAIT
      try {
        // Build proper sale items array with all required fields (id, saleId, productName, etc)
        const saleItemsForServer = saleData.items.map(item => ({
          id: generateUUID(),
          saleId: sale.id,
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
          unit: item.unit,
          productName: item.name,
          isNonInventory: item.isNonInventory
        }));

        const saleDataForServer = {
          sale: {
            ...sale,
            staffId: sale.staffId || 'unknown'
          },
          items: saleItemsForServer
        };
        api.post('/api/sales', saleDataForServer)
          .then(() => console.log('Sale pushed to server successfully'))
          .catch(err => console.warn('Failed to push sale to server immediately, will sync later:', err));
      } catch (err) {
        console.warn('Failed to push sale to server immediately, will sync later:', err);
      }
    } catch (error) {
      // If stock update fails, remove the sale record to maintain consistency
      await db.sales.delete(sale.id);
      await db.saleItems.where('saleId').equals(sale.id).delete();
      throw new Error(`Failed to update inventory: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    void NotificationService.checkAndGenerateLowStockAlerts((saleData as any).tenantId || (saleData as any).tenant_id).catch(error => console.warn('Low-stock refresh failed:', error));
    return sale as Sale;
  }

  static async getTodaysSales(): Promise<Sale[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return await db.sales.where('createdAt').above(today).toArray();
  }

  static async getAllSales(): Promise<Sale[]> {
    return await db.sales.toArray();
  }

  static async getTotalSales(): Promise<number> {
    const sales = await db.sales.toArray();
    return sales.reduce((total, sale) => total + (sale.total || 0), 0);
  }

  static async addIncome(total: number, paymentType: 'cash' | 'ewallet', staffId?: string): Promise<Sale> {
    if (total <= 0) {
      throw new Error('Income total must be greater than 0');
    }
    const sale: Sale = {
      id: generateUUID(),
      total: Math.round(total * 100) / 100,
      paymentType,
      paymentAmount: Math.round(total * 100) / 100,
      staffId: staffId || null,
      remitted: false,
      createdAt: new Date(),
    } as Sale;
    await db.sales.add(sale);
    
    // CRITICAL: Push income to server for admin visibility - FIRE IN BACKGROUND
    api.post('/api/sales', {
      sale: {
        ...sale,
        staffId: staffId || 'unknown'
      },
      items: [{
        productId: 'income-adjustment',
        quantity: 1,
        price: total,
        unit: 'total',
        name: `Income (${paymentType})`
      }]
    }).catch(err => console.warn('Failed to push income to server immediately:', err));
    
    return sale;
  }

  static async syncWithServer(): Promise<void> {
    try {
      const response = await api.get('/api/sales-history');
      const serverSales = response.data;
      
      if (Array.isArray(serverSales)) {
        // Map server fields back to Dexie fields if necessary
        const dexieSales = serverSales.map((s: any) => ({
          id: s.id,
          tenantId: s.tenantId || s.tenant_id || '',
          total: Number(s.total || 0),
          paymentType: s.payment_type || 'cash',
          paymentAmount: Number(s.payment_amount || 0),
          staffId: s.staff_id || null,
          remitted: Boolean(s.remitted),
          createdAt: s.created_at ? new Date(s.created_at) : new Date(),
        }));

        // Use a bulk put to update/insert all server sales into local Dexie
        await db.sales.bulkPut(dexieSales);
        console.log(`Synced ${dexieSales.length} sales from server`);
      }
    } catch (err) {
      console.error('Failed to sync sales with server:', err);
    }
  }

  static async fetchFromCloud(): Promise<{ success: boolean; message?: string; counts?: any }> {
    try {
      // 1. Tell backend to pull all tenant data from Supabase to server SQLite and return full payload
      const pullRes = await api.post('/api/sync/pull-all', {});
      if (!pullRes || pullRes.success === false) {
        throw new Error(pullRes?.error || 'Failed to pull cloud data from Supabase');
      }

      const payloadData = pullRes.data || {};
      const {
        products = [],
        variants = [],
        staff = [],
        users = [],
        sales = [],
        saleItems = [],
        nonInventoryProducts = [],
        expenses = [],
        purchases = [],
        creditors = [],
        remittances = [],
        notifications = []
      } = payloadData;

      // 2. Hydrate Products
      if (Array.isArray(products) && products.length > 0) {
        const sanitizedProducts: any[] = products.map((p: any) => ({
          id: String(p.id),
          tenantId: p.tenantId || p.tenant_id || '',
          name: p.name || 'Unnamed Product',
          price: Number(p.price || 0),
          cost: Number(p.cost || 0),
          barcode: p.barcode && String(p.barcode).trim() !== '' ? String(p.barcode) : null,
          category: p.category || null,
          description: p.description || null,
          image: p.image || null,
          quantity: Number(p.quantity || 0),
          createdAt: p.createdAt || p.created_at ? new Date(p.createdAt || p.created_at) : new Date(),
          updatedAt: p.updatedAt || p.updated_at ? new Date(p.updatedAt || p.updated_at) : new Date()
        }));
        await db.products.clear();
        await (db.products as any).bulkPut(sanitizedProducts);
      }

      // 3. Hydrate Variants
      if (Array.isArray(variants) && variants.length > 0) {
        const sanitizedVariants: any[] = variants.map((v: any) => ({
          id: String(v.id),
          tenantId: v.tenantId || v.tenant_id || '',
          productId: String(v.productId || v.product_id || ''),
          name: v.name || 'Variant',
          barcode: v.barcode && String(v.barcode).trim() !== '' ? String(v.barcode) : null,
          price: Number(v.price || 0),
          cost: Number(v.cost || 0),
          quantity: Number(v.quantity || 0),
          image: v.image || null,
          createdAt: v.createdAt || v.created_at ? new Date(v.createdAt || v.created_at) : new Date(),
          updatedAt: v.updatedAt || v.updated_at ? new Date(v.updatedAt || v.updated_at) : new Date()
        }));
        await db.variants.clear();
        await (db.variants as any).bulkPut(sanitizedVariants);
      }

      // 4. Hydrate Staff (preserving passkey for staff pin code login!)
      if (Array.isArray(staff) && staff.length > 0) {
        const sanitizedStaff: any[] = staff.map((s: any, index: number) => {
          const sIdRaw = String(s.staffId || s.staff_id || s.id || '').trim();
          const finalStaffId = sIdRaw !== '' ? sIdRaw : `staff-${index}-${String(s.id)}`;
          return {
            id: String(s.id),
            tenantId: s.tenantId || s.tenant_id || '',
            userId: s.userId || s.user_id || null,
            firstName: s.firstName || s.first_name || '',
            middleName: s.middleName || s.middle_name || null,
            lastName: s.lastName || s.last_name || '',
            name: s.name || [s.firstName, s.lastName].filter(Boolean).join(' ') || 'Staff Member',
            staffId: finalStaffId,
            passkey: s.passkey || s.passHash || s.pass_key || s.passhash || null,
            role: s.role || 'cashier',
            branch: s.branch || null,
            department: s.department || null,
            employmentStatus: s.employmentStatus || s.employment_status || 'active',
            email: s.email || null,
            phone: s.phone || null,
            address: s.address || null,
            birthdate: s.birthdate || null,
            gender: s.gender || null,
            dateHired: s.dateHired || s.date_hired || null,
            assignedShift: s.assignedShift || s.assigned_shift || null,
            lastLogin: s.lastLogin ? new Date(s.lastLogin) : null,
            passwordLastChanged: s.passwordLastChanged ? new Date(s.passwordLastChanged) : null,
            permissions: s.permissions || [],
            createdBy: s.createdBy || s.created_by || null,
            createdAt: s.createdAt || s.created_at ? new Date(s.createdAt || s.created_at) : new Date(),
            updatedAt: s.updatedAt || s.updated_at ? new Date(s.updatedAt || s.updated_at) : new Date()
          };
        });
        await db.staff.clear();
        await (db.staff as any).bulkPut(sanitizedStaff);
      }

      // 5. Hydrate Admin Users
      if (Array.isArray(users) && users.length > 0) {
        const sanitizedUsers: any[] = users.map((u: any) => ({
          id: String(u.id),
          tenantId: u.tenantId || u.tenant_id || '',
          username: String(u.username),
          password: u.password || '',
          role: u.role || 'admin',
          businessName: u.businessName || u.business_name || null,
          ownerName: u.ownerName || u.owner_name || null,
          mobile: u.mobile || null,
          email: u.email || null,
          profileImage: u.profileImage || u.profile_image || null,
          staffId: u.staffId || u.staff_id || null,
          createdAt: u.createdAt || u.created_at ? new Date(u.createdAt || u.created_at) : new Date()
        }));
        await db.users.clear();
        await (db.users as any).bulkPut(sanitizedUsers);
      }

      // 6. Hydrate Sales
      if (Array.isArray(sales) && sales.length > 0) {
        const dexieSales: any[] = sales.map((s: any) => ({
          id: String(s.id),
          tenantId: s.tenantId || s.tenant_id || '',
          total: Number(s.total || 0),
          paymentType: s.paymentType || s.payment_type || 'cash',
          paymentAmount: Number(s.paymentAmount || s.payment_amount || 0),
          staffId: s.staffId || s.staff_id || null,
          remitted: Boolean(s.remitted),
          createdAt: s.createdAt || s.created_at ? new Date(s.createdAt || s.created_at) : new Date(),
        }));
        await db.sales.clear();
        await (db.sales as any).bulkPut(dexieSales);
      }

      // 7. Hydrate Sale Items
      if (Array.isArray(saleItems) && saleItems.length > 0) {
        const dexieSaleItems: any[] = saleItems.map((si: any) => ({
          id: String(si.id),
          tenantId: si.tenantId || si.tenant_id || '',
          saleId: String(si.saleId || si.sale_id || ''),
          productId: String(si.productId || si.product_id || ''),
          quantity: Number(si.quantity || 1),
          price: Number(si.price || 0),
          unit: si.unit || 'pieces',
          productName: si.productName || si.product_name || '',
          isNonInventory: Boolean(si.isNonInventory || si.is_non_inventory)
        }));
        await db.saleItems.clear();
        await (db.saleItems as any).bulkPut(dexieSaleItems);
      }

      // 8. Hydrate Non-Inventory Products
      if (Array.isArray(nonInventoryProducts) && nonInventoryProducts.length > 0) {
        const sanitizedNonInv: any[] = nonInventoryProducts.map((ni: any) => ({
          id: String(ni.id),
          tenantId: ni.tenantId || ni.tenant_id || '',
          name: ni.name,
          price: Number(ni.price || 0),
          category: ni.category || null,
          description: ni.description || null,
          image: ni.image || null,
          barcode: ni.barcode && String(ni.barcode).trim() !== '' ? String(ni.barcode) : null,
          barcodeData: ni.barcodeData || ni.barcode_data || null,
          createdAt: ni.createdAt || ni.created_at ? new Date(ni.createdAt || ni.created_at) : new Date(),
          updatedAt: ni.updatedAt || ni.updated_at ? new Date(ni.updatedAt || ni.updated_at) : new Date()
        }));
        await db.nonInventoryProducts.clear();
        await (db.nonInventoryProducts as any).bulkPut(sanitizedNonInv);
      }

      // 9. Hydrate Expenses
      if (Array.isArray(expenses) && expenses.length > 0) {
        const sanitizedExpenses: any[] = expenses.map((e: any) => ({
          id: String(e.id),
          tenantId: e.tenantId || e.tenant_id || '',
          description: e.description,
          amount: Number(e.amount || 0),
          category: e.category,
          date: e.date ? new Date(e.date) : new Date()
        }));
        await db.expenses.clear();
        await (db.expenses as any).bulkPut(sanitizedExpenses);
      }

      // 10. Hydrate Purchases
      if (Array.isArray(purchases) && purchases.length > 0) {
        const sanitizedPurchases: any[] = purchases.map((p: any) => ({
          id: String(p.id),
          tenantId: p.tenantId || p.tenant_id || '',
          productName: p.productName || p.product_name || '',
          quantity: Number(p.quantity || 0),
          cost: Number(p.cost || 0),
          supplier: p.supplier || null,
          description: p.description || null,
          details: p.details || null,
          expirationDate: p.expirationDate || p.expiration_date ? new Date(p.expirationDate || p.expiration_date) : null,
          date: p.date ? new Date(p.date) : new Date()
        }));
        await db.purchases.clear();
        await (db.purchases as any).bulkPut(sanitizedPurchases);
      }

      // 11. Hydrate Creditors
      if (Array.isArray(creditors) && creditors.length > 0) {
        const sanitizedCreditors: any[] = creditors.map((c: any) => ({
          id: String(c.id),
          tenantId: c.tenantId || c.tenant_id || '',
          name: c.name || 'Creditor',
          amount: Number(c.amount || c.totalDebt || c.total_debt || 0),
          description: c.description || c.address || null,
          dueDate: c.dueDate || c.due_date ? new Date(c.dueDate || c.due_date) : new Date(),
          reminderDate: c.reminderDate || c.reminder_date ? new Date(c.reminderDate || c.reminder_date) : null,
          isPaid: Boolean(c.isPaid || c.is_paid || (c.totalDebt === 0))
        }));
        await db.creditors.clear();
        await (db.creditors as any).bulkPut(sanitizedCreditors);
      }

      // 12. Hydrate Remittances
      if (Array.isArray(remittances) && remittances.length > 0) {
        const sanitizedRemittances: any[] = remittances.map((r: any) => ({
          id: String(r.id),
          tenantId: r.tenantId || r.tenant_id || '',
          staffId: r.staffId || r.staff_id || '',
          staffName: r.staffName || r.staff_name || 'Staff',
          amount: Number(r.amount || 0),
          transactionCount: Number(r.transactionCount || r.transaction_count || 0),
          status: r.status || 'pending',
          createdAt: r.createdAt || r.created_at ? new Date(r.createdAt || r.created_at) : new Date(),
          confirmedAt: r.confirmedAt || r.confirmed_at ? new Date(r.confirmedAt || r.confirmed_at) : null
        }));
        await db.remittances.clear();
        await (db.remittances as any).bulkPut(sanitizedRemittances);
      }

      // 13. Hydrate Notifications
      if (Array.isArray(notifications) && notifications.length > 0) {
        const sanitizedNotifications: any[] = notifications.map((n: any) => ({
          id: String(n.id),
          tenantId: n.tenantId || n.tenant_id || '',
          userId: n.userId || n.user_id || null,
          type: n.type || 'system',
          message: n.message,
          data: n.data || null,
          isRead: Boolean(n.isRead || n.is_read),
          createdAt: n.createdAt || n.created_at ? new Date(n.createdAt || n.created_at) : new Date()
        }));
        await db.notifications.clear();
        await (db.notifications as any).bulkPut(sanitizedNotifications);
      }

      console.log('[CLIENT SYNC] Fully fetched and hydrated all cloud entities into Dexie IndexedDB', pullRes.counts);
      return { success: true, message: 'All cloud data fetched successfully', counts: pullRes.counts };
    } catch (error: any) {
      console.error('[CLIENT SYNC ERROR] Fetch from cloud failed:', error);
      throw error;
    }
  }
}

// Staff service
export class StaffService {
  static async getAllStaff(): Promise<Staff[]> {
    return await db.staff.toArray();
  }

  static async getActiveStaff(): Promise<Staff[]> {
    // Return all staff, filtering is handled by the UI based on real-time status
    return await db.staff.toArray();
  }

  static async getInactiveStaff(): Promise<Staff[]> {
    // Return all staff, filtering is handled by the UI based on real-time status
    return await db.staff.toArray();
  }

  static async deleteStaff(id: string): Promise<void> {
    await db.staff.delete(id);
  }

  static async updateStaff(id: string, updates: Partial<Staff>): Promise<void> {
    const existing = await db.staff.get(id);
    if (!existing) throw new Error('Staff not found');
    const now = new Date().toISOString();
    await db.staff.update(id, {
      ...updates,
      updatedAt: now,
    } as any);
  }

  static async updateStaffPassword(id: string, newPassword: string): Promise<void> {
    const existing = await db.staff.get(id);
    if (!existing) throw new Error('Staff not found');
    const hashed = await hashPassword(newPassword);
    const now = new Date().toISOString();
    await db.staff.update(id, {
      passkey: hashed,
      passwordLastChanged: now,
      updatedAt: now,
    } as any);
  }

  static async getStaffTimestamps(id: string): Promise<any[]> {
    try {
      const res = await api.get(`/api/staff/${id}/timestamps`);
      return Array.isArray(res) ? res : [];
    } catch (e) {
      console.error('Error in StaffService.getStaffTimestamps:', e);
      return [];
    }
  }
}

// Expense service
export class ExpenseService {
    static async addExpense(expenseData: Omit<Expense, 'id'>): Promise<Expense> {
        const expense: Expense = {
            id: generateUUID(),
            ...expenseData,
        };
        await db.expenses.add(expense);
        return expense;
    }

    static async getAllExpenses(): Promise<Expense[]> {
        return await db.expenses.toArray();
    }
}

// Purchase service
export class PurchaseService {
    static async addPurchase(purchaseData: Omit<Purchase, 'id'>): Promise<Purchase> {
        const purchase: Purchase = {
            id: generateUUID(),
            ...purchaseData,
        };
        await db.purchases.add(purchase);
        return purchase;
    }

    static async getAllPurchases(): Promise<Purchase[]> {
        return await db.purchases.toArray();
    }
}

// Creditor service
export class CreditorService {
    static async addCreditor(creditorData: Omit<Creditor, 'id'>): Promise<Creditor> {
        const creditor: Creditor = {
            id: generateUUID(),
            tenantId: (creditorData as any).tenantId || '',
            name: creditorData.name,
            amount: creditorData.amount || 0,
            description: creditorData.description || '',
            dueDate: creditorData.dueDate || new Date().toISOString(),
            reminderDate: creditorData.reminderDate || new Date().toISOString(),
            isPaid: creditorData.isPaid || false,
            createdAt: new Date(),
        } as any;
        await db.creditors.add(creditor);
        api.post('/api/creditors', creditor).catch(e => console.warn('Failed to sync creditor to server:', e));
        return creditor;
    }

  static async getAllCreditors(): Promise<Creditor[]> {
    return await db.creditors.toArray();
  }

  static async getCreditorById(id: string): Promise<Creditor | undefined> {
    return await db.creditors.get(id);
  }

  static async markAsPaid(id: string): Promise<void> {
    await db.creditors.update(id, { isPaid: true });
  }

  static async applyCredit(creditorId: string, items: CartItem[], total: number): Promise<void> {
    const creditor = await db.creditors.get(creditorId);
    if (!creditor) throw new Error('Creditor not found');

    const newAmount = (creditor.amount || 0) + Math.round(total * 100) / 100;
    // Append transaction details into description as JSON array
    let txns: Array<{ date: string; total: number; items: Array<{ name: string; quantity: number; unit: CartItem['unit']; subtotal: number }> }> = [];
    try {
      if (creditor.description) {
        const parsed = JSON.parse(creditor.description);
        if (Array.isArray(parsed)) txns = parsed;
      }
    } catch {}
    txns.push({
      date: new Date().toISOString(),
      total: Math.round(total * 100) / 100,
      items: items.map(i => ({ name: i.name, quantity: i.quantity, unit: i.unit, subtotal: Math.round(i.subtotal * 100) / 100 }))
    });

    await db.creditors.update(creditorId, { amount: newAmount, description: JSON.stringify(txns) });
  }

  static async recordPayment(creditorId: string, amount: number, paymentType: 'cash' | 'ewallet'): Promise<void> {
    const creditor = await db.creditors.get(creditorId);
    if (!creditor) throw new Error('Creditor not found');
    const current = Math.round((creditor.amount || 0) * 100) / 100;
    const pay = Math.round(amount * 100) / 100;
    
    if (pay <= 0) throw new Error('Payment amount must be greater than 0');
    if (pay > current) throw new Error('Payment amount exceeds current balance');

    let creditsArr: Array<any> = [];
    let paymentsArr: Array<{ date: string; amount: number; method: string }> = [];
    try {
      if (creditor.description) {
        const parsed = JSON.parse(creditor.description);
        if (Array.isArray(parsed)) {
          creditsArr = parsed;
        } else if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.credits)) creditsArr = parsed.credits;
          if (Array.isArray(parsed.payments)) paymentsArr = parsed.payments;
        }
      }
    } catch {}

    paymentsArr.push({ date: new Date().toISOString(), amount: pay, method: paymentType });
    const nextDesc = JSON.stringify({ credits: creditsArr, payments: paymentsArr });
    
    const newBalance = Math.round((current - pay) * 100) / 100;
    const isPaid = newBalance <= 0;
    
    await db.creditors.update(creditorId, { amount: newBalance, isPaid: isPaid, description: nextDesc });
    await SalesService.addIncome(pay, paymentType);
  }
}

// Bulk Inventory Service (Dexie + Server sync + Offline queue)
export class BulkInventoryService {
  private static isSubmitting = false;

  static async submitBulkInventory(payload: BulkInventorySubmitInput & { tenantId?: string }): Promise<{
    success: boolean;
    isIdempotentReplay?: boolean;
    offlineQueued?: boolean;
    transactionId?: string;
    referenceNumber?: string;
    counts?: any;
    transaction?: any;
    items?: any[];
  }> {
    if (this.isSubmitting) {
      throw new Error('SUBMISSION_IN_PROGRESS: A bulk inventory submission is already processing. Please wait.');
    }

    this.isSubmitting = true;
    try {
      // 1. If online, try submitting to server API
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const res: any = await api.post('/api/inventory/bulk', {
            idempotencyKey: payload.idempotencyKey,
            supplierCompany: payload.supplierCompany,
            notes: payload.notes,
            items: payload.items,
          });

          if (res && res.success) {
            // Apply updates to local Dexie database
            await db.transaction('rw', [db.products, db.variants, db.bulkInventoryTransactions, db.bulkInventoryItems], async () => {
              for (const item of payload.items) {
                if (item.variantId) {
                  const existingVar = await db.variants.get(item.variantId);
                  if (existingVar) {
                    const newQty = (existingVar.quantity || 0) + Number(item.quantity || 0);
                    const updates: any = { quantity: newQty, updatedAt: new Date().toISOString() };
                    if (item.updateProductPriceCost) {
                      if (item.sellingPrice > 0) updates.price = item.sellingPrice;
                      if (item.cost >= 0) updates.cost = item.cost;
                    }
                    await db.variants.update(item.variantId, updates);
                  }
                } else if (item.productId && !item.isNewProduct) {
                  const existingProd = await db.products.get(item.productId);
                  if (existingProd) {
                    const newQty = (existingProd.quantity || 0) + Number(item.quantity || 0);
                    const updates: any = { quantity: newQty, updatedAt: new Date() };
                    if (item.updateProductPriceCost) {
                      if (item.sellingPrice > 0) updates.price = item.sellingPrice;
                      if (item.cost >= 0) updates.cost = item.cost;
                    }
                    await db.products.update(item.productId, updates);
                  }
                }
              }

              // Cache transaction and items locally
              if (res.transaction) {
                await db.bulkInventoryTransactions.put({
                  id: res.transaction.id,
                  tenantId: res.transaction.tenant_id || res.transaction.tenantId || payload.tenantId || '',
                  referenceNumber: res.transaction.reference_number || res.transaction.referenceNumber || res.referenceNumber,
                  supplierCompany: res.transaction.supplier_company || res.transaction.supplierCompany,
                  totalItems: res.transaction.total_items || res.transaction.totalItems,
                  totalUnits: res.transaction.total_units || res.transaction.totalUnits,
                  totalCost: res.transaction.total_cost || res.transaction.totalCost,
                  notes: res.transaction.notes,
                  status: res.transaction.status || 'completed',
                  createdAt: res.transaction.createdAt || res.transaction.created_at || new Date().toISOString()
                });
              }

              if (Array.isArray(res.items)) {
                for (const it of res.items) {
                  await db.bulkInventoryItems.put({
                    id: it.id,
                    bulkInventoryId: it.bulk_inventory_id || it.bulkInventoryId || res.transaction?.id,
                    tenantId: it.tenant_id || it.tenantId || payload.tenantId || '',
                    productId: it.product_id || it.productId,
                    variantId: it.variant_id || it.variantId,
                    barcode: it.barcode,
                    boxBarcode: it.box_barcode || it.boxBarcode || null,
                    pieceBarcode: it.piece_barcode || it.pieceBarcode || null,
                    boxCount: Number(it.box_count ?? it.boxCount ?? 0),
                    unitsPerBox: Number(it.units_per_box ?? it.unitsPerBox ?? 1),
                    costPerBox: Number(it.cost_per_box ?? it.costPerBox ?? 0),
                    productNameSnapshot: it.product_name_snapshot || it.productNameSnapshot,
                    descriptionSnapshot: it.description_snapshot || it.descriptionSnapshot,
                    quantity: it.quantity,
                    costSnapshot: it.cost_snapshot || it.costSnapshot,
                    sellingPriceSnapshot: it.selling_price_snapshot || it.sellingPriceSnapshot,
                    supplierCompanyOverride: it.supplier_company_override || it.supplierCompanyOverride,
                    notes: it.notes,
                    createdAt: it.createdAt || it.created_at || new Date().toISOString()
                  });
                }
              }
            });

            void NotificationService.checkAndGenerateLowStockAlerts(payload.tenantId).catch(error => console.warn('Low-stock refresh failed:', error));
            return res;
          }
        } catch (netErr: any) {
          console.warn('[BULK INVENTORY] Online submit failed or server unreachable, falling back to local offline Dexie queue:', netErr);
        }
      }

      // 2. Offline / Local fallback: Apply stock increment in Dexie and queue for background sync
      const fallbackTxId = generateUUID();
      const nowStr = new Date().toISOString();
      const year = new Date().getFullYear();
      const existingOfflineCount = await db.bulkInventoryTransactions.count();
      const offlineRef = `BI-${year}-OFFLINE-${String(existingOfflineCount + 1).padStart(4, '0')}`;

      let totalUnits = 0;
      let totalCost = 0;
      const localItemsToInsert: any[] = [];

      await db.transaction('rw', [db.products, db.variants, db.bulkInventoryTransactions, db.bulkInventoryItems, db.pendingBulkSubmissions], async () => {
        for (const item of payload.items) {
          totalUnits += Number(item.quantity || 0);
          totalCost += Number(item.quantity || 0) * Number(item.cost || 0);

          let resolvedProdId = item.productId || null;
          let resolvedVarId = item.variantId || null;

          if (item.variantId) {
            const existingVar = await db.variants.get(item.variantId);
            if (existingVar) {
              const newQty = (existingVar.quantity || 0) + Number(item.quantity || 0);
              const updates: any = { quantity: newQty, updatedAt: nowStr };
              if (item.boxBarcode) {
                updates.boxBarcode = item.boxBarcode;
                updates.unitsPerBox = item.unitsPerBox || 1;
                updates.boxCost = item.costPerBox || 0;
              }
              if (item.updateProductPriceCost) {
                if (item.sellingPrice > 0) updates.price = item.sellingPrice;
                if (item.cost >= 0) updates.cost = item.cost;
              }
              await db.variants.update(item.variantId, updates);
            }
          } else if (item.productId && !item.isNewProduct) {
            const existingProd = await db.products.get(item.productId);
            if (existingProd) {
              const newQty = (existingProd.quantity || 0) + Number(item.quantity || 0);
              const updates: any = { quantity: newQty, updatedAt: new Date() };
              if (item.boxBarcode) {
                updates.boxBarcode = item.boxBarcode;
                updates.unitsPerBox = item.unitsPerBox || 1;
                updates.boxCost = item.costPerBox || 0;
              }
              if (item.updateProductPriceCost) {
                if (item.sellingPrice > 0) updates.price = item.sellingPrice;
                if (item.cost >= 0) updates.cost = item.cost;
              }
              await db.products.update(item.productId, updates);
            }
          } else if (item.isNewProduct) {
            resolvedProdId = generateUUID();
            const newProd: Product = {
              id: resolvedProdId,
              tenantId: payload.tenantId || '',
              name: item.productName,
              barcode: item.pieceBarcode || item.barcode || null,
              boxBarcode: item.boxBarcode || null,
              unitsPerBox: item.unitsPerBox || 1,
              boxCost: item.costPerBox || 0,
              price: item.sellingPrice,
              cost: item.cost,
              quantity: item.quantity,
              category: 'general',
              description: item.description || null,
              image: null,
              createdAt: new Date(),
              updatedAt: new Date()
            };
            await db.products.add(newProd);
          }

          const itemId = generateUUID();
          const itemRecord = {
            id: itemId,
            bulkInventoryId: fallbackTxId,
            tenantId: payload.tenantId || '',
            productId: resolvedProdId,
            variantId: resolvedVarId,
            barcode: item.barcode,
            boxBarcode: item.boxBarcode || null,
            pieceBarcode: item.pieceBarcode || item.barcode || null,
            boxCount: Number(item.boxCount || 0),
            unitsPerBox: Number(item.unitsPerBox || 1),
            costPerBox: Number(item.costPerBox || 0),
            productNameSnapshot: item.productName,
            descriptionSnapshot: item.description || null,
            quantity: item.quantity,
            costSnapshot: item.cost,
            sellingPriceSnapshot: item.sellingPrice,
            supplierCompanyOverride: item.supplierCompanyOverride || null,
            notes: item.notes || null,
            priceCostUpdateConfirmed: item.updateProductPriceCost ? 1 : 0,
            createdAt: nowStr
          };
          localItemsToInsert.push(itemRecord);
          await db.bulkInventoryItems.add(itemRecord);
        }

        const txRecord = {
          id: fallbackTxId,
          tenantId: payload.tenantId || '',
          referenceNumber: offlineRef,
          createdBy: 'offline_user',
          supplierCompany: payload.supplierCompany || null,
          totalItems: payload.items.length,
          totalUnits,
          totalCost,
          notes: payload.notes || null,
          status: 'completed',
          idempotencyKey: payload.idempotencyKey,
          createdAt: nowStr,
          updatedAt: nowStr
        };
        await db.bulkInventoryTransactions.add(txRecord);

        // Queue in pending submissions for background push
        await db.pendingBulkSubmissions.put({
          id: fallbackTxId,
          tenantId: payload.tenantId || '',
          idempotencyKey: payload.idempotencyKey,
          payload,
          status: 'pending',
          createdAt: nowStr
        });
      });

      void NotificationService.checkAndGenerateLowStockAlerts(payload.tenantId).catch(error => console.warn('Low-stock refresh failed:', error));
      return {
        success: true,
        offlineQueued: true,
        transactionId: fallbackTxId,
        referenceNumber: offlineRef,
        counts: {
          items: payload.items.length,
          units: totalUnits,
          totalCost
        }
      };
    } finally {
      this.isSubmitting = false;
    }
  }

  static async getBulkInventoryHistory(opts?: {
    page?: number;
    size?: number;
    reference?: string;
    supplier?: string;
    productName?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<{
    rows: any[];
    total: number;
    page: number;
    size: number;
    totalPages: number;
  }> {
    // 1. Try server API if online
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const params = new URLSearchParams();
        if (opts?.page) params.set('page', String(opts.page));
        if (opts?.size) params.set('size', String(opts.size));
        if (opts?.reference) params.set('reference', opts.reference);
        if (opts?.supplier) params.set('supplier', opts.supplier);
        if (opts?.productName) params.set('productName', opts.productName);
        if (opts?.dateFrom) params.set('dateFrom', opts.dateFrom);
        if (opts?.dateTo) params.set('dateTo', opts.dateTo);

        const res: any = await api.get(`/api/inventory/bulk-history?${params.toString()}`);
        if (res && Array.isArray(res.rows)) {
          return res;
        }
      } catch (err) {
        console.warn('[BULK HISTORY] Server query failed, falling back to local Dexie history:', err);
      }
    }

    // 2. Local Dexie Fallback
    let localRows = await db.bulkInventoryTransactions.orderBy('createdAt').reverse().toArray();

    if (opts?.reference && opts.reference.trim()) {
      const q = opts.reference.trim().toLowerCase();
      localRows = localRows.filter((r: any) => String(r.referenceNumber || r.reference_number || '').toLowerCase().includes(q));
    }
    if (opts?.supplier && opts.supplier.trim()) {
      const q = opts.supplier.trim().toLowerCase();
      localRows = localRows.filter((r: any) => String(r.supplierCompany || r.supplier_company || '').toLowerCase().includes(q));
    }
    if (opts?.dateFrom && opts.dateFrom.trim()) {
      localRows = localRows.filter((r: any) => new Date(r.createdAt || r.created_at) >= new Date(opts.dateFrom!));
    }
    if (opts?.dateTo && opts.dateTo.trim()) {
      localRows = localRows.filter((r: any) => new Date(r.createdAt || r.created_at) <= new Date(opts.dateTo! + 'T23:59:59.999Z'));
    }

    const total = localRows.length;
    const page = Math.max(1, opts?.page || 1);
    const size = Math.min(100, Math.max(1, opts?.size || 20));
    const offset = (page - 1) * size;
    const paged = localRows.slice(offset, offset + size);

    return {
      rows: paged,
      total,
      page,
      size,
      totalPages: Math.ceil(total / size)
    };
  }

  static async getBulkInventoryById(id: string): Promise<{ transaction: any; items: any[]; createdByName?: string; summary?: any } | null> {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const res: any = await api.get(`/api/inventory/bulk-history/${id}`);
        if (res && res.transaction) return res;
      } catch (err) {
        console.warn('[BULK DETAIL] Server detail fetch failed, falling back to Dexie:', err);
      }
    }

    const tx = await db.bulkInventoryTransactions.get(id);
    if (!tx) return null;
    const items = await db.bulkInventoryItems.where('bulkInventoryId').equals(id).toArray();
    return {
      transaction: tx,
      items,
      createdByName: (tx as any).created_by || 'Admin',
      summary: {
        totalItems: items.length,
        totalUnits: items.reduce((sum: number, it: any) => sum + Number(it.quantity || 0), 0),
        totalCost: Number((tx as any).totalCost || (tx as any).total_cost || 0)
      }
    };
  }

  static async flushPendingSubmissions(tenantId?: string): Promise<{ synced: number; failed: number }> {
    const pending = await db.pendingBulkSubmissions.where('status').equals('pending').toArray();
    if (pending.length === 0) return { synced: 0, failed: 0 };

    let synced = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        const payload = item.payload;
        const res: any = await api.post('/api/inventory/bulk', {
          idempotencyKey: payload.idempotencyKey,
          supplierCompany: payload.supplierCompany,
          notes: payload.notes,
          items: payload.items
        });

        if (res && res.success) {
          await db.pendingBulkSubmissions.delete(item.id);
          synced++;
        } else {
          failed++;
        }
      } catch (err) {
        console.warn(`[SYNC FLUSH] Failed to flush pending bulk submission ${item.id}:`, err);
        failed++;
      }
    }

    return { synced, failed };
  }
}
