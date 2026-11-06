# Install RARA POS on the laptop

Step-by-step for the user's Windows laptop. No technical knowledge needed beyond these steps.

## 1. Download the installer

1. Open the project's GitHub page in a browser.
2. Go to the **Actions** tab.
3. Open the latest successful run of **"Build Windows installer"**.
4. Under **Artifacts**, download **rara-pos-windows-installer**.
5. Unzip the downloaded file. Inside is one file: `RARA POS Setup 1.0.0.exe` (the version number may differ).

> Only ever install the `.exe` from this project's own GitHub Actions run. Do not install a copy sent from anywhere else.

## 2. Install

1. Double-click the `.exe`.
2. **SmartScreen warning:** Windows will say "Windows protected your PC" because the installer is not code-signed. This is expected. Click **"More info"**, then **"Run anyway"**.
3. If Windows asks "Do you want to allow this app to make changes?", click **Yes**.
4. Choose the install folder if you want a different one (the default is fine), then click **Install**.
5. Click **Finish** when it is done.

The installer creates a **RARA POS** shortcut on the Desktop and in the Start Menu.

## 3. First launch — set up the Owner

1. Launch **RARA POS** from the Desktop or Start Menu.
2. On first launch there is no PIN yet. The app asks you to create the **Owner** account: enter the Owner's name and choose a PIN.
3. **Write the PIN down somewhere safe.** There is no "forgot PIN" reset — if it is lost, the data file has to be handled manually.
4. Only the Owner login can see costs, profit/loss, suppliers, purchases, reports and settings, and only the Owner can change prices. Staff logins are created later in Settings > Users.

## 4. Enter the real purchase prices

The app ships with the 6 RARA products and their selling prices already loaded, but **purchase prices are 0** until you enter them — profit figures will look too high until then.

1. Log in as Owner.
2. Go to **Products**, open **Edit** on each product, and enter its real purchase price.
3. Save each one.

## 5. Daily use

- Open RARA POS, log in with your PIN, sell as normal.
- Stock decreases on each sale; low-stock warnings appear at 10 units or fewer.
- **Back up your data:** copy `%APPDATA%\RARA POS\rara-pos-data.json` to a USB stick or another safe place from time to time. If the laptop is lost or reset, that file is the whole shop record.

## 6. Khud update — dobara install nahi karna parega

Version 1.1.0 se app khud update ho jata hai. Pehli dafa sirf ek token dalna hai (Owner):

**Token banayein (sirf ek dafa):**
1. GitHub kholein aur login karein.
2. Upar right corner me apni photo → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
3. Sirf **`rara-pos-desktop`** repo select karein (kisi aur repo ko nahi).
4. Permissions me **Contents: Read-only** dein, baaki kuch nahi.
5. Token banayein — ye sirf ek dafa dikhega, is liye foran copy karein.

**Token app me dalein:**
1. RARA POS me Owner login karein → **Settings** → **Updates**.
2. Token wale box me token dalein → **Token Save Karein**.
3. Bas — ab app khud update check karega. Token sirf is laptop par save hota hai, kahin aur nahi jata. GitHub se token kabhi bhi revoke/rotate kar sakte hain.

**Update kaise lagta hai:** naya version aane par app khud download karta hai (progress notice dikhega), phir **"Restart Karein aur Update Lagayein"** ka notice aayega — ek restart aur naya version lag jayega. Aapka data (products, sales, stock) update se kabhi nahi badalta. Agar token na dala ho to app normal chalega, bas update check par token mangega.

## If something goes wrong

- **App won't open:** restart the laptop and try again. If it still won't open, reinstall from the same `.exe` — reinstalling does not delete your data file.
- **Bill prints wrong:** the bill prints through the normal Windows print dialog. Check the printer is set to 80mm paper in its driver settings and try again.
- **Wrong data / want a fresh start:** close the app, delete `%APPDATA%\RARA POS\rara-pos-data.json`, and relaunch — the app re-seeds the original products, branches and sales.
