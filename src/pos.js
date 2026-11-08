/* RARA POS — Sale screen + Sales History (returns / cancel / reprint).
 * Wrapped in an IIFE so the `const DB / const state` contract snippet does
 * not collide with the same names in the other classic <script> files.
 */
(function () {
'use strict';
/* Renderer relative-require quirk: './db.js' resolves against index.html
 * (project root), not this file — fall back to './src/db.js'. See ui.js. */
const DB = (function () { try { return require('./db.js'); } catch (e) { return require('./src/db.js'); } })();
DB.load();
const state = DB.state;
if (window.App) window.App.state = DB.state;

/* Live state accessor: App.state is re-synced on every App.save(). */
function S() { return (window.App && window.App.state) || state; }
function save() { if (window.App) window.App.save(); else { try { DB.save(); } catch (e) { /* ignore */ } } }
function money(n) { return window.App.money(n); }
function notify(m, t) { window.App.notify(m, t); }
function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return String(iso || ''); }
}
// Fast page loading (item 1): heavy filtering never runs on every
// keystroke — the search waits 150 ms after the last keypress.
function debounce(fn, ms) {
  let t = null;
  return function () {
    const args = arguments, ctx = this;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(ctx, args), ms || 150);
  };
}
function productImage(p) { return p.imageData || p.image || ''; }
function thumbHtml(p) {
  const img = productImage(p);
  if (img) return '<img class="thumb" src="' + esc(img) + '" alt="">';
  return '<span class="thumb-ph">' + esc(String(p.name || '?').slice(0, 12)) + '</span>';
}
/* Seed-shaped sale/item accessors (other modules read the same fields):
 * sale: createdAt/date, paidAmount/paid, balanceDue/balance,
 * billNo (derived 'R-<id>' when absent), status.
 * item: productName/name, unitPrice/price, lineDiscount/discount, cost. */
function saleDate(s) { return s.createdAt || s.date || s.timestamp || s.time || ''; }
function saleBillNo(s) { return s.billNo || ('R-' + String(s.id == null ? '' : s.id).padStart(4, '0')); }
function salePaid(s) { return Number(s.paidAmount != null ? s.paidAmount : (s.paid || 0)) || 0; }
function saleBalance(s) { return Number(s.balanceDue != null ? s.balanceDue : (s.balance || 0)) || 0; }
function saleTotal(s) { return Number(s.total != null ? s.total : 0) || 0; }
function itemName(it) { return it.productName || it.name || 'Item'; }
function itemPrice(it) { return Number(it.unitPrice != null ? it.unitPrice : (it.price || 0)) || 0; }
function itemDiscount(it) { return Number(it.lineDiscount != null ? it.lineDiscount : (it.discount || 0)) || 0; }
function itemQty(it) { return Number(it.qty != null ? it.qty : (it.quantity || 0)) || 0; }
function itemCost(it) { return Number(it.cost != null ? it.cost : (it.purchasePrice || 0)) || 0; }
function itemLineTotal(it) {
  if (it.lineTotal != null) return Number(it.lineTotal) || 0;
  return itemQty(it) * itemPrice(it) - itemDiscount(it);
}
function nextBillNo() {
  const next = DB.nextId ? DB.nextId('sales') : ((S().sales || []).length + 1);
  return 'R-' + String(next).padStart(4, '0');
}

/* ---------------- Receipt ---------------- */
function receiptText(sale) {
  const st = S();
  const lines = [];
  lines.push((st.settings.businessName || 'RARA') + ' — Fragrance / Fashions');
  lines.push('Branch: ' + (sale.branchName || window.App.branchName(sale.branchId)));
  lines.push('Bill No: ' + saleBillNo(sale));
  lines.push('Date: ' + fmtDate(saleDate(sale)));
  lines.push('Cashier: ' + (sale.cashier || ''));
  if (sale.customerName) lines.push('Customer: ' + sale.customerName + (sale.customerPhone ? ' (' + sale.customerPhone + ')' : ''));
  lines.push('--------------------------------');
  (sale.items || []).forEach((it) => {
    lines.push(itemQty(it) + ' x ' + itemName(it) + ' @ ' + money(itemPrice(it)) + ' = ' + money(itemLineTotal(it)));
    if (itemDiscount(it)) lines.push('  Discount: -' + money(itemDiscount(it)));
  });
  lines.push('--------------------------------');
  lines.push('Subtotal: ' + money(sale.subtotal));
  if (sale.discount) lines.push('Bill Discount: -' + money(sale.discount));
  lines.push('Total: ' + money(saleTotal(sale)));
  lines.push('Payment: ' + (sale.paymentMethod || 'Cash'));
  lines.push('Paid: ' + money(salePaid(sale)));
  lines.push('Balance: ' + money(saleBalance(sale)));
  if (saleBalance(sale) > 0) lines.push('Balance due — please pay soon. Shukriya!');
  lines.push('Thank you for shopping at RARA!');
  return lines.join('\n');
}
function receiptHtml(sale) {
  const st = S();
  const rows = (sale.items || []).map((it) =>
    '<tr><td>' + esc(itemName(it)) + '<br><small>' + itemQty(it) + ' x ' + money(itemPrice(it)) + (itemDiscount(it) ? ' (Disc -' + money(itemDiscount(it)) + ')' : '') + '</small></td>' +
    '<td class="r-right">' + money(itemLineTotal(it)) + '</td></tr>'
  ).join('');
  return '' +
    '<div class="r-center r-bold">' + esc(st.settings.businessName || 'RARA') + '</div>' +
    '<div class="r-center">Fragrance / Fashions</div>' +
    '<div class="r-center">' + esc(sale.branchName || window.App.branchName(sale.branchId)) + '</div>' +
    '<div class="r-line"></div>' +
    '<div>Bill No: <b>' + esc(saleBillNo(sale)) + '</b></div>' +
    '<div>Date: ' + esc(fmtDate(saleDate(sale))) + '</div>' +
    '<div>Cashier: ' + esc(sale.cashier || '') + '</div>' +
    (sale.customerName ? '<div>Customer: ' + esc(sale.customerName) + (sale.customerPhone ? ' (' + esc(sale.customerPhone) + ')' : '') + '</div>' : '') +
    '<div class="r-line"></div>' +
    '<table>' + rows + '</table>' +
    '<div class="r-line"></div>' +
    '<table>' +
    '<tr><td>Subtotal</td><td class="r-right">' + money(sale.subtotal) + '</td></tr>' +
    (sale.discount ? '<tr><td>Bill Discount</td><td class="r-right">-' + money(sale.discount) + '</td></tr>' : '') +
    '<tr><td class="r-bold">Total</td><td class="r-right r-bold">' + money(saleTotal(sale)) + '</td></tr>' +
    '<tr><td>Payment (' + esc(sale.paymentMethod || 'Cash') + ')</td><td class="r-right">' + money(salePaid(sale)) + '</td></tr>' +
    '<tr><td class="r-bold">Balance</td><td class="r-right r-bold">' + money(saleBalance(sale)) + '</td></tr>' +
    '</table>' +
    '<div class="r-line"></div>' +
    '<div class="r-center">Thank you for shopping at RARA!</div>';
}
/* ---------------- Thermal receipt printing (v1.1.2) ----------------
 * CSS alone cannot make the printed page match the bill length
 * (measured: @page size:80mm auto is invalid in Blink; a square 80mm
 * page splits a 3-item bill across 2 pages mid-bill). So the receipt
 * height is measured here at 80mm width and the main process prints
 * one page of exactly that height on the Owner-picked thermal printer.
 * Anything that fails falls back to the print dialog, so printing
 * never fully breaks. */
function getPrintIpc() { try { return require('electron').ipcRenderer; } catch (e) { return null; } }
function measureReceiptHeightPx() {
  const area = document.getElementById('receipt-print');
  if (!area) return 0;
  // The real area is display:none, so its own height is 0. Temporarily
  // show it off-screen (visibility:hidden keeps layout measurable
  // without flashing on screen), measure, then restore exactly.
  const prev = { display: area.style.display, visibility: area.style.visibility, position: area.style.position, left: area.style.left, top: area.style.top, width: area.style.width };
  area.style.display = 'block'; area.style.visibility = 'hidden'; area.style.position = 'absolute'; area.style.left = '-9999px'; area.style.top = '0'; area.style.width = '80mm';
  const h = area.getBoundingClientRect().height;
  area.style.display = prev.display; area.style.visibility = prev.visibility; area.style.position = prev.position; area.style.left = prev.left; area.style.top = prev.top; area.style.width = prev.width;
  return h;
}
function fallbackPrintDialog() { try { window.print(); } catch (e) { /* ignore */ } }
async function printReceiptHtml(html) {
  const area = document.getElementById('receipt-print');
  if (!area) { notify('Print area nahi mila', 'error'); return false; }
  area.innerHTML = html;
  const printerName = (S().settings && S().settings.printerName) || '';
  if (!printerName) {
    notify('Printer select nahi hai — Settings → Printer me printer chunein, phir dobara print karein', 'warning');
    fallbackPrintDialog();
    return false;
  }
  // 1 CSS px = 25.4/96 mm; +6mm trailing feed so the cutter has paper.
  const heightMicrons = Math.round((measureReceiptHeightPx() * 25.4 / 96 + 6) * 1000);
  const ipc = getPrintIpc();
  if (!ipc) { fallbackPrintDialog(); return false; }
  let res = null;
  try {
    // A stuck printer must never hang the POS: 12s timeout, then fail.
    res = await Promise.race([
      ipc.invoke('print-receipt', { heightMicrons, deviceName: printerName }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'timeout' }), 12000))
    ]);
  } catch (e) { res = { ok: false, error: 'print-failed' }; }
  if (res && res.ok) { notify('Bill print ho gaya', 'success'); return true; }
  if (res && res.error === 'timeout') {
    // The silent job may still come out of the printer — do NOT open
    // the dialog as well, or the bill would print twice.
    notify('Print ka jawab nahi mila — printer check karein, bill nikal aaye to dobara print na karein', 'error');
    return false;
  }
  notify('Print nahi ho saka — print dialog se dobara koshish karein', 'error');
  fallbackPrintDialog();
  return false;
}
function printReceipt(sale) {
  return printReceiptHtml(receiptHtml(sale));
}
function testPrintReceipt() {
  const now = new Date();
  const html = '<div class="r-center r-bold">' + esc((S().settings && S().settings.businessName) || 'RARA') + '</div>' +
    '<div class="r-center">Fragrance / Fashions</div>' +
    '<div class="r-line"></div>' +
    '<div class="r-center">TEST PRINT</div>' +
    '<div>Date: ' + esc(now.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })) + '</div>' +
    '<div class="r-line"></div>' +
    '<div class="r-center">Printer theek kaam kar raha hai!</div>' +
    '<div class="r-center">Thank you for shopping at RARA!</div>';
  return printReceiptHtml(html);
}
window.App.printReceipt = printReceipt;
window.App.receiptText = receiptText;
window.App.measureReceiptHeightPx = measureReceiptHeightPx;
window.App.testPrintReceipt = testPrintReceipt;

/* ---------------- Bill preview (v1.1.2) ----------------
 * The bill is SHOWN first, then printed. The preview renders the SAME
 * receiptHtml(sale) that printing uses, so preview and printed bill
 * always match. Print uses the measured-height print path; Close
 * dismisses without printing. */
let previewSale = null;
function showBillPreview(sale) {
  const overlay = document.getElementById('bill-preview-overlay');
  const body = document.getElementById('bill-preview-body');
  if (!overlay || !body || !sale) return false;
  previewSale = sale;
  body.innerHTML = receiptHtml(sale);
  overlay.hidden = false;
  return true;
}
function hideBillPreview() {
  const overlay = document.getElementById('bill-preview-overlay');
  if (overlay) overlay.hidden = true;
  const body = document.getElementById('bill-preview-body');
  if (body) body.innerHTML = '';
  previewSale = null;
}
function wireBillPreview() {
  const overlay = document.getElementById('bill-preview-overlay');
  const printBtn = document.getElementById('bill-preview-print');
  const closeBtn = document.getElementById('bill-preview-close');
  const xBtn = document.getElementById('bill-preview-x');
  if (printBtn) printBtn.onclick = async () => {
    if (!previewSale) return;
    const ok = await printReceipt(previewSale);
    if (ok) hideBillPreview();
    // If printing failed, the modal stays open so the user can retry
    // from the print dialog or close it without printing.
  };
  if (closeBtn) closeBtn.onclick = hideBillPreview;
  if (xBtn) xBtn.onclick = hideBillPreview;
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) hideBillPreview(); });
}
wireBillPreview();
window.App.showBillPreview = showBillPreview;
window.App.hideBillPreview = hideBillPreview;

/* ---------------- Sale processing ---------------- */
function processReturn(sale, returnItems, refundMethod) {
  // returnItems: [{productId, qty}] — restocks + records refund.
  const st = S();
  const branchId = sale.branchId;
  let refund = 0;
  const applied = [];
  returnItems.forEach((ri) => {
    const qty = Number(ri.qty) || 0;
    if (qty <= 0) return;
    const line = (sale.items || []).find((i) => String(i.productId) === String(ri.productId));
    if (!line) return;
    const already = (sale.returns || []).reduce((a, r) => a + (r.items || []).filter((x) => String(x.productId) === String(ri.productId)).reduce((b, x) => b + (Number(x.qty) || 0), 0), 0);
    const maxQty = itemQty(line) - already;
    const q = Math.min(qty, maxQty);
    if (q <= 0) return;
    const product = DB.productById ? DB.productById(ri.productId) : (st.products || []).find((p) => String(p.id) === String(ri.productId));
    if (product) window.App.adjustStock(product, branchId, q, 'Return', saleBillNo(sale));
    const lineTotal = itemPrice(line) * q - itemDiscount(line) * (q / (itemQty(line) || 1));
    refund += lineTotal;
    applied.push({ productId: ri.productId, productName: itemName(line), name: itemName(line), qty: q, amount: Math.round(lineTotal) });
  });
  if (applied.length === 0) return null;
  sale.returns = sale.returns || [];
  sale.returns.push({ id: 'ret_' + Date.now().toString(36), date: new Date().toISOString(), items: applied, refund: Math.round(refund), method: refundMethod || sale.paymentMethod, user: window.App.user ? window.App.user.name : '' });
  const totalReturned = (sale.returns || []).reduce((a, r) => a + (r.items || []).reduce((b, x) => b + (Number(x.qty) || 0), 0), 0);
  const totalSold = (sale.items || []).reduce((a, i) => a + itemQty(i), 0);
  sale.status = totalReturned >= totalSold ? 'returned' : 'partial-return';
  save();
  return { refund: Math.round(refund), items: applied };
}
window.App.processReturn = processReturn;

/* ---------------- POS screen ---------------- */
let cart = [];            // [{productId, qty, discount}]
let billDiscount = 0;
let paymentMethod = 'Cash';
let paidAmount = '';
let selectedCustomerId = '';
let newCustomerName = '';
let newCustomerPhone = '';

function cartProduct(line) { return DB.productById ? DB.productById(line.productId) : (S().products || []).find((p) => String(p.id) === String(line.productId)); }
function lineTotal(line) {
  const p = cartProduct(line);
  const price = p ? Number(p.price) || 0 : 0;
  return price * line.qty - (Number(line.discount) || 0);
}
function cartSubtotal() { return cart.reduce((a, l) => a + lineTotal(l), 0); }
function cartTotal() { return Math.max(0, cartSubtotal() - (Number(billDiscount) || 0)); }

function addToCart(product, qty) {
  const branchId = window.App.currentBranchId();
  const avail = window.App.stockOf(product, branchId);
  const inCart = cart.filter((l) => String(l.productId) === String(product.id)).reduce((a, l) => a + l.qty, 0);
  const allowNeg = !!(S().settings && S().settings.allowNegativeStock);
  if (!allowNeg && avail - inCart < (qty || 1)) {
    notify('Stock khatam — ' + product.name + ' (' + avail + ' mojood)', 'error');
    return false;
  }
  const line = cart.find((l) => String(l.productId) === String(product.id));
  if (line) line.qty += (qty || 1);
  else cart.push({ productId: product.id, qty: qty || 1, discount: 0 });
  return true;
}

function renderPos(container) {
  container.innerHTML = '';
  const branchId = window.App.currentBranchId();
  const st = S();
  const head = el('<div class="screen-head"><h1>Sale — ' + esc(window.App.branchName(branchId)) + '</h1>' +
    '<div class="btn-row"><button type="button" class="btn" id="pos-clear">Cart Clear Karein</button></div></div>');
  container.appendChild(head);
  head.querySelector('#pos-clear').addEventListener('click', () => {
    cart = []; billDiscount = 0; paidAmount = ''; renderPos(container);
  });

  const layout = el('<div class="pos-layout"></div>');
  const left = el('<div class="card"></div>');
  const searchRow = el('<div class="pos-search-row"></div>');
  const searchInput = el('<input class="input" type="text" placeholder="Search — naam / SKU / barcode">');
  const barcodeInput = el('<input class="input" type="text" placeholder="Barcode scan karein aur Enter dabayein" style="max-width:260px">');
  searchRow.appendChild(searchInput);
  searchRow.appendChild(barcodeInput);
  left.appendChild(searchRow);
  const grid = el('<div class="product-grid"></div>');
  left.appendChild(grid);
  layout.appendChild(left);

  function drawGrid(filter) {
    grid.innerHTML = '';
    const q = String(filter || '').trim().toLowerCase();
    const products = (st.products || []).filter((p) => {
      if (!q) return true;
      return [p.name, p.sku, p.barcode].some((v) => String(v || '').toLowerCase().includes(q));
    });
    if (products.length === 0) {
      grid.appendChild(el('<p class="muted">Koi product nahi mila.</p>'));
      return;
    }
    products.forEach((p) => {
      const stock = window.App.stockOf(p, branchId);
      const img = productImage(p);
      const card = el('<div class="product-card' + (stock <= 0 ? ' out' : '') + '" role="button" tabindex="0">' +
        (img ? '<img src="' + esc(img) + '" alt="">' : '<div class="product-ph">' + esc(p.name || '') + '</div>') +
        '<div class="p-name">' + esc(p.name || '') + '</div>' +
        '<div class="p-price">' + money(p.price) + '</div>' +
        '<div class="p-stock">' + (stock <= 0 ? 'Stock khatam' : 'Stock: ' + stock) + '</div></div>');
      const add = () => { if (addToCart(p, 1)) refreshPos(); };
      card.addEventListener('click', add);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
      grid.appendChild(card);
    });
  }
  drawGrid('');
  searchInput.addEventListener('input', debounce(() => drawGrid(searchInput.value), 150));
  barcodeInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const code = barcodeInput.value.trim();
    barcodeInput.value = '';
    if (!code) return;
    // O(1) barcode/SKU lookup from the DB index (item 2).
    const p = DB.productByBarcodeOrSku ? DB.productByBarcodeOrSku(code)
      : (st.products || []).find((x) => String(x.barcode || '') === code || String(x.sku || '') === code);
    if (!p) { notify('Barcode nahi mila: ' + code, 'error'); return; }
    if (addToCart(p, 1)) { notify(p.name + ' add ho gaya', 'success'); refreshPos(); }
    else refreshPos();
  });

  /* ---- Cart panel ---- */
  const right = el('<div class="card"></div>');
  right.appendChild(el('<h2>Cart</h2>'));
  const cartBox = el('<div></div>');
  right.appendChild(cartBox);
  function drawCart() {
    cartBox.innerHTML = '';
    if (cart.length === 0) {
      cartBox.appendChild(el('<p class="cart-empty">Cart khaali hai — product chunein.</p>'));
    }
    cart.forEach((line, idx) => {
      const p = cartProduct(line);
      if (!p) return;
      const row = el('<div class="cart-line"></div>');
      row.appendChild(el('<div><div class="cl-name">' + esc(p.name) + '</div>' +
        '<div class="muted">' + money(p.price) + ' each</div>' +
        '<div class="qty-ctl"><button type="button" class="btn btn-sm" data-act="minus">−</button>' +
        '<input class="input" type="number" min="1" value="' + line.qty + '" data-act="qty">' +
        '<button type="button" class="btn btn-sm" data-act="plus">+</button>' +
        '<button type="button" class="btn btn-sm btn-danger" data-act="remove">Remove</button></div>' +
        '<label style="margin-top:6px">Item Discount (Rs)</label>' +
        '<input class="input" type="number" min="0" value="' + (Number(line.discount) || 0) + '" data-act="discount" style="max-width:140px"></div>' +
        '<div class="cl-price">' + money(lineTotal(line)) + '</div>'));
      row.querySelector('[data-act="minus"]').addEventListener('click', () => { line.qty = Math.max(1, line.qty - 1); refreshPos(); });
      row.querySelector('[data-act="plus"]').addEventListener('click', () => { if (addToCart(p, 1)) refreshPos(); });
      row.querySelector('[data-act="remove"]').addEventListener('click', () => { cart.splice(idx, 1); refreshPos(); });
      row.querySelector('[data-act="qty"]').addEventListener('change', (e) => {
        const v = Math.max(1, parseInt(e.target.value, 10) || 1);
        const allowNeg = !!(S().settings && S().settings.allowNegativeStock);
        if (!allowNeg && v > window.App.stockOf(p, branchId)) { notify('Stock khatam — sirf ' + window.App.stockOf(p, branchId) + ' mojood', 'error'); refreshPos(); return; }
        line.qty = v; refreshPos();
      });
      row.querySelector('[data-act="discount"]').addEventListener('change', (e) => {
        line.discount = Math.max(0, Number(e.target.value) || 0);
        refreshPos();
      });
      cartBox.appendChild(row);
    });
    const subtotal = cartSubtotal();
    const total = cartTotal();
    const paid = Number(paidAmount) || 0;
    const balance = Math.max(0, total - paid);
    const change = Math.max(0, paid - total);
    const totals = el('<div style="margin-top:12px">' +
      '<div class="totals-row"><span>Subtotal</span><span>' + money(subtotal) + '</span></div>' +
      '<div class="totals-row"><span>Bill Discount (Rs)</span><span><input class="input" id="bill-discount" type="number" min="0" value="' + (Number(billDiscount) || 0) + '" style="width:130px;text-align:right"></span></div>' +
      '<div class="totals-row grand"><span>Total</span><span>' + money(total) + '</span></div>' +
      '<div class="totals-row"><span>Paid</span><span>' + money(paid) + '</span></div>' +
      '<div class="totals-row"><span>Balance Due</span><span>' + money(balance) + '</span></div>' +
      (change > 0 ? '<div class="totals-row"><span>Change (wapas)</span><span>' + money(change) + '</span></div>' : '') +
      '</div>');
    cartBox.appendChild(totals);
    const bd = totals.querySelector('#bill-discount');
    bd.addEventListener('change', () => { billDiscount = Math.max(0, Math.min(subtotal, Number(bd.value) || 0)); refreshPos(); });
  }
  drawCart();

  // Targeted refresh (item 1): cart/qty changes redraw only the product
  // grid and the cart panel — never the whole screen. Full renderPos is
  // only for state resets (clear cart / sale complete).
  container._refreshPos = function () {
    try { drawGrid(searchInput.value); } catch (e) { /* grid stays as-is */ }
    try { drawCart(); } catch (e) { /* cart stays as-is */ }
  };
  function refreshPos() {
    if (container._refreshPos) container._refreshPos();
    else renderPos(container);
  }

  /* ---- Customer + payment ---- */
  const custLabel = el('<label>Customer (optional — balance ho to zaroori)</label>');
  right.appendChild(custLabel);
  const custSel = el('<select class="input"><option value="">Walk-in Customer</option>' +
    (st.customers || []).map((c) => '<option value="' + esc(c.id) + '"' + (String(c.id) === String(selectedCustomerId) ? ' selected' : '') + '>' + esc(c.name) + (c.phone ? ' — ' + esc(c.phone) : '') + '</option>').join('') + '</select>');
  custSel.addEventListener('change', () => { selectedCustomerId = custSel.value; });
  right.appendChild(custSel);
  const newCust = el('<div class="form-row"><div><label>Naya Customer — Naam</label><input class="input" id="nc-name" type="text" placeholder="Naam" value="' + esc(newCustomerName) + '"></div>' +
    '<div><label>Phone</label><input class="input" id="nc-phone" type="tel" placeholder="03xx-xxxxxxx" value="' + esc(newCustomerPhone) + '"></div></div>');
  right.appendChild(newCust);
  newCust.querySelector('#nc-name').addEventListener('input', (e) => { newCustomerName = e.target.value; });
  newCust.querySelector('#nc-phone').addEventListener('input', (e) => { newCustomerPhone = e.target.value; });

  right.appendChild(el('<label>Payment Method</label>'));
  const paySel = el('<select class="input">' + ['Cash', 'JazzCash', 'Easypaisa', 'Card', 'Bank'].map((m) =>
    '<option' + (m === paymentMethod ? ' selected' : '') + '>' + m + '</option>').join('') + '</select>');
  paySel.addEventListener('change', () => { paymentMethod = paySel.value; });
  right.appendChild(paySel);
  right.appendChild(el('<label>Paid Amount (Rs)</label>'));
  const paidInput = el('<input class="input" type="number" min="0" placeholder="Paid amount" value="' + esc(paidAmount) + '">');
  paidInput.addEventListener('input', () => { paidAmount = paidInput.value; drawCart(); });
  right.appendChild(paidInput);

  const completeBtn = el('<button type="button" class="btn btn-primary btn-block" style="margin-top:16px;font-size:17px;padding:13px">Sale Complete Karein</button>');
  completeBtn.addEventListener('click', () => completeSale(container));
  right.appendChild(completeBtn);
  layout.appendChild(right);
  container.appendChild(layout);
}

function completeSale(container) {
  // Every failure here is a user-facing notice, never a crash (item 4).
  try { return completeSaleInner(container); }
  catch (e) {
    if (window.App && window.App.handleError) window.App.handleError(e, 'sale');
    else notify('Masla: Sale complete nahi ho saki — dobara koshish karein', 'error');
  }
}

function completeSaleInner(container) {
  const st = S();
  if (cart.length === 0) { notify('Cart khaali hai', 'warning'); return; }
  const branchId = window.App.currentBranchId();
  const allowNeg = !!(st.settings && st.settings.allowNegativeStock);
  for (const line of cart) {
    const p = cartProduct(line);
    if (!p) continue;
    if (!allowNeg && window.App.stockOf(p, branchId) < line.qty) {
      notify('Stock khatam — ' + p.name + ' (mojood: ' + window.App.stockOf(p, branchId) + ')', 'error');
      return;
    }
  }
  const subtotal = cartSubtotal();
  const total = cartTotal();
  let paid = Number(paidAmount) || 0;
  if (paid <= 0) paid = total; // full payment by default
  const balance = Math.max(0, total - paid);
  let customer = (st.customers || []).find((c) => String(c.id) === String(selectedCustomerId));
  if (balance > 0) {
    const name = customer ? customer.name : newCustomerName.trim();
    const phone = customer ? (customer.phone || '') : newCustomerPhone.trim();
    if (!name || !phone) { notify('Balance baaqi hai — customer ka naam aur phone zaroori hai (credit sale)', 'error'); return; }
    if (!customer) {
      // Data-layer duplicate guard (item 3): same phone = same customer.
      const dup = DB.customerByPhone ? DB.customerByPhone(phone) : null;
      if (dup) { customer = dup; }
      else {
        customer = { id: (DB.nextId ? DB.nextId('customers') : Date.now()), name, phone, address: '', balance: 0 };
        st.customers.push(customer);
      }
    }
  } else if (!customer && newCustomerName.trim()) {
    const dup = DB.customerByPhone ? DB.customerByPhone(newCustomerPhone.trim()) : null;
    if (dup) { customer = dup; }
    else {
      customer = { id: (DB.nextId ? DB.nextId('customers') : Date.now()), name: newCustomerName.trim(), phone: newCustomerPhone.trim(), address: '', balance: 0 };
      st.customers.push(customer);
    }
  }
  if (customer && balance > 0) customer.balance = (Number(customer.balance) || 0) + balance;
  const saleId = DB.nextId ? DB.nextId('sales') : ((st.sales || []).length + 1);
  const items = cart.map((line) => {
    const p = cartProduct(line);
    const unitPrice = Number(p.price) || 0;
    const lineDiscount = Number(line.discount) || 0;
    return {
      productId: p.id, productName: p.name, name: p.name,
      qty: line.qty, unitPrice, price: unitPrice,
      lineDiscount, discount: lineDiscount,
      lineTotal: unitPrice * line.qty - lineDiscount,
      // Cost snapshot at sale time — Owner only; cashiers record 0 so
      // cost never leaks into a sale record (item 7).
      cost: DB.costOf ? DB.costOf(p, window.App.user) : (Number(p.purchasePrice) || 0),
    };
  });
  const nowIso = new Date().toISOString();
  const sale = {
    id: saleId, billNo: 'R-' + String(saleId).padStart(4, '0'),
    // Idempotency key (item 3): a double-click / retry with the same
    // clientRef can never create a second sale or deduct stock twice.
    clientRef: 'sale-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    date: nowIso, createdAt: nowIso, branchId,
    branchName: window.App.branchName(branchId),
    cashier: window.App.user ? window.App.user.name : '',
    userId: window.App.user ? window.App.user.id : '',
    items, subtotal, discount: Number(billDiscount) || 0, total,
    paymentMethod, paid: paid, paidAmount: paid, balance: balance, balanceDue: balance,
    customerId: customer ? customer.id : null, customerName: customer ? customer.name : '',
    customerPhone: customer ? (customer.phone || '') : '',
    status: balance > 0 ? 'partial' : 'completed', returns: [],
  };
  // Idempotent insert: if this clientRef already exists, the sale was
  // already recorded — do NOT deduct stock again.
  const inserted = DB.createSale ? DB.createSale(sale) : { sale, created: true };
  if (!inserted.created) {
    notify('Ye sale pehle se record ho chuki hai — dobara add nahi hui (' + saleBillNo(inserted.sale) + ')', 'warning');
    cart = []; billDiscount = 0; paidAmount = ''; selectedCustomerId = ''; newCustomerName = ''; newCustomerPhone = '';
    renderPos(container);
    showSaleDone(container, inserted.sale);
    return;
  }
  // Deduct branch stock + log movements (first creation only).
  items.forEach((it) => {
    const p = DB.productById ? DB.productById(it.productId) : (st.products || []).find((x) => String(x.id) === String(it.productId));
    if (p) window.App.adjustStock(p, branchId, -it.qty, 'Sale', sale.billNo);
  });
  save();
  notify('Sale kamyab — Bill ' + sale.billNo + ' (' + money(total) + ')', 'success');
  cart = []; billDiscount = 0; paidAmount = ''; selectedCustomerId = ''; newCustomerName = ''; newCustomerPhone = '';
  renderPos(container);
  showSaleDone(container, sale);
}

function showSaleDone(container, sale) {
  const box = el('<div class="card" style="border:2px solid var(--accent)"><h2>Sale Complete — ' + esc(saleBillNo(sale)) + '</h2>' +
    '<p>Total: <b>' + money(saleTotal(sale)) + '</b> &nbsp;|&nbsp; Paid: ' + money(salePaid(sale)) + ' &nbsp;|&nbsp; Balance: <b>' + money(saleBalance(sale)) + '</b></p>' +
    '<div class="btn-row">' +
    '<button type="button" class="btn btn-primary" id="sd-print">Print Bill</button>' +
    '<a class="btn btn-whatsapp" id="sd-wa" target="_blank" rel="noopener">WhatsApp Receipt</a>' +
    '<button type="button" class="btn btn-ghost" id="sd-close">Band Karein</button>' +
    '</div></div>');
  container.prepend(box);
  box.querySelector('#sd-print').addEventListener('click', () => printReceipt(sale));
  const wa = box.querySelector('#sd-wa');
  const phone = String(sale.customerPhone || '').replace(/\D/g, '');
  const text = encodeURIComponent(receiptText(sale));
  wa.href = phone ? 'https://wa.me/' + (phone.startsWith('92') ? phone : '92' + phone.replace(/^0/, '')) + '?text=' + text
                  : 'https://wa.me/?text=' + text;
  box.querySelector('#sd-close').addEventListener('click', () => box.remove());
  // Bill preview (v1.1.2): show the bill first, then print from the preview.
  showBillPreview(sale);
}

/* ---------------- Sales History screen ---------------- */
function renderSales(container) {
  container.innerHTML = '';
  const st = S();
  const isOwner = window.App.user && window.App.user.role === 'Owner';
  const head = el('<div class="screen-head"><h1>Sales History</h1></div>');
  container.appendChild(head);
  const filters = el('<div class="card"><div class="toolbar">' +
    '<div class="field"><label>Branch</label><select class="input" id="f-branch">' +
    (isOwner ? '<option value="">Sab Branches</option>' : '') +
    (st.branches || []).filter((b) => isOwner || String(b.id) === String(window.App.currentBranchId()))
      .map((b) => '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>').join('') +
    '</select></div>' +
    '<div class="field"><label>From Date</label><input class="input" type="date" id="f-from"></div>' +
    '<div class="field"><label>To Date</label><input class="input" type="date" id="f-to"></div>' +
    '<div class="field"><label>&nbsp;</label><button type="button" class="btn btn-primary" id="f-apply">Filter Karein</button></div>' +
    '</div></div>');
  container.appendChild(filters);
  const listWrap = el('<div></div>');
  container.appendChild(listWrap);

  function drawList() {
    listWrap.innerHTML = '';
    const fb = filters.querySelector('#f-branch').value;
    const from = filters.querySelector('#f-from').value;
    const to = filters.querySelector('#f-to').value;
    // Indexed report query (item 8): branch+date filter uses the
    // salesByBranch index instead of scanning every sale.
    let sales;
    if (DB.salesInRange && (from || to || fb)) {
      sales = DB.salesInRange(from || null, to || null, isOwner ? (fb || 'all') : window.App.currentBranchId());
    } else {
      sales = (st.sales || []).slice();
      // Legacy seed sales have branchId null (unassigned) — visible to all roles.
      if (!isOwner) sales = sales.filter((s) => s.branchId === null || s.branchId === undefined || String(s.branchId) === String(window.App.currentBranchId()));
      else if (fb) sales = sales.filter((s) => String(s.branchId) === String(fb));
      if (from) sales = sales.filter((s) => String(saleDate(s)).slice(0, 10) >= from);
      if (to) sales = sales.filter((s) => String(saleDate(s)).slice(0, 10) <= to);
    }
    sales.sort((a, b) => String(saleDate(b)).localeCompare(String(saleDate(a))));
    if (sales.length === 0) {
      listWrap.appendChild(el('<div class="card"><p class="muted">Koi sale nahi mili.</p></div>'));
      return;
    }
    const total = sales.filter((s) => s.status !== 'cancelled').reduce((a, s) => a + saleTotal(s), 0);
    listWrap.appendChild(el('<div class="stat-grid"><div class="stat"><div class="stat-label">Total Sales</div><div class="stat-value">' + sales.length + '</div></div>' +
      '<div class="stat"><div class="stat-label">Total Amount</div><div class="stat-value">' + money(total) + '</div></div></div>'));
    const card = el('<div class="card"><div class="table-wrap"><table><thead><tr><th>Bill</th><th>Date</th><th>Branch</th><th>Cashier</th><th>Items</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody></tbody></table></div></div>');
    const tbody = card.querySelector('tbody');
    sales.forEach((sale) => {
      const tr = document.createElement('tr');
      const itemsCount = (sale.items || []).reduce((a, i) => a + itemQty(i), 0);
      const statusBadge = sale.status === 'cancelled' ? '<span class="badge badge-red">Cancelled</span>'
        : sale.status === 'returned' ? '<span class="badge badge-amber">Returned</span>'
        : sale.status === 'partial-return' ? '<span class="badge badge-amber">Partial Return</span>'
        : sale.status === 'partial' ? '<span class="badge badge-teal">Partial / Credit</span>'
        : '<span class="badge badge-green">Completed</span>';
      tr.innerHTML = '<td><b>' + esc(saleBillNo(sale)) + '</b></td><td>' + esc(fmtDate(saleDate(sale))) + '</td>' +
        '<td>' + esc(sale.branchName || window.App.branchName(sale.branchId)) + '</td><td>' + esc(sale.cashier || '') + '</td>' +
        '<td>' + itemsCount + '</td><td>' + money(saleTotal(sale)) + '</td><td>' + money(salePaid(sale)) + '</td>' +
        '<td>' + money(saleBalance(sale)) + '</td><td>' + statusBadge + '</td><td></td>';
      const td = tr.lastElementChild;
      const btnRow = el('<div class="btn-row"></div>');
      const details = el('<button type="button" class="btn btn-sm">Details</button>');
      details.addEventListener('click', () => showBillPreview(sale));
      btnRow.appendChild(details);
      const reprint = el('<button type="button" class="btn btn-sm">Reprint</button>');
      reprint.addEventListener('click', () => printReceipt(sale));
      btnRow.appendChild(reprint);
      if (sale.status !== 'cancelled' && window.App.can('return')) {
        const ret = el('<button type="button" class="btn btn-sm">Return</button>');
        ret.addEventListener('click', () => openReturnForm(container, sale));
        btnRow.appendChild(ret);
      }
      if (sale.status !== 'cancelled' && window.App.can('sale-cancel')) {
        const cancel = el('<button type="button" class="btn btn-sm btn-danger">Cancel Sale</button>');
        cancel.addEventListener('click', async () => {
          const ok = await window.App.confirmDialog('Sale Cancel Karein?', 'Bill ' + saleBillNo(sale) + ' cancel hogi aur stock wapas aa jayega. Ye action wapas nahi hoga.');
          if (!ok) return;
          cancelSale(sale);
          notify('Sale cancel ho gayi — stock wapas aa gaya', 'success');
          renderSales(container);
        });
        btnRow.appendChild(cancel);
      }
      td.appendChild(btnRow);
      tbody.appendChild(tr);
    });
    listWrap.appendChild(card);
  }
  filters.querySelector('#f-apply').addEventListener('click', drawList);
  filters.querySelector('#f-branch').addEventListener('change', drawList);
  drawList();
}

function cancelSale(sale) {
  const st = S();
  // Restore stock for quantities not already returned.
  (sale.items || []).forEach((line) => {
    const already = (sale.returns || []).reduce((a, r) => a + (r.items || []).filter((x) => String(x.productId) === String(line.productId)).reduce((b, x) => b + (Number(x.qty) || 0), 0), 0);
    const restock = itemQty(line) - already;
    if (restock <= 0) return;
    const p = DB.productById ? DB.productById(line.productId) : (st.products || []).find((x) => String(x.id) === String(line.productId));
    if (p) window.App.adjustStock(p, sale.branchId, restock, 'Sale Cancel', saleBillNo(sale));
  });
  sale.status = 'cancelled';
  save();
}

function openReturnForm(container, sale) {
  const existing = document.getElementById('return-form-box');
  if (existing) existing.remove();
  const box = el('<div class="card return-form" id="return-form-box"><h3>Return — Bill ' + esc(saleBillNo(sale)) + '</h3></div>');
  const rows = el('<div></div>');
  const inputs = {};
  (sale.items || []).forEach((line) => {
    const already = (sale.returns || []).reduce((a, r) => a + (r.items || []).filter((x) => String(x.productId) === String(line.productId)).reduce((b, x) => b + (Number(x.qty) || 0), 0), 0);
    const maxQty = itemQty(line) - already;
    if (maxQty <= 0) return;
    const row = el('<div class="form-row"><div><label>' + esc(itemName(line)) + ' (max ' + maxQty + ')</label>' +
      '<input class="input" type="number" min="0" max="' + maxQty + '" value="0"></div></div>');
    rows.appendChild(row);
    inputs[line.productId] = row.querySelector('input');
  });
  if (Object.keys(inputs).length === 0) {
    notify('Is bill ki tamam items pehle se return ho chuki hain', 'warning');
    return;
  }
  box.appendChild(rows);
  const actions = el('<div class="form-actions"><button type="button" class="btn btn-primary" id="ret-submit">Return Process Karein</button>' +
    '<button type="button" class="btn btn-ghost" id="ret-close">Band Karein</button></div>');
  box.appendChild(actions);
  actions.querySelector('#ret-close').addEventListener('click', () => box.remove());
  actions.querySelector('#ret-submit').addEventListener('click', async () => {
    const items = Object.keys(inputs).map((pid) => ({ productId: pid, qty: Number(inputs[pid].value) || 0 })).filter((x) => x.qty > 0);
    if (items.length === 0) { notify('Kam az kam aik item ki quantity dalein', 'warning'); return; }
    const ok = await window.App.confirmDialog('Return Confirm Karein?', 'Selected items ka stock wapas aayega aur refund record hoga.');
    if (!ok) return;
    const result = processReturn(sale, items);
    if (!result) { notify('Return process nahi ho saka', 'error'); return; }
    notify('Return kamyab — Refund ' + money(result.refund), 'success');
    box.remove();
    renderSales(container);
  });
  container.prepend(box);
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

window.Screens.pos = renderPos;
window.Screens.sales = renderSales;
})();
