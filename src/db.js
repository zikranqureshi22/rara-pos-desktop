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
//   DB.nextId(collection)  max id in state[collection] + 1
//   DB.hashPin(pin)      sha256(pin + ':rara-pos-salt') hex
//   DB.checkPin(user, pin)  compare a user's stored pinHash with a PIN
//   DB.stockOf(product, branchId)
//   DB.setStock(product, branchId, qty)
//   DB.addMovement({productId, productName, branchId, qty, reason, user, reference})
//   DB.recalcProductStock(product)
//
// State shape:
//   products, branches, sales, purchases, customers, suppliers, expenses,
//   employees, transfers, stockMovements, cashSessions, appUsers, settings
// See src/seed.json for the exact per-record fields.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Resolve the data directory. Inside Electron use app.getPath('userData');
// outside Electron (plain node) fall back to ./data next to this file.
let dataDir;
try {
  const electron = require('electron');
  const app = electron.app || (electron.remote && electron.remote.app);
  if (app && typeof app.getPath === 'function') {
    dataDir = app.getPath('userData');
  }
} catch (e) {
  // Not running under Electron (or electron not installed) — fall through.
}
if (!dataDir) {
  dataDir = path.join(__dirname, 'data');
}

const DATA_FILE = path.join(dataDir, 'rara-pos-data.json');
const SEED_FILE = path.join(__dirname, 'seed.json');

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
    settings: {
      businessName: 'RARA Perfumes & Fashion',
      phone: '',
      address: '',
      defaultBranchId: 2,
      allowNegativeStock: false
    }
  };
}

const DB = {
  state: emptyState(),
  dataFile: DATA_FILE,

  load() {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      // Merge over the empty shape so older data files missing a new
      // collection still load with every key present.
      this.state = Object.assign(emptyState(), parsed);
      return this.state;
    }
    if (fs.existsSync(SEED_FILE)) {
      const raw = fs.readFileSync(SEED_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      delete parsed._note;
      this.state = Object.assign(emptyState(), parsed);
    } else {
      this.state = emptyState();
    }
    this.save();
    return this.state;
  },

  // Atomic save: write to a temp file in the same folder, then rename
  // over the real file, so a crash mid-write never leaves a half file.
  save() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmpFile = DATA_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmpFile, DATA_FILE);
  },

  nextId(collection) {
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
