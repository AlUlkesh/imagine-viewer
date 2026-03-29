# imagine-viewer

A local browser-based gallery for viewing media downloaded by [imagine-favorites-manager](https://github.com/AlUlkesh/imagine-favorites-manager).

---

## Features

- Scans a download folder (or any subfolder) for `*_info.json` sidecar files and displays all posts in a responsive grid
- Lazy-loads thumbnails via IntersectionObserver — handles large collections without choking the browser
- Detail panel with variant strip — click any variant chip to preview it; keyboard `←` / `→` to cycle
- Full-screen overlay for images and videos (`Space` to toggle, `Esc` to close)
- Video time syncs between normal preview and fullscreen
- Per-variant metadata: prompt, original prompt, model, resolution, video duration — with `◆ variant` badge when a variant differs from its parent post
- File path row with one-click copy buttons (filename and full path)
- Live prompt filter — searches post and all variant prompts in real time
- Native OS folder picker via a browse button (no path typing required)
- Last-used folder is persisted in `config.json` and restored on next launch
- Magic-byte MIME detection — serves files with the correct `Content-Type` regardless of file extension
- Color-coded media type badges: image / video / mixed

## Requirements

- Python 3.9+
- [conda](https://docs.conda.io/) (or any virtualenv)
- Flask (only dependency)

## Installation

### Step 1: Install Miniconda (if not already installed)

Download and run the installer for your platform from the [Miniconda site](https://www.anaconda.com/docs/getting-started/miniconda/install):

**Windows:**
```powershell
winget install Anaconda.Miniconda3
```

**macOS (Homebrew):**
```bash
brew install --cask miniconda
```

**Linux:**
```bash
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh
bash Miniconda3-latest-Linux-x86_64.sh
```

### Step 2: Clone the repository

```bash
git clone https://github.com/AlUlkesh/imagine-viewer
cd imagine-viewer
```

### Step 2: Create the environment and install dependencies

```bash
conda create -n imagineviewer python=3.12
conda activate imagineviewer
pip install -r requirements.txt
```

## Usage

```bash
conda activate imagineviewer
python app.py
```

Then open `http://127.0.0.1:5000` in your browser.

1. Type (or browse for) the path to a `grok-imagine` download folder
2. Click **Load**
3. Use the filter bar to search by prompt
4. Click any card to open the detail panel
5. Press `Space` for fullscreen, `←` / `→` to switch variants, `Esc` to close

## File Structure

| File | Purpose |
|---|---|
| `app.py` | Flask server — scans JSON sidecars, serves media, persists config, browse dialog |
| `templates/index.html` | App shell — topbar, grid, detail panel, fullscreen overlay |
| `static/app.js` | All UI logic — grid rendering, lazy hydration, detail panel, filter, fullscreen |
| `static/style.css` | Dark theme, grid layout, detail panel, variant strip, overlays |
| `static/favicon.svg` | IV monogram favicon |
| `requirements.txt` | Python dependencies (`flask`) |
| `config.json` | Persisted last-used folder path (gitignored) |

## Technical Notes

- The `/media` route validates that the requested path is absolute, exists on disk, and has an allowed extension — preventing path traversal
- MIME types are detected from magic bytes rather than file extensions, since downloaded files are occasionally misnamed
- The grid uses `IntersectionObserver` with a 300 px root margin so media only loads as cards scroll into view
- `config.json` is written on every successful Load and read on startup to restore the last folder

## Related

- [imagine-favorites-manager](https://github.com/AlUlkesh/imagine-favorites-manager) — the Chrome extension that downloads the media this viewer displays
