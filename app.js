// Prevent iOS overscroll artifacts
document.addEventListener('touchmove', function(e) {
    if (e.target.closest('.archive-list') || e.target.closest('.modal')) return;
    e.preventDefault();
}, { passive: false });

document.body.addEventListener('touchmove', function(e) {
    if (e.target.closest('.archive-list') || e.target.closest('.modal')) return;
    e.preventDefault();
}, { passive: false });

// ============================================================
// CONFIG
// ============================================================
const APP_CONFIG = {
    publicUrl: 'https://make24.app/',
    shareLabel: 'make24.app'
};

// Supabase config
const SUPABASE_URL = 'https://fimsbfcvavpehryvvcho.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpbXNiZmN2YXZwZWhyeXZ2Y2hvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUzOTEwMDMsImV4cCI6MjA3MDk2NzAwM30.6uAm_bDPN9aetYaKWA7zCvS8XDEVhmKKxA7RA7YK4JQ';

// Supabase client (auth-aware)
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// NAMED CONSTANTS (replaces magic numbers)
// ============================================================
const STORAGE_KEY = 'make24_v5';
const ARCHIVE_PAGE_SIZE = 30;
const STREAK_FREEZE_INTERVAL = 7;
const PERFECT_MOVES = 3;
const HINT_DELAY_MS = 90000;        // 90 seconds before hint appears
const HISTORY_SHARE_DAYS = 24;
const FAST_SOLVE_THRESHOLD_S = 60;   // seconds for "fast" perfect
const WRONG_ANSWER_RESET_MS = 800;   // delay before resetting wrong answer
const CONFETTI_COUNT = 60;
const CONFETTI_DURATION_MS = 3000;
const WIN_MODAL_DELAY_MS = 500;
const ARCHIVE_WIN_MODAL_DELAY_MS = 300;
const NUDGE_SHOW_DELAY_MS = 1200;
const NUDGE_HIDE_DELAY_MS = 8000;
const SHAKE_THRESHOLD = 25;
const SHAKE_TIMEOUT_MS = 800;
const EPOCH_DATE = '2025-01-01T00:00:00Z';
const PUZZLE_SEED_MULTIPLIER = 12345;
const SOLUTION_THRESHOLD_EASY = 20;
const SOLUTION_THRESHOLD_MEDIUM = 6;
const TARGET_NUMBER = 24;
const FLOAT_EPSILON = 0.0001;

// ============================================================
// GAME STATE
// ============================================================
let gameState = {
    deviceId: null,
    streak: 0,
    freezes: 0,
    lastPlayedDate: null,
    history: {},
};

let currentPuzzle = {
    numbers: [],
    puzzleNum: 0,
    date: null,
    isArchive: false
};

let playState = {
    cards: [],
    selected: [],
    moves: 0,
    cardStates: [],
    operatorHistory: [],
    undoCount: 0,
    startTime: null,
    endTime: null,
    completed: false,
    hinted: false,
};

// Hint system state
let hintTimer = null;
let hintVisible = false;

// Valid solvable puzzles
const VALID_PUZZLES = [[5,6,7,9],[1,6,8,9],[4,8,9,9],[1,5,8,9],[2,3,4,7],[1,7,8,8],[3,6,7,8],[4,6,6,7],[2,5,6,7],[1,3,3,4],[1,4,4,6],[1,1,6,9],[2,4,6,9],[1,5,6,7],[1,3,4,4],[1,1,5,8],[1,3,7,8],[2,4,4,6],[3,3,4,4],[2,3,5,8],[2,3,4,4],[1,1,3,4],[3,4,6,8],[1,3,8,8],[6,8,8,9],[6,6,6,6],[4,6,6,9],[4,5,5,8],[1,5,7,8],[1,1,6,6],[2,6,6,6],[1,4,8,8],[4,4,4,6],[1,2,6,9],[2,4,4,7],[5,5,9,9],[1,4,5,9],[5,5,5,6],[1,2,4,5],[2,2,2,7],[3,5,7,8],[2,5,5,8],[1,2,3,8],[3,4,5,7],[5,7,8,9],[1,4,6,8],[1,3,3,6],[2,2,2,9],[3,3,7,9],[3,3,6,7],[1,3,4,8],[1,1,4,4],[1,4,4,9],[2,2,3,4],[1,4,5,6],[1,2,5,9],[1,1,1,8],[2,3,3,9],[3,4,9,9],[2,5,8,9],[4,4,6,9],[2,2,7,8],[4,5,5,7],[3,6,6,6],[1,2,6,8],[2,6,6,7],[2,6,6,8],[1,2,5,6],[2,6,7,8],[2,4,6,7],[3,3,3,4],[5,5,5,9],[3,8,9,9],[3,4,4,7],[2,2,4,7],[3,7,7,8],[3,3,3,6],[3,6,7,9],[4,6,6,6],[1,2,6,7],[1,1,4,8],[3,4,6,9],[2,3,9,9],[2,2,3,8],[5,5,8,8],[1,1,8,8],[2,2,5,9],[3,3,3,9],[3,7,7,7],[3,3,6,8],[5,5,8,9],[4,6,9,9],[1,4,4,5],[4,4,5,5],[6,6,6,8],[3,7,8,8],[3,9,9,9],[2,5,6,8],[3,3,4,6],[6,6,7,9],[2,4,5,5],[1,5,8,8],[1,1,3,8],[2,2,3,5],[1,3,5,6],[1,6,6,8],[1,4,5,7],[2,4,5,8],[1,2,2,6],[2,4,7,7],[2,2,3,9],[3,3,3,5],[1,5,6,9],[2,2,5,6],[1,4,5,5],[2,8,9,9],[5,6,6,9],[3,5,8,9],[1,4,6,9],[2,5,7,8],[3,6,8,8],[4,5,5,9],[1,2,3,5],[3,4,7,9],[5,5,6,7],[2,4,6,8],[4,5,8,8],[4,7,7,7],[2,4,7,8],[1,2,5,5],[4,5,6,8],[3,6,7,7],[1,3,4,7],[2,3,4,8],[1,3,7,7],[2,3,4,5],[2,2,2,4],[1,3,3,5],[1,2,3,4],[2,2,6,8],[3,3,5,7],[1,2,4,9],[1,1,2,8],[5,6,6,8],[3,6,6,7],[1,3,8,9],[1,3,6,7],[1,1,2,6],[4,5,6,7],[1,2,5,7],[2,4,5,6],[2,4,7,9],[1,1,2,9],[6,8,8,8],[1,2,3,6],[1,1,5,7],[6,6,6,9],[3,7,9,9],[3,6,6,9],[3,6,6,8],[1,3,5,8],[2,3,6,9],[1,2,4,8],[2,3,5,7],[2,5,5,7],[3,3,9,9],[4,4,5,6],[2,2,5,7],[1,8,8,8],[2,4,5,7],[4,5,7,7],[1,6,9,9],[1,1,4,7],[1,7,8,9],[1,3,4,9],[3,3,5,5],[1,2,8,8],[5,6,9,9],[1,3,4,5],[6,8,9,9],[3,5,6,6],[2,2,4,9],[3,5,5,9],[4,4,8,8],[2,3,3,7],[4,4,4,8],[6,7,8,9],[1,3,6,6],[3,3,6,6],[4,4,7,9],[1,1,2,7],[4,7,7,8],[3,3,4,9],[1,6,6,9],[2,2,4,5],[1,2,8,9],[3,4,4,5],[1,5,9,9],[2,4,4,9],[2,3,3,5],[3,6,8,9],[2,4,6,6],[3,4,5,8],[3,3,4,5],[1,2,3,7],[2,2,6,9],[2,3,8,9],[2,3,7,7],[2,5,5,9],[1,2,6,6],[1,2,2,5],[5,8,8,8],[3,4,5,6],[1,4,5,8],[1,3,6,8],[4,6,6,8],[3,3,8,9],[2,2,3,6],[2,4,8,9],[3,3,7,8],[1,8,8,9],[4,5,7,9],[7,8,8,9],[5,8,8,9],[2,7,8,8],[1,4,4,7],[3,3,3,7],[3,5,8,8],[1,2,7,7],[1,3,3,9],[2,5,8,8],[1,2,4,7],[2,3,4,9],[2,7,8,9],[1,3,9,9],[2,2,5,8],[3,3,3,8],[3,7,7,9],[4,5,8,9],[5,6,8,8],[2,3,3,3],[1,2,5,8],[2,3,5,9],[1,2,2,7],[1,4,6,6],[3,8,8,8],[4,5,9,9],[3,5,5,6],[1,4,6,7],[3,3,7,7],[4,4,5,8],[1,1,3,5],[1,1,5,5],[1,2,3,3],[1,5,5,6],[1,6,8,8],[1,3,5,7],[1,3,7,9],[2,2,4,4],[1,6,6,6],[3,3,8,8],[1,1,4,9],[1,2,3,9],[2,5,6,6],[5,5,6,8],[3,5,6,8],[4,4,4,9],[2,7,7,8],[3,5,5,8],[4,5,7,8],[2,3,7,8],[2,3,8,8],[3,4,6,6],[3,4,4,6],[4,4,4,5],[4,6,8,9],[2,3,7,9],[3,8,8,9],[4,4,7,8],[1,4,7,9],[4,6,8,8],[2,2,4,6],[6,6,8,9],[3,3,4,7],[5,6,7,8],[1,5,5,9],[1,1,3,6],[4,6,7,9],[3,6,9,9],[4,7,8,8],[2,2,2,8],[1,2,7,8],[4,4,4,4],[2,4,4,5],[4,8,8,9],[2,5,6,9],[1,4,7,8],[4,6,7,7],[2,3,4,6],[5,5,7,7],[1,1,3,7],[2,2,6,6],[3,3,5,6],[5,5,6,6],[4,6,7,8],[2,2,8,9],[2,4,4,8],[4,7,8,9],[1,2,2,4],[2,3,6,6],[4,4,7,7],[3,5,7,9],[3,4,4,9],[2,4,5,9],[1,5,7,9],[2,6,6,9],[6,6,8,8],[2,2,8,8],[1,4,4,4],[4,5,6,6],[4,4,8,9],[3,7,8,9],[3,4,7,8],[3,5,9,9],[6,7,9,9],[1,7,7,9],[3,4,4,8],[3,4,4,4],[5,7,8,8],[3,5,5,7],[2,5,7,7],[1,3,6,9],[2,2,6,7],[5,5,5,5],[3,3,4,8],[4,7,9,9],[5,6,7,7],[2,8,8,9],[3,4,8,9],[3,3,3,3],[1,4,7,7],[2,3,6,8],[1,5,6,8],[1,4,4,8],[2,2,5,5],[3,3,5,9],[2,5,7,9],[2,4,8,8],[2,2,2,5],[2,4,4,4],[2,6,8,9],[1,7,9,9],[1,3,5,9],[2,3,3,6],[2,6,9,9],[4,4,6,8],[2,3,5,5],[2,2,7,7],[3,5,6,9],[2,6,8,8],[2,3,5,6],[4,5,5,6],[1,3,3,7],[5,6,6,7],[5,5,7,8],[5,6,6,6],[1,2,4,4],[1,4,8,9],[4,5,5,5],[2,3,6,7],[2,2,3,3],[1,1,4,6],[4,4,4,7],[2,3,3,8],[3,4,5,5],[2,4,9,9],[2,2,3,7],[4,5,6,9],[1,5,6,6],[1,1,3,9],[2,2,4,8],[3,3,6,9],[3,4,7,7],[2,8,8,8],[1,1,6,8],[1,6,7,9],[5,7,7,9],[3,5,6,7],[2,2,2,3],[1,5,5,5],[1,2,2,8],[1,2,2,9],[4,4,5,7],[1,3,3,3],[1,3,4,6],[1,2,7,9],[3,4,5,9],[2,6,7,9],[1,1,5,6],[1,1,4,5],[1,3,3,8],[4,8,8,8],[1,2,4,6],[5,6,8,9]];

// ============================================================
// DIFFICULTY SCORING ENGINE
// ============================================================
function evaluateAllExpressions(a, b, c, d) {
    const ops = ['+', '-', '*', '/'];
    const nums = [a, b, c, d];
    const perms = [];
    for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++) if (j !== i)
            for (let k = 0; k < 4; k++) if (k !== i && k !== j)
                for (let l = 0; l < 4; l++) if (l !== i && l !== j && l !== k)
                    perms.push([nums[i], nums[j], nums[k], nums[l]]);

    let solutionCount = 0;
    let hasDivision = false;
    let hasNonInteger = false;

    for (const perm of perms) {
        const [w, x, y, z] = perm;
        for (const o1 of ops) for (const o2 of ops) for (const o3 of ops) {
            const r1 = calc(w, o1, x);
            if (r1 === null) continue;
            const r2 = calc(r1, o2, y);
            if (r2 === null) continue;
            const r3 = calc(r2, o3, z);
            if (r3 !== null && Math.abs(r3 - TARGET_NUMBER) < FLOAT_EPSILON) {
                solutionCount++;
                if (o1 === '/' || o2 === '/' || o3 === '/') hasDivision = true;
                if (!Number.isInteger(r1) || !Number.isInteger(r2)) hasNonInteger = true;
            }

            const s1 = calc(w, o1, x);
            if (s1 === null) continue;
            const s2 = calc(y, o2, z);
            if (s2 === null) continue;
            const s3 = calc(s1, o3, s2);
            if (s3 !== null && Math.abs(s3 - TARGET_NUMBER) < FLOAT_EPSILON) {
                solutionCount++;
                if (o1 === '/' || o2 === '/' || o3 === '/') hasDivision = true;
                if (!Number.isInteger(s1) || !Number.isInteger(s2)) hasNonInteger = true;
            }
        }
    }
    return { solutionCount, hasDivision, hasNonInteger };
}

function calc(a, op, b) {
    switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? null : a / b;
    }
}

function getPuzzleDifficulty(numbers) {
    const result = evaluateAllExpressions(...numbers);
    if (result.solutionCount >= SOLUTION_THRESHOLD_EASY) return { level: 'easy', label: 'Easy', emoji: '\uD83E\uDDE9' };
    if (result.solutionCount >= SOLUTION_THRESHOLD_MEDIUM) return { level: 'medium', label: 'Medium', emoji: '\uD83E\uDDE9\uD83E\uDDE9' };
    return { level: 'hard', label: 'Hard', emoji: '\uD83E\uDDE9\uD83E\uDDE9\uD83E\uDDE9' };
}

const difficultyCache = {};
function getCachedDifficulty(puzzleNum) {
    if (!difficultyCache[puzzleNum]) {
        const nums = generatePuzzle(puzzleNum);
        difficultyCache[puzzleNum] = getPuzzleDifficulty(nums);
    }
    return difficultyCache[puzzleNum];
}

// ============================================================
// HINT SYSTEM
// ============================================================
function findHintForPuzzle(numbers) {
    const ops = ['+', '-', '*', '/'];
    const opSymbols = { '+': '+', '-': '\u2212', '*': '\u00D7', '/': '\u00F7' };
    for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
            for (const op of ops) {
                const orderings = (op === '+' || op === '*') ?
                    [[numbers[i], numbers[j]]] :
                    [[numbers[i], numbers[j]], [numbers[j], numbers[i]]];

                for (const [a, b] of orderings) {
                    const r = calc(a, op, b);
                    if (r === null) continue;
                    const remaining = numbers.filter((_, idx) => idx !== i && idx !== j);
                    remaining.push(r);
                    if (canMake24From3(remaining)) {
                        return `Try ${a} ${opSymbols[op]} ${b}`;
                    }
                }
            }
        }
    }
    return null;
}

function canMake24From3(nums) {
    const ops = ['+', '-', '*', '/'];
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) if (j !== i) {
            for (let k = 0; k < 3; k++) if (k !== i && k !== j) {
                const [a, b, c] = [nums[i], nums[j], nums[k]];
                for (const o1 of ops) for (const o2 of ops) {
                    const r1 = calc(a, o1, b);
                    if (r1 !== null) {
                        const r2 = calc(r1, o2, c);
                        if (r2 !== null && Math.abs(r2 - TARGET_NUMBER) < FLOAT_EPSILON) return true;
                    }
                    const s1 = calc(b, o2, c);
                    if (s1 !== null) {
                        const s2 = calc(a, o1, s1);
                        if (s2 !== null && Math.abs(s2 - TARGET_NUMBER) < FLOAT_EPSILON) return true;
                    }
                }
            }
        }
    }
    return false;
}

function startHintTimer() {
    clearHintTimer();
    hintVisible = false;
    document.getElementById('hintBtn').classList.remove('visible');
    document.getElementById('hintDisplay').classList.remove('visible');
    document.getElementById('hintDisplay').textContent = '';
    if (playState.completed) return;
    hintTimer = setTimeout(() => {
        if (!playState.completed && playState.moves === 0) {
            document.getElementById('hintBtn').classList.add('visible');
            hintVisible = true;
        }
    }, HINT_DELAY_MS);
}

function clearHintTimer() {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
}

function useHint() {
    if (playState.completed || playState.hinted) return;
    const remaining = playState.cards.filter(c => !c.used).map(c => c.value);
    let hintText;
    if (remaining.length === 4) {
        hintText = findHintForPuzzle(remaining);
    } else {
        hintText = null;
    }
    if (hintText) {
        playState.hinted = true;
        document.getElementById('hintDisplay').textContent = hintText;
        document.getElementById('hintDisplay').classList.add('visible');
        document.getElementById('hintBtn').classList.remove('visible');
        clearHintTimer();
    }
}

// ============================================================
// SYNC ERROR SURFACING
// ============================================================
function showSyncError(message) {
    const toast = document.getElementById('syncErrorToast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 5000);
}

// ============================================================
// AUTH — guest-first, Google + email OTP code
// ============================================================
const NUDGE_DISMISSED_KEY = 'make24_sync_nudge_dismissed';
const STREAK_NUDGE_MILESTONES = [3, 7, 14];
let pendingOtpEmail = null;

async function updateSyncUI() {
    const syncSection = document.getElementById('syncSection');
    const syncLabel = document.getElementById('syncLabel');
    const syncMethods = document.getElementById('syncMethods');
    const signedInView = document.getElementById('syncSignedInView');
    const syncStatus = document.getElementById('syncStatus');
    if (!syncSection) return;

    const { data: { session } } = await sb.auth.getSession();
    const email = session?.user?.email;

    if (email) {
        syncSection.classList.add('signed-in');
        syncLabel.textContent = `Synced as ${email}`;
        syncMethods.style.display = 'none';
        signedInView.style.display = 'block';
        syncStatus.textContent = '';
        syncStatus.className = 'sync-status';
    } else {
        syncSection.classList.remove('signed-in');
        syncLabel.textContent = 'Keep your streak across devices';
        syncMethods.style.display = 'flex';
        signedInView.style.display = 'none';
        // Reset OTP UI
        document.getElementById('emailOtpRow').style.display = 'flex';
        document.getElementById('otpVerifyRow').classList.remove('visible');
        document.getElementById('otpEmailInput').value = '';
        document.getElementById('otpCodeInput').value = '';
        pendingOtpEmail = null;
    }
}

// Google sign-in via popup (stays in PWA context)
async function signInWithGoogle() {
    const status = document.getElementById('syncStatus');
    status.textContent = 'Opening Google sign-in...';
    status.className = 'sync-status';

    const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.href,
            queryParams: { prompt: 'select_account' }
        }
    });

    if (error) {
        status.textContent = error.message;
        status.className = 'sync-status error';
    }
}

// Email OTP: send code
async function sendOtpCode() {
    const emailInput = document.getElementById('otpEmailInput');
    const email = emailInput.value.trim();
    if (!email || !email.includes('@')) {
        const status = document.getElementById('syncStatus');
        status.textContent = 'Please enter a valid email.';
        status.className = 'sync-status error';
        return;
    }

    const sendBtn = document.getElementById('otpSendBtn');
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';

    const status = document.getElementById('syncStatus');
    status.textContent = '';
    status.className = 'sync-status';

    const { error } = await sb.auth.signInWithOtp({
        email,
        options: {
            shouldCreateUser: true
        }
    });

    if (error) {
        status.textContent = error.message;
        status.className = 'sync-status error';
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send code';
        return;
    }

    pendingOtpEmail = email;
    status.textContent = 'Code sent! Check your email (and spam).';
    status.className = 'sync-status success';

    // Show code entry row, hide email row
    document.getElementById('emailOtpRow').style.display = 'none';
    document.getElementById('otpVerifyRow').classList.add('visible');
    document.getElementById('otpCodeInput').focus();

    sendBtn.disabled = false;
    sendBtn.textContent = 'Send code';
}

// Email OTP: verify code
async function verifyOtpCode() {
    const codeInput = document.getElementById('otpCodeInput');
    const code = codeInput.value.trim();
    const status = document.getElementById('syncStatus');

    if (!code || code.length < 6) {
        status.textContent = 'Enter the 6-digit code from your email.';
        status.className = 'sync-status error';
        return;
    }

    if (!pendingOtpEmail) {
        status.textContent = 'Session expired. Please send a new code.';
        status.className = 'sync-status error';
        document.getElementById('emailOtpRow').style.display = 'flex';
        document.getElementById('otpVerifyRow').classList.remove('visible');
        return;
    }

    const verifyBtn = document.getElementById('otpVerifyBtn');
    verifyBtn.disabled = true;
    verifyBtn.textContent = '...';

    const { error } = await sb.auth.verifyOtp({
        email: pendingOtpEmail,
        token: code,
        type: 'email'
    });

    verifyBtn.disabled = false;
    verifyBtn.textContent = 'Verify';

    if (error) {
        status.textContent = error.message;
        status.className = 'sync-status error';
    } else {
        status.textContent = 'Signed in! Syncing your data...';
        status.className = 'sync-status success';
        // Drive the full sync explicitly — don't rely solely on onAuthStateChange
        await updateSyncUI();
        await ensureCanonicalDeviceId();
        await syncFromSupabase();
        await syncHistoryFromSupabase();
        updateStreak();
        reconcileStreakFromHistory();
        // Re-init today's puzzle with synced state
        const today = getTodayPuzzleNumber();
        if (!currentPuzzle.isArchive && currentPuzzle.puzzleNum === today) {
            initPuzzle(today, false);
        }
    }
}

async function promptSignOut() {
    const ok = confirm('Sign out? (Your local history stays on this device.)');
    if (!ok) return;
    const { error } = await sb.auth.signOut();
    if (error) alert('Sign-out failed: ' + error.message);
    await updateSyncUI();
}

// Nudge: gentle toast at streak milestones
async function maybeShowSyncNudge() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) return;

    const dismissed = localStorage.getItem(NUDGE_DISMISSED_KEY);
    if (dismissed === 'forever') return;

    const streak = gameState.streak;
    if (!STREAK_NUDGE_MILESTONES.includes(streak)) return;

    const shownKey = `make24_nudge_shown_${streak}`;
    if (localStorage.getItem(shownKey)) return;
    localStorage.setItem(shownKey, '1');

    const nudge = document.getElementById('syncNudge');
    setTimeout(() => nudge.classList.add('visible'), NUDGE_SHOW_DELAY_MS);
    setTimeout(() => nudge.classList.remove('visible'), NUDGE_HIDE_DELAY_MS);
}

function dismissSyncNudge() {
    const nudge = document.getElementById('syncNudge');
    nudge.classList.remove('visible');
    localStorage.setItem(NUDGE_DISMISSED_KEY, 'forever');
}

// Nudge link opens the archive modal (where the sign-in lives)
function nudgeOpenSignIn() {
    dismissSyncNudge();
    showArchive();
    // Scroll sync section into view after modal opens
    setTimeout(() => {
        const syncSection = document.getElementById('syncSection');
        if (syncSection) syncSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, ARCHIVE_WIN_MODAL_DELAY_MS);
}

async function getAuthHeaders() {
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token || SUPABASE_KEY;
    return {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${token}`
    };
}

async function ensureCanonicalDeviceId() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const localId = getDeviceId();
    try {
        const { data, error } = await sb.rpc('get_or_set_device_id', { p_device_id: localId });
        if (error) { console.log('get_or_set_device_id error:', error.message); return; }
        const canonicalId = data;
        if (canonicalId && canonicalId !== localId) {
            localStorage.setItem('make24_device_id', canonicalId);
            gameState.deviceId = canonicalId;
            saveState();
        }
    } catch (e) { console.log('ensureCanonicalDeviceId skipped:', e); }
}

async function syncFromSupabase() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_or_create_player`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ p_device_id: gameState.deviceId })
        });
        if (!response.ok) {
            showSyncError('Could not sync streak — server returned an error.');
            return;
        }
        const player = await response.json();
        const serverStreak = Number(player?.current_streak ?? player?.streak ?? 0);
        const serverFreezes = Number(player?.freezes ?? 0);
        const localStreak = Number(gameState.streak ?? 0);
        if (localStreak === 0 || (Number.isFinite(serverStreak) && serverStreak > localStreak)) {
            gameState.streak = serverStreak;
            gameState.freezes = serverFreezes;
            saveState();
        }
        updateStreakDisplay();
    } catch (e) {
        showSyncError('Could not reach server to sync streak.');
        console.log('syncFromSupabase skipped:', e?.message || e);
    }
}

async function syncHistoryFromSupabase() {
    try {
        const headers = await getAuthHeaders();
        // Step 1: Get player_id from device_id
        const playerUrl = `${SUPABASE_URL}/rest/v1/players?device_id=eq.${encodeURIComponent(gameState.deviceId)}&select=id&limit=1`;
        const playerRes = await fetch(playerUrl, { headers });
        if (!playerRes.ok) {
            showSyncError('Could not sync history — server returned an error.');
            return;
        }
        const players = await playerRes.json();
        if (!players || players.length === 0) return;
        const playerId = players[0].id;

        // Step 2: Get all solved puzzles from daily_results
        const url = `${SUPABASE_URL}/rest/v1/daily_results?player_id=eq.${playerId}&solved=eq.true&select=puzzle_num,moves,solve_time_seconds,operators,undos,is_perfect,is_fast&order=puzzle_num.desc&limit=500`;
        const response = await fetch(url, { headers });
        if (!response.ok) {
            showSyncError('Could not sync history — server returned an error.');
            return;
        }
        const rows = await response.json();
        if (!rows || rows.length === 0) return;

        let merged = 0;
        for (const row of rows) {
            const num = row.puzzle_num;
            const existing = gameState.history[num];
            // Only fill in missing history — never overwrite local data
            if (!existing || !existing.completed) {
                gameState.history[num] = {
                    completed: true,
                    moves: row.moves || 0,
                    operators: row.operators || [],
                    undos: row.undos || 0,
                    solveTime: row.solve_time_seconds || 0,
                    hinted: false
                };
                merged++;
            }
        }
        // Always update lastPlayedDate to the highest completed puzzle from server
        for (const row of rows) {
            const num = row.puzzle_num;
            if (num > (gameState.lastPlayedDate || 0)) {
                gameState.lastPlayedDate = num;
            }
        }
        saveState();
        if (merged > 0) {
            console.log(`History sync: merged ${merged} solves from server`);
        }
    } catch (e) {
        showSyncError('Could not reach server to sync history.');
        console.log('syncHistoryFromSupabase skipped:', e?.message || e);
    }
}

// ============================================================
// STREAK COMPUTATION FROM HISTORY (fixes streak derivation)
// ============================================================
function computeStreakFromHistory() {
    const today = getTodayPuzzleNumber();
    let streak = 0;
    for (let num = today; num >= 1; num--) {
        if (gameState.history[num]?.completed) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}

function reconcileStreakFromHistory() {
    const computed = computeStreakFromHistory();
    if (computed > gameState.streak) {
        gameState.streak = computed;
    }
    // Keep lastPlayedDate in sync with history so updateStreak() doesn't reset
    const today = getTodayPuzzleNumber();
    if (gameState.history[today]?.completed) {
        gameState.lastPlayedDate = today;
    } else {
        // Find the most recent completed puzzle
        for (let num = today; num >= 1; num--) {
            if (gameState.history[num]?.completed) {
                gameState.lastPlayedDate = num;
                break;
            }
        }
    }
    saveState();
    updateStreakDisplay();
}

// ============================================================
// AUTH STATE CHANGE — re-init puzzle after sync (fixes reload bug)
// ============================================================
sb.auth.onAuthStateChange(async (_event, session) => {
    await updateSyncUI();
    if (session) {
        await ensureCanonicalDeviceId();
        await syncFromSupabase();
        await syncHistoryFromSupabase();
        updateStreak();
        reconcileStreakFromHistory();
        // Re-init today's puzzle if state changed after sync
        const today = getTodayPuzzleNumber();
        if (!currentPuzzle.isArchive && currentPuzzle.puzzleNum === today) {
            initPuzzle(today, false);
        }
    }
});

// ============================================================
// SHAREABLE HISTORY GRID
// ============================================================
function generateHistoryImage() {
    const canvas = document.getElementById('shareCanvas');
    const ctx = canvas.getContext('2d');
    const today = getTodayPuzzleNumber();
    const days = HISTORY_SHARE_DAYS;
    const cols = 6;
    const rows = Math.ceil(days / cols);
    const cellSize = 48;
    const gap = 6;
    const padding = 24;
    const headerHeight = 60;
    const footerHeight = 44;
    const gridWidth = cols * cellSize + (cols - 1) * gap;
    const gridHeight = rows * cellSize + (rows - 1) * gap;

    canvas.width = gridWidth + padding * 2;
    canvas.height = headerHeight + gridHeight + footerHeight + padding;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#22d3ee';
    ctx.font = 'bold 18px "Space Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`Make 24 \u2014 Last ${days} Days`, canvas.width / 2, 36);

    ctx.fillStyle = '#f1f5f9';
    ctx.font = '14px "DM Sans", sans-serif';
    ctx.fillText(`\uD83D\uDD25 ${gameState.streak} streak`, canvas.width / 2, 54);

    for (let i = 0; i < days; i++) {
        const num = today - i;
        if (num < 1) continue;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = padding + col * (cellSize + gap);
        const y = headerHeight + row * (cellSize + gap);

        const history = gameState.history[num];
        const completed = history?.completed;
        const isPerfect = completed && history.moves === PERFECT_MOVES && (history.undos || 0) === 0;
        const isFast = isPerfect && history.solveTime && history.solveTime <= FAST_SOLVE_THRESHOLD_S;

        if (isFast) ctx.fillStyle = 'rgba(251, 191, 36, 0.5)';
        else if (isPerfect) ctx.fillStyle = 'rgba(251, 191, 36, 0.25)';
        else if (completed) ctx.fillStyle = 'rgba(16, 185, 129, 0.3)';
        else ctx.fillStyle = '#1e293b';

        const r = 6;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + cellSize - r, y);
        ctx.quadraticCurveTo(x + cellSize, y, x + cellSize, y + r);
        ctx.lineTo(x + cellSize, y + cellSize - r);
        ctx.quadraticCurveTo(x + cellSize, y + cellSize, x + cellSize - r, y + cellSize);
        ctx.lineTo(x + r, y + cellSize);
        ctx.quadraticCurveTo(x, y + cellSize, x, y + cellSize - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();

        if (num === today) { ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; }
        else if (isFast || isPerfect) { ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.5; }
        else if (completed) { ctx.strokeStyle = '#10b981'; ctx.lineWidth = 1; }
        else { ctx.strokeStyle = '#334155'; ctx.lineWidth = 1; }
        ctx.stroke();

        ctx.fillStyle = '#f1f5f9';
        ctx.font = 'bold 13px "Space Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(num.toString(), x + cellSize / 2, y + cellSize / 2);

        if (isFast) { ctx.font = '10px sans-serif'; ctx.fillText('\u2B50\u2B50', x + cellSize - 8, y + 8); }
        else if (isPerfect) { ctx.font = '10px sans-serif'; ctx.fillText('\u2B50', x + cellSize - 6, y + 8); }
    }

    ctx.fillStyle = '#64748b';
    ctx.font = '12px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(APP_CONFIG.shareLabel, canvas.width / 2, headerHeight + gridHeight + 16);

    return canvas;
}

function shareHistoryGrid() {
    const canvas = generateHistoryImage();
    const today = getTodayPuzzleNumber();
    let solved = 0, perfect = 0, fastPerfect = 0;
    for (let i = 0; i < HISTORY_SHARE_DAYS; i++) {
        const num = today - i;
        const h = gameState.history[num];
        if (h?.completed) {
            solved++;
            const ip = h.moves === PERFECT_MOVES && (h.undos || 0) === 0;
            if (ip && h.solveTime && h.solveTime <= FAST_SOLVE_THRESHOLD_S) fastPerfect++;
            else if (ip) perfect++;
        }
    }

    let emojiGrid = '';
    for (let i = 0; i < HISTORY_SHARE_DAYS; i++) {
        const num = today - i;
        const h = gameState.history[num];
        if (!h?.completed) emojiGrid += '\u2B1B';
        else {
            const ip = h.moves === PERFECT_MOVES && (h.undos || 0) === 0;
            const fast = ip && h.solveTime && h.solveTime <= FAST_SOLVE_THRESHOLD_S;
            if (fast) emojiGrid += '\uD83C\uDF1F';
            else if (ip) emojiGrid += '\u2B50';
            else emojiGrid += '\uD83D\uDFE9';
        }
        if ((i + 1) % 6 === 0 && i < HISTORY_SHARE_DAYS - 1) emojiGrid += '\n';
    }

    const shareText = `Make 24 \u2014 Last ${HISTORY_SHARE_DAYS} Days\n${emojiGrid}\n\uD83D\uDD25 ${gameState.streak} | ${solved}/${HISTORY_SHARE_DAYS} solved\n${APP_CONFIG.publicUrl}`;

    canvas.toBlob(async (blob) => {
        if (blob && navigator.share && navigator.canShare) {
            const file = new File([blob], 'make24-history.png', { type: 'image/png' });
            const shareData = { text: shareText, files: [file] };
            try {
                if (navigator.canShare(shareData)) { await navigator.share(shareData); return; }
            } catch (e) { /* fall through */ }
        }
        if (navigator.share) {
            navigator.share({ text: shareText }).catch(() => copyToClipboard(shareText));
        } else { copyToClipboard(shareText); }
    }, 'image/png');
}

// ============================================================
// CHALLENGE A FRIEND
// ============================================================
function shareChallenge() {
    const puzzleNum = currentPuzzle.puzzleNum;
    const history = gameState.history[puzzleNum];
    const moves = history?.moves || playState.moves;
    const isPerfect = history?.completed && history.moves === PERFECT_MOVES && (history.undos || 0) === 0;

    let text = `\u2694\uFE0F Can you beat my Make 24?\n`;
    text += `Puzzle #${puzzleNum}`;
    if (isPerfect) text += ` \u2014 I got \u2B50 Perfect`;
    else text += ` \u2014 I solved it in ${moves} moves`;
    text += `\n\n${APP_CONFIG.publicUrl}`;

    if (navigator.share) {
        navigator.share({ text }).catch(() => copyToClipboard(text));
    } else { copyToClipboard(text); }
}

// ============================================================
// CORE GAME ENGINE
// ============================================================
function mulberry32(seed) {
    return function() {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function getPuzzleNumber(date) {
    const epoch = new Date(EPOCH_DATE);
    const diff = date - epoch;
    return Math.floor(diff / (24 * 60 * 60 * 1000)) + 1;
}

function getDateFromPuzzleNumber(num) {
    const epoch = new Date(EPOCH_DATE);
    return new Date(epoch.getTime() + (num - 1) * 24 * 60 * 60 * 1000);
}

function getTodayPuzzleNumber() {
    const now = new Date();
    const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return getPuzzleNumber(utcDate);
}

function generatePuzzle(puzzleNum) {
    const puzzleIndex = (puzzleNum - 1) % VALID_PUZZLES.length;
    const basePuzzle = VALID_PUZZLES[puzzleIndex];
    const rng = mulberry32(puzzleNum * PUZZLE_SEED_MULTIPLIER);
    const shuffled = [...basePuzzle];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function getDeviceId() {
    let id = localStorage.getItem('make24_device_id');
    if (!id) {
        id = 'dev_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
        localStorage.setItem('make24_device_id', id);
    }
    return id;
}

function loadState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) gameState = { ...gameState, ...JSON.parse(saved) };
    } catch (e) { console.error('Failed to load state:', e); }
    gameState.deviceId = getDeviceId();
}

function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState)); }
    catch (e) { console.error('Failed to save state:', e); }
}

function updateStreak() {
    const today = getTodayPuzzleNumber();
    const yesterday = today - 1;
    if (gameState.lastPlayedDate === today) return;
    if (gameState.lastPlayedDate === yesterday) { /* continues */ }
    else if (gameState.lastPlayedDate === yesterday - 1 && gameState.freezes > 0) {
        gameState.freezes--; saveState();
    } else if (gameState.lastPlayedDate && gameState.lastPlayedDate < yesterday) {
        gameState.streak = 0; saveState();
    }
    updateStreakDisplay();
}

function incrementStreak() {
    gameState.streak++;
    gameState.lastPlayedDate = currentPuzzle.puzzleNum;
    if (gameState.streak > 0 && gameState.streak % STREAK_FREEZE_INTERVAL === 0) gameState.freezes++;
    saveState();
    updateStreakDisplay();
}

function updateStreakDisplay() {
    document.getElementById('streakCount').textContent = gameState.streak;
    const freezeEl = document.getElementById('freezeIndicator');
    freezeEl.textContent = gameState.freezes > 0 ? '\u2744\uFE0F'.repeat(Math.min(gameState.freezes, 3)) : '';
}

function canUpgradeResult(puzzleNum) {
    const today = getTodayPuzzleNumber();
    if (puzzleNum === today) return true;
    const history = gameState.history[puzzleNum];
    if (history?.completed) return false;
    return true;
}

// ============================================================
// CLEAN WIN SCREEN: fade cards, show big 24
// ============================================================
function showCleanWinState() {
    const grid = document.getElementById('diamondGrid');
    grid.classList.add('win-hidden');
    const display = document.getElementById('resultDisplay');
    display.textContent = '24';
    display.className = 'result-display win-clean';
}

function clearWinState() {
    const grid = document.getElementById('diamondGrid');
    grid.classList.remove('win-hidden');
    const display = document.getElementById('resultDisplay');
    display.className = 'result-display';
    display.textContent = '';
}

function initPuzzle(puzzleNum, isArchive = false) {
    document.getElementById('successMessage').classList.remove('show');
    hideOperators();
    clearHintTimer();
    clearWinState();

    currentPuzzle.puzzleNum = puzzleNum;
    currentPuzzle.numbers = generatePuzzle(puzzleNum);
    currentPuzzle.isArchive = isArchive;
    currentPuzzle.date = getDateFromPuzzleNumber(puzzleNum);

    const history = gameState.history[puzzleNum];
    const alreadySolved = history?.completed;

    // Locked archive puzzle
    if (alreadySolved && isArchive) {
        playState.completed = true;
        playState.moves = history.moves || 0;
        playState.operatorHistory = history.operators || [];
        playState.undoCount = history.undos || 0;
        playState.hinted = false;

        resetPlay();
        updateUI();
        showCleanWinState();

        const isPerfect = history.moves === PERFECT_MOVES && (history.undos || 0) === 0;
        const isFast = isPerfect && history.solveTime && history.solveTime <= FAST_SOLVE_THRESHOLD_S;

        const title = document.getElementById('successTitle');
        const subtitle = document.getElementById('successSubtitle');
        const stats = document.getElementById('successStats');

        if (isFast) {
            title.textContent = '\u26A1 Perfect + Fast!';
            title.classList.add('perfect');
            subtitle.textContent = `Solved in ${history.solveTime}s!`;
        } else if (isPerfect) {
            title.textContent = '\u2B50 Perfect!';
            title.classList.add('perfect');
            subtitle.textContent = 'Solved in just 3 moves!';
        } else {
            title.textContent = '\uD83C\uDF89 Already Solved';
            title.classList.remove('perfect');
            subtitle.textContent = `Completed in ${history.moves} moves`;
        }

        stats.innerHTML = `Moves: ${history.moves}`;
        showDifficultyBadge(puzzleNum);
        document.getElementById('percentileDisplay').textContent = '\uD83D\uDD12 History is locked';

        setTimeout(() => {
            document.getElementById('successMessage').classList.add('show');
        }, ARCHIVE_WIN_MODAL_DELAY_MS);
        return;
    }

    // Today's puzzle already solved
    if (alreadySolved && !isArchive) {
        playState.completed = true;
        playState.moves = history.moves || 0;
        playState.operatorHistory = history.operators || [];
        playState.undoCount = history.undos || 0;
        playState.hinted = false;
    } else {
        playState.moves = 0;
        playState.completed = false;
        playState.operatorHistory = [];
        playState.undoCount = 0;
        playState.hinted = false;
    }

    resetPlay();
    updateUI();

    if (alreadySolved && !isArchive) {
        showCleanWinState();

        const isPerfect = history.moves === PERFECT_MOVES && (history.undos || 0) === 0;
        const isFast = isPerfect && history.solveTime && history.solveTime <= FAST_SOLVE_THRESHOLD_S;

        const title = document.getElementById('successTitle');
        const subtitle = document.getElementById('successSubtitle');
        const stats = document.getElementById('successStats');

        if (isFast) {
            title.textContent = '\u26A1 Perfect + Fast!';
            title.classList.add('perfect');
            subtitle.textContent = `Solved in ${history.solveTime}s!`;
        } else if (isPerfect) {
            title.textContent = '\u2B50 Perfect!';
            title.classList.add('perfect');
            subtitle.textContent = 'Solved in just 3 moves!';
        } else {
            title.textContent = '\uD83C\uDF89 Nice!';
            title.classList.remove('perfect');
            subtitle.textContent = 'You made 24!';
        }

        stats.innerHTML = `Moves: ${history.moves}`;
        showDifficultyBadge(puzzleNum);
        document.getElementById('percentileDisplay').textContent = '';

        setTimeout(() => {
            document.getElementById('successMessage').classList.add('show');
        }, ARCHIVE_WIN_MODAL_DELAY_MS);
    } else if (!alreadySolved) {
        startHintTimer();
    }
}

function showDifficultyBadge(puzzleNum) {
    const badge = document.getElementById('difficultyBadge');
    const diff = getCachedDifficulty(puzzleNum);
    badge.textContent = `${diff.emoji} ${diff.label}`;
    badge.className = 'difficulty-badge';
    badge.style.display = 'inline-block';
}

function hideDifficultyBadge() {
    document.getElementById('difficultyBadge').style.display = 'none';
}

function resetPlay() {
    playState.cards = currentPuzzle.numbers.map((v, i) => ({
        value: v, used: false, slot: i
    }));
    playState.selected = [];
    playState.cardStates = [];
    playState.operatorHistory = [];
    playState.undoCount = 0;
    playState.startTime = null;
    playState.endTime = null;

    document.getElementById('hintDisplay').classList.remove('visible');
    document.getElementById('hintDisplay').textContent = '';
    document.getElementById('hintBtn').classList.remove('visible');

    renderCards();
    hideOperators();
    updateResult();

    if (!playState.completed) {
        playState.startTime = Date.now();
    }
}

function renderCards() {
    const slots = ['slot0', 'slot1', 'slot2', 'slot3'];
    slots.forEach((slotId, i) => {
        const slot = document.getElementById(slotId);
        slot.innerHTML = '';
        const cardData = playState.cards.find(c => c.slot === i && !c.used);
        if (cardData) {
            const card = document.createElement('div');
            card.className = 'card';
            card.textContent = formatNumber(cardData.value);
            card.dataset.index = playState.cards.indexOf(cardData);
            const cardIndex = playState.cards.indexOf(cardData);
            if (playState.selected.includes(cardIndex)) {
                card.classList.add('selected');
                if (playState.selected[0] === cardIndex) card.classList.add('first');
                else card.classList.add('second');
            }
            card.addEventListener('click', () => selectCard(cardIndex));
            slot.appendChild(card);
        }
    });
}

function formatNumber(n) {
    if (Number.isInteger(n)) return n.toString();
    const rounded = Math.round(n * 100) / 100;
    if (Number.isInteger(rounded)) return rounded.toString();
    return rounded.toFixed(2).replace(/\.?0+$/, '');
}

function selectCard(index) {
    if (playState.completed) return;
    if (playState.cards[index].used) return;

    const pos = playState.selected.indexOf(index);
    if (pos !== -1) {
        playState.selected.splice(pos, 1);
        hideOperators();
    } else if (playState.selected.length < 2) {
        playState.selected.push(index);
        if (playState.selected.length === 2) showOperators();
    }

    renderCards();
    maybeRequestMotion();
}

function showOperators() { document.getElementById('operatorsOverlay').classList.add('show'); }
function hideOperators() { document.getElementById('operatorsOverlay').classList.remove('show'); }

function applyOperation(op) {
    if (playState.selected.length !== 2 || playState.completed) return;

    const [i, j] = playState.selected;
    const a = playState.cards[i].value;
    const b = playState.cards[j].value;

    let result;
    switch (op) {
        case '+': result = a + b; break;
        case '-': result = a - b; break;
        case '*': result = a * b; break;
        case '/':
            if (b === 0) return;
            result = a / b;
            break;
    }

    if (!playState.startTime) playState.startTime = Date.now();

    document.getElementById('hintDisplay').classList.remove('visible');
    document.getElementById('hintBtn').classList.remove('visible');
    clearHintTimer();

    playState.cardStates.push({
        cards: JSON.parse(JSON.stringify(playState.cards)),
        operators: [...playState.operatorHistory]
    });

    playState.operatorHistory.push(op);
    playState.cards[i].used = true;
    playState.cards[j].used = true;

    const emptySlot = playState.cards[i].slot;
    playState.cards.push({ value: result, used: false, slot: emptySlot });

    playState.selected = [];
    playState.moves++;

    hideOperators();
    renderCards();
    updateResult();
    updateMoveDots();
    checkGameState();
}

function undo() {
    if (playState.cardStates.length === 0 || playState.completed) return;

    const prevState = playState.cardStates.pop();
    playState.cards = prevState.cards;
    playState.operatorHistory = prevState.operators;
    playState.selected = [];
    playState.moves++;
    playState.undoCount++;

    hideOperators();
    renderCards();
    updateResult();
    updateMoveDots();
}

function updateResult() {
    const remaining = playState.cards.filter(c => !c.used);
    const display = document.getElementById('resultDisplay');
    if (remaining.length === 1) {
        const val = remaining[0].value;
        display.textContent = formatNumber(val);
        display.classList.add('visible');
        if (Math.abs(val - TARGET_NUMBER) < FLOAT_EPSILON) {
            display.classList.add('success');
            display.classList.remove('error');
        } else {
            display.classList.remove('success');
            display.classList.add('error');
        }
    } else {
        display.textContent = '';
        display.classList.remove('visible', 'success', 'error');
    }
    updateUndoButton();
}

function updateUndoButton() {
    const undoBtn = document.getElementById('undoBtn');
    if (playState.cardStates.length > 0 && !playState.completed) undoBtn.classList.add('visible');
    else undoBtn.classList.remove('visible');
}

function checkGameState() {
    const remaining = playState.cards.filter(c => !c.used);
    if (remaining.length === 1) {
        const val = remaining[0].value;
        if (Math.abs(val - TARGET_NUMBER) < FLOAT_EPSILON) handleWin();
        else handleWrongAnswer();
    }
}

async function handleWin() {
    playState.completed = true;
    playState.endTime = Date.now();

    const solveTime = playState.startTime ?
        Math.round((playState.endTime - playState.startTime) / 1000) : 0;

    const isPerfect = playState.moves === PERFECT_MOVES && playState.undoCount === 0 && !playState.hinted;
    const isFast = isPerfect && solveTime <= FAST_SOLVE_THRESHOLD_S;

    if (canUpgradeResult(currentPuzzle.puzzleNum)) {
        gameState.history[currentPuzzle.puzzleNum] = {
            completed: true,
            moves: playState.moves,
            operators: [...playState.operatorHistory],
            undos: playState.undoCount,
            solveTime: solveTime,
            hinted: playState.hinted
        };
    }

    if (!currentPuzzle.isArchive) {
        incrementStreak();
        syncStreakToSupabase();
    }

    saveState();
    updateMoveDots();
    showConfetti();

    // Clean win: fade cards, show big 24
    showCleanWinState();

    const title = document.getElementById('successTitle');
    const subtitle = document.getElementById('successSubtitle');
    const stats = document.getElementById('successStats');

    if (isFast) {
        title.textContent = '\u26A1 Perfect + Fast!';
        title.classList.add('perfect');
        subtitle.textContent = `Solved in ${solveTime}s!`;
    } else if (isPerfect) {
        title.textContent = '\u2B50 Perfect!';
        title.classList.add('perfect');
        subtitle.textContent = 'Solved in just 3 moves!';
    } else {
        title.textContent = '\uD83C\uDF89 Nice!';
        title.classList.remove('perfect');
        subtitle.textContent = 'You made 24!';
    }

    stats.innerHTML = playState.hinted ? `Moves: ${playState.moves} (with hint)` : `Moves: ${playState.moves}`;
    showDifficultyBadge(currentPuzzle.puzzleNum);

    document.getElementById('percentileDisplay').textContent = 'Loading...';

    setTimeout(() => {
        document.getElementById('successMessage').classList.add('show');
    }, WIN_MODAL_DELAY_MS);

    const percentileData = await trackPlay(true);
    displayPercentile(percentileData);

    // Gentle nudge at streak milestones (if not signed in)
    maybeShowSyncNudge();
}

function handleWrongAnswer() {
    setTimeout(() => {
        playState.cards = currentPuzzle.numbers.map((v, i) => ({
            value: v, used: false, slot: i
        }));
        playState.selected = [];
        playState.cardStates = [];
        renderCards();
        updateResult();
    }, WRONG_ANSWER_RESET_MS);
}

function updateMoveDots() {
    const container = document.getElementById('moveDots');
    container.innerHTML = '';
    const totalDots = Math.max(PERFECT_MOVES, playState.moves);
    for (let i = 0; i < totalDots; i++) {
        const dot = document.createElement('div');
        dot.className = 'move-dot';
        if (i < playState.moves) {
            dot.classList.add(i < PERFECT_MOVES ? 'filled' : 'excess');
        } else {
            dot.classList.add('perfect-hint');
        }
        container.appendChild(dot);
    }
}

function updateUI() {
    document.getElementById('puzzleNumber').textContent = `#${currentPuzzle.puzzleNum}`;
    document.getElementById('archiveBanner').classList.toggle('show', currentPuzzle.isArchive);
    hideDifficultyBadge();
    updateStreakDisplay();
    updateMoveDots();
}

function showConfetti() {
    const container = document.getElementById('confetti');
    const colors = ['#22d3ee', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#fbbf24'];
    for (let i = 0; i < CONFETTI_COUNT; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animation = `confetti-fall ${1.5 + Math.random()}s ease-out forwards`;
        confetti.style.animationDelay = Math.random() * 0.5 + 's';
        confetti.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        confetti.style.width = (6 + Math.random() * 8) + 'px';
        confetti.style.height = (6 + Math.random() * 8) + 'px';
        container.appendChild(confetti);
    }
    setTimeout(() => { container.innerHTML = ''; }, CONFETTI_DURATION_MS);
}

// Share result
function generateShareText() {
    const history = gameState.history[currentPuzzle.puzzleNum];
    const isPerfect = history?.completed && history.moves === PERFECT_MOVES && (history.undos || 0) === 0 && !history.hinted;
    const isFast = isPerfect && history?.solveTime && history.solveTime <= FAST_SOLVE_THRESHOLD_S;
    const operators = history?.operators || playState.operatorHistory;

    const opSymbols = { '+': '\u2795', '-': '\u2796', '*': '\u2716\uFE0F', '/': '\u2797' };
    const opLine = operators.map(op => opSymbols[op]).join(' ');

    let text = `24 #${currentPuzzle.puzzleNum}\n`;
    text += `${opLine}\n`;
    if (isFast) text += `\u26A1 Perfect + Fast!\n`;
    else if (isPerfect) text += `\u2B50 Perfect!\n`;
    text += `\uD83D\uDD25 ${gameState.streak}\n`;
    text += `${APP_CONFIG.publicUrl}`;
    return text;
}

function share() {
    const text = generateShareText();
    if (navigator.share) {
        navigator.share({ text }).catch(() => copyToClipboard(text));
    } else { copyToClipboard(text); }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        alert('Copied to clipboard!');
    }).catch(() => { alert(text); });
}

// Archive
let archiveDisplayCount = ARCHIVE_PAGE_SIZE;

function showArchive() {
    const modal = document.getElementById('archiveModal');
    const list = document.getElementById('archiveList');
    list.innerHTML = '';
    const today = getTodayPuzzleNumber();

    for (let i = 0; i < archiveDisplayCount; i++) {
        const num = today - i;
        if (num < 1) continue;

        const item = document.createElement('div');
        item.className = 'archive-item';
        item.textContent = num;

        const history = gameState.history[num];
        if (history?.completed) {
            const isPerfect = history.moves === PERFECT_MOVES && (history.undos || 0) === 0;
            const isFast = isPerfect && history.solveTime && history.solveTime <= FAST_SOLVE_THRESHOLD_S;
            if (isFast) item.classList.add('fast-perfect');
            else if (isPerfect) item.classList.add('perfect');
            else item.classList.add('completed');
            if (num !== today) item.classList.add('locked');
        }
        if (num === today) item.classList.add('today');

        item.addEventListener('click', () => {
            modal.classList.remove('show');
            initPuzzle(num, num !== today);
        });
        list.appendChild(item);
    }

    if (today > archiveDisplayCount) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.className = 'load-more-btn';
        loadMoreBtn.textContent = '\u2193 Load More History';
        loadMoreBtn.addEventListener('click', () => {
            archiveDisplayCount += ARCHIVE_PAGE_SIZE;
            showArchive();
        });
        const modalContent = modal.querySelector('.modal');
        const existingBtn = modalContent.querySelector('.load-more-btn');
        if (existingBtn) existingBtn.remove();
        modalContent.insertBefore(loadMoreBtn, modalContent.querySelector('.share-history-btn'));
    }

    modal.classList.add('show');
}

// Supabase tracking
let lastPercentileData = null;

async function trackPlay(success) {
    if (currentPuzzle.isArchive) return null;
    try {
        const solveTime = playState.startTime ?
            Math.round((playState.endTime - playState.startTime) / 1000) : 0;

        const payload = {
            p_device_id: gameState.deviceId,
            p_puzzle_num: currentPuzzle.puzzleNum,
            p_solved: success,
            p_moves: playState.moves,
            p_solve_time: solveTime,
            p_operators: playState.operatorHistory,
            p_undos: playState.undoCount
        };

        const headers = await getAuthHeaders();
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_solve`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            showSyncError('Could not save your result to the server.');
            return null;
        }
        const result = await response.json();
        if (result && result.length > 0) {
            lastPercentileData = result[0];
            return result[0];
        }
        return null;
    } catch (e) {
        showSyncError('Could not reach server to save your result.');
        console.error('Failed to track play:', e);
        return null;
    }
}

async function syncStreakToSupabase() {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_player_streak`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                p_device_id: gameState.deviceId,
                p_new_streak: gameState.streak,
                p_freezes: gameState.freezes
            })
        });
        if (!response.ok) {
            showSyncError('Could not sync streak to server.');
        }
    } catch (e) {
        showSyncError('Could not reach server to sync streak.');
        console.error('Failed to sync streak:', e);
    }
}

function displayPercentile(data) {
    const display = document.getElementById('percentileDisplay');
    if (!data || !data.percentile || !data.total_players) {
        display.textContent = '';
        display.classList.remove('highlight');
        return;
    }
    const p = data.percentile, t = data.total_players;
    let message = '';
    if (p >= 90) { message = `\uD83C\uDFC6 Top ${100 - p}% of ${t} players today!`; display.classList.add('highlight'); }
    else if (p >= 75) { message = `\u2B50 Better than ${p}% of ${t} players!`; display.classList.add('highlight'); }
    else if (p >= 50) { message = `\uD83D\uDCCA Better than ${p}% of ${t} players`; display.classList.remove('highlight'); }
    else { message = `${t} players solved today`; display.classList.remove('highlight'); }
    display.textContent = message;
}

// Shake to undo
let lastShakeTime = 0;
let shakeEnabled = false;
let lastX = 0, lastY = 0, lastZ = 0;

function handleMotion(event) {
    if (!shakeEnabled || playState.completed) return;
    const acc = event.accelerationIncludingGravity;
    if (!acc || acc.x === null) return;
    const deltaX = Math.abs(acc.x - lastX);
    const deltaY = Math.abs(acc.y - lastY);
    const deltaZ = Math.abs(acc.z - lastZ);
    lastX = acc.x; lastY = acc.y; lastZ = acc.z;
    const totalDelta = deltaX + deltaY + deltaZ;
    const now = Date.now();
    if (totalDelta > SHAKE_THRESHOLD && now - lastShakeTime > SHAKE_TIMEOUT_MS) {
        lastShakeTime = now;
        undo();
    }
}

async function requestMotionPermission() {
    if (shakeEnabled) return true;
    try {
        if (typeof DeviceMotionEvent !== 'undefined' &&
            typeof DeviceMotionEvent.requestPermission === 'function') {
            const response = await DeviceMotionEvent.requestPermission();
            if (response === 'granted') {
                window.addEventListener('devicemotion', handleMotion);
                shakeEnabled = true;
                return true;
            }
            return false;
        } else if ('DeviceMotionEvent' in window) {
            window.addEventListener('devicemotion', handleMotion);
            shakeEnabled = true;
            return true;
        }
    } catch (e) { console.error('Motion permission error:', e); }
    return false;
}

let motionPermissionRequested = false;
function maybeRequestMotion() {
    if (!motionPermissionRequested && 'DeviceMotionEvent' in window) {
        motionPermissionRequested = true;
        requestMotionPermission();
    }
}

// ============================================================
// EVENT LISTENERS
// ============================================================
document.querySelectorAll('.op-btn').forEach(btn => {
    btn.addEventListener('click', () => applyOperation(btn.dataset.op));
});

document.getElementById('undoBtn').addEventListener('click', undo);
document.getElementById('hintBtn').addEventListener('click', useHint);

// Sync nudge toast handlers
document.getElementById('syncNudgeLink').addEventListener('click', nudgeOpenSignIn);
document.getElementById('syncNudgeDismiss').addEventListener('click', dismissSyncNudge);

// Auth: Google + OTP handlers
document.getElementById('googleSignInBtn').addEventListener('click', signInWithGoogle);
document.getElementById('otpSendBtn').addEventListener('click', sendOtpCode);
document.getElementById('otpVerifyBtn').addEventListener('click', verifyOtpCode);
document.getElementById('syncSignOutBtn').addEventListener('click', promptSignOut);

// Allow Enter key in OTP inputs
document.getElementById('otpEmailInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendOtpCode();
});
document.getElementById('otpCodeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') verifyOtpCode();
});

document.getElementById('operatorsOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
        playState.selected = [];
        hideOperators();
        renderCards();
    }
});

document.getElementById('puzzleNumber').addEventListener('click', showArchive);
document.getElementById('closeArchive').addEventListener('click', () => {
    document.getElementById('archiveModal').classList.remove('show');
});

document.getElementById('shareBtn').addEventListener('click', share);
document.getElementById('challengeBtn').addEventListener('click', shareChallenge);
document.getElementById('shareHistoryBtn').addEventListener('click', shareHistoryGrid);

document.getElementById('closeSuccessBtn').addEventListener('click', () => {
    document.getElementById('successMessage').classList.remove('show');
});

document.getElementById('archiveModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('show');
});

// ============================================================
// BOOT (async to support auth)
// ============================================================
async function boot() {
    loadState();
    await updateSyncUI();

    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        await ensureCanonicalDeviceId();
    }

    await syncFromSupabase();
    await syncHistoryFromSupabase();
    updateStreak();
    reconcileStreakFromHistory();
    initPuzzle(getTodayPuzzleNumber(), false);
}

boot();

if (!('ontouchstart' in window)) {
    if ('DeviceMotionEvent' in window && typeof DeviceMotionEvent.requestPermission !== 'function') {
        window.addEventListener('devicemotion', handleMotion);
        shakeEnabled = true;
    }
}

// ============================================================
// EXPORTS FOR TESTING (Node.js only)
// ============================================================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calc,
        evaluateAllExpressions,
        getPuzzleDifficulty,
        findHintForPuzzle,
        canMake24From3,
        mulberry32,
        generatePuzzle,
        formatNumber,
        getPuzzleNumber,
        getDateFromPuzzleNumber,
        computeStreakFromHistory,
        VALID_PUZZLES,
        TARGET_NUMBER,
        FLOAT_EPSILON,
        PERFECT_MOVES,
        FAST_SOLVE_THRESHOLD_S,
        SOLUTION_THRESHOLD_EASY,
        SOLUTION_THRESHOLD_MEDIUM,
        EPOCH_DATE,
        PUZZLE_SEED_MULTIPLIER,
    };
}
