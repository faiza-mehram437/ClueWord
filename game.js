// ---------- 1. Settings ----------
const WORD_LENGTH = 5;
const MAX_GUESSES = 6;
const FLIP_DELAY = 300;        // milliseconds between each tile flipping
const EMOJI_AFTER = 3;         // the emoji hint unlocks after this many guesses
const MAX_REVEALS = 2;         // letter hints allowed per word
const START_COINS = 3;
const FIRST_DAY = Date.UTC(2026, 0, 1); // Daily game #1 was on 1 January 2026

// ---------- 2. Saving to the browser ----------
// localStorage keeps data in this browser even after it is closed.
// It can fail (private windows, blocked storage), so we always use try/catch.
function load(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not saved, but the game still works
  }
}

// ---------- 3. Today's word ----------
// Everyone gets the same word on the same day, without a server:
// we turn today's date into a number and use it to pick from the list.
function todayNumber() {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((today - FIRST_DAY) / 86400000);
}

function dailyEntry(day) {
  // Multiplying by a prime number jumps around the list, so the daily words
  // don't follow the list order. Because 7919 is prime, every word is used
  // once before any word repeats.
  return ANSWERS[(day * 7919) % ANSWERS.length];
}

function randomEntry() {
  return ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
}

// ---------- 4. Scoring a guess ----------
// For each letter: "correct" (green), "present" (yellow) or "absent" (grey).
// Two passes are needed so repeated letters are scored fairly.
// Example: answer "apple", guess "paper" -> only ONE "p" can be yellow
// for the "p" that isn't already green.
function scoreGuess(guess, answer) {
  const result = Array(WORD_LENGTH).fill("absent");
  const leftover = {}; // answer letters not matched exactly

  // Pass 1: exact matches
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === answer[i]) {
      result[i] = "correct";
    } else {
      leftover[answer[i]] = (leftover[answer[i]] || 0) + 1;
    }
  }

  // Pass 2: right letter, wrong place (only while that letter is left over)
  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] !== "correct" && leftover[guess[i]] > 0) {
      result[i] = "present";
      leftover[guess[i]]--;
    }
  }
  return result;
}

// ---------- 5. Game state ----------
let mode = "daily";
let secret = null;     // { word, category, emoji, clue }
let answer = "";
let guesses = [];      // finished guesses, e.g. ["crane", "stone"]
let reveals = [];      // positions revealed with coins, e.g. [0, 3]
let current = "";      // the letters being typed now
let gameOver = false;
let busy = false;      // true while tiles are flipping, so typing is ignored

const boardEl = document.getElementById("board");
const keyboardEl = document.getElementById("keyboard");
const toastEl = document.getElementById("toast");
const newWordBtn = document.getElementById("new-word-btn");
const knownEl = document.getElementById("known");
const revealBtn = document.getElementById("reveal-btn");
const coinsEl = document.getElementById("coins");

// ---------- 6. Build the board, keyboard and stars ----------
function buildBoard() {
  boardEl.innerHTML = "";
  for (let r = 0; r < MAX_GUESSES; r++) {
    const row = document.createElement("div");
    row.className = "row";
    for (let c = 0; c < WORD_LENGTH; c++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      row.appendChild(tile);
    }
    boardEl.appendChild(row);
  }
}

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "+zxcvbnm-"]; // + = Enter, - = Delete

function buildKeyboard() {
  keyboardEl.innerHTML = "";
  for (const letters of KEY_ROWS) {
    const row = document.createElement("div");
    row.className = "key-row";
    for (const ch of letters) {
      const key = document.createElement("button");
      key.className = "key";
      if (ch === "+") {
        key.textContent = "Enter";
        key.dataset.key = "Enter";
        key.classList.add("wide");
      } else if (ch === "-") {
        key.textContent = "⌫";
        key.dataset.key = "Backspace";
        key.setAttribute("aria-label", "Delete");
        key.classList.add("wide");
      } else {
        key.textContent = ch;
        key.dataset.key = ch;
      }
      row.appendChild(key);
    }
    keyboardEl.appendChild(row);
  }
}

function buildSky() {
  const sky = document.getElementById("sky");
  for (let i = 0; i < 60; i++) {
    const star = document.createElement("span");
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    star.style.animationDelay = `${Math.random() * 3}s`;
    sky.appendChild(star);
  }
}

// ---------- 7. Drawing the current state on screen ----------
function rowTiles(r) {
  return boardEl.children[r].children;
}

// Show the letters being typed in the current row
function drawCurrentRow() {
  const tiles = rowTiles(guesses.length);
  for (let c = 0; c < WORD_LENGTH; c++) {
    tiles[c].textContent = current[c] || "";
    tiles[c].classList.toggle("filled", Boolean(current[c]));
  }
}

// Keyboard keys keep their best colour: green beats yellow beats grey
const RANK = { absent: 1, present: 2, correct: 3 };

function colourKey(letter, state) {
  const key = keyboardEl.querySelector(`[data-key="${letter}"]`);
  const old = key.dataset.state;
  if (!old || RANK[state] > RANK[old]) {
    key.classList.remove("absent", "present", "correct");
    key.classList.add(state);
    key.dataset.state = state;
  }
}

// Colour a finished row. animate=false is used when restoring a saved game.
function revealRow(r, guess, animate) {
  const tiles = rowTiles(r);
  const result = scoreGuess(guess, answer);
  result.forEach((state, c) => {
    const apply = () => {
      tiles[c].textContent = guess[c];
      tiles[c].classList.remove("filled");
      tiles[c].classList.add(state);
      colourKey(guess[c], state);
    };
    if (!animate) return apply();
    // Each tile starts flipping a little after the previous one, and
    // changes colour halfway through the flip (when it's edge-on).
    setTimeout(() => {
      tiles[c].classList.add("flip");
      setTimeout(apply, 250);
    }, c * FLIP_DELAY);
  });
  return animate ? WORD_LENGTH * FLIP_DELAY + 250 : 0; // how long it takes
}

let toastTimer = null;
function showToast(message, ms = 1500) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

function shakeRow() {
  const row = boardEl.children[guesses.length];
  row.classList.remove("shake");
  void row.offsetWidth; // restart the animation
  row.classList.add("shake");
}

// ---------- 8. The clue card and the "Known letters" strip ----------
function drawClue() {
  document.getElementById("category").textContent = secret.category;
  document.getElementById("clue").textContent = secret.clue;

  // The emoji stays locked until a few guesses have been made (or the game ends)
  const hint = document.getElementById("emoji-hint");
  const unlocked = guesses.length >= EMOJI_AFTER || gameOver;
  const wasLocked = !hint.classList.contains("unlocked");
  hint.classList.toggle("unlocked", unlocked);
  document.getElementById("emoji").textContent = unlocked ? secret.emoji : "🔒";
  document.getElementById("emoji-label").textContent = unlocked
    ? "Emoji hint"
    : `Emoji hint unlocks after ${EMOJI_AFTER} guesses`;
  return unlocked && wasLocked; // true the moment it unlocks
}

// A letter is "known" if it was green in any guess, or revealed with a coin
function knownLetters() {
  const known = Array(WORD_LENGTH).fill(null);
  for (const guess of guesses) {
    scoreGuess(guess, answer).forEach((state, i) => {
      if (state === "correct") known[i] = "found";
    });
  }
  for (const i of reveals) {
    if (!known[i]) known[i] = "hinted";
  }
  return known;
}

function drawKnown() {
  const known = knownLetters();
  knownEl.innerHTML = known
    .map((how, i) => `<span class="${how || ""}">${how ? answer[i] : ""}</span>`)
    .join("");
}

function drawCoins(bump = false) {
  coinsEl.textContent = load("cw-coins", START_COINS);
  if (bump) {
    const box = coinsEl.parentElement;
    box.classList.remove("bump");
    void box.offsetWidth;
    box.classList.add("bump");
  }
  revealBtn.disabled = gameOver || reveals.length >= MAX_REVEALS;
}

// ---------- 9. Power-up: reveal a letter ----------
revealBtn.addEventListener("click", () => {
  if (gameOver || busy) return;
  const coins = load("cw-coins", START_COINS);
  if (coins < 1) return showToast("No coins left! Win a game to earn more 💰", 2000);
  if (reveals.length >= MAX_REVEALS) return showToast("Only 2 letter hints per word!");

  const hidden = knownLetters()
    .map((how, i) => (how ? null : i))
    .filter((i) => i !== null);
  if (hidden.length === 0) return showToast("You already know every letter!");

  const position = hidden[Math.floor(Math.random() * hidden.length)];
  reveals.push(position);
  save("cw-coins", coins - 1);
  colourKey(answer[position], "correct");
  saveProgress();
  drawKnown();
  drawCoins(true);
  showToast(`Letter ${position + 1} is "${answer[position].toUpperCase()}"`);
});

// ---------- 10. Typing ----------
function handleKey(key) {
  if (gameOver || busy) return;
  if (key === "Enter") return submitGuess();
  if (key === "Backspace") {
    current = current.slice(0, -1);
  } else if (/^[a-z]$/.test(key) && current.length < WORD_LENGTH) {
    current += key;
  }
  drawCurrentRow();
}

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (document.querySelector("dialog[open]")) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  handleKey(key);
});

keyboardEl.addEventListener("click", (event) => {
  const key = event.target.closest(".key");
  if (!key) return;
  key.blur(); // so pressing Enter on a real keyboard doesn't "click" it again
  handleKey(key.dataset.key);
});

// ---------- 11. Checking a guess ----------
const WIN_MESSAGES = ["Genius! 🤯", "Magnificent! 🌟", "Impressive! 🎉", "Splendid! ✨", "Great! 👏", "Phew! 😅"];

function submitGuess() {
  if (current.length < WORD_LENGTH) {
    shakeRow();
    return showToast("Not enough letters");
  }
  if (!VALID_GUESSES.has(current)) {
    shakeRow();
    return showToast("Not in word list");
  }

  const guess = current;
  const row = guesses.length;
  guesses.push(guess);
  current = "";
  busy = true;
  saveProgress();

  const duration = revealRow(row, guess, true);
  setTimeout(() => {
    busy = false;
    drawKnown();
    if (guess === answer) return finishGame(true, row);
    if (guesses.length === MAX_GUESSES) return finishGame(false);
    if (drawClue()) showToast(`Emoji hint unlocked: ${secret.emoji}`, 2000);
  }, duration);
}

// Points: fewer guesses = more points, and each letter hint costs 50
function pointsFor(won) {
  if (!won) return 0;
  return Math.max(50, (MAX_GUESSES - guesses.length + 1) * 100 - reveals.length * 50);
}

function finishGame(won, winningRow) {
  gameOver = true;
  drawClue();
  const points = pointsFor(won);

  if (won) {
    // Coins: +1 for winning, +1 bonus if no letter hints were used
    const earned = reveals.length === 0 ? 2 : 1;
    save("cw-coins", load("cw-coins", START_COINS) + earned);
    showToast(`${WIN_MESSAGES[winningRow]}  +${points} ⭐  +${earned} 💰`, 2500);
    [...rowTiles(winningRow)].forEach((tile, c) => {
      setTimeout(() => tile.classList.add("win"), c * 100);
    });
    celebrate();
  } else {
    showToast(`The word was ${answer.toUpperCase()} ${secret.emoji}`, 3000);
  }
  drawCoins(won);
  updateStats(won, points);

  if (mode === "daily") setTimeout(openStats, 2200);
  else newWordBtn.hidden = false;
}

function celebrate() {
  const colours = ["#ff5fa2", "#ffd54a", "#2ecc71", "#7c5cff", "#4fc3f7"];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti";
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colours[i % colours.length];
    piece.style.animationDelay = `${Math.random() * 0.6}s`;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 3000);
  }
}

// ---------- 12. Daily progress and statistics ----------
// Daily progress is saved so a refresh doesn't lose today's game.
function saveProgress() {
  if (mode === "daily") save("cw-daily", { day: todayNumber(), guesses, reveals });
}

const EMPTY_STATS = { played: 0, wins: 0, streak: 0, maxStreak: 0, points: 0,
                      lastWinDay: null, dist: [0, 0, 0, 0, 0, 0] };

function updateStats(won, points) {
  const stats = { ...EMPTY_STATS, ...load("cw-stats", EMPTY_STATS) };
  stats.points += points; // points count in both modes
  if (mode === "daily") {
    const day = todayNumber();
    stats.played++;
    if (won) {
      stats.wins++;
      stats.dist[guesses.length - 1]++;
      // The streak continues only if yesterday's daily word was also won
      stats.streak = stats.lastWinDay === day - 1 ? stats.streak + 1 : 1;
      stats.lastWinDay = day;
      stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
    } else {
      stats.streak = 0;
    }
  }
  save("cw-stats", stats);
}

function openStats() {
  const stats = { ...EMPTY_STATS, ...load("cw-stats", EMPTY_STATS) };
  document.getElementById("stat-played").textContent = stats.played;
  document.getElementById("stat-win").textContent =
    stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  document.getElementById("stat-streak").textContent = stats.streak;
  document.getElementById("stat-points").textContent = stats.points;

  // Bars showing how many daily games were won in 1, 2, 3... guesses
  const most = Math.max(...stats.dist, 1);
  const wonToday = mode === "daily" && gameOver && guesses.at(-1) === answer;
  document.getElementById("distribution").innerHTML = stats.dist
    .map((count, i) => {
      const today = wonToday && guesses.length === i + 1 ? "today" : "";
      return `<div class="bar-row"><span>${i + 1}</span>
        <div class="bar ${today}" style="width:${Math.max(8, (count / most) * 100)}%">${count}</div></div>`;
    })
    .join("");

  document.getElementById("share-btn").hidden = !gameOver;
  document.getElementById("stats-dialog").showModal();
}

// Time until midnight, when the next daily word appears
function updateCountdown() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const s = Math.floor((midnight - now) / 1000);
  const pad = (n) => String(n).padStart(2, "0");
  document.getElementById("countdown").textContent =
    `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
setInterval(updateCountdown, 1000);
updateCountdown();

// ---------- 13. Sharing results (emoji grid, no spoilers) ----------
const EMOJI = { correct: "🟩", present: "🟨", absent: "⬛" };

document.getElementById("share-btn").addEventListener("click", async () => {
  const won = guesses.at(-1) === answer;
  const grid = guesses
    .map((g) => scoreGuess(g, answer).map((s) => EMOJI[s]).join(""))
    .join("\n");
  const title = mode === "daily" ? `Clue Word #${todayNumber() + 1}` : "Clue Word (practice)";
  const hints = reveals.length ? ` 💡${reveals.length}` : "";
  const text = `${title} ${won ? guesses.length : "X"}/${MAX_GUESSES}${hints}\n${secret.category}: "${secret.clue}"\n\n${grid}`;
  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied! Paste it anywhere to share");
  } catch {
    showToast("Couldn't copy, sorry");
  }
});

// ---------- 14. Pop-ups and modes ----------
document.getElementById("help-btn").addEventListener("click", () =>
  document.getElementById("help-dialog").showModal());
document.getElementById("stats-btn").addEventListener("click", openStats);
document.querySelectorAll(".close-btn").forEach((btn) =>
  btn.addEventListener("click", () => btn.closest("dialog").close()));

function startGame(newMode) {
  mode = newMode;
  document.getElementById("daily-btn").classList.toggle("selected", mode === "daily");
  document.getElementById("practice-btn").classList.toggle("selected", mode === "practice");
  document.getElementById("daily-btn").setAttribute("aria-selected", mode === "daily");
  document.getElementById("practice-btn").setAttribute("aria-selected", mode === "practice");

  buildBoard();
  buildKeyboard();
  guesses = [];
  reveals = [];
  current = "";
  gameOver = false;
  busy = false;
  newWordBtn.hidden = true;

  if (mode === "daily") {
    secret = dailyEntry(todayNumber());
    answer = secret.word;
    // Restore today's guesses and hints if the page was refreshed
    const saved = load("cw-daily", null);
    if (saved && saved.day === todayNumber()) {
      reveals = saved.reveals || [];
      for (const i of reveals) colourKey(answer[i], "correct");
      for (const guess of saved.guesses) {
        revealRow(guesses.length, guess, false);
        guesses.push(guess);
      }
      if (guesses.at(-1) === answer || guesses.length === MAX_GUESSES) gameOver = true;
    }
  } else {
    // A random word that isn't the same as the last one
    do secret = randomEntry(); while (secret.word === answer);
    answer = secret.word;
  }

  document.getElementById("emoji-hint").classList.remove("unlocked");
  drawClue();
  drawKnown();
  drawCoins();
}

document.getElementById("daily-btn").addEventListener("click", () => startGame("daily"));
document.getElementById("practice-btn").addEventListener("click", () => startGame("practice"));
newWordBtn.addEventListener("click", () => startGame("practice"));

// ---------- 15. Start ----------
buildSky();
startGame("daily");
// Show the rules the very first time someone visits
if (!load("cw-seen-help", false)) {
  document.getElementById("help-dialog").showModal();
  save("cw-seen-help", true);
}
