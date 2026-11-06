/* RARA POS — Reports (Agent C, Owner only)
   Contract: const DB = require('./db.js'); window.App helpers; window.Screens registry.
   Computed from real records only. CSV export via Blob + <a download>; Print via window.print(). */
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
  function notify(msg, type) { try { if (window.App && App.notify) { App.notify(msg, type || 'info'); return; } } catch (e) {} alert(msg); }
  function money(n) { try { if (window.App && App.money) return App.money(n); } catch (e) {} return 'Rs ' + (Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 }); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDay(x) { try { return new Date(x).toLocaleDateString('en-GB'); } catch (e) { return String(x || ''); } }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function isOwner() { try { if (window.App && App.canSeeCost) return !!App.canSeeCost(); } catch (e) {} return !!(window.App && App.user && App.user.role === 'Owner'); }
  function branchName(id) {
    try { if (window.App && App.branchName) return App.branchName(id); } catch (e) {}
    var b = (S().branches || []).find(function (x) { return String(x.id) === String(id); });
    return b ? b.name : (id == null ? '—' : String(id));
  }
  function saleDate(s) { return s.date || s.createdAt || s.timestamp || s.time; }
  function saleItems(s) { return s.items || s.lines || s.products || []; }
  function itemQty(it) { return Number(it.qty != null ? it.qty : (it.quantity != null ? it.quantity : 1)) || 0; }
  function itemPrice(it) { return Number(it.unitPrice != null ? it.unitPrice : (it.price != null ? it.price : (it.salePrice != null ? it.salePrice : 0))) || 0; }
  function itemCost(it) {
    if (it.purchasePrice != null) return Number(it.purchasePrice) || 0;
    if (it.costPrice != null) return Number(it.costPrice) || 0;
    if (it.cost != null) return Number(it.cost) || 0;
    var p = DB.productById ? DB.productById(it.productId) : (S().products || []).find(function (x) { return String(x.id) === String(it.productId); });
    return p ? (Number(p.purchasePrice != null ? p.purchasePrice : (p.costPrice || 0)) || 0) : 0;
  }
  function saleTotal(s) { if (s.total != null) return Number(s.total) || 0; return saleItems(s).reduce(function (a, it) { return a + itemQty(it) * itemPrice(it); }, 0); }
  function isCancelled(s) { var t = String(s.status || '').toLowerCase(); return t === 'cancelled' || t === 'canceled'; }
  function isReturned(s) { var t = String(s.status || '').toLowerCase(); return t === 'returned' || t === 'cancelled' || t === 'canceled' || t === 'refunded' || !!s.isReturned; }
  // Returns are stored on the sale: sale.returns = [{items:[{productId,qty}], refund, method, date}]
  function returnsOf(s) { return s.returns || []; }
  function returnsRefund(s) { return returnsOf(s).reduce(function (a, r) { return a + (Number(r.refund != null ? r.refund : 0) || 0); }, 0); }
  function returnedQty(s, productId) {
    return returnsOf(s).reduce(function (a, r) {
      return a + (r.items || []).reduce(function (b, it) {
        return b + (productId == null || String(it.productId) === String(productId) ? (Number(it.qty != null ? it.qty : it.quantity || 0)) : 0);
      }, 0);
    }, 0);
  }
  function netSaleTotal(s) { return saleTotal(s) - returnsRefund(s); }
  function inRange(d, from, to) {
    if (!d) return false;
    var t = new Date(d); if (isNaN(t)) return false;
    var day = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    return day >= from.getTime() && day <= to.getTime();
  }
  function csvCell(v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  Screens.reports = function render(containerEl) {
    if (!isOwner()) {
      containerEl.innerHTML = '<div class="card"><h2>Access denied</h2><p>Only the Owner can view reports.</p><button class="btn" id="rp-back">Back to Dashboard</button></div>';
      containerEl.querySelector('#rp-back').addEventListener('click', function () { try { App.go('dashboard'); } catch (e) {} });
      return;
    }
    var st = S();
    var now = new Date();
    var defFrom = iso(new Date(now.getFullYear(), now.getMonth(), 1));
    var defTo = iso(now);
    var fromVal = containerEl._rpFrom || defFrom;
    var toVal = containerEl._rpTo || defTo;
    var branchVal = containerEl._rpBranch || 'all';

    function compute() {
      // Read the live filter values (updated by Run Report / Export), not the
      // values captured when the screen first rendered.
      var fromValNow = containerEl._rpFrom || defFrom;
      var toValNow = containerEl._rpTo || defTo;
      var branchValNow = containerEl._rpBranch || 'all';
      var from = new Date(fromValNow + 'T00:00:00');
      var to = new Date(toValNow + 'T00:00:00');
      // Indexed report query (item 8): branch+date filter uses the
      // salesByBranch index instead of scanning every sale.
      var sales;
      if (DB.salesInRange) {
        sales = DB.salesInRange(fromValNow, toValNow, branchValNow);
      } else {
        var fromD = from, toD = to;
        function branchOk2(rec) { return branchValNow === 'all' || rec.branchId == null || String(rec.branchId) === String(branchValNow); }
        sales = (st.sales || []).filter(function (s) { return inRange(saleDate(s), fromD, toD) && branchOk2(s); });
      }
      var completed = sales.filter(function (s) { return !isCancelled(s); });
      var returned = sales.filter(isReturned);
      var grossSales = completed.reduce(function (a, s) { return a + saleTotal(s); }, 0);
      var returnsTotal = completed.reduce(function (a, s) { return a + returnsRefund(s); }, 0);
      var netSales = grossSales - returnsTotal;
      var discounts = completed.reduce(function (a, s) { return a + (Number(s.discount) || 0); }, 0);
      var cogs = 0, costZero = false;
      var perProduct = {};
      completed.forEach(function (s) {
        saleItems(s).forEach(function (it) {
          var q = itemQty(it) - returnedQty(s, it.productId), rev = q * itemPrice(it), c = itemCost(it);
          if (!c) costZero = true;
          cogs += q * c;
          var name = it.name || it.productName || 'Product';
          var k = it.productId != null ? String(it.productId) : name;
          if (!perProduct[k]) perProduct[k] = { name: name, qty: 0, revenue: 0, cost: 0 };
          perProduct[k].qty += q; perProduct[k].revenue += rev; perProduct[k].cost += q * c;
        });
      });
      var grossProfit = netSales - cogs;
      var expenses = (st.expenses || []).filter(function (e) { return inRange(e.date, from, to) && branchOk(e); });
      var expensesTotal = expenses.reduce(function (a, e) { return a + (Number(e.amount) || 0); }, 0);
      var netProfit = grossProfit - expensesTotal;
      var byMethod = {};
      completed.forEach(function (s) {
        var m = s.paymentMethod || s.method || 'Cash';
        byMethod[m] = (byMethod[m] || 0) + netSaleTotal(s);
      });
      var productRows = Object.keys(perProduct).map(function (k) { return perProduct[k]; }).sort(function (a, b) { return b.revenue - a.revenue; });
      return { from: fromValNow, to: toValNow, branch: branchValNow, grossSales: grossSales, returnsTotal: returnsTotal, netSales: netSales, discounts: discounts, cogs: cogs, grossProfit: grossProfit, expensesTotal: expensesTotal, netProfit: netProfit, byMethod: byMethod, productRows: productRows, costZero: costZero, orders: completed.length, returnsCount: returned.length };
    }

    function draw() {
      // Report generation time is measured (item 8) so slowness is visible.
      var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      var r = compute();
      var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      r.ms = Math.round((t1 - t0) * 10) / 10;
      function card(label, value, sub) {
        return '<div class="card"><div style="font-size:13px;opacity:.75">' + esc(label) + '</div><div style="font-size:22px;font-weight:700;margin-top:4px">' + value + '</div>' + (sub ? '<div style="font-size:12px;opacity:.7;margin-top:4px">' + sub + '</div>' : '') + '</div>';
      }
      var methodRows = Object.keys(r.byMethod).map(function (m) { return '<tr><td>' + esc(m) + '</td><td>' + esc(money(r.byMethod[m])) + '</td></tr>'; }).join('');
      var prodRows = r.productRows.map(function (p) {
        return '<tr><td>' + esc(p.name) + '</td><td>' + p.qty + '</td><td>' + esc(money(p.revenue)) + '</td><td>' + esc(money(p.cost)) + '</td><td>' + esc(money(p.revenue - p.cost)) + '</td></tr>';
      }).join('');

      containerEl.querySelector('#rp-result').innerHTML =
        '<p class="muted">Report ' + r.ms + ' ms me tayyar hui — ' + r.orders + ' order(s), ' + r.from + ' se ' + r.to + ' tak.</p>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:12px 0">' +
        card('Total Sales', esc(money(r.grossSales)), r.orders + ' completed order(s)') +
        card('Returns', esc(money(r.returnsTotal)), r.returnsCount + ' returned sale(s)') +
        card('Net Sales', esc(money(r.netSales)), 'total sales minus returns') +
        card('Discounts', esc(money(r.discounts)), '') +
        card('COGS', esc(money(r.cogs)), 'cost of goods sold' + (r.costZero ? ' — note: some items had cost 0, so COGS / profit are overstated' : '')) +
        card('Gross Profit', esc(money(r.grossProfit)), 'net sales minus COGS') +
        card('Expenses', esc(money(r.expensesTotal)), '') +
        card('Net Profit', esc(money(r.netProfit)), 'gross profit minus expenses') +
        '</div>' +
        '<div class="card"><h3>Payment Method Breakdown</h3>' + (methodRows ? '<table class="tbl"><thead><tr><th>Method</th><th>Amount</th></tr></thead><tbody>' + methodRows + '</tbody></table>' : '<p>No sales in this period.</p>') + '</div>' +
        '<div class="card" style="margin-top:12px"><h3>Product-wise Profit</h3>' + (prodRows ? '<table class="tbl"><thead><tr><th>Product</th><th>Qty Sold</th><th>Revenue</th><th>Cost</th><th>Profit</th></tr></thead><tbody>' + prodRows + '</tbody></table>' : '<p>No sales in this period.</p>') + '</div>';
      containerEl._rpLast = r;
    }

    containerEl.innerHTML = '<h2>Reports</h2>' +
      '<div class="card"><h3>Filters</h3>' +
      '<div class="form-row"><label>From <input type="date" id="rp-from" value="' + esc(fromVal) + '"></label>' +
      '<label>To <input type="date" id="rp-to" value="' + esc(toVal) + '"></label>' +
      '<label>Branch <select id="rp-branch"><option value="all">All Branches</option>' + (st.branches || []).map(function (b) { return '<option value="' + esc(b.id) + '"' + (String(b.id) === String(branchVal) ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') + '</select></label></div>' +
      '<button class="btn btn-primary" id="rp-run">Run Report</button> ' +
      '<button class="btn" id="rp-csv">Export CSV</button> ' +
      '<button class="btn" id="rp-print">Print</button></div>' +
      '<div id="rp-result"></div>';

    draw();

    function readFilters() {
      containerEl._rpFrom = containerEl.querySelector('#rp-from').value || defFrom;
      containerEl._rpTo = containerEl.querySelector('#rp-to').value || defTo;
      containerEl._rpBranch = containerEl.querySelector('#rp-branch').value;
      if (containerEl._rpFrom > containerEl._rpTo) { notify('The "From" date cannot be after the "To" date.', 'error'); return false; }
      return true;
    }
    containerEl.querySelector('#rp-run').addEventListener('click', function () { if (readFilters()) draw(); });
    containerEl.querySelector('#rp-csv').addEventListener('click', function () {
      if (!readFilters()) return;
      draw();
      var r = containerEl._rpLast;
      var lines = [];
      lines.push(['RARA POS Report', r.from + ' to ' + r.to, 'Branch: ' + (r.branch === 'all' ? 'All Branches' : branchName(r.branch))].map(csvCell).join(','));
      lines.push(['Metric', 'Amount'].map(csvCell).join(','));
      [['Total Sales', r.grossSales], ['Returns', r.returnsTotal], ['Net Sales', r.netSales], ['Discounts', r.discounts], ['COGS', r.cogs], ['Gross Profit', r.grossProfit], ['Expenses', r.expensesTotal], ['Net Profit', r.netProfit]].forEach(function (row) { lines.push([row[0], Number(row[1]).toFixed(2)].map(csvCell).join(',')); });
      lines.push([]);
      lines.push(['Payment Method', 'Amount'].map(csvCell).join(','));
      Object.keys(r.byMethod).forEach(function (m) { lines.push([m, Number(r.byMethod[m]).toFixed(2)].map(csvCell).join(',')); });
      lines.push([]);
      lines.push(['Product', 'Qty Sold', 'Revenue', 'Cost', 'Profit'].map(csvCell).join(','));
      r.productRows.forEach(function (p) { lines.push([p.name, p.qty, Number(p.revenue).toFixed(2), Number(p.cost).toFixed(2), Number(p.revenue - p.cost).toFixed(2)].map(csvCell).join(',')); });
      var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'rara-report-' + r.from + '-to-' + r.to + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      notify('Report exported as CSV.', 'success');
    });
    containerEl.querySelector('#rp-print').addEventListener('click', function () { window.print(); });
  };
})();
