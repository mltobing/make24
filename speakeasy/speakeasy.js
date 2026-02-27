/**
 * speakeasy.js — After-Hours hard modes for Make24
 *
 * Gated behind isRegistered(). Zero modifications required to app.js or style.css.
 * Uses a MutationObserver to watch the victory card and inject the 🔑 entry point.
 *
 * Modes:
 *   1. After-Hours Flood  — solve 24 before the room fills (45s timer, rising water)
 *   2. Market Maker       — quote as many distinct integers 1–60 as you can in 60s
 *
 * Storage keys (never overlap with base-game keys):
 *   make24_speakeasy_flood_bestMs   — best remaining milliseconds in Flood
 *   make24_speakeasy_mm_bestQuotes  — best quote count in Market Maker
 *
 * Registration gate:
 *   • URL param  ?speakeasy=1        → always registered (dev/testing)
 *   • localStorage make24_registered = "1"
 *   • Supabase session (wired into existing auth)
 *
 * Console debug helper (local testing only):
 *   window.make24DebugSetRegistered(true)   → enable
 *   window.make24DebugSetRegistered(false)  → disable
 */
(function () {
    'use strict';

    // ============================================================
    // CONSTANTS
    // ============================================================
    const FLOOD_DURATION_MS  = 45000;
    const MM_DURATION_MS     = 60000;
    const MM_MAX_QUOTE       = 60;
    const FLOAT_EPS          = 0.0001;
    const WRONG_RESET_MS     = 800;
    const QUOTE_RESET_MS     = 600;

    const SPK_FLOOD_PB_KEY   = 'make24_speakeasy_flood_bestMs';
    const SPK_MM_PB_KEY      = 'make24_speakeasy_mm_bestQuotes';

    // ============================================================
    // CALC ENGINE  (local copy; also matches window.calc in app.js)
    // ============================================================
    function calc(a, op, b) {
        switch (op) {
            case '+': return a + b;
            case '-': return a - b;
            case '*': return a * b;
            case '/': return b === 0 ? null : a / b;
        }
        return null;
    }

    // ============================================================
    // GATE
    // ============================================================
    let _registeredFromAuth = false;

    function checkUrlParam() {
        try { return new URLSearchParams(window.location.search).get('speakeasy') === '1'; }
        catch (e) { return false; }
    }

    async function refreshAuthState() {
        try {
            if (window.sb) {
                const { data: { session } } = await window.sb.auth.getSession();
                if (session) _registeredFromAuth = true;
            }
        } catch (_) { /* auth unavailable */ }
    }

    function isRegistered() {
        if (checkUrlParam()) return true;
        if (localStorage.getItem('make24_registered') === '1') return true;
        if (_registeredFromAuth) return true;
        return false;
    }

    // Console helper — local/dev only
    window.make24DebugSetRegistered = function (val) {
        if (val) {
            localStorage.setItem('make24_registered', '1');
            _registeredFromAuth = true;
            console.log('[Speakeasy] Registered ON. Open/close the victory card to see 🔑.');
        } else {
            localStorage.removeItem('make24_registered');
            _registeredFromAuth = false;
            console.log('[Speakeasy] Registered OFF.');
        }
    };

    // ============================================================
    // STORAGE
    // ============================================================
    function getFloodPB()           { const v = localStorage.getItem(SPK_FLOOD_PB_KEY);  return v ? parseInt(v, 10) : null; }
    function getMmPB()              { const v = localStorage.getItem(SPK_MM_PB_KEY);      return v ? parseInt(v, 10) : null; }

    function saveFloodPB(ms) {
        const cur = getFloodPB();
        if (cur === null || ms > cur) localStorage.setItem(SPK_FLOOD_PB_KEY, String(ms));
    }
    function saveMmPB(count) {
        const cur = getMmPB();
        if (cur === null || count > cur) localStorage.setItem(SPK_MM_PB_KEY, String(count));
    }

    // ============================================================
    // ROUND ENGINE  (pure-ish; state objects are plain JS)
    // ============================================================
    function createRound(digits) {
        return {
            cards:    digits.map((v, i) => ({ value: v, slot: i, used: false })),
            selected: [],
            history:  []   // stack of card-array snapshots for undo
        };
    }

    function roundSelectCard(round, cardIdx) {
        const card = round.cards[cardIdx];
        if (!card || card.used) return round;
        const sel = [...round.selected];
        const pos = sel.indexOf(cardIdx);
        if (pos !== -1) { sel.splice(pos, 1); }
        else if (sel.length < 2) { sel.push(cardIdx); }
        return { ...round, selected: sel };
    }

    // Returns new round or null on invalid (div-by-zero)
    function roundApplyOp(round, op) {
        if (round.selected.length !== 2) return null;
        const [i, j] = round.selected;
        const a = round.cards[i].value;
        const b = round.cards[j].value;
        const result = calc(a, op, b);
        if (result === null) return null;

        const snapshot = round.cards.map(c => ({ ...c }));
        const newCards = round.cards.map(c => ({ ...c }));
        newCards[i].used = true;
        newCards[j].used = true;
        newCards.push({ value: result, slot: newCards[i].slot, used: false });

        return { cards: newCards, selected: [], history: [...round.history, snapshot] };
    }

    function roundUndo(round) {
        if (round.history.length === 0) return round;
        const prev = round.history[round.history.length - 1];
        return { cards: prev.map(c => ({ ...c })), selected: [], history: round.history.slice(0, -1) };
    }

    function roundRemaining(round) { return round.cards.filter(c => !c.used); }

    function roundGetValue(round) {
        const r = roundRemaining(round);
        return r.length === 1 ? r[0].value : null;
    }

    function roundIsSolved(round) {
        const v = roundGetValue(round);
        return v !== null && Math.abs(v - 24) < FLOAT_EPS;
    }

    // ============================================================
    // TODAY'S DIGITS  (reuse app.js globals; fallback if not present)
    // ============================================================
    function getTodayDigits() {
        try {
            const puzzleNum = window.getTodayPuzzleNumber
                ? window.getTodayPuzzleNumber()
                : (() => {
                    const epoch = new Date('2025-01-01T00:00:00Z');
                    const now   = new Date();
                    const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    return Math.floor((local - epoch) / 86400000) + 1;
                })();
            if (window.generatePuzzle) return window.generatePuzzle(puzzleNum);
        } catch (_) { /* fallback below */ }
        return [2, 3, 4, 4];
    }

    // ============================================================
    // FORMAT HELPERS
    // ============================================================
    function fmtMs(ms) {
        const s = Math.ceil(ms / 1000);
        return s + 's';
    }

    function fmtVal(n) {
        if (n === null) return '?';
        if (Number.isInteger(n)) return String(n);
        // Try simple fraction display
        for (const d of [2, 3, 4, 5, 6, 7, 8, 9, 10, 12]) {
            const num = n * d;
            if (Math.abs(Math.round(num) - num) < 0.001) return `${Math.round(num)}/${d}`;
        }
        return n.toFixed(2);
    }

    // ============================================================
    // SHARE
    // ============================================================
    function shareText(text) {
        const pub = (window.APP_CONFIG && window.APP_CONFIG.publicUrl) || 'make24.app';
        const full = text + '\n' + pub;
        if (navigator.share) {
            navigator.share({ text: full }).catch(() => clipText(full));
        } else { clipText(full); }
    }

    function clipText(text) {
        navigator.clipboard.writeText(text).then(
            () => { if (window.showToast) window.showToast('Copied to clipboard!'); },
            () => { if (window.showToast) window.showToast('Copied to clipboard!'); }
        );
    }

    // ============================================================
    // OVERLAY INFRASTRUCTURE
    // ============================================================
    let _overlay = null;

    function ensureOverlay() {
        if (_overlay) return _overlay;
        _overlay = document.createElement('div');
        _overlay.id = 'spkOverlay';
        _overlay.className = 'spk-overlay';
        document.body.appendChild(_overlay);
        return _overlay;
    }

    function showOverlay(buildFn) {
        const el = ensureOverlay();
        el.innerHTML = '';
        el.classList.add('spk-visible');
        buildFn(el);
    }

    function hideOverlay() {
        if (!_overlay) return;
        _overlay.classList.remove('spk-visible');
        // Wipe content after slide-out animation
        setTimeout(() => { if (_overlay) _overlay.innerHTML = ''; }, 350);
    }

    // ============================================================
    // SPEAKEASY MENU  (mode selector)
    // ============================================================
    function showSpeakeasyMenu() {
        const digits = getTodayDigits();
        const pbFlood = getFloodPB();
        const pbMm    = getMmPB();

        showOverlay((el) => {
            el.innerHTML = `
<div class="spk-sheet" role="dialog" aria-modal="true" aria-label="After Hours">
  <button class="spk-close-btn" aria-label="Close">&times;</button>
  <div class="spk-menu-header">
    <div class="spk-menu-title">After Hours</div>
    <div class="spk-menu-subtitle">Same digits, different game.</div>
    <div class="spk-menu-digits">${digits.join(' · ')}</div>
  </div>
  <div class="spk-mode-list">
    <button class="spk-mode-card" id="spkFloodBtn">
      <div class="spk-mode-icon">💧</div>
      <div class="spk-mode-info">
        <div class="spk-mode-name">After&#8209;Hours Flood</div>
        <div class="spk-mode-desc">Solve 24 before the room fills.</div>
        <div class="spk-mode-pb">${pbFlood !== null ? 'PB: ' + fmtMs(pbFlood) + ' left' : 'No record yet'}</div>
      </div>
    </button>
    <button class="spk-mode-card" id="spkMmBtn">
      <div class="spk-mode-icon">📈</div>
      <div class="spk-mode-info">
        <div class="spk-mode-name">Market Maker</div>
        <div class="spk-mode-desc">Quote as many different numbers as you can in 60s.</div>
        <div class="spk-mode-pb">${pbMm !== null ? 'PB: ' + pbMm + ' quotes' : 'No record yet'}</div>
      </div>
    </button>
  </div>
</div>`;
            el.querySelector('.spk-close-btn').addEventListener('click', hideOverlay);
            el.querySelector('#spkFloodBtn').addEventListener('click', () => startFloodMode(digits));
            el.querySelector('#spkMmBtn').addEventListener('click',    () => startMarketMode(digits));
            el.addEventListener('click', (e) => { if (e.target === el) hideOverlay(); });
        });
    }

    // ============================================================
    // SHARED GAME BOARD RENDERER  (event-delegation friendly)
    // ============================================================
    function renderBoard(el, round) {
        const boardEl = el.querySelector('.spk-board');
        if (!boardEl) return;
        boardEl.innerHTML = '';

        const remaining = roundRemaining(round);

        // Card grid
        const grid = document.createElement('div');
        grid.className = 'spk-cards-grid';
        remaining.forEach((card) => {
            const idx = round.cards.indexOf(card);
            const btn = document.createElement('button');
            btn.className = 'spk-card' + (round.selected.includes(idx) ? ' spk-card-sel' : '');
            btn.textContent = fmtVal(card.value);
            btn.dataset.cardIdx = idx;
            grid.appendChild(btn);
        });
        boardEl.appendChild(grid);

        // Operator strip — only when exactly 2 cards selected
        if (round.selected.length === 2) {
            const strip = document.createElement('div');
            strip.className = 'spk-op-strip';
            ['+', '-', '*', '/'].forEach((op) => {
                const btn = document.createElement('button');
                btn.className = 'spk-op-btn';
                btn.dataset.op = op;
                btn.textContent = op === '*' ? '×' : op === '/' ? '÷' : op;
                strip.appendChild(btn);
            });
            boardEl.appendChild(strip);
        }

        // Undo button
        if (round.history.length > 0) {
            const ub = document.createElement('button');
            ub.className = 'spk-undo-btn';
            ub.dataset.action = 'undo';
            ub.textContent = '↶ Undo';
            boardEl.appendChild(ub);
        }
    }

    // ============================================================
    // MODE A: AFTER-HOURS FLOOD
    // ============================================================
    function startFloodMode(digits) {
        let round    = createRound([...digits]);
        let started  = null;
        let rafId    = null;
        let finished = false;

        showOverlay((el) => {
            el.innerHTML = `
<div class="spk-game-screen">
  <div class="spk-topbar">
    <button class="spk-back-btn" aria-label="Back">&#8592; Back</button>
    <span class="spk-game-label">After&#8209;Hours Flood</span>
    <span class="spk-timer" id="spkFlTimer">45s</span>
  </div>
  <div class="spk-board" id="spkFlBoard"></div>
  <div class="spk-water" id="spkWater"></div>
</div>`;

            const screen  = el.querySelector('.spk-game-screen');
            const timerEl = el.querySelector('#spkFlTimer');
            const waterEl = el.querySelector('#spkWater');
            const boardEl = el.querySelector('#spkFlBoard');

            el.querySelector('.spk-back-btn').addEventListener('click', () => {
                finished = true;
                cancelAnimationFrame(rafId);
                showSpeakeasyMenu();
            });

            // Event delegation on the board div
            boardEl.addEventListener('click', (e) => {
                if (finished) return;

                const cardIdx  = e.target.closest('[data-card-idx]')?.dataset.cardIdx;
                const op       = e.target.closest('[data-op]')?.dataset.op;
                const action   = e.target.closest('[data-action]')?.dataset.action;

                if (action === 'undo') {
                    round = roundUndo(round);
                    renderBoard(el, round);
                    return;
                }
                if (cardIdx !== undefined) {
                    round = roundSelectCard(round, parseInt(cardIdx, 10));
                    renderBoard(el, round);
                    return;
                }
                if (op) {
                    const next = roundApplyOp(round, op);
                    if (!next) return;
                    round = next;
                    renderBoard(el, round);

                    if (roundIsSolved(round)) {
                        finished = true;
                        cancelAnimationFrame(rafId);
                        const elapsed    = Date.now() - started;
                        const remaining  = Math.max(0, FLOOD_DURATION_MS - elapsed);
                        saveFloodPB(remaining);
                        _showFloodWin(screen, remaining);
                    } else if (roundRemaining(round).length === 1) {
                        // Wrong answer — reset after short delay
                        const snap = [...digits];
                        setTimeout(() => {
                            if (finished) return;
                            round = createRound(snap);
                            renderBoard(el, round);
                        }, WRONG_RESET_MS);
                    }
                    return;
                }
            });

            // Start timer
            started = Date.now();
            renderBoard(el, round);

            function tick() {
                if (finished) return;
                const elapsed    = Date.now() - started;
                const remaining  = FLOOD_DURATION_MS - elapsed;

                if (remaining <= 0) {
                    finished = true;
                    waterEl.style.height = '100%';
                    timerEl.textContent  = '0s';
                    _showFloodFail(screen, digits);
                    return;
                }

                const pct = (elapsed / FLOOD_DURATION_MS) * 100;
                waterEl.style.height = pct.toFixed(1) + '%';
                timerEl.textContent  = fmtMs(remaining);
                if (remaining < 10000) timerEl.classList.add('spk-timer-warn');

                rafId = requestAnimationFrame(tick);
            }
            rafId = requestAnimationFrame(tick);
        });
    }

    function _showFloodWin(screen, remainingMs) {
        const pb    = getFloodPB();
        const isPB  = pb !== null && remainingMs >= pb;
        screen.innerHTML = `
<div class="spk-result">
  <div class="spk-result-icon">💧</div>
  <div class="spk-result-heading">Survived!</div>
  <div class="spk-result-stat">${fmtMs(remainingMs)} remaining</div>
  ${isPB
    ? '<div class="spk-result-new-pb">New best!</div>'
    : (pb !== null ? `<div class="spk-result-prev-pb">Best: ${fmtMs(pb)} left</div>` : '')}
  <div class="spk-result-actions">
    <button class="spk-btn spk-btn-share" id="spkFlShareBtn">Share</button>
    <button class="spk-btn spk-btn-primary" id="spkFlRetryBtn">Play Again</button>
    <button class="spk-btn spk-btn-ghost"   id="spkFlBackBtn">Back</button>
  </div>
</div>`;
        screen.querySelector('#spkFlShareBtn').addEventListener('click', () =>
            shareText(`I survived After-Hours Flood with ${fmtMs(remainingMs)} left. Can you?`));
        screen.querySelector('#spkFlRetryBtn').addEventListener('click', () =>
            startFloodMode(getTodayDigits()));
        screen.querySelector('#spkFlBackBtn').addEventListener('click', showSpeakeasyMenu);
    }

    function _showFloodFail(screen, digits) {
        const pb = getFloodPB();
        screen.innerHTML = `
<div class="spk-result spk-result-fail">
  <div class="spk-result-icon">🌊</div>
  <div class="spk-result-heading">Flooded.</div>
  ${pb !== null ? `<div class="spk-result-prev-pb">Best: ${fmtMs(pb)} left</div>` : ''}
  <div class="spk-result-actions">
    <button class="spk-btn spk-btn-primary" id="spkFlRetryBtn">Retry</button>
    <button class="spk-btn spk-btn-ghost"   id="spkFlBackBtn">Back</button>
  </div>
</div>`;
        screen.querySelector('#spkFlRetryBtn').addEventListener('click', () =>
            startFloodMode(getTodayDigits()));
        screen.querySelector('#spkFlBackBtn').addEventListener('click', showSpeakeasyMenu);
    }

    // ============================================================
    // MODE B: MARKET MAKER
    // ============================================================
    function startMarketMode(digits) {
        let round    = createRound([...digits]);
        let quoted   = new Set();
        let score    = 0;
        let started  = null;
        let rafId    = null;
        let finished = false;
        let fbTimer  = null;

        showOverlay((el) => {
            el.innerHTML = `
<div class="spk-game-screen">
  <div class="spk-topbar">
    <button class="spk-back-btn" aria-label="Back">&#8592; Back</button>
    <span class="spk-game-label">Market Maker</span>
    <span class="spk-timer" id="spkMmTimer">60s</span>
  </div>
  <div class="spk-mm-meta">
    <span class="spk-mm-score" id="spkMmScore">Quotes: 0</span>
    <span class="spk-mm-rule">Integers 1–${MM_MAX_QUOTE} count</span>
  </div>
  <div class="spk-board" id="spkMmBoard"></div>
  <div class="spk-feedback" id="spkMmFb"></div>
  <div class="spk-ledger" id="spkMmLedger"></div>
</div>`;

            const screen   = el.querySelector('.spk-game-screen');
            const timerEl  = el.querySelector('#spkMmTimer');
            const scoreEl  = el.querySelector('#spkMmScore');
            const fbEl     = el.querySelector('#spkMmFb');
            const ledgerEl = el.querySelector('#spkMmLedger');
            const boardEl  = el.querySelector('#spkMmBoard');

            el.querySelector('.spk-back-btn').addEventListener('click', () => {
                finished = true;
                cancelAnimationFrame(rafId);
                clearTimeout(fbTimer);
                showSpeakeasyMenu();
            });

            function showFb(msg, cls) {
                if (fbTimer) clearTimeout(fbTimer);
                fbEl.textContent = msg;
                fbEl.className   = 'spk-feedback spk-fb-' + cls + ' spk-fb-show';
                fbTimer = setTimeout(() => fbEl.classList.remove('spk-fb-show'), 900);
            }

            function renderLedger() {
                const sorted = [...quoted].sort((a, b) => a - b);
                ledgerEl.innerHTML = sorted.map(n => `<span class="spk-chip">${n}</span>`).join('');
            }

            boardEl.addEventListener('click', (e) => {
                if (finished) return;
                const cardIdx  = e.target.closest('[data-card-idx]')?.dataset.cardIdx;
                const op       = e.target.closest('[data-op]')?.dataset.op;
                const action   = e.target.closest('[data-action]')?.dataset.action;

                if (action === 'undo') {
                    round = roundUndo(round);
                    renderBoard(el, round);
                    return;
                }
                if (cardIdx !== undefined) {
                    round = roundSelectCard(round, parseInt(cardIdx, 10));
                    renderBoard(el, round);
                    return;
                }
                if (op) {
                    const next = roundApplyOp(round, op);
                    if (!next) return;
                    round = next;
                    renderBoard(el, round);

                    if (roundRemaining(round).length === 1) {
                        const val = roundGetValue(round);

                        if (val !== null && Number.isInteger(val) && val >= 1 && val <= MM_MAX_QUOTE) {
                            if (quoted.has(val)) {
                                showFb(`Already quoted ${val}`, 'dupe');
                            } else {
                                quoted.add(val);
                                score++;
                                scoreEl.textContent = 'Quotes: ' + score;
                                renderLedger();
                                showFb('+1 · ' + val, 'new');
                            }
                        } else {
                            showFb(val !== null ? fmtVal(val) + " — doesn't count" : 'Invalid', 'bad');
                        }

                        // Auto-reset for next quote
                        const snap = [...digits];
                        setTimeout(() => {
                            if (finished) return;
                            round = createRound(snap);
                            renderBoard(el, round);
                        }, QUOTE_RESET_MS);
                    }
                    return;
                }
            });

            // Start timer
            started = Date.now();
            renderBoard(el, round);
            renderLedger();

            function tick() {
                if (finished) return;
                const elapsed   = Date.now() - started;
                const remaining = MM_DURATION_MS - elapsed;

                if (remaining <= 0) {
                    finished = true;
                    timerEl.textContent = '0s';
                    saveMmPB(score);
                    _showMmEnd(screen, score, quoted);
                    return;
                }
                timerEl.textContent = fmtMs(remaining);
                if (remaining < 10000) timerEl.classList.add('spk-timer-warn');
                rafId = requestAnimationFrame(tick);
            }
            rafId = requestAnimationFrame(tick);
        });
    }

    function _showMmEnd(screen, score, quoted) {
        const pb   = getMmPB();
        const isPB = pb !== null && score >= pb;
        const sorted = [...quoted].sort((a, b) => a - b);

        screen.innerHTML = `
<div class="spk-result">
  <div class="spk-result-icon">📈</div>
  <div class="spk-result-heading">Time's Up!</div>
  <div class="spk-result-stat">${score} quote${score !== 1 ? 's' : ''}</div>
  ${isPB
    ? '<div class="spk-result-new-pb">New best!</div>'
    : (pb !== null ? `<div class="spk-result-prev-pb">Best: ${pb}</div>` : '')}
  ${sorted.length > 0
    ? `<div class="spk-result-ledger">${sorted.map(n => `<span class="spk-chip">${n}</span>`).join('')}</div>`
    : ''}
  <div class="spk-result-actions">
    <button class="spk-btn spk-btn-share"   id="spkMmShareBtn">Share</button>
    <button class="spk-btn spk-btn-primary" id="spkMmRetryBtn">Play Again</button>
    <button class="spk-btn spk-btn-ghost"   id="spkMmBackBtn">Back</button>
  </div>
</div>`;
        screen.querySelector('#spkMmShareBtn').addEventListener('click', () =>
            shareText(`I quoted ${score} number${score !== 1 ? 's' : ''} in Market Maker (1–${MM_MAX_QUOTE}) in 60s. Can you beat me?`));
        screen.querySelector('#spkMmRetryBtn').addEventListener('click', () =>
            startMarketMode(getTodayDigits()));
        screen.querySelector('#spkMmBackBtn').addEventListener('click', showSpeakeasyMenu);
    }

    // ============================================================
    // SECRET DOOR  (🔑 key icon injected into victory card)
    // ============================================================
    function injectKeyIcon() {
        const card = document.getElementById('victoryCard');
        if (!card) return;

        // Remove stale icon if present
        const old = document.getElementById('spkKeyBtn');
        if (old) old.remove();

        if (!isRegistered()) return;

        const btn = document.createElement('button');
        btn.id        = 'spkKeyBtn';
        btn.className = 'spk-key-btn';
        btn.setAttribute('aria-label', 'After-hours');
        btn.setAttribute('title', 'After-hours');
        btn.textContent = '🔑';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showSpeakeasyMenu();
        });
        card.appendChild(btn);
    }

    // ============================================================
    // OBSERVER  (watches #victoryBackdrop for .show class — no app.js changes)
    // ============================================================
    function observeVictoryCard() {
        const backdrop = document.getElementById('victoryBackdrop');
        if (!backdrop) return;

        let wasVisible = false;
        const obs = new MutationObserver(() => {
            const isVisible = backdrop.classList.contains('show');
            if (isVisible && !wasVisible) {
                wasVisible = true;
                if (isRegistered()) injectKeyIcon();
            }
            if (!isVisible && wasVisible) {
                wasVisible = false;
                const k = document.getElementById('spkKeyBtn');
                if (k) k.remove();
            }
        });

        obs.observe(backdrop, { attributes: true, attributeFilter: ['class'] });
    }

    // ============================================================
    // INIT
    // ============================================================
    async function init() {
        // Non-blocking auth refresh — updates flag for future opens
        refreshAuthState().catch(() => {});

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', observeVictoryCard);
        } else {
            observeVictoryCard();
        }
    }

    init();

})();
