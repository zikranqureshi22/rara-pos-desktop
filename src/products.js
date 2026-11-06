/* RARA POS — Products screen (Agent B). IIFE so top-level consts don't
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
function productImage(p) { return p.imageData || p.image || ''; }

function renderProducts(container) {
  container.innerHTML = '';
  const st = S();
  const canEdit = window.App.can('products') && (window.App.user.role === 'Owner' || window.App.user.role === 'Manager' || window.App.user.role === 'Franchise');
  const canDelete = window.App.user && window.App.user.role === 'Owner';
  const canSeeCost = window.App.canSeeCost();

  const head = el('<div class="screen-head"><h1>Products</h1>' +
    (canEdit ? '<button type="button" class="btn btn-primary" id="add-product-btn">Add Product Karein</button>' : '') + '</div>');
  container.appendChild(head);

  // Purchase-price-0 warning banner (do not invent costs).
  const zeroCost = (st.products || []).filter((p) => !(Number(p.purchasePrice) > 0));
  if (zeroCost.length > 0 && canSeeCost) {
    container.appendChild(el('<div class="warning-banner">Purchase Price 0 hai — profit sahi nahi dikhega. Owner Products &gt; Edit se asal cost daalein. (' + zeroCost.length + ' product' + (zeroCost.length > 1 ? 's' : '') + ')</div>'));
  }

  const formWrap = el('<div></div>');
  container.appendChild(formWrap);
  const addBtn = head.querySelector('#add-product-btn');
  if (addBtn) addBtn.addEventListener('click', () => showForm(formWrap, null, container));

  const searchRow = el('<div class="toolbar"><div class="field"><input class="input" id="prod-search" type="text" placeholder="Search — naam / SKU / barcode"></div></div>');
  container.appendChild(searchRow);
  const tableWrap = el('<div></div>');
  container.appendChild(tableWrap);

  function drawTable(filter) {
    tableWrap.innerHTML = '';
    const q = String(filter || '').trim().toLowerCase();
    const products = (st.products || []).filter((p) => {
      if (!q) return true;
      return [p.name, p.sku, p.barcode, p.brand].some((v) => String(v || '').toLowerCase().includes(q));
    });
    if (products.length === 0) {
      tableWrap.appendChild(el('<div class="card"><p class="muted">Koi product nahi mila.</p></div>'));
      return;
    }
    const card = el('<div class="card"><div class="table-wrap"><table><thead><tr><th>Photo</th><th>Name</th><th>SKU</th><th>Barcode</th><th>Price</th>' +
      (canSeeCost ? '<th>Purchase Price</th>' : '') +
      '<th>Stock (Total)</th><th>Per Branch</th><th>Actions</th></tr></thead><tbody></tbody></table></div></div>');
    const tbody = card.querySelector('tbody');
    products.forEach((p) => {
      const total = window.App.totalStock(p);
      const low = Number(p.lowThreshold) || 10;
      const perBranch = (st.branches || []).map((b) => esc(b.name) + ': ' + window.App.stockOf(p, b.id)).join(' | ');
      const stockBadge = total <= 0 ? '<span class="badge badge-red">Out of Stock</span>'
        : total <= low ? '<span class="badge badge-amber">Low Stock</span>'
        : '<span class="badge badge-green">In Stock</span>';
      const img = productImage(p);
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (img ? '<img class="thumb" src="' + esc(img) + '" alt="">' : '<span class="thumb-ph">' + esc(String(p.name || '?').slice(0, 10)) + '</span>') + '</td>' +
        '<td><b>' + esc(p.name || '') + '</b><br><small class="muted">' + esc([p.size, p.colour || p.color, p.brand].filter(Boolean).join(' • ')) + '</small></td>' +
        '<td>' + esc(p.sku || '') + '</td><td>' + esc(p.barcode || '') + '</td>' +
        '<td>' + money(p.price) + '</td>' +
        (canSeeCost ? '<td>' + money(p.purchasePrice) + '</td>' : '') +
        '<td>' + total + ' ' + stockBadge + '</td>' +
        '<td><small>' + perBranch + '</small></td><td></td>';
      const td = tr.lastElementChild;
      if (canEdit) {
        const edit = el('<button type="button" class="btn btn-sm">Edit</button>');
        edit.addEventListener('click', () => showForm(formWrap, p, container));
        td.appendChild(edit);
      }
      if (canDelete) {
        const del = el('<button type="button" class="btn btn-sm btn-danger" style="margin-left:6px">Delete</button>');
        del.addEventListener('click', async () => {
          const ok = await window.App.confirmDialog('Product Delete Karein?', '"' + (p.name || '') + '" delete ho jayega. Ye action wapas nahi hoga.');
          if (!ok) return;
          st.products = st.products.filter((x) => String(x.id) !== String(p.id));
          save();
          notify('Product delete ho gaya', 'success');
          renderProducts(container);
        });
        td.appendChild(del);
      }
      if (!canEdit && !canDelete) td.textContent = '—';
      tbody.appendChild(tr);
    });
    tableWrap.appendChild(card);
  }
  drawTable('');
  searchRow.querySelector('#prod-search').addEventListener('input', (e) => drawTable(e.target.value));

  function showForm(wrap, product, containerEl) {
    wrap.innerHTML = '';
    const isEdit = !!product;
    const p = product || {};
    const card = el('<div class="card"><h2>' + (isEdit ? 'Edit Product — ' + esc(p.name || '') : 'Naya Product Add Karein') + '</h2></div>');
    const form = el('<form></form>');
    const fields = [
      { key: 'name', label: 'Name *', type: 'text', req: true },
      { key: 'price', label: 'Sale Price (Rs) *', type: 'number', req: true },
      { key: 'purchasePrice', label: 'Purchase Price (Rs) — Owner only', type: 'number' },
      { key: 'wholesalePrice', label: 'Wholesale Price (Rs)', type: 'number' },
      { key: 'franchisePrice', label: 'Franchise Price (Rs)', type: 'number' },
      { key: 'size', label: 'Size (e.g. 50 ml)', type: 'text' },
      { key: 'color', label: 'Colour', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'brand', label: 'Brand', type: 'text' },
      { key: 'supplierName', label: 'Supplier', type: 'text' },
      { key: 'sku', label: 'SKU', type: 'text' },
      { key: 'barcode', label: 'Barcode', type: 'text' },
      { key: 'lowThreshold', label: 'Low Stock Threshold', type: 'number' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ];
    const inputs = {};
    const grid = el('<div class="form-row"></div>');
    fields.forEach((f) => {
      if ((f.key === 'purchasePrice' || f.key === 'wholesalePrice' || f.key === 'franchisePrice') && !canSeeCost) {
        // Cost fields are Owner-only, on add and on edit.
        return;
      }
      const div = el('<div></div>');
      div.appendChild(el('<label>' + esc(f.label) + '</label>'));
      const inp = el('<input class="input" type="' + f.type + '"' + (f.req ? ' required' : '') + '>');
      if (f.type === 'number') inp.min = '0';
      const val = p[f.key];
      inp.value = val === undefined || val === null ? '' : String(val);
      inputs[f.key] = inp;
      div.appendChild(inp);
      grid.appendChild(div);
    });
    form.appendChild(grid);

    // Stock at a branch (new product only; existing stock is managed in Stock screen).
    const branchDiv = el('<div></div>');
    branchDiv.appendChild(el('<label>Stock — Branch</label>'));
    const branchSel = el('<select class="input">' + (st.branches || []).map((b) =>
      '<option value="' + esc(b.id) + '"' + (String(b.id) === String(window.App.currentBranchId()) ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</select>');
    branchDiv.appendChild(branchSel);
    branchDiv.appendChild(el('<label>Opening Stock (is branch par)</label>'));
    const stockInput = el('<input class="input" type="number" min="0" value="' + (isEdit ? window.App.stockOf(p, window.App.currentBranchId()) : '0') + '">');
    branchDiv.appendChild(stockInput);
    form.appendChild(branchDiv);

    // Photo upload -> data URL stored in imageData (and image for display).
    form.appendChild(el('<label>Product Photo</label>'));
    const photoRow = el('<div class="btn-row"></div>');
    const fileInput = el('<input type="file" accept="image/*" class="input" style="max-width:320px">');
    let newImageData = productImage(p);
    const preview = el('<span></span>');
    if (newImageData) preview.appendChild(el('<img class="thumb" src="' + esc(newImageData) + '" alt="">'));
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        newImageData = String(reader.result || '');
        preview.innerHTML = '';
        preview.appendChild(el('<img class="thumb" src="' + esc(newImageData) + '" alt="">'));
      };
      reader.readAsDataURL(file);
    });
    photoRow.appendChild(fileInput);
    photoRow.appendChild(preview);
    const removePhoto = el('<button type="button" class="btn btn-sm btn-danger">Photo Remove Karein</button>');
    removePhoto.addEventListener('click', () => { newImageData = ''; preview.innerHTML = ''; fileInput.value = ''; });
    photoRow.appendChild(removePhoto);
    form.appendChild(photoRow);

    const actions = el('<div class="form-actions"><button type="submit" class="btn btn-primary">' + (isEdit ? 'Save Karein' : 'Add Karein') + '</button>' +
      '<button type="button" class="btn btn-ghost" id="form-cancel">Cancel</button></div>');
    form.appendChild(actions);
    actions.querySelector('#form-cancel').addEventListener('click', () => { wrap.innerHTML = ''; });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = (inputs.name ? inputs.name.value : '').trim();
      const price = Number(inputs.price ? inputs.price.value : 0) || 0;
      const sku = (inputs.sku ? inputs.sku.value : '').trim();
      const barcode = (inputs.barcode ? inputs.barcode.value : '').trim();
      if (!name) { notify('Product ka naam zaroori hai', 'warning'); return; }
      if (price <= 0) { notify('Sale price 0 se zyada hona chahiye', 'warning'); return; }
      // Duplicate SKU / barcode rejected with a clear notice.
      const dup = (st.products || []).find((x) => {
        if (isEdit && String(x.id) === String(p.id)) return false;
        if (sku && String(x.sku || '').trim() && String(x.sku).trim().toLowerCase() === sku.toLowerCase()) return true;
        if (barcode && String(x.barcode || '').trim() && String(x.barcode).trim() === barcode) return true;
        return false;
      });
      if (dup) { notify('SKU ya Barcode pehle se mojood hai — duplicate allow nahi (' + (dup.name || '') + ')', 'error'); return; }
      const data = {
        name, price,
        purchasePrice: inputs.purchasePrice ? (Number(inputs.purchasePrice.value) || 0) : (isEdit ? Number(p.purchasePrice) || 0 : 0),
        wholesalePrice: inputs.wholesalePrice ? (Number(inputs.wholesalePrice.value) || 0) : (isEdit ? Number(p.wholesalePrice) || 0 : 0),
        franchisePrice: inputs.franchisePrice ? (Number(inputs.franchisePrice.value) || 0) : (isEdit ? Number(p.franchisePrice) || 0 : 0),
        size: inputs.size ? inputs.size.value.trim() : (p.size || ''),
        color: inputs.color ? inputs.color.value.trim() : (p.color || p.colour || ''),
        category: inputs.category ? inputs.category.value.trim() : (p.category || ''),
        brand: inputs.brand ? inputs.brand.value.trim() : (p.brand || ''),
        supplierName: inputs.supplierName ? inputs.supplierName.value.trim() : (p.supplierName || p.supplier || ''),
        sku, barcode,
        lowThreshold: inputs.lowThreshold ? (Number(inputs.lowThreshold.value) || 10) : (Number(p.lowThreshold) || 10),
        notes: inputs.notes ? inputs.notes.value.trim() : (p.notes || ''),
        image: newImageData || '', imageData: newImageData || '',
      };
      if (isEdit) {
        Object.assign(p, data);
        const bId = branchSel.value;
        const qty = Math.max(0, Number(stockInput.value) || 0);
        const oldQty = window.App.stockOf(p, bId);
        if (qty !== oldQty) window.App.adjustStock(p, bId, qty - oldQty, 'Correction', 'Product Edit');
        save();
        notify('Product update ho gaya — Kamyab', 'success');
      } else {
        const np = Object.assign({
          id: (DB.nextId ? DB.nextId('products') : Date.now()),
          stock: 0, branchStocks: [], status: 'active',
        }, data);
        const bId = branchSel.value;
        const openQty = Math.max(0, Number(stockInput.value) || 0);
        st.products.push(np);
        if (openQty > 0) window.App.adjustStock(np, bId, openQty, 'Opening Stock', '');
        save();
        notify('Product add ho gaya — Kamyab', 'success');
      }
      wrap.innerHTML = '';
      renderProducts(containerEl);
    });
    card.appendChild(form);
    wrap.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

window.Screens.products = renderProducts;
})();
