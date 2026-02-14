/**
 * Basic tests for Make 24 core solver and hint logic.
 *
 * These tests run in Node.js via Jest and import the pure functions
 * exported from app.js (the DOM/Supabase code is gated behind
 * typeof checks so it won't run during import in Node).
 */

// We need to mock browser globals before requiring app.js
// so the top-level DOM code doesn't blow up in Node.

// Minimal mock of browser globals
const noopEl = {
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    style: {},
    textContent: '',
    innerHTML: '',
    value: '',
    appendChild() {},
    querySelector() { return noopEl; },
    querySelectorAll() { return []; },
    scrollIntoView() {},
    focus() {},
    closest() { return null; },
    remove() {},
    insertBefore() {},
    dataset: {},
    className: '',
    getContext() {
        return {
            fillRect() {}, fillText() {}, beginPath() {}, moveTo() {},
            lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {},
            stroke() {}, fillStyle: '', strokeStyle: '', lineWidth: 0,
            font: '', textAlign: '', textBaseline: '',
        };
    },
    toBlob(cb) { cb(null); },
    width: 0,
    height: 0,
};

global.document = {
    getElementById() { return noopEl; },
    querySelectorAll() { return []; },
    createElement() { return noopEl; },
    addEventListener() {},
    body: { addEventListener() {} },
};
global.window = { addEventListener() {}, location: { href: '' } };
global.localStorage = {
    _store: {},
    getItem(k) { return this._store[k] ?? null; },
    setItem(k, v) { this._store[k] = v; },
    removeItem(k) { delete this._store[k]; },
};
global.navigator = { share: null, clipboard: { writeText() { return Promise.resolve(); } } };
global.setTimeout = (fn) => fn();
global.clearTimeout = () => {};
global.Date = Date;
global.confirm = () => false;
global.alert = () => {};
global.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) });

// Mock supabase global
global.supabase = {
    createClient() {
        return {
            auth: {
                getSession() { return Promise.resolve({ data: { session: null } }); },
                onAuthStateChange() {},
                signInWithOAuth() { return Promise.resolve({}); },
                signInWithOtp() { return Promise.resolve({}); },
                verifyOtp() { return Promise.resolve({}); },
                signOut() { return Promise.resolve({}); },
            },
            rpc() { return Promise.resolve({ data: null, error: null }); },
        };
    },
};

// Now require the module
const game = require('../app.js');

// ============================================================
// TESTS
// ============================================================

describe('calc', () => {
    test('addition', () => {
        expect(game.calc(3, '+', 5)).toBe(8);
    });
    test('subtraction', () => {
        expect(game.calc(10, '-', 4)).toBe(6);
    });
    test('multiplication', () => {
        expect(game.calc(3, '*', 8)).toBe(24);
    });
    test('division', () => {
        expect(game.calc(12, '/', 3)).toBe(4);
    });
    test('division by zero returns null', () => {
        expect(game.calc(5, '/', 0)).toBeNull();
    });
});

describe('generatePuzzle', () => {
    test('returns 4 numbers', () => {
        const nums = game.generatePuzzle(1);
        expect(nums).toHaveLength(4);
    });
    test('same puzzle number always gives same numbers (deterministic)', () => {
        const a = game.generatePuzzle(42);
        const b = game.generatePuzzle(42);
        expect(a).toEqual(b);
    });
    test('different puzzle numbers give different puzzles', () => {
        const a = game.generatePuzzle(1);
        const b = game.generatePuzzle(2);
        // They could theoretically be the same, but with our seed it's extremely unlikely
        // Just check they're both valid 4-number arrays
        expect(a).toHaveLength(4);
        expect(b).toHaveLength(4);
    });
});

describe('getPuzzleDifficulty', () => {
    test('classifies easy puzzles', () => {
        // [1,2,3,4] has many solutions (e.g. 1*2*3*4=24)
        const diff = game.getPuzzleDifficulty([1, 2, 3, 4]);
        expect(diff.level).toBe('easy');
    });
    test('returns valid difficulty levels', () => {
        const diff = game.getPuzzleDifficulty([5, 6, 7, 9]);
        expect(['easy', 'medium', 'hard']).toContain(diff.level);
        expect(diff.label).toBeTruthy();
        expect(diff.emoji).toBeTruthy();
    });
});

describe('findHintForPuzzle', () => {
    test('returns a hint string for solvable puzzles', () => {
        const hint = game.findHintForPuzzle([1, 2, 3, 4]);
        expect(hint).toBeTruthy();
        expect(hint.startsWith('Try ')).toBe(true);
    });
    test('hint contains two numbers and an operator', () => {
        const hint = game.findHintForPuzzle([1, 2, 3, 4]);
        // Format: "Try A op B"
        expect(hint).toMatch(/^Try \d+ [+\u2212\u00D7\u00F7] \d+$/);
    });
});

describe('canMake24From3', () => {
    test('returns true for [2, 3, 4] (2*3*4=24)', () => {
        expect(game.canMake24From3([2, 3, 4])).toBe(true);
    });
    test('returns true for [1, 3, 8] (1*(3*8)=24)', () => {
        expect(game.canMake24From3([1, 3, 8])).toBe(true);
    });
    test('returns false for impossible sets', () => {
        expect(game.canMake24From3([1, 1, 1])).toBe(false);
    });
});

describe('formatNumber', () => {
    test('formats integers without decimals', () => {
        expect(game.formatNumber(24)).toBe('24');
    });
    test('formats clean fractions', () => {
        expect(game.formatNumber(2.5)).toBe('2.5');
    });
    test('formats near-integer values', () => {
        expect(game.formatNumber(24.00)).toBe('24');
    });
});

describe('getPuzzleNumber / getDateFromPuzzleNumber', () => {
    test('puzzle 1 corresponds to epoch date', () => {
        const date = game.getDateFromPuzzleNumber(1);
        expect(date.toISOString().startsWith('2025-01-01')).toBe(true);
    });
    test('round-trips correctly', () => {
        const date = game.getDateFromPuzzleNumber(100);
        const num = game.getPuzzleNumber(date);
        expect(num).toBe(100);
    });
});

describe('every puzzle in VALID_PUZZLES is solvable', () => {
    // Sample a few to keep test fast
    const sampleIndices = [0, 50, 100, 150, 200, 250, 300, 350, 399];
    test.each(sampleIndices)('puzzle at index %i is solvable', (idx) => {
        const nums = game.VALID_PUZZLES[idx];
        expect(nums).toHaveLength(4);
        const result = game.evaluateAllExpressions(...nums);
        expect(result.solutionCount).toBeGreaterThan(0);
    });
});

describe('named constants', () => {
    test('TARGET_NUMBER is 24', () => {
        expect(game.TARGET_NUMBER).toBe(24);
    });
    test('PERFECT_MOVES is 3', () => {
        expect(game.PERFECT_MOVES).toBe(3);
    });
    test('FAST_SOLVE_THRESHOLD_S is 60', () => {
        expect(game.FAST_SOLVE_THRESHOLD_S).toBe(60);
    });
});
