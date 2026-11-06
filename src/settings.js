/* RARA POS — Settings (Agent C, Owner only)
   Contract: const DB = require('./db.js'); window.App helpers; window.Screens registry.
   Business details (printed on the bill), defaults, Backup Export / Import (JSON). */
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
  function notify(msg, type) { try { if (window.App && App.notify) { App.notify(msg, type || 'info'); return; } } catch (e) {} alert(msg); }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isOwner() { try { if (window.App && App.canSeeCost) return !!App.canSeeCost(); } catch (e) {} return !!(window.App && App.user && App.user.role === 'Owner'); }
  function val(id, root) { var el = (root || document).querySelector('#' + id); return el ? el.value : ''; }
  // <select> values are strings but branch ids in state are numbers;
  // return the branch's real id so stored ids keep their type.
  function branchIdOf(v) {
    var b = (S().branches || []).find(function (x) { return String(x.id) === String(v); });
    return b ? b.id : v;
  }
  function confirmDlg(title, text) {
    try { if (window.App && App.confirmDialog) return App.confirmDialog(title, text); } catch (e) {}
    return Promise.resolve(window.confirm(text || title));
  }

  Screens.settings = function render(containerEl) {
    if (!isOwner()) {
      containerEl.innerHTML = '<div class="card"><h2>Access denied</h2><p>Only the Owner can change settings.</p><button class="btn" id="st-back">Back to Dashboard</button></div>';
      containerEl.querySelector('#st-back').addEventListener('click', function () { try { App.go('dashboard'); } catch (e) {} });
      return;
    }
    var st = S();
    var settings = st.settings || {};
    var low = settings.lowStockThreshold != null ? settings.lowStockThreshold : (settings.lowStockDefault != null ? settings.lowStockDefault : 10);

    containerEl.innerHTML = '<h2>Settings</h2>' +
      '<div class="card"><h3>Business Details (printed on the bill)</h3>' +
      '<div class="form-row"><label>Business Name <input id="st-name" value="' + esc(settings.businessName || 'RARA') + '"></label>' +
      '<label>Phone <input id="st-phone" value="' + esc(settings.phone || '') + '"></label></div>' +
      '<div class="form-row"><label>Address <input id="st-address" value="' + esc(settings.address || '') + '"></label></div>' +
      '<button class="btn btn-primary" id="st-save-business">Save Business Details</button></div>' +
      '<div class="card" style="margin-top:12px"><h3>Defaults</h3>' +
      '<div class="form-row"><label>Low-Stock Threshold (default) <input type="number" id="st-low" min="0" step="1" value="' + esc(low) + '"></label>' +
      '<label>Default Branch <select id="st-branch">' + (st.branches || []).map(function (b) { return '<option value="' + esc(b.id) + '"' + (String(b.id) === String(settings.defaultBranchId) ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') + '</select></label>' +
      '<label><input type="checkbox" id="st-neg" ' + (settings.allowNegativeStock ? 'checked' : '') + '> Allow negative stock</label></div>' +
      '<button class="btn btn-primary" id="st-save-defaults">Save Defaults</button></div>' +
      '<div class="card" style="margin-top:12px"><h3>Backup &amp; Restore</h3>' +
      '<p>Data is stored on this laptop in the app data folder and survives closing the app.</p>' +
      '<button class="btn btn-primary" id="st-export">Export Data (JSON)</button> ' +
      '<button class="btn" id="st-import-btn">Import Data (JSON)</button>' +
      '<input type="file" id="st-import-file" accept=".json,application/json" style="display:none">' +
      '<p style="font-size:12px;opacity:.75">Import replaces all current data (products, sales, customers, suppliers, expenses, employees, logins and settings) with the file you choose. Export a backup first.</p></div>';

    containerEl.querySelector('#st-save-business').addEventListener('click', function () {
      var name = val('st-name', containerEl).trim();
      if (!name) { notify('Business name is required.', 'error'); return; }
      st.settings = st.settings || {};
      st.settings.businessName = name;
      st.settings.phone = val('st-phone', containerEl).trim();
      st.settings.address = val('st-address', containerEl).trim();
      save(); notify('Business details saved. They will appear on the bill.', 'success');
    });
    containerEl.querySelector('#st-save-defaults').addEventListener('click', function () {
      var lowVal = parseInt(val('st-low', containerEl), 10);
      if (isNaN(lowVal) || lowVal < 0) { notify('Low-stock threshold must be 0 or more.', 'error'); return; }
      st.settings = st.settings || {};
      st.settings.lowStockThreshold = lowVal;
      st.settings.lowStockDefault = lowVal;
      st.settings.defaultBranchId = branchIdOf(val('st-branch', containerEl)) || settings.defaultBranchId;
      st.settings.allowNegativeStock = !!containerEl.querySelector('#st-neg').checked;
      save(); notify('Defaults saved.', 'success');
    });
    containerEl.querySelector('#st-export').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(S(), null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      var d = new Date();
      a.download = 'rara-pos-backup-' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      notify('Backup exported as a JSON file.', 'success');
    });
    var fileInput = containerEl.querySelector('#st-import-file');
    containerEl.querySelector('#st-import-btn').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var parsed;
        try { parsed = JSON.parse(reader.result); } catch (e) { notify('That file is not valid JSON.', 'error'); return; }
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.products) || !Array.isArray(parsed.branches)) {
          notify('That file does not look like a RARA POS backup (it must contain products and branches). Nothing was changed.', 'error');
          return;
        }
        confirmDlg('Import backup?', 'Import this backup? ALL current data will be replaced with the data in this file. This cannot be undone.').then(function (ok) {
          if (!ok) { fileInput.value = ''; return; }
          // Replace in place so other modules holding a reference to DB.state keep working.
          Object.keys(DB.state).forEach(function (k) { delete DB.state[k]; });
          Object.keys(parsed).forEach(function (k) { DB.state[k] = parsed[k]; });
          if (!DB.state.settings) DB.state.settings = {};
          save();
          notify('Backup imported. All data was replaced with the file.', 'success');
          Screens.settings(containerEl);
        });
      };
      reader.onerror = function () { notify('Could not read that file.', 'error'); };
      reader.readAsText(file);
      fileInput.value = '';
    });
  };
})();
