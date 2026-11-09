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

1. **GitHub Actions (recommended):** push a tag like `v1.1.0`, or run the "Build Windows installer" workflow manually from the Actions tab. It runs on `windows-latest`, **publishes a GitHub Release** (installer `.exe` + `latest.yml`, so installed apps can update themselves — see "Self auto-update" below) and also uploads the `.exe` as an artifact. See `INSTALL.md` for the laptop steps.
2. **On a Windows machine:** `npm install` then `npm run build`. The installer appears in `dist/`.

`npm run pack` builds an unpacked Windows folder instead of an installer (`electron-builder --win --dir`).

## Self auto-update (no more manual reinstalls)

Once installed from v1.1.0, the app updates itself:

- On startup (after a short delay, so first paint is never blocked) it checks the project's GitHub Releases for a newer version. If one exists it downloads it in the background, shows the download progress as a notice, and when ready asks to **Restart Karein aur Update Lagayein** — one restart and the new version is installed. Data is never touched by an update.
- **Settings > Updates** shows the current version, last check, and status, with a manual **Update Check Karein** button and an auto-check toggle (default ON).

**One-time token (Owner only, because the repo is private):** GitHub Releases in a private repo cannot be downloaded without authentication, so the Owner pastes a read-only token **once** in Settings > Updates. It is a **fine-grained personal access token** with read-only access to this one repo only (Contents: Read-only), created at GitHub → photo → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token → select only `rara-pos-desktop` → Contents: Read-only. The token is stored only on that laptop (app-data folder), never in the repo or code, and can be revoked/rotated anytime on GitHub. Without a token the app still works normally — update checks just report that the token is needed.

## Theme — live video background (v1.1.1)

The app has a warm dark theme inspired by the RARA brand video: a short looping video (`assets/background.mp4`) plays live behind the whole app — login screen and all — under a dark gradient overlay, with translucent warm-brown panels, 16px rounded corners and amber-orange primary buttons (Delete/Cancel stay red, WhatsApp stays green). The RARA logo and all product photos are unchanged.

- **Dark / Light toggle** (header button) still works. The video only plays in the **Dark** theme; the Light theme is a clean warm off-white with the video hidden and paused.
- **Settings > Defaults > Live Background (video)** turns the video on/off (default ON). When OFF the video is hidden **and paused** and the app falls back to a plain dark background. The choice is saved in Settings, so it survives restarts.

## What's new in v1.1.3

- **Bill redesign:** the exact supplied black RARA logo prints at the top of every bill (and in the bill preview), followed by "Fragrance / Fashions" and the sale's own branch name + address. The receipt is now **72mm wide** (was 80mm) with a **bolder, slightly larger font**, so bills read taller. Measured-height printing from v1.1.2 is unchanged — each bill still prints exactly its own length.
- **RARA Township franchise login:** username `township`, default PIN **1234** (Owner: change it in Logins). It sees only its own branch: sell + print, own-branch stock, own sales history, and its own **franchise dashboard** — today's + all-time sales, sales by product, **profit** (revenue minus purchase cost), expenses, and stock (received / sold / returned / adjustments / current). It cannot see other branches, suppliers, purchases, logins, Settings, or change prices. Profit is shown to this login at the Owner's explicit instruction.
- Existing installs get the Township login automatically on first launch of v1.1.3 (one-time migration; if the Owner deletes it, it does not come back).

## Releasing a new version (for the developer)

1. Bump `version` in `package.json` (e.g. `1.1.0` → `1.2.0`).
2. Commit and push to `main`.
3. Run the **"Build Windows installer"** workflow from the Actions tab (or push a tag like `v1.2.0`).
4. The workflow publishes a GitHub Release with the installer and `latest.yml`. Installed apps pick it up on their next check — no manual reinstall.

## Data location

- **Windows:** `%APPDATA%\RARA POS\rara-pos-data.json`
- **First run:** if no data file exists, the app seeds itself from `src/seed.json` (the 6 RARA products, 3 branches, 10 sales and 1 open cash session exported from the Muse POS on 2026-11-06) and saves that as the data file.
- **Back up** by copying `rara-pos-data.json` somewhere safe. To start over, delete it and relaunch — the app re-seeds.

## First launch — Owner setup

There is **no default PIN**. On first launch the app asks you to create the Owner account (name + PIN). Keep the Owner PIN private: only the Owner login can see costs, profit/loss, suppliers, purchases, reports and settings, and only the Owner can change prices.

## Honest limits — read before relying on this

- **Separate system from the Muse POS. No sync.** Sales or stock changes made here do not appear in the Muse POS, and vice versa. Pick one system per outlet and stick to it.
- **PINs were not migrated — except the Township franchise login.** The Owner and staff logins from the Muse POS do not carry over. Create them again on first launch (Owner) and in Settings > Users (staff). The RARA Township franchise login (`township`, default PIN 1234) IS seeded in v1.1.3 — the Owner should change its PIN in Logins.
- **Purchase prices are 0 in the seed data.** Profit figures are overstated until the Owner enters the real purchase price for each product (Products > Edit). The seed file says this on its `_note` line.
- **Thermal printing (v1.1.2+):** the app measures each bill and prints exactly that length on the Owner-picked thermal printer (Settings > Printer). If no printer is picked, or printing fails, it falls back to the normal print dialog. Test it on the real thermal printer before relying on it — paper size and margins vary by printer driver.
- **Unsigned installer shows a SmartScreen warning.** The `.exe` is not code-signed, so Windows SmartScreen will warn on first install. See `INSTALL.md` for the safe way past it ("More info" > "Run anyway"). This is expected for an unsigned app, not a sign the file is unsafe — but only ever install the `.exe` downloaded from this project's own GitHub Actions run.
