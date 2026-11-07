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
  try { App.state = DB.state; DB.save(); }
  catch (e) {
    // A failed save must never crash the UI or lose the in-memory state.
    // The user hears about it through the top notice, in Roman Urdu.
    try { App.handleError(e, 'save'); } catch (err) { /* never throw from error handling */ }
  }
}

/* Central error handler (item 4): every user action fails gracefully.
 * No stack traces, no blank screens, no sensitive data (PINs, costs,
 * hashes) in the message — only a short Roman Urdu notice on top,
 * auto-dismissed in 9 seconds by the notice system. */
function sanitiseErrorMessage(e) {
  let msg = (e && e.message) ? String(e.message) : 'Kuch ghalat ho gaya';
  // Strip anything that could carry sensitive data (hashes, long tokens).
  msg = msg.replace(/\b[0-9a-f]{32,}\b/gi, '[hidden]');
  if (msg.length > 160) msg = msg.slice(0, 160) + '…';
  return msg;
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
  _lockedUser: null,    // user who was locked out by the session timeout
  _idleTimer: null,
  _idleWarnTimer: null,
  _idleWarned: false,
  perf: { lastSwitchMs: 0, switches: [] },

  /* ----- central error handling (item 4) ----- */
  handleError(err, context) {
    let msg = sanitiseErrorMessage(err);
    // Keep the notice short and in Roman Urdu; the context stays internal.
    this.notify('Masla: ' + msg, 'error');
    try {
      // Console only, never the screen — and never with sensitive data.
      if (typeof console !== 'undefined' && console.error) console.error('[RARA POS]', context || 'error', msg);
    } catch (e) { /* ignore */ }
  },

  /* ----- automatic session timeout (item 5) ----- */
  // Locks the app after N minutes of no input (default 15, from Settings).
  // The loaded data stays in memory and the branch stays selected; only
  // the PIN screen comes back. A warning appears 1 minute before locking.
  sessionTimeoutMs() {
    const mins = Number(this.state && this.state.settings && this.state.settings.sessionTimeoutMinutes);
    if (!mins || mins <= 0) return 15 * 60 * 1000;
    return Math.max(1, mins) * 60 * 1000;
  },
  startIdleTimer() {
    this.stopIdleTimer();
    if (!this.user) return;
    const total = this.sessionTimeoutMs();
    const warnAt = Math.max(0, total - 60 * 1000);
    this._idleWarned = false;
    this._idleWarnTimer = setTimeout(() => {
      this._idleWarned = true;
      this.notify('1 minute me lock ho jayega — kaam jari rakhne ke liye kahin bhi click karein', 'warning');
    }, warnAt);
    this._idleTimer = setTimeout(() => this.lock(), total);
  },
  resetIdleTimer() {
    if (!this.user) return;
    // Any real activity cancels the warning and restarts the countdown.
    if (this._idleWarned) this._idleWarned = false;
    this.startIdleTimer();
  },
  stopIdleTimer() {
    if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
    if (this._idleWarnTimer) { clearTimeout(this._idleWarnTimer); this._idleWarnTimer = null; }
  },
  lock() {
    if (!this.user) return;
    this._lockedUser = this.user;
    this.stopIdleTimer();
    this.user = null;
    this.currentScreen = null;
    const container = document.getElementById('screen');
    if (container) container.innerHTML = '';
    this.notify('Session lock ho gaya — PIN dobara dalein', 'warning');
    this.renderLogin();
  },

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
    // Global error handling: no blank screens, no raw stack traces —
    // everything goes through the top notice (item 4).
    window.addEventListener('error', (ev) => {
      try { this.handleError(ev.error || ev.message, 'window'); } catch (e) { /* ignore */ }
    });
    window.addEventListener('unhandledrejection', (ev) => {
      try { this.handleError(ev.reason, 'promise'); } catch (e) { /* ignore */ }
    });
    // Session-timeout activity tracking (item 5): any input resets the
    // countdown. Listeners are passive and cheap; the timer itself is
    // only armed while a user is logged in.
    ['pointerdown', 'keydown', 'wheel', 'input', 'touchstart'].forEach((evt) => {
      window.addEventListener(evt, () => this.resetIdleTimer(), { passive: true });
    });
    // Tell the user if the data file was recovered from the .bak copy.
    if (DB.loadError) {
      setTimeout(() => this.notify(DB.recoveredFromBackup ? 'Data backup copy se wapas laya gaya hai — sab kuch mehfooz hai' : 'Masla: ' + DB.loadError, DB.recoveredFromBackup ? 'warning' : 'error'), 400);
    }
    // Self auto-update: listen for main-process update events (progress,
    // ready-to-install, errors) and show them as Roman Urdu notices.
    try { this.initUpdateBridge(); } catch (e) { /* updates are optional */ }
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
    // Video background follows the theme (Dark only) + the Live
    // Background setting in Settings > Defaults.
    this.applyLiveBackground();
  },
  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('rara-pos-theme', this.theme); } catch (e) { /* private mode */ }
    this.applyTheme();
    this.notify(this.theme === 'dark' ? 'Dark theme lag gaya' : 'Light theme lag gaya', 'info');
  },

  /* ----- live video background (v1.1.1) ----- */
  // The video only ever plays in the Dark theme and only when the Owner
  // has left Settings > Live Background ON (default ON). Everywhere else
  // it is hidden AND paused, so it costs no CPU or battery.
  liveBackgroundEnabled() {
    if (this.theme !== 'dark') return false;
    const s = this.state && this.state.settings;
    if (s && typeof s.liveBackground === 'boolean') return s.liveBackground;
    return true;
  },
  applyLiveBackground() {
    const video = document.getElementById('bg-video');
    const overlay = document.getElementById('bg-overlay');
    if (!video) return;
    const on = this.liveBackgroundEnabled();
    video.classList.toggle('bg-off', !on);
    if (overlay) overlay.classList.toggle('bg-off', !on);
    if (on) {
      try {
        const p = video.play();
        if (p && p.catch) p.catch(function () { /* autoplay blocked: first frame still shows */ });
      } catch (e) { /* ignore */ }
    } else {
      try { video.pause(); } catch (e) { /* ignore */ }
    }
  },
  // Called by Settings when the owner flips the Live Background toggle.
  setLiveBackground(on) {
    this.state.settings = this.state.settings || {};
    this.state.settings.liveBackground = !!on;
    this.save();
    this.applyLiveBackground();
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
    // Fast page loading (item 1): only the active screen renders, and the
    // switch time is measured so regressions are visible.
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (typeof fn === 'function') {
      try { fn(container); }
      catch (e) {
        container.innerHTML = '';
        this.handleError(e, 'screen:' + screenName);
        container.appendChild(el('<div class="card"><h2>Masla</h2><p>Screen load nahi ho saki — dobara koshish karein ya app band kar ke kholein.</p></div>'));
      }
    } else {
      container.appendChild(el(
        '<div class="card"><h2>' + esc(nav ? nav.label : screenName) + '</h2>' +
        '<p class="muted">Ye screen abhi tayyar ho raha hai. Baraye meharbani thodi der baad dobara koshish karein.</p></div>'
      ));
    }
    const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    this.perf.lastSwitchMs = Math.round((t1 - t0) * 10) / 10;
    this.perf.switches.push({ screen: screenName, ms: this.perf.lastSwitchMs });
    if (this.perf.switches.length > 50) this.perf.switches.shift();
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
      // After a session lock, the same user is pre-selected so the PIN
      // is all they need to get back to work.
      if (this._lockedUser && String(this._lockedUser.id) === String(u.id)) {
        this._selectedLoginUser = u;
        b.classList.add('selected');
      }
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
    // After a session lock, the PIN field is focused straight away.
    if (this._selectedLoginUser) { try { pinInput.focus(); } catch (e) { /* ignore */ } }
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
      // Data-layer duplicate guard (item 3).
      if (DB.checkUniqueness) {
        const chk = DB.checkUniqueness('appUsers', { username }, null);
        if (!chk.ok) { this.notify(chk.message, 'error'); return; }
      } else if ((this.state.appUsers || []).some((u) => String(u.username).toLowerCase() === username.toLowerCase())) {
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
    this._lockedUser = null;
    this._branchId = user.role === 'Owner' ? (this.state.settings.defaultBranchId || null) : (user.branchId || null);
    this._selectedLoginUser = null;
    this.showShell(true);
    this.renderHeader();
    this.notify('Welcome, ' + user.name, 'success');
    this.startIdleTimer();
    // Reliable backup (item 9): once a day, right after login, take a
    // verified auto-backup. Failures are reported, never silent.
    try {
      if (DB.backupInfo) {
        const info = DB.backupInfo();
        const today = new Date().toISOString().slice(0, 10);
        if (!info.lastBackup || String(info.lastBackup).slice(0, 10) !== today) {
          const res = DB.backup ? DB.backup() : { ok: false };
          if (!res.ok) this.notify('Masla: Aaj ka auto-backup nahi ban saka — Settings > Backup se dobara koshish karein', 'error');
        }
      }
    } catch (e) { /* backup failure must never block login */ }
    this.go(this.can('dashboard') ? 'dashboard' : 'pos');
  },

  logout() {
    this.stopIdleTimer();
    this._lockedUser = null;
    this.user = null;
    this.currentScreen = null;
    const container = document.getElementById('screen');
    if (container) container.innerHTML = '';
    this.renderLogin();
  },

  /* ----- notices: 9s auto-dismiss with progress bar + X ----- */
  // action is optional: { label, onClick } adds one button to the notice
  // (used by the auto-update "Restart Karein" prompt).
  notify(msg, type, action) {
    const t = type || 'info';
    const stack = document.getElementById('notice-stack');
    if (!stack) return;
    const n = el('<div class="notice notice-' + esc(t) + '">' + esc(msg) +
      '<button type="button" class="notice-x" aria-label="Close">×</button>' +
      '<span class="notice-bar"></span></div>');
    const dismiss = () => { if (n.parentNode) n.parentNode.removeChild(n); };
    n.querySelector('.notice-x').addEventListener('click', dismiss);
    if (action && action.label && typeof action.onClick === 'function') {
      const b = el('<button type="button" class="btn btn-primary" style="margin-left:8px;padding:4px 10px">' + esc(action.label) + '</button>');
      b.addEventListener('click', () => { dismiss(); try { action.onClick(); } catch (e) { /* ignore */ } });
      n.insertBefore(b, n.querySelector('.notice-x'));
    }
    stack.appendChild(n);
    setTimeout(dismiss, 9000);
  },

  /* ----- self auto-update bridge (main process owns the updater) ----- */
  update: { state: null, downloadedVersion: null, lastProgressBucket: -1 },
  initUpdateBridge() {
    let ipc = null;
    try { ipc = require('electron').ipcRenderer; } catch (e) { ipc = null; }
    if (!ipc) return;
    this._updateIpc = ipc;
    // Ask main for the current update state (version, token saved?,
    // auto-check on?, last check). Stored on App.update.state.
    const refresh = () => {
      try {
        ipc.invoke('update-get-state').then((s) => {
          this.update.state = s || null;
          this.renderUpdateStatus();
        }).catch(() => { /* ignore */ });
      } catch (e) { /* ignore */ }
    };
    this._refreshUpdateState = refresh;
    refresh();
    ipc.on('update-event', (_e, evt) => {
      if (!evt || !evt.type) return;
      if (evt.type === 'status' && evt.status) {
        if (this.update.state) this.update.state.status = evt.status;
        if (evt.lastCheck && this.update.state) this.update.state.lastCheck = evt.lastCheck;
        this.renderUpdateStatus();
        return;
      }
      if (evt.type === 'no-token') {
        if (this.update.state) { this.update.state.status = 'no-token'; this.update.state.hasToken = false; }
        this.notify(evt.message || 'Update ke liye token chahiye — Settings > Updates me GitHub token dalein', 'warning');
        this.renderUpdateStatus();
        return;
      }
      if (evt.type === 'available') {
        if (this.update.state) this.update.state.status = 'available';
        this.notify('Naya version ' + (evt.version || '') + ' mil gaya — download ho raha hai…', 'success');
        this.renderUpdateStatus();
        return;
      }
      if (evt.type === 'none') {
        if (this.update.state) this.update.state.status = 'none';
        this.notify(evt.message || 'App pehle se latest version par hai', 'success');
        this.renderUpdateStatus();
        return;
      }
      if (evt.type === 'progress') {
        const pct = Math.round(evt.percent || 0);
        const bucket = Math.floor(pct / 25);
        if (bucket === this.update.lastProgressBucket) return;
        this.update.lastProgressBucket = bucket;
        this.notify('Update download ho raha hai… ' + pct + '%', 'info');
        return;
      }
      if (evt.type === 'downloaded') {
        this.update.downloadedVersion = evt.version || '';
        if (this.update.state) { this.update.state.status = 'downloaded'; this.update.state.downloadedVersion = evt.version || ''; }
        this.notify('Update ' + (evt.version || '') + ' download ho gaya — restart kar ke lagayein', 'success', {
          label: 'Restart Karein aur Update Lagayein',
          onClick: () => this.installUpdate(),
        });
        this.renderUpdateStatus();
        return;
      }
      if (evt.type === 'error') {
        if (this.update.state) this.update.state.status = 'error';
        this.notify('Masla: ' + (evt.message || 'Update check nahi ho saka — dobara koshish karein'), 'error');
        this.renderUpdateStatus();
        return;
      }
    });
  },
  // Updates the status line inside Settings > Updates, if it is on screen.
  renderUpdateStatus() {
    const elStatus = document.getElementById('upd-status');
    if (!elStatus) return;
    const s = this.update.state;
    if (!s) { elStatus.textContent = 'Status maloom nahi'; return; }
    const map = {
      idle: 'Abhi tak check nahi hua',
      checking: 'Update check ho raha hai…',
      available: 'Naya version mil gaya — download ho raha hai…',
      none: 'App latest version par hai',
      downloaded: 'Update download ho gaya — restart kar ke lagayein' + (s.downloadedVersion ? ' (v' + s.downloadedVersion + ')' : ''),
      'no-token': 'Token nahi dala gaya — update check ke liye token chahiye',
      error: 'Aakhri check nahi ho saka — dobara koshish karein',
    };
    elStatus.textContent = map[s.status] || s.status;
    const lastEl = document.getElementById('upd-last-check');
    if (lastEl) lastEl.textContent = s.lastCheck ? new Date(s.lastCheck).toLocaleString('en-GB') : 'Abhi tak koi check nahi hua';
    const verEl = document.getElementById('upd-version');
    if (verEl) verEl.textContent = 'v' + (s.version || '?');
    const restartBtn = document.getElementById('upd-restart');
    if (restartBtn) restartBtn.style.display = s.status === 'downloaded' ? '' : 'none';
  },
  checkForUpdates() {
    try { if (this._updateIpc) this._updateIpc.send('update-check-now'); } catch (e) { /* ignore */ }
    this.notify('Update check ho raha hai…', 'info');
  },
  installUpdate() {
    // Confirm first — a restart closes the shop screen mid-sale otherwise.
    this.confirmDialog('Restart Karein aur Update Lagayein?', 'App band ho kar naya version install karega aur dobara khul jayega. Agar koi sale adhuri hai to pehle use complete ya cancel karein.').then((ok) => {
      if (!ok) return;
      try { if (this._updateIpc) this._updateIpc.send('update-quit-install'); } catch (e) { /* ignore */ }
    });
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
      overlay.style.display = 'flex';
      const done = (v) => {
        overlay.hidden = true;
        overlay.style.display = 'none';
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
