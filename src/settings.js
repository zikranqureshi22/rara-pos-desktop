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
  // Backup section (item 9): last auto-backup time, how many are kept,
  // and Backup Now / Restore Latest buttons. Backups are verified on
  // write (read back + parse) and the last 7 are kept.
  function backupCardHtml() {
    var info = { lastBackup: null, count: 0 };
    try { if (DB.backupInfo) info = DB.backupInfo(); } catch (e) { info = { lastBackup: null, count: 0 }; }
    var last = info.lastBackup ? new Date(info.lastBackup).toLocaleString('en-GB') : 'Abhi tak koi backup nahi bana';
    return '<div class="card" style="margin-top:12px"><h3>Backup &amp; Restore</h3>' +
      '<p>Data is stored on this laptop in the app data folder and survives closing the app. Auto-backup har roz login par aur har dafa app band karne par banta hai (aakhri 7 rakhe jate hain).</p>' +
      '<p>Last auto-backup: <b>' + esc(last) + '</b> &nbsp;|&nbsp; Saved backups: <b>' + (info.count || 0) + '</b></p>' +
      '<button class="btn btn-primary" id="st-backup-now">Backup Now</button> ' +
      '<button class="btn" id="st-restore">Restore Latest Backup</button> ' +
      '<button class="btn" id="st-export">Export Data (JSON)</button> ' +
      '<button class="btn" id="st-import-btn">Import Data (JSON)</button>' +
      '<input type="file" id="st-import-file" accept=".json,application/json" style="display:none">' +
      '<p style="font-size:12px;opacity:.75">Import replaces all current data (products, sales, customers, suppliers, expenses, employees, logins and settings) with the file you choose. Export a backup first. Restore Latest Backup sab se naye verified backup se data wapas lata hai.</p></div>';
  }
  // Self auto-update: the app checks GitHub Releases for a new version
  // and installs it itself — no manual reinstall. The repo is PRIVATE,
  // so a read-only GitHub token is needed once (see the steps below).
  // The token is stored only on this laptop (app-data folder), never in
  // the repo and never shown back — only "token saved hai / nahi" is shown.
  function updatesCardHtml() {
    var autoOn = true;
    try { if (window.App && App.update && App.update.state && typeof App.update.state.autoCheck === 'boolean') autoOn = App.update.state.autoCheck; } catch (e) { /* default ON */ }
    return '<div class="card" style="margin-top:12px"><h3>Updates — Khud Update Ho Jayega</h3>' +
      '<p>App khud naya version check karta hai aur download kar ke install kar deta hai — dobara install karne ki zaroorat nahi. Naya version aane par restart karne ka notice aayega.</p>' +
      '<p>Current version: <b id="upd-version">…</b> &nbsp;|&nbsp; Status: <b id="upd-status">…</b> &nbsp;|&nbsp; Last check: <b id="upd-last-check">…</b></p>' +
      '<div class="form-row"><label><input type="checkbox" id="upd-auto" ' + (autoOn ? 'checked' : '') + '> App khulte hi update check karein (automatic)</label></div>' +
      '<div class="form-row"><label>GitHub Token (sirf ek dafa, Owner) <input type="password" id="upd-token" autocomplete="off" placeholder="Token yahan dalein — save karne ke baad nazar nahi aayega"></label></div>' +
      '<button class="btn btn-primary" id="upd-save-token">Token Save Karein</button> ' +
      '<button class="btn" id="upd-clear-token">Token Hatayein</button> ' +
      '<button class="btn" id="upd-check">Update Check Karein</button> ' +
      '<button class="btn btn-primary" id="upd-restart" style="display:none">Restart Karein aur Update Lagayein</button>' +
      '<p style="font-size:12px;opacity:.75">Token kaise banayein (sirf ek dafa): GitHub kholein → apni photo → Settings → Developer settings → Personal access tokens → Fine-grained tokens → "Generate new token" → sirf <b>rara-pos-desktop</b> repo select karein → Permissions me <b>Contents: Read-only</b> dein → token banayein aur yahan dalein. Token sirf is laptop par save hota hai, kahin aur nahi jata, aur GitHub se kabhi bhi revoke/rotate kar sakte hain. Token ke baghair update check nahi chalega — app phir bhi normal kaam karega.</p></div>';
  }
  // Data check (item 3): report any duplicates that already exist.
  // Nothing is deleted here — the Owner decides what to fix.
  function dataCheckHtml() {
    var dups = { products: [], customers: [], suppliers: [], appUsers: [], branches: [] };
    try { if (DB.findDuplicates) dups = DB.findDuplicates(); } catch (e) { /* ignore */ }
    var total = dups.products.length + dups.customers.length + dups.suppliers.length + dups.appUsers.length + dups.branches.length;
    if (total === 0) {
      return '<div class="card" style="margin-top:12px"><h3>Data Check</h3><p>Koi duplicate record nahi mila — SKU, barcode, customer phone, supplier aur username sab unique hain.</p></div>';
    }
    var rows = [];
    ['products', 'customers', 'suppliers', 'appUsers', 'branches'].forEach(function (coll) {
      dups[coll].forEach(function (d) {
        rows.push('<tr><td>' + esc(coll) + '</td><td>' + esc(d.field) + ': ' + esc(d.value) + '</td><td>' + esc(d.names.join(', ')) + '</td></tr>');
      });
    });
    return '<div class="card" style="margin-top:12px"><h3>Data Check — Duplicates Mile (' + total + ')</h3>' +
      '<p>Ye records duplicate hain. Kuch delete nahi kiya gaya — inhein Products / Customers / Suppliers / Logins screen se theek karein.</p>' +
      '<table class="tbl"><thead><tr><th>Section</th><th>Duplicate</th><th>Records</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
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
      '<label>Session Timeout (minutes) <input type="number" id="st-timeout" min="5" max="120" step="1" value="' + esc(settings.sessionTimeoutMinutes != null ? settings.sessionTimeoutMinutes : 15) + '"></label>' +
      '<label><input type="checkbox" id="st-neg" ' + (settings.allowNegativeStock ? 'checked' : '') + '> Allow negative stock</label></div>' +
      '<div style="margin-top:10px"><label style="margin:0"><input type="checkbox" id="st-live-bg" ' + (settings.liveBackground !== false ? 'checked' : '') + '> Live Background (video) — Dark theme me background video chalaye</label></div>' +
      '<p style="font-size:12px;opacity:.75">Session Timeout: itne minute tak koi activity na ho to app lock ho jayega aur PIN dobara mangega (data aur branch waisi ki waisi rehti hai). 1 minute pehle warning notice aata hai.</p>' +
      '<p style="font-size:12px;opacity:.75">Live Background: ON ho to Dark theme me video background chalta hai; OFF ho to plain dark background rehta hai aur video pause ho jata hai. Light theme me video kabhi nahi chalta.</p>' +
      '<button class="btn btn-primary" id="st-save-defaults">Save Defaults</button></div>' +
      backupCardHtml() + updatesCardHtml() + dataCheckHtml();

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
      var timeoutVal = parseInt(val('st-timeout', containerEl), 10);
      if (isNaN(timeoutVal) || timeoutVal < 5 || timeoutVal > 120) { notify('Session timeout 5 se 120 minute ke darmiyan hona chahiye.', 'error'); return; }
      st.settings = st.settings || {};
      st.settings.lowStockThreshold = lowVal;
      st.settings.lowStockDefault = lowVal;
      st.settings.defaultBranchId = branchIdOf(val('st-branch', containerEl)) || settings.defaultBranchId;
      st.settings.allowNegativeStock = !!containerEl.querySelector('#st-neg').checked;
      st.settings.sessionTimeoutMinutes = timeoutVal;
      st.settings.liveBackground = !!containerEl.querySelector('#st-live-bg').checked;
      save(); notify('Defaults saved.', 'success');
      // The new timeout applies from the next login / activity reset.
      try { if (window.App && App.resetIdleTimer) App.resetIdleTimer(); } catch (e) { /* ignore */ }
      try { if (window.App && App.applyLiveBackground) App.applyLiveBackground(); } catch (e) { /* ignore */ }
    });
    // Live Background toggle applies immediately (no need to press Save).
    containerEl.querySelector('#st-live-bg').addEventListener('change', function () {
      var on = !!containerEl.querySelector('#st-live-bg').checked;
      try {
        if (window.App && App.setLiveBackground) {
          App.setLiveBackground(on);
          notify(on ? 'Live Background ON hai — video background chal raha hai' : 'Live Background OFF hai — plain dark background', 'info');
          return;
        }
      } catch (e) { /* fall through to plain save */ }
      st.settings = st.settings || {};
      st.settings.liveBackground = on;
      save();
    });
    containerEl.querySelector('#st-backup-now').addEventListener('click', function () {
      var res = { ok: false };
      try { res = DB.backup ? DB.backup() : { ok: false }; } catch (e) { res = { ok: false, error: e && e.message ? e.message : 'Backup nahi ban saka' }; }
      if (res.ok) { notify('Backup ban gaya aur verify ho gaya — ' + (res.name || ''), 'success'); }
      else { notify('Masla: Backup nahi ban saka — ' + (res.error || 'dobara koshish karein'), 'error'); return; }
      Screens.settings(containerEl);
    });
    // Updates card: token save/clear, manual check, restart-to-install,
    // auto-check toggle. The token value itself is never displayed back
    // and never stored in the data file — main process keeps it in
    // <userData>/update-token.json only.
    (function wireUpdates() {
      var ipc = null;
      try { ipc = (window.App && App._updateIpc) ? App._updateIpc : require('electron').ipcRenderer; } catch (e) { ipc = null; }
      var tokenInput = containerEl.querySelector('#upd-token');
      var saveBtn = containerEl.querySelector('#upd-save-token');
      if (saveBtn) saveBtn.addEventListener('click', function () {
        var t = tokenInput ? tokenInput.value.trim() : '';
        if (!t) { notify('Pehle token dalein', 'warning'); return; }
        try { if (ipc) ipc.send('update-save-token', t); } catch (e) { notify('Masla: Token save nahi ho saka', 'error'); return; }
        if (tokenInput) tokenInput.value = '';
        notify('Token save ho gaya — ab update check chalega', 'success');
        try { if (window.App && App._refreshUpdateState) App._refreshUpdateState(); } catch (e) { /* ignore */ }
      });
      var clearBtn = containerEl.querySelector('#upd-clear-token');
      if (clearBtn) clearBtn.addEventListener('click', function () {
        try { if (ipc) ipc.send('update-clear-token'); } catch (e) { /* ignore */ }
        if (tokenInput) tokenInput.value = '';
        notify('Token hata diya gaya — update check band ho jayega jab tak naya token na dalein', 'info');
        try { if (window.App && App._refreshUpdateState) App._refreshUpdateState(); } catch (e) { /* ignore */ }
      });
      var checkBtn = containerEl.querySelector('#upd-check');
      if (checkBtn) checkBtn.addEventListener('click', function () {
        try { if (window.App && App.checkForUpdates) App.checkForUpdates(); } catch (e) { notify('Masla: Update check shuru nahi ho saka', 'error'); }
      });
      var restartBtn = containerEl.querySelector('#upd-restart');
      if (restartBtn) restartBtn.addEventListener('click', function () {
        try { if (window.App && App.installUpdate) App.installUpdate(); } catch (e) { /* ignore */ }
      });
      var autoBox = containerEl.querySelector('#upd-auto');
      if (autoBox) autoBox.addEventListener('change', function () {
        try { if (ipc) ipc.send('update-set-auto-check', !!autoBox.checked); } catch (e) { /* ignore */ }
        notify(autoBox.checked ? 'Automatic update check ON hai' : 'Automatic update check OFF hai — manual check se update karein', 'info');
      });
      try { if (window.App && App.renderUpdateStatus) App.renderUpdateStatus(); } catch (e) { /* ignore */ }
      try { if (window.App && App._refreshUpdateState) App._refreshUpdateState(); } catch (e) { /* ignore */ }
    })();
    containerEl.querySelector('#st-restore').addEventListener('click', function () {
      confirmDlg('Restore Latest Backup?', 'Sab se naya backup restore hoga. Current data ki pehle aik safety backup ban jayegi, phir data backup se replace ho jayega.').then(function (ok) {
        if (!ok) return;
        var res = { ok: false };
        try { res = DB.restoreLatestBackup ? DB.restoreLatestBackup() : { ok: false, message: 'Restore available nahi hai' }; } catch (e) { res = { ok: false, message: e && e.message ? e.message : 'Restore nahi ho saka' }; }
        if (res.ok) { notify('Backup restore ho gaya — ' + (res.at || ''), 'success'); }
        else { notify('Masla: ' + (res.message || 'Restore nahi ho saka'), 'error'); return; }
        Screens.settings(containerEl);
      });
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
          if (DB.state.settings.sessionTimeoutMinutes == null) DB.state.settings.sessionTimeoutMinutes = 15;
          try { if (DB.buildIndexes) DB.buildIndexes(); } catch (e) { /* ignore */ }
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
