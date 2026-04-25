const STORAGE_KEY = "beat4beat-state-v1";
const API_BASE = "/api";

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function clampScore(value) {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.max(-99, Math.min(999, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function colorWithAlpha(color, alpha) {
  if (typeof color !== "string") {
    return `rgba(255, 255, 255, ${alpha})`;
  }

  const value = color.trim();
  const shortHexMatch = value.match(/^#([\da-f]{3})$/i);
  if (shortHexMatch) {
    const [red, green, blue] = shortHexMatch[1].split("").map((channel) => parseInt(channel + channel, 16));
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  const hexMatch = value.match(/^#([\da-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    const red = parseInt(hex.slice(0, 2), 16);
    const green = parseInt(hex.slice(2, 4), 16);
    const blue = parseInt(hex.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  return value;
}

function normalizeIndex(value, length) {
  if (!length) {
    return 0;
  }
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(value, length - 1);
}

function nextTeamIndex(state, currentIndex) {
  if (!state.teams.length) {
    return 0;
  }
  return (currentIndex + 1) % state.teams.length;
}

function formatTimestamp(value) {
  if (!value) {
    return "Never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return date.toLocaleString();
}

function getDefaultState() {
  const wordSetA = {
    id: createId("word"),
    name: "Round 1",
    items: ["guitar", "moon", "bus", "summer", "dream", "rain"],
    status: "available"
  };
  const wordSetB = {
    id: createId("word"),
    name: "Round 2",
    items: ["river", "mirror", "city", "heartbeat", "cloud", "midnight"],
    status: "available"
  };
  const instrumentSet = {
    id: createId("inst"),
    name: "Standard",
    items: ["guitar", "trumpet", "violin", "drums", "piano", "flute"],
    reusable: true
  };
  const moderatorSet = {
    id: createId("mod"),
    name: "Moderator freestyle",
    description: "Manual scoring round led by the moderator."
  };

  return {
    view: "game",
    teams: [
      { id: createId("team"), name: "Team 1", color: "#1277ff", score: 0 },
      { id: createId("team"), name: "Team 2", color: "#ff4d6d", score: 0 },
      { id: createId("team"), name: "Team 3", color: "#1ec98f", score: 0 }
    ],
    wordSets: [wordSetA, wordSetB],
    instrumentSets: [instrumentSet],
    moderatorSets: [moderatorSet],
    rounds: [
      {
        id: createId("round"),
        name: "Round 1",
        mode: "word",
        tileCount: 6,
        setId: wordSetA.id
      },
      {
        id: createId("round"),
        name: "Round 2",
        mode: "word",
        tileCount: 6,
        setId: wordSetB.id
      },
      {
        id: createId("round"),
        name: "Instrument Finale",
        mode: "instrument",
        tileCount: 6,
        setId: instrumentSet.id
      },
      {
        id: createId("round"),
        name: "Moderator bonus",
        mode: "moderator",
        setId: moderatorSet.id
      }
    ],
    currentRoundIndex: 0,
    runtime: {}
  };
}

function normalizeState(candidate) {
  const base = getDefaultState();
  const next = {
    ...base,
    ...(candidate || {})
  };
  next.view =
    next.view === "admin"
      ? "admin"
      : next.view === "results"
        ? "results"
        : "game";
  next.teams = Array.isArray(next.teams) ? next.teams : base.teams;
  next.wordSets = Array.isArray(next.wordSets) ? next.wordSets : base.wordSets;
  next.instrumentSets = Array.isArray(next.instrumentSets)
    ? next.instrumentSets
    : base.instrumentSets;
  next.moderatorSets = Array.isArray(next.moderatorSets)
    ? next.moderatorSets
    : base.moderatorSets;
  next.rounds = Array.isArray(next.rounds) ? next.rounds : base.rounds;
  next.runtime = next.runtime && typeof next.runtime === "object" ? next.runtime : {};
  next.currentRoundIndex = normalizeIndex(next.currentRoundIndex, next.rounds.length);
  return next;
}

function loadLegacyState() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeState(JSON.parse(saved)) : null;
  } catch (error) {
    console.error("Failed to read localStorage fallback", error);
    return null;
  }
}

function storeLegacyState(nextState) {
  window.localStorage.setItem("beat4beat-state-v1", JSON.stringify(nextState));
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = await response.json();
      if (payload.error) {
        message = payload.error;
      }
    } catch (error) {
      // Ignore JSON parsing failures.
    }
    throw new Error(message);
  }

  return response.json();
}

let state = normalizeState(getDefaultState());
let storageMeta = {
  mode: "connecting",
  statusText: "Connecting to backend…",
  lastSavedAt: null,
  savedGames: [],
  saveInFlight: false,
  pendingSave: false,
  saveTimer: null
};

function setStorageStatus(text) {
  storageMeta.statusText = text;
  const node = document.querySelector("#storage-status-text");
  if (node) {
    node.textContent = text;
  }
}

function getSetCollection(mode) {
  if (mode === "instrument") {
    return state.instrumentSets;
  }
  if (mode === "moderator") {
    return state.moderatorSets;
  }
  return state.wordSets;
}

function getRound() {
  return state.rounds[state.currentRoundIndex] ?? null;
}

function getRoundItemCount(round) {
  if (round?.mode === "moderator") {
    return 0;
  }
  const currentSet = getCurrentSet(round);
  return currentSet?.items?.length ?? 0;
}

function invalidateRoundRuntime(roundId) {
  delete state.runtime[roundId];
}

function invalidateRoundsForSet(setId) {
  state.rounds.forEach((round) => {
    if (round.setId === setId) {
      invalidateRoundRuntime(round.id);
    }
  });
}

let flashTimer = null;

function triggerBackgroundFlash(color) {
  document.body.classList.remove("flash-blue", "flash-red", "flash-gold");
  void document.body.offsetWidth;
  if (color === "red") {
    document.body.classList.add("flash-red");
  } else if (color === "gold") {
    document.body.classList.add("flash-gold");
  } else {
    document.body.classList.add("flash-blue");
  }
  if (flashTimer) {
    window.clearTimeout(flashTimer);
  }
  flashTimer = window.setTimeout(() => {
    document.body.classList.remove("flash-blue", "flash-red", "flash-gold");
  }, 1800);
}

function buildRoundRuntime(round) {
  if (round.mode === "moderator") {
    const teamCount = state.teams.length || 1;
    const startingTeamIndex = Math.floor(Math.random() * teamCount);
    return {
      roundId: round.id,
      startingTeamIndex,
      activeTeamIndex: startingTeamIndex,
      revealedCount: 0,
      lastReveal: null,
      tiles: []
    };
  }

  const collection = getSetCollection(round.mode);
  const selectedSet = collection.find((item) => item.id === round.setId) ?? collection[0];
  const sourceItems = selectedSet?.items?.length ? [...selectedSet.items] : [];
  const orderedItems = round.mode === "instrument" ? shuffle(sourceItems) : sourceItems;
  const tileCount = sourceItems.length;
  const teamCount = state.teams.length || 1;
  const startingTeamIndex = Math.floor(Math.random() * teamCount);

  return {
    roundId: round.id,
    startingTeamIndex,
    activeTeamIndex: startingTeamIndex,
    revealedCount: 0,
    lastReveal: null,
    tiles: Array.from({ length: tileCount }, (_, index) => ({
      id: createId("tile"),
      number: index + 1,
      content: orderedItems[index],
      revealColor: Math.random() > 0.5 ? "blue" : "red",
      state: "hidden"
    }))
  };
}

function ensureRuntime() {
  const round = getRound();
  if (!round) {
    return null;
  }

  const expectedTileCount = getRoundItemCount(round);
  if (!state.runtime[round.id] || state.runtime[round.id].tiles.length !== expectedTileCount) {
    state.runtime[round.id] = buildRoundRuntime(round);
    queuePersist();
  }

  return state.runtime[round.id];
}

function getCurrentSet(round) {
  if (!round) {
    return null;
  }
  return getSetCollection(round.mode).find((item) => item.id === round.setId) ?? null;
}

function getRevealPoints(round, runtime) {
  if (!round || !runtime || round.mode === "moderator") {
    return 0;
  }
  return Math.max(0, getRoundItemCount(round) + 1 - runtime.revealedCount);
}

async function refreshSavedGames() {
  try {
    const response = await apiRequest("/games");
    storageMeta.savedGames = response.items || [];
    renderSavedGames();
  } catch (error) {
    setStorageStatus(`Saved-game list unavailable: ${error.message}`);
  }
}

async function persistState() {
  if (storageMeta.mode !== "server") {
    storeLegacyState(state);
    return;
  }

  if (storageMeta.saveInFlight) {
    storageMeta.pendingSave = true;
    return;
  }

  storageMeta.saveInFlight = true;
  try {
    const response = await apiRequest("/state", {
      method: "PUT",
      body: JSON.stringify({ state })
    });
    storageMeta.lastSavedAt = response.updatedAt;
    setStorageStatus(`Saved to server at ${formatTimestamp(response.updatedAt)}`);
    storeLegacyState(state);
  } catch (error) {
    setStorageStatus(`Server save failed: ${error.message}`);
  } finally {
    storageMeta.saveInFlight = false;
    if (storageMeta.pendingSave) {
      storageMeta.pendingSave = false;
      persistState();
    }
  }
}

function queuePersist() {
  storeLegacyState(state);
  if (storageMeta.saveTimer) {
    window.clearTimeout(storageMeta.saveTimer);
  }
  storageMeta.saveTimer = window.setTimeout(() => {
    storageMeta.saveTimer = null;
    persistState();
  }, 250);
}

function commit() {
  queuePersist();
  render();
}

function applyLoadedState(nextState, message) {
  state = normalizeState(nextState);
  setStorageStatus(message);
  render();
}

async function bootstrap() {
  const legacyState = loadLegacyState();

  try {
    const response = await apiRequest("/bootstrap");
    storageMeta.mode = "server";
    storageMeta.savedGames = response.savedGames || [];
    storageMeta.lastSavedAt = response.currentGame?.updatedAt ?? null;

    const sourceState = response.currentGame?.state || legacyState || getDefaultState();
    applyLoadedState(
      sourceState,
      response.currentGame?.state
        ? `Loaded server game from ${formatTimestamp(response.currentGame.updatedAt)}`
        : "Backend ready. Starting from local/default state."
    );

    if (!response.currentGame?.state) {
      queuePersist();
    }
  } catch (error) {
    storageMeta.mode = "local";
    storageMeta.savedGames = [];
    applyLoadedState(
      legacyState || getDefaultState(),
      `Backend unavailable. Using browser-only storage.`
    );
  }
}

function switchView(view) {
  state.view = view;
  commit();
}

function updateTeam(teamId, updates) {
  state.teams = state.teams.map((team) =>
    team.id === teamId ? { ...team, ...updates } : team
  );
  commit();
}

function changeScore(teamId, amount) {
  state.teams = state.teams.map((team) =>
    team.id === teamId
      ? { ...team, score: clampScore(team.score + amount) }
      : team
  );
  commit();
}

function setManualScore(teamId, value) {
  state.teams = state.teams.map((team) =>
    team.id === teamId ? { ...team, score: clampScore(Number(value)) } : team
  );
  commit();
}

function addTeam() {
  state.teams.push({
    id: createId("team"),
    name: `Team ${state.teams.length + 1}`,
    color: `hsl(${Math.floor(Math.random() * 360)} 82% 58%)`,
    score: 0
  });
  commit();
}

function removeTeam(teamId) {
  state.teams = state.teams.filter((team) => team.id !== teamId);
  Object.values(state.runtime).forEach((runtime) => {
    runtime.startingTeamIndex = 0;
    runtime.activeTeamIndex = 0;
  });
  commit();
}

function parseLines(value) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function addSet(type) {
  const key =
    type === "instrument"
      ? "instrumentSets"
      : type === "moderator"
        ? "moderatorSets"
        : "wordSets";
  state[key].push(
    type === "moderator"
      ? {
          id: createId("mod"),
          name: "New moderator set",
          description: "Manual scoring round."
        }
      : {
          id: createId(type === "instrument" ? "inst" : "word"),
          name: type === "instrument" ? "New instrument set" : "New word set",
          items: type === "instrument" ? ["guitar", "drums", "piano"] : ["song", "night", "train"],
          ...(type === "instrument" ? { reusable: true } : { status: "available" })
        }
  );
  commit();
}

function updateSet(type, setId, updates) {
  const key =
    type === "instrument"
      ? "instrumentSets"
      : type === "moderator"
        ? "moderatorSets"
        : "wordSets";
  state[key] = state[key].map((item) => (item.id === setId ? { ...item, ...updates } : item));
  if (Object.hasOwn(updates, "items") || Object.hasOwn(updates, "description")) {
    invalidateRoundsForSet(setId);
  }
  commit();
}

function duplicateSet(type, setId) {
  const key =
    type === "instrument"
      ? "instrumentSets"
      : type === "moderator"
        ? "moderatorSets"
        : "wordSets";
  const original = state[key].find((item) => item.id === setId);
  if (!original) {
    return;
  }
  state[key].push({
    ...original,
    id: createId(type === "instrument" ? "inst" : type === "moderator" ? "mod" : "word"),
    name: `${original.name} copy`
  });
  commit();
}

function removeSet(type, setId) {
  const key =
    type === "instrument"
      ? "instrumentSets"
      : type === "moderator"
        ? "moderatorSets"
        : "wordSets";
  state[key] = state[key].filter((item) => item.id !== setId);
  state.rounds = state.rounds.map((round) => {
    if (round.setId !== setId) {
      return round;
    }
    const fallback = getSetCollection(round.mode)[0];
    return { ...round, setId: fallback?.id ?? "" };
  });
  commit();
}

function addRound() {
  const defaultWordSet = state.wordSets[0];
  state.rounds.push({
    id: createId("round"),
    name: `Round ${state.rounds.length + 1}`,
    mode: "word",
    setId: defaultWordSet?.id ?? ""
  });
  commit();
}

function updateRound(roundId, updates) {
  state.rounds = state.rounds.map((round) => {
    if (round.id !== roundId) {
      return round;
    }
    const nextRound = { ...round, ...updates };
    if (updates.mode && updates.mode !== round.mode) {
      const fallback = getSetCollection(updates.mode)[0];
      nextRound.setId = fallback?.id ?? "";
    }
    invalidateRoundRuntime(round.id);
    return nextRound;
  });
  commit();
}

function removeRound(roundId) {
  state.rounds = state.rounds.filter((round) => round.id !== roundId);
  invalidateRoundRuntime(roundId);
  state.currentRoundIndex = normalizeIndex(state.currentRoundIndex, state.rounds.length);
  commit();
}

function resetRound() {
  const round = getRound();
  if (!round) {
    return;
  }
  state.runtime[round.id] = buildRoundRuntime(round);
  commit();
}

function nextRound() {
  if (!state.rounds.length) {
    return;
  }
  state.currentRoundIndex = (state.currentRoundIndex + 1) % state.rounds.length;
  ensureRuntime();
  commit();
}

function goToRound(roundIndex) {
  state.currentRoundIndex = normalizeIndex(roundIndex, state.rounds.length);
  ensureRuntime();
  commit();
}

function newGame() {
  state = normalizeState(getDefaultState());
  ensureRuntime();
  commit();
}

function resetScores() {
  state.teams = state.teams.map((team) => ({ ...team, score: 0 }));
  commit();
}

function passTurn() {
  const runtime = ensureRuntime();
  if (!runtime || !state.teams.length) {
    return;
  }
  runtime.activeTeamIndex = nextTeamIndex(state, runtime.activeTeamIndex);
  commit();
}

function shuffleStartingTeam() {
  const runtime = ensureRuntime();
  if (!runtime || !state.teams.length) {
    return;
  }
  const nextStart = Math.floor(Math.random() * state.teams.length);
  runtime.startingTeamIndex = nextStart;
  runtime.activeTeamIndex = nextStart;
  runtime.lastReveal = null;
  commit();
}

function awardCurrentPoints() {
  const round = getRound();
  const runtime = ensureRuntime();
  const team = state.teams[runtime?.activeTeamIndex];
  if (!round || !runtime || !team || round.mode === "moderator") {
    return;
  }

  const awardedPoints = getRevealPoints(round, runtime);
  runtime.tiles.forEach((tile) => {
    tile.state = "locked";
  });
  runtime.revealedCount = runtime.tiles.length;
  runtime.lastReveal = {
    tileNumber: "all",
    content: "All tiles revealed",
    revealColor: "gold",
    teamName: team.name
  };
  triggerBackgroundFlash("gold");
  changeScore(team.id, awardedPoints);
}

function revealTile(tileId) {
  const runtime = ensureRuntime();
  if (!runtime) {
    return;
  }

  const tile = runtime.tiles.find((item) => item.id === tileId);
  if (!tile || tile.state !== "hidden") {
    return;
  }

  tile.state = "locked";
  runtime.revealedCount += 1;
  const activeTeam = state.teams[runtime.activeTeamIndex];
  runtime.lastReveal = {
    tileNumber: tile.number,
    content: tile.content,
    revealColor: tile.revealColor,
    teamName: activeTeam?.name ?? "No team"
  };

  triggerBackgroundFlash(tile.revealColor);

  if (tile.revealColor === "red" && state.teams.length) {
    runtime.activeTeamIndex = nextTeamIndex(state, runtime.activeTeamIndex);
  }

  commit();
}

async function saveCurrentGameAsPreset() {
  if (storageMeta.mode !== "server") {
    setStorageStatus("Preset saving needs the backend server.");
    return;
  }

  const input = document.querySelector("#save-game-name-input");
  const name = input.value.trim() || `Saved game ${new Date().toLocaleString()}`;

  try {
    await apiRequest("/games", {
      method: "POST",
      body: JSON.stringify({ name, state })
    });
    input.value = "";
    setStorageStatus(`Saved preset "${name}"`);
    await refreshSavedGames();
  } catch (error) {
    setStorageStatus(`Could not save preset: ${error.message}`);
  }
}

async function loadSavedGame(gameId) {
  if (storageMeta.mode !== "server") {
    return;
  }

  try {
    const response = await apiRequest(`/games/${gameId}`);
    applyLoadedState(response.item.state, `Loaded "${response.item.name}" from server`);
    await persistState();
  } catch (error) {
    setStorageStatus(`Could not load saved game: ${error.message}`);
  }
}

async function deleteSavedGame(gameId) {
  if (storageMeta.mode !== "server") {
    return;
  }

  try {
    await apiRequest(`/games/${gameId}`, { method: "DELETE" });
    setStorageStatus("Deleted saved game.");
    await refreshSavedGames();
  } catch (error) {
    setStorageStatus(`Could not delete saved game: ${error.message}`);
  }
}

async function reloadFromServer() {
  if (storageMeta.mode !== "server") {
    setStorageStatus("Backend unavailable. Cannot reload from server.");
    return;
  }

  try {
    const response = await apiRequest("/state");
    applyLoadedState(
      response.state || getDefaultState(),
      response.updatedAt
        ? `Reloaded current game from ${formatTimestamp(response.updatedAt)}`
        : "Reloaded empty server state."
    );
  } catch (error) {
    setStorageStatus(`Reload failed: ${error.message}`);
  }
}

function renderTile(tile) {
  if (tile.state === "hidden") {
    return `
      <button class="tile hidden" data-tile-id="${tile.id}" aria-label="Reveal tile ${tile.number}">
        ${tile.number}
      </button>
    `;
  }

  return `
    <button class="tile locked-${tile.revealColor}" data-tile-id="${tile.id}" aria-label="Tile ${tile.number} already revealed">
      <span class="tile-content">
        <span class="tile-color">${tile.revealColor}</span>
        <strong class="tile-label">${escapeHtml(tile.content)}</strong>
      </span>
    </button>
  `;
}

function renderModeratorStage(round) {
  const currentSet = getCurrentSet(round);
  return `
    <article class="moderator-stage">
      <div class="moderator-stage-copy">
        <p class="section-label">Moderator round</p>
        <h3 class="moderator-stage-title">${escapeHtml(round.name)}</h3>
        <p class="muted">${escapeHtml(currentSet?.description ?? "Manual scoring round. Use the score controls below.")}</p>
      </div>
    </article>
  `;
}

function renderLiveRounds() {
  const container = document.querySelector("#live-round-list");

  if (!state.rounds.length) {
    container.innerHTML = `<div class="empty-state">Plan a few rounds in Admin to create a running order.</div>`;
    return;
  }

  container.innerHTML = state.rounds
    .map(
      (round, index) => `
        <button class="round-pill ${index === state.currentRoundIndex ? "is-current" : ""}" data-go-round="${index}">
          <span class="round-pill-copy">
            <span>${escapeHtml(round.name)}</span>
            <span>${round.mode === "word" ? "Word" : round.mode === "instrument" ? "Instrument" : "Moderator"} • ${round.mode === "moderator" ? "Manual scoring" : `${getRoundItemCount(round)} tiles`}</span>
          </span>
          <span>${index + 1}</span>
        </button>
      `
    )
    .join("");
}

function getScoreboardMarkup(runtime, compact = false) {
  if (!state.teams.length) {
    return `<div class="empty-state">Add at least one team in Admin to start keeping score.</div>`;
  }

  return state.teams
    .map(
      (team, index) => `
        <article
          class="score-row ${compact ? "compact" : ""} ${runtime?.activeTeamIndex === index ? "is-active" : ""}"
          style="--team-color:${team.color};--team-surface:${colorWithAlpha(team.color, 0.5)};"
        >
          <header>
            <div class="team-chip">
              <span class="team-swatch" style="background:${team.color}"></span>
              <strong>${escapeHtml(team.name)}</strong>
            </div>
            <span class="score-value">${team.score}</span>
          </header>
          <div class="score-controls">
            <button class="score-button" data-score-team="${team.id}" data-score-delta="1">+1</button>
            <button class="score-button" data-score-team="${team.id}" data-score-delta="2">+2</button>
            <button class="score-button" data-score-team="${team.id}" data-score-delta="-1">-1</button>
            <input
              class="score-input"
              type="number"
              value="${team.score}"
              data-manual-score-team="${team.id}"
              aria-label="Set score for ${escapeHtml(team.name)}"
            />
          </div>
        </article>
      `
    )
    .join("");
}

function renderSavedGames() {
  const container = document.querySelector("#saved-games-list");
  if (!container) {
    return;
  }

  if (storageMeta.mode !== "server") {
    container.innerHTML = `<div class="empty-state">Saved game presets are available once the backend is running.</div>`;
    return;
  }

  if (!storageMeta.savedGames.length) {
    container.innerHTML = `<div class="empty-state">No saved games yet. Save the current setup to reuse it later.</div>`;
    return;
  }

  container.innerHTML = storageMeta.savedGames
    .map(
      (item) => `
        <article class="saved-game-card">
          <div>
            <p class="section-label">Saved game</p>
            <h3>${escapeHtml(item.name)}</h3>
          </div>
          <div class="saved-game-meta">
            <span>Updated ${escapeHtml(formatTimestamp(item.updatedAt))}</span>
            <span>${item.teamCount} teams</span>
            <span>${item.roundCount} rounds</span>
          </div>
          <div class="inline-actions">
            <button class="primary-button" data-load-game="${item.id}">Load game</button>
            <button class="ghost-button" data-delete-game="${item.id}">Delete</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderSets(containerSelector, type, sets) {
  const container = document.querySelector(containerSelector);

  if (!sets.length) {
    container.innerHTML = `<div class="empty-state">No ${type} sets yet.</div>`;
    return;
  }

  container.innerHTML = sets
    .map((set) => {
      const metadata =
        type === "instrument"
          ? `<label class="pill"><input type="checkbox" data-set-toggle="${set.id}" data-set-type="${type}" ${set.reusable ? "checked" : ""} /> Reusable</label>`
          : type === "moderator"
            ? `
              <div class="field">
                <span>Description</span>
                <textarea class="textarea-input" data-set-description="${set.id}" data-set-type="${type}">${escapeHtml(set.description ?? "")}</textarea>
              </div>
            `
          : `
            <label class="field">
              <span>Status</span>
              <select class="select-input" data-set-status="${set.id}" data-set-type="${type}">
                <option value="available" ${set.status === "available" ? "selected" : ""}>Available</option>
                <option value="active" ${set.status === "active" ? "selected" : ""}>Active</option>
                <option value="used" ${set.status === "used" ? "selected" : ""}>Used</option>
              </select>
            </label>
          `;

      return `
        <article class="admin-card">
          <div class="field">
            <span>Name</span>
            <input class="text-input" type="text" value="${escapeHtml(set.name)}" data-set-name="${set.id}" data-set-type="${type}" />
          </div>
          ${metadata}
          ${type === "moderator" ? "" : `
          <div class="field">
            <span>${type === "instrument" ? "Instruments" : "Words"} (one per line)</span>
            <textarea class="textarea-input" data-set-items="${set.id}" data-set-type="${type}">${escapeHtml(set.items.join("\n"))}</textarea>
          </div>`}
          <div class="inline-actions">
            <button class="ghost-button" data-duplicate-set="${set.id}" data-set-type="${type}">Duplicate</button>
            <button class="ghost-button" data-remove-set="${set.id}" data-set-type="${type}">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderRounds() {
  const container = document.querySelector("#rounds-admin");

  if (!state.rounds.length) {
    container.innerHTML = `<div class="empty-state">No rounds planned yet.</div>`;
    return;
  }

  container.innerHTML = state.rounds
    .map((round, index) => {
      const sets = getSetCollection(round.mode);
      return `
        <article class="admin-card">
          <div class="field-grid">
            <label class="field">
              <span>Name</span>
              <input class="text-input" type="text" value="${escapeHtml(round.name)}" data-round-name="${round.id}" />
            </label>
            <label class="field">
              <span>Mode</span>
              <select class="select-input" data-round-mode="${round.id}">
                <option value="word" ${round.mode === "word" ? "selected" : ""}>Word</option>
                <option value="instrument" ${round.mode === "instrument" ? "selected" : ""}>Instrument</option>
                <option value="moderator" ${round.mode === "moderator" ? "selected" : ""}>Moderator</option>
              </select>
            </label>
            <label class="field">
              <span>Tile count</span>
              <input class="text-input" type="text" value="${getRoundItemCount(round)}" disabled />
            </label>
            <label class="field">
              <span>Content set</span>
              <select class="select-input" data-round-set="${round.id}">
                ${sets
                  .map(
                    (set) =>
                      `<option value="${set.id}" ${set.id === round.setId ? "selected" : ""}>${escapeHtml(set.name)}</option>`
                  )
                  .join("")}
              </select>
            </label>
          </div>
          <div class="inline-actions">
            <span class="pill">${index === state.currentRoundIndex ? "Live round" : "Queued"}</span>
            <button class="ghost-button" data-go-round="${index}">Go live</button>
            <button class="ghost-button" data-remove-round="${round.id}">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderTeamsAdmin() {
  const container = document.querySelector("#teams-admin");

  if (!state.teams.length) {
    container.innerHTML = `<div class="empty-state">No teams yet.</div>`;
    return;
  }

  container.innerHTML = state.teams
    .map(
      (team) => `
        <article
          class="team-card"
          style="--team-color:${team.color};--team-surface:${colorWithAlpha(team.color, 0.5)};"
        >
          <div class="field-grid">
            <label class="field">
              <span>Name</span>
              <input class="text-input" type="text" value="${escapeHtml(team.name)}" data-team-name="${team.id}" />
            </label>
            <label class="field">
              <span>Color</span>
              <input class="text-input" type="color" value="${team.color}" data-team-color="${team.id}" />
            </label>
          </div>
          <div class="inline-actions">
            <button class="ghost-button" data-remove-team="${team.id}">Delete</button>
          </div>
        </article>
      `
    )
    .join("");
}

function getSortedTeams() {
  return [...state.teams].sort((left, right) => right.score - left.score);
}

function renderResults() {
  const summary = document.querySelector("#results-summary");
  const list = document.querySelector("#results-list");
  if (!summary || !list) {
    return;
  }

  if (!state.teams.length) {
    summary.innerHTML = `<div class="empty-state">No teams configured yet.</div>`;
    list.innerHTML = "";
    return;
  }

  const ranked = getSortedTeams();
  const topScore = ranked[0]?.score ?? 0;
  const totalTeams = ranked.length;
  const totalPoints = ranked.reduce((sum, team) => sum + team.score, 0);

  summary.innerHTML = `
    <article class="results-card">
      <span class="section-label">Leader</span>
      <strong>${escapeHtml(ranked[0]?.name ?? "-")}</strong>
      <span class="muted">${topScore} points</span>
    </article>
    <article class="results-card">
      <span class="section-label">Teams</span>
      <strong>${totalTeams}</strong>
      <span class="muted">Active on scoreboard</span>
    </article>
    <article class="results-card">
      <span class="section-label">Total points</span>
      <strong>${totalPoints}</strong>
      <span class="muted">Across all teams</span>
    </article>
  `;

  list.innerHTML = ranked
    .map(
      (team, index) => `
        <article
          class="result-row ${index === 0 ? "is-first" : ""}"
          style="--team-color:${team.color};--team-surface:${colorWithAlpha(team.color, 0.5)};"
        >
          <div class="result-rank">${index + 1}</div>
          <div class="result-team">
            <span class="team-swatch" style="background:${team.color}"></span>
            <strong>${escapeHtml(team.name)}</strong>
          </div>
          <div class="result-score">${team.score}</div>
        </article>
      `
    )
    .join("");
}

function renderGame() {
  const round = getRound();
  const runtime = ensureRuntime();
  const currentSet = getCurrentSet(round);

  document.querySelector("#game-view").classList.toggle("is-active", state.view === "game");
  document.querySelector("#admin-view").classList.toggle("is-active", state.view === "admin");
  document.querySelector("#results-view").classList.toggle("is-active", state.view === "results");
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });

  if (!round || !runtime) {
    document.querySelector("#round-name").textContent = "No rounds configured";
    document.querySelector("#round-meta").textContent = "Add a round in Admin to begin.";
    document.querySelector("#round-progress").textContent = "";
    document.querySelector("#game-board").classList.remove("board-moderator");
    document.querySelector("#game-board").innerHTML = `<div class="empty-state">No rounds configured yet.</div>`;
    document.querySelector("#game-score-strip").innerHTML = getScoreboardMarkup(null, true);
    document.querySelector("#active-team-name").textContent = "-";
    document.querySelector("#active-team-tag").textContent = "Waiting for teams";
    document.querySelector("#round-points").textContent = "0";
    document.querySelector("#last-reveal-text").textContent = "No tiles revealed yet.";
    renderLiveRounds();
    return;
  }

  document.querySelector("#round-name").textContent = round.name;
  document.querySelector("#round-meta").textContent = round.mode === "moderator"
    ? "Moderator mode"
    : `${round.mode === "word" ? "Word" : "Instrument"} mode • ${getRoundItemCount(round)} tiles`;
  document.querySelector("#round-progress").textContent = round.mode === "moderator"
    ? `Round ${state.currentRoundIndex + 1} of ${state.rounds.length} • Manual scoring`
    : `Round ${state.currentRoundIndex + 1} of ${state.rounds.length} • ${runtime.revealedCount}/${getRoundItemCount(round)} tiles revealed`;
  document.querySelector("#game-board").classList.toggle("board-moderator", round.mode === "moderator");
  document.querySelector("#game-board").innerHTML = round.mode === "moderator"
    ? renderModeratorStage(round)
    : runtime.tiles.map(renderTile).join("");
  document.querySelector("#game-score-strip").innerHTML = getScoreboardMarkup(runtime, true);
  document.querySelector("#active-team-name").textContent =
    state.teams[runtime.activeTeamIndex]?.name ?? "No teams";
  document.querySelector("#active-team-tag").textContent =
    round.mode === "moderator"
      ? "Manual scoring round"
      : runtime.lastReveal?.revealColor === "red"
        ? "Turn moved after a red reveal"
        : "Current guessing team";
  document.querySelector("#round-points").textContent = round.mode === "moderator" ? "Manual" : String(getRevealPoints(round, runtime));
  document.querySelector("#last-reveal-text").textContent = runtime.lastReveal
    ? runtime.lastReveal.revealColor === "gold"
      ? `${runtime.lastReveal.teamName} marked a correct answer. All tiles are now revealed.`
      : `Tile ${runtime.lastReveal.tileNumber} revealed ${runtime.lastReveal.content} on a ${runtime.lastReveal.revealColor} tile. ${runtime.lastReveal.revealColor === "red" ? "Turn moved automatically." : `${runtime.lastReveal.teamName} keeps the guess.`}`
    : round.mode === "moderator"
      ? "Manual scoring round. Adjust scores directly below."
      : "No tiles revealed yet.";

  document.querySelector("#award-points-button").style.display = round.mode === "moderator" ? "none" : "";

  renderLiveRounds();
}

function renderStorage() {
  renderSavedGames();
  setStorageStatus(storageMeta.statusText);
}

function render() {
  renderGame();
  renderStorage();
  renderTeamsAdmin();
  renderSets("#word-sets-admin", "word", state.wordSets);
  renderSets("#instrument-sets-admin", "instrument", state.instrumentSets);
  renderSets("#moderator-sets-admin", "moderator", state.moderatorSets);
  renderRounds();
  renderResults();
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.matches("[data-view]")) {
    switchView(target.dataset.view);
  }

  if (target.matches("[data-tile-id]")) {
    revealTile(target.dataset.tileId);
  }

  if (target.matches("[data-score-team]")) {
    changeScore(target.dataset.scoreTeam, Number(target.dataset.scoreDelta));
  }

  if (target.matches("[data-remove-team]")) {
    removeTeam(target.dataset.removeTeam);
  }

  if (target.matches("[data-go-round]")) {
    goToRound(Number(target.dataset.goRound));
  }

  if (target.matches("[data-duplicate-set]")) {
    duplicateSet(target.dataset.setType, target.dataset.duplicateSet);
  }

  if (target.matches("[data-remove-set]")) {
    removeSet(target.dataset.setType, target.dataset.removeSet);
  }

  if (target.matches("[data-remove-round]")) {
    removeRound(target.dataset.removeRound);
  }

  if (target.matches("[data-load-game]")) {
    loadSavedGame(target.dataset.loadGame);
  }

  if (target.matches("[data-delete-game]")) {
    deleteSavedGame(target.dataset.deleteGame);
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.matches("[data-manual-score-team]")) {
    setManualScore(target.dataset.manualScoreTeam, target.value);
  }

  if (target.matches("[data-team-name]")) {
    updateTeam(target.dataset.teamName, { name: target.value });
  }

  if (target.matches("[data-team-color]")) {
    updateTeam(target.dataset.teamColor, { color: target.value });
  }

  if (target.matches("[data-set-name]")) {
    updateSet(target.dataset.setType, target.dataset.setName, { name: target.value });
  }

  if (target.matches("[data-set-items]")) {
    updateSet(target.dataset.setType, target.dataset.setItems, { items: parseLines(target.value) });
  }

  if (target.matches("[data-set-description]")) {
    updateSet(target.dataset.setType, target.dataset.setDescription, { description: target.value });
  }

  if (target.matches("[data-set-status]")) {
    updateSet(target.dataset.setType, target.dataset.setStatus, { status: target.value });
  }

  if (target.matches("[data-set-toggle]")) {
    updateSet(target.dataset.setType, target.dataset.setToggle, { reusable: target.checked });
  }

  if (target.matches("[data-round-name]")) {
    updateRound(target.dataset.roundName, { name: target.value });
  }

  if (target.matches("[data-round-mode]")) {
    updateRound(target.dataset.roundMode, { mode: target.value });
  }

  if (target.matches("[data-round-set]")) {
    updateRound(target.dataset.roundSet, { setId: target.value });
  }
});

document.querySelector("#next-round-button").addEventListener("click", nextRound);
document.querySelector("#reset-round-button").addEventListener("click", resetRound);
document.querySelector("#shuffle-start-button").addEventListener("click", shuffleStartingTeam);
document.querySelector("#pass-turn-button").addEventListener("click", passTurn);
document.querySelector("#award-points-button").addEventListener("click", awardCurrentPoints);
document.querySelector("#new-game-button").addEventListener("click", newGame);
document.querySelector("#reset-scores-button").addEventListener("click", resetScores);
document.querySelector("#add-team-button").addEventListener("click", addTeam);
document.querySelector("#add-word-set-button").addEventListener("click", () => addSet("word"));
document.querySelector("#add-instrument-set-button").addEventListener("click", () => addSet("instrument"));
document.querySelector("#add-moderator-set-button").addEventListener("click", () => addSet("moderator"));
document.querySelector("#add-round-button").addEventListener("click", addRound);
document
  .querySelector("#save-current-game-button")
  .addEventListener("click", saveCurrentGameAsPreset);
document.querySelector("#reload-server-button").addEventListener("click", reloadFromServer);
document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

render();
bootstrap();
