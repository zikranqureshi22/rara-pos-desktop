/* RARA POS — renderer core (Agent B).
 * Contract: window.App exposes {state, user, theme, go, notify, money,
 * branchName, stockOf, canSeeCost, can, currentBranchId, save}.
 * window.Screens = {} registry; each screen module registers
 * Screens.<name> = function render(containerEl) {...}.
 *
 * Expected DB.state shape (src/db.js / src/seed.json — numeric ids):
 *   state.settings   { businessName, defaultBranchId (number), allowNegativeStock }
 *   state.branches   [{ id (number), name, type, ... }]
 *   state.products   [{ id (number), name, sku, barcode, price, purchasePrice,
 *                       wholesalePrice, franchisePrice, size, color, brand,
 *                       supplierName, category, status, notes, lowThreshold,
 *                       image (asset path or data URL), imageData,
 *                       stock (total number), branchStocks: [{branchId, qty}] }]
 *   state.appUsers   [{ id, name, username, pinHash (sha256 via DB.hashPin),
 *                       role, branchId (null for Owner), branchName, isActive }]
 *   state.customers  [{ id, name, phone, address, balance }]
 *   state.sales      [{ id, branchId, branchName, createdAt, customerId,
 *                       customerName, customerPhone,
 *                       items: [{productId, productName, qty, unitPrice,
 *                                lineDiscount, lineTotal, cost}],
 *                       subtotal, discount, total, paidAmount, balanceDue,
 *                       paymentMethod, cashier, status, returns: [] }]
 *   state.stockMovements [{ id, productId, productName, branchId, qty,
 *                       date, reason, user, reference }] (see also
 *                       management.js logMovement shape: change/type)
 *   state.transfers  [{ id, date, fromBranchId, toBranchId,
 *                       items: [{productId, qty, received}], status, createdBy }]
 * Stock reads/writes go through DB.stockOf / DB.setStock / DB.addMovement
 * (branchStocks array; branch ids are numbers — option values from <select>
 * are strings, so App normalises them with normBranchId()).
 */
/* NOTE on the contract snippet `require('./db.js')`: in the Electron
 * renderer, a relative require inside a classic <script> resolves against
 * the HTML document (project root), not the JS file — so './db.js' throws
 * MODULE_NOT_FOUND when the page is index.html and db.js lives in src/.
 * Verified in a real headless Electron run. The fallback below keeps the
 * contract form first and resolves via src/ when needed. Sibling modules
 * (dashboard/management/reports/settings) use the bare form and will hit
 * the same error until they add the same fallback. */
const DB = (function () { try { return require('./db.js'); } catch (e) { return require('./src/db.js'); } })();
DB.load();
const state = DB.state;

window.Screens = window.Screens || {};

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function ensureState() {
  const s = DB.state || state;
  if (!s.settings) s.settings = {};
  if (!s.settings.businessName) s.settings.businessName = 'RARA Perfumes & Fashion';
  if (typeof s.settings.allowNegativeStock !== 'boolean') s.settings.allowNegativeStock = false;
  if (!Array.isArray(s.branches)) s.branches = [];
  if (s.branches.length === 0) s.branches.push({ id: 1, name: 'RARA Outlet 1' });
  if (s.settings.defaultBranchId === undefined || s.settings.defaultBranchId === null) s.settings.defaultBranchId = s.branches[0].id;
  if (!Array.isArray(s.products)) s.products = [];
  if (!Array.isArray(s.appUsers)) s.appUsers = [];
  if (!Array.isArray(s.customers)) s.customers = [];
  if (!Array.isArray(s.sales)) s.sales = [];
  if (!Array.isArray(s.stockMovements)) s.stockMovements = [];
  if (!Array.isArray(s.transfers)) s.transfers = [];
  if (!Array.isArray(s.purchases)) s.purchases = [];
  if (!Array.isArray(s.suppliers)) s.suppliers = [];
  if (!Array.isArray(s.expenses)) s.expenses = [];
  if (!Array.isArray(s.employees)) s.employees = [];
  return s;
}
function dbSave() {
  try { App.state = DB.state; DB.save(); } catch (e) { /* DB.save is the persistence hook; never crash the UI on it */ }
}

/* ---------- Role / permission model ---------- */
const OWNER_ONLY = ['sale-cancel', 'settings', 'reports', 'purchases', 'suppliers', 'logins'];
const NAV = [
  { id: 'dashboard', label: 'Dashboard', action: 'dashboard' },
  { id: 'pos', label: 'Sale', action: 'sale' },
  { id: 'products', label: 'Products', action: 'products' },
  { id: 'stock', label: 'Stock', action: 'stock' },
  { id: 'sales', label: 'Sales History', action: 'sales' },
  { id: 'purchases', label: 'Purchases', action: 'purchases' },
  { id: 'customers', label: 'Customers', action: 'customers' },
  { id: 'suppliers', label: 'Suppliers', action: 'suppliers' },
  { id: 'expenses', label: 'Expenses', action: 'expenses' },
  { id: 'employees', label: 'Employees', action: 'employees' },
  { id: 'cash', label: 'Cash Register', action: 'cash' },
  { id: 'branches', label: 'Branches', action: 'branches' },
  { id: 'logins', label: 'Logins', action: 'logins' },
  { id: 'reports', label: 'Reports', action: 'reports' },
  { id: 'settings', label: 'Settings', action: 'settings' },
];

const App = {
  state: DB.state,
  user: null,
  theme: 'dark',
  currentScreen: null,
  _branchId: null,      // Owner's selected branch (header selector)
  _selectedLoginUser: null,

  /* ----- lifecycle ----- */
  init() {
    ensureState();
    this.state = DB.state;
    const savedTheme = (() => { try { return localStorage.getItem('rara-pos-theme'); } catch (e) { return null; } })();
    this.theme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark';
    this.applyTheme();
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.addEventListener('click', () => this.toggleTheme());
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', () => this.logout());
    const branchSel = document.getElementById('branch-select');
    if (branchSel) branchSel.addEventListener('change', (e) => {
      this._branchId = this.normBranchId(e.target.value || null);
      this.save();
      this.go(this.currentScreen || 'pos');
    });
    this.updateNetBadge();
    window.addEventListener('online', () => this.updateNetBadge());
    window.addEventListener('offline', () => this.updateNetBadge());
    this.renderLogin();
  },

  save() { dbSave(); },

  /* ----- theme ----- */
  applyTheme() {
    document.body.setAttribute('data-theme', this.theme);
    const toggle = document.getElementById('theme-toggle');
    if (toggle) toggle.textContent = this.theme === 'dark' ? 'Light Mode' : 'Dark Mode';
    const darkLogo = 'assets/rara-logo-dark.png';
    const lightLogo = 'assets/rara-logo-light.jpg';
    const headerImg = document.getElementById('header-logo-img');
    const loginImg = document.getElementById('login-logo-img');
    const src = this.theme === 'dark' ? darkLogo : lightLogo;
    [headerImg, loginImg].forEach((img) => {
      if (!img) return;
      img.style.display = '';
      img.src = src;
    });
    const headerText = document.getElementById('header-logo-text');
    if (headerImg && headerText) {
      // If the logo file is missing, the img hides itself via onerror and
      // the text logo shows instead.
      headerText.style.display = 'none';
      headerImg.onerror = () => { headerImg.style.display = 'none'; headerText.style.display = ''; };
    }
  },
  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('rara-pos-theme', this.theme); } catch (e) { /* private mode */ }
    this.applyTheme();
    this.notify(this.theme === 'dark' ? 'Dark theme lag gaya' : 'Light theme lag gaya', 'info');
  },

  updateNetBadge() {
    const badge = document.getElementById('net-badge');
    if (!badge) return;
    const online = typeof navigator !== 'undefined' ? navigator.onLine : false;
    if (online) {
      badge.textContent = 'Online';
      badge.className = 'badge badge-online';
    } else {
      badge.textContent = 'Offline — Local';
      badge.className = 'badge badge-offline';
    }
  },

  /* ----- money / branches / stock ----- */
  money(n) {
    const v = Number(n) || 0;
    const formatted = Number.isInteger(v)
      ? v.toLocaleString('en-US')
      : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return 'Rs ' + formatted;
  },
  branchName(id) {
    const b = (this.state.branches || []).find((x) => String(x.id) === String(id));
    return b ? b.name : (id === null || id === undefined || id === '' ? '—' : String(id));
  },
  // Branch ids are numbers in DB; <select> values are strings. Normalise to
  // the branch's real id type so DB.stockOf's strict === lookup works.
  normBranchId(id) {
    if (id === null || id === undefined || id === '') return id;
    const b = (this.state.branches || []).find((x) => String(x.id) === String(id));
    return b ? b.id : id;
  },
  stockOf(product, branchId) {
    if (!product) return 0;
    try {
      if (DB.stockOf) return Number(DB.stockOf(product, branchId === undefined ? undefined : this.normBranchId(branchId))) || 0;
    } catch (e) { /* fall through to manual read */ }
    if (branchId === undefined || branchId === null) return Number(product.stock) || 0;
    const row = (product.branchStocks || []).find((b) => String(b.branchId) === String(branchId));
    return row ? Number(row.qty) || 0 : 0;
  },
  totalStock(product) {
    if (!product) return 0;
    try { if (DB.stockOf) return Number(DB.stockOf(product)) || 0; } catch (e) { /* fall through */ }
    return Number(product.stock) || 0;
  },
  setStock(product, branchId, qty) {
    const bid = this.normBranchId(branchId);
    try {
      if (DB.setStock) { DB.setStock(product, bid, qty); return; }
    } catch (e) { /* fall through */ }
    product.branchStocks = product.branchStocks || [];
    const row = product.branchStocks.find((b) => String(b.branchId) === String(bid));
    if (row) row.qty = Math.max(0, Number(qty) || 0);
    else product.branchStocks.push({ branchId: bid, qty: Math.max(0, Number(qty) || 0) });
    product.stock = product.branchStocks.reduce((a, b) => a + (Number(b.qty) || 0), 0);
  },
  adjustStock(product, branchId, delta, reason, ref) {
    const bid = this.normBranchId(branchId);
    const next = this.stockOf(product, bid) + Number(delta);
    this.setStock(product, bid, next);
    const movement = {
      productId: product.id, productName: product.name || '',
      branchId: bid, qty: Number(delta), reason: reason || 'Adjustment',
      user: this.user ? this.user.name : '', reference: ref || '',
    };
    try {
      if (DB.addMovement) DB.addMovement(movement);
      else throw new Error('no DB.addMovement');
    } catch (e) {
      (this.state.stockMovements = this.state.stockMovements || []).unshift(Object.assign(
        { id: Date.now(), date: new Date().toISOString() }, movement));
    }
    return next;
  },

  /* ----- roles ----- */
  canSeeCost() { return !!this.user && this.user.role === 'Owner'; },
  can(action) {
    if (!this.user) return false;
    const role = this.user.role;
    if (role === 'Owner') return true;
    if (OWNER_ONLY.indexOf(action) !== -1) return false;
    if (role === 'Manager') {
      return ['dashboard', 'sale', 'return', 'products', 'stock', 'sales',
              'customers', 'expenses', 'cash'].indexOf(action) !== -1;
    }
    if (role === 'Cashier') {
      // Cashier: sale + return + own stock only (plus own sales history).
      return ['sale', 'return', 'stock', 'sales'].indexOf(action) !== -1;
    }
    if (role === 'Franchise') {
      return ['dashboard', 'sale', 'return', 'products', 'stock', 'sales',
              'customers', 'cash'].indexOf(action) !== -1;
    }
    return false;
  },
  currentBranchId() {
    const fallback = (this.state.settings && this.state.settings.defaultBranchId !== undefined && this.state.settings.defaultBranchId !== null)
      ? this.state.settings.defaultBranchId
      : (this.state.branches[0] && this.state.branches[0].id);
    if (!this.user) return this.normBranchId(fallback);
    if (this.user.role === 'Owner') {
      return this.normBranchId(this._branchId !== null && this._branchId !== undefined ? this._branchId : fallback);
    }
    return this.normBranchId(this.user.branchId !== null && this.user.branchId !== undefined ? this.user.branchId : fallback);
  },
  setBranch(id) { this._branchId = this.normBranchId(id); this.save(); this.renderHeader(); },

  /* ----- navigation ----- */
  go(screenName) {
    if (!this.user) { this.renderLogin(); return; }
    const nav = NAV.find((n) => n.id === screenName);
    if (nav && !this.can(nav.action)) {
      this.notify('Is screen ki permission nahi hai', 'error');
      return;
    }
    if (screenName === 'pos' && !this.can('sale')) { this.notify('Is screen ki permission nahi hai', 'error'); return; }
    this.currentScreen = screenName;
    this.renderSidebar();
    const container = document.getElementById('screen');
    if (!container) return;
    container.innerHTML = '';
    const fn = window.Screens[screenName];
    if (typeof fn === 'function') {
      try { fn(container); }
      catch (e) {
        container.innerHTML = '';
        container.appendChild(el('<div class="card"><h2>Masla</h2><p>Screen load nahi ho saki: ' + esc(e.message || e) + '</p></div>'));
      }
    } else {
      container.appendChild(el(
        '<div class="card"><h2>' + esc(nav ? nav.label : screenName) + '</h2>' +
        '<p class="muted">Ye screen abhi tayyar ho raha hai. Baraye meharbani thodi der baad dobara koshish karein.</p></div>'
      ));
    }
    window.scrollTo(0, 0);
  },

  renderHeader() {
    const sel = document.getElementById('branch-select');
    if (sel) {
      const cur = this.currentBranchId();
      sel.innerHTML = (this.state.branches || []).map((b) =>
        '<option value="' + esc(b.id) + '"' + (String(b.id) === String(cur) ? ' selected' : '') + '>' + esc(b.name) + '</option>'
      ).join('');
      // Non-Owners are locked to their own branch.
      sel.disabled = !(this.user && this.user.role === 'Owner');
    }
    const chip = document.getElementById('user-chip');
    if (chip && this.user) chip.textContent = this.user.name + ' (' + this.user.role + ')';
  },

  renderSidebar() {
    const nav = document.getElementById('sidebar');
    if (!nav) return;
    nav.innerHTML = '';
    NAV.forEach((item) => {
      if (!this.can(item.action)) return; // hide nav items the role cannot use
      const btn = el('<button type="button" class="nav-item' + (this.currentScreen === item.id ? ' active' : '') + '">' + esc(item.label) + '</button>');
      btn.addEventListener('click', () => this.go(item.id));
      nav.appendChild(btn);
    });
  },

  showShell(show) {
    const shell = document.getElementById('app-shell');
    const login = document.getElementById('login-screen');
    if (shell) shell.hidden = !show;
    if (login) login.style.display = show ? 'none' : 'flex';
  },

  /* ----- login / owner setup / logout ----- */
  renderLogin() {
    this.showShell(false);
    const body = document.getElementById('login-body');
    if (!body) return;
    body.innerHTML = '';
    const users = (this.state.appUsers || []).filter((u) => u.isActive !== false && u.active !== false);
    if (users.length === 0) {
      body.appendChild(this.ownerSetupForm());
      return;
    }
    const wrap = el('<div></div>');
    wrap.appendChild(el('<h3 style="text-align:left">Login Karein</h3>'));
    wrap.appendChild(el('<p class="muted" style="text-align:left">Apna naam chunein aur PIN dalein.</p>'));
    const list = el('<div class="login-user-list"></div>');
    users.forEach((u) => {
      const b = el('<button type="button" class="btn login-user-btn">' + esc(u.name) + ' <span class="muted">(' + esc(u.role) + ')</span></button>');
      b.addEventListener('click', () => {
        this._selectedLoginUser = u;
        list.querySelectorAll('.login-user-btn').forEach((x) => x.classList.remove('selected'));
        b.classList.add('selected');
        pinInput.focus();
      });
      list.appendChild(b);
    });
    wrap.appendChild(list);
    const form = el('<form></form>');
    const pinInput = el('<input class="input pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="PIN" required>');
    const pinLabel = el('<label>PIN (4–6 digit)</label>');
    form.appendChild(pinLabel);
    form.appendChild(pinInput);
    form.appendChild(el('<div class="form-actions"><button type="submit" class="btn btn-primary btn-block">Login Karein</button></div>'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const pin = pinInput.value.trim();
      const u = this._selectedLoginUser;
      if (!u) { this.notify('Pehle apna naam chunein', 'warning'); return; }
      if (pin.length < 4) { this.notify('PIN kam az kam 4 digit ka hona chahiye', 'warning'); return; }
      // PINs are stored hashed only (DB.hashPin / DB.checkPin).
      let ok = false;
      try { ok = DB.checkPin ? DB.checkPin(u, pin) : false; } catch (e) { ok = false; }
      if (ok) {
        this.login(u);
      } else {
        this.notify('Ghalat PIN — dobara koshish karein', 'error');
        pinInput.value = '';
        pinInput.focus();
      }
    });
    wrap.appendChild(form);
    body.appendChild(wrap);
  },

  ownerSetupForm() {
    const wrap = el('<div></div>');
    wrap.appendChild(el('<h3 style="text-align:left">Owner Setup</h3>'));
    wrap.appendChild(el('<p class="muted" style="text-align:left">Pehli dafa setup: Owner ka naam, username aur 4–6 digit ka PIN banayein. Koi default PIN nahi hai.</p>'));
    const form = el('<form></form>');
    const nameIn = el('<input class="input" type="text" required placeholder="Owner ka naam">');
    const userIn = el('<input class="input" type="text" required placeholder="Username">');
    const pinIn = el('<input class="input pin-input" type="password" inputmode="numeric" maxlength="6" required placeholder="PIN (4–6 digit)">');
    const pin2In = el('<input class="input pin-input" type="password" inputmode="numeric" maxlength="6" required placeholder="PIN dobara likhein">');
    form.appendChild(el('<label>Naam</label>')); form.appendChild(nameIn);
    form.appendChild(el('<label>Username</label>')); form.appendChild(userIn);
    form.appendChild(el('<label>PIN (4–6 digit)</label>')); form.appendChild(pinIn);
    form.appendChild(el('<label>PIN Confirm Karein</label>')); form.appendChild(pin2In);
    form.appendChild(el('<div class="form-actions"><button type="submit" class="btn btn-primary btn-block">Owner Account Banayein</button></div>'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = nameIn.value.trim();
      const username = userIn.value.trim();
      const pin = pinIn.value.trim();
      const pin2 = pin2In.value.trim();
      if (!name || !username) { this.notify('Naam aur username zaroori hain', 'warning'); return; }
      if (!/^\d{4,6}$/.test(pin)) { this.notify('PIN sirf 4–6 digit ka hona chahiye', 'warning'); return; }
      if (pin !== pin2) { this.notify('Dono PIN match nahi karte', 'error'); return; }
      if ((this.state.appUsers || []).some((u) => String(u.username).toLowerCase() === username.toLowerCase())) {
        this.notify('Ye username pehle se mojood hai', 'error'); return;
      }
      const owner = {
        id: (DB.nextId ? DB.nextId('appUsers') : ((this.state.appUsers || []).length + 1)),
        name, username,
        pinHash: (DB.hashPin ? DB.hashPin(pin) : pin),
        role: 'Owner', branchId: null, branchName: null, isActive: true,
      };
      this.state.appUsers.push(owner);
      dbSave();
      this.notify('Owner account ban gaya — Kamyab', 'success');
      this.login(owner);
    });
    wrap.appendChild(form);
    return wrap;
  },

  login(user) {
    this.user = user;
    this._branchId = user.role === 'Owner' ? (this.state.settings.defaultBranchId || null) : (user.branchId || null);
    this._selectedLoginUser = null;
    this.showShell(true);
    this.renderHeader();
    this.notify('Welcome, ' + user.name, 'success');
    this.go(this.can('dashboard') ? 'dashboard' : 'pos');
  },

  logout() {
    this.user = null;
    this.currentScreen = null;
    const container = document.getElementById('screen');
    if (container) container.innerHTML = '';
    this.renderLogin();
  },

  /* ----- notices: 9s auto-dismiss with progress bar + X ----- */
  notify(msg, type) {
    const t = type || 'info';
    const stack = document.getElementById('notice-stack');
    if (!stack) return;
    const n = el('<div class="notice notice-' + esc(t) + '">' + esc(msg) +
      '<button type="button" class="notice-x" aria-label="Close">×</button>' +
      '<span class="notice-bar"></span></div>');
    const dismiss = () => { if (n.parentNode) n.parentNode.removeChild(n); };
    n.querySelector('.notice-x').addEventListener('click', dismiss);
    stack.appendChild(n);
    setTimeout(dismiss, 9000);
  },

  /* ----- in-app confirm dialog (replaces window.confirm) ----- */
  confirmDialog(title, text) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('confirm-overlay');
      const tEl = document.getElementById('confirm-title');
      const xEl = document.getElementById('confirm-text');
      const yesBtn = document.getElementById('confirm-yes');
      const noBtn = document.getElementById('confirm-no');
      if (!overlay) { resolve(window.confirm(text || title)); return; }
      tEl.textContent = title || 'Confirm Karein';
      xEl.textContent = text || '';
      overlay.hidden = false;
      const done = (v) => {
        overlay.hidden = true;
        yesBtn.removeEventListener('click', onYes);
        noBtn.removeEventListener('click', onNo);
        resolve(v);
      };
      const onYes = () => done(true);
      const onNo = () => done(false);
      yesBtn.addEventListener('click', onYes);
      noBtn.addEventListener('click', onNo);
    });
  },
};

window.App = App;
window.esc = esc;
window.el = el;
