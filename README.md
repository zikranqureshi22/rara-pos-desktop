# RARA POS — Desktop App

Standalone offline point-of-sale and inventory app for **RARA Perfumes & Fashion** outlets. Runs on the shop laptop (Windows), works with no internet, and keeps all data on the machine itself.

## Stack

- **Electron** — desktop shell (the app is a local web UI inside Electron).
- **Local JSON store** — all data (products, branches, sales, stock, users, settings) lives in one file, `rara-pos-data.json`, in the app's userData folder. No server, no cloud, no sync.
- No remote content is ever loaded; the window only opens the bundled local `index.html`.

## Run it (development)

```bash
npm install
npm start
```

## Build the Windows installer

The NSIS installer (`.exe`) **cannot be built on Linux** — electron-builder needs Windows to produce it. Two routes:

1. **GitHub Actions (recommended):** push a tag like `v1.0.0`, or run the "Build Windows installer" workflow manually from the Actions tab. It runs on `windows-latest` and uploads the `.exe` as an artifact. See `INSTALL.md` for the laptop steps.
2. **On a Windows machine:** `npm install` then `npm run build`. The installer appears in `dist/`.

`npm run pack` builds an unpacked Windows folder instead of an installer (`electron-builder --win --dir`).

## Data location

- **Windows:** `%APPDATA%\RARA POS\rara-pos-data.json`
- **First run:** if no data file exists, the app seeds itself from `src/seed.json` (the 6 RARA products, 3 branches, 10 sales and 1 open cash session exported from the Muse POS on 2026-11-06) and saves that as the data file.
- **Back up** by copying `rara-pos-data.json` somewhere safe. To start over, delete it and relaunch — the app re-seeds.

## First launch — Owner setup

There is **no default PIN**. On first launch the app asks you to create the Owner account (name + PIN). Keep the Owner PIN private: only the Owner login can see costs, profit/loss, suppliers, purchases, reports and settings, and only the Owner can change prices.

## Honest limits — read before relying on this

- **Separate system from the Muse POS. No sync.** Sales or stock changes made here do not appear in the Muse POS, and vice versa. Pick one system per outlet and stick to it.
- **PINs were not migrated.** The Owner and staff logins from the Muse POS do not carry over. Create them again on first launch (Owner) and in Settings > Users (staff).
- **Purchase prices are 0 in the seed data.** Profit figures are overstated until the Owner enters the real purchase price for each product (Products > Edit). The seed file says this on its `_note` line.
- **Thermal printing uses browser print CSS.** The 80mm bill is printed through the normal print dialog. Test it on the real thermal printer before relying on it — paper size and margins vary by printer driver.
- **Unsigned installer shows a SmartScreen warning.** The `.exe` is not code-signed, so Windows SmartScreen will warn on first install. See `INSTALL.md` for the safe way past it ("More info" > "Run anyway"). This is expected for an unsigned app, not a sign the file is unsafe — but only ever install the `.exe` downloaded from this project's own GitHub Actions run.
