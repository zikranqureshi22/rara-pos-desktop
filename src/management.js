/* RARA POS — Management screens (Agent C)
   Purchases, Customers, Suppliers, Expenses, Employees, Cash, Branches, Logins.
   Contract: const DB = require('./db.js'); window.App helpers; window.Screens registry.
   All screens read/write DB.state and call DB.save(). No mock data. */
(function () {
  'use strict';
  // Contract path './db.js' works when the file is required as a Node
  // module; under index.html's <script> tags Electron resolves relative
  // require() against the HTML file's folder (the app root), so fall
  // back to './src/db.js' there. Either way DB is the same module.
  let DB;
  try { DB = require('./db.js'); } catch (e) { DB = require('./src/db.js'); }
  const state = DB.state;
  window.Screens = window.Screens || {};

  /* ---------- shared helpers ---------- */
  function S() { return DB.state || state; }
  function save() { try { if (DB && DB.save) DB.save(); else if (window.App && App.save) App.save(); } catch (e) {} }
  function notify(msg, type) { try { if (window.App && App.notify) { App.notify(msg, type || 'info'); return; } } catch (e) {} alert(msg); }
  function money(n) { try { if (window.App && App.money) return App.money(n); } catch (e) {} return 'Rs ' + (Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 }); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(x) { try { return new Date(x).toLocaleString('en-GB'); } catch (e) { return String(x || ''); } }
  function fmtDay(x) { try { return new Date(x).toLocaleDateString('en-GB'); } catch (e) { return String(x || ''); } }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function role() { return (window.App && App.user && App.user.role) || ''; }
  function isOwner() { try { if (window.App && App.canSeeCost) return !!App.canSeeCost(); } catch (e) {} return role() === 'Owner'; }
  function isOwnerOrManager() { return role() === 'Owner' || role() === 'Manager'; }
  function can(action, fallbackOwnerOnly) {
    try { if (window.App && App.can) { var r = App.can(action); if (typeof r === 'boolean') return r; } } catch (e) {}
    return fallbackOwnerOnly ? isOwner() : isOwnerOrManager();
  }
  // Gate a screen through App.can (ui.js role model) first; fall back to a
  // role check only when App.can is unavailable.
  function canAction(action, fallbackFn) {
    try { if (window.App && App.can) { var r = App.can(action); if (typeof r === 'boolean') return r; } } catch (e) {}
    return fallbackFn();
  }
  // In-app confirm (App.confirmDialog) when available, else window.confirm.
  function confirmDlg(title, text) {
    try { if (window.App && App.confirmDialog) return App.confirmDialog(title, text); } catch (e) {}
    return Promise.resolve(window.confirm(text || title));
  }
  function denied(el, msg) {
    el.innerHTML = '<div class="card"><h2>Access denied</h2><p>' + esc(msg || 'Only the Owner can open this screen.') + '</p><button class="btn" data-go="dashboard">Back to Dashboard</button></div>';
    var b = el.querySelector('[data-go]'); if (b) b.addEventListener('click', function () { try { App.go(App.user && App.user.role === 'Franchise' ? 'franchise' : (App.user && App.user.role === 'Salesman' ? 'salesman' : 'dashboard')); } catch (e) {} });
  }
  function branchName(id) {
    try { if (window.App && App.branchName) return App.branchName(id); } catch (e) {}
    var b = (S().branches || []).find(function (x) { return String(x.id) === String(id); });
    return b ? b.name : (id == null ? '—' : String(id));
  }
  // Form <select> values are always strings, but seed/DB branch ids are
  // numbers and DB.stockOf/setStock compare with ===. Return the branch's
  // real id (same type as stored) so stock lookups match.
  function branchIdOf(v) {
    var b = (S().branches || []).find(function (x) { return String(x.id) === String(v); });
    return b ? b.id : v;
  }
  function branchOptions(selected) {
    return (S().branches || []).map(function (b) { return '<option value="' + esc(b.id) + '"' + (String(b.id) === String(selected) ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('');
  }
  function defaultBranchId() {
    try { if (window.App && App.currentBranchId) { var v = App.currentBranchId(); if (v != null) return branchIdOf(v); } } catch (e) {}
    var st = S();
    if (st.settings && st.settings.defaultBranchId != null) return branchIdOf(st.settings.defaultBranchId);
    return (st.branches && st.branches[0]) ? st.branches[0].id : '';
  }
  function nextId(coll) {
    try { if (DB.nextId) return DB.nextId(coll); } catch (e) {}
    var arr = S()[coll] || [];
    var max = 0; arr.forEach(function (x) { var n = Number(x.id); if (!isNaN(n) && n > max) max = n; });
    return max + 1 || Date.now();
  }
  function prodById(id) { try { if (DB.productById) return DB.productById(id); } catch (e) {} return (S().products || []).find(function (p) { return String(p.id) === String(id); }); }
  function prodCost(p) { return Number(p.purchasePrice != null ? p.purchasePrice : (p.costPrice != null ? p.costPrice : (p.cost || 0))) || 0; }
  function totalStock(p) {
    // Real shape (db.js / seed.json): product.stock is the total and
    // product.branchStocks is [{branchId, qty}]; DB.stockOf(p) returns that total.
    if (DB.stockOf) { try { return Number(DB.stockOf(p)) || 0; } catch (e) {} }
    if (p.branchStocks && Array.isArray(p.branchStocks)) return p.branchStocks.reduce(function (a, b) { return a + (Number(b.qty) || 0); }, 0);
    if (p.stock != null && typeof p.stock === 'number') return p.stock;
    return 0;
  }
  function branchStockOf(p, branchId) {
    if (DB.stockOf) { try { return Number(DB.stockOf(p, branchId)) || 0; } catch (e) {} }
    if (p.branchStocks && Array.isArray(p.branchStocks)) {
      var row = p.branchStocks.find(function (b) { return String(b.branchId) === String(branchId); });
      return row ? (Number(row.qty) || 0) : 0;
    }
    if (p.stock != null && typeof p.stock === 'number') return p.stock;
    return 0;
  }
  function adjustStock(p, branchId, delta) {
    // DB.setStock keeps branchStocks and the product.stock total in sync.
    if (DB.setStock && DB.stockOf) {
      try { DB.setStock(p, branchId, (Number(DB.stockOf(p, branchId)) || 0) + delta); return; } catch (e) {}
    }
    if (p.branchStocks && Array.isArray(p.branchStocks)) {
      var row = p.branchStocks.find(function (b) { return String(b.branchId) === String(branchId); });
      if (row) row.qty = (Number(row.qty) || 0) + delta;
      else p.branchStocks.push({ branchId: branchId, qty: delta });
      if (DB.recalcProductStock) { try { DB.recalcProductStock(p); } catch (e) {} }
      return;
    }
    if (p.stock != null) p.stock = (Number(p.stock) || 0) + delta;
  }
  function logMovement(m) {
    // DB.addMovement shape: {productId, productName, branchId, qty, reason, user, reference}
    if (DB.addMovement) {
      try {
        DB.addMovement({ productId: m.productId, productName: m.productName, branchId: m.branchId, qty: m.qty, reason: m.reason || m.type || 'Adjustment', user: (window.App && App.user) ? App.user.name : '', reference: m.reference || '' });
        return;
      } catch (e) {}
    }
    var st = S(); st.stockMovements = st.stockMovements || [];
    st.stockMovements.push({ id: nextId('stockMovements'), productId: m.productId, productName: m.productName || '', branchId: m.branchId != null ? m.branchId : null, qty: m.qty, date: new Date().toISOString(), reason: m.reason || m.type || 'Adjustment', user: (window.App && App.user) ? App.user.name : '', reference: m.reference || '' });
  }
  function saleDate(s) { return s.date || s.createdAt || s.timestamp || s.time; }
  function saleItems(s) { return s.items || s.lines || s.products || []; }
  function saleTotal(s) { if (s.total != null) return Number(s.total) || 0; return saleItems(s).reduce(function (a, it) { return a + (Number(it.qty != null ? it.qty : it.quantity || 0)) * (Number(it.unitPrice != null ? it.unitPrice : it.price || 0)); }, 0); }
  function isReturned(s) { var t = String(s.status || '').toLowerCase(); return t === 'returned' || t === 'cancelled' || t === 'canceled' || t === 'refunded' || !!s.isReturned; }
  function isCancelled(s) { var t = String(s.status || '').toLowerCase(); return t === 'cancelled' || t === 'canceled'; }
  function returnsOf(s) { return s.returns || []; }
  function returnsRefund(s) { return returnsOf(s).reduce(function (a, r) { return a + (Number(r.refund != null ? r.refund : 0) || 0); }, 0); }
  function saleStatusLabel(s) {
    var t = String(s.status || 'completed').toLowerCase();
    if (t === 'cancelled' || t === 'canceled') return 'Cancelled';
    if (t === 'returned') return 'Returned';
    if (t === 'partial-return') return 'Partial Return';
    if (t === 'partial') return 'Partial / Credit';
    return 'Completed';
  }
  function hashPin(pin) {
    try { if (DB.hashPin) return DB.hashPin(pin); } catch (e) {}
    var h = 5381; for (var i = 0; i < pin.length; i++) h = ((h << 5) + h + pin.charCodeAt(i)) >>> 0;
    return 'hash-' + h.toString(16);
  }
  function val(id, root) { var el = (root || document).querySelector('#' + id); return el ? el.value : ''; }
  function numVal(id, root) { var v = parseFloat(val(id, root)); return isNaN(v) ? 0 : v; }

  /* ---------- PURCHASES ---------- */
  Screens.purchases = function render(containerEl) {
    if (!can('purchases', true)) { denied(containerEl, 'Only the Owner can manage purchases.'); return; }
    var st = S();
    var purchases = (st.purchases || []).slice().sort(function (a, b) { return new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0); });
    var suppliers = st.suppliers || [];
    var products = st.products || [];

    var rows = purchases.map(function (p) {
      var items = (p.items || []).map(function (it) { return (it.name || it.productName || 'Item') + ' × ' + (it.qty || it.quantity || 0); }).join(', ');
      return '<tr><td>' + esc(fmtDay(p.date || p.createdAt)) + '</td><td>' + esc(p.supplierName || '') + '</td><td>' + esc(p.branchName || branchName(p.branchId)) + '</td><td>' + esc(items) + '</td><td>' + esc(money(p.total != null ? p.total : p.grandTotal)) + '</td><td>' + esc(money(p.paid || 0)) + '</td><td>' + esc(money(p.balance != null ? p.balance : ((Number(p.total) || 0) - (Number(p.paid) || 0)))) + '</td>' +
        '<td><button class="btn btn-danger" data-del-purchase="' + esc(p.id) + '">Delete</button></td></tr>';
    }).join('');

    containerEl.innerHTML =
      '<h2>Purchases</h2>' +
      '<div class="card"><h3>Add Purchase</h3>' +
      '<div class="form-row"><label>Supplier <select id="pu-supplier">' + suppliers.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Branch <select id="pu-branch">' + branchOptions(defaultBranchId()) + '</select></label>' +
      '<label>Date <input type="date" id="pu-date" value="' + todayISO() + '"></label></div>' +
      '<div id="pu-rows"></div>' +
      '<button class="btn" id="pu-add-row">+ Add Product Row</button>' +
      '<div class="form-row" style="margin-top:12px"><label>Discount <input type="number" id="pu-discount" min="0" step="0.01" value="0"></label>' +
      '<label>Paid Amount <input type="number" id="pu-paid" min="0" step="0.01" value="0"></label></div>' +
      '<p>Subtotal: <b id="pu-subtotal">Rs 0</b> &nbsp; Total: <b id="pu-total">Rs 0</b> &nbsp; Balance (to supplier): <b id="pu-balance">Rs 0</b></p>' +
      '<button class="btn btn-primary" id="pu-confirm">Confirm Purchase</button> ' +
      '<span style="font-size:12px;opacity:.75">Confirm increases branch stock, updates cost price (weighted average) and supplier balance.</span></div>' +
      '<div class="card" style="margin-top:12px"><h3>Purchase History</h3>' +
      (purchases.length ? '<table class="tbl"><thead><tr><th>Date</th><th>Supplier</th><th>Branch</th><th>Items</th><th>Total</th><th>Paid</th><th>Balance</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p>No purchases yet.</p>') + '</div>';

    var rowsEl = containerEl.querySelector('#pu-rows');
    function addRow() {
      var div = document.createElement('div');
      div.className = 'form-row pu-row';
      div.innerHTML = '<label>Product <select class="pu-product">' + products.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
        '<label>Qty <input type="number" class="pu-qty" min="1" step="1" value="1"></label>' +
        '<label>Cost Price <input type="number" class="pu-cost" min="0" step="0.01" value="0"></label>' +
        '<span class="pu-line" style="align-self:end;padding-bottom:8px">Rs 0</span>' +
        '<button class="btn btn-danger pu-remove" type="button">Remove</button>';
      rowsEl.appendChild(div);
      div.querySelector('.pu-remove').addEventListener('click', function () { div.remove(); recalc(); });
      div.querySelectorAll('input,select').forEach(function (el) { el.addEventListener('input', recalc); el.addEventListener('change', recalc); });
      recalc();
    }
    function recalc() {
      var sub = 0;
      rowsEl.querySelectorAll('.pu-row').forEach(function (r) {
        var q = parseFloat(r.querySelector('.pu-qty').value) || 0;
        var c = parseFloat(r.querySelector('.pu-cost').value) || 0;
        var line = q * c; sub += line;
        r.querySelector('.pu-line').textContent = money(line);
      });
      var disc = Math.max(0, parseFloat(val('pu-discount', containerEl)) || 0);
      var total = Math.max(0, sub - disc);
      var paid = Math.max(0, parseFloat(val('pu-paid', containerEl)) || 0);
      containerEl.querySelector('#pu-subtotal').textContent = money(sub);
      containerEl.querySelector('#pu-total').textContent = money(total);
      containerEl.querySelector('#pu-balance').textContent = money(Math.max(0, total - paid));
    }
    addRow();
    containerEl.querySelector('#pu-add-row').addEventListener('click', addRow);
    containerEl.querySelector('#pu-discount').addEventListener('input', recalc);
    containerEl.querySelector('#pu-paid').addEventListener('input', recalc);

    containerEl.querySelector('#pu-confirm').addEventListener('click', function () {
      var supplierId = val('pu-supplier', containerEl);
      var supplier = suppliers.find(function (s) { return String(s.id) === String(supplierId); });
      if (!supplier) { notify('Please select a supplier (add one on the Suppliers screen first).', 'error'); return; }
      var branchId = branchIdOf(val('pu-branch', containerEl));
      if (!branchId) { notify('Please select a branch.', 'error'); return; }
      var date = val('pu-date', containerEl) || todayISO();
      var items = [];
      var bad = false;
      rowsEl.querySelectorAll('.pu-row').forEach(function (r) {
        var pid = r.querySelector('.pu-product').value;
        var q = parseFloat(r.querySelector('.pu-qty').value);
        var c = parseFloat(r.querySelector('.pu-cost').value);
        if (!pid || !(q > 0) || !(c >= 0) || isNaN(c)) { bad = true; return; }
        var prod = prodById(pid);
        items.push({ productId: pid, name: prod ? prod.name : '', qty: q, costPrice: c, lineTotal: q * c });
      });
      if (bad || !items.length) { notify('Each product row needs a product, quantity above 0 and a cost price of 0 or more.', 'error'); return; }
      var sub = items.reduce(function (a, it) { return a + it.lineTotal; }, 0);
      var disc = Math.max(0, numVal('pu-discount', containerEl));
      if (disc > sub) { notify('Discount cannot be more than the subtotal.', 'error'); return; }
      var total = sub - disc;
      var paid = Math.max(0, numVal('pu-paid', containerEl));
      if (paid > total) { notify('Paid amount cannot be more than the total.', 'error'); return; }
      var balance = total - paid;
      var purchase = { id: nextId('purchases'), supplierId: supplier.id, supplierName: supplier.name, branchId: branchId, branchName: branchName(branchId), date: date, items: items, subtotal: sub, discount: disc, total: total, paid: paid, balance: balance, createdAt: new Date().toISOString() };
      st.purchases = st.purchases || []; st.purchases.push(purchase);
      items.forEach(function (it) {
        var prod = prodById(it.productId); if (!prod) return;
        var oldStock = branchStockOf(prod, branchId);
        // If stock is stored globally, oldStock is the global stock.
        var oldCost = prodCost(prod);
        adjustStock(prod, branchId, it.qty);
        var newStock = oldStock + it.qty;
        prod.purchasePrice = newStock > 0 ? ((oldStock * oldCost) + (it.qty * it.costPrice)) / newStock : it.costPrice;
        logMovement({ productId: prod.id, productName: prod.name, branchId: branchId, qty: it.qty, reason: 'purchase', reference: 'Purchase #' + purchase.id });
      });
      supplier.balance = (Number(supplier.balance) || 0) + balance;
      save();
      notify('Purchase saved. Stock increased and supplier balance updated.', 'success');
      Screens.purchases(containerEl);
    });

    containerEl.querySelectorAll('[data-del-purchase]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!isOwner()) { notify('Only the Owner can delete a purchase.', 'error'); return; }
        var p = (st.purchases || []).find(function (x) { return String(x.id) === String(btn.getAttribute('data-del-purchase')); });
        if (!p) return;
        confirmDlg('Delete purchase?', 'Delete this purchase? Its stock increase will be reversed.').then(function (ok) {
          if (!ok) return;
          (p.items || []).forEach(function (it) {
            var prod = prodById(it.productId); if (!prod) return;
            adjustStock(prod, p.branchId, -(Number(it.qty) || 0));
            logMovement({ productId: prod.id, productName: prod.name, branchId: p.branchId, qty: -(Number(it.qty) || 0), reason: 'purchase-reversal', reference: 'Purchase #' + p.id + ' deleted' });
          });
          var sup = (st.suppliers || []).find(function (s) { return String(s.id) === String(p.supplierId); });
          if (sup) sup.balance = (Number(sup.balance) || 0) - (Number(p.balance) || 0);
          st.purchases = (st.purchases || []).filter(function (x) { return String(x.id) !== String(p.id); });
          save(); notify('Purchase deleted and stock reversed.', 'success');
          Screens.purchases(containerEl);
        });
      });
    });
  };

  /* ---------- CUSTOMERS ---------- */
  Screens.customers = function render(containerEl) {
    if (!canAction('customers', isOwnerOrManager)) { denied(containerEl, 'You do not have permission to view customers.'); return; }
    var st = S();
    var customers = (st.customers || []).slice().sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
    var editingId = containerEl._custEdit || null;
    var statementId = containerEl._custStmt || null;
    var payId = containerEl._custPay || null;

    var formHtml = '';
    if (editingId !== null) {
      var c = editingId === 'new' ? { name: '', phone: '', address: '', balance: 0 } : customers.find(function (x) { return String(x.id) === String(editingId); });
      if (c) {
        formHtml = '<div class="card"><h3>' + (editingId === 'new' ? 'Add Customer' : 'Edit Customer') + '</h3>' +
          '<div class="form-row"><label>Name <input id="cu-name" value="' + esc(c.name || '') + '"></label>' +
          '<label>Phone <input id="cu-phone" value="' + esc(c.phone || '') + '"></label></div>' +
          '<div class="form-row"><label>Address <input id="cu-address" value="' + esc(c.address || '') + '"></label></div>' +
          '<button class="btn btn-primary" id="cu-save">Save Customer</button> <button class="btn btn-ghost" id="cu-cancel">Cancel</button></div>';
      }
    }
    var payHtml = '';
    if (payId) {
      var pc = customers.find(function (x) { return String(x.id) === String(payId); });
      if (pc) {
        payHtml = '<div class="card"><h3>Collect Payment — ' + esc(pc.name) + ' (Outstanding: ' + esc(money(pc.balance || 0)) + ')</h3>' +
          '<div class="form-row"><label>Amount <input type="number" id="cu-pay-amount" min="0" step="0.01"></label>' +
          '<label>Payment Method <select id="cu-pay-method"><option>Cash</option><option>JazzCash</option><option>Easypaisa</option><option>Card</option><option>Bank</option></select></label>' +
          '<label>Date <input type="date" id="cu-pay-date" value="' + todayISO() + '"></label></div>' +
          '<button class="btn btn-primary" id="cu-pay-save">Record Payment</button> <button class="btn btn-ghost" id="cu-pay-cancel">Cancel</button></div>';
      }
    }
    var stmtHtml = '';
    if (statementId) {
      var sc = customers.find(function (x) { return String(x.id) === String(statementId); });
      if (sc) {
        var csales = (st.sales || []).filter(function (s) { return (s.customerId != null && String(s.customerId) === String(sc.id)) || (s.customerName && String(s.customerName) === String(sc.name)); })
          .slice().sort(function (a, b) { return new Date(saleDate(b) || 0) - new Date(saleDate(a) || 0); });
        var cpays = (st.customerPayments || []).filter(function (p) { return String(p.customerId) === String(sc.id); })
          .slice().sort(function (a, b) { return new Date(b.date || 0) - new Date(a.date || 0); });
        stmtHtml = '<div class="card"><h3>Statement — ' + esc(sc.name) + '</h3><p>Outstanding balance: <b>' + esc(money(sc.balance || 0)) + '</b> &nbsp; Phone: ' + esc(sc.phone || '—') + '</p>' +
          '<h4>Sales</h4>' + (csales.length ? '<table class="tbl"><thead><tr><th>Date</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>' +
            csales.map(function (s) { return '<tr><td>' + esc(fmtDate(saleDate(s))) + '</td><td>' + esc(money(saleTotal(s))) + '</td><td>' + esc(s.paymentMethod || s.method || '—') + '</td><td>' + esc(saleStatusLabel(s)) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p>No sales for this customer.</p>') +
          '<h4>Payments received</h4>' + (cpays.length ? '<table class="tbl"><thead><tr><th>Date</th><th>Amount</th><th>Method</th></tr></thead><tbody>' +
            cpays.map(function (p) { return '<tr><td>' + esc(fmtDay(p.date)) + '</td><td>' + esc(money(p.amount)) + '</td><td>' + esc(p.method || '') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p>No payments recorded.</p>') +
          '<button class="btn btn-ghost" id="cu-stmt-close">Close Statement</button></div>';
      }
    }

    containerEl.innerHTML = '<h2>Customers</h2>' +
      (isOwnerOrManager() ? '<button class="btn btn-primary" id="cu-add">+ Add Customer</button>' : '') +
      formHtml + payHtml + stmtHtml +
      '<div class="card" style="margin-top:12px"><h3>Customer List</h3>' +
      (customers.length ? '<table class="tbl"><thead><tr><th>Name</th><th>Phone</th><th>Address</th><th>Outstanding</th><th></th></tr></thead><tbody>' +
        customers.map(function (x) {
          return '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.phone || '—') + '</td><td>' + esc(x.address || '—') + '</td><td>' + esc(money(x.balance || 0)) + '</td><td>' +
            '<button class="btn" data-stmt="' + esc(x.id) + '">Statement</button> ' +
            (isOwnerOrManager() ? '<button class="btn" data-pay="' + esc(x.id) + '">Collect Payment</button> <button class="btn" data-edit="' + esc(x.id) + '">Edit</button>' : '') +
            '</td></tr>';
        }).join('') + '</tbody></table>' : '<p>No customers yet.</p>') + '</div>';

    var addBtn = containerEl.querySelector('#cu-add');
    if (addBtn) addBtn.addEventListener('click', function () { containerEl._custEdit = 'new'; containerEl._custStmt = null; containerEl._custPay = null; Screens.customers(containerEl); });
    var saveBtn = containerEl.querySelector('#cu-save');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var name = val('cu-name', containerEl).trim();
      if (!name) { notify('Customer name is required.', 'error'); return; }
      var phone = val('cu-phone', containerEl).trim(), address = val('cu-address', containerEl).trim();
      if (DB.checkUniqueness) { var chkC = DB.checkUniqueness('customers', { phone: phone }, editingId === 'new' ? null : editingId); if (!chkC.ok) { notify(chkC.message, 'error'); return; } }
      if (editingId === 'new') {
        st.customers = st.customers || [];
        st.customers.push({ id: nextId('customers'), name: name, phone: phone, address: address, balance: 0 });
        notify('Customer added.', 'success');
      } else {
        var ex = customers.find(function (x) { return String(x.id) === String(editingId); });
        if (ex) { ex.name = name; ex.phone = phone; ex.address = address; notify('Customer updated.', 'success'); }
      }
      save(); containerEl._custEdit = null; Screens.customers(containerEl);
    });
    var cancelBtn = containerEl.querySelector('#cu-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { containerEl._custEdit = null; Screens.customers(containerEl); });
    containerEl.querySelectorAll('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { containerEl._custEdit = b.getAttribute('data-edit'); containerEl._custStmt = null; containerEl._custPay = null; Screens.customers(containerEl); }); });
    containerEl.querySelectorAll('[data-stmt]').forEach(function (b) { b.addEventListener('click', function () { containerEl._custStmt = b.getAttribute('data-stmt'); containerEl._custEdit = null; containerEl._custPay = null; Screens.customers(containerEl); }); });
    containerEl.querySelectorAll('[data-pay]').forEach(function (b) { b.addEventListener('click', function () { containerEl._custPay = b.getAttribute('data-pay'); containerEl._custEdit = null; containerEl._custStmt = null; Screens.customers(containerEl); }); });
    var stmtClose = containerEl.querySelector('#cu-stmt-close');
    if (stmtClose) stmtClose.addEventListener('click', function () { containerEl._custStmt = null; Screens.customers(containerEl); });
    var payCancel = containerEl.querySelector('#cu-pay-cancel');
    if (payCancel) payCancel.addEventListener('click', function () { containerEl._custPay = null; Screens.customers(containerEl); });
    var paySave = containerEl.querySelector('#cu-pay-save');
    if (paySave) paySave.addEventListener('click', function () {
      var amt = numVal('cu-pay-amount', containerEl);
      var pc2 = customers.find(function (x) { return String(x.id) === String(payId); });
      if (!pc2) return;
      if (!(amt > 0)) { notify('Enter an amount above 0.', 'error'); return; }
      if (amt > (Number(pc2.balance) || 0)) { notify('Payment cannot be more than the outstanding balance of ' + money(pc2.balance || 0) + '.', 'error'); return; }
      pc2.balance = (Number(pc2.balance) || 0) - amt;
      st.customerPayments = st.customerPayments || [];
      st.customerPayments.push({ id: nextId('customerPayments'), customerId: pc2.id, customerName: pc2.name, amount: amt, method: val('cu-pay-method', containerEl), date: val('cu-pay-date', containerEl) || todayISO(), branchId: defaultBranchId(), type: 'collection' });
      save(); notify('Payment of ' + money(amt) + ' recorded. Balance is now ' + money(pc2.balance) + '.', 'success');
      containerEl._custPay = null; Screens.customers(containerEl);
    });
  };

  /* ---------- SUPPLIERS ---------- */
  Screens.suppliers = function render(containerEl) {
    if (!can('suppliers', true)) { denied(containerEl, 'Only the Owner can manage suppliers.'); return; }
    var st = S();
    var suppliers = (st.suppliers || []).slice().sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
    var editingId = containerEl._supEdit || null;
    var payId = containerEl._supPay || null;

    var formHtml = '';
    if (editingId !== null) {
      var s0 = editingId === 'new' ? { name: '', phone: '', address: '', balance: 0 } : suppliers.find(function (x) { return String(x.id) === String(editingId); });
      if (s0) {
        formHtml = '<div class="card"><h3>' + (editingId === 'new' ? 'Add Supplier' : 'Edit Supplier') + '</h3>' +
          '<div class="form-row"><label>Name <input id="su-name" value="' + esc(s0.name || '') + '"></label>' +
          '<label>Phone <input id="su-phone" value="' + esc(s0.phone || '') + '"></label></div>' +
          '<div class="form-row"><label>Address <input id="su-address" value="' + esc(s0.address || '') + '"></label></div>' +
          '<button class="btn btn-primary" id="su-save">Save Supplier</button> <button class="btn btn-ghost" id="su-cancel">Cancel</button></div>';
      }
    }
    var payHtml = '';
    if (payId) {
      var ps = suppliers.find(function (x) { return String(x.id) === String(payId); });
      if (ps) {
        payHtml = '<div class="card"><h3>Pay Supplier — ' + esc(ps.name) + ' (Outstanding: ' + esc(money(ps.balance || 0)) + ')</h3>' +
          '<div class="form-row"><label>Amount <input type="number" id="su-pay-amount" min="0" step="0.01"></label>' +
          '<label>Payment Method <select id="su-pay-method"><option>Cash</option><option>JazzCash</option><option>Easypaisa</option><option>Card</option><option>Bank</option></select></label>' +
          '<label>Date <input type="date" id="su-pay-date" value="' + todayISO() + '"></label></div>' +
          '<button class="btn btn-primary" id="su-pay-save">Record Payment</button> <button class="btn btn-ghost" id="su-pay-cancel">Cancel</button></div>';
      }
    }

    containerEl.innerHTML = '<h2>Suppliers</h2><button class="btn btn-primary" id="su-add">+ Add Supplier</button>' +
      formHtml + payHtml +
      '<div class="card" style="margin-top:12px"><h3>Supplier List</h3>' +
      (suppliers.length ? '<table class="tbl"><thead><tr><th>Name</th><th>Phone</th><th>Address</th><th>Outstanding</th><th></th></tr></thead><tbody>' +
        suppliers.map(function (x) {
          return '<tr><td>' + esc(x.name) + '</td><td>' + esc(x.phone || '—') + '</td><td>' + esc(x.address || '—') + '</td><td>' + esc(money(x.balance || 0)) + '</td><td>' +
            '<button class="btn" data-pay="' + esc(x.id) + '">Pay</button> <button class="btn" data-edit="' + esc(x.id) + '">Edit</button></td></tr>';
        }).join('') + '</tbody></table>' : '<p>No suppliers yet.</p>') + '</div>';

    containerEl.querySelector('#su-add').addEventListener('click', function () { containerEl._supEdit = 'new'; containerEl._supPay = null; Screens.suppliers(containerEl); });
    var saveBtn = containerEl.querySelector('#su-save');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var name = val('su-name', containerEl).trim();
      if (!name) { notify('Supplier name is required.', 'error'); return; }
      var phone = val('su-phone', containerEl).trim(), address = val('su-address', containerEl).trim();
      if (DB.checkUniqueness) { var chkS = DB.checkUniqueness('suppliers', { name: name }, editingId === 'new' ? null : editingId); if (!chkS.ok) { notify(chkS.message, 'error'); return; } }
      if (editingId === 'new') {
        st.suppliers = st.suppliers || [];
        st.suppliers.push({ id: nextId('suppliers'), name: name, phone: phone, address: address, balance: 0 });
        notify('Supplier added.', 'success');
      } else {
        var ex = suppliers.find(function (x) { return String(x.id) === String(editingId); });
        if (ex) { ex.name = name; ex.phone = phone; ex.address = address; notify('Supplier updated.', 'success'); }
      }
      save(); containerEl._supEdit = null; Screens.suppliers(containerEl);
    });
    var cancelBtn = containerEl.querySelector('#su-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { containerEl._supEdit = null; Screens.suppliers(containerEl); });
    containerEl.querySelectorAll('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { containerEl._supEdit = b.getAttribute('data-edit'); containerEl._supPay = null; Screens.suppliers(containerEl); }); });
    containerEl.querySelectorAll('[data-pay]').forEach(function (b) { b.addEventListener('click', function () { containerEl._supPay = b.getAttribute('data-pay'); containerEl._supEdit = null; Screens.suppliers(containerEl); }); });
    var payCancel = containerEl.querySelector('#su-pay-cancel');
    if (payCancel) payCancel.addEventListener('click', function () { containerEl._supPay = null; Screens.suppliers(containerEl); });
    var paySave = containerEl.querySelector('#su-pay-save');
    if (paySave) paySave.addEventListener('click', function () {
      var amt = numVal('su-pay-amount', containerEl);
      var ps2 = suppliers.find(function (x) { return String(x.id) === String(payId); });
      if (!ps2) return;
      if (!(amt > 0)) { notify('Enter an amount above 0.', 'error'); return; }
      if (amt > (Number(ps2.balance) || 0)) { notify('Payment cannot be more than the outstanding balance of ' + money(ps2.balance || 0) + '.', 'error'); return; }
      ps2.balance = (Number(ps2.balance) || 0) - amt;
      st.supplierPayments = st.supplierPayments || [];
      st.supplierPayments.push({ id: nextId('supplierPayments'), supplierId: ps2.id, supplierName: ps2.name, amount: amt, method: val('su-pay-method', containerEl), date: val('su-pay-date', containerEl) || todayISO(), branchId: defaultBranchId(), type: 'payment' });
      save(); notify('Payment of ' + money(amt) + ' recorded. Balance is now ' + money(ps2.balance) + '.', 'success');
      containerEl._supPay = null; Screens.suppliers(containerEl);
    });
  };

  /* ---------- EXPENSES ---------- */
  var EXPENSE_CATEGORIES = ['Rent', 'Electricity', 'Staff Salary', 'Transportation', 'Food & Tea', 'Marketing', 'Decoration', 'Maintenance', 'Other'];
  Screens.expenses = function render(containerEl) {
    if (!canAction('expenses', isOwnerOrManager)) { denied(containerEl, 'Only the Owner or Manager can manage expenses.'); return; }
    var st = S();
    var expenses = (st.expenses || []).slice().sort(function (a, b) { return new Date(b.date || 0) - new Date(a.date || 0); });
    var total = expenses.reduce(function (a, e) { return a + (Number(e.amount) || 0); }, 0);

    containerEl.innerHTML = '<h2>Expenses</h2>' +
      '<div class="card"><h3>Add Expense</h3>' +
      '<div class="form-row"><label>Title <input id="ex-title" placeholder="e.g. Shop rent"></label>' +
      '<label>Category <select id="ex-category">' + EXPENSE_CATEGORIES.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></label>' +
      '<label>Amount <input type="number" id="ex-amount" min="0" step="0.01"></label></div>' +
      '<div class="form-row"><label>Date <input type="date" id="ex-date" value="' + todayISO() + '"></label>' +
      '<label>Payment Method <select id="ex-method"><option>Cash</option><option>JazzCash</option><option>Easypaisa</option><option>Card</option><option>Bank</option></select></label>' +
      '<label>Branch <select id="ex-branch">' + branchOptions(defaultBranchId()) + '</select></label></div>' +
      '<div class="form-row"><label>Description <input id="ex-desc" placeholder="Optional note"></label></div>' +
      '<button class="btn btn-primary" id="ex-save">Add Expense</button></div>' +
      '<div class="card" style="margin-top:12px"><h3>Expense List — Total: ' + esc(money(total)) + '</h3>' +
      (expenses.length ? '<table class="tbl"><thead><tr><th>Date</th><th>Title</th><th>Category</th><th>Branch</th><th>Method</th><th>Amount</th><th></th></tr></thead><tbody>' +
        expenses.map(function (e) {
          return '<tr><td>' + esc(fmtDay(e.date)) + '</td><td>' + esc(e.title) + (e.description ? '<br><span style="font-size:12px;opacity:.7">' + esc(e.description) + '</span>' : '') + '</td><td>' + esc(e.category || '') + '</td><td>' + esc(e.branchName || branchName(e.branchId)) + '</td><td>' + esc(e.method || e.paymentMethod || '') + '</td><td>' + esc(money(e.amount)) + '</td><td>' +
            (isOwner() ? '<button class="btn btn-danger" data-del-expense="' + esc(e.id) + '">Delete</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p>No expenses yet.</p>') + '</div>';

    containerEl.querySelector('#ex-save').addEventListener('click', function () {
      var title = val('ex-title', containerEl).trim();
      var amount = numVal('ex-amount', containerEl);
      if (!title) { notify('Expense title is required.', 'error'); return; }
      if (!(amount > 0)) { notify('Enter an amount above 0.', 'error'); return; }
      var branchId = branchIdOf(val('ex-branch', containerEl));
      st.expenses = st.expenses || [];
      st.expenses.push({ id: nextId('expenses'), title: title, category: val('ex-category', containerEl), amount: amount, date: val('ex-date', containerEl) || todayISO(), method: val('ex-method', containerEl), paymentMethod: val('ex-method', containerEl), description: val('ex-desc', containerEl).trim(), branchId: branchId, branchName: branchName(branchId) });
      save(); notify('Expense added.', 'success');
      Screens.expenses(containerEl);
    });
    containerEl.querySelectorAll('[data-del-expense]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!isOwner()) { notify('Only the Owner can delete an expense.', 'error'); return; }
        confirmDlg('Delete expense?', 'Delete this expense?').then(function (ok) {
          if (!ok) return;
          st.expenses = (st.expenses || []).filter(function (x) { return String(x.id) !== String(btn.getAttribute('data-del-expense')); });
          save(); notify('Expense deleted.', 'success');
          Screens.expenses(containerEl);
        });
      });
    });
  };

  /* ---------- EMPLOYEES ---------- */
  Screens.employees = function render(containerEl) {
    if (!canAction('employees', isOwner)) { denied(containerEl, 'Only the Owner can manage employees.'); return; }
    var st = S();
    var employees = (st.employees || []).slice().sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
    var editingId = containerEl._empEdit || null;

    var formHtml = '';
    if (editingId !== null) {
      var e0 = editingId === 'new' ? { name: '', phone: '', position: '', branchId: defaultBranchId(), salary: 0, joiningDate: todayISO(), isActive: true } : employees.find(function (x) { return String(x.id) === String(editingId); });
      if (e0) {
        formHtml = '<div class="card"><h3>' + (editingId === 'new' ? 'Add Employee' : 'Edit Employee') + '</h3>' +
          '<div class="form-row"><label>Name <input id="em-name" value="' + esc(e0.name || '') + '"></label>' +
          '<label>Phone <input id="em-phone" value="' + esc(e0.phone || '') + '"></label>' +
          '<label>Position / Role <input id="em-position" value="' + esc(e0.position || e0.role || '') + '" placeholder="e.g. Cashier"></label></div>' +
          '<div class="form-row"><label>Branch <select id="em-branch">' + branchOptions(e0.branchId) + '</select></label>' +
          '<label>Monthly Salary <input type="number" id="em-salary" min="0" step="0.01" value="' + esc(e0.salary || 0) + '"></label>' +
          '<label>Joining Date <input type="date" id="em-joining" value="' + esc((e0.joiningDate || todayISO()).slice(0, 10)) + '"></label></div>' +
          '<div class="form-row"><label><input type="checkbox" id="em-active" ' + ((e0.isActive !== false && e0.active !== false) ? 'checked' : '') + '> Active</label></div>' +
          '<button class="btn btn-primary" id="em-save">Save Employee</button> <button class="btn btn-ghost" id="em-cancel">Cancel</button></div>';
      }
    }

    containerEl.innerHTML = '<h2>Employees</h2><button class="btn btn-primary" id="em-add">+ Add Employee</button>' + formHtml +
      '<div class="card" style="margin-top:12px"><h3>Employee List</h3>' +
      (employees.length ? '<table class="tbl"><thead><tr><th>Name</th><th>Phone</th><th>Position</th><th>Branch</th><th>Monthly Salary</th><th>Joining Date</th><th>Status</th><th></th></tr></thead><tbody>' +
        employees.map(function (e) {
          return '<tr><td>' + esc(e.name) + '</td><td>' + esc(e.phone || '—') + '</td><td>' + esc(e.position || e.role || '—') + '</td><td>' + esc(e.branchName || branchName(e.branchId)) + '</td><td>' + esc(money(e.salary || 0)) + '</td><td>' + esc(fmtDay(e.joiningDate)) + '</td><td>' + (e.isActive === false || e.active === false ? '<span class="badge badge-red">Inactive</span>' : '<span class="badge badge-green">Active</span>') + '</td><td>' +
            '<button class="btn" data-edit="' + esc(e.id) + '">Edit</button> <button class="btn btn-danger" data-del-emp="' + esc(e.id) + '">Delete</button></td></tr>';
        }).join('') + '</tbody></table>' : '<p>No employees yet.</p>') + '</div>';

    containerEl.querySelector('#em-add').addEventListener('click', function () { containerEl._empEdit = 'new'; Screens.employees(containerEl); });
    var saveBtn = containerEl.querySelector('#em-save');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var name = val('em-name', containerEl).trim();
      if (!name) { notify('Employee name is required.', 'error'); return; }
      var salary = numVal('em-salary', containerEl);
      if (salary < 0) { notify('Salary cannot be negative.', 'error'); return; }
      var branchId = branchIdOf(val('em-branch', containerEl));
      var data = { name: name, phone: val('em-phone', containerEl).trim(), position: val('em-position', containerEl).trim(), role: val('em-position', containerEl).trim(), branchId: branchId, branchName: branchName(branchId), salary: salary, joiningDate: val('em-joining', containerEl) || todayISO(), isActive: containerEl.querySelector('#em-active').checked, active: containerEl.querySelector('#em-active').checked };
      if (editingId === 'new') { data.id = nextId('employees'); st.employees = st.employees || []; st.employees.push(data); notify('Employee added.', 'success'); }
      else { var ex = employees.find(function (x) { return String(x.id) === String(editingId); }); if (ex) { Object.assign(ex, data); notify('Employee updated.', 'success'); } }
      save(); containerEl._empEdit = null; Screens.employees(containerEl);
    });
    var cancelBtn = containerEl.querySelector('#em-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { containerEl._empEdit = null; Screens.employees(containerEl); });
    containerEl.querySelectorAll('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { containerEl._empEdit = b.getAttribute('data-edit'); Screens.employees(containerEl); }); });
    containerEl.querySelectorAll('[data-del-emp]').forEach(function (b) {
      b.addEventListener('click', function () {
        confirmDlg('Delete employee?', 'Delete this employee?').then(function (ok) {
          if (!ok) return;
          st.employees = (st.employees || []).filter(function (x) { return String(x.id) !== String(b.getAttribute('data-del-emp')); });
          save(); notify('Employee deleted.', 'success'); Screens.employees(containerEl);
        });
      });
    });
  };

  /* ---------- CASH REGISTER ---------- */
  function expectedCashFor(sess) {
    var st = S();
    var opened = sess.openedAt ? new Date(sess.openedAt).getTime() : (sess.date ? new Date(sess.date).getTime() : 0);
    var opening = Number(sess.openingCash != null ? sess.openingCash : (sess.opening || 0)) || 0;
    var cashIn = 0, cashOut = 0;
    (st.sales || []).forEach(function (s) {
      if (isCancelled(s)) return;
      if (sess.branchId != null && s.branchId != null && String(s.branchId) !== String(sess.branchId)) return;
      var t = saleDate(s) ? new Date(saleDate(s)).getTime() : 0;
      if (opened && (!t || t < opened)) return;
      var m = String(s.paymentMethod || s.method || '').toLowerCase();
      if (m.indexOf('cash') === -1) return;
      var cashRefund = returnsOf(s).reduce(function (a, r) {
        var rm = String(r.method || s.paymentMethod || '').toLowerCase();
        return a + (rm.indexOf('cash') !== -1 ? (Number(r.refund) || 0) : 0);
      }, 0);
      cashIn += Math.max(0, saleTotal(s) - cashRefund);
    });
    (st.customerPayments || []).forEach(function (p) {
      if (sess.branchId != null && p.branchId != null && String(p.branchId) !== String(sess.branchId)) return;
      var t = p.date ? new Date(p.date).getTime() : 0;
      if (opened && (!t || t < opened)) return;
      if (String(p.method || '').toLowerCase().indexOf('cash') !== -1) cashIn += Number(p.amount) || 0;
    });
    (st.expenses || []).forEach(function (e) {
      if (sess.branchId != null && e.branchId != null && String(e.branchId) !== String(sess.branchId)) return;
      var t = e.date ? new Date(e.date).getTime() : 0;
      if (opened && (!t || t < opened)) return;
      if (String(e.method || e.paymentMethod || '').toLowerCase().indexOf('cash') !== -1) cashOut += Number(e.amount) || 0;
    });
    (st.supplierPayments || []).forEach(function (p) {
      if (sess.branchId != null && p.branchId != null && String(p.branchId) !== String(sess.branchId)) return;
      var t = p.date ? new Date(p.date).getTime() : 0;
      if (opened && (!t || t < opened)) return;
      if (String(p.method || '').toLowerCase().indexOf('cash') !== -1) cashOut += Number(p.amount) || 0;
    });
    return { opening: opening, cashIn: cashIn, cashOut: cashOut, expected: opening + cashIn - cashOut };
  }
  Screens.cash = function render(containerEl) {
    if (!canAction('cash', isOwnerOrManager)) { denied(containerEl, 'Only the Owner or Manager can manage the cash register.'); return; }
    var st = S();
    var sessions = (st.cashSessions || []).slice().sort(function (a, b) { return new Date(b.openedAt || b.date || 0) - new Date(a.openedAt || a.date || 0); });
    var open = sessions.find(function (s) { return String(s.status || '').toLowerCase() === 'open' || !s.closedAt; });

    var openHtml = '';
    if (open) {
      var calc = expectedCashFor(open);
      openHtml = '<div class="card"><h3>Current Open Session</h3>' +
        '<p>Branch: <b>' + esc(open.branchName || branchName(open.branchId)) + '</b> &nbsp; Opened: ' + esc(fmtDate(open.openedAt || open.date)) + '</p>' +
        '<p>Opening cash: ' + esc(money(calc.opening)) + ' &nbsp; Cash in: ' + esc(money(calc.cashIn)) + ' &nbsp; Cash out: ' + esc(money(calc.cashOut)) + '</p>' +
        '<p>Expected cash: <b>' + esc(money(calc.expected)) + '</b></p>' +
        '<div class="form-row"><label>Actual Counted Cash <input type="number" id="cs-actual" min="0" step="0.01"></label></div>' +
        '<button class="btn btn-primary" id="cs-close">Close Session</button></div>';
    } else {
      openHtml = '<div class="card"><h3>Open Session</h3>' +
        '<div class="form-row"><label>Branch <select id="cs-branch">' + branchOptions(defaultBranchId()) + '</select></label>' +
        '<label>Opening Cash <input type="number" id="cs-opening" min="0" step="0.01" value="0"></label></div>' +
        '<button class="btn btn-primary" id="cs-open">Open Session</button></div>';
    }

    containerEl.innerHTML = '<h2>Cash Register</h2>' + openHtml +
      '<div class="card" style="margin-top:12px"><h3>Session History</h3>' +
      (sessions.length ? '<table class="tbl"><thead><tr><th>Branch</th><th>Opened</th><th>Closed</th><th>Opening</th><th>Expected</th><th>Closing</th><th>Difference</th><th>Status</th></tr></thead><tbody>' +
        sessions.map(function (s) {
          var exp = s.expectedCash != null ? Number(s.expectedCash) : expectedCashFor(s).expected;
          var diff = s.difference != null ? Number(s.difference) : (s.closingCash != null ? (Number(s.closingCash) || 0) - exp : null);
          return '<tr><td>' + esc(s.branchName || branchName(s.branchId)) + '</td><td>' + esc(fmtDate(s.openedAt || s.date)) + '</td><td>' + (s.closedAt ? esc(fmtDate(s.closedAt)) : '—') + '</td><td>' + esc(money(s.openingCash || s.opening || 0)) + '</td><td>' + esc(money(exp)) + '</td><td>' + (s.closingCash != null ? esc(money(s.closingCash)) : '—') + '</td><td>' + (diff == null ? '—' : esc(money(diff))) + '</td><td>' + esc(s.status || (s.closedAt ? 'closed' : 'open')) + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p>No cash sessions yet.</p>') + '</div>';

    var openBtn = containerEl.querySelector('#cs-open');
    if (openBtn) openBtn.addEventListener('click', function () {
      var branchId = branchIdOf(val('cs-branch', containerEl));
      var opening = numVal('cs-opening', containerEl);
      if (!branchId) { notify('Please select a branch.', 'error'); return; }
      if (opening < 0) { notify('Opening cash cannot be negative.', 'error'); return; }
      var already = (st.cashSessions || []).some(function (s) { return String(s.branchId) === String(branchId) && (String(s.status || '').toLowerCase() === 'open' || !s.closedAt); });
      if (already) { notify('A session is already open for this branch. Close it first.', 'error'); return; }
      st.cashSessions = st.cashSessions || [];
      st.cashSessions.push({ id: nextId('cashSessions'), branchId: branchId, branchName: branchName(branchId), openedAt: new Date().toISOString(), openingCash: opening, status: 'open' });
      save(); notify('Cash session opened.', 'success');
      Screens.cash(containerEl);
    });
    var closeBtn = containerEl.querySelector('#cs-close');
    if (closeBtn) closeBtn.addEventListener('click', function () {
      if (!open) return;
      var actualRaw = val('cs-actual', containerEl);
      if (actualRaw === '' || actualRaw == null) { notify('Enter the actual counted cash.', 'error'); return; }
      var actual = parseFloat(actualRaw);
      if (isNaN(actual) || actual < 0) { notify('Counted cash cannot be negative.', 'error'); return; }
      var calc2 = expectedCashFor(open);
      open.closedAt = new Date().toISOString();
      open.closingCash = actual;
      open.expectedCash = calc2.expected;
      open.difference = actual - calc2.expected;
      open.status = 'closed';
      save();
      notify('Session closed. Expected ' + money(calc2.expected) + ', counted ' + money(actual) + ', difference ' + money(open.difference) + '.', open.difference === 0 ? 'success' : 'info');
      Screens.cash(containerEl);
    });
  };

  /* ---------- BRANCHES ---------- */
  Screens.branches = function render(containerEl) {
    if (!canAction('branches', isOwner)) { denied(containerEl, 'Only the Owner can manage branches.'); return; }
    var st = S();
    var branches = st.branches || [];
    var editingId = containerEl._brEdit || null;

    var formHtml = '';
    if (editingId !== null) {
      var b0 = editingId === 'new' ? { name: '', type: 'Outlet', ownerName: '', phone: '', address: '' } : branches.find(function (x) { return String(x.id) === String(editingId); });
      if (b0) {
        formHtml = '<div class="card"><h3>' + (editingId === 'new' ? 'Add Branch' : 'Edit Branch') + '</h3>' +
          '<div class="form-row"><label>Branch Name <input id="br-name" value="' + esc(b0.name || '') + '"></label>' +
          '<label>Type <select id="br-type">' + ['Outlet', 'Warehouse', 'Franchise'].map(function (t) { return '<option' + (b0.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></label>' +
          '<label>Owner Name <input id="br-owner" value="' + esc(b0.ownerName || b0.owner || '') + '"></label></div>' +
          '<div class="form-row"><label>Phone <input id="br-phone" value="' + esc(b0.phone || '') + '"></label>' +
          '<label>Address <input id="br-address" value="' + esc(b0.address || '') + '"></label></div>' +
          '<button class="btn btn-primary" id="br-save">Save Branch</button> <button class="btn btn-ghost" id="br-cancel">Cancel</button></div>';
      }
    }

    containerEl.innerHTML = '<h2>Branches</h2><button class="btn btn-primary" id="br-add">+ Add Branch</button>' + formHtml +
      '<div class="card" style="margin-top:12px"><h3>Branch List</h3>' +
      (branches.length ? '<table class="tbl"><thead><tr><th>Name</th><th>Type</th><th>Owner</th><th>Phone</th><th>Address</th><th></th></tr></thead><tbody>' +
        branches.map(function (b) {
          return '<tr><td>' + esc(b.name) + '</td><td>' + esc(b.type || '—') + '</td><td>' + esc(b.ownerName || b.owner || '—') + '</td><td>' + esc(b.phone || '—') + '</td><td>' + esc(b.address || '—') + '</td><td>' +
            '<button class="btn" data-edit="' + esc(b.id) + '">Edit</button> ' + (isOwner() ? '<button class="btn btn-danger" data-del-branch="' + esc(b.id) + '">Delete</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p>No branches yet.</p>') + '</div>';

    containerEl.querySelector('#br-add').addEventListener('click', function () { containerEl._brEdit = 'new'; Screens.branches(containerEl); });
    var saveBtn = containerEl.querySelector('#br-save');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var name = val('br-name', containerEl).trim();
      if (!name) { notify('Branch name is required.', 'error'); return; }
      if (DB.checkUniqueness) { var chkB = DB.checkUniqueness('branches', { name: name }, editingId === 'new' ? null : editingId); if (!chkB.ok) { notify(chkB.message, 'error'); return; } }
      else { var dup = branches.some(function (b) { return String(b.name).toLowerCase() === name.toLowerCase() && String(b.id) !== String(editingId); }); if (dup) { notify('A branch with this name already exists.', 'error'); return; } }
      var data = { name: name, type: val('br-type', containerEl), ownerName: val('br-owner', containerEl).trim(), owner: val('br-owner', containerEl).trim(), phone: val('br-phone', containerEl).trim(), address: val('br-address', containerEl).trim() };
      if (editingId === 'new') {
        data.id = nextId('branches'); st.branches = st.branches || []; st.branches.push(data);
        notify('Branch added.', 'success');
      } else {
        var ex = branches.find(function (x) { return String(x.id) === String(editingId); });
        if (ex) {
          var oldName = ex.name;
          Object.assign(ex, data);
          // Rename carries into every record that stores the branch name.
          ['sales', 'purchases', 'expenses', 'cashSessions', 'transfers', 'stockMovements'].forEach(function (coll) {
            (st[coll] || []).forEach(function (rec) { if (String(rec.branchId) === String(ex.id)) rec.branchName = name; });
          });
          notify(oldName === name ? 'Branch updated.' : 'Branch renamed to "' + name + '" — the new name was applied to past sales, purchases, expenses, cash sessions, transfers and stock movements.', 'success');
        }
      }
      save(); containerEl._brEdit = null; Screens.branches(containerEl);
    });
    var cancelBtn = containerEl.querySelector('#br-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { containerEl._brEdit = null; Screens.branches(containerEl); });
    containerEl.querySelectorAll('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { containerEl._brEdit = b.getAttribute('data-edit'); Screens.branches(containerEl); }); });
    containerEl.querySelectorAll('[data-del-branch]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!isOwner()) { notify('Only the Owner can delete a branch.', 'error'); return; }
        var id = b.getAttribute('data-del-branch');
        var used = ['sales', 'purchases', 'expenses', 'cashSessions', 'transfers'].some(function (coll) { return (st[coll] || []).some(function (r) { return String(r.branchId) === String(id); }); });
        if (used) { notify('This branch cannot be deleted because sales, purchases, expenses, cash sessions or transfers use it.', 'error'); return; }
        confirmDlg('Delete branch?', 'Delete this branch?').then(function (ok) {
          if (!ok) return;
          st.branches = (st.branches || []).filter(function (x) { return String(x.id) !== String(id); });
          save(); notify('Branch deleted.', 'success'); Screens.branches(containerEl);
        });
      });
    });
  };

  /* ---------- LOGINS (Owner only) ---------- */
  function activeOwners() { return (S().appUsers || []).filter(function (u) { return u.role === 'Owner' && u.isActive !== false && u.active !== false; }); }
  function userIsActive(u) { return u.isActive !== false && u.active !== false; }
  Screens.logins = function render(containerEl) {
    if (!isOwner()) { denied(containerEl, 'Only the Owner can manage logins.'); return; }
    var st = S();
    var users = st.appUsers || [];
    var editingId = containerEl._lgEdit || null;
    var pinFor = containerEl._lgPin || null;

    var formHtml = '';
    if (editingId !== null) {
      var u0 = editingId === 'new'
        ? { name: '', username: '', role: 'Cashier', branchId: defaultBranchId(), isActive: true }
        : users.find(function (x) { return String(x.id) === String(editingId); });
      if (u0) {
        var isNew = editingId === 'new';
        formHtml = '<div class="card"><h3>' + (isNew ? 'Add Login' : 'Edit Login') + '</h3>' +
          '<div class="form-row"><label>Name <input id="lg-name" value="' + esc(u0.name || '') + '"></label>' +
          '<label>Username <input id="lg-username" value="' + esc(u0.username || '') + '"></label>' +
          '<label>Role <select id="lg-role">' + ['Owner', 'Manager', 'Cashier', 'Storekeeper', 'Franchise', 'Salesman'].map(function (r) { return '<option' + (u0.role === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></label></div>' +
          '<div class="form-row"><label>Branch (for non-Owners) <select id="lg-branch">' + branchOptions(u0.branchId) + '</select></label>' +
          (isNew ? '<label>PIN (4–6 digits) <input id="lg-pin" type="password" inputmode="numeric" maxlength="6" placeholder="e.g. 1234"></label>' : '') +
          (!isNew ? '<label><input type="checkbox" id="lg-active" ' + (userIsActive(u0) ? 'checked' : '') + '> Active</label>' : '') + '</div>' +
          '<button class="btn btn-primary" id="lg-save">Save Login</button> <button class="btn btn-ghost" id="lg-cancel">Cancel</button></div>';
      }
    }
    var pinHtml = '';
    if (pinFor) {
      var pu = users.find(function (x) { return String(x.id) === String(pinFor); });
      if (pu) {
        pinHtml = '<div class="card"><h3>Reset PIN — ' + esc(pu.name) + ' (' + esc(pu.username) + ')</h3>' +
          '<div class="form-row"><label>New PIN (4–6 digits) <input id="lg-newpin" type="password" inputmode="numeric" maxlength="6"></label></div>' +
          '<button class="btn btn-primary" id="lg-pin-save">Set New PIN</button> <button class="btn btn-ghost" id="lg-pin-cancel">Cancel</button></div>';
      }
    }

    containerEl.innerHTML = '<h2>Logins</h2><button class="btn btn-primary" id="lg-add">+ Add Login</button>' + formHtml + pinHtml +
      '<div class="card" style="margin-top:12px"><h3>Login List</h3>' +
      (users.length ? '<table class="tbl"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Branch</th><th>Status</th><th></th></tr></thead><tbody>' +
        users.map(function (u) {
          return '<tr><td>' + esc(u.name) + '</td><td>' + esc(u.username) + '</td><td>' + esc(u.role) + '</td><td>' + (u.role === 'Owner' ? 'All branches' : esc(u.branchName || branchName(u.branchId))) + '</td><td>' + (!userIsActive(u) ? '<span class="badge badge-red">Inactive</span>' : '<span class="badge badge-green">Active</span>') + '</td><td>' +
            '<button class="btn" data-edit="' + esc(u.id) + '">Edit</button> <button class="btn" data-pin="' + esc(u.id) + '">Reset PIN</button> <button class="btn btn-danger" data-del-login="' + esc(u.id) + '">Delete</button></td></tr>';
        }).join('') + '</tbody></table>' : '<p>No logins yet.</p>') + '</div>';

    containerEl.querySelector('#lg-add').addEventListener('click', function () { containerEl._lgEdit = 'new'; containerEl._lgPin = null; Screens.logins(containerEl); });
    var saveBtn = containerEl.querySelector('#lg-save');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var name = val('lg-name', containerEl).trim();
      var username = val('lg-username', containerEl).trim();
      var userRole = val('lg-role', containerEl);
      var branchId = branchIdOf(val('lg-branch', containerEl));
      if (!name) { notify('Name is required.', 'error'); return; }
      if (!username) { notify('Username is required.', 'error'); return; }
      if (DB.checkUniqueness) { var chkU = DB.checkUniqueness('appUsers', { username: username }, editingId === 'new' ? null : editingId); if (!chkU.ok) { notify(chkU.message, 'error'); return; } }
      else { var dup = users.some(function (u) { return String(u.username).toLowerCase() === username.toLowerCase() && String(u.id) !== String(editingId); }); if (dup) { notify('This username is already taken. Please choose a different username.', 'error'); return; } }
      if (userRole !== 'Owner' && !branchId) { notify('Please select a branch for a non-Owner login.', 'error'); return; }
      if (editingId === 'new') {
        var pin = val('lg-pin', containerEl).trim();
        if (!/^\d{4,6}$/.test(pin)) { notify('PIN must be 4 to 6 digits.', 'error'); return; }
        st.appUsers = st.appUsers || [];
        // PINs are stored hashed only (pinHash via DB.hashPin).
        // Store both so either path works.
        st.appUsers.push({ id: nextId('appUsers'), name: name, username: username, pinHash: hashPin(pin), role: userRole, branchId: userRole === 'Owner' ? null : branchId, branchName: userRole === 'Owner' ? null : branchName(branchId), isActive: true, active: true });
        notify('Login added.', 'success');
      } else {
        var ex = users.find(function (x) { return String(x.id) === String(editingId); });
        if (!ex) return;
        var isLastOwner = ex.role === 'Owner' && userIsActive(ex) && activeOwners().length <= 1;
        if (isLastOwner && userRole !== 'Owner') { notify('The last Owner cannot be demoted. Add another Owner first.', 'error'); return; }
        var activeBox = containerEl.querySelector('#lg-active');
        var wantActive = activeBox ? activeBox.checked : true;
        if (isLastOwner && !wantActive) { notify('The last Owner cannot be deactivated. Add another Owner first.', 'error'); return; }
        ex.name = name; ex.username = username; ex.role = userRole;
        ex.branchId = userRole === 'Owner' ? null : branchId;
        ex.branchName = userRole === 'Owner' ? null : branchName(branchId);
        ex.isActive = wantActive; ex.active = wantActive;
        notify('Login updated.', 'success');
      }
      save(); containerEl._lgEdit = null; Screens.logins(containerEl);
    });
    var cancelBtn = containerEl.querySelector('#lg-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { containerEl._lgEdit = null; Screens.logins(containerEl); });
    containerEl.querySelectorAll('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { containerEl._lgEdit = b.getAttribute('data-edit'); containerEl._lgPin = null; Screens.logins(containerEl); }); });
    containerEl.querySelectorAll('[data-pin]').forEach(function (b) { b.addEventListener('click', function () { containerEl._lgPin = b.getAttribute('data-pin'); containerEl._lgEdit = null; Screens.logins(containerEl); }); });
    var pinCancel = containerEl.querySelector('#lg-pin-cancel');
    if (pinCancel) pinCancel.addEventListener('click', function () { containerEl._lgPin = null; Screens.logins(containerEl); });
    var pinSave = containerEl.querySelector('#lg-pin-save');
    if (pinSave) pinSave.addEventListener('click', function () {
      var pin = val('lg-newpin', containerEl).trim();
      if (!/^\d{4,6}$/.test(pin)) { notify('PIN must be 4 to 6 digits.', 'error'); return; }
      var target = users.find(function (x) { return String(x.id) === String(pinFor); });
      if (!target) return;
      target.pinHash = hashPin(pin);
      delete target.pin; // plain PINs are never stored; login uses DB.checkPin only
      save(); notify('PIN reset for ' + target.name + '.', 'success');
      containerEl._lgPin = null; Screens.logins(containerEl);
    });
    containerEl.querySelectorAll('[data-del-login]').forEach(function (b) {
      b.addEventListener('click', function () {
        var target = users.find(function (x) { return String(x.id) === String(b.getAttribute('data-del-login')); });
        if (!target) return;
        if (target.role === 'Owner' && userIsActive(target) && activeOwners().length <= 1) { notify('The last Owner cannot be deleted. Add another Owner first.', 'error'); return; }
        if (window.App && App.user && String(App.user.id) === String(target.id)) { notify('You cannot delete your own login while signed in.', 'error'); return; }
        confirmDlg('Delete login?', 'Delete login "' + target.username + '"?').then(function (ok) {
          if (!ok) return;
          st.appUsers = (st.appUsers || []).filter(function (x) { return String(x.id) !== String(target.id); });
          save(); notify('Login deleted.', 'success'); Screens.logins(containerEl);
        });
      });
    });
  };
})();
