/**
 * speakeasy.js — "After Hours" unified order-book mode for Make24
 *
 * Gated behind isRegistered(). Zero modifications to app.js or style.css.
 * A MutationObserver watches the victory card to inject the 🔑 entry point.
 *
 * Single mode: After Hours
 *   - Uses today's 4 digits
 *   - Pre-computes an "order book": all integers in [ORDER_MIN..ORDER_MAX]
 *     achievable from those digits with +−×÷ using all four exactly once
 *   - Player fills orders by building expressions on the diamond board
 *   - Rising water IS the timer (durationMs = totalOrders × SECONDS_PER_ORDER × 1000)
 *   - Win: fill all orders before water tops out
 *   - Lose: water reaches top before all orders are filled
 *
 * ─── TUNE THESE CONSTANTS ────────────────────────────────────────
 *   ORDER_MIN         = 1    smallest integer that counts as an order
 *   ORDER_MAX         = 24   largest  integer that counts as an order
 *   SECONDS_PER_ORDER = 30   seconds of play-time granted per order
 * ──────────────────────────────────────────────────────────────────
 *
 * Storage keys (never collide with base-game keys):
 *   make24_afterhours_best   — JSON { count, total, pct } — best session
 *
 * Registration gate:
 *   • URL param  ?speakeasy=1
 *   • localStorage make24_registered = "1"
 *   • Supabase session (wired into existing auth)
 *
 * Console debug helper (local only):
 *   window.make24DebugSetRegistered(true/false)
 */
(function () {
    'use strict';

    // ============================================================
    // CONSTANTS — tune here
    // ============================================================
    const ORDER_MIN         = 1;
    const ORDER_MAX         = 24;
    const SECONDS_PER_ORDER = 30;   // seconds per order in the book
    const RESET_MS          = 600;  // delay before board resets after expression resolves

    const AH_BEST_KEY    = 'make24_afterhours_best';
    const SLOT_CLASSES   = ['spk-slot-top', 'spk-slot-left', 'spk-slot-right', 'spk-slot-bottom'];

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
    function getAhBest() {
        const v = localStorage.getItem(AH_BEST_KEY);
        return v ? JSON.parse(v) : null;
    }

    function saveAhBest(count, total) {
        const pct = Math.round(100 * count / total);
        const cur = getAhBest();
        if (!cur || count > cur.count || (count === cur.count && pct > cur.pct)) {
            localStorage.setItem(AH_BEST_KEY, JSON.stringify({ count, total, pct }));
        }
    }

    // ============================================================
    // RATIONAL ARITHMETIC
    // Avoids floating-point drift when evaluating expressions.
    // Represents numbers as { n: numerator, d: denominator } (d > 0, reduced).
    // ============================================================
    function gcd(a, b) {
        a = Math.abs(a); b = Math.abs(b);
        while (b) { const t = b; b = a % b; a = t; }
        return a || 1;
    }

    function rat(n, d) {
        if (d === 0) return null;
        const g = gcd(Math.abs(n), Math.abs(d));
        const s = d < 0 ? -1 : 1;
        return { n: s * n / g, d: s * d / g };
    }

    // All 6 pairwise operations (handles a-b, b-a, a/b, b/a)
    function ratOps(a, b) {
        return [
            rat(a.n * b.d + b.n * a.d, a.d * b.d),                              // a + b
            rat(a.n * b.d - b.n * a.d, a.d * b.d),                              // a - b
            rat(b.n * a.d - a.n * b.d, b.d * a.d),                              // b - a
            rat(a.n * b.n, a.d * b.d),                                           // a * b
            b.n !== 0 ? rat(a.n * b.d, a.d * b.n) : null,                       // a / b
            a.n !== 0 ? rat(b.n * a.d, b.d * a.n) : null,                       // b / a
        ].filter(r => r !== null);
    }

    // Enumerate every value reachable from the given list of rationals.
    // Picks every pair, applies all 6 ops, recurses on the remaining + result.
    function allRatResults(rats) {
        if (rats.length === 1) return [rats[0]];
        const out = [];
        for (let i = 0; i < rats.length; i++) {
            for (let j = i + 1; j < rats.length; j++) {
                const rest = rats.filter((_, k) => k !== i && k !== j);
                for (const c of ratOps(rats[i], rats[j])) {
                    for (const r of allRatResults([c, ...rest])) {
                        out.push(r);
                    }
                }
            }
        }
        return out;
    }

    // Cache by sorted digit key so we only solve once per session per unique hand.
    const _orderCache = {};
    function computeOrderBook(digits, min, max) {
        const key = [...digits].sort((a, b) => a - b).join(',');
        if (!_orderCache[key]) {
            const rats = digits.map(d => rat(d, 1));
            const achievable = new Set();
            for (const r of allRatResults(rats)) {
                if (r.d === 1) achievable.add(r.n);   // integer result
            }
            // All integers in [min..max] achievable from these digits
            _orderCache[key] = [...achievable]
                .filter(n => Number.isFinite(n))
                .sort((a, b) => a - b);
        }
        return _orderCache[key].filter(n => n >= min && n <= max);
    }

    // ============================================================
    // ROUND ENGINE  (pure functions — unchanged from previous version)
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

    function createRound(digits) {
        return {
            cards:    digits.map((v, i) => ({ value: v, slot: i, used: false })),
            selected: [],
            history:  []
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
    // Compact timer display: "6:30", "0:45", "9s"
    function fmtTimer(ms) {
        const s = Math.max(0, Math.ceil(ms / 1000));
        const m = Math.floor(s / 60);
        const sec = s % 60;
        if (m === 0) return sec + 's';
        return `${m}:${sec.toString().padStart(2, '0')}`;
    }

    // Readable duration for the menu: "6m", "7m 30s"
    function fmtDuration(ms) {
        const s = Math.round(ms / 1000);
        const m = Math.floor(s / 60);
        const sec = s % 60;
        if (m === 0) return s + 's';
        return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
    }

    // Render a number as a DOM node, reusing app.js fraction renderer when available
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
    // Reuses base-game CSS classes (.card, .selected, .first, .second)
    // for pixel-identical cards.
    // ============================================================
    function renderBoard(el, round) {
        SLOT_CLASSES.forEach((cls, slotIdx) => {
            const slotEl = el.querySelector('.' + cls);
            if (!slotEl) return;

            const card    = [...round.cards].reverse().find(c => c.slot === slotIdx && !c.used);
            const cardIdx = card ? round.cards.indexOf(card) : -1;
            const existing    = slotEl.querySelector('.card');
            const existingIdx = existing ? parseInt(existing.dataset.cardIdx, 10) : -1;

            if (!card) { slotEl.innerHTML = ''; return; }

            const isFirst  = round.selected[0] === cardIdx;
            const isSecond = round.selected[1] === cardIdx;
            const cls2 = 'card' + (isFirst ? ' selected first' : '') + (isSecond ? ' selected second' : '');

            if (existingIdx === cardIdx) {
                existing.className = cls2;
            } else {
                slotEl.innerHTML = '';
                const cardEl = document.createElement('div');
                cardEl.className = cls2;
                cardEl.dataset.cardIdx = cardIdx;
                cardEl.appendChild(makeNumberNode(card.value));
                slotEl.appendChild(cardEl);
            }
        });

        const opOverlay = el.querySelector('.spk-op-overlay');
        if (opOverlay) opOverlay.classList.toggle('spk-op-show', round.selected.length === 2);

        const undoBtn = el.querySelector('.spk-undo-btn');
        if (undoBtn) undoBtn.style.visibility = round.history.length > 0 ? 'visible' : 'hidden';
    }

    // ============================================================
    // SHARED ARENA INTERACTION WIRING
    // ============================================================
    function wireArena(el, getRound, setRound, onResolve) {
        const arena = el.querySelector('.spk-arena');
        if (!arena) return;

        arena.addEventListener('click', (e) => {
            const cardEl  = e.target.closest('[data-card-idx]');
            const opBtn   = e.target.closest('[data-op]');
            const undoEl  = e.target.closest('[data-action="undo"]');
            const opOvl   = e.target.closest('.spk-op-overlay');

            if (undoEl) {
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
            // Tap overlay backdrop → deselect
            if (opOvl && !opBtn) {
                const r = getRound();
                setRound({ ...r, selected: [] });
                renderBoard(el, getRound());
            }
        });
    }

    // ============================================================
    // SPEAKEASY MENU  (single mode)
    // ============================================================
    function showSpeakeasyMenu() {
        const digits    = getTodayDigits();
        const orderBook = computeOrderBook(digits, ORDER_MIN, ORDER_MAX);
        const total     = orderBook.length;
        const durationMs = total * SECONDS_PER_ORDER * 1000;
        const pb = getAhBest();

        showOverlay((el) => {
            el.innerHTML = `
<div class="spk-sheet" role="dialog" aria-modal="true" aria-label="After Hours">
  <button class="spk-close-btn" aria-label="Close">&times;</button>
  <div class="spk-menu-header">
    <div class="spk-menu-title">After Hours</div>
    <div class="spk-menu-subtitle">How many orders can you fill?</div>
    <div class="spk-menu-digits">${digits.join(' · ')}</div>
  </div>
  <div class="spk-mode-list">
    <button class="spk-mode-card" id="spkStartBtn">
      <div class="spk-mode-icon">🌊</div>
      <div class="spk-mode-info">
        <div class="spk-mode-name">After Hours</div>
        <div class="spk-mode-desc">${total} orders &middot; ${fmtDuration(durationMs)}</div>
        <div class="spk-mode-pb">${pb
            ? `Best: ${pb.count}/${pb.total} (${pb.pct}%)`
            : 'No record yet'}</div>
      </div>
    </button>
  </div>
</div>`;
            el.querySelector('.spk-close-btn').addEventListener('click', hideOverlay);
            el.querySelector('#spkStartBtn').addEventListener('click', () =>
                startAfterHoursMode(digits, orderBook));
            el.addEventListener('click', (e) => { if (e.target === el) hideOverlay(); });
        });
    }

    // ============================================================
    // AFTER HOURS MODE
    // ============================================================
    function startAfterHoursMode(digits, orderBook) {
        const totalOrders = orderBook.length;
        const durationMs  = totalOrders * SECONDS_PER_ORDER * 1000;

        if (totalOrders === 0) {
            // Degenerate hand — just show the menu again
            showSpeakeasyMenu();
            return;
        }

        let foundSet = new Set();
        let round    = createRound([...digits]);
        let started  = null;
        let rafId    = null;
        let finished = false;
        let fbTimer  = null;

        showOverlay((el) => {
            el.innerHTML = `
<div class="spk-game-screen">
  <div class="spk-topbar">
    <button class="spk-back-btn" aria-label="Back">&#8592; Back</button>
    <span class="spk-game-label">After Hours</span>
    <span class="spk-timer" id="spkTimer">${fmtTimer(durationMs)}</span>
  </div>
  <div class="spk-ah-meta">
    <span class="spk-filled" id="spkFilled">Filled: 0/${totalOrders}</span>
    <span class="spk-ah-rule">Integers 1&#8211;${ORDER_MAX}</span>
  </div>
  <div class="spk-arena">
    <div class="spk-diamond-grid">
      <div class="spk-slot spk-slot-top"></div>
      <div class="spk-slot spk-slot-left"></div>
      <div class="spk-slot spk-slot-right"></div>
      <div class="spk-slot spk-slot-bottom"></div>
    </div>
    <div class="spk-undo-row">
      <button class="spk-undo-btn" style="visibility:hidden" data-action="undo">&#8630; Undo</button>
    </div>
    <div class="spk-inline-fb" id="spkFb"></div>
    <!-- Operator overlay: base-game .operators-grid + .op-btn classes -->
    <div class="spk-op-overlay">
      <div class="operators-grid">
        <button class="op-btn" data-op="+">+</button>
        <button class="op-btn" data-op="-">&#8722;</button>
        <button class="op-btn" data-op="*">&times;</button>
        <button class="op-btn" data-op="/">&divide;</button>
      </div>
    </div>
    <!-- Water overlay (pointer-events:none, rises behind cards) -->
    <div class="spk-water" id="spkWater"></div>
  </div>
  <!-- Order book: below arena, not covered by water -->
  <div class="spk-order-book" id="spkOrderBook"></div>
</div>`;

            const screen   = el.querySelector('.spk-game-screen');
            const timerEl  = el.querySelector('#spkTimer');
            const waterEl  = el.querySelector('#spkWater');
            const filledEl = el.querySelector('#spkFilled');
            const bookEl   = el.querySelector('#spkOrderBook');
            const fbEl     = el.querySelector('#spkFb');

            // Build order book slots (sorted ascending, numbers hidden until found)
            orderBook.forEach(n => {
                const slot = document.createElement('div');
                slot.className = 'spk-order-slot';
                slot.dataset.order = n;
                bookEl.appendChild(slot);
            });

            el.querySelector('.spk-back-btn').addEventListener('click', () => {
                finished = true;
                cancelAnimationFrame(rafId);
                clearTimeout(fbTimer);
                showSpeakeasyMenu();
            });

            function showFb(msg, cls) {
                if (fbTimer) clearTimeout(fbTimer);
                fbEl.textContent = msg;
                fbEl.className   = 'spk-inline-fb spk-fb-' + cls + ' spk-fb-show';
                fbTimer = setTimeout(() => { fbEl.classList.remove('spk-fb-show'); }, 900);
            }

            function markFilled(n) {
                foundSet.add(n);
                filledEl.textContent = `Filled: ${foundSet.size}/${totalOrders}`;
                const slot = bookEl.querySelector(`[data-order="${n}"]`);
                if (slot && !slot.classList.contains('spk-found')) {
                    slot.textContent = n;
                    slot.classList.add('spk-found');
                }
            }

            let _round = round;
            wireArena(
                el,
                () => _round,
                (r) => { _round = r; round = r; },
                (resolved) => {
                    if (finished) return;
                    const val = roundGetValue(resolved);

                    if (val !== null && Number.isInteger(val) && orderBook.includes(val)) {
                        if (foundSet.has(val)) {
                            showFb('Already filled · ' + val, 'dupe');
                        } else {
                            markFilled(val);
                            showFb('+1 · ' + val, 'new');

                            // All orders found?
                            if (foundSet.size === totalOrders) {
                                finished = true;
                                cancelAnimationFrame(rafId);
                                saveAhBest(foundSet.size, totalOrders);
                                // Brief celebration pause before result screen
                                setTimeout(() => _showAhEnd(screen, foundSet, orderBook, true), 700);
                                return;
                            }
                        }
                    } else if (val !== null && Number.isInteger(val)) {
                        // Integer but outside range or not achievable — just reset silently
                        // (no harsh feedback; players are exploring)
                    } else if (val !== null) {
                        showFb('Not an integer', 'bad');
                    }

                    // Reset to original 4 digits for next attempt
                    const snap = [...digits];
                    setTimeout(() => {
                        if (finished) return;
                        _round = createRound(snap);
                        round  = _round;
                        renderBoard(el, _round);
                    }, RESET_MS);
                }
            );

            renderBoard(el, round);
            started = Date.now();

            function tick() {
                if (finished) return;
                const elapsed   = Date.now() - started;
                const remaining = durationMs - elapsed;

                if (remaining <= 0) {
                    finished = true;
                    waterEl.style.height = '100%';
                    timerEl.textContent  = '0:00';
                    timerEl.classList.add('spk-timer-warn');
                    saveAhBest(foundSet.size, totalOrders);
                    _showAhEnd(screen, foundSet, orderBook, false);
                    return;
                }

                waterEl.style.height = ((elapsed / durationMs) * 100).toFixed(1) + '%';
                timerEl.textContent  = fmtTimer(remaining);
                timerEl.classList.toggle('spk-timer-warn', remaining < 15000);
                rafId = requestAnimationFrame(tick);
            }
            rafId = requestAnimationFrame(tick);
        });
    }

    // ============================================================
    // END SCREEN
    // ============================================================
    function _showAhEnd(screen, foundSet, orderBook, isComplete) {
        const total = orderBook.length;
        const found = foundSet.size;
        const pct   = Math.round(100 * found / total);
        const pb    = getAhBest();
        const isPB  = !pb || found > pb.count || (found === pb.count && pct > pb.pct);

        // Full order book: found chips bright, missed chips dim
        const chipsHTML = orderBook.map(n =>
            foundSet.has(n)
                ? `<span class="spk-chip spk-chip-found">${n}</span>`
                : `<span class="spk-chip spk-chip-missed">${n}</span>`
        ).join('');

        screen.innerHTML = `
<div class="spk-result">
  <div class="spk-result-icon">${isComplete ? '✓' : '🌊'}</div>
  <div class="spk-result-heading">${isComplete ? 'All orders filled!' : "Time\u2019s up"}</div>
  <div class="spk-result-stat">${found}/${total} &middot; ${pct}%</div>
  ${isPB
    ? '<div class="spk-result-new-pb">New best!</div>'
    : (pb ? `<div class="spk-result-prev-pb">Best: ${pb.count}/${pb.total} (${pb.pct}%)</div>` : '')}
  <div class="spk-result-book">${chipsHTML}</div>
  <div class="spk-result-actions">
    <button class="spk-btn spk-btn-share"   id="spkShareBtn">Share</button>
    <button class="spk-btn spk-btn-primary" id="spkRetryBtn">Play Again</button>
    <button class="spk-btn spk-btn-ghost"   id="spkBackBtn">Back</button>
  </div>
</div>`;

        screen.querySelector('#spkShareBtn').addEventListener('click', () =>
            shareText(`I filled ${found}/${total} orders (${pct}%) in After Hours. Can you beat me?`));
        screen.querySelector('#spkRetryBtn').addEventListener('click', () => {
            const digits    = getTodayDigits();
            const orderBook = computeOrderBook(digits, ORDER_MIN, ORDER_MAX);
            startAfterHoursMode(digits, orderBook);
        });
        screen.querySelector('#spkBackBtn').addEventListener('click', showSpeakeasyMenu);
    }

    // ============================================================
    // SECRET DOOR  (🔑 injected into the victory card)
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
