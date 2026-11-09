/* RARA POS — Stock screen (Agent B). IIFE so top-level consts don't
 * collide with the other classic <script> files.
 */
(function () {
'use strict';
/* Renderer relative-require quirk: './db.js' resolves against index.html
 * (project root), not this file — fall back to './src/db.js'. See ui.js. */
const DB = (function () { try { return require('./db.js'); } catch (e) { return require('./src/db.js'); } })();
DB.load();
const state = DB.state;
if (window.App) window.App.state = DB.state;

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
function productById(id) { return (S().products || []).find((p) => String(p.id) === String(id)); }

function renderStock(container) {
  container.innerHTML = '';
  const st = S();
  const isOwner = window.App.user && window.App.user.role === 'Owner';
  const canManage = window.App.can('stock') && (window.App.user.role === 'Owner' || window.App.user.role === 'Manager');
  // Franchise sees ONLY its own branch here (v1.1.3) — other branches'
  // quantities, transfers and movements are never shown.
  const isFranchise = window.App.user && window.App.user.role === 'Franchise';
  const ownBranch = isFranchise ? window.App.currentBranchId() : null;
  let viewBranch = window.App.currentBranchId();

  const head = el('<div class="screen-head"><h1>Stock</h1></div>');
  container.appendChild(head);

  const branchCard = el('<div class="card"><div class="toolbar"><div class="field"><label>Branch</label>' +
    '<select class="input" id="stock-branch">' + (st.branches || []).filter((b) => isOwner || String(b.id) === String(viewBranch)).map((b) =>
      '<option value="' + esc(b.id) + '"' + (String(b.id) === String(viewBranch) ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') +
    '</select></div></div></div>');
  container.appendChild(branchCard);
  const branchSel = branchCard.querySelector('#stock-branch');
  if (!isOwner) branchSel.disabled = true;
  branchSel.addEventListener('change', () => { viewBranch = branchSel.value; renderStock(container); });

  /* ---- Stock table ---- */
  const tableWrap = el('<div></div>');
  container.appendChild(tableWrap);
  function drawTable() {
    tableWrap.innerHTML = '';
    const products = st.products || [];
    if (products.length === 0) {
      tableWrap.appendChild(el('<div class="card"><p class="muted">Koi product nahi hai — pehle Products se add karein.</p></div>'));
      return;
    }
    const card = el('<div class="card"><h2>Stock — ' + esc(window.App.branchName(viewBranch)) + '</h2><div class="table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Is Branch</th>' + (isFranchise ? '' : '<th>Total (Sab Branches)</th>') + '<th>Status</th></tr></thead><tbody></tbody></table></div></div>');
    const tbody = card.querySelector('tbody');
    products.forEach((p) => {
      const qty = window.App.stockOf(p, viewBranch);
      const total = window.App.totalStock(p);
      const low = Number(p.lowThreshold) || 10;
      const badge = qty <= 0 ? '<span class="badge badge-red">Out of Stock</span>'
        : qty <= low ? '<span class="badge badge-amber">Low Stock</span>'
        : '<span class="badge badge-green">OK</span>';
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><b>' + esc(p.name || '') + '</b></td><td>' + esc(p.sku || '') + '</td>' +
        '<td><b>' + qty + '</b></td>' + (isFranchise ? '' : '<td>' + total + '</td>') + '<td>' + badge + '</td>';
      tbody.appendChild(tr);
    });
    tableWrap.appendChild(card);
  }
  drawTable();

  /* ---- Adjust stock ---- */
  if (canManage) {
    const adj = el('<div class="card"><h2>Stock Adjust Karein</h2></div>');
    const form = el('<form></form>');
    const grid = el('<div class="form-row"></div>');
    const prodSel = el('<select class="input">' + (st.products || []).map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join('') + '</select>');
    const qtyInput = el('<input class="input" type="number" placeholder="e.g. 10 ya -5" required>');
    const reasonSel = el('<select class="input"><option>Restock</option><option>Damaged</option><option>Missing</option><option>Correction</option></select>');
    [['Product', prodSel], ['Quantity (+/-)', qtyInput], ['Reason', reasonSel]].forEach(([label, input]) => {
      const d = el('<div></div>');
      d.appendChild(el('<label>' + label + '</label>'));
      d.appendChild(input);
      grid.appendChild(d);
    });
    form.appendChild(grid);
    form.appendChild(el('<div class="form-actions"><button type="submit" class="btn btn-primary">Adjust Karein</button></div>'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const p = productById(prodSel.value);
      const delta = Number(qtyInput.value) || 0;
      if (!p) { notify('Product chunein', 'warning'); return; }
      if (delta === 0) { notify('Quantity 0 nahi ho sakti', 'warning'); return; }
      const next = window.App.stockOf(p, viewBranch) + delta;
      if (next < 0 && !(st.settings && st.settings.allowNegativeStock)) {
        notify('Stock negative nahi ho sakta — ' + p.name + ' (mojood: ' + window.App.stockOf(p, viewBranch) + ')', 'error');
        return;
      }
      window.App.adjustStock(p, viewBranch, delta, reasonSel.value, '');
      save();
      notify('Stock adjust ho gaya — ' + p.name + ': ' + next, 'success');
      renderStock(container);
    });
    adj.appendChild(form);
    container.appendChild(adj);
  }

  /* ---- Transfers ---- */
  const trWrap = el('<div></div>');
  container.appendChild(trWrap);
  function drawTransfers() {
    trWrap.innerHTML = '';
    const card = el('<div class="card"><h2>Branch Transfers</h2></div>');
    if (canManage) {
      const form = el('<form></form>');
      const grid = el('<div class="form-row"></div>');
      const fromSel = el('<select class="input">' + (st.branches || []).map((b) => '<option value="' + esc(b.id) + '"' + (String(b.id) === String(viewBranch) ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</select>');
      const toSel = el('<select class="input">' + (st.branches || []).map((b) => '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>').join('') + '</select>');
      const prodSel = el('<select class="input">' + (st.products || []).map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join('') + '</select>');
      const qtyInput = el('<input class="input" type="number" min="1" value="1" required>');
      [['From Branch', fromSel], ['To Branch', toSel], ['Product', prodSel], ['Quantity', qtyInput]].forEach(([label, input]) => {
        const d = el('<div></div>');
        d.appendChild(el('<label>' + label + '</label>'));
        d.appendChild(input);
        grid.appendChild(d);
      });
      form.appendChild(grid);
      form.appendChild(el('<p class="muted">Note: transfer banane se stock move nahi hota — stock sirf Receive par move hota hai.</p>'));
      form.appendChild(el('<div class="form-actions"><button type="submit" class="btn btn-primary">Transfer Banayein</button></div>'));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (fromSel.value === toSel.value) { notify('From aur To branch aik jaisi nahi ho sakti', 'warning'); return; }
        const qty = Number(qtyInput.value) || 0;
        if (qty <= 0) { notify('Quantity 0 se zyada honi chahiye', 'warning'); return; }
        const p = productById(prodSel.value);
        if (!p) { notify('Product chunein', 'warning'); return; }
        st.transfers = st.transfers || [];
        st.transfers.unshift({
          id: (DB.nextId ? DB.nextId('transfers') : Date.now()), date: new Date().toISOString(),
          fromBranchId: window.App.normBranchId(fromSel.value), toBranchId: window.App.normBranchId(toSel.value),
          items: [{ productId: p.id, qty, received: 0 }],
          status: 'pending', createdBy: window.App.user ? window.App.user.name : '',
        });
        save();
        notify('Transfer ban gaya — Receive par stock move hoga', 'success');
        renderStock(container);
      });
      card.appendChild(form);
    }
    const pending = (st.transfers || []).filter((t) => {
      if (isFranchise && String(t.fromBranchId) !== String(ownBranch) && String(t.toBranchId) !== String(ownBranch)) return false;
      return t.status === 'pending' || t.status === 'partial';
    });
    const done = (st.transfers || []).filter((t) => {
      if (isFranchise && String(t.fromBranchId) !== String(ownBranch) && String(t.toBranchId) !== String(ownBranch)) return false;
      return t.status !== 'pending' && t.status !== 'partial';
    });
    if (pending.length === 0) {
      card.appendChild(el('<p class="muted">Koi pending transfer nahi hai.</p>'));
    } else {
      const table = el('<div class="table-wrap"><table><thead><tr><th>Date</th><th>From → To</th><th>Items</th><th>Status</th><th>Actions</th></tr></thead><tbody></tbody></table></div>');
      const tbody = table.querySelector('tbody');
      pending.forEach((t) => {
        const tr = document.createElement('tr');
        const itemsText = (t.items || []).map((it) => {
          const p = productById(it.productId);
          return esc(p ? p.name : it.productId) + ' — ' + (Number(it.received) || 0) + '/' + it.qty;
        }).join('<br>');
        tr.innerHTML = '<td>' + esc(fmtDate(t.date)) + '</td>' +
          '<td>' + esc(window.App.branchName(t.fromBranchId)) + ' → ' + esc(window.App.branchName(t.toBranchId)) + '</td>' +
          '<td>' + itemsText + '</td>' +
          '<td><span class="badge badge-amber">' + esc(t.status) + '</span></td><td></td>';
        const td = tr.lastElementChild;
        if (canManage) {
          const recv = el('<button type="button" class="btn btn-sm btn-primary">Receive</button>');
          recv.addEventListener('click', () => openReceiveForm(container, t));
          td.appendChild(recv);
          const cancel = el('<button type="button" class="btn btn-sm btn-danger" style="margin-left:6px">Cancel</button>');
          cancel.addEventListener('click', async () => {
            const ok = await window.App.confirmDialog('Transfer Cancel Karein?', 'Pending transfer cancel ho jayega. Jo stock pehle receive ho chuka hai woh wapas nahi hoga.');
            if (!ok) return;
            t.status = 'cancelled';
            save();
            notify('Transfer cancel ho gaya', 'success');
            renderStock(container);
          });
          td.appendChild(cancel);
        } else {
          td.textContent = '—';
        }
        tbody.appendChild(tr);
      });
      card.appendChild(table);
    }
    if (done.length > 0) {
      card.appendChild(el('<h3 style="margin-top:16px">Pichle Transfers</h3>'));
      const list = el('<div class="table-wrap"><table><thead><tr><th>Date</th><th>From → To</th><th>Items</th><th>Status</th></tr></thead><tbody></tbody></table></div>');
      const tbody = list.querySelector('tbody');
      done.slice(0, 10).forEach((t) => {
        const tr = document.createElement('tr');
        const itemsText = (t.items || []).map((it) => {
          const p = productById(it.productId);
          return esc(p ? p.name : it.productId) + ' — ' + (Number(it.received) || 0) + '/' + it.qty;
        }).join('<br>');
        tr.innerHTML = '<td>' + esc(fmtDate(t.date)) + '</td>' +
          '<td>' + esc(window.App.branchName(t.fromBranchId)) + ' → ' + esc(window.App.branchName(t.toBranchId)) + '</td>' +
          '<td>' + itemsText + '</td><td>' + esc(t.status) + (t.discrepancy ? ' — ' + esc(t.discrepancy) : '') + '</td>';
        tbody.appendChild(tr);
      });
      card.appendChild(list);
    }
    trWrap.appendChild(card);
  }
  drawTransfers();

  function openReceiveForm(containerEl, transfer) {
    const existing = document.getElementById('receive-form-box');
    if (existing) existing.remove();
    const box = el('<div class="card" id="receive-form-box"><h3>Receive Transfer — ' + esc(window.App.branchName(transfer.fromBranchId)) + ' → ' + esc(window.App.branchName(transfer.toBranchId)) + '</h3>' +
      '<p class="muted">Receive par stock From branch se kam aur To branch par zyada hoga.</p></div>');
    const rows = el('<div></div>');
    const inputs = {};
    (transfer.items || []).forEach((it) => {
      const p = productById(it.productId);
      const remaining = it.qty - (Number(it.received) || 0);
      if (remaining <= 0) return;
      const row = el('<div class="form-row"><div><label>' + esc(p ? p.name : it.productId) + ' — baaqi ' + remaining + ' (From stock: ' + window.App.stockOf(p, transfer.fromBranchId) + ')</label>' +
        '<input class="input" type="number" min="0" max="' + remaining + '" value="' + remaining + '"></div></div>');
      rows.appendChild(row);
      inputs[it.productId] = row.querySelector('input');
    });
    if (Object.keys(inputs).length === 0) { notify('Is transfer mein receive karne ko kuch baaqi nahi', 'warning'); return; }
    box.appendChild(rows);
    const actions = el('<div class="form-actions"><button type="button" class="btn btn-primary" id="recv-submit">Receive Karein</button>' +
      '<button type="button" class="btn btn-ghost" id="recv-close">Band Karein</button></div>');
    box.appendChild(actions);
    actions.querySelector('#recv-close').addEventListener('click', () => box.remove());
    actions.querySelector('#recv-submit').addEventListener('click', async () => {
      const allowNeg = !!(S().settings && S().settings.allowNegativeStock);
      const plan = Object.keys(inputs).map((pid) => ({ productId: pid, qty: Number(inputs[pid].value) || 0 })).filter((x) => x.qty > 0);
      if (plan.length === 0) { notify('Kam az kam aik item ki quantity dalein', 'warning'); return; }
      for (const item of plan) {
        const p = productById(item.productId);
        if (!allowNeg && window.App.stockOf(p, transfer.fromBranchId) < item.qty) {
          notify('From branch mein stock kam hai — ' + (p ? p.name : '') + ' (mojood: ' + window.App.stockOf(p, transfer.fromBranchId) + ')', 'error');
          return;
        }
      }
      const ok = await window.App.confirmDialog('Receive Confirm Karein?', 'Stock From branch se kam aur To branch par add ho jayega.');
      if (!ok) return;
      plan.forEach((item) => {
        const p = productById(item.productId);
        const line = (transfer.items || []).find((x) => String(x.productId) === String(item.productId));
        if (!p || !line) return;
        window.App.adjustStock(p, transfer.fromBranchId, -item.qty, 'Transfer Out', transfer.id);
        window.App.adjustStock(p, transfer.toBranchId, item.qty, 'Transfer In', transfer.id);
        line.received = (Number(line.received) || 0) + item.qty;
      });
      const allDone = (transfer.items || []).every((it) => (Number(it.received) || 0) >= it.qty);
      transfer.status = allDone ? 'received' : 'partial';
      if (!allDone) {
        const short = (transfer.items || []).map((it) => {
          const p = productById(it.productId);
          return (p ? p.name : it.productId) + ': ' + (it.qty - (Number(it.received) || 0)) + ' baaqi';
        }).join('; ');
        transfer.discrepancy = 'Partial receive — ' + short;
      }
      save();
      notify(allDone ? 'Transfer receive ho gaya — Kamyab' : 'Partial receive ho gaya — baaqi pending hai', 'success');
      box.remove();
      renderStock(containerEl);
    });
    containerEl.prepend(box);
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---- Stock history ---- */
  const histCard = el('<div class="card"><h2>Stock History</h2></div>');
  // Franchise sees only its own branch's movements (v1.1.3).
  const allMoves = (st.stockMovements || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const moves = (isFranchise ? allMoves.filter((m) => String(m.branchId) === String(ownBranch)) : allMoves).slice(0, 100);
  if (moves.length === 0) {
    histCard.appendChild(el('<p class="muted">Abhi koi stock movement nahi hai.</p>'));
  } else {
    const table = el('<div class="table-wrap"><table><thead><tr><th>Date</th><th>Product</th><th>Branch</th><th>Qty</th><th>Reason</th><th>User</th><th>Ref</th></tr></thead><tbody></tbody></table></div>');
    const tbody = table.querySelector('tbody');
    moves.forEach((m) => {
      const p = productById(m.productId);
      const qty = Number(m.qty != null ? m.qty : (m.change != null ? m.change : 0)) || 0;
      const reason = m.reason || m.type || '';
      const ref = m.reference || m.ref || '';
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + esc(fmtDate(m.date)) + '</td><td>' + esc((m.productName || (p ? p.name : '')) || (m.productId || '')) + '</td>' +
        '<td>' + esc(m.branchName || window.App.branchName(m.branchId)) + '</td>' +
        '<td><b>' + (qty > 0 ? '+' : '') + qty + '</b></td>' +
        '<td>' + esc(reason) + '</td><td>' + esc(m.user || '') + '</td><td>' + esc(ref) + '</td>';
      tbody.appendChild(tr);
    });
    histCard.appendChild(table);
  }
  container.appendChild(histCard);
}

window.Screens.stock = renderStock;
})();
