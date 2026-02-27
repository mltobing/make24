/**
 * speakeasy.js — After-Hours hard modes for Make24
 *
 * Gated behind isRegistered(). Zero modifications to app.js or style.css.
 * Uses a MutationObserver to watch the victory card and inject the 🔑 entry point.
 *
 * Modes:
 *   1. After-Hours Flood  — solve 24 before the room fills
 *   2. Market Maker       — quote as many distinct integers 1–60 as you can
 *
 * Timer modes (toggled in the menu, persisted in localStorage):
 *   Rush  → Flood 45s,  Market Maker 60s
 *   Chill → Flood 3min, Market Maker 5min
 *
 * Storage keys (never overlap base-game keys):
 *   make24_speakeasy_flood_bestMs   — Flood: best remaining ms
 *   make24_speakeasy_mm_bestQuotes  — Market Maker: best quote count
 *   make24_speakeasy_timer          — "rush" | "chill"
 *
 * Registration gate:
 *   • URL param  ?speakeasy=1
 *   • localStorage make24_registered = "1"
 *   • Supabase session (wired into existing auth)
 *
 * Console helper:
 *   window.make24DebugSetRegistered(true/false)
 */
(function () {
    'use strict';

    // ============================================================
    // CONSTANTS
    // ============================================================
    const DURATIONS = {
        rush:  { flood: 45000,  mm:  60000 },
        chill: { flood: 180000, mm: 300000 }
    };
    const MM_MAX_QUOTE    = 60;
    const FLOAT_EPS       = 0.0001;
    const WRONG_RESET_MS  = 800;
    const QUOTE_RESET_MS  = 600;

    const FLOOD_PB_KEY    = 'make24_speakeasy_flood_bestMs';
    const MM_PB_KEY       = 'make24_speakeasy_mm_bestQuotes';
    const TIMER_MODE_KEY  = 'make24_speakeasy_timer';

    // Diamond slot names in order 0–3 (matches base game: top/left/right/bottom)
    const SLOT_CLASSES = ['spk-slot-top', 'spk-slot-left', 'spk-slot-right', 'spk-slot-bottom'];

    // ============================================================
    // TIMER MODE
    // ============================================================
    function getTimerMode() {
        return localStorage.getItem(TIMER_MODE_KEY) === 'chill' ? 'chill' : 'rush';
    }
    function setTimerMode(mode) {
        localStorage.setItem(TIMER_MODE_KEY, mode);
    }
    function getFloodDuration() { return DURATIONS[getTimerMode()].flood; }
    function getMmDuration()    { return DURATIONS[getTimerMode()].mm;    }

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
    function getFloodPB()      { const v = localStorage.getItem(FLOOD_PB_KEY); return v ? parseInt(v, 10) : null; }
    function getMmPB()         { const v = localStorage.getItem(MM_PB_KEY);    return v ? parseInt(v, 10) : null; }
    function saveFloodPB(ms)   { const c = getFloodPB(); if (c === null || ms    > c) localStorage.setItem(FLOOD_PB_KEY, ms);    }
    function saveMmPB(count)   { const c = getMmPB();    if (c === null || count > c) localStorage.setItem(MM_PB_KEY, count); }

    // ============================================================
    // CALC  (local copy matching app.js)
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
    // ROUND ENGINE  (pure functions)
    // ============================================================
    // Cards: { value, slot (0-3), used }
    // Slot maps: 0=top, 1=left, 2=right, 3=bottom (base-game convention)
    function createRound(digits) {
        return {
            cards:    digits.map((v, i) => ({ value: v, slot: i, used: false })),
            selected: [],   // up to 2 card indices
            history:  []    // stack of card-array snapshots for undo
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

    // Returns new round, or null on division-by-zero
    function roundApplyOp(round, op) {
        if (round.selected.length !== 2) return null;
        const [i, j] = round.selected;
        const result = calc(round.cards[i].value, op, round.cards[j].value);
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
    // TODAY'S DIGITS
    // ============================================================
    function getTodayDigits() {
        try {
            const pNum = window.getTodayPuzzleNumber
                ? window.getTodayPuzzleNumber()
                : (() => {
                    const epoch = new Date('2025-01-01T00:00:00Z');
                    const now   = new Date();
                    const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    return Math.floor((local - epoch) / 86400000) + 1;
                })();
            return window.generatePuzzle ? window.generatePuzzle(pNum) : [2, 3, 4, 4];
        } catch (_) { return [2, 3, 4, 4]; }
    }

    // ============================================================
    // FORMAT HELPERS
    // ============================================================
    function fmtMs(ms) {
        const totalS = Math.ceil(ms / 1000);
        if (totalS >= 60) {
            const m = Math.floor(totalS / 60);
            const s = totalS % 60;
            return s > 0 ? `${m}m ${s}s` : `${m}m`;
        }
        return totalS + 's';
    }

    // Render a number into a DOM node (reuses app.js fraction renderer if available)
    function makeNumberNode(n) {
        if (window.formatNumberHTML) return window.formatNumberHTML(n);
        return document.createTextNode(Number.isInteger(n) ? String(n) : n.toFixed(2));
    }

    // ============================================================
    // SHARE
    // ============================================================
    function shareText(text) {
        const pub  = (window.APP_CONFIG && window.APP_CONFIG.publicUrl) || 'make24.app';
        const full = text + '\n' + pub;
        if (navigator.share) {
            navigator.share({ text: full }).catch(() => clipText(full));
        } else { clipText(full); }
    }

    function clipText(text) {
        navigator.clipboard.writeText(text).then(
            () => { if (window.showToast) window.showToast('Copied!'); },
            () => { if (window.showToast) window.showToast('Copied!'); }
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
        setTimeout(() => { if (_overlay) _overlay.innerHTML = ''; }, 350);
    }

    // ============================================================
    // DIAMOND BOARD RENDERER
    // Reuses base-game CSS classes: .card  .selected  .first  .second
    // so cards look pixel-identical to the daily puzzle.
    // ============================================================
    function buildDiamondGrid() {
        const grid = document.createElement('div');
        grid.className = 'spk-diamond-grid';
        SLOT_CLASSES.forEach((cls) => {
            const slot = document.createElement('div');
            slot.className = 'spk-slot ' + cls;
            grid.appendChild(slot);
        });
        return grid;
    }

    function renderBoard(el, round) {
        // Update each slot's card
        SLOT_CLASSES.forEach((cls, slotIdx) => {
            const slotEl = el.querySelector('.' + cls);
            if (!slotEl) return;

            // The "live" card for this slot: latest non-used card at this slot index
            const card = [...round.cards].reverse().find(c => c.slot === slotIdx && !c.used);
            const cardIdx = card ? round.cards.indexOf(card) : -1;

            // Keep existing card element if it represents the same card (avoids flicker)
            const existing = slotEl.querySelector('.card');
            const existingIdx = existing ? parseInt(existing.dataset.cardIdx, 10) : -1;

            if (!card) {
                slotEl.innerHTML = '';
                return;
            }

            const isFirst  = round.selected[0] === cardIdx;
            const isSecond = round.selected[1] === cardIdx;
            const wantedClass = 'card' +
                (isFirst  ? ' selected first'  : '') +
                (isSecond ? ' selected second' : '');

            if (existingIdx === cardIdx) {
                // Same card — just update selection classes
                existing.className = wantedClass;
            } else {
                // New card (after merge / undo)
                slotEl.innerHTML = '';
                const cardEl = document.createElement('div');
                cardEl.className = wantedClass;
                cardEl.dataset.cardIdx = cardIdx;
                cardEl.appendChild(makeNumberNode(card.value));
                slotEl.appendChild(cardEl);
            }
        });

        // Operator overlay: show when exactly 2 cards selected
        const opOverlay = el.querySelector('.spk-op-overlay');
        if (opOverlay) opOverlay.classList.toggle('spk-op-show', round.selected.length === 2);

        // Undo button visibility
        const undoBtn = el.querySelector('.spk-undo-btn');
        if (undoBtn) undoBtn.style.visibility = round.history.length > 0 ? 'visible' : 'hidden';
    }

    // ============================================================
    // SPEAKEASY MENU
    // ============================================================
    function buildTimerToggleHTML() {
        const mode = getTimerMode();
        return `
<div class="spk-timer-toggle" id="spkTimerToggle" role="group" aria-label="Timer speed">
  <button class="spk-tt-btn${mode === 'rush'  ? ' spk-tt-active' : ''}" data-mode="rush">Rush</button>
  <button class="spk-tt-btn${mode === 'chill' ? ' spk-tt-active' : ''}" data-mode="chill">Chill</button>
</div>
<div class="spk-timer-desc" id="spkTimerDesc">${timerDesc(mode)}</div>`;
    }

    function timerDesc(mode) {
        return mode === 'rush'
            ? 'Flood 45s · Market 60s'
            : 'Flood 3 min · Market 5 min';
    }

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
  ${buildTimerToggleHTML()}
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
        <div class="spk-mode-desc">Quote as many different numbers as you can.</div>
        <div class="spk-mode-pb">${pbMm !== null ? 'PB: ' + pbMm + ' quotes' : 'No record yet'}</div>
      </div>
    </button>
  </div>
</div>`;

            // Timer toggle
            el.querySelector('#spkTimerToggle').addEventListener('click', (e) => {
                const btn = e.target.closest('[data-mode]');
                if (!btn) return;
                const mode = btn.dataset.mode;
                setTimerMode(mode);
                el.querySelectorAll('.spk-tt-btn').forEach(b =>
                    b.classList.toggle('spk-tt-active', b.dataset.mode === mode));
                el.querySelector('#spkTimerDesc').textContent = timerDesc(mode);
            });

            el.querySelector('.spk-close-btn').addEventListener('click', hideOverlay);
            el.querySelector('#spkFloodBtn').addEventListener('click', () => startFloodMode(digits));
            el.querySelector('#spkMmBtn').addEventListener('click',    () => startMarketMode(digits));
            el.addEventListener('click', (e) => { if (e.target === el) hideOverlay(); });
        });
    }

    // ============================================================
    // SHARED GAME SCREEN HTML
    // (operator overlay lives inside .spk-arena so it's scoped)
    // ============================================================
    function buildGameScreenHTML(titleHTML, metaRowHTML, extraOverlayHTML) {
        return `
<div class="spk-game-screen">
  <div class="spk-topbar">
    <button class="spk-back-btn" aria-label="Back">&#8592; Back</button>
    <span class="spk-game-label">${titleHTML}</span>
    <span class="spk-timer" id="spkTimer">--</span>
  </div>
  ${metaRowHTML}
  <div class="spk-arena">
    <div class="spk-diamond-grid" id="spkGrid">
      <div class="spk-slot spk-slot-top"></div>
      <div class="spk-slot spk-slot-left"></div>
      <div class="spk-slot spk-slot-right"></div>
      <div class="spk-slot spk-slot-bottom"></div>
    </div>
    <div class="spk-undo-row">
      <button class="spk-undo-btn" style="visibility:hidden" data-action="undo">↶ Undo</button>
    </div>
    <!-- operator overlay: same 2×2 circular layout as base game -->
    <div class="spk-op-overlay" id="spkOpOverlay">
      <div class="operators-grid">
        <button class="op-btn" data-op="+">+</button>
        <button class="op-btn" data-op="-">−</button>
        <button class="op-btn" data-op="*">×</button>
        <button class="op-btn" data-op="/">÷</button>
      </div>
    </div>
    ${extraOverlayHTML}
  </div>
</div>`;
    }

    // Wire up shared arena interactions (cards + operators + undo + back)
    // onOp(round, op) → newRound | null
    // onResolve(round) → called when only 1 card left
    function wireArena(el, getRound, setRound, onResolve) {
        const arena = el.querySelector('.spk-arena');
        if (!arena) return;

        arena.addEventListener('click', (e) => {
            const cardEl   = e.target.closest('[data-card-idx]');
            const opBtn    = e.target.closest('[data-op]');
            const undoBtn  = e.target.closest('[data-action="undo"]');
            const opOvl    = e.target.closest('.spk-op-overlay');

            if (undoBtn) {
                setRound(roundUndo(getRound()));
                renderBoard(el, getRound());
                return;
            }
            if (cardEl) {
                setRound(roundSelectCard(getRound(), parseInt(cardEl.dataset.cardIdx, 10)));
                renderBoard(el, getRound());
                return;
            }
            if (opBtn) {
                const next = roundApplyOp(getRound(), opBtn.dataset.op);
                if (!next) return;
                setRound(next);
                renderBoard(el, getRound());
                if (roundRemaining(next).length === 1) onResolve(next);
                return;
            }
            // Tap overlay backdrop (not a button) → deselect
            if (opOvl && !opBtn) {
                const r = getRound();
                setRound({ ...r, selected: [] });
                renderBoard(el, getRound());
            }
        });
    }

    // ============================================================
    // MODE A: AFTER-HOURS FLOOD
    // ============================================================
    function startFloodMode(digits) {
        let round    = createRound([...digits]);
        let started  = null;
        let rafId    = null;
        let finished = false;

        const duration = getFloodDuration();

        showOverlay((el) => {
            el.innerHTML = buildGameScreenHTML(
                'After&#8209;Hours Flood',
                '', // no meta row for flood
                '<div class="spk-water" id="spkWater"></div>'
            );

            const screen  = el.querySelector('.spk-game-screen');
            const timerEl = el.querySelector('#spkTimer');
            const waterEl = el.querySelector('#spkWater');

            timerEl.textContent = fmtMs(duration);

            el.querySelector('.spk-back-btn').addEventListener('click', () => {
                finished = true;
                cancelAnimationFrame(rafId);
                showSpeakeasyMenu();
            });

            let _round = round;
            wireArena(
                el,
                () => _round,
                (r) => { _round = r; round = r; },
                (resolved) => {
                    if (finished) return;
                    if (roundIsSolved(resolved)) {
                        finished = true;
                        cancelAnimationFrame(rafId);
                        const remaining = Math.max(0, duration - (Date.now() - started));
                        saveFloodPB(remaining);
                        _showFloodWin(screen, remaining);
                    } else {
                        // Wrong answer: reset after short delay
                        const snap = [...digits];
                        setTimeout(() => {
                            if (finished) return;
                            _round = createRound(snap);
                            round  = _round;
                            renderBoard(el, _round);
                        }, WRONG_RESET_MS);
                    }
                }
            );

            renderBoard(el, round);
            started = Date.now();

            function tick() {
                if (finished) return;
                const elapsed   = Date.now() - started;
                const remaining = duration - elapsed;

                if (remaining <= 0) {
                    finished = true;
                    waterEl.style.height = '100%';
                    timerEl.textContent  = '0s';
                    _showFloodFail(screen, digits);
                    return;
                }

                waterEl.style.height = ((elapsed / duration) * 100).toFixed(1) + '%';
                timerEl.textContent  = fmtMs(remaining);
                timerEl.classList.toggle('spk-timer-warn', remaining < 10000);
                rafId = requestAnimationFrame(tick);
            }
            rafId = requestAnimationFrame(tick);
        });
    }

    function _showFloodWin(screen, remainingMs) {
        const pb   = getFloodPB();
        const isPB = pb !== null && remainingMs >= pb;
        screen.innerHTML = `
<div class="spk-result">
  <div class="spk-result-icon">💧</div>
  <div class="spk-result-heading">Survived!</div>
  <div class="spk-result-stat">${fmtMs(remainingMs)} remaining</div>
  ${isPB  ? '<div class="spk-result-new-pb">New best!</div>'
          : (pb !== null ? `<div class="spk-result-prev-pb">Best: ${fmtMs(pb)} left</div>` : '')}
  <div class="spk-result-actions">
    <button class="spk-btn spk-btn-share"   id="spkShareBtn">Share</button>
    <button class="spk-btn spk-btn-primary" id="spkRetryBtn">Play Again</button>
    <button class="spk-btn spk-btn-ghost"   id="spkBackBtn">Back</button>
  </div>
</div>`;
        screen.querySelector('#spkShareBtn').addEventListener('click', () =>
            shareText(`I survived After-Hours Flood with ${fmtMs(remainingMs)} left. Can you?`));
        screen.querySelector('#spkRetryBtn').addEventListener('click', () =>
            startFloodMode(getTodayDigits()));
        screen.querySelector('#spkBackBtn').addEventListener('click', showSpeakeasyMenu);
    }

    function _showFloodFail(screen, digits) {
        const pb = getFloodPB();
        screen.innerHTML = `
<div class="spk-result spk-result-fail">
  <div class="spk-result-icon">🌊</div>
  <div class="spk-result-heading">Flooded.</div>
  ${pb !== null ? `<div class="spk-result-prev-pb">Best: ${fmtMs(pb)} left</div>` : ''}
  <div class="spk-result-actions">
    <button class="spk-btn spk-btn-primary" id="spkRetryBtn">Retry</button>
    <button class="spk-btn spk-btn-ghost"   id="spkBackBtn">Back</button>
  </div>
</div>`;
        screen.querySelector('#spkRetryBtn').addEventListener('click', () =>
            startFloodMode(getTodayDigits()));
        screen.querySelector('#spkBackBtn').addEventListener('click', showSpeakeasyMenu);
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

        const duration = getMmDuration();

        showOverlay((el) => {
            el.innerHTML = buildGameScreenHTML(
                'Market Maker',
                `<div class="spk-mm-meta">
                   <span class="spk-mm-score" id="spkMmScore">Quotes: 0</span>
                   <span class="spk-mm-rule">Integers 1–${MM_MAX_QUOTE} count</span>
                 </div>`,
                `<div class="spk-feedback" id="spkFb"></div>`
            );

            const screen   = el.querySelector('.spk-game-screen');
            const timerEl  = el.querySelector('#spkTimer');
            const scoreEl  = el.querySelector('#spkMmScore');
            const fbEl     = el.querySelector('#spkFb');

            timerEl.textContent = fmtMs(duration);

            // Ledger lives below the arena
            const ledgerEl = document.createElement('div');
            ledgerEl.className = 'spk-ledger';
            ledgerEl.id = 'spkLedger';
            screen.appendChild(ledgerEl);

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
                ledgerEl.innerHTML = [...quoted].sort((a, b) => a - b)
                    .map(n => `<span class="spk-chip">${n}</span>`).join('');
            }

            let _round = round;
            wireArena(
                el,
                () => _round,
                (r) => { _round = r; round = r; },
                (resolved) => {
                    if (finished) return;
                    const val = roundGetValue(resolved);

                    if (val !== null && Number.isInteger(val) && val >= 1 && val <= MM_MAX_QUOTE) {
                        if (quoted.has(val)) {
                            showFb('Already quoted ' + val, 'dupe');
                        } else {
                            quoted.add(val);
                            score++;
                            scoreEl.textContent = 'Quotes: ' + score;
                            renderLedger();
                            showFb('+1 · ' + val, 'new');
                        }
                    } else {
                        showFb(val !== null ? val + " — doesn't count" : 'Invalid', 'bad');
                    }

                    const snap = [...digits];
                    setTimeout(() => {
                        if (finished) return;
                        _round = createRound(snap);
                        round  = _round;
                        renderBoard(el, _round);
                    }, QUOTE_RESET_MS);
                }
            );

            renderBoard(el, round);
            renderLedger();
            started = Date.now();

            function tick() {
                if (finished) return;
                const remaining = duration - (Date.now() - started);
                if (remaining <= 0) {
                    finished = true;
                    timerEl.textContent = '0s';
                    saveMmPB(score);
                    _showMmEnd(screen, score, quoted);
                    return;
                }
                timerEl.textContent = fmtMs(remaining);
                timerEl.classList.toggle('spk-timer-warn', remaining < 10000);
                rafId = requestAnimationFrame(tick);
            }
            rafId = requestAnimationFrame(tick);
        });
    }

    function _showMmEnd(screen, score, quoted) {
        const pb     = getMmPB();
        const isPB   = pb !== null && score >= pb;
        const sorted = [...quoted].sort((a, b) => a - b);
        screen.innerHTML = `
<div class="spk-result">
  <div class="spk-result-icon">📈</div>
  <div class="spk-result-heading">Time's Up!</div>
  <div class="spk-result-stat">${score} quote${score !== 1 ? 's' : ''}</div>
  ${isPB  ? '<div class="spk-result-new-pb">New best!</div>'
          : (pb !== null ? `<div class="spk-result-prev-pb">Best: ${pb}</div>` : '')}
  ${sorted.length > 0
    ? `<div class="spk-result-ledger">${sorted.map(n => `<span class="spk-chip">${n}</span>`).join('')}</div>`
    : ''}
  <div class="spk-result-actions">
    <button class="spk-btn spk-btn-share"   id="spkShareBtn">Share</button>
    <button class="spk-btn spk-btn-primary" id="spkRetryBtn">Play Again</button>
    <button class="spk-btn spk-btn-ghost"   id="spkBackBtn">Back</button>
  </div>
</div>`;
        screen.querySelector('#spkShareBtn').addEventListener('click', () =>
            shareText(`I quoted ${score} number${score !== 1 ? 's' : ''} in Market Maker (1–${MM_MAX_QUOTE}). Can you beat me?`));
        screen.querySelector('#spkRetryBtn').addEventListener('click', () =>
            startMarketMode(getTodayDigits()));
        screen.querySelector('#spkBackBtn').addEventListener('click', showSpeakeasyMenu);
    }

    // ============================================================
    // SECRET DOOR  (🔑 key icon, injected into the victory card)
    // ============================================================
    function injectKeyIcon() {
        const card = document.getElementById('victoryCard');
        if (!card) return;
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
    // OBSERVER  (watches #victoryBackdrop — zero changes to app.js)
    // ============================================================
    function observeVictoryCard() {
        const backdrop = document.getElementById('victoryBackdrop');
        if (!backdrop) return;
        let wasVisible = false;
        const obs = new MutationObserver(() => {
            const visible = backdrop.classList.contains('show');
            if (visible && !wasVisible) {
                wasVisible = true;
                if (isRegistered()) injectKeyIcon();
            }
            if (!visible && wasVisible) {
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
        refreshAuthState().catch(() => {});
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', observeVictoryCard);
        } else {
            observeVictoryCard();
        }
    }

    init();
})();
