// Simple reaction game with local device leaderboard

const bigButton = document.getElementById('bigButton');
const buttonLabel = document.getElementById('buttonLabel');
const promptEl = document.getElementById('prompt');
const latestList = document.getElementById('latestList');
const nameInput = document.getElementById('playerName');
const clearBtn = document.getElementById('clearBtn');
const todayBestEl = document.getElementById('todayBest');
const todayStatus = document.getElementById('todayStatus');

const statBest = document.getElementById('statBest');
const statAvg = document.getElementById('statAvg');
const statAttempts = document.getElementById('statAttempts');

/**
 * localStorage schema:
 * key "reactionTimes" => Array<{ name: string, ms: number, ts: number }>
 * key "playerName" => string
 */

const STORAGE_KEY = 'reactionTimes';
const NAME_KEY = 'playerName';

/** @type {ReturnType<typeof setTimeout> | null} */
let waitTimer = null;
let cooldownTimer = null;
let startedAt = 0;
let lastCompletionTime = 0;
let state = 'idle'; // 'idle' | 'waiting' | 'go' | 'cooldown'
const COOLDOWN_MS = 3000; // 3 seconds cooldown after each attempt
let clickCount = 0; // Track clicks during waiting phase
let lastClickTime = 0; // Track time of last click
const RAPID_CLICK_THRESHOLD = 500; // If clicks are faster than 500ms apart, it's rapid clicking
const MAX_CLICKS_DURING_WAIT = 1; // Only allow 1 click during waiting (the "too soon" click)

// Supabase client (optional if keys provided in config.js)
/** @type {import('@supabase/supabase-js').SupabaseClient | null} */
let supabaseClient = null;
const hasSupabase = Boolean(window.SUPABASE_URL && window.SUPABASE_ANON_KEY);
if (hasSupabase && window.supabase) {
  supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
}

function getNowMs() { return performance.now(); }

function getSavedName() {
  return localStorage.getItem(NAME_KEY) || '';
}

function setSavedName(name) {
  localStorage.setItem(NAME_KEY, name.trim());
}

function loadResults() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveResult(entry) {
  const all = loadResults();
  all.unshift(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(0, 1000)));
}

function clearResults() {
  localStorage.removeItem(STORAGE_KEY);
}

function msToText(ms) {
  return `${Math.round(ms)} ms`;
}

function updateStatsUI() {
  const data = loadResults();
  statAttempts.textContent = String(data.length);

  if (data.length === 0) {
    statBest.textContent = '—';
    statAvg.textContent = '—';
    return;
  }

  const best = data.reduce((min, r) => Math.min(min, r.ms), Infinity);
  const last10 = data.slice(0, 10);
  const avg = last10.reduce((sum, r) => sum + r.ms, 0) / last10.length;
  statBest.textContent = msToText(best);
  statAvg.textContent = msToText(avg);
}

function renderLatest() {
  const data = loadResults().slice(0, 12);
  latestList.innerHTML = '';
  if (data.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No attempts yet. Be the first!';
    latestList.appendChild(li);
    return;
  }
  for (const r of data) {
    const li = document.createElement('li');
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = r.name || 'Anon';
    const when = new Date(r.ts);
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = msToText(r.ms);
    li.appendChild(tag);
    li.appendChild(document.createTextNode(` · ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`));
    li.appendChild(time);
    latestList.appendChild(li);
  }
}

async function pushGlobalScore(entry) {
  if (!supabaseClient) return;
  try {
    const { error } = await supabaseClient.from('reaction_times').insert({
      name: entry.name || 'Anon',
      ms: Math.round(entry.ms)
    });
    if (error) throw error;
  } catch (e) {
    // ignore network errors silently
  }
}

// removed global leaderboard functions

function startOfTodayISO() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return start.toISOString();
}

function startOfTodayTs() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return start.getTime();
}

function getLocalTodayBest() {
  const since = startOfTodayTs();
  const data = loadResults().filter(r => r.ts >= since);
  if (data.length === 0) return null;
  let best = data[0];
  for (const r of data) { if (r.ms < best.ms) best = r; }
  return { name: (nameInput.value || best.name || 'Anon'), ms: Math.round(best.ms) };
}

async function fetchTodayBest() {
  const localFallback = () => {
    const best = getLocalTodayBest();
    renderTodayBest(best);
    if (todayStatus) todayStatus.textContent = '';
  };

  if (!supabaseClient) {
    return localFallback();
  }
  if (todayStatus) todayStatus.textContent = 'Loading...';
  try {
    const { data, error } = await supabaseClient
      .from('reaction_times')
      .select('name, ms, created_at')
      .gte('created_at', startOfTodayISO())
      .order('ms', { ascending: true })
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) {
      return localFallback();
    }
    renderTodayBest(data[0]);
    if (todayStatus) todayStatus.textContent = '';
  } catch (e) {
    localFallback();
  }
}

function renderTodayBest(row) {
  if (!todayBestEl) return;
  todayBestEl.innerHTML = '';
  if (!row) {
    const empty = document.createElement('div');
    empty.className = 'helper';
    empty.textContent = 'No scores yet today.';
    todayBestEl.appendChild(empty);
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'row';
  const crown = document.createElement('span');
  crown.className = 'crown';
  crown.textContent = '👑';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = row.name || 'Anon';
  const score = document.createElement('span');
  score.className = 'score';
  score.textContent = msToText(row.ms);
  wrap.appendChild(crown);
  wrap.appendChild(name);
  wrap.appendChild(score);
  todayBestEl.appendChild(wrap);
}

function resetToIdle(message = 'Press Start, then wait for green...') {
  state = 'idle';
  startedAt = 0;
  clickCount = 0; // Reset click counter
  lastClickTime = 0;
  if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
  if (cooldownTimer) { clearTimeout(cooldownTimer); cooldownTimer = null; }
  bigButton.classList.remove('ready', 'go', 'too-soon', 'cooldown');
  bigButton.disabled = false;
  buttonLabel.textContent = 'Start';
  promptEl.textContent = message;
}

function startCooldown() {
  state = 'cooldown';
  bigButton.disabled = true;
  bigButton.classList.add('cooldown');
  const remaining = COOLDOWN_MS;
  let timeLeft = Math.ceil(remaining / 1000);
  
  const updateCooldown = () => {
    if (timeLeft > 0) {
      buttonLabel.textContent = `Wait ${timeLeft}s`;
      promptEl.textContent = `Cooldown: ${timeLeft} second${timeLeft !== 1 ? 's' : ''} before next attempt`;
      timeLeft--;
      cooldownTimer = setTimeout(updateCooldown, 1000);
    } else {
      // Cooldown finished
      resetToIdle('Ready for another attempt!');
    }
  };
  
  updateCooldown();
}

function startRound() {
  // Start a new attempt: reset and schedule the GO moment
  if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
  state = 'idle';
  clickCount = 0; // Reset click counter for new round
  lastClickTime = 0;
  buttonLabel.textContent = 'Wait...';
  bigButton.disabled = true;
  scheduleGo();
}

function scheduleGo() {
  state = 'waiting';
  startedAt = 0; // Reset timing - ensure it's only set when green
  promptEl.textContent = 'Wait for green...';
  bigButton.classList.add('ready');
  bigButton.classList.remove('go', 'too-soon');
  const delay = 1200 + Math.random() * 2800; // 1.2s - 4s
  waitTimer = setTimeout(() => {
    // Set timing EXACTLY when button turns green
    startedAt = getNowMs();
    state = 'go';
    clickCount = 0; // Reset click counter when button turns green
    lastClickTime = 0; // Reset to allow fresh click on green
    bigButton.classList.add('go');
    bigButton.classList.remove('ready', 'too-soon');
    bigButton.disabled = false; // re-enable so the click is captured
    buttonLabel.textContent = 'GO!';
    promptEl.textContent = 'Tap NOW!';
  }, delay);
}

function handleBigButtonClick() {
  // Prevent starting during cooldown
  if (state === 'cooldown') {
    return; // Button is disabled anyway, but extra safety
  }
  
  // Check if trying to start too soon after last completion
  const timeSinceLastCompletion = Date.now() - lastCompletionTime;
  if (timeSinceLastCompletion < COOLDOWN_MS && lastCompletionTime > 0) {
    const remaining = Math.ceil((COOLDOWN_MS - timeSinceLastCompletion) / 1000);
    promptEl.textContent = `Please wait ${remaining} second${remaining !== 1 ? 's' : ''} before starting again.`;
    return;
  }

  if (state === 'idle') {
    // Start round
    startRound();
    return;
  }

  if (state === 'waiting') {
    // Too soon - clicked before button turned green
    const now = Date.now();
    clickCount++;
    
    // Check for rapid clicking
    if (clickCount > MAX_CLICKS_DURING_WAIT || (lastClickTime > 0 && now - lastClickTime < RAPID_CLICK_THRESHOLD)) {
      // Rapid clicking detected - invalidate attempt
      if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
      startedAt = 0;
      bigButton.classList.add('too-soon');
      bigButton.classList.remove('ready', 'go');
      bigButton.disabled = true;
      buttonLabel.textContent = 'Rapid clicking!';
      promptEl.textContent = 'Rapid clicking detected. Please wait for green.';
      setTimeout(() => resetToIdle('Press Start to try again (no rapid clicking)'), 2000);
      return;
    }
    
    lastClickTime = now;
    
    // Regular "too soon" click (first click during waiting)
    if (waitTimer) { clearTimeout(waitTimer); waitTimer = null; }
    startedAt = 0; // Ensure no timing was recorded
    bigButton.classList.add('too-soon');
    bigButton.classList.remove('ready', 'go');
    bigButton.disabled = true;
    buttonLabel.textContent = 'Too soon!';
    promptEl.textContent = 'False start. Try again.';
    setTimeout(() => resetToIdle('Press Start to try again'), 800);
    return;
  }

  if (state === 'go') {
    // Only measure if timing was properly started (button is green)
    if (startedAt <= 0) {
      // Safety check: if somehow clicked before timing started, reset
      resetToIdle('Error: Please try again.');
      return;
    }
    
    // Check for rapid clicking on green (double-click protection)
    const now = Date.now();
    if (lastClickTime > 0 && now - lastClickTime < RAPID_CLICK_THRESHOLD) {
      // Rapid clicking detected - ignore this click
      return;
    }
    lastClickTime = now;
    
    // Disable button immediately to prevent double-clicks
    bigButton.disabled = true;
    const reactedAt = getNowMs();
    const delta = reactedAt - startedAt;
    // Ensure delta is positive and reasonable (not negative or too large)
    if (delta <= 0 || delta > 10000) {
      resetToIdle('Invalid time. Please try again.');
      return;
    }
    const name = (nameInput.value || '').trim().slice(0, 20);
    const entry = { name, ms: delta, ts: Date.now() };
    saveResult(entry);
    pushGlobalScore(entry);
    updateStatsUI();
    renderLatest();
    fetchTodayBest();
    bigButton.classList.remove('go');
    buttonLabel.textContent = msToText(delta);
    promptEl.textContent = `Nice! ${msToText(delta)}.`;
    lastCompletionTime = Date.now(); // Record when this attempt completed
    // Show result briefly, then start cooldown
    setTimeout(() => {
      startCooldown();
    }, 1500);
    return;
  }
}

// Keyboard support: Space/Enter triggers big button
function handleKeydown(e) {
  if (e.key === ' ' || e.key === 'Enter') {
    // Don't allow keyboard input during cooldown
    if (state === 'cooldown' || bigButton.disabled) {
      return;
    }
    e.preventDefault();
    bigButton.click();
  }
}

// Init
function init() {
  nameInput.value = getSavedName();
  nameInput.addEventListener('input', () => {
    setSavedName(nameInput.value);
    fetchTodayBest();
  });
  bigButton.addEventListener('click', handleBigButtonClick);
  document.addEventListener('keydown', handleKeydown);
  clearBtn.addEventListener('click', () => {
    clearResults();
    renderLatest();
    updateStatsUI();
  });
  renderLatest();
  updateStatsUI();
  fetchTodayBest();
  if (supabaseClient) {
    setInterval(fetchTodayBest, 20000);
  }
}

init();


