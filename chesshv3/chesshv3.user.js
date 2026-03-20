// ==UserScript==
// @name         ChessHv3
// @namespace    https://nguyenphanvn95.github.io/chesshv3/
// @version      9.9
// @description  Chess Helper v3 — floating panel with engine analysis, arrows, auto-move
// @author       ChessHv3
// @match        https://www.chess.com/*
// @match        https://chess.com/*
// @match        https://lichess.org/*
// @match        https://worldchess.com/*
// @require      https://nguyenphanvn95.github.io/chesshv3/alert.js
// @require      https://nguyenphanvn95.github.io/chesshv3/a.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ============================================================
     CONFIG HELPERS  (replaces chrome.storage)
  ============================================================ */
  const defaultConfig = {
    elo: 3500, lines: 5,
    colors: ['#0000ff', '#00ff00', '#FFFF00', '#f97316', '#ff0000'],
    depth: 10, delay: 100, style: 'Default',
    autoMove: false, moveClassification: false, stat: false,
    winningMove: false, showEval: false, onlyShowEval: false, key: ' ',
  };

  function loadConfig() {
    try { return Object.assign({}, defaultConfig, JSON.parse(GM_getValue('chessConfig', '{}')));
    } catch { return { ...defaultConfig }; }
  }
  function saveConfig(cfg) { GM_setValue('chessConfig', JSON.stringify(cfg)); }

  let config = loadConfig();

  /* ============================================================
     INJECT REMOTE SCRIPTS  (engine files hosted on GitHub Pages)
     Switched to @require so CSP on lichess.org không chặn tải từ script tag.
  ============================================================ */
  // @require đã load alert.js và a.js trước khi chạy script này.

  /* ============================================================
     STYLES  (panel + minimize icon)
  ============================================================ */
  GM_addStyle(`
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@400;500;600;700&display=swap');

:root {
  --chv-olive:       #4a7c1f;
  --chv-olive-mid:   #5a8a30;
  --chv-olive-dark:  #3a5e1e;
  --chv-olive-glow:  rgba(74,124,31,0.15);
  --chv-olive-border:rgba(74,124,31,0.30);
  --chv-bg-deep:     #f4f1ec;
  --chv-bg-panel:    #faf8f5;
  --chv-bg-card:     #ffffff;
  --chv-bg-hover:    #eeeae3;
  --chv-border-soft: rgba(74,124,31,0.12);
  --chv-border-strong:rgba(74,124,31,0.28);
  --chv-text-main:   #2e2a24;
  --chv-text-soft:   #7a7060;
  --chv-text-dim:    #b0a898;
  --chv-font-mono:   'Space Mono', monospace;
  --chv-font-body:   'DM Sans', sans-serif;
}

/* ── FLOATING ICON (minimized state) ── */
#chesshv3-icon {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--chv-olive);
  box-shadow: 0 4px 18px rgba(74,124,31,0.45), 0 0 0 3px rgba(74,124,31,0.18);
  cursor: pointer;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s, box-shadow 0.2s;
  user-select: none;
}
#chesshv3-icon:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(74,124,31,0.55); }
#chesshv3-icon svg { width: 28px; height: 28px; fill: #fff; }

/* ── FLOATING PANEL ── */
#chesshv3-panel {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 380px;
  max-height: 90vh;
  background: var(--chv-bg-panel);
  border-radius: 16px;
  border: 1px solid var(--chv-border-soft);
  box-shadow: 0 8px 40px rgba(0,0,0,0.18), 0 0 0 1px rgba(74,124,31,0.06) inset;
  z-index: 2147483647;
  display: flex;
  flex-direction: column;
  font-family: var(--chv-font-body);
  color: var(--chv-text-main);
  overflow: hidden;
  resize: both;
  min-width: 300px;
  min-height: 200px;
}

/* ── PANEL HEADER (drag handle) ── */
#chesshv3-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 10px;
  background: var(--chv-olive);
  cursor: grab;
  user-select: none;
  flex-shrink: 0;
  border-radius: 15px 15px 0 0;
}
#chesshv3-header:active { cursor: grabbing; }
#chesshv3-header-title {
  font-family: var(--chv-font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2.5px;
  text-transform: uppercase;
  color: #fff;
}
#chesshv3-header-btns { display: flex; gap: 6px; }
.chesshv3-hbtn {
  width: 26px; height: 26px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.25);
  background: rgba(255,255,255,0.12);
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background 0.15s;
}
.chesshv3-hbtn:hover { background: rgba(255,255,255,0.26); }

/* ── TABS ── */
#chesshv3-tabs {
  display: flex;
  gap: 1px;
  padding: 10px 12px 0;
  border-bottom: 1px solid var(--chv-border-soft);
  background: var(--chv-bg-deep);
  flex-shrink: 0;
}
.chesshv3-tab {
  padding: 7px 14px;
  cursor: pointer;
  font-family: var(--chv-font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--chv-text-soft);
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  transition: all 0.15s;
  user-select: none;
}
.chesshv3-tab:hover { color: var(--chv-text-main); background: var(--chv-bg-hover); }
.chesshv3-tab.active { color: #fff; background: var(--chv-olive); border-color: var(--chv-olive-mid); }

/* ── PANEL BODY ── */
#chesshv3-body {
  overflow-y: auto;
  flex: 1;
  padding: 0;
  background: var(--chv-bg-panel);
  scrollbar-width: thin;
  scrollbar-color: var(--chv-olive-border) transparent;
}

/* ── PANEL SECTIONS ── */
.chesshv3-section { display: none; padding: 16px; }
.chesshv3-section.active { display: block; animation: chv-fadeup 0.2s ease; }

@keyframes chv-fadeup {
  from { opacity:0; transform:translateY(6px); }
  to   { opacity:1; transform:translateY(0); }
}

/* ── SETTING ROWS ── */
.chv-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 5px;
  padding: 10px 14px;
  background: var(--chv-bg-card);
  border-radius: 8px;
  border: 1px solid var(--chv-border-soft);
  transition: border-color 0.15s, background 0.15s;
  position: relative;
  overflow: hidden;
}
.chv-setting::before {
  content: ''; position: absolute; left:0; top:0; bottom:0; width:3px;
  background: linear-gradient(to bottom, var(--chv-olive), #5a5248);
  opacity: 0; transition: opacity 0.15s; border-radius: 2px 0 0 2px;
}
.chv-setting:hover { border-color: var(--chv-border-strong); background: var(--chv-bg-hover); }
.chv-setting:hover::before { opacity: 1; }
.chv-setting label, .chv-setting > span {
  font-size: 12px; color: var(--chv-text-main); white-space: nowrap;
}

.chv-help {
  font-size: 10px; color: var(--chv-text-dim);
  padding: 2px 14px 8px; font-family: var(--chv-font-mono);
  line-height: 1.5; letter-spacing: 0.3px;
}

/* ── RANGE INPUTS ── */
.chv-setting input[type=range] {
  width: 120px; accent-color: var(--chv-olive);
  cursor: pointer; flex-shrink: 0;
}

/* ── SELECT ── */
.chv-setting select {
  font-family: var(--chv-font-mono);
  font-size: 10px;
  padding: 5px 8px;
  border: 1px solid var(--chv-border-strong);
  border-radius: 6px;
  background: var(--chv-bg-card);
  color: var(--chv-text-main);
  cursor: pointer;
  outline: none;
  flex-shrink: 0;
}
.chv-setting select:focus { border-color: var(--chv-olive); }

/* ── TOGGLE SWITCH ── */
.chv-toggle { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
.chv-toggle input { opacity:0; width:0; height:0; }
.chv-slider {
  position: absolute; cursor: pointer;
  top:0; left:0; right:0; bottom:0;
  background: #d0c8be; border-radius: 24px;
  transition: background 0.2s;
}
.chv-slider::before {
  content: ''; position: absolute;
  width: 18px; height: 18px; left: 3px; bottom: 3px;
  background: #fff; border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0,0,0,0.18);
  transition: transform 0.2s;
}
.chv-toggle input:checked + .chv-slider { background: var(--chv-olive); }
.chv-toggle input:checked + .chv-slider::before { transform: translateX(20px); }

/* ── COLOR ROW ── */
.chv-color-row { display: flex; gap: 8px; flex-wrap: wrap; }
.chv-color-item { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.chv-color-item input[type=color] { width: 36px; height: 36px; border: none; border-radius: 6px; cursor: pointer; background: none; padding: 2px; }
.chv-color-item span { font-family: var(--chv-font-mono); font-size: 9px; color: var(--chv-text-dim); letter-spacing: 0.5px; }

/* ── SECTION TITLE ── */
.chv-sec-title {
  font-family: var(--chv-font-mono); font-size: 10px; font-weight: 700;
  letter-spacing: 2px; text-transform: uppercase;
  color: var(--chv-text-soft); margin: 0 0 10px;
  padding-bottom: 6px; border-bottom: 1px solid var(--chv-border-soft);
}

/* ── LOAD/EXPORT ── */
.chv-textarea {
  width: 100%; min-height: 120px;
  font-family: var(--chv-font-mono); font-size: 10px;
  padding: 10px; border: 1px solid var(--chv-border-strong);
  border-radius: 8px; background: var(--chv-bg-card);
  color: var(--chv-text-main); resize: vertical; outline: none;
  transition: border-color 0.15s;
}
.chv-textarea:focus { border-color: var(--chv-olive); }
.chv-hint { font-family: var(--chv-font-mono); font-size: 10px; color: var(--chv-text-dim); margin-bottom: 10px; line-height: 1.5; }
.chv-export-pre {
  font-family: var(--chv-font-mono); font-size: 10px;
  background: var(--chv-bg-card); padding: 10px; border-radius: 8px;
  border: 1px solid var(--chv-border-soft);
  white-space: pre-wrap; word-break: break-all; margin-bottom: 10px;
  display: none; color: var(--chv-text-main); max-height: 200px; overflow-y: auto;
}
.chv-action-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.chv-btn {
  padding: 8px 16px; border: none; border-radius: 8px;
  background: var(--chv-olive); color: #fff; cursor: pointer;
  font-family: var(--chv-font-mono); font-size: 10px; font-weight: 700;
  letter-spacing: 1px; text-transform: uppercase;
  transition: background 0.15s, transform 0.1s;
}
.chv-btn:hover { background: var(--chv-olive-mid); transform: translateY(-1px); }
.chv-btn:active { transform: translateY(0); }
.chv-feedback {
  font-family: var(--chv-font-mono); font-size: 10px;
  padding: 6px 10px; border-radius: 6px; display: none;
}
.chv-feedback.success { display: inline-block; color: var(--chv-olive); background: var(--chv-olive-glow); border: 1px solid var(--chv-olive-border); }
.chv-feedback.error { display: inline-block; color: #c0392b; background: rgba(192,57,43,0.06); border: 1px solid rgba(192,57,43,0.22); }
`);

  /* ============================================================
     BUILD PANEL DOM
  ============================================================ */
  function buildPanel() {
    // Icon (minimized)
    const icon = document.createElement('div');
    icon.id = 'chesshv3-icon';
    icon.style.display = 'none';
    icon.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 20h14v2H5v-2zm0-2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2zM5 6h14v10H5V6zm7 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm0 5.5a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/>
    </svg>`;
    icon.title = 'ChessHv3 — click to open';

    // Panel
    const panel = document.createElement('div');
    panel.id = 'chesshv3-panel';
    panel.innerHTML = `
      <div id="chesshv3-header">
        <span id="chesshv3-header-title">♟ ChessHv3</span>
        <div id="chesshv3-header-btns">
          <button class="chesshv3-hbtn" id="chv-minimize-btn" title="Minimize">−</button>
          <button class="chesshv3-hbtn" id="chv-hide-btn" title="Hide">✕</button>
        </div>
      </div>

      <div id="chesshv3-tabs">
        <div class="chesshv3-tab active" data-sec="settings">Settings</div>
        <div class="chesshv3-tab" data-sec="load">Load</div>
        <div class="chesshv3-tab" data-sec="export">Export</div>
      </div>

      <div id="chesshv3-body">

        <!-- ===== SETTINGS ===== -->
        <div class="chesshv3-section active" id="chvsec-settings">

          <div class="chv-setting">
            <label>ELO : <span id="chv-eloVal">3500</span></label>
            <input type="range" id="chv-elo" min="100" max="3500" step="10" value="3500">
          </div>
          <div class="chv-help">Engine strength — higher = stronger.</div>

          <div class="chv-setting">
            <label>Arrows : <span id="chv-linesVal">5</span></label>
            <input type="range" id="chv-lines" min="2" max="5" value="5">
          </div>
          <div class="chv-help">Number of best-move arrows shown on board.</div>

          <div class="chv-setting" style="flex-direction:column; align-items:flex-start; gap:8px;">
            <span style="font-size:11px; font-family:var(--chv-font-mono); font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:var(--chv-text-soft);">Arrow Colors</span>
            <div class="chv-color-row">
              <div class="chv-color-item"><input type="color" id="chv-color0" value="#0000ff"><span>Best</span></div>
              <div class="chv-color-item"><input type="color" id="chv-color1" value="#00ff00"><span>2nd</span></div>
              <div class="chv-color-item"><input type="color" id="chv-color2" value="#FFFF00"><span>3rd</span></div>
              <div class="chv-color-item"><input type="color" id="chv-color3" value="#f97316"><span>4th</span></div>
              <div class="chv-color-item"><input type="color" id="chv-color4" value="#ff0000"><span>5th</span></div>
            </div>
          </div>
          <div class="chv-help">Customize arrow colors for each ranked move.</div>

          <div class="chv-setting">
            <label>Depth : <span id="chv-depthVal">10</span></label>
            <input type="range" id="chv-depth" min="1" max="15" value="10">
          </div>
          <div class="chv-help">Analysis depth — higher = slower but stronger.</div>

          <div class="chv-setting">
            <label>Auto Delay : <span id="chv-delayVal">100</span> ms</label>
            <input type="range" id="chv-delay" min="100" max="20000" step="50" value="100">
          </div>
          <div class="chv-help">Random delay 0–value before auto-playing a move.</div>

          <div class="chv-setting">
            <label>Style</label>
            <select id="chv-style">
              <option selected>Default</option>
              <option>Aggressive</option><option>Defensive</option>
              <option>Active</option><option>Positional</option>
              <option>Endgame</option><option>Beginner</option><option>Human</option>
            </select>
          </div>
          <div class="chv-help">Preferred playstyle of the engine.</div>

          <div class="chv-setting">
            <label>Play Key</label>
            <select id="chv-key">
              <option value=" " selected>Space</option>
              ${['a','z','e','r','t','y','u','i','o','p','q','s','d','f','g','h','j','k','l','m','w','x','c','v','b','n',
                 'Control','Shift','Alt','Tab','CapsLock',
                 '1','2','3','4','5','6','7','8','9','0',
                 'ArrowUp','ArrowDown','ArrowLeft','ArrowRight']
                .map(k => `<option value="${k}">${k}</option>`).join('')}
            </select>
          </div>
          <div class="chv-help">Hotkey to play best move instantly.</div>

          <div class="chv-setting">
            <span id="chv-autoMoveLabel">Auto Move (OFF)</span>
            <label class="chv-toggle"><input type="checkbox" id="chv-autoMove"><span class="chv-slider"></span></label>
          </div>
          <div class="chv-help">Automatically plays the best move.</div>

          <div class="chv-setting">
            <span id="chv-statLabel">Accuracy & Elo (OFF)</span>
            <label class="chv-toggle"><input type="checkbox" id="chv-stat"><span class="chv-slider"></span></label>
          </div>
          <div class="chv-help">Show real-time accuracy and estimated Elo.</div>

          <div class="chv-setting">
            <span id="chv-winningMoveLabel">Only Winning Move (OFF)</span>
            <label class="chv-toggle"><input type="checkbox" id="chv-winningMove"><span class="chv-slider"></span></label>
          </div>
          <div class="chv-help">Show only moves keeping +2 material advantage.</div>

          <div class="chv-setting">
            <span id="chv-showEvalLabel">Show Eval Bar (OFF)</span>
            <label class="chv-toggle"><input type="checkbox" id="chv-showEval"><span class="chv-slider"></span></label>
          </div>
          <div class="chv-help">Display the engine evaluation bar.</div>

          <div class="chv-setting">
            <span id="chv-onlyShowEvalLabel">Hide Arrows (OFF)</span>
            <label class="chv-toggle"><input type="checkbox" id="chv-onlyShowEval"><span class="chv-slider"></span></label>
          </div>
          <div class="chv-help">Hide move suggestion arrows.</div>

        </div><!-- /settings -->

        <!-- ===== LOAD ===== -->
        <div class="chesshv3-section" id="chvsec-load">
          <p class="chv-hint">Paste a previously exported JSON config and click Load.</p>
          <textarea class="chv-textarea" id="chv-loadInput" placeholder='{"elo":3500,"lines":5,...}'></textarea>
          <div class="chv-action-row" style="margin-top:10px;">
            <button class="chv-btn" id="chv-loadBtn">Load Config</button>
            <span class="chv-feedback" id="chv-loadFeedback"></span>
          </div>
        </div>

        <!-- ===== EXPORT ===== -->
        <div class="chesshv3-section" id="chvsec-export">
          <p class="chv-hint">Export current config as JSON.</p>
          <pre class="chv-export-pre" id="chv-exportOutput"></pre>
          <div class="chv-action-row">
            <button class="chv-btn" id="chv-exportBtn">Export Config</button>
            <button class="chv-btn" id="chv-copyBtn" style="display:none;">Copy</button>
          </div>
        </div>

      </div><!-- /body -->
    `;

    document.body.appendChild(icon);
    document.body.appendChild(panel);
    return { panel, icon };
  }

  /* ============================================================
     PANEL LOGIC
  ============================================================ */
  function initPanel() {
    const { panel, icon } = buildPanel();
    const el = id => document.getElementById(id);

    /* --- TABS --- */
    panel.querySelectorAll('.chesshv3-tab').forEach(tab => {
      tab.onclick = () => {
        panel.querySelectorAll('.chesshv3-tab, .chesshv3-section')
          .forEach(e => e.classList.remove('active'));
        tab.classList.add('active');
        el('chvsec-' + tab.dataset.sec).classList.add('active');
      };
    });

    /* --- MINIMIZE / HIDE --- */
    el('chv-minimize-btn').onclick = () => {
      panel.style.display = 'none';
      icon.style.display  = 'flex';
    };
    el('chv-hide-btn').onclick = () => {
      panel.style.display = 'none';
      icon.style.display  = 'none';
    };
    icon.onclick = () => {
      icon.style.display  = 'none';
      panel.style.display = 'flex';
    };

    /* --- DRAG --- */
    let dragging = false, ox = 0, oy = 0;
    const header = el('chesshv3-header');
    header.addEventListener('mousedown', e => {
      if (e.target.classList.contains('chesshv3-hbtn')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      panel.style.transition = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      let left = e.clientX - ox;
      let top  = e.clientY - oy;
      // clamp inside viewport
      left = Math.max(0, Math.min(left, window.innerWidth  - panel.offsetWidth));
      top  = Math.max(0, Math.min(top,  window.innerHeight - panel.offsetHeight));
      panel.style.right  = 'unset';
      panel.style.bottom = 'unset';
      panel.style.left   = left + 'px';
      panel.style.top    = top  + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    /* --- SYNC UI FROM CONFIG --- */
    function syncUI() {
      el('chv-elo').value   = config.elo;    el('chv-eloVal').textContent   = config.elo;
      el('chv-lines').value = config.lines;  el('chv-linesVal').textContent = config.lines;
      el('chv-depth').value = config.depth;  el('chv-depthVal').textContent = config.depth;
      el('chv-delay').value = config.delay;  el('chv-delayVal').textContent = config.delay;
      el('chv-style').value = config.style;
      el('chv-key').value   = config.key;

      ['autoMove','stat','winningMove','showEval','onlyShowEval'].forEach(k => {
        el('chv-' + k).checked = config[k];
      });
      el('chv-autoMoveLabel').textContent    = `Auto Move (${config.autoMove ? 'ON' : 'OFF'})`;
      el('chv-statLabel').textContent        = `Accuracy & Elo (${config.stat ? 'ON' : 'OFF'})`;
      el('chv-winningMoveLabel').textContent = `Only Winning Move (${config.winningMove ? 'ON' : 'OFF'})`;
      el('chv-showEvalLabel').textContent    = `Show Eval Bar (${config.showEval ? 'ON' : 'OFF'})`;
      el('chv-onlyShowEvalLabel').textContent= `Hide Arrows (${config.onlyShowEval ? 'ON' : 'OFF'})`;

      config.colors.forEach((c, i) => {
        const inp = el('chv-color' + i);
        if (inp) inp.value = c;
      });

      // Hide color pickers beyond selected lines
      for (let i = 0; i < 5; i++) {
        const item = el('chv-color' + i);
        if (item) item.closest('.chv-color-item').style.display = i >= config.lines ? 'none' : '';
      }
    }

    function save() { saveConfig(config); broadcastConfig(); }

    /* --- RANGE HANDLERS --- */
    ['elo','lines','depth','delay'].forEach(k => {
      el('chv-' + k).oninput = e => {
        config[k] = +e.target.value; syncUI(); save();
      };
    });

    /* --- TOGGLE HANDLERS --- */
    ['autoMove','stat','winningMove','showEval','onlyShowEval'].forEach(k => {
      el('chv-' + k).onchange = e => {
        config[k] = e.target.checked; syncUI(); save();
      };
    });

    el('chv-style').onchange = e => { config.style = e.target.value; save(); };
    el('chv-key').onchange   = e => { config.key   = e.target.value; save(); };

    for (let i = 0; i < 5; i++) {
      el('chv-color' + i).addEventListener('input', e => {
        config.colors[i] = e.target.value; save();
      });
    }

    /* --- LOAD CONFIG TAB --- */
    el('chv-loadBtn').onclick = () => {
      const raw = el('chv-loadInput').value.trim();
      const fb  = el('chv-loadFeedback');
      if (!raw) { fb.textContent = '⚠ Paste a JSON config first.'; fb.className = 'chv-feedback error'; return; }
      try {
        config = Object.assign({}, defaultConfig, JSON.parse(raw));
        saveConfig(config); syncUI(); broadcastConfig();
        fb.textContent = '✓ Config loaded!'; fb.className = 'chv-feedback success';
        el('chv-loadInput').value = '';
      } catch {
        fb.textContent = '✗ Invalid JSON.'; fb.className = 'chv-feedback error';
      }
    };

    /* --- EXPORT TAB --- */
    el('chv-exportBtn').onclick = () => {
      const out = el('chv-exportOutput');
      out.textContent = JSON.stringify(config, null, 2);
      out.style.display = 'block';
      el('chv-copyBtn').style.display = 'inline-block';
    };
    el('chv-copyBtn').onclick = () => {
      navigator.clipboard.writeText(el('chv-exportOutput').textContent).then(() => {
        const btn = el('chv-copyBtn');
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      });
    };

    syncUI();
  }

  /* ============================================================
     BROADCAST CONFIG TO PAGE (replaces chrome.storage → content)
     The injected a.js listens on window messages.
  ============================================================ */
  function broadcastConfig() {
    window.postMessage({ type: 'CHV_CONFIG', config }, '*');
  }

  /* ============================================================
     KEYBOARD SHORTCUT  (replaces background.js key handler)
  ============================================================ */
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === config.key) {
      window.postMessage({ type: 'CHV_PLAY_BEST' }, '*');
    }
  });

  /* ============================================================
     INIT
  ============================================================ */
  function init() {
    initPanel();
    // Send config to page script after a short delay (allow a.js to load)
    setTimeout(broadcastConfig, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
