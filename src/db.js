// RARA POS — database layer (THE DATABASE CONTRACT).
//
// Single local JSON store. In Electron the data file lives in the app's
// userData folder (<userData>/rara-pos-data.json). When required outside
// Electron (plain node, e.g. tests) it falls back to a ./data folder next
// to this file.
//
// Other renderer modules depend on this exact API — do not change the
// exported method names or the state shape without updating every caller:
//
//   DB.load()            load from disk, or seed from ./seed.json on first run
//   DB.save()            persist state to disk (atomic: temp file + rename)
//   DB.state             the in-memory state object
//   DB.nextId(collection)  max id in state[collection] + 1 (cached, O(1))
//   DB.hashPin(pin)      sha256(pin + ':rara-pos-salt') hex
//   DB.checkPin(user, pin)  compare a user's stored pinHash with a PIN
//   DB.stockOf(product, branchId)
//   DB.setStock(product, branchId, qty)
//   DB.addMovement({productId, productName, branchId, qty, reason, user, reference})
//   DB.recalcProductStock(product)
//
// Performance / safety additions (Nov 2026 — software-performance work):
//   DB.buildIndexes()    rebuild all in-memory indexes from state
//   DB.productById(id) / DB.productBySku(sku) / DB.productByBarcode(code)
//   DB.branchById(id) / DB.customerById(id) / DB.customerByPhone(phone)
//   DB.supplierById(id) / DB.saleById(id) / DB.saleByClientRef(ref)
//   DB.userByUsername(username)
//   DB.checkUniqueness(collection, record, excludeId)
//                        data-layer duplicate guard (Roman Urdu message)
//   DB.findDuplicates()  report existing duplicates (never deletes data)
//   DB.createSale(sale)  idempotent sale insert via clientRef
//   DB.salesInRange(fromISO, toISO, branchId)
//                        branch+date indexed report query
//   DB.backup()          verified timestamped backup, keeps last 7
//   DB.backupInfo()      { lastBackup, count, files[] }
//   DB.restoreLatestBackup()
//   DB.costOf(product, user)  purchase price only for Owner, else 0
//   DB.sanitizeState(user)    role-filtered copy — no cost/supplier/
//                        purchase/login data for roles that may not see it
//   DB.requireRole(user, roles, action)  data-layer role check
//   DB.load() now recovers from <data>.bak when the main file is corrupt,
//   and DB.save() keeps that .bak copy of the last good save.
//
// State shape:
//   products, branches, sales, purchases, customers, suppliers, expenses,
//   employees, transfers, stockMovements, cashSessions, appUsers, settings
// See src/seed.json for the exact per-record fields.
// Indexes are in-memory only and are never written to the JSON file, so
// the on-disk format is unchanged.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Resolve the data directory. Inside Electron use app.getPath('userData');
// outside Electron (plain node) fall back to ./data next to this file.
//
// The renderer process cannot call app.getPath() itself (app lives in
// the main process and electron.remote was removed), so main.js sets
// RARA_DATA_DIR in the environment before the window is created and
// the renderer inherits it. That is the first choice; the direct
// app.getPath() call below only works if db.js is ever required from
// the main process, and ./data is only for plain-node tests.
let dataDir;
if (process.env.RARA_DATA_DIR) {
  dataDir = process.env.RARA_DATA_DIR;
} else {
  try {
    const electron = require('electron');
    const app = electron.app || (electron.remote && electron.remote.app);
    if (app && typeof app.getPath === 'function') {
      dataDir = app.getPath('userData');
    }
  } catch (e) {
    // Not running under Electron (or electron not installed) — fall through.
  }
}
if (!dataDir) {
  dataDir = path.join(__dirname, 'data');
}

const DATA_FILE = path.join(dataDir, 'rara-pos-data.json');
const BAK_FILE = DATA_FILE + '.bak';
const BACKUP_DIR = path.join(dataDir, 'backups');
const SEED_FILE = path.join(__dirname, 'seed.json');
const MAX_BACKUPS = 7;

function emptyState() {
  return {
    products: [],
    branches: [],
    sales: [],
    purchases: [],
    customers: [],
    suppliers: [],
    expenses: [],
    employees: [],
    transfers: [],
    stockMovements: [],
    cashSessions: [],
    appUsers: [],
    // PIN brute-force protection (v1.1.5): per-username
    // { attempts, lockedUntil } — persisted here so restarting the app
    // does NOT reset the counter or the lock.
    loginSecurity: {},
    settings: {
      businessName: 'RARA Perfumes & Fashion',
      phone: '',
      address: '',
      defaultBranchId: 2,
      allowNegativeStock: false,
      sessionTimeoutMinutes: 15,
      printerName: ''
    }
  };
}

function saleDateOf(s) {
  return s.createdAt || s.date || s.timestamp || s.time || '';
}

const DB = {
  state: emptyState(),
  dataFile: DATA_FILE,
  backupDir: BACKUP_DIR,
  // Set by load(): 'bak' when the main file was corrupt and the .bak copy
  // was used, 'fresh' when neither file existed and seed/empty was used.
  recoveredFromBackup: false,
  loadError: null,
  // In-memory indexes (never serialised). Rebuilt by buildIndexes().
  indexes: null,

  /* ---------- indexes ---------- */
  buildIndexes() {
    const st = this.state;
    const idx = {
      productById: new Map(),
      productBySku: new Map(),
      productByBarcode: new Map(),
      branchById: new Map(),
      customerById: new Map(),
      customerByPhone: new Map(),
      supplierById: new Map(),
      supplierByName: new Map(),
      saleById: new Map(),
      saleByClientRef: new Map(),
      userByUsername: new Map(),
      maxId: {},
      // branch key ('all' + per-branch) -> sales sorted by date asc
      salesByBranch: new Map(),
      // branch key -> stock movements sorted by date asc
      movementsByBranch: new Map()
    };
    const trackMax = (coll, id) => {
      if (typeof id === 'number' && (!idx.maxId[coll] || id > idx.maxId[coll])) idx.maxId[coll] = id;
    };
    const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
    (st.products || []).forEach((p) => {
      idx.productById.set(String(p.id), p);
      if (p.sku && String(p.sku).trim()) idx.productBySku.set(norm(p.sku), p);
      if (p.barcode && String(p.barcode).trim()) idx.productByBarcode.set(String(p.barcode).trim(), p);
      trackMax('products', p.id);
    });
    (st.branches || []).forEach((b) => { idx.branchById.set(String(b.id), b); trackMax('branches', b.id); });
    (st.customers || []).forEach((c) => {
      idx.customerById.set(String(c.id), c);
      if (c.phone && String(c.phone).trim()) idx.customerByPhone.set(String(c.phone).replace(/\D/g, ''), c);
      trackMax('customers', c.id);
    });
    (st.suppliers || []).forEach((s) => {
      idx.supplierById.set(String(s.id), s);
      if (s.name && String(s.name).trim()) idx.supplierByName.set(norm(s.name), s);
      trackMax('suppliers', s.id);
    });
    (st.sales || []).forEach((s) => {
      idx.saleById.set(String(s.id), s);
      if (s.clientRef) idx.saleByClientRef.set(String(s.clientRef), s);
      trackMax('sales', s.id);
      const key = s.branchId == null ? 'all' : String(s.branchId);
      if (!idx.salesByBranch.has(key)) idx.salesByBranch.set(key, []);
      idx.salesByBranch.get(key).push(s);
      // 'all' holds every sale once — a sale whose branch is already
      // 'all' (unassigned) must not be pushed a second time.
      if (key !== 'all') {
        if (!idx.salesByBranch.has('all')) idx.salesByBranch.set('all', []);
        idx.salesByBranch.get('all').push(s);
      }
    });
    idx.salesByBranch.forEach((arr) => arr.sort((a, b) => String(saleDateOf(a)).localeCompare(String(saleDateOf(b)))));
    (st.stockMovements || []).forEach((m) => {
      trackMax('stockMovements', m.id);
      const key = m.branchId == null ? 'all' : String(m.branchId);
      if (!idx.movementsByBranch.has(key)) idx.movementsByBranch.set(key, []);
      idx.movementsByBranch.get(key).push(m);
      if (key !== 'all') {
        if (!idx.movementsByBranch.has('all')) idx.movementsByBranch.set('all', []);
        idx.movementsByBranch.get('all').push(m);
      }
    });
    idx.movementsByBranch.forEach((arr) => arr.sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))));
    (st.appUsers || []).forEach((u) => {
      if (u.username) idx.userByUsername.set(norm(u.username), u);
      trackMax('appUsers', u.id);
    });
    ['purchases', 'expenses', 'employees', 'transfers', 'cashSessions'].forEach((coll) => {
      (st[coll] || []).forEach((r) => trackMax(coll, r.id));
    });
    this.indexes = idx;
    return idx;
  },

  _idx() {
    return this.indexes || this.buildIndexes();
  },

  /* O(1) lookups — fall back to a scan only if indexes are unavailable. */
  productById(id) {
    if (id == null) return undefined;
    const hit = this._idx().productById.get(String(id));
    if (hit) return hit;
    return (this.state.products || []).find((p) => String(p.id) === String(id));
  },
  productBySku(sku) {
    if (!sku || !String(sku).trim()) return undefined;
    const hit = this._idx().productBySku.get(String(sku).trim().toLowerCase());
    if (hit) return hit;
    return (this.state.products || []).find((p) => p.sku && String(p.sku).trim().toLowerCase() === String(sku).trim().toLowerCase());
  },
  productByBarcode(code) {
    if (!code || !String(code).trim()) return undefined;
    const hit = this._idx().productByBarcode.get(String(code).trim());
    if (hit) return hit;
    return (this.state.products || []).find((p) => p.barcode && String(p.barcode).trim() === String(code).trim());
  },
  productByBarcodeOrSku(code) {
    return this.productByBarcode(code) || this.productBySku(code);
  },
  branchById(id) {
    if (id == null) return undefined;
    return this._idx().branchById.get(String(id)) ||
      (this.state.branches || []).find((b) => String(b.id) === String(id));
  },
  customerById(id) {
    if (id == null) return undefined;
    return this._idx().customerById.get(String(id)) ||
      (this.state.customers || []).find((c) => String(c.id) === String(id));
  },
  customerByPhone(phone) {
    if (!phone || !String(phone).trim()) return undefined;
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return undefined;
    return this._idx().customerByPhone.get(digits) ||
      (this.state.customers || []).find((c) => c.phone && String(c.phone).replace(/\D/g, '') === digits);
  },
  supplierById(id) {
    if (id == null) return undefined;
    return this._idx().supplierById.get(String(id)) ||
      (this.state.suppliers || []).find((s) => String(s.id) === String(id));
  },
  saleById(id) {
    if (id == null) return undefined;
    return this._idx().saleById.get(String(id)) ||
      (this.state.sales || []).find((s) => String(s.id) === String(id));
  },
  saleByClientRef(ref) {
    if (!ref) return undefined;
    return this._idx().saleByClientRef.get(String(ref));
  },
  userByUsername(username) {
    if (!username || !String(username).trim()) return undefined;
    return this._idx().userByUsername.get(String(username).trim().toLowerCase());
  },

  /* ---------- load / save (atomic + .bak recovery) ---------- */
  load() {
    this.recoveredFromBackup = false;
    this.loadError = null;
    const readState = (file) => {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      return Object.assign(emptyState(), parsed);
    };
    if (fs.existsSync(DATA_FILE)) {
      try {
        this.state = readState(DATA_FILE);
      } catch (e) {
        // Main file is corrupt — try the last-good backup copy.
        try {
          this.state = readState(BAK_FILE);
          this.recoveredFromBackup = true;
          this.loadError = 'Main data file kharab thi — pichli achi copy (.bak) se data wapas laya gaya hai.';
          try { this.save(); } catch (saveErr) { /* keep running on the recovered state */ }
        } catch (bakErr) {
          this.state = emptyState();
          this.loadError = 'Data file kharab thi aur backup bhi nahi mila — khaali data se shuru kiya gaya hai. Backup se restore karein.';
        }
      }
    } else if (fs.existsSync(SEED_FILE)) {
      const raw = fs.readFileSync(SEED_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      delete parsed._note;
      this.state = Object.assign(emptyState(), parsed);
      this.save();
    } else {
      this.state = emptyState();
      this.save();
    }
    // Settings defaults for older data files.
    if (!this.state.settings) this.state.settings = {};
    if (this.state.settings.sessionTimeoutMinutes == null) this.state.settings.sessionTimeoutMinutes = 15;
    // v1.1.3 one-time migration: existing installs were seeded before the
    // RARA Township franchise login existed, so seed.json alone never
    // reaches them. Add the login once (username 'township', default PIN
    // 1234, Franchise, branch 3) and remember it with a flag — the flag
    // stops the login coming back if the Owner later deletes or disables
    // it on purpose. Fresh installs get the same login from seed.json.
    if (!this.state.settings.townshipLoginSeeded) {
      this.state.settings.townshipLoginSeeded = true;
      const hasTownship = (this.state.appUsers || []).some((u) => String(u.username || '').toLowerCase() === 'township');
      const townshipBranch = (this.state.branches || []).find((b) => String(b.id) === '3');
      if (!hasTownship && townshipBranch) {
        this.state.appUsers = this.state.appUsers || [];
        this.state.appUsers.push({
          id: this.nextId('appUsers'),
          name: 'RARA Township', username: 'township',
          pinHash: this.hashPin('1234'),
          role: 'Franchise', branchId: townshipBranch.id, branchName: townshipBranch.name,
          isActive: true,
        });
        try { this.save(); } catch (e) { /* migration runs again next load */ }
      }
    }
    // v1.1.5 one-time migration: existing installs were seeded before the
    // RARA Outlet salesman login existed, so seed.json alone never
    // reaches them. Add the login once (username 'salesman', default PIN
    // 1234, Salesman, branch 2) and remember it with a flag — the flag
    // stops the login coming back if the Owner later deletes or disables
    // it on purpose. Fresh installs get the same login from seed.json.
    if (!this.state.settings.salesmanLoginSeeded) {
      this.state.settings.salesmanLoginSeeded = true;
      const hasSalesman = (this.state.appUsers || []).some((u) => String(u.username || '').toLowerCase() === 'salesman');
      const outletBranch = (this.state.branches || []).find((b) => String(b.id) === '2');
      if (!hasSalesman && outletBranch) {
        this.state.appUsers = this.state.appUsers || [];
        this.state.appUsers.push({
          id: this.nextId('appUsers'),
          name: 'Outlet Salesman', username: 'salesman',
          pinHash: this.hashPin('1234'),
          role: 'Salesman', branchId: outletBranch.id, branchName: outletBranch.name,
          isActive: true,
        });
        try { this.save(); } catch (e) { /* migration runs again next load */ }
      }
    }
    // v1.1.5 one-time migration: the bill location is branch-specific —
    // the receipt prints ONLY the sale branch's address line (no branch
    // name). Set the Outlet (branch 2) and Township (branch 3) addresses
    // to the Owner's exact texts. Branch 1 (Main Warehouse) keeps its
    // existing address. Guarded by a flag so an Owner edit afterwards is
    // never overwritten. Fresh installs get the same addresses from
    // seed.json.
    if (!this.state.settings.billAddressesSeeded) {
      this.state.settings.billAddressesSeeded = true;
      const setAddr = (id, address) => {
        const b = (this.state.branches || []).find((x) => String(x.id) === String(id));
        if (b) b.address = address;
      };
      setAddr(2, 'RARA Outlet Near Lady Park, Railway bannu city');
      setAddr(3, 'RARA Outlet 2, Khan Plaza, Link Road Chowk, Township, Bannu');
      try { this.save(); } catch (e) { /* migration runs again next load */ }
    }
    this.buildIndexes();
    return this.state;
  },

  // Atomic save: keep a .bak copy of the last good file, write to a temp
  // file in the same folder, then rename over the real file, so a crash
  // mid-write never leaves a half file. Indexes are rebuilt first so
  // they always match the state that was just saved.
  save() {
    fs.mkdirSync(dataDir, { recursive: true });
    this.buildIndexes();
    const tmpFile = DATA_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(this.state, null, 2), 'utf8');
    // Preserve the previous good file as .bak before replacing it.
    try {
      if (fs.existsSync(DATA_FILE)) {
        const prev = fs.readFileSync(DATA_FILE, 'utf8');
        JSON.parse(prev); // only back up a file that parses
        fs.writeFileSync(BAK_FILE, prev, 'utf8');
      }
    } catch (e) { /* a corrupt previous file is not worth backing up */ }
    fs.renameSync(tmpFile, DATA_FILE);
  },

  nextId(collection) {
    const idx = this._idx();
    if (typeof idx.maxId[collection] === 'number') return idx.maxId[collection] + 1;
    const rows = this.state[collection] || [];
    let max = 0;
    for (const row of rows) {
      if (typeof row.id === 'number' && row.id > max) max = row.id;
    }
    return max + 1;
  },

  hashPin(pin) {
    return crypto.createHash('sha256').update(String(pin) + ':rara-pos-salt').digest('hex');
  },

  checkPin(user, pin) {
    if (!user || !user.pinHash) return false;
    return user.pinHash === this.hashPin(pin);
  },

  /* ---------- PIN brute-force protection (v1.1.5) ---------- */
  // After LOCKOUT_AFTER consecutive wrong PINs for one username, that
  // login is locked for LOCKOUT_MINUTES minutes. The counter and the
  // lock live in state.loginSecurity (the local data file), so restarting
  // the app does NOT reset them. A successful login clears the counter.
  // There is NO reset path except waiting out the lock (or a successful
  // Owner login resetting that Owner's own counter) — a locked-out Owner
  // cannot be unlocked by any non-Owner user.
  LOCKOUT_AFTER: 5,
  LOCKOUT_MINUTES: 15,
  _loginSecurity() {
    if (!this.state.loginSecurity || typeof this.state.loginSecurity !== 'object') this.state.loginSecurity = {};
    return this.state.loginSecurity;
  },
  _loginSecKey(username) { return String(username == null ? '' : username).trim().toLowerCase(); },
  // { locked: bool, attempts: n, remainingMs, remainingMinutes }
  isLoginLocked(username) {
    const sec = this._loginSecurity();
    const rec = sec[this._loginSecKey(username)];
    if (!rec) return { locked: false, attempts: 0, remainingMs: 0, remainingMinutes: 0 };
    if (rec.lockedUntil && Date.now() >= rec.lockedUntil) {
      delete sec[this._loginSecKey(username)];
      try { this.save(); } catch (e) { /* lock clears on next load */ }
      return { locked: false, attempts: 0, remainingMs: 0, remainingMinutes: 0 };
    }
    if (rec.lockedUntil) {
      const remainingMs = rec.lockedUntil - Date.now();
      return { locked: true, attempts: rec.attempts || 0, remainingMs: remainingMs, remainingMinutes: Math.max(1, Math.ceil(remainingMs / 60000)) };
    }
    return { locked: false, attempts: rec.attempts || 0, remainingMs: 0, remainingMinutes: 0 };
  },
  // Call after a wrong PIN. Returns { locked: bool, attempts: n }.
  recordFailedLogin(username) {
    const sec = this._loginSecurity();
    const key = this._loginSecKey(username);
    const rec = sec[key] || { attempts: 0, lockedUntil: null };
    rec.attempts = (rec.attempts || 0) + 1;
    let locked = false;
    if (rec.attempts >= this.LOCKOUT_AFTER) {
      rec.lockedUntil = Date.now() + this.LOCKOUT_MINUTES * 60 * 1000;
      locked = true;
    }
    sec[key] = rec;
    try { this.save(); } catch (e) { /* counter lives in memory until the next save */ }
    return { locked: locked, attempts: rec.attempts };
  },
  // Call after a successful login — resets the counter to zero.
  recordSuccessfulLogin(username) {
    const sec = this._loginSecurity();
    const key = this._loginSecKey(username);
    if (sec[key]) {
      delete sec[key];
      try { this.save(); } catch (e) { /* cleared on next load */ }
    }
  },

  /* ---------- uniqueness (data layer — never UI-only) ---------- */
  // Returns { ok: true } or { ok: false, message } (Roman Urdu).
  // Empty values are ignored — e.g. a product without a barcode is never
  // a "duplicate barcode". excludeId skips the record being edited.
  checkUniqueness(collection, record, excludeId) {
    const same = (a, b) => String(a) === String(b);
    if (collection === 'products') {
      if (record.sku && String(record.sku).trim()) {
        const hit = this.productBySku(record.sku);
        if (hit && !same(hit.id, excludeId)) return { ok: false, message: 'Ye SKU pehle se mojood hai (' + (hit.name || '') + ') — duplicate SKU allow nahi hai.' };
      }
      if (record.barcode && String(record.barcode).trim()) {
        const hit = this.productByBarcode(record.barcode);
        if (hit && !same(hit.id, excludeId)) return { ok: false, message: 'Ye Barcode pehle se mojood hai (' + (hit.name || '') + ') — duplicate barcode allow nahi hai.' };
      }
    }
    if (collection === 'customers') {
      if (record.phone && String(record.phone).trim()) {
        const hit = this.customerByPhone(record.phone);
        if (hit && !same(hit.id, excludeId)) return { ok: false, message: 'Is phone number par customer pehle se mojood hai (' + (hit.name || '') + ').' };
      }
    }
    if (collection === 'suppliers') {
      if (record.name && String(record.name).trim()) {
        const hit = this._idx().supplierByName.get(String(record.name).trim().toLowerCase());
        if (hit && !same(hit.id, excludeId)) return { ok: false, message: 'Is naam ka supplier pehle se mojood hai.' };
      }
    }
    if (collection === 'appUsers') {
      if (record.username && String(record.username).trim()) {
        const hit = this.userByUsername(record.username);
        if (hit && !same(hit.id, excludeId)) return { ok: false, message: 'Ye username pehle se mojood hai — koi aur username chunein.' };
      }
    }
    if (collection === 'branches') {
      if (record.name && String(record.name).trim()) {
        const hit = (this.state.branches || []).find((b) => String(b.name).trim().toLowerCase() === String(record.name).trim().toLowerCase());
        if (hit && !same(hit.id, excludeId)) return { ok: false, message: 'Is naam ki branch pehle se mojood hai.' };
      }
    }
    return { ok: true };
  },

  // Scan the current data for duplicates. Reports only — never deletes
  // or changes user data. Returns { products: [], customers: [], ... }
  // where each entry is { field, value, ids: [], names: [] }.
  findDuplicates() {
    const out = { products: [], customers: [], suppliers: [], appUsers: [], branches: [] };
    const collect = (rows, keyFn, label) => {
      const seen = new Map();
      (rows || []).forEach((r) => {
        const key = keyFn(r);
        if (key == null || String(key).trim() === '') return;
        const k = String(key).trim().toLowerCase();
        if (!seen.has(k)) seen.set(k, []);
        seen.get(k).push(r);
      });
      const dups = [];
      seen.forEach((rowsForKey, k) => {
        if (rowsForKey.length > 1) dups.push({ field: label, value: k, ids: rowsForKey.map((r) => r.id), names: rowsForKey.map((r) => r.name || r.username || '') });
      });
      return dups;
    };
    out.products = out.products.concat(collect(this.state.products, (p) => p.sku, 'SKU'));
    out.products = out.products.concat(collect(this.state.products, (p) => p.barcode, 'Barcode'));
    out.customers = collect(this.state.customers, (c) => (c.phone || '').replace(/\D/g, ''), 'Phone');
    out.suppliers = collect(this.state.suppliers, (s) => s.name, 'Name');
    out.appUsers = collect(this.state.appUsers, (u) => u.username, 'Username');
    out.branches = collect(this.state.branches, (b) => b.name, 'Name');
    return out;
  },

  /* ---------- idempotent sales ---------- */
  // Insert a sale exactly once. If a sale with the same clientRef already
  // exists (double-submit / retry / double-click), the existing sale is
  // returned and nothing is inserted — so stock is never deducted twice.
  // Returns { sale, created: true|false }.
  createSale(sale) {
    if (sale.clientRef) {
      const existing = this.saleByClientRef(sale.clientRef);
      if (existing) return { sale: existing, created: false };
    }
    if (sale.id == null) sale.id = this.nextId('sales');
    this.state.sales = this.state.sales || [];
    this.state.sales.unshift(sale);
    this.buildIndexes();
    return { sale, created: true };
  },

  /* ---------- indexed report query ---------- */
  // Sales in a date range for one branch ('all' for every branch), using
  // the branch+date index instead of scanning every sale. Dates are
  // 'YYYY-MM-DD' strings; the range is inclusive. Legacy sales with a
  // null branchId are included for every branch filter (they are
  // unassigned), matching the previous scan behaviour.
  salesInRange(fromISO, toISO, branchId) {
    const idx = this._idx();
    const key = branchId == null || branchId === 'all' ? 'all' : String(branchId);
    let arr = idx.salesByBranch.get(key) || [];
    if (key !== 'all') {
      const unassigned = idx.salesByBranch.get('all') || [];
      // 'all' holds every sale; unassigned ones are those with null branch.
      const extra = unassigned.filter((s) => s.branchId == null);
      arr = arr.concat(extra);
    }
    const from = fromISO ? String(fromISO).slice(0, 10) : null;
    const to = toISO ? String(toISO).slice(0, 10) : null;
    if (!from && !to) return arr.slice();
    return arr.filter((s) => {
      const d = String(saleDateOf(s)).slice(0, 10);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  },

  movementsInRange(fromISO, toISO, branchId) {
    const idx = this._idx();
    const key = branchId == null || branchId === 'all' ? 'all' : String(branchId);
    let arr = idx.movementsByBranch.get(key) || [];
    if (key !== 'all') {
      const extra = (idx.movementsByBranch.get('all') || []).filter((m) => m.branchId == null);
      arr = arr.concat(extra);
    }
    const from = fromISO ? String(fromISO).slice(0, 10) : null;
    const to = toISO ? String(toISO).slice(0, 10) : null;
    if (!from && !to) return arr.slice();
    return arr.filter((m) => {
      const d = String(m.date || '').slice(0, 10);
      if (!d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  },

  /* ---------- backup (verified, keeps last 7) ---------- */
  backup() {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const now = new Date();
      const stamp = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') +
        '_' + String(now.getHours()).padStart(2, '0') + '-' + String(now.getMinutes()).padStart(2, '0') + '-' + String(now.getSeconds()).padStart(2, '0') +
        '-' + String(now.getMilliseconds()).padStart(3, '0');
      const file = path.join(BACKUP_DIR, 'rara-pos-backup-' + stamp + '.json');
      // Two backups in the same millisecond must never overwrite each
      // other — suffix until the name is free.
      let dest = file, n = 0;
      while (fs.existsSync(dest)) { n += 1; dest = path.join(BACKUP_DIR, 'rara-pos-backup-' + stamp + '-' + n + '.json'); }
      const payload = JSON.stringify(this.state, null, 2);
      fs.writeFileSync(dest, payload, 'utf8');
      // Verify: read it back and parse it. A backup that cannot be read
      // back is not a backup.
      const check = JSON.parse(fs.readFileSync(dest, 'utf8'));
      if (!check || !Array.isArray(check.products)) throw new Error('Backup verify nahi hua');
      // Prune to the newest MAX_BACKUPS files.
      const files = fs.readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith('rara-pos-backup-') && f.endsWith('.json'))
        .map((f) => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      files.slice(MAX_BACKUPS).forEach((f) => { try { fs.unlinkSync(path.join(BACKUP_DIR, f.name)); } catch (e) { /* ignore */ } });
      return { ok: true, path: dest, name: path.basename(dest), at: now.toISOString() };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  },

  backupInfo() {
    try {
      if (!fs.existsSync(BACKUP_DIR)) return { lastBackup: null, count: 0, files: [] };
      const files = fs.readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith('rara-pos-backup-') && f.endsWith('.json'))
        .map((f) => {
          const st = fs.statSync(path.join(BACKUP_DIR, f));
          return { name: f, path: path.join(BACKUP_DIR, f), at: st.mtime.toISOString(), size: st.size };
        })
        .sort((a, b) => (b.at < a.at ? -1 : 1));
      return { lastBackup: files.length ? files[0].at : null, count: files.length, files };
    } catch (e) {
      return { lastBackup: null, count: 0, files: [], error: e && e.message ? e.message : String(e) };
    }
  },

  // Replace current data with the newest verified backup. Returns
  // { ok, at } or { ok: false, message } (Roman Urdu).
  restoreLatestBackup() {
    const info = this.backupInfo();
    if (!info.files.length) return { ok: false, message: 'Koi backup nahi mila — pehle backup banayein.' };
    try {
      const raw = fs.readFileSync(info.files[0].path, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.products) || !Array.isArray(parsed.branches)) {
        return { ok: false, message: 'Backup file sahi nahi hai — restore nahi ho saka.' };
      }
      // Keep a safety copy of the current (possibly broken) state first.
      try { this.backup(); } catch (e) { /* ignore */ }
      this.state = Object.assign(emptyState(), parsed);
      if (this.state.settings.sessionTimeoutMinutes == null) this.state.settings.sessionTimeoutMinutes = 15;
      this.save();
      return { ok: true, at: info.files[0].at };
    } catch (e) {
      return { ok: false, message: 'Backup restore nahi ho saka: ' + (e && e.message ? e.message : 'unknown error') };
    }
  },

  /* ---------- security: role-aware data access ---------- */
  // Purchase price is Owner-only. Every other role gets 0, so cost can
  // never leak into a sale record, a report or the dashboard for a
  // cashier/manager.
  costOf(product, user) {
    if (user && user.role === 'Owner') return Number(product && product.purchasePrice) || 0;
    return 0;
  },

  requireRole(user, roles, action) {
    const role = user && user.role;
    if (!user || roles.indexOf(role) === -1) {
      throw new Error('Is kaam ki permission nahi hai' + (action ? ' — ' + action : ''));
    }
    return true;
  },

  // A copy of the state safe to hand to a renderer for this role:
  // non-Owners never receive purchase/wholesale/franchise prices,
  // suppliers, purchases or logins (and non-Owner/non-Manager roles also
  // lose expenses, employees and cash sessions). PIN hashes are never
  // included for any role — logins are only ever checked via checkPin.
  //
  // FRANCHISE exception (v1.1.3, at the user's explicit instruction):
  // the RARA Township franchise login DOES see its OWN branch's profit,
  // so its copy KEEPS purchasePrice (profit = revenue - cost needs it)
  // and its OWN branch's sales, expenses, stock movements and transfers.
  // It still never receives suppliers, purchases, logins, employees or
  // cash sessions, and never any other branch's rows. Showing profit
  // necessarily reveals margins — that is the Owner's call.
  sanitizeState(user) {
    const role = user && user.role;
    const copy = JSON.parse(JSON.stringify(this.state));
    const ownBranch = user && user.branchId != null ? String(user.branchId) : null;
    copy.products = (copy.products || []).map((p) => {
      if (role !== 'Owner' && role !== 'Franchise') { p.purchasePrice = 0; p.wholesalePrice = 0; p.franchisePrice = 0; }
      return p;
    });
    if (role === 'Franchise' && ownBranch) {
      const own = (rows) => (rows || []).filter((r) => String(r.branchId) === ownBranch);
      const ownTransfer = (rows) => (rows || []).filter((r) => String(r.fromBranchId) === ownBranch || String(r.toBranchId) === ownBranch);
      copy.sales = own(copy.sales);
      copy.expenses = own(copy.expenses);
      copy.stockMovements = own(copy.stockMovements);
      copy.transfers = ownTransfer(copy.transfers);
      copy.branches = (copy.branches || []).filter((b) => String(b.id) === ownBranch);
    }
    if (role !== 'Owner') {
      copy.suppliers = [];
      copy.purchases = [];
      copy.appUsers = [];
    }
    if (role !== 'Owner' && role !== 'Manager' && role !== 'Franchise') {
      copy.expenses = [];
      copy.employees = [];
      copy.cashSessions = [];
    }
    if (role === 'Franchise') {
      copy.employees = [];
      copy.cashSessions = [];
    }
    return copy;
  },

  /* ---------- stock ---------- */
  // Total stock of a product across branches when branchId is omitted;
  // the stock held at one branch when it is given.
  stockOf(product, branchId) {
    if (!product) return 0;
    if (branchId === undefined || branchId === null) {
      if (typeof product.stock === 'number') return product.stock;
      return (product.branchStocks || []).reduce((sum, b) => sum + (b.qty || 0), 0);
    }
    const row = (product.branchStocks || []).find(b => b.branchId === branchId);
    return row ? row.qty : 0;
  },

  setStock(product, branchId, qty) {
    if (!product) return;
    qty = Math.max(0, Number(qty) || 0);
    product.branchStocks = product.branchStocks || [];
    const row = product.branchStocks.find(b => b.branchId === branchId);
    if (row) {
      row.qty = qty;
    } else {
      product.branchStocks.push({ branchId, qty });
    }
    this.recalcProductStock(product);
  },

  addMovement(movement) {
    const now = new Date().toISOString();
    const record = {
      id: this.nextId('stockMovements'),
      productId: movement.productId,
      productName: movement.productName || '',
      branchId: movement.branchId !== undefined ? movement.branchId : null,
      qty: movement.qty,
      date: movement.date || now,
      reason: movement.reason || '',
      user: movement.user || '',
      reference: movement.reference || ''
    };
    this.state.stockMovements.push(record);
    // Keep the movement index in step without a full rebuild.
    const idx = this.indexes;
    if (idx) {
      const key = record.branchId == null ? 'all' : String(record.branchId);
      const keys = key === 'all' ? ['all'] : [key, 'all'];
      keys.forEach((k) => {
        if (!idx.movementsByBranch.has(k)) idx.movementsByBranch.set(k, []);
        idx.movementsByBranch.get(k).push(record);
      });
      if (typeof idx.maxId.stockMovements !== 'number' || record.id > idx.maxId.stockMovements) idx.maxId.stockMovements = record.id;
    }
    return record;
  },

  // Recompute a product's total stock from its per-branch stocks.
  recalcProductStock(product) {
    if (!product) return 0;
    product.stock = (product.branchStocks || []).reduce((sum, b) => sum + (b.qty || 0), 0);
    return product.stock;
  }
};

module.exports = DB;
