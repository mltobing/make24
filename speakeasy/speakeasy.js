/**
 * speakeasy.js — "After Hours" order-book mode for Make24
 *
 * Gated behind isRegistered(). Zero modifications to app.js or style.css.
 * A MutationObserver watches the victory card to inject the 🔑 entry point.
 *
 * Tapping 🔑 launches After Hours directly (no intermediate selection screen).
 * A one-time intro overlay is shown the first time (INTRO_KEY in localStorage).
 *
 * After Hours:
 *   - Pre-computes all integers in [ORDER_MIN..ORDER_MAX] achievable from
 *     today's 4 digits using exact rational arithmetic (+−×÷, all digits once).
 *   - Stores one solution expression tree per reachable target.
 *   - Player fills orders on the diamond board; orders appear as bubbles in a
 *     ring around the arena — not a bottom lump.
 *   - Rising water IS the timer (durationMs = |orderBook| × SECONDS_PER_ORDER × 1000).
 *   - End screen: missed orders are tappable → modal shows expression + Watch animation.
 *
 * ─── TUNE THESE CONSTANTS ────────────────────────────────────────────
 *   ORDER_MIN         = 1    smallest integer that counts as an order
 *   ORDER_MAX         = 24   largest  integer that counts as an order
 *   SECONDS_PER_ORDER = 30   seconds of play-time granted per reachable order
 * ─────────────────────────────────────────────────────────────────────
 *
 * Storage keys (never collide with base-game keys):
 *   make24_afterhours_best      — JSON { count, total, pct }
 *   make24_afterhours_introSeen — "1" once intro has been shown
 *
 * Solution plans are represented as expression trees:
 *   ExprNode = { type:'leaf', id:number, value:number }
 *            | { type:'op', op:string, left:ExprNode, right:ExprNode, r:Rat }
 *   Where Rat = { n:number, d:number } (reduced fraction, d > 0).
 *   solutionsByTarget: Map<number, ExprNode>  (one tree per reachable integer)
 *
 * Console debug helper:
 *   window.make24DebugSetRegistered(true/false)
 */
(function () {
    'use strict';

    // ============================================================
    // CONSTANTS — tune here
    // ============================================================
    const ORDER_MIN         = 1;
    const ORDER_MAX         = 24;
    const SECONDS_PER_ORDER = 30;   // seconds per reachable order
    const RESET_MS          = 600;  // delay before board resets after expression resolves
    const STEP_MS           = 700;  // ms between highlight and apply in demo animation

    const AH_BEST_KEY  = 'make24_afterhours_best';
    const INTRO_KEY    = 'make24_afterhours_introSeen';
    const SLOT_CLASSES = ['spk-slot-top', 'spk-slot-left', 'spk-slot-right', 'spk-slot-bottom'];

    // ============================================================
    // GATE
    // ============================================================
    let _registeredFromAuth = false;

    function checkUrlParam() {
        try { return new URLSearchParams(window.location.search).get('speakeasy') === '1'; }
        catch (_) { return false; }
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

    // Returns true when today's daily puzzle is already solved (reads app.js's localStorage key).
    function isTodaySolved() {
        try {
            const saved = JSON.parse(localStorage.getItem('make24_v5') || '{}');
            const today = window.getTodayPuzzleNumber ? window.getTodayPuzzleNumber() : null;
            return today !== null && !!saved?.history?.[today]?.completed;
        } catch (_) { return false; }
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
    // Represents numbers as { n, d } (reduced, d > 0).
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

    // ============================================================
    // SOLVER WITH EXPRESSION TREES
    //
    // Each element in the recursive array is { r:Rat, tree:ExprNode }.
    // allResults() enumerates every achievable value from a list of nodes.
    // ============================================================
    function allResults(nodes) {
        if (nodes.length === 1) return [nodes[0]];
        const out = [];
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i], b = nodes[j];
                const ar = a.r, br = b.r;
                const rest = nodes.filter((_, k) => k !== i && k !== j);

                const push = (op, r, la, lb) => {
                    if (r) {
                        const combined = { r, tree: { type: 'op', op, left: la.tree, right: lb.tree, r } };
                        for (const res of allResults([combined, ...rest])) out.push(res);
                    }
                };

                push('+', rat(ar.n * br.d + br.n * ar.d, ar.d * br.d), a, b);           // a + b
                push('-', rat(ar.n * br.d - br.n * ar.d, ar.d * br.d), a, b);           // a - b
                push('-', rat(br.n * ar.d - ar.n * br.d, br.d * ar.d), b, a);           // b - a  (left=b)
                push('*', rat(ar.n * br.n, ar.d * br.d), a, b);                         // a * b
                if (br.n !== 0) push('/', rat(ar.n * br.d, ar.d * br.n), a, b);         // a / b
                if (ar.n !== 0) push('/', rat(br.n * ar.d, br.d * ar.n), b, a);         // b / a  (left=b)
            }
        }
        return out;
    }

    // Returns Map<integer, ExprNode> for all reachable integers in [min..max].
    // Memoised by sorted digit key so computation runs once per unique hand.
    const _solutionCache = {};

    function computeSolutions(digits, min, max) {
        const key = [...digits].sort((a, b) => a - b).join(',');
        if (_solutionCache[key]) return _solutionCache[key];

        const leaves = digits.map((d, i) => ({
            r:    rat(d, 1),
            tree: { type: 'leaf', id: i, value: d }
        }));

        const solutions = new Map();
        for (const { r, tree } of allResults(leaves)) {
            if (r && r.d === 1 && r.n >= min && r.n <= max && Number.isFinite(r.n) && !solutions.has(r.n)) {
                solutions.set(r.n, tree);
            }
        }

        _solutionCache[key] = solutions;
        return solutions;
    }

    // ============================================================
    // EXPRESSION RENDERING
    // ============================================================
    const OP_STR = { '+': '+', '-': '−', '*': '×', '/': '÷' };

    function treeToExpr(node) {
        if (node.type === 'leaf') return String(node.value);
        const op = OP_STR[node.op] || node.op;
        const l  = node.left.type  === 'op' ? `(${treeToExpr(node.left)})`  : treeToExpr(node.left);
        const r  = node.right.type === 'op' ? `(${treeToExpr(node.right)})` : treeToExpr(node.right);
        return `${l} ${op} ${r}`;
    }

    // Extract ordered animation steps from the tree.
    // Leaf IDs 0–3 map to initial digit cards; result IDs start at 4.
    // Returns Array<{ aId, bId, op, resultId }>
    function treeToSteps(tree) {
        let nextId = 4;
        const steps = [];
        function walk(node) {
            if (node.type === 'leaf') return node.id;
            const aId     = walk(node.left);
            const bId     = walk(node.right);
            const resultId = nextId++;
            steps.push({ aId, bId, op: node.op, resultId });
            return resultId;
        }
        walk(tree);
        return steps;
    }

    // ============================================================
    // ROUND ENGINE  (pure functions)
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

    // Force-select exactly two cards (used in demo animation).
    function roundSelectTwo(round, aIdx, bIdx) {
        return { ...round, selected: [aIdx, bIdx] };
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
    function roundGetValue(round)  {
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
    function fmtTimer(ms) {
        const s   = Math.max(0, Math.ceil(ms / 1000));
        const m   = Math.floor(s / 60);
        const sec = s % 60;
        return m === 0 ? sec + 's' : `${m}:${sec.toString().padStart(2, '0')}`;
    }

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
        _overlay.id        = 'spkOverlay';
        _overlay.className = 'spk-overlay';
        document.body.appendChild(_overlay);
        return _overlay;
    }

    function showOverlay(buildFn) {
        const el = ensureOverlay();
        el.innerHTML = '';
        el.className = 'spk-overlay spk-visible';
        buildFn(el);
    }

    function hideOverlay() {
        if (!_overlay) return;
        _overlay.classList.remove('spk-visible');
        setTimeout(() => { if (_overlay) _overlay.innerHTML = ''; }, 350);
    }

    // ============================================================
    // DIAMOND BOARD RENDERER
    // Works for both the main arena and the mini demo board.
    // Reuses base-game .card / .selected / .first / .second classes.
    // ============================================================
    function renderBoard(el, round) {
        SLOT_CLASSES.forEach((cls, slotIdx) => {
            const slotEl = el.querySelector('.' + cls);
            if (!slotEl) return;

            const card        = [...round.cards].reverse().find(c => c.slot === slotIdx && !c.used);
            const cardIdx     = card ? round.cards.indexOf(card) : -1;
            const existing    = slotEl.querySelector('.card');
            const existingIdx = existing ? parseInt(existing.dataset.cardIdx, 10) : -1;

            if (!card) { slotEl.innerHTML = ''; return; }

            const isFirst  = round.selected[0] === cardIdx;
            const isSecond = round.selected[1] === cardIdx;
            const cls2     = 'card' + (isFirst ? ' selected first' : '') + (isSecond ? ' selected second' : '');

            if (existingIdx === cardIdx) {
                existing.className = cls2;
            } else {
                slotEl.innerHTML = '';
                const cardEl = document.createElement('div');
                cardEl.className      = cls2;
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
    // ARENA WIRING  (event delegation on the main game arena)
    // ============================================================
    function wireArena(el, getRound, setRound, onResolve) {
        const arena = el.querySelector('.spk-arena');
        if (!arena) return;

        arena.addEventListener('click', (e) => {
            const cardEl = e.target.closest('[data-card-idx]');
            const opBtn  = e.target.closest('[data-op]');
            const undoEl = e.target.closest('[data-action="undo"]');
            const opOvl  = e.target.closest('.spk-op-overlay');

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
    // BUBBLE LAYOUT  (order slots positioned in an elliptical ring)
    //
    // Why ellipse, not circle?
    //   The diamond grid is 320 px wide on a ~390 px screen, leaving only
    //   ~35 px of horizontal margin per side. A circle big enough to clear
    //   the tiles would go off-screen left/right.
    //   An ellipse lets us use the much larger vertical space of the arena
    //   (typically 500–700 px) so most bubbles sit comfortably above/below
    //   the tiles while the left/right bubbles hug the screen edges.
    //
    //   rx  = horizontal semi-axis  (limited by screen width)
    //   ry  = vertical   semi-axis  (uses arena height — much more room)
    // ============================================================
    function positionBubbles(screenEl, arenaEl, orderBook) {
        const container = screenEl.querySelector('.spk-bubbles-container');
        if (!container || !orderBook.length) return;

        const screenRect = screenEl.getBoundingClientRect();
        const arenaRect  = arenaEl.getBoundingClientRect();

        // Diamond center relative to screenEl.
        // Shift cy up 30 px: undo-row (36 px) + fb-row (24 px) sit below the diamond
        // inside the arena flex-column, so the diamond's optical center is above
        // the arena's geometric center.
        const cx = arenaRect.left + arenaRect.width  / 2 - screenRect.left;
        const cy = arenaRect.top  + arenaRect.height / 2 - screenRect.top - 30;

        const BUBBLE_D = 30;          // diameter (px) — update .spk-bubble in CSS too
        const BR       = BUBBLE_D / 2;

        // rx: reach toward the left/right screen edges
        const rx = Math.max(140, Math.min(cx, screenRect.width - cx) - BR - 4);

        // ry: reach toward the top/bottom of the arena.
        //     Top bound: stay inside the arena (don't cover the meta row above it).
        //     Bottom bound: go all the way to the arena's bottom edge.
        const arenaTopRel    = arenaRect.top    - screenRect.top;
        const arenaBottomRel = arenaRect.bottom - screenRect.top;
        const ryUp   = Math.max(140, cy - arenaTopRel    - BR - 10);
        const ryDown = Math.max(140, arenaBottomRel - cy - BR - 10);
        // Use the smaller of the two so the ellipse is symmetric top-to-bottom.
        const ry = Math.min(ryUp, ryDown);

        // Always one ring — max 24 bubbles fits a single ellipse comfortably.
        const rings = [{ items: orderBook, rx, ry }];

        rings.forEach(({ items, rx, ry }) => {
            items.forEach((n, i) => {
                const angle = -Math.PI / 2 + i * (2 * Math.PI / items.length);
                const x = cx + rx * Math.cos(angle) - BUBBLE_D / 2;
                const y = cy + ry * Math.sin(angle) - BUBBLE_D / 2;
                const bubble = container.querySelector(`[data-order="${n}"]`);
                if (bubble) {
                    bubble.style.left = x.toFixed(1) + 'px';
                    bubble.style.top  = y.toFixed(1) + 'px';
                }
            });
        });
    }

    // ============================================================
    // INTRO SCREEN  (shown once on first After Hours launch)
    // ============================================================
    function showIntro(totalOrders, onStart) {
        showOverlay((el) => {
            el.classList.add('spk-overlay-center');
            el.innerHTML = `
<div class="spk-intro-card">
  <div class="spk-intro-icon">🌊</div>
  <div class="spk-intro-title">After Hours</div>
  <div class="spk-intro-body">Fill every order before the tide rises.</div>
  <div class="spk-intro-tag">Integers 1&ndash;${ORDER_MAX} &middot; ${totalOrders} orders today</div>
  <button class="spk-btn spk-btn-primary spk-intro-start">Let's go</button>
</div>`;
            el.querySelector('.spk-intro-start').addEventListener('click', () => {
                localStorage.setItem(INTRO_KEY, '1');
                onStart();
            });
        });
    }

    // ============================================================
    // DEMO ANIMATION  (plays solution steps on the mini board)
    // ============================================================
    function playDemoAnimation(miniEl, digits, steps, timeouts, onDone) {
        let demoRound      = createRound([...digits]);
        const idToCardIdx  = { 0: 0, 1: 1, 2: 2, 3: 3 };
        let stepIdx        = 0;
        renderBoard(miniEl, demoRound);

        function runStep() {
            if (stepIdx >= steps.length) { onDone(); return; }
            const step = steps[stepIdx++];
            const aIdx = idToCardIdx[step.aId];
            const bIdx = idToCardIdx[step.bId];

            // Phase 1: highlight the two operand cards
            demoRound = roundSelectTwo(demoRound, aIdx, bIdx);
            renderBoard(miniEl, demoRound);

            const t1 = setTimeout(() => {
                // Phase 2: apply the operator
                const next = roundApplyOp(demoRound, step.op);
                if (!next) { onDone(); return; }
                demoRound = next;
                idToCardIdx[step.resultId] = demoRound.cards.length - 1;
                renderBoard(miniEl, demoRound);

                const t2 = setTimeout(runStep, 500);
                timeouts.push(t2);
            }, STEP_MS);
            timeouts.push(t1);
        }

        const t0 = setTimeout(runStep, 300);
        timeouts.push(t0);
    }

    // ============================================================
    // SOLUTION MODAL  (tapped from end screen on a missed order)
    // ============================================================
    function showSolutionModal(gameScreen, n, tree, digits) {
        const expr  = treeToExpr(tree);
        const steps = treeToSteps(tree);

        const modal = document.createElement('div');
        modal.className = 'spk-solution-modal';
        modal.innerHTML = `
<div class="spk-sol-card">
  <div class="spk-sol-heading">How to make <span class="spk-sol-n">${n}</span></div>
  <div class="spk-sol-expr">${expr}</div>
  <div class="spk-mini-board">
    <div class="spk-mini-diamond-grid">
      <div class="spk-slot spk-slot-top"></div>
      <div class="spk-slot spk-slot-left"></div>
      <div class="spk-slot spk-slot-right"></div>
      <div class="spk-slot spk-slot-bottom"></div>
    </div>
  </div>
  <div class="spk-sol-actions">
    <button class="spk-btn spk-btn-primary spk-sol-watch">Watch</button>
    <button class="spk-btn spk-btn-ghost   spk-sol-close">Close</button>
  </div>
</div>`;

        gameScreen.appendChild(modal);

        const miniEl   = modal.querySelector('.spk-mini-board');
        const watchBtn = modal.querySelector('.spk-sol-watch');
        const closeBtn = modal.querySelector('.spk-sol-close');

        let demoTimeouts = [];
        let demoRunning  = false;

        // Render initial state
        renderBoard(miniEl, createRound([...digits]));

        function stopDemo() {
            demoTimeouts.forEach(clearTimeout);
            demoTimeouts    = [];
            demoRunning     = false;
            watchBtn.disabled    = false;
            watchBtn.textContent = 'Watch';
        }

        watchBtn.addEventListener('click', () => {
            if (demoRunning) return;
            demoRunning          = true;
            watchBtn.disabled    = true;
            watchBtn.textContent = 'Playing…';
            demoTimeouts         = [];
            // Reset board to initial digits before playing
            renderBoard(miniEl, createRound([...digits]));
            playDemoAnimation(miniEl, digits, steps, demoTimeouts, () => {
                demoRunning          = false;
                watchBtn.disabled    = false;
                watchBtn.textContent = 'Watch again';
            });
        });

        closeBtn.addEventListener('click', () => { stopDemo(); modal.remove(); });

        // Tap backdrop → close
        modal.addEventListener('click', (e) => {
            if (!e.target.closest('.spk-sol-card')) { stopDemo(); modal.remove(); }
        });
    }

    // ============================================================
    // END SCREEN
    // ============================================================
    function _showAhEnd(screen, foundSet, orderBook, solutionsByTarget, digits, isComplete) {
        const total = orderBook.length;
        const found = foundSet.size;
        const pct   = Math.round(100 * found / total);
        const pb    = getAhBest();
        const isPB  = !pb || found > pb.count || (found === pb.count && pct > pb.pct);

        const chipsHTML = orderBook.map(n => {
            if (foundSet.has(n)) {
                return `<span class="spk-chip spk-chip-found">${n}</span>`;
            }
            const hasSol = solutionsByTarget.has(n);
            return `<span class="spk-chip spk-chip-missed${hasSol ? ' spk-chip-tappable' : ''}"
                         data-missed="${n}"
                         title="${hasSol ? 'Tap to see solution' : ''}">${n}</span>`;
        }).join('');

        screen.innerHTML = `
<div class="spk-result">
  <div class="spk-result-icon">${isComplete ? '✓' : '🌊'}</div>
  <div class="spk-result-heading">${isComplete ? 'All orders filled!' : 'Time\u2019s up'}</div>
  <div class="spk-result-stat">${found}/${total} &middot; ${pct}%</div>
  ${isPB
      ? '<div class="spk-result-new-pb">New best!</div>'
      : (pb ? `<div class="spk-result-prev-pb">Best: ${pb.count}/${pb.total} (${pb.pct}%)</div>` : '')}
  ${found < total ? '<div class="spk-result-hint">Tap a missed order to see a solution.</div>' : ''}
  <div class="spk-result-book" id="spkResultBook">${chipsHTML}</div>
  <div class="spk-result-actions">
    <button class="spk-btn spk-btn-share"   id="spkShareBtn">Share</button>
    <button class="spk-btn spk-btn-primary" id="spkRetryBtn">Play Again</button>
    <button class="spk-btn spk-btn-ghost"   id="spkBackBtn">Close</button>
  </div>
</div>`;

        // Tap missed chip → solution modal
        screen.querySelector('#spkResultBook').addEventListener('click', (e) => {
            const chip = e.target.closest('[data-missed]');
            if (!chip) return;
            const n    = parseInt(chip.dataset.missed, 10);
            const tree = solutionsByTarget.get(n);
            if (tree) showSolutionModal(screen, n, tree, digits);
        });

        screen.querySelector('#spkShareBtn').addEventListener('click', () =>
            shareText(`I filled ${found}/${total} orders (${pct}%) in After Hours. Can you beat me?`));
        screen.querySelector('#spkRetryBtn').addEventListener('click', launchAfterHours);
        screen.querySelector('#spkBackBtn').addEventListener('click', hideOverlay);
    }

    // ============================================================
    // AFTER HOURS GAME SCREEN
    // ============================================================
    function startAfterHoursMode(digits, orderBook, solutionsByTarget) {
        const totalOrders = orderBook.length;
        const durationMs  = totalOrders * SECONDS_PER_ORDER * 1000;

        let foundSet = new Set();
        let round    = createRound([...digits]);
        let started  = null;
        let rafId    = null;
        let finished = false;
        let fbTimer  = null;

        showOverlay((el) => {
            // Bubbles are created here (un-positioned), positioned after layout below.
            const bubblesHTML = orderBook
                .map(n => `<div class="spk-bubble" data-order="${n}"></div>`)
                .join('');

            el.innerHTML = `
<div class="spk-game-screen">
  <div class="spk-bubbles-container" id="spkBubbles">${bubblesHTML}</div>
  <div class="spk-topbar">
    <button class="spk-back-btn" aria-label="Exit After Hours">&#8249;</button>
    <span class="spk-game-label">After Hours</span>
    <div class="spk-topbar-spacer"></div>
  </div>
  <div class="spk-arena" id="spkArena">
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
    <div class="spk-op-overlay">
      <div class="operators-grid">
        <button class="op-btn" data-op="+">+</button>
        <button class="op-btn" data-op="-">&#8722;</button>
        <button class="op-btn" data-op="*">&times;</button>
        <button class="op-btn" data-op="/">&divide;</button>
      </div>
    </div>
    <div class="spk-water" id="spkWater"></div>
  </div>
</div>`;

            const gameScreen = el.querySelector('.spk-game-screen');
            const arenaEl    = el.querySelector('#spkArena');
            const waterEl    = el.querySelector('#spkWater');
            const fbEl       = el.querySelector('#spkFb');

            el.querySelector('.spk-back-btn').addEventListener('click', () => {
                finished = true;
                cancelAnimationFrame(rafId);
                clearTimeout(fbTimer);
                hideOverlay();
            });

            function showFb(msg, cls) {
                if (fbTimer) clearTimeout(fbTimer);
                fbEl.textContent = msg;
                fbEl.className   = 'spk-inline-fb spk-fb-' + cls + ' spk-fb-show';
                fbTimer = setTimeout(() => fbEl.classList.remove('spk-fb-show'), 900);
            }

            function markFilled(n) {
                foundSet.add(n);
                const bubble = el.querySelector(`.spk-bubble[data-order="${n}"]`);
                if (bubble && !bubble.classList.contains('spk-bubble-found')) {
                    bubble.textContent = n;
                    bubble.classList.add('spk-bubble-found');
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
                            if (foundSet.size === totalOrders) {
                                finished = true;
                                cancelAnimationFrame(rafId);
                                saveAhBest(foundSet.size, totalOrders);
                                setTimeout(() => _showAhEnd(gameScreen, foundSet, orderBook, solutionsByTarget, digits, true), 700);
                                return;
                            }
                        }
                    } else if (val !== null && !Number.isInteger(val)) {
                        showFb('Not an integer', 'bad');
                    }

                    // Reset to original 4 digits for next attempt
                    setTimeout(() => {
                        if (finished) return;
                        _round = createRound([...digits]);
                        round  = _round;
                        renderBoard(el, _round);
                    }, RESET_MS);
                }
            );

            // Position bubbles after layout is stable, then start the clock
            requestAnimationFrame(() => {
                positionBubbles(gameScreen, arenaEl, orderBook);
                renderBoard(el, round);
                started = Date.now();
                rafId   = requestAnimationFrame(tick);
            });

            function tick() {
                if (finished) return;
                const elapsed   = Date.now() - started;
                const remaining = durationMs - elapsed;

                if (remaining <= 0) {
                    finished = true;
                    waterEl.style.height = '100%';
                    saveAhBest(foundSet.size, totalOrders);
                    _showAhEnd(gameScreen, foundSet, orderBook, solutionsByTarget, digits, false);
                    return;
                }

                waterEl.style.height = ((elapsed / durationMs) * 100).toFixed(1) + '%';
                // Low-time cue: faster wave in the final 30 s (no numbers — water IS the clock).
                waterEl.classList.toggle('spk-water-urgent', remaining < 30000);
                rafId = requestAnimationFrame(tick);
            }
        });
    }

    // ============================================================
    // LAUNCH  (direct entry — no selection screen)
    // ============================================================
    function launchAfterHours() {
        const digits            = getTodayDigits();
        const solutionsByTarget = computeSolutions(digits, ORDER_MIN, ORDER_MAX);
        const orderBook         = [...solutionsByTarget.keys()].sort((a, b) => a - b);

        // Debug: open the browser console to verify reachable orders.
        // For flexible digit sets like {2,3,5,8} every integer 1–24 is genuinely reachable.
        console.log(`[AfterHours] digits: ${digits.join(',')} → ${orderBook.length} reachable order(s) in [${ORDER_MIN}..${ORDER_MAX}]:`, orderBook);

        if (orderBook.length === 0) {
            // Pathological edge case — guard gracefully
            showOverlay((el) => {
                el.classList.add('spk-overlay-center');
                el.innerHTML = `
<div class="spk-intro-card">
  <div class="spk-intro-title">Thin market today</div>
  <div class="spk-intro-body">No achievable orders for today&rsquo;s digits.</div>
  <button class="spk-btn spk-btn-ghost spk-intro-close">Close</button>
</div>`;
                el.querySelector('.spk-intro-close').addEventListener('click', hideOverlay);
                el.addEventListener('click', (e) => { if (e.target === el) hideOverlay(); });
            });
            return;
        }

        const introSeen = localStorage.getItem(INTRO_KEY) === '1';
        if (!introSeen) {
            showIntro(orderBook.length, () =>
                startAfterHoursMode(digits, orderBook, solutionsByTarget));
        } else {
            startAfterHoursMode(digits, orderBook, solutionsByTarget);
        }
    }

    // ============================================================
    // KEY INJECTION  (two placements, both gated: registered + today solved)
    // ============================================================

    // Placement B: top-right of the victory card, near the badge.
    // Condition: isRegistered() AND isTodaySolved().
    function injectKeyIntoVictoryCard() {
        if (!isRegistered() || !isTodaySolved()) return;
        const card = document.getElementById('victoryCard');
        if (!card) return;
        const old = document.getElementById('spkKeyBtn');
        if (old) old.remove();

        const btn = document.createElement('button');
        btn.id        = 'spkKeyBtn';
        btn.className = 'spk-key-btn';
        btn.setAttribute('aria-label', 'After Hours');
        btn.setAttribute('title', 'After Hours');
        btn.textContent = '🔑';
        btn.addEventListener('click', (e) => { e.stopPropagation(); launchAfterHours(); });
        card.appendChild(btn);
    }

    // Placement A: header top-bar, inserted after #streakDisplay.
    // Condition: isRegistered() AND isTodaySolved().
    // Idempotent — safe to call repeatedly; only inserts once.
    function injectTopbarKey() {
        if (!isRegistered() || !isTodaySolved()) return;
        if (document.getElementById('spkTopbarKeyBtn')) return;
        const streakEl = document.getElementById('streakDisplay');
        if (!streakEl) return;

        const btn = document.createElement('button');
        btn.id        = 'spkTopbarKeyBtn';
        btn.className = 'spk-key-topbar';
        btn.setAttribute('aria-label', 'After Hours');
        btn.setAttribute('title', 'After Hours');
        btn.textContent = '🔑';
        btn.addEventListener('click', launchAfterHours);
        streakEl.insertAdjacentElement('afterend', btn);
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
                // Victory card just opened — inject key in both locations.
                injectKeyIntoVictoryCard();
                injectTopbarKey();
            }
            if (!visible && wasVisible) {
                wasVisible = false;
                // Card closed — remove the victory-card key (topbar key stays).
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
        const setup = () => {
            observeVictoryCard();
            // If today was already solved before page load, show the topbar key immediately.
            injectTopbarKey();
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setup);
        } else {
            setup();
        }
    }

    init();
})();
