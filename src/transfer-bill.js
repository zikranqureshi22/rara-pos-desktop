/* RARA POS — Stock Transfer Bill (v1.1.7).
 * When the Owner gives stock from the Main Warehouse to a franchise or
 * branch (a transfer), a thermal bill is generated for the stock given:
 *   * dispatch bill — shown automatically as a preview modal right after
 *     the transfer is created (same flow as the sales bill);
 *   * re-printable later from the transfer history (Bill button).
 * The bill uses the SAME 72mm thermal layout as the sales bill (exact
 * black RARA logo on top, "Fragrance / Fashions" below, 13px weight 700,
 * measured-height printing) and the same preview modal + print path
 * (pos.js showBillPreviewHtml / printReceiptHtml), so preview and
 * printed bill always match.
 * Bill content: Transfer No (T-XXXX), date, From → To branch, created
 * by, then ALL products in the transfer — Product | Qty | Franchise
 * Price | Sale Price with line totals (Qty x Franchise Price and
 * Qty x Sale Price) — then Total Franchise Value and Total Sale Value.
 * Prices are the product's CURRENT prices: franchisePrice (what the
 * Owner charges the franchise/branch) and price (retail sale price).
 * Nothing is invented: a product with franchisePrice 0 shows Rs 0 and
 * the bill carries a plain note (same pattern as the v1.1.6 cost-0
 * note) so the Owner knows to set Franchise Price in Products > Edit.
 * Roles: the bill is NEVER shown to the Salesman role (no cost /
 * franchise price for Salesman, as in v1.1.5). Franchise users already
 * see franchisePrice as their own cost, so showing it on their own
 * transfers is fine. Read-only — no transfer record is ever changed.
 * Wrapped in an IIFE so top-level consts don't collide with the other
 * classic <script> files.
 */
(function () {
'use strict';
/* Renderer relative-require quirk: './db.js' resolves against index.html
 * (project root), not this file — fall back to './src/db.js'. See ui.js. */
const DB = (function () { try { return require('./db.js'); } catch (e) { return require('./src/db.js'); } })();
DB.load();
/* RARA receipt logo (v1.1.3): the EXACT supplied black RARA serif logo as
 * a base64 data URL (src/receipt-logo.js) — prints offline, no file
 * read at print time. Missing module = no logo; the business-name text
 * line is used instead so the bill never loses its header. */
let RECEIPT_LOGO = '';
try { RECEIPT_LOGO = require('./receipt-logo.js'); } catch (e1) { try { RECEIPT_LOGO = require('./src/receipt-logo.js'); } catch (e2) { RECEIPT_LOGO = ''; } }
const state = DB.state;
if (window.App) window.App.state = DB.state;

/* Live state accessor: App.state is re-synced on every App.save(). */
function S() { return (window.App && window.App.state) || state; }
function money(n) { return window.App.money(n); }
function notify(m, t) { window.App.notify(m, t); }
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso || '—');
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return String(iso || '—'); }
}
function branchName(id) {
  try {
    if (window.App && window.App.branchName) {
      const n = window.App.branchName(id);
      if (n) return n;
    }
  } catch (e) { /* fall through to DB lookup */ }
  const b = DB.branchById ? DB.branchById(id) : (S().branches || []).find((x) => String(x.id) === String(id));
  return b ? (b.name || '') : ('Branch ' + id);
}
function transferBillNo(t) {
  return 'T-' + String(t.id == null ? '' : t.id).padStart(4, '0');
}
function transferDate(t) { return t.date || t.createdAt || t.timestamp || ''; }

function transferBillHtml(transfer) {
  const st = S();
  const vals = DB.transferBillValues
    ? DB.transferBillValues(transfer, st.products)
    : { rows: [], totals: { qty: 0, franchiseValue: 0, saleValue: 0 }, franchiseZero: false };
  const logoHtml = RECEIPT_LOGO
    ? '<div class="r-center"><img class="r-logo" src="' + RECEIPT_LOGO + '" alt="RARA"></div>'
    : '<div class="r-center r-bold">' + esc(st.settings.businessName || 'RARA') + '</div>';
  const rows = vals.rows.map((r) =>
    '<tr><td>' + esc(r.name) + '<br><small>Qty ' + r.qty + ' · F ' + money(r.franchisePrice) + ' · S ' + money(r.salePrice) + '</small></td>' +
    '<td class="r-right">' + money(r.franchiseValue) + '</td>' +
    '<td class="r-right">' + money(r.saleValue) + '</td></tr>'
  ).join('');
  return '' +
    logoHtml +
    '<div class="r-center">Fragrance / Fashions</div>' +
    '<div class="r-line"></div>' +
    '<div class="r-center r-bold">Stock Transfer Bill</div>' +
    '<div>Transfer No: <b>' + esc(transferBillNo(transfer)) + '</b></div>' +
    '<div>Date: ' + esc(fmtDate(transferDate(transfer))) + '</div>' +
    '<div>From: ' + esc(branchName(transfer.fromBranchId)) + '</div>' +
    '<div>To: ' + esc(branchName(transfer.toBranchId)) + '</div>' +
    (transfer.createdBy ? '<div>Created By: ' + esc(transfer.createdBy) + '</div>' : '') +
    '<div class="r-line"></div>' +
    '<table><thead><tr><th>Product</th><th class="r-right">Franchise</th><th class="r-right">Sale</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="r-line"></div>' +
    '<table>' +
    '<tr><td class="r-bold">Total Franchise Value</td><td class="r-right r-bold">' + money(vals.totals.franchiseValue) + '</td></tr>' +
    '<tr><td class="r-bold">Total Sale Value</td><td class="r-right r-bold">' + money(vals.totals.saleValue) + '</td></tr>' +
    '</table>' +
    (vals.franchiseZero
      ? '<div class="r-line"></div><div>Note: kuch products ki Franchise Price abhi 0 hai — Products &gt; Edit mein Franchise Price set karein, warna franchise value 0 dikhegi.</div>'
      : '') +
    '<div class="r-line"></div>' +
    '<div class="r-center">Stock Transfer — RARA</div>';
}

/* Show the transfer bill in the SAME preview modal as the sales bill
 * (pos.js showBillPreviewHtml): the preview renders exactly what
 * printing uses. Returns false for the Salesman role — the bill is
 * never visible to that role (no cost / franchise price, v1.1.5). */
function showTransferBill(transfer) {
  if (window.App.user && window.App.user.role === 'Salesman') {
    notify('Is bill ki permission nahi hai', 'error');
    return false;
  }
  if (!transfer) return false;
  if (window.App.showBillPreviewHtml) {
    return window.App.showBillPreviewHtml(transferBillHtml(transfer), function () { return printTransferBill(transfer); });
  }
  return false;
}

/* Print via the SAME measured-height thermal path as the sales bill
 * (pos.js printReceiptHtml): 72mm wide, one page of exactly the bill
 * height, falling back to the print dialog when no printer is set. */
async function printTransferBill(transfer) {
  if (!transfer) return false;
  if (window.App.printReceiptHtml) return window.App.printReceiptHtml(transferBillHtml(transfer));
  return false;
}

window.App.showTransferBill = showTransferBill;
window.App.printTransferBill = printTransferBill;
window.App.transferBillHtml = transferBillHtml;
window.App.transferBillNo = transferBillNo;
})();
