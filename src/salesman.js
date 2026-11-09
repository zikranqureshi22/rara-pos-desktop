/* RARA POS — Salesman dashboard (v1.1.5).
 * RARA Outlet ONLY (branch 2), for the Salesman role (username
 * 'salesman', default PIN 1234 — the Owner must change it): today's
 * sales total, products sold today, total payment received today, and
 * products returned today, plus the recent own-branch sales.
 *
 * NO cost, NO profit, NO margin anywhere on this screen — the Salesman
 * never sees Cost Price, Purchase Price, Profit, Profit Margin or
 * overall business profit (canSeeCost stays Owner-only, and this screen
 * never reads purchasePrice / franchisePrice / cost at all). No other
 * branch's rows, no suppliers, purchases, expenses, customers,
 * employees, cash register, branches, logins, Settings or Reports —
 * those screens are hidden for this role in ui.js, and Products/Stock
 * show this role own-branch stock only with no cost columns.
 * Every sale the Salesman makes records him as cashier/user
 * (pos.js completeSaleInner: cashier + userId), so the Owner sees who
 * made each sale in the Owner's Sales History/Reports.
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
  function saleDate(s) { return s.date || s.createdAt || s.timestamp || s.time || s.saleDate; }
  function saleItems(s) { return s.items || s.lines || s.products || []; }
  function itemQty(it) { return Number(it.qty != null ? it.qty : (it.quantity != null ? it.quantity : 1)) || 0; }
  function itemPrice(it) { return Number(it.unitPrice != null ? it.unitPrice : (it.price != null ? it.price : 0)) || 0; }
  function saleTotal(s) {
    if (s.total != null) return Number(s.total) || 0;
    return saleItems(s).reduce(function (a, it) { return a + itemQty(it) * itemPrice(it); }, 0);
  }
  function salePaid(s) { return Number(s.paidAmount != null ? s.paidAmount : (s.paid || 0)) || 0; }
  function isCancelled(s) { var t = String(s.status || '').toLowerCase(); return t === 'cancelled' || t === 'canceled'; }
  function sameDay(a, b) { var d1 = new Date(a), d2 = new Date(b); return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate(); }
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

  Screens.salesman = function render(containerEl) {
    var st = S();
    var user = window.App && window.App.user;
    if (!user || user.role !== 'Salesman') {
      containerEl.innerHTML = '<div class="card"><h2>Access denied</h2><p>Ye dashboard sirf salesman login ke liye hai.</p></div>';
      return;
    }
    var branchId = window.App.currentBranchId();
    var branch = (st.branches || []).find(function (b) { return String(b.id) === String(branchId); });
    var branchName = branch ? branch.name : ('Branch ' + branchId);
    var now = new Date();

    // ---- Own-branch sales only (cancelled sales excluded) ----
    var ownSales = (st.sales || []).filter(function (s) {
      return String(s.branchId) === String(branchId) && !isCancelled(s);
    });
    var todaySales = ownSales.filter(function (s) { return saleDate(s) && sameDay(saleDate(s), now); });
    var todayTotal = todaySales.reduce(function (a, s) { return a + netSaleTotal(s); }, 0);
    var paidToday = todaySales.reduce(function (a, s) { return a + (salePaid(s) - returnsRefund(s)); }, 0);
    var soldToday = 0;
    var returnedToday = 0;
    todaySales.forEach(function (s) {
      saleItems(s).forEach(function (it) { soldToday += itemQty(it) - returnedQty(s, it.productId); });
      returnedToday += returnedQty(s, null);
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
    cards += card('Products Sold (aaj)', String(soldToday), 'aaj beche gaye products');
    cards += card('Payment Received (aaj)', esc(money(paidToday)), 'aaj mili hui payment');
    cards += card('Products Returned (aaj)', String(returnedToday), 'aaj wapas aaye products');

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
      '<p class="muted">Sirf is branch ka aaj ka hisaab — cost, profit ya dosri branches ka data yahan nahi dikhta.</p>' +
      '<div class="btn-row" style="margin-bottom:12px"><button type="button" class="btn btn-primary" id="sm-go-pos">Sale Karein</button>' +
      '<button type="button" class="btn" id="sm-go-sales">Sales History</button></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:12px 0">' + cards + '</div>' +
      '<div class="card"><h3>Recent Sales (last 8)</h3>' + recentHtml + '</div>';
    var goPos = containerEl.querySelector('#sm-go-pos');
    if (goPos) goPos.addEventListener('click', function () { try { window.App.go('pos'); } catch (e) {} });
    var goSales = containerEl.querySelector('#sm-go-sales');
    if (goSales) goSales.addEventListener('click', function () { try { window.App.go('sales'); } catch (e) {} });
  };
})();
