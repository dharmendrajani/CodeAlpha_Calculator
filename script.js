/**
 * Calculator — script.js
 *
 * Architecture: a simple state machine with these fields:
 *   current            – the number being typed right now (string)
 *   previous           – the left-hand operand (string)
 *   operator           – the pending operator (+, -, *, /)
 *   result             – the last evaluated result (number | null)
 *   justEvaled         – true right after pressing '=' (so next digit starts fresh)
 *   waitingForOperand  – true right after an operator is pressed, so the next
 *                        digit REPLACES current instead of appending to it
 *   expression         – the full expression string shown in the sub-display
 *
 * All DOM updates flow through one function: render().
 */

'use strict';

/* ── DOM refs ──────────────────────────────────────────────── */
const elResult      = document.getElementById('result');
const elExpression  = document.getElementById('expression');
const elHistory     = document.getElementById('history');    // last calc preview
const elHistoryList = document.getElementById('historyList');
const elHistoryEmpty= document.getElementById('historyEmpty');
const elHistoryPanel= document.getElementById('historyPanel');
const elHistoryToggle = document.getElementById('historyToggle');
const elClearHistory= document.getElementById('clearHistory');
const elSciRow      = document.getElementById('sciRow');
const elSciToggle   = document.getElementById('sciToggle');
const elSciArrow    = document.getElementById('sciArrow');
const elThemeToggle = document.getElementById('themeToggle');
const elBtnGrid     = document.querySelector('.btn-grid');

/* ── State ─────────────────────────────────────────────────── */
let state = freshState();

/** Returns a blank calculator state. */
function freshState() {
  return {
    current:           '0',
    previous:          '',
    operator:          null,
    result:            null,
    justEvaled:        false,
    waitingForOperand: false,
    expression:        '',
  };
}

/* ── Calculation history (persisted in sessionStorage) ──────── */
let calcHistory = loadHistory();

function loadHistory() {
  try {
    return JSON.parse(sessionStorage.getItem('calcHistory') || '[]');
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    sessionStorage.setItem('calcHistory', JSON.stringify(calcHistory));
  } catch { /* ignore */ }
}

/* ── Core logic ─────────────────────────────────────────────── */

/**
 * Handle a number digit press.
 * @param {string} digit - '0'–'9'
 */
function handleNumber(digit) {
  if (state.justEvaled) {
    // Start a brand-new expression after '='
    state = freshState();
    state.justEvaled = false;
  }

  // After an operator was pressed, the next digit starts a fresh number
  if (state.waitingForOperand) {
    state.current = digit;
    state.waitingForOperand = false;
    render();
    return;
  }

  if (state.current === '0' && digit !== '.') {
    state.current = digit;
  } else if (state.current.length < 15) {
    // Cap input at 15 characters to prevent overflow
    state.current += digit;
  }

  render();
}

/**
 * Handle decimal point press.
 * Prevents multiple dots in a single number.
 */
function handleDecimal() {
  if (state.justEvaled) {
    state = freshState();
    state.current = '0.';
    state.justEvaled = false;
    render();
    return;
  }

  // After an operator, start a fresh "0." rather than appending to the previous number
  if (state.waitingForOperand) {
    state.current = '0.';
    state.waitingForOperand = false;
    render();
    return;
  }

  if (!state.current.includes('.')) {
    state.current += '.';
  }

  render();
}

/**
 * Handle an arithmetic operator press (+, -, *, /).
 * @param {string} op
 */
function handleOperator(op) {
  // If we already have a pending operator and a new number, chain the calculation
  if (state.operator && state.previous !== '' && !state.justEvaled) {
    const chained = evaluate(parseFloat(state.previous), parseFloat(state.current), state.operator);
    if (chained === null) return; // division by zero guard
    state.previous  = String(chained);
    state.current   = String(chained);
  } else {
    state.previous = state.current;
  }

  state.operator         = op;
  state.justEvaled       = false;
  state.waitingForOperand = true;          // ← next digit starts a fresh number
  state.expression = `${formatNumber(state.previous)} ${displayOp(op)}`;

  // Highlight active operator button
  highlightOperator(op);

  render();
}

/**
 * Handle the equals button.
 * Evaluates the pending expression and updates state.
 */
function handleEquals() {
  if (!state.operator || state.previous === '') return;

  const a   = parseFloat(state.previous);
  const b   = parseFloat(state.current);
  const res = evaluate(a, b, state.operator);

  if (res === null) {
    // Division by zero
    showError('Cannot divide by zero');
    return;
  }

  const exprStr = `${formatNumber(String(a))} ${displayOp(state.operator)} ${formatNumber(state.current)}`;

  // Save to history
  addToHistory(exprStr, res);

  // Update state
  state.expression = exprStr + ' =';
  state.result     = res;
  state.current    = String(res);
  state.previous   = '';
  state.operator   = null;
  state.justEvaled = true;

  clearOperatorHighlight();
  pulseResult();
  render();
}

/**
 * Perform the arithmetic.
 * @returns {number|null} null on division by zero
 */
function evaluate(a, b, op) {
  switch (op) {
    case '+': return roundResult(a + b);
    case '-': return roundResult(a - b);
    case '*': return roundResult(a * b);
    case '/':
      if (b === 0) return null;
      return roundResult(a / b);
    default:  return b;
  }
}

/**
 * Round away floating-point noise (e.g. 0.1 + 0.2 = 0.3, not 0.30000000001).
 */
function roundResult(n) {
  return parseFloat(n.toPrecision(12));
}

/**
 * Handle scientific functions.
 * @param {string} fn - 'sqrt', 'square', 'sin', 'cos', 'tan', 'log', 'ln', 'pi'
 */
function handleSci(fn) {
  const val = parseFloat(state.current);
  let res;
  let label;

  switch (fn) {
    case 'sqrt':
      if (val < 0) { showError('Invalid input'); return; }
      res   = roundResult(Math.sqrt(val));
      label = `√(${formatNumber(state.current)})`;
      break;
    case 'square':
      res   = roundResult(val * val);
      label = `(${formatNumber(state.current)})²`;
      break;
    case 'sin':
      res   = roundResult(Math.sin(toRad(val)));
      label = `sin(${formatNumber(state.current)}°)`;
      break;
    case 'cos':
      res   = roundResult(Math.cos(toRad(val)));
      label = `cos(${formatNumber(state.current)}°)`;
      break;
    case 'tan':
      // tan(90) is undefined
      if (val % 180 === 90) { showError('Undefined'); return; }
      res   = roundResult(Math.tan(toRad(val)));
      label = `tan(${formatNumber(state.current)}°)`;
      break;
    case 'log':
      if (val <= 0) { showError('Invalid input'); return; }
      res   = roundResult(Math.log10(val));
      label = `log(${formatNumber(state.current)})`;
      break;
    case 'ln':
      if (val <= 0) { showError('Invalid input'); return; }
      res   = roundResult(Math.log(val));
      label = `ln(${formatNumber(state.current)})`;
      break;
    case 'pi':
      res   = Math.PI;
      label = 'π';
      break;
    default:
      return;
  }

  addToHistory(label, res);

  state.expression = `${label} =`;
  state.current    = String(res);
  state.justEvaled = true;

  pulseResult();
  render();
}

/** Degrees to radians helper. */
function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/* ── Delete & Clear ─────────────────────────────────────────── */

function handleDelete() {
  if (state.justEvaled) {
    // After '=' treat delete as a full clear
    handleClear();
    return;
  }

  if (state.current.length > 1) {
    state.current = state.current.slice(0, -1);
  } else {
    state.current = '0';
  }

  render();
}

function handleClear() {
  state = freshState();
  clearOperatorHighlight();
  elResult.classList.remove('error', 'pulse', 'shrink-1', 'shrink-2', 'shrink-3');
  elExpression.style.color = '';
  render();
}

/* ── History management ─────────────────────────────────────── */

function addToHistory(expression, result) {
  calcHistory.unshift({ expression, result: formatNumber(String(result)) });
  if (calcHistory.length > 20) calcHistory.pop(); // keep last 20
  saveHistory();
  renderHistoryPanel();
}

function renderHistoryPanel() {
  elHistoryList.innerHTML = '';

  if (calcHistory.length === 0) {
    elHistoryEmpty.style.display = 'block';
    return;
  }

  elHistoryEmpty.style.display = 'none';

  calcHistory.forEach((item, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${item.expression}</span><strong>${item.result}</strong>`;
    // Click to reuse result
    li.addEventListener('click', () => {
      state.current    = item.result.replace(/,/g, '');
      state.justEvaled = false;
      render();
    });
    elHistoryList.appendChild(li);
  });
}

/* ── Render ─────────────────────────────────────────────────── */

function render() {
  // Format the current number for display (add commas if large integer)
  const displayValue = formatNumber(state.current);

  elResult.textContent     = displayValue;
  elExpression.textContent = state.expression;

  // Auto-shrink font for long numbers
  const len = displayValue.replace(/[^0-9.]/g, '').length;
  elResult.classList.remove('shrink-1', 'shrink-2', 'shrink-3', 'error');
  if (len > 14)      elResult.classList.add('shrink-3');
  else if (len > 10) elResult.classList.add('shrink-2');
  else if (len > 7)  elResult.classList.add('shrink-1');
}

/**
 * Format a number string: add thousands separators for integers,
 * leave decimals and large-exponent numbers alone.
 */
function formatNumber(str) {
  if (!str || str === 'Error') return str;

  const n = parseFloat(str);
  if (isNaN(n)) return str;

  // Scientific notation pass-through
  if (Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-6 && n !== 0)) {
    return n.toExponential(6).replace(/\.?0+e/, 'e');
  }

  // For display: split on decimal
  const [intPart, decPart] = str.split('.');
  const formattedInt = parseInt(intPart, 10).toLocaleString('en-US');

  return decPart !== undefined ? `${formattedInt}.${decPart}` : formattedInt;
}

/** Display-friendly operator symbols. */
function displayOp(op) {
  const map = { '+': '+', '-': '−', '*': '×', '/': '÷' };
  return map[op] || op;
}

/* ── Visual feedback ────────────────────────────────────────── */

function pulseResult() {
  elResult.classList.remove('pulse');
  // Force reflow so animation restarts
  void elResult.offsetWidth;
  elResult.classList.add('pulse');
}

function showError(msg) {
  elResult.classList.remove('shrink-1', 'shrink-2', 'shrink-3');
  elResult.classList.add('error');
  elResult.textContent = msg;
  elExpression.textContent = '';
  state = freshState();
}

function highlightOperator(op) {
  clearOperatorHighlight();
  const opBtns = document.querySelectorAll('.btn--op');
  const opMap  = { '+': '+', '-': '-', '*': '*', '/': '/' };
  opBtns.forEach(btn => {
    if (btn.dataset.value === opMap[op]) {
      btn.classList.add('active');
    }
  });
}

function clearOperatorHighlight() {
  document.querySelectorAll('.btn--op').forEach(b => b.classList.remove('active'));
}

/** Animate a button press visually (for keyboard input). */
function animateButton(selector) {
  const btn = document.querySelector(selector);
  if (!btn) return;
  btn.classList.add('pressed');
  btn.addEventListener('animationend', () => btn.classList.remove('pressed'), { once: true });
}

/* ── Button click event delegation ─────────────────────────── */

document.querySelector('.btn-grid').addEventListener('click', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn) return;

  const { action, value } = btn.dataset;
  dispatchAction(action, value);
});

document.getElementById('sciRow').addEventListener('click', (e) => {
  const btn = e.target.closest('.btn--sci');
  if (!btn) return;
  dispatchAction('sci', btn.dataset.value);
});

/** Central dispatcher — called by both mouse clicks and keyboard. */
function dispatchAction(action, value) {
  switch (action) {
    case 'number':   handleNumber(value);   break;
    case 'decimal':  handleDecimal();        break;
    case 'operator': handleOperator(value);  break;
    case 'equals':   handleEquals();         break;
    case 'clear':    handleClear();          break;
    case 'delete':   handleDelete();         break;
    case 'history':  toggleHistory();        break;
    case 'sci':      handleSci(value);       break;
  }
}

/* ── History panel toggle ───────────────────────────────────── */

function toggleHistory() {
  const isOpen = elHistoryPanel.classList.toggle('open');
  elHistoryPanel.setAttribute('aria-hidden', String(!isOpen));
  renderHistoryPanel();
}

elClearHistory.addEventListener('click', () => {
  calcHistory = [];
  saveHistory();
  renderHistoryPanel();
});

/* ── Scientific row toggle ──────────────────────────────────── */

elSciToggle.addEventListener('click', () => {
  const isOpen = elSciRow.classList.toggle('open');
  elSciToggle.classList.toggle('sci-open', isOpen);

  // Rotate arrow
  elSciArrow.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
  elSciToggle.setAttribute('aria-expanded', String(isOpen));
});

/* ── Theme toggle ───────────────────────────────────────────── */

elThemeToggle.addEventListener('click', () => {
  const html    = document.documentElement;
  const current = html.getAttribute('data-theme');
  html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
  localStorage.setItem('calcTheme', html.getAttribute('data-theme'));
});

// Restore saved theme
(function initTheme() {
  const saved = localStorage.getItem('calcTheme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
})();

/* ── Keyboard support ───────────────────────────────────────── */

document.addEventListener('keydown', (e) => {
  // Ignore modifier combos (e.g. Ctrl+R)
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const key = e.key;

  if (key >= '0' && key <= '9') {
    e.preventDefault();
    handleNumber(key);
    animateButton(`[data-value="${key}"]`);
    return;
  }

  switch (key) {
    case '.':
    case ',':
      e.preventDefault();
      handleDecimal();
      animateButton('[data-action="decimal"]');
      break;

    case '+':
      e.preventDefault();
      handleOperator('+');
      animateButton('[data-value="+"]');
      break;

    case '-':
      e.preventDefault();
      handleOperator('-');
      animateButton('[data-value="-"]');
      break;

    case '*':
      e.preventDefault();
      handleOperator('*');
      animateButton('[data-value="*"]');
      break;

    case '/':
      // Prevent browser quick-find
      e.preventDefault();
      handleOperator('/');
      animateButton('[data-value="/"]');
      break;

    case 'Enter':
    case '=':
      e.preventDefault();
      handleEquals();
      animateButton('[data-action="equals"]');
      break;

    case 'Backspace':
      e.preventDefault();
      handleDelete();
      animateButton('[data-action="delete"]');
      break;

    case 'Escape':
    case 'Delete':
      e.preventDefault();
      handleClear();
      animateButton('[data-action="clear"]');
      break;

    default:
      break;
  }
});

/* ── Sound effects (optional, silent if AudioContext unavailable) ── */

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { /* audio not available */ }
  }
  return audioCtx;
}

/**
 * Play a short click tone.
 * @param {string} type - 'click' | 'equals' | 'error'
 */
function playSound(type) {
  const ctx = getAudioCtx();
  if (!ctx) return;

  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;

  switch (type) {
    case 'equals':
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(440, now + 0.12);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
      break;
    case 'error':
      osc.frequency.setValueAtTime(220, now);
      osc.type = 'sawtooth';
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
      break;
    default: // generic click
      osc.frequency.setValueAtTime(600, now);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.start(now);
      osc.stop(now + 0.06);
      break;
  }
}

// Attach sounds to button clicks
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'equals') playSound('equals');
  else                      playSound('click');
});

/* ── Init ───────────────────────────────────────────────────── */
render();
renderHistoryPanel();
