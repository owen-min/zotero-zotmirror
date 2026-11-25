# ZotMirror (`zotero-zotmirror`)

[中文说明](README.zh-CN.md)

A **Zotero 7–10** plugin that mirrors your Zotero collections in Google Drive using native **ZotMirror** (`application/vnd.google-apps.shortcut`)—without changing your existing `AUTH/<Author>/<Filename>.pdf` folder layout or duplicating PDF storage. This lets you select an entire Zotero collection directly from Google Drive in **Gemini** or **NotebookLM (Gemini Notebook)** for batch literature analysis.

## Features

* **Zotero 7–10 Support**: Native bootstrapped plugin architecture using Zotero 8–10's `Zotero.MenuManager` (with Fluent English/Chinese localization) and automatic DOM fallback on Zotero 7.

* **Zero Duplicate Storage**: Creates lightweight Google Drive shortcuts pointing to your original PDFs instead of copying files.

* **Shared with Me & Shared Drives Ready**: All Drive API queries enable `supportsAllDrives=true&includeItemsFromAllDrives=true`, so source folders under `Shared with me` (e.g., `sharedwithme/Library/AUTH`) work out of the box.

* **Strict Two-Level Path Matching**: Extracts the last two path segments (`<AuthorFolder>/<Filename>.pdf`) from each linked PDF attachment and matches directly under your configured `AUTH` folder (no root fallback).

* **Configurable Sync Options**:

  * Include subcollections

  * Flatten subcollections into a single folder (or preserve nested hierarchy)

  * Strict mirror mode (moves stale shortcuts for removed items to Google Drive Trash, keeping them recoverable)

* **Two Selectable Backends**:

  * **Mode A (Recommended)**: Personal Google Apps Script (GAS) Web App—1-minute setup, no Google Cloud OAuth configuration required.

  * **Mode B**: Direct Google Drive REST API v3 via OAuth 2.0 desktop loopback authorization—no public web endpoint.

## Project Structure

```
zotero-zotmirror/
├── src/                        # Zotero plugin source
│   ├── manifest.json           # Zotero 7-10 manifest (applications + browser_specific_settings)
│   ├── bootstrap.js            # Lifecycle hooks, preference pane & context menu registration
│   ├── prefs.js                # Default preferences
│   ├── content/
│   │   ├── sync.js             # Core engine (ID parsing, path extraction, GAS & OAuth2 sync)
│   │   ├── prefs.xhtml         # Settings pane UI
│   │   └── prefs.js            # Settings pane logic & DOM auto-binding
│   ├── locale/
│   │   ├── en-US/zotmirror.ftl
│   │   └── zh-CN/zotmirror.ftl
│   └── icons/
│       ├── icon-48.png
│       └── icon-96.png
├── gas/                        # Mode A Google Apps Script backend
│   ├── Code.gs                 # Web App script (with write-scope trigger & optional folder whitelist)
│   └── appsscript.json         # GAS manifest declaring explicit Drive & external request scopes
├── scripts/
│   └── build_xpi.py            # Zero-dependency cross-platform XPI builder
├── tests/
│   └── sync.test.mjs           # Unit tests for core parsing & collection planning
├── build/
│   └── zotmirror-1.0.0.xpi  # Pre-built installable package
├── package.json
├── LICENSE
└── README.md

```

## Installation

1. Copy `build/zotmirror-1.0.0.xpi` to a local folder on your computer.

2. In Zotero 7–10, go to **Tools → Plugins**, click the gear icon, choose **Install Plugin From File…**, and select the `.xpi` file.

3. Open **Edit → Settings → ZotMirror** (macOS: **Zotero → Settings → ZotMirror**) to configure your folders and backend.

## Configuration

### 1. Getting Google Drive Folder URLs / IDs

Open Google Drive in your browser and navigate into your source `AUTH` folder (including folders inside **Shared with me**) and your target output root folder (e.g., `Zotero_By_Collection`). Copy the full browser URL (such as `https://drive.google.com/drive/folders/1AbCdEf...`) and paste it directly into the plugin settings—the plugin automatically extracts and previews the Folder ID.

### 2. Mode A: Google Apps Script Web App (Recommended)

1. Go to [script.google.com](https://script.google.com/), create a new project, and paste the contents of `gas/Code.gs`.

2. Change `SECRET_TOKEN` to a strong random string (32+ characters). For extra security, also set `ALLOWED_SOURCE_ROOT_ID` and `ALLOWED_TARGET_ROOT_ID` to lock the script to only your two folders.

3. Save the script, select `_ensureDriveScope_` in the top function selector, and click **Run** once to grant Google Drive read/write permissions.

4. Click **Deploy → New deployment → Web app**:

   * **Execute as**: `Me`

   * **Who has access**: `Anyone` (requests are gated by `SECRET_TOKEN` and your optional folder whitelist)

5. Copy the resulting `/exec` Web App URL and your `SECRET_TOKEN` into Zotero Settings, then click **Test Connection**.

> Note: Whenever you edit `Code.gs`, apply changes via **Deploy → Manage deployments → Edit (pencil icon) → Version: New version → Deploy** so your `/exec` URL stays unchanged.

### 3. Mode B: Direct Google Drive API v3 (OAuth 2.0)

1. Enable the **Google Drive API** in Google Cloud Console.

2. On the **OAuth consent screen**, keep the publishing status in **Testing** and add your own Google account under **Test users**.

3. Under **Credentials**, create an OAuth Client ID of type **Desktop app**.

4. Switch the plugin to **Mode B**, paste your `Client ID` and `Client Secret`, click **Authorize in Browser** (the plugin opens a temporary `127.0.0.1` loopback callback and saves the `Refresh Token` automatically), and click **Test Connection**.

## Usage

* **Right-click menu**: In Zotero's left pane, right-click any collection and choose **ZotMirror: Sync Collection to Google Drive**.

* **Settings pane**: You can also trigger sync for the currently selected collection directly from the bottom of **Settings → ZotMirror**.

* A progress window reports created, skipped, trashed, and unmatched counts. Any unmatched `<AuthorFolder>/<Filename>.pdf` paths are logged under **Help → Debug Output Logging** (search for `ZotMirror`).

## Development & Building from Source

No external npm dependencies are required—only Node.js and Python 3:

```
# Run unit tests
npm test

# Rebuild .xpi from src/ into build/
npm run build

```

## License

MIT