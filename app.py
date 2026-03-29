"""
Imagine Viewer - Flask server
Serves a browser-based gallery for Grok Imagine downloaded media.
"""

import json
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_file

app = Flask(__name__)

CONFIG_FILE = Path(__file__).parent / "config.json"
ALLOWED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".gif"}


# ── Config persistence ────────────────────────────────────────────────────────

def load_config() -> dict:
    if CONFIG_FILE.exists():
        with CONFIG_FILE.open(encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_config(data: dict) -> None:
    with CONFIG_FILE.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


# ── Post enrichment ───────────────────────────────────────────────────────────

def _enrich_post(post: dict, json_dir: Path) -> dict:
    """Resolve local file paths and compute derived fields for a post."""
    variants = post.get("variants", [])

    for variant in variants:
        vid = variant.get("id", "")
        if variant.get("type") == "video":
            candidates = [f"{vid}.mp4", f"{vid}.mov"]
        else:
            candidates = [f"{vid}.jpg", f"{vid}.jpeg", f"{vid}.png", f"{vid}.webp"]

        local = next((json_dir / name for name in candidates if (json_dir / name).is_file()), None)
        variant["localExists"] = local is not None
        variant["localPath"] = str(local) if local else None

        if local is None:
            searched = ", ".join(str(json_dir / name) for name in candidates)
            app.logger.warning(
                "[enrich] variant not found — post=%s  variant=%s  searched=[%s]",
                post.get("id", "?"), vid, searched
            )

    # Dominant type: all-video / all-image / mixed
    types = {v.get("type") for v in variants if v.get("type")}
    if types == {"video"}:
        post["dominantType"] = "video"
    elif types == {"image"}:
        post["dominantType"] = "image"
    else:
        post["dominantType"] = "mixed"

    # Best thumbnail: first image variant that exists locally, else first local variant
    post["thumbnailVariantId"] = next(
        (v["id"] for v in variants if v.get("type") == "image" and v.get("localExists")),
        next((v["id"] for v in variants if v.get("localExists")), None),
    )

    return post


def _attach_json_path(post: dict, json_file: Path) -> dict:
    post["jsonFile"] = json_file.name
    post["jsonPath"] = str(json_file)
    return post


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/browse")
def api_browse():
    """Open a native OS folder-picker dialog and return the chosen path."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()          # hide the root window
        root.wm_attributes("-topmost", True)  # dialog appears on top
        chosen = filedialog.askdirectory(title="Select download folder")
        root.destroy()
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500
    if not chosen:
        return jsonify({"cancelled": True})
    return jsonify({"path": chosen})


@app.route("/api/config", methods=["GET"])
def get_config():
    return jsonify(load_config())


@app.route("/api/config", methods=["POST"])
def set_config():
    cfg = load_config()
    cfg.update(request.get_json(force=True) or {})
    save_config(cfg)
    return jsonify({"ok": True})


@app.route("/api/posts")
def api_posts():
    dir_path = request.args.get("dir", "").strip()
    if not dir_path:
        return jsonify({"error": "dir parameter required"}), 400

    scan_dir = Path(dir_path)
    if not scan_dir.is_dir():
        return jsonify({"error": f"Directory not found: {dir_path}"}), 404

    posts = []
    for json_file in scan_dir.rglob("*_info.json"):
        try:
            with json_file.open(encoding="utf-8") as f:
                post = json.load(f)
            _enrich_post(post, json_file.parent)
            _attach_json_path(post, json_file)
            posts.append(post)
        except Exception as exc:
            app.logger.warning("Skipping %s: %s", json_file, exc)

    # Newest first
    posts.sort(key=lambda p: p.get("createTime", ""), reverse=True)
    return jsonify(posts)


# Magic-byte signatures → MIME type
_MAGIC: list[tuple[bytes, str]] = [
    (b'\xff\xd8\xff',           'image/jpeg'),
    (b'\x89PNG\r\n\x1a\n',     'image/png'),
    (b'RIFF',                   'image/webp'),   # checked further below
    (b'GIF87a',                 'image/gif'),
    (b'GIF89a',                 'image/gif'),
    (b'\x00\x00\x00',          'video/mp4'),    # ftyp box — refined below
]

def _detect_mime(path: Path) -> str:
    """Return the correct MIME type by inspecting the file's magic bytes."""
    with path.open('rb') as f:
        header = f.read(12)

    if header[:3] == b'\xff\xd8\xff':
        return 'image/jpeg'
    if header[:8] == b'\x89PNG\r\n\x1a\n':
        return 'image/png'
    if header[:4] == b'RIFF' and header[8:12] == b'WEBP':
        return 'image/webp'
    if header[:6] in (b'GIF87a', b'GIF89a'):
        return 'image/gif'
    # MP4/MOV: ftyp box is at bytes 4-8
    if header[4:8] in (b'ftyp', b'moov', b'free', b'mdat', b'wide'):
        return 'video/mp4'

    # Fall back to extension-based guess
    return {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png',  '.webp': 'image/webp',
        '.gif': 'image/gif',  '.mp4': 'video/mp4',
        '.mov': 'video/mp4',
    }.get(path.suffix.lower(), 'application/octet-stream')


@app.route("/media")
def serve_media():
    """Serve a local media file by its absolute path passed as ?p=<path>."""
    raw = request.args.get("p", "").strip()
    if not raw:
        abort(400)

    path = Path(raw)
    if not path.is_absolute():
        abort(403)
    if not path.is_file():
        abort(404)
    if path.suffix.lower() not in ALLOWED_SUFFIXES:
        abort(403)

    return send_file(str(path), mimetype=_detect_mime(path))


if __name__ == "__main__":
    app.run(debug=True, port=5000)
