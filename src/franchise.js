/* RARA POS — Franchise dashboard (v1.1.4).
 * Own-branch ONLY, for the Franchise role (RARA Township, branch 3):
 * total sales (today + all-time), sales by product (qty + amount),
 * PROFIT (revenue minus the FRANCHISEE's cost, per-product and total),
 * expenses, and stock (received / sold / returned / adjustments / current).
 * Plus a "Products & Cost" table (v1.1.4) that is ALWAYS visible, even
 * with zero sales: sale price, cost per unit and profit per unit for
 * every product.
 *
 * The franchisee's cost per unit is product.franchisePrice — the price
 * the Owner charges the franchise per unit. The Owner's own purchase
 * cost (purchasePrice) is NEVER shown to this role: the sales/profit
 * math and the cost table all use franchisePrice. If a product's
 * franchisePrice is 0, cost reads Rs 0 and profit is overstated until
 * the Owner sets it (Products > Edit > Franchise Price).
 *
 * Profit is visible here at the Owner's EXPLICIT instruction (v1.1.3) —
 * showing it necessarily reveals margins; that is the Owner's call.
 * Nothing else leaks: no other branch's rows, no suppliers, no
 * purchases, no logins, no Settings, no price editing (those screens
 * are hidden for this role in ui.js, and Products is view-only).
 * All numbers come from the real local state — no mock data. */
(function () {
  'use strict';
  let DB;
  try { DB = require('./db.js'); } catch (e) { DB = require('./src/db.js'); }
  const state = DB.state;
  window.Screens = window.Screens || {};

  function S() { return DB.state || state; }
  function money(n) { try { if (window.App && App.money) return App.money(n); } catch (e) {} return 'Rs ' + (Number(n) || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 }); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(x) { try { return new Date(x).toLocaleString('en-GB'); } catch (e) { return String(x || ''); } }
  function fmtDay(x) { try { return new Date(x).toLocaleDateString('en-GB'); } catch (e) { return String(x || ''); } }
  function saleDate(s) { return s.date || s.createdAt || s.timestamp || s.time || s.saleDate; }
  function saleItems(s) { return s.items || s.lines || s.products || []; }
  function itemQty(it) { return Number(it.qty != null ? it.qty : (it.quantity != null ? it.quantity : 1)) || 0; }
  function itemPrice(it) { return Number(it.unitPrice != null ? it.unitPrice : (it.price != null ? it.price : 0)) || 0; }
  function saleTotal(s) {
    if (s.total != null) return Number(s.total) || 0;
    return saleItems(s).reduce(function (a, it) { return a + itemQty(it) * itemPrice(it); }, 0);
  }
  function isCancelled(s) { var t = String(s.status || '').toLowerCase(); return t === 'cancelled' || t === 'canceled'; }
  function sameDay(a, b) { var d1 = new Date(a), d2 = new Date(b); return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate(); }
  function prodById(id) { var st = S(); return (st.products || []).find(function (p) { return String(p.id) === String(id); }); }
  function returnsOf(s) { return s.returns || s.returnItems || []; }
  function returnsRefund(s) { return returnsOf(s).reduce(function (a, r) { return a + (Number(r.refund != null ? r.refund : 0) || 0); }, 0); }
  function returnedQty(s, productId) {
    return returnsOf(s).reduce(function (a, r) {
      return a + (r.items || []).reduce(function (b, it) {
        return b + (productId == null || String(it.productId) === String(productId) ? (Number(it.qty != null ? it.qty : it.quantity || 0)) : 0);
      }, 0);
    }, 0);
  }
  function netSaleTotal(s) { return saleTotal(s) - returnsRefund(s); }
  function branchStockOf(p, branchId) {
    if (DB.stockOf) { try { return Number(DB.stockOf(p, branchId)) || 0; } catch (e) {} }
    if (p.branchStocks && Array.isArray(p.branchStocks)) {
      var row = p.branchStocks.find(function (b) { return String(b.branchId) === String(branchId); });
      return row ? (Number(row.qty) || 0) : 0;
    }
    return 0;
  }
  // Stock-in movement reasons. New code logs 'purchase' (purchase receipt)
  // and 'Transfer In'; older seed data used 'Stock In' and
  // 'Transfer #N ← <branch>'. All four mean stock arrived at this branch.
  function isReceivedReason(reason) {
    var r = String(reason || '');
    if (r === 'purchase' || r === 'Transfer In' || r === 'Stock In') return true;
    return /^Transfer #\d+ ←/.test(r);
  }
  // Stock that came back after a return / cancelled sale.
  function isReturnedReason(reason) {
    var r = String(reason || '');
    return r === 'Return' || r === 'Sale Cancel';
  }
  // Manual stock corrections (signed quantity).
  function isAdjustmentReason(reason) {
    return ['Adjustment', 'Correction', 'Restock', 'Damaged', 'Missing'].indexOf(String(reason || '')) !== -1;
  }

  Screens.franchise = function render(containerEl) {
    var st = S();
    var user = window.App && window.App.user;
    if (!user || user.role !== 'Franchise') {
      containerEl.innerHTML = '<div class="card"><h2>Access denied</h2><p>Ye dashboard sirf franchise login ke liye hai.</p></div>';
      return;
    }
    var branchId = window.App.currentBranchId();
    var branch = (st.branches || []).find(function (b) { return String(b.id) === String(branchId); });
    var branchName = branch ? branch.name : ('Branch ' + branchId);
    var now = new Date();
    var products = st.products || [];

    // ---- Own-branch sales only (cancelled sales excluded everywhere) ----
    var ownSales = (st.sales || []).filter(function (s) {
      return String(s.branchId) === String(branchId) && !isCancelled(s);
    });
    var todaySales = ownSales.filter(function (s) { return saleDate(s) && sameDay(saleDate(s), now); });
    var todayTotal = todaySales.reduce(function (a, s) { return a + netSaleTotal(s); }, 0);
    var allTotal = ownSales.reduce(function (a, s) { return a + netSaleTotal(s); }, 0);

    // ---- Sales by product + profit (revenue - franchise cost) ----
    // The franchisee's cost is franchisePrice (what the Owner charges
    // the franchise per unit) — NEVER the Owner's purchasePrice.
    var byProduct = {};
    var costZero = false;
    ownSales.forEach(function (s) {
      saleItems(s).forEach(function (it) {
        var prod = it.productId != null ? prodById(it.productId) : null;
        var name = it.name || it.productName || (prod && prod.name) || 'Product';
        var key = it.productId != null ? String(it.productId) : name;
        if (!byProduct[key]) byProduct[key] = { name: name, qty: 0, unitCost: 0, revenue: 0, cost: 0, profit: 0 };
        var netQ = itemQty(it) - returnedQty(s, it.productId);
        var unitCost = prod ? (Number(prod.franchisePrice) || 0) : 0;
        if (!unitCost && netQ > 0) costZero = true;
        var rev = netQ * itemPrice(it);
        var cst = netQ * unitCost;
        byProduct[key].unitCost = unitCost;
        byProduct[key].qty += netQ;
        byProduct[key].revenue += rev;
        byProduct[key].cost += cst;
        byProduct[key].profit += rev - cst;
      });
    });
    var byProductList = Object.keys(byProduct).map(function (k) { return byProduct[k]; }).sort(function (a, b) { return b.revenue - a.revenue; });
    var totalProfit = byProductList.reduce(function (a, r) { return a + r.profit; }, 0);
    var totalSoldQty = byProductList.reduce(function (a, r) { return a + r.qty; }, 0);

    // ---- Own-branch expenses ----
    var ownExpenses = (st.expenses || []).filter(function (e) { return String(e.branchId) === String(branchId); });
    var expensesTotal = ownExpenses.reduce(function (a, e) { return a + (Number(e.amount) || 0); }, 0);
    var expensesToday = ownExpenses.filter(function (e) { return e.date && sameDay(e.date, now); })
      .reduce(function (a, e) { return a + (Number(e.amount) || 0); }, 0);

    // ---- Stock: received / sold / returned / adjustments / current ----
    var movements = (st.stockMovements || []).filter(function (m) { return String(m.branchId) === String(branchId); });
    var stockRows = products.map(function (p) {
      var pid = String(p.id);
      var received = 0, returned = 0, adjustments = 0;
      movements.forEach(function (m) {
        if (String(m.productId) !== pid) return;
        var q = Number(m.qty) || 0;
        if (isReceivedReason(m.reason) && q > 0) received += q;
        else if (isReturnedReason(m.reason) && q > 0) returned += q;
        else if (isAdjustmentReason(m.reason)) adjustments += q;
      });
      var soldRow = byProduct[pid];
      return {
        name: p.name, received: received,
        sold: soldRow ? soldRow.qty : 0, returned: returned,
        adjustments: adjustments, current: branchStockOf(p, branchId),
      };
    });

    // ---- Recent own-branch sales ----
    var recent = ownSales.slice().sort(function (a, b) { return new Date(saleDate(b) || 0) - new Date(saleDate(a) || 0); }).slice(0, 8);

    function card(label, value, sub) {
      return '<div class="card"><div style="font-size:13px;opacity:.75">' + esc(label) + '</div>' +
        '<div style="font-size:22px;font-weight:700;margin-top:4px">' + value + '</div>' +
        (sub ? '<div style="font-size:12px;opacity:.7;margin-top:4px">' + sub + '</div>' : '') + '</div>';
    }
    var cards = '';
    cards += card("Aaj ki Sales", esc(money(todayTotal)), todaySales.length + ' order(s) aaj');
    cards += card('Total Sales (sab)', esc(money(allTotal)), ownSales.length + ' order(s) — sirf is branch ki');
    cards += card('Total Profit', esc(money(totalProfit)), costZero ? 'Note: kuch products ki cost 0 hai — profit zyada dikh sakta hai' : 'revenue minus franchise cost');
    cards += card('Aaj ke Expenses', esc(money(expensesToday)), 'Total expenses: ' + esc(money(expensesTotal)));
    cards += card('Total Items Sold', String(totalSoldQty), products.length + ' products');

    // ---- Products & Cost (v1.1.4) — ALWAYS visible, even with zero
    // sales: the franchisee's per-unit cost is franchisePrice, i.e. what
    // the Owner charges the franchise per unit ("ye product mujhe kitne
    // per mila"). Profit per unit = sale price − franchisePrice.
    var costRows = products.map(function (p) {
      var fPrice = Number(p.franchisePrice) || 0;
      var sPrice = Number(p.price) || 0;
      return {
        name: p.name, salePrice: sPrice, unitCost: fPrice,
        profitUnit: sPrice - fPrice, stock: branchStockOf(p, branchId),
      };
    });
    var anyCostZero = products.some(function (p) { return !(Number(p.franchisePrice) > 0); });
    var costHtml = '<table class="tbl"><thead><tr><th>Product</th><th>Sale Price</th><th>Cost per unit</th><th>Profit per unit</th><th>Current Stock</th></tr></thead><tbody>' +
      costRows.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td>' + esc(money(r.salePrice)) + '</td><td>' + esc(money(r.unitCost)) + '</td><td><b>' + esc(money(r.profitUnit)) + '</b></td><td><b>' + r.stock + '</b></td></tr>';
      }).join('') + '</tbody></table>' +
      (anyCostZero ? '<p class="muted" style="margin-top:8px">Note: jin products ki Cost Rs 0 hai, unki Franchise Price Owner ne abhi set nahi ki — Products &gt; Edit &gt; Franchise Price se set karwayein, warna cost 0 aur profit zyada dikhega.</p>' : '');

    var byProductHtml = byProductList.length
      ? '<table class="tbl"><thead><tr><th>Product</th><th>Qty Sold</th><th>Unit Cost</th><th>Revenue</th><th>Cost</th><th>Profit</th></tr></thead><tbody>' +
        byProductList.map(function (r) {
          return '<tr><td>' + esc(r.name) + '</td><td>' + r.qty + '</td><td>' + esc(money(r.unitCost)) + '</td><td>' + esc(money(r.revenue)) + '</td><td>' + esc(money(r.cost)) + '</td><td><b>' + esc(money(r.profit)) + '</b></td></tr>';
        }).join('') +
        '<tr><td><b>Total</b></td><td><b>' + totalSoldQty + '</b></td><td></td><td><b>' + esc(money(allTotal)) + '</b></td><td><b>' + esc(money(byProductList.reduce(function (a, r) { return a + r.cost; }, 0))) + '</b></td><td><b>' + esc(money(totalProfit)) + '</b></td></tr>' +
        '</tbody></table>'
      : '<p>Abhi koi sale nahi hai.</p>';

    var stockHtml = '<table class="tbl"><thead><tr><th>Product</th><th>Received</th><th>Sold</th><th>Returned</th><th>Adjustments</th><th>Current Stock</th></tr></thead><tbody>' +
      stockRows.map(function (r) {
        return '<tr><td>' + esc(r.name) + '</td><td>' + r.received + '</td><td>' + r.sold + '</td><td>' + r.returned + '</td><td>' + (r.adjustments > 0 ? '+' : '') + r.adjustments + '</td><td><b>' + r.current + '</b></td></tr>';
      }).join('') + '</tbody></table>';

    var expensesHtml = ownExpenses.length
      ? '<table class="tbl"><thead><tr><th>Date</th><th>Title</th><th>Category</th><th>Amount</th></tr></thead><tbody>' +
        ownExpenses.slice().sort(function (a, b) { return new Date(b.date || 0) - new Date(a.date || 0); }).slice(0, 10).map(function (e) {
          return '<tr><td>' + esc(fmtDay(e.date)) + '</td><td>' + esc(e.title) + '</td><td>' + esc(e.category || '') + '</td><td>' + esc(money(e.amount)) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p>Abhi koi expense nahi hai.</p>';

    var recentHtml = recent.length
      ? '<table class="tbl"><thead><tr><th>Date</th><th>Bill</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>' +
        recent.map(function (s) {
          var items = saleItems(s).map(function (it) { return (it.name || it.productName || 'Item') + ' × ' + itemQty(it); }).join(', ');
          var billNo = s.billNo || ('R-' + String(s.id == null ? '' : s.id).padStart(4, '0'));
          var stt = String(s.status || 'completed').toLowerCase();
          var badge = stt === 'returned' ? '<span class="badge badge-red">Returned</span>'
            : stt === 'partial-return' ? '<span class="badge badge-amber">Partial Return</span>'
            : stt === 'partial' ? '<span class="badge badge-teal">Partial / Credit</span>'
            : '<span class="badge badge-green">Completed</span>';
          return '<tr><td>' + esc(fmtDate(saleDate(s))) + '</td><td><b>' + esc(billNo) + '</b></td><td>' + esc(items) + '</td><td>' + esc(money(netSaleTotal(s))) + '</td><td>' + badge + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p>Abhi koi sale nahi hai.</p>';

    containerEl.innerHTML =
      '<h2>' + esc(branchName) + ' — Dashboard</h2>' +
      '<p class="muted">Sirf is branch ka data — dosri branches, suppliers aur settings yahan nahi dikhte.</p>' +
      '<div class="btn-row" style="margin-bottom:12px"><button type="button" class="btn btn-primary" id="fr-go-pos">Sale Karein</button>' +
      '<button type="button" class="btn" id="fr-go-sales">Sales History</button></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:12px 0">' + cards + '</div>' +
      '<div class="card"><h3>Products &amp; Cost — har product kitne per mila</h3>' + costHtml + '</div>' +
      '<div class="card" style="margin-top:12px"><h3>Sales by Product + Profit</h3>' + byProductHtml + '</div>' +
      '<div class="card" style="margin-top:12px"><h3>Stock — Received / Sold / Current</h3>' + stockHtml + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">' +
      '<div class="card"><h3>Expenses (is branch)</h3>' + expensesHtml + '</div>' +
      '<div class="card"><h3>Recent Sales (last 8)</h3>' + recentHtml + '</div></div>';
    var goPos = containerEl.querySelector('#fr-go-pos');
    if (goPos) goPos.addEventListener('click', function () { try { window.App.go('pos'); } catch (e) {} });
    var goSales = containerEl.querySelector('#fr-go-sales');
    if (goSales) goSales.addEventListener('click', function () { try { window.App.go('sales'); } catch (e) {} });
  };
})();
