/* RARA POS — Dashboard (Agent C)
   Contract: const DB = require('./db.js'); window.App helpers; window.Screens registry.
   Reads/writes DB.state only, calls DB.save() (via save()). No mock data. */
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

  function S() { return DB.state || state; }
  function save() { try { if (DB && DB.save) DB.save(); else if (window.App && App.save) App.save(); } catch (e) {} }
  function money(n) { try { if (window.App && App.money) return App.money(n); } catch (e) {} return 'Rs ' + (Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 }); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(x) { try { return new Date(x).toLocaleString('en-GB'); } catch (e) { return String(x || ''); } }
  function fmtDay(x) { try { return new Date(x).toLocaleDateString('en-GB'); } catch (e) { return String(x || ''); } }
  function isOwner() { try { if (window.App && App.canSeeCost) return !!App.canSeeCost(); } catch (e) {} return !!(window.App && App.user && App.user.role === 'Owner'); }
  function saleDate(s) { return s.date || s.createdAt || s.timestamp || s.time || s.saleDate; }
  function saleItems(s) { return s.items || s.lines || s.products || []; }
  function itemQty(it) { return Number(it.qty != null ? it.qty : (it.quantity != null ? it.quantity : 1)) || 0; }
  function itemPrice(it) { return Number(it.unitPrice != null ? it.unitPrice : (it.price != null ? it.price : (it.salePrice != null ? it.salePrice : 0))) || 0; }
  function saleTotal(s) {
    if (s.total != null) return Number(s.total) || 0;
    if (s.grandTotal != null) return Number(s.grandTotal) || 0;
    return saleItems(s).reduce(function (a, it) { return a + itemQty(it) * itemPrice(it); }, 0);
  }
  // ---- v1.1.6: Owner dashboard date filter ----
  // Module state (not DOM state) so the selected date survives
  // re-renders. Owner-only: the filter bar and the sections it drives
  // are rendered only when isOwner() is true. Return/cancel netting
  // now comes from DB (isSuccessfulSale / netSaleTotal / returnsRefund
  // / returnedQty / ownerUnitCost) so the dashboard, Sales History and
  // Reports all count the same way. Only successful sales count:
  // cancelled and fully returned sales are excluded from totals and
  // order counts, and a partial return subtracts only the returned
  // product's amount.
  var dashFilter = { mode: 'today', customDate: '' };
  var dashContainer = null;
  function localISO(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function filterDate() {
    var now = new Date();
    if (dashFilter.mode === 'yesterday') { var y = new Date(now); y.setDate(now.getDate() - 1); return y; }
    if (dashFilter.mode === 'custom' && dashFilter.customDate) {
      var p = String(dashFilter.customDate).split('-');
      var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
      if (!isNaN(d.getTime())) return d;
    }
    return now;
  }
  function filterLabel() {
    var d = filterDate();
    if (dashFilter.mode === 'yesterday') return 'Yesterday — ' + fmtDay(d);
    if (dashFilter.mode === 'custom') return 'Custom Date — ' + fmtDay(d);
    return 'Today — ' + fmtDay(d);
  }
  function sameDay(a, b) { var d1 = new Date(a), d2 = new Date(b); return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate(); }
  function prodById(id) { var st = S(); return (st.products || []).find(function (p) { return String(p.id) === String(id); }); }
  function lowThreshold(p) {
    var st = S();
    if (p.lowThreshold != null) return Number(p.lowThreshold);
    if (p.lowStockThreshold != null) return Number(p.lowStockThreshold);
    if (p.lowStock != null) return Number(p.lowStock);
    if (st.settings && st.settings.lowStockThreshold != null) return Number(st.settings.lowStockThreshold);
    if (st.settings && st.settings.lowStockDefault != null) return Number(st.settings.lowStockDefault);
    return 10;
  }
  function totalStock(p) {
    // Real shape (db.js / seed.json): product.stock is the total and
    // product.branchStocks is [{branchId, qty}]; DB.stockOf(p) returns that total.
    if (DB.stockOf) { try { return Number(DB.stockOf(p)) || 0; } catch (e) {} }
    if (p.branchStocks && Array.isArray(p.branchStocks)) return p.branchStocks.reduce(function (a, b) { return a + (Number(b.qty) || 0); }, 0);
    if (p.stockByBranch && typeof p.stockByBranch === 'object') {
      return Object.keys(p.stockByBranch).reduce(function (a, k) { return a + (Number(p.stockByBranch[k]) || 0); }, 0);
    }
    if (p.stock != null && typeof p.stock === 'number') return p.stock;
    return 0;
  }
  function branchName(id) {
    try { if (window.App && App.branchName) return App.branchName(id); } catch (e) {}
    var b = (S().branches || []).find(function (x) { return String(x.id) === String(id); });
    return b ? b.name : (id == null ? '—' : String(id));
  }

  Screens.dashboard = function render(containerEl) {
    var st = S();
    var now = new Date();
    var products = st.products || [];
    var sales = st.sales || [];
    var expenses = st.expenses || [];
    var customers = st.customers || [];
    var suppliers = st.suppliers || [];
    var cashSessions = st.cashSessions || [];

    // v1.1.6: only successful sales count — cancelled and fully
    // returned sales are excluded from today's totals and order count.
    var todaySales = sales.filter(function (s) { return DB.isSuccessfulSale(s) && saleDate(s) && sameDay(saleDate(s), now); });
    var todayTotal = todaySales.reduce(function (a, s) { return a + DB.netSaleTotal(s); }, 0);
    var todayOrders = todaySales.length;
    // Returns today: every refund recorded today. A sale that was
    // returned and then cancelled still counts here — the customer
    // really did get that money back. (Same rule as the Selected Date
    // Summary and Sales History, so all three agree.)
    var todayReturns = sales.filter(function (s) { return saleDate(s) && sameDay(saleDate(s), now); })
      .reduce(function (a, s) { return a + DB.returnsRefund(s); }, 0);

    var owner = isOwner();
    // Stock value at COST is Owner-only (item 7): other roles see the
    // value at sale price, so purchase costs never leak through the
    // dashboard.
    var stockValue = owner
      ? products.reduce(function (a, p) { return a + totalStock(p) * (Number(p.purchasePrice != null ? p.purchasePrice : (p.costPrice || 0)) || 0); }, 0)
      : products.reduce(function (a, p) { return a + totalStock(p) * (Number(p.price) || 0); }, 0);
    var stockValueSub = owner ? 'at cost price' : 'at sale price';
    var lowStock = products.filter(function (p) { return totalStock(p) <= lowThreshold(p); });

    // Today's profit (Owner only): net qty sold (after returns) x (price - cost snapshot)
    var todayProfit = 0, todayCostZero = false;
    todaySales.forEach(function (s) {
      saleItems(s).forEach(function (it) {
        var prod = it.productId != null ? prodById(it.productId) : null;
        // Owner cost basis (v1.1.6): the product's current purchasePrice
        // — not the cost snapshot on the sale line (cashier-recorded
        // sales carry a 0 snapshot, which overstated profit).
        var c = DB.ownerUnitCost(it, prod);
        var netQty = itemQty(it) - DB.returnedQty(s, it.productId);
        if (!c && netQty > 0) todayCostZero = true;
        todayProfit += (itemPrice(it) - c) * netQty;
      });
    });

    // Available cash: expected cash in currently open sessions
    function expectedCash(sess) {
      var opened = new Date(sess.openedAt || sess.opened || sess.date).getTime();
      var opening = Number(sess.openingCash || sess.opening || 0) || 0;
      var cashIn = 0, cashOut = 0;
      (st.sales || []).forEach(function (s) {
        if (DB.isCancelledSale(s)) return;
        if (sess.branchId != null && s.branchId != null && String(s.branchId) !== String(sess.branchId)) return;
        var t = saleDate(s) ? new Date(saleDate(s)).getTime() : 0;
        if (!t || t < opened) return;
        var m = String(s.paymentMethod || s.method || '').toLowerCase();
        if (m.indexOf('cash') === -1) return;
        // Cash kept from this sale = total minus any cash refunds on it.
        var cashRefund = DB.returnsOf(s).reduce(function (a, r) {
          var rm = String(r.method || s.paymentMethod || '').toLowerCase();
          return a + (rm.indexOf('cash') !== -1 ? (Number(r.refund) || 0) : 0);
        }, 0);
        cashIn += Math.max(0, saleTotal(s) - cashRefund);
      });
      (st.customerPayments || []).forEach(function (p) {
        if (sess.branchId != null && p.branchId != null && String(p.branchId) !== String(sess.branchId)) return;
        var t = p.date ? new Date(p.date).getTime() : 0;
        if (!t || t < opened) return;
        if (String(p.method || '').toLowerCase().indexOf('cash') !== -1) cashIn += Number(p.amount) || 0;
      });
      (st.expenses || []).forEach(function (e) {
        var t = e.date ? new Date(e.date).getTime() : 0;
        if (!t || t < opened) return;
        if (sess.branchId != null && e.branchId != null && String(e.branchId) !== String(sess.branchId)) return;
        if (String(e.method || e.paymentMethod || '').toLowerCase().indexOf('cash') !== -1) cashOut += Number(e.amount) || 0;
      });
      (st.supplierPayments || []).forEach(function (p) {
        if (sess.branchId != null && p.branchId != null && String(p.branchId) !== String(sess.branchId)) return;
        var t = p.date ? new Date(p.date).getTime() : 0;
        if (!t || t < opened) return;
        if (String(p.method || '').toLowerCase().indexOf('cash') !== -1) cashOut += Number(p.amount) || 0;
      });
      return opening + cashIn - cashOut;
    }
    var openSessions = cashSessions.filter(function (s) { return String(s.status || '').toLowerCase() === 'open' || !s.closedAt; });
    var availableCash = openSessions.reduce(function (a, s) { return a + expectedCash(s); }, 0);

    var custOutstanding = customers.reduce(function (a, c) { return a + Math.max(0, Number(c.balance) || 0); }, 0);
    var suppOutstanding = suppliers.reduce(function (a, c) { return a + Math.max(0, Number(c.balance) || 0); }, 0);

    // Branch-wise sales (all time, successful sales only, net of returns)
    var byBranch = {};
    sales.filter(function (s) { return DB.isSuccessfulSale(s); }).forEach(function (s) {
      var k = s.branchId != null ? String(s.branchId) : 'unknown';
      if (!byBranch[k]) byBranch[k] = { name: s.branchName || branchName(s.branchId), orders: 0, total: 0 };
      byBranch[k].orders += 1; byBranch[k].total += DB.netSaleTotal(s);
    });
    var branchRows = Object.keys(byBranch).map(function (k) { return byBranch[k]; }).sort(function (a, b) { return b.total - a.total; });

    // Best sellers (net qty after returns, successful sales only)
    var best = {};
    sales.filter(function (s) { return DB.isSuccessfulSale(s); }).forEach(function (s) {
      saleItems(s).forEach(function (it) {
        var name = it.name || it.productName || (prodById(it.productId) || {}).name || 'Product';
        var k = it.productId != null ? String(it.productId) : name;
        if (!best[k]) best[k] = { name: name, qty: 0, revenue: 0 };
        var netQ = itemQty(it) - DB.returnedQty(s, it.productId);
        best[k].qty += netQ; best[k].revenue += netQ * itemPrice(it);
      });
    });
    var bestList = Object.keys(best).map(function (k) { return best[k]; }).sort(function (a, b) { return b.qty - a.qty; }).slice(0, 5);

    // Recent sales (last 8)
    var recent = sales.slice().sort(function (a, b) { return new Date(saleDate(b) || 0) - new Date(saleDate(a) || 0); }).slice(0, 8);

    // Last 7 days sales
    var days = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now); d.setDate(d.getDate() - i);
      var daySales = sales.filter(function (s) { return DB.isSuccessfulSale(s) && saleDate(s) && sameDay(saleDate(s), d); });
      days.push({ label: fmtDay(d), orders: daySales.length, total: daySales.reduce(function (a, s) { return a + DB.netSaleTotal(s); }, 0) });
    }

    function card(label, value, sub) {
      return '<div class="card"><div style="font-size:13px;opacity:.75">' + esc(label) + '</div>' +
        '<div style="font-size:22px;font-weight:700;margin-top:4px">' + value + '</div>' +
        (sub ? '<div style="font-size:12px;opacity:.7;margin-top:4px">' + sub + '</div>' : '') + '</div>';
    }
    // Today's Overview (v1.1.6): aaj ki sales aur profit — hamesha aaj
    // par based, chahe neeche date filter kuch bhi ho.
    var todayCards = '';
    todayCards += card("Today's Sales", esc(money(todayTotal)), todayOrders + ' successful order(s) today');
    todayCards += card("Today's Orders", String(todayOrders), 'successful sales — aaj');
    if (owner) {
      todayCards += card("Today's Profit", esc(money(todayProfit)), todayCostZero ? 'Note: kuch products ki cost 0 hai — profit zyada dikh sakta hai' : 'sales profit today (cost = Purchase Price)');
    }
    todayCards += card("Today's Returns", esc(money(todayReturns)), 'wapas ki gayi raqam — aaj');
    // Business Overview: baaki cards (aaj par based nahi).
    var businessCards = '';
    businessCards += card('Total Products', String(products.length), '');
    businessCards += card('Stock Value', esc(money(stockValue)), stockValueSub);
    businessCards += card('Low Stock', String(lowStock.length), lowStock.length ? 'needs attention' : 'all OK');
    businessCards += card('Available Cash', esc(money(availableCash)), openSessions.length ? openSessions.length + ' open session(s)' : 'no open cash session');
    businessCards += card('Customer Outstanding', esc(money(custOutstanding)), customers.length + ' customer(s)');
    businessCards += card('Supplier Outstanding', esc(money(suppOutstanding)), suppliers.length + ' supplier(s)');

    // ---- v1.1.6: Owner-only date filter + selected-date summary +
    // product-wise cost & profit (Owner dashboard only) ----
    var ownerExtra = '';
    if (owner) {
      var fDate = filterDate();
      var daySales = sales.filter(function (s) { return saleDate(s) && sameDay(saleDate(s), fDate); });
      var pw = DB.productWise(daySales, products);
      var selCards = '';
      selCards += card('Total Sales', esc(money(pw.netSales)), pw.orders + ' successful order(s)');
      selCards += card('Total Cost', esc(money(pw.totals.cost)), 'cost = Purchase Price');
      selCards += card('Total Profit', esc(money(pw.netProfit)), 'sales − cost');
      selCards += card('Returns', esc(money(pw.returns)), 'wapas ki gayi raqam');
      var pwHtml = '';
      if (pw.rows.length) {
        pwHtml = '<table class="tbl" id="product-wise-table"><thead><tr><th>Product</th><th>Qty Sold</th><th>Returned</th><th>Total Sales</th><th>Total Cost</th><th>Total Profit</th></tr></thead><tbody>' +
          pw.rows.map(function (r) {
            return '<tr><td>' + esc(r.name) + '</td><td>' + r.qty + '</td><td>' + r.returned + '</td><td>' + esc(money(r.revenue)) + '</td><td>' + esc(money(r.cost)) + '</td><td>' + esc(money(r.profit)) + '</td></tr>';
          }).join('') +
          '<tr style="font-weight:700"><td>Total</td><td>' + pw.totals.qty + '</td><td>' + pw.totals.returned + '</td><td>' + esc(money(pw.totals.revenue)) + '</td><td>' + esc(money(pw.totals.cost)) + '</td><td>' + esc(money(pw.totals.profit)) + '</td></tr>' +
          '</tbody></table>';
        if (pw.costZero) {
          pwHtml += '<p style="font-size:12px;color:#f59e0b;margin-top:8px">Note: kuch products ki Purchase Price (cost) abhi 0 hai — unka profit sales ke barabar dikh raha hai. Products &gt; Edit mein asal cost enter karein, phir profit sahi hoga.</p>';
        }
      } else {
        pwHtml = '<p>Is date par koi successful sale nahi hai.</p>';
      }
      ownerExtra =
        '<div class="card" style="margin-top:12px"><h3>Dashboard Date Filter</h3>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
        '<button id="dash-filter-today" class="btn" style="' + (dashFilter.mode === 'today' ? 'background:#0f766e;color:#fff' : '') + '">Today</button>' +
        '<button id="dash-filter-yesterday" class="btn" style="' + (dashFilter.mode === 'yesterday' ? 'background:#0f766e;color:#fff' : '') + '">Yesterday</button>' +
        '<button id="dash-filter-custom" class="btn" style="' + (dashFilter.mode === 'custom' ? 'background:#0f766e;color:#fff' : '') + '">Custom Date</button>' +
        '<input id="dash-filter-date" type="date" value="' + esc(localISO(fDate)) + '" style="padding:8px;border:1px solid #ccc;border-radius:6px">' +
        '</div><p style="font-size:12px;opacity:.75;margin-top:8px">Selected: ' + esc(filterLabel()) + ' — neeche wale totals aur product-wise table isi date ke hain. Upar wala Today\'s Overview hamesha aaj ka rehta hai.</p></div>' +
        '<h3 style="margin-top:16px">Selected Date — Summary</h3>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:12px 0">' + selCards + '</div>' +
        '<div class="card"><h3>Product-wise Cost &amp; Profit</h3>' + pwHtml + '</div>';
    }

    var branchHtml = branchRows.length
      ? '<table class="tbl"><thead><tr><th>Branch</th><th>Orders</th><th>Total Sales</th></tr></thead><tbody>' +
        branchRows.map(function (r) { return '<tr><td>' + esc(r.name) + '</td><td>' + r.orders + '</td><td>' + esc(money(r.total)) + '</td></tr>'; }).join('') +
        '</tbody></table>'
      : '<p>No sales yet.</p>';

    var bestHtml = bestList.length
      ? '<table class="tbl"><thead><tr><th>Product</th><th>Qty Sold</th><th>Revenue</th></tr></thead><tbody>' +
        bestList.map(function (r) { return '<tr><td>' + esc(r.name) + '</td><td>' + r.qty + '</td><td>' + esc(money(r.revenue)) + '</td></tr>'; }).join('') +
        '</tbody></table>'
      : '<p>No sales yet.</p>';

    var recentHtml = recent.length
      ? '<table class="tbl"><thead><tr><th>Date</th><th>Branch</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>' +
        recent.map(function (s) {
          var items = saleItems(s).map(function (it) { return (it.name || it.productName || 'Item') + ' × ' + itemQty(it); }).join(', ');
          var stt = String(s.status || 'completed').toLowerCase();
          var badge = stt === 'cancelled' ? '<span class="badge badge-red">Cancelled</span>'
            : stt === 'returned' ? '<span class="badge badge-red">Returned</span>'
            : stt === 'partial-return' ? '<span class="badge badge-amber">Partial Return</span>'
            : stt === 'partial' ? '<span class="badge badge-teal">Partial / Credit</span>'
            : '<span class="badge badge-green">Completed</span>';
          return '<tr><td>' + esc(fmtDate(saleDate(s))) + '</td><td>' + esc(s.branchName || branchName(s.branchId)) + '</td><td>' + esc(items) + '</td><td>' + esc(money(DB.netSaleTotal(s))) + '</td><td>' + badge + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p>No sales yet.</p>';

    var lowHtml = lowStock.length
      ? '<table class="tbl"><thead><tr><th>Product</th><th>Stock</th><th>Threshold</th></tr></thead><tbody>' +
        lowStock.map(function (p) {
          var q = totalStock(p);
          return '<tr><td>' + esc(p.name) + '</td><td><span class="badge ' + (q <= 0 ? 'badge-red' : 'badge-amber') + '">' + q + '</span></td><td>' + lowThreshold(p) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p>No low-stock products.</p>';

    var daysHtml = '<table class="tbl"><thead><tr><th>Date</th><th>Orders</th><th>Sales</th></tr></thead><tbody>' +
      days.map(function (d) { return '<tr><td>' + esc(d.label) + '</td><td>' + d.orders + '</td><td>' + esc(money(d.total)) + '</td></tr>'; }).join('') +
      '</tbody></table>';

    dashContainer = containerEl;
    containerEl.innerHTML =
      '<h2>Dashboard</h2>' +
      '<h3>Today\'s Overview</h3>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:12px 0">' + todayCards + '</div>' +
      '<h3>Business Overview</h3>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:12px 0">' + businessCards + '</div>' +
      ownerExtra +
      '<div class="card"><h3>Branch-wise Sales</h3>' + branchHtml + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">' +
      '<div class="card"><h3>Best Sellers</h3>' + bestHtml + '</div>' +
      '<div class="card"><h3>Low Stock</h3>' + lowHtml + '</div></div>' +
      '<div class="card" style="margin-top:12px"><h3>Recent Sales (last 8)</h3>' + recentHtml + '</div>' +
      '<div class="card" style="margin-top:12px"><h3>Last 7 Days Sales</h3>' + daysHtml + '</div>';

    // Wire the Owner-only filter (re-render this screen on change).
    (function wireFilter() {
      var rerender = function () { if (dashContainer) Screens.dashboard(dashContainer); };
      var ft = containerEl.querySelector('#dash-filter-today');
      if (ft) ft.addEventListener('click', function () { dashFilter.mode = 'today'; rerender(); });
      var fy = containerEl.querySelector('#dash-filter-yesterday');
      if (fy) fy.addEventListener('click', function () { dashFilter.mode = 'yesterday'; rerender(); });
      var fc = containerEl.querySelector('#dash-filter-custom');
      if (fc) fc.addEventListener('click', function () { dashFilter.mode = 'custom'; rerender(); });
      var fd = containerEl.querySelector('#dash-filter-date');
      if (fd) fd.addEventListener('change', function () { dashFilter.customDate = fd.value; dashFilter.mode = 'custom'; rerender(); });
    })();
  };
})();
