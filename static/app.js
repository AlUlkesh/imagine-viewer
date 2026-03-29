/* Imagine Viewer – frontend */

// ── State ─────────────────────────────────────────────────────────────────
let allPosts       = [];
let filteredPosts  = [];   // subset currently shown in the grid
let currentPostIdx = -1;   // index into filteredPosts
let currentVarIdx  = 0;
let gridObserver   = null; // IntersectionObserver for lazy card hydration

// ── DOM refs ──────────────────────────────────────────────────────────────
const dirInput     = document.getElementById('dir-input');
const loadBtn      = document.getElementById('load-btn');
const browseBtn    = document.getElementById('browse-btn');
const filterInput  = document.getElementById('filter-input');
const statusBar    = document.getElementById('status-bar');
const postGrid     = document.getElementById('post-grid');
const detailPanel  = document.getElementById('detail-panel');
const closeBtn     = document.getElementById('close-btn');
const previewCont  = document.getElementById('preview-container');
const variantStrip = document.getElementById('variant-strip');
const filePathRow  = document.getElementById('file-path-row');
const metaBlock    = document.getElementById('meta-block');
const fsOverlay    = document.getElementById('fullscreen-overlay');
const fsMedia      = document.getElementById('fs-media');
const fsClose      = document.getElementById('fs-close');

// ── Utilities ─────────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const mediaUrl = p => `/media?p=${encodeURIComponent(p)}`;

function borderColor(type) {
  if (type === 'video') return '#ff7043';
  if (type === 'image') return '#4fc3f7';
  return '#ab47bc';
}

function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

function fmtRes(r) {
  return r ? `${r.width} × ${r.height}` : '—';
}

// ── Init: load saved directory ────────────────────────────────────────────
async function init() {
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    if (cfg.mediaDir) dirInput.value = cfg.mediaDir;
  } catch { /* no config yet */ }
}

// ── Load posts ────────────────────────────────────────────────────────────
async function loadPosts() {
  const dir = dirInput.value.trim();
  if (!dir) return;

  loadBtn.disabled = true;
  statusBar.textContent = 'Loading…';
  postGrid.innerHTML = '';
  closeDetail();

  try {
    const resp = await fetch(`/api/posts?dir=${encodeURIComponent(dir)}`);
    const data = await resp.json();
    if (!resp.ok) {
      statusBar.textContent = `Error: ${data.error || resp.statusText}`;
      return;
    }
    allPosts = data;

    // Persist the directory
    fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaDir: dir })
    });

    filterInput.value = '';
    applyFilter();
  } catch (e) {
    statusBar.textContent = `Failed: ${e.message}`;
  } finally {
    loadBtn.disabled = false;
  }
}

// ── Filter ──────────────────────────────────────────────────────────────────
function applyFilter() {
  const term = filterInput.value.trim().toLowerCase();
  filteredPosts = term
    ? allPosts.filter(p => {
        if ((p.prompt         || '').toLowerCase().includes(term)) return true;
        if ((p.originalPrompt || '').toLowerCase().includes(term)) return true;
        // also search per-variant prompts
        return (p.variants || []).some(v =>
          (v.prompt         || '').toLowerCase().includes(term) ||
          (v.originalPrompt || '').toLowerCase().includes(term)
        );
      })
    : allPosts.slice();

  closeDetail();
  renderGrid();

  if (term) {
    statusBar.textContent = `${filteredPosts.length} / ${allPosts.length}`;
  } else {
    statusBar.textContent = `${allPosts.length} post${allPosts.length !== 1 ? 's' : ''}`;
  }
}

// ── Grid ──────────────────────────────────────────────────────────────────
function renderGrid() {
  // Disconnect previous observer so old card refs are released
  if (gridObserver) { gridObserver.disconnect(); gridObserver = null; }

  postGrid.innerHTML = '';

  // rootMargin: start loading 300px before the card enters the viewport
  gridObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        hydrateCard(entry.target);
        gridObserver.unobserve(entry.target);
      }
    }
  }, { root: document.getElementById('grid-container'), rootMargin: '300px', threshold: 0 });

  for (let i = 0; i < filteredPosts.length; i++) {
    const card = makeCardShell(filteredPosts[i], i);
    postGrid.appendChild(card);
    gridObserver.observe(card);
  }
}

function makeCardShell(post, idx) {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.borderColor = borderColor(post.dominantType);
  card.dataset.idx = idx;

  // Placeholder shown until media is lazy-loaded
  const ph = document.createElement('div');
  ph.className = 'card-placeholder';
  ph.innerHTML = post.dominantType === 'video'
    ? `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>`;
  card.appendChild(ph);

  // Prompt overlay (visible on hover)
  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';
  overlay.textContent = post.prompt || '(no prompt)';
  card.appendChild(overlay);

  // Type badge
  const badge = document.createElement('span');
  badge.className = `type-badge type-${post.dominantType}`;
  badge.textContent = post.dominantType;
  card.appendChild(badge);

  card.addEventListener('click', () => openDetail(idx));
  return card;
}

/**
 * Phase 2 — on-demand: inject the real media element into the card shell.
 * Called by IntersectionObserver when the card approaches the viewport.
 */
function hydrateCard(card) {
  if (card.dataset.hydrated) return;
  card.dataset.hydrated = '1';

  const idx  = parseInt(card.dataset.idx, 10);
  const post = filteredPosts[idx];
  if (!post) return;

  const thumbVariant = post.variants?.find(v => v.id === post.thumbnailVariantId);
  const ph = card.querySelector('.card-placeholder');

  if (thumbVariant?.localPath && thumbVariant.type === 'image') {
    const img = document.createElement('img');
    img.src     = mediaUrl(thumbVariant.localPath);
    img.alt     = post.prompt || '';
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
    card.insertBefore(img, ph);
    ph.remove();
  } else if (thumbVariant?.localPath && thumbVariant.type === 'video') {
    const vid = document.createElement('video');
    vid.src   = mediaUrl(thumbVariant.localPath);
    vid.muted = true;
    vid.preload = 'metadata';
    vid.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;pointer-events:none;';
    card.insertBefore(vid, ph);
    ph.remove();
  }
  // else: no local file — leave placeholder as-is
}

// ── Detail panel ──────────────────────────────────────────────────────────
function openDetail(postIdx) {
  // update selected card highlight
  const grid = document.getElementById('post-grid');
  grid.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
  const newCard = grid.querySelector(`.card[data-idx="${postIdx}"]`);
  if (newCard) newCard.classList.add('selected');

  currentPostIdx = postIdx;
  currentVarIdx  = 0;
  detailPanel.classList.remove('hidden');
  renderDetail();
}

function closeDetail() {
  document.getElementById('post-grid').querySelectorAll('.card.selected')
    .forEach(c => c.classList.remove('selected'));
  detailPanel.classList.add('hidden');
  stopVideos();
}

function renderDetail() {
  const post = filteredPosts[currentPostIdx];
  if (!post) return;
  renderVariantStrip(post);
  renderPreview(post, currentVarIdx);
  renderMeta(post, (post.variants || [])[currentVarIdx]);
}

function stopVideos() {
  previewCont.querySelectorAll('video').forEach(v => { v.pause(); v.src = ''; });
}

// ── Variant strip ─────────────────────────────────────────────────────────
function renderVariantStrip(post) {
  variantStrip.innerHTML = '';
  (post.variants || []).forEach((variant, idx) => {
    variantStrip.appendChild(makeChip(post, variant, idx));
  });
}

function makeChip(post, variant, idx) {
  const chip = document.createElement('div');
  chip.className = [
    'variant-chip',
    idx === currentVarIdx   ? 'selected' : '',
    !variant.localExists    ? 'missing'  : ''
  ].filter(Boolean).join(' ');
  chip.style.borderColor = borderColor(variant.type);
  chip.title = variant.localExists
    ? `${variant.type} · variant ${idx + 1}${variant.prompt && variant.prompt !== post.prompt ? ' · ' + variant.prompt : ''}`
    : `not downloaded · ${variant.type} · variant ${idx + 1}`;

  if (variant.type === 'image' && variant.localPath) {
    const img = document.createElement('img');
    img.src = mediaUrl(variant.localPath);
    img.alt = `variant ${idx + 1}`;
    chip.appendChild(img);
  } else if (variant.type === 'video' && variant.localPath) {
    // Use a silent video so the browser renders the first frame as a thumbnail
    const vid = document.createElement('video');
    vid.src     = mediaUrl(variant.localPath);
    vid.muted   = true;
    vid.preload = 'metadata';
    vid.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;display:block;pointer-events:none;';
    chip.appendChild(vid);
  } else {
    // File not downloaded — show a type placeholder icon
    const icon = document.createElement('div');
    icon.className = 'chip-icon';
    icon.innerHTML = variant.type === 'video'
      ? `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>`;
    chip.appendChild(icon);
  }

  // Small index label at the bottom of the chip
  const label = document.createElement('span');
  label.className = 'chip-label';
  label.textContent = idx + 1;
  chip.appendChild(label);

  if (variant.localExists) {
    chip.addEventListener('click', () => {
      currentVarIdx = idx;
      renderVariantStrip(post);
      renderPreview(post, idx);
      renderMeta(post, variant);
    });
  }

  return chip;
}

// ── Large preview ─────────────────────────────────────────────────────────
function renderPreview(post, varIdx) {
  stopVideos();
  previewCont.innerHTML = '';

  const variant = (post.variants || [])[varIdx];
  if (!variant || !variant.localExists || !variant.localPath) {
    const msg = document.createElement('p');
    msg.className   = 'no-preview';
    msg.textContent = 'File not downloaded';
    previewCont.appendChild(msg);
    renderMediaFileRow(null);
    return;
  }

  if (variant.type === 'video') {
    const video = document.createElement('video');
    video.src      = mediaUrl(variant.localPath);
    video.controls = true;
    video.autoplay = true;
    video.loop     = true;
    video.className = 'preview-media';
    previewCont.appendChild(video);
  } else {
    const img = document.createElement('img');
    img.src       = mediaUrl(variant.localPath);
    img.alt       = post.prompt || '';
    img.className = 'preview-media';
    previewCont.appendChild(img);
  }

  renderMediaFileRow(variant);
}

// ── Media file path row ──────────────────────────────────────────────────
function renderMediaFileRow(variant) {
  filePathRow.innerHTML = '';
  if (!variant?.localPath) return;

  const filename = variant.localPath.replace(/.*[\\/]/, '');
  const fullPath = variant.localPath;

  filePathRow.className = 'meta-row meta-file-row';

  const lbl = document.createElement('span');
  lbl.className   = 'meta-label';
  lbl.textContent = 'File';

  const valWrap = document.createElement('span');
  valWrap.className = 'meta-value meta-file-val';

  const fname = document.createElement('span');
  fname.className   = 'meta-id meta-filename';
  fname.textContent = filename;
  fname.title       = fullPath;
  valWrap.appendChild(fname);

  const btnWrap = document.createElement('span');
  btnWrap.className = 'copy-btns';

  const btnName = document.createElement('button');
  btnName.className = 'copy-btn';
  btnName.title     = 'Copy filename';
  btnName.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg>`;
  btnName.addEventListener('click', () => copyText(filename, btnName));
  btnWrap.appendChild(btnName);

  const btnPath = document.createElement('button');
  btnPath.className = 'copy-btn';
  btnPath.title     = 'Copy full path';
  btnPath.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>`;
  btnPath.addEventListener('click', () => copyText(fullPath, btnPath));
  btnWrap.appendChild(btnPath);

  valWrap.appendChild(btnWrap);
  filePathRow.appendChild(lbl);
  filePathRow.appendChild(valWrap);
}

// ── Clipboard helper ────────────────────────────────────────────────────
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M9 16.2l-3.5-3.5-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>`;
    btn.classList.add('copy-ok');
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copy-ok'); }, 1200);
  });
}

// ── Metadata block ────────────────────────────────────────────────────────
// Variant fields take priority over parent post fields when present.
function renderMeta(post, variant) {
  metaBlock.innerHTML = '';

  // resolve: prefer variant value, fall back to post value
  const v = variant || {};
  const prompt        = v.prompt         || post.prompt         || '';
  const origPrompt    = v.originalPrompt || post.originalPrompt || '';
  const modelName     = v.modelName      || post.modelName      || '';
  const resolution    = v.resolution     || post.resolution     || null;
  const videoDuration = (v.videoDuration != null) ? v.videoDuration : (post.videoDuration ?? null);

  // flag when a variant field actually differs from the parent
  const variantPrompt = v.prompt    && v.prompt    !== post.prompt;
  const variantModel  = v.modelName && v.modelName !== post.modelName;

  const rows = [
    ['Prompt',
      esc(prompt || '—') + (variantPrompt ? ' <span class="badge-variant" title="Variant-specific prompt">◆ variant</span>' : '')],
    ...(origPrompt && origPrompt !== prompt
          ? [['Original prompt', esc(origPrompt)]] : []),
    ['Created',     esc(fmtDate(post.createTime))],
    ['Model',
      esc(modelName || '—') + (variantModel ? ' <span class="badge-variant" title="Variant-specific model">◆ variant</span>' : '')],
    ['Resolution',  esc(fmtRes(resolution))],
    ...(post.mode            ? [['Mode',     esc(post.mode)]]                        : []),
    ...(post.rRated          ? [['Rating',   '<span class="badge-r">R‑Rated</span>']] : []),
    ...(videoDuration        ? [['Duration', esc(`${videoDuration}s`)]]              : []),
    ['Type',        esc(post.dominantType)],
    ['Variants',    esc(String(post.variants?.length ?? 0))],
    ['Post ID',     `<span class="meta-id">${esc(post.id || '—')}</span>`],
  ];

  metaBlock.insertAdjacentHTML('beforeend', rows
    .map(([label, value]) =>
      `<div class="meta-row">
        <span class="meta-label">${label}</span>
        <span class="meta-value">${value}</span>
      </div>`
    )
    .join('')
  );
}

// ── Fullscreen overlay ────────────────────────────────────────────────────
function openFullscreen() {
  const post = filteredPosts[currentPostIdx];
  const variant = (post?.variants || [])[currentVarIdx];
  if (!variant?.localExists || !variant?.localPath) return;

  // Pause the preview player while fullscreen is open
  const previewVid = previewCont.querySelector('video');
  if (previewVid) previewVid.pause();

  fsMedia.innerHTML = '';
  if (variant.type === 'video') {
    const previewVid = previewCont.querySelector('video');
    const vid = document.createElement('video');
    vid.src      = mediaUrl(variant.localPath);
    vid.controls = true;
    vid.loop     = true;
    vid.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
    // Sync position from the preview player, then play
    vid.addEventListener('loadedmetadata', () => {
      if (previewVid && previewVid.currentTime > 0) {
        vid.currentTime = previewVid.currentTime;
      }
      vid.play();
    }, { once: true });
    fsMedia.appendChild(vid);
  } else {
    const img = document.createElement('img');
    img.src   = mediaUrl(variant.localPath);
    img.alt   = post.prompt || '';
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
    fsMedia.appendChild(img);
  }
  fsOverlay.classList.remove('hidden');
}

function closeFullscreen() {
  // Sync position back to the preview player before tearing down
  const fsVid      = fsMedia.querySelector('video');
  const previewVid = previewCont.querySelector('video');
  if (fsVid && previewVid) {
    previewVid.currentTime = fsVid.currentTime;
  }
  fsOverlay.classList.add('hidden');
  if (fsVid) { fsVid.pause(); fsVid.src = ''; }
  fsMedia.innerHTML = '';
  // Resume the preview player from the synced position
  if (previewVid) previewVid.play();
}

fsClose.addEventListener('click', closeFullscreen);
fsOverlay.addEventListener('click', e => { if (e.target === fsOverlay) closeFullscreen(); });

// ── Keyboard navigation ───────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (detailPanel.classList.contains('hidden')) return;

  const post     = filteredPosts[currentPostIdx];
  const variants = post?.variants || [];

  if (e.key === 'Escape') {
    if (!fsOverlay.classList.contains('hidden')) { closeFullscreen(); return; }
    closeDetail();
    return;
  }

  if (e.key === ' ') {
    e.preventDefault();
    if (!fsOverlay.classList.contains('hidden')) { closeFullscreen(); return; }
    openFullscreen();
    return;
  }

  // Only cycle through variants whose file exists locally
  const available = variants
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v.localExists);
  const curPos = available.findIndex(({ i }) => i === currentVarIdx);

  if (e.key === 'ArrowRight' && curPos < available.length - 1) {
    e.preventDefault();
    currentVarIdx = available[curPos + 1].i;
    renderVariantStrip(post);
    renderPreview(post, currentVarIdx);
    renderMeta(post, (post.variants || [])[currentVarIdx]);
  } else if (e.key === 'ArrowLeft' && curPos > 0) {
    e.preventDefault();
    currentVarIdx = available[curPos - 1].i;
    renderVariantStrip(post);
    renderPreview(post, currentVarIdx);
    renderMeta(post, (post.variants || [])[currentVarIdx]);
  }
});

// ── Event listeners ───────────────────────────────────────────────────────
loadBtn.addEventListener('click', loadPosts);
dirInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadPosts(); });
closeBtn.addEventListener('click', closeDetail);
filterInput.addEventListener('input', applyFilter);
browseBtn.addEventListener('click', async () => {
  browseBtn.disabled = true;
  try {
    const res  = await fetch('/api/browse').then(r => r.json());
    if (res.path) {
      dirInput.value = res.path;
      loadPosts();
    }
  } finally {
    browseBtn.disabled = false;
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────
init();
