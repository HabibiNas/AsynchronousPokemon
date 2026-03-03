// -----------------------------
// Cache (localStorage + TTL) to minimize API calls
// -----------------------------
const CACHE_PREFIX = "pokeCache:";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const memCache = new Map();

function cacheKey(url) {
  return CACHE_PREFIX + url;
}

function readCache(url) {
  if (memCache.has(url)) return memCache.get(url);

  const raw = localStorage.getItem(cacheKey(url));
  if (!raw) return null;

  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.t !== "number") return null;

    const age = Date.now() - obj.t;
    if (age > CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(url));
      return null;
    }

    memCache.set(url, obj.data);
    return obj.data;
  } catch {
    localStorage.removeItem(cacheKey(url));
    return null;
  }
}

function writeCache(url, data) {
  memCache.set(url, data);
  localStorage.setItem(cacheKey(url), JSON.stringify({ t: Date.now(), data }));
}

async function cachedFetchJson(url) {
  const cached = readCache(url);
  if (cached) return { data: cached, fromCache: true };

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const data = await res.json();
  writeCache(url, data);
  return { data, fromCache: false };
}

// -----------------------------
// Team persistence
// -----------------------------
const TEAM_KEY = "pokemonTeam";

function loadTeam() {
  try {
    return JSON.parse(localStorage.getItem(TEAM_KEY)) || [];
  } catch {
    return [];
  }
}

function saveTeam(team) {
  localStorage.setItem(TEAM_KEY, JSON.stringify(team));
}

// -----------------------------
// DOM
// -----------------------------
const els = {
  input: document.getElementById("pokeInput"),
  searchBtn: document.getElementById("searchBtn"),
  addBtn: document.getElementById("addBtn"),
  clearTeamBtn: document.getElementById("clearTeamBtn"),
  status: document.getElementById("status"),
  error: document.getElementById("error"),

  result: document.getElementById("result"),
  pokeImg: document.getElementById("pokeImg"),
  pokeName: document.getElementById("pokeName"),
  audio: document.getElementById("pokeAudio"),
  audioNote: document.getElementById("audioNote"),

  move1: document.getElementById("move1"),
  move2: document.getElementById("move2"),
  move3: document.getElementById("move3"),
  move4: document.getElementById("move4"),

  teamList: document.getElementById("teamList"),
  teamEmpty: document.getElementById("teamEmpty"),
};

let currentPokemon = null;

function setStatus(msg) {
  els.status.textContent = msg || "";
}
function setError(msg) {
  els.error.textContent = msg || "";
}

function normalizeQuery(q) {
  return (q || "").trim().toLowerCase();
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function fillMoves(selectEl, moves) {
  selectEl.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "-- choose a move --";
  selectEl.appendChild(placeholder);

  for (const m of moves) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    selectEl.appendChild(opt);
  }

  selectEl.value = "";
}

function pickSprite(pokeJson) {
  const official = pokeJson?.sprites?.other?.["official-artwork"]?.front_default;
  return official || pokeJson?.sprites?.front_default || "";
}

function pickCry(pokeJson) {
  const latest = pokeJson?.cries?.latest || "";
  const legacy = pokeJson?.cries?.legacy || "";
  return { latest, legacy };
}

function getMoveNames(pokeJson) {
  const raw = pokeJson?.moves || [];
  const names = raw.map(x => x?.move?.name).filter(Boolean);
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

function renderCurrentPokemon(p) {
  els.result.classList.remove("hidden");

  els.pokeName.textContent = `${capitalize(p.name)} (ID: ${p.id})`;

  els.pokeImg.src = p.spriteUrl || "";
  els.pokeImg.alt = `${p.name} image`;

  const cryUrl = p.cries.latest || p.cries.legacy;
  if (cryUrl) {
    els.audio.src = cryUrl;
    els.audio.load();
    els.audioNote.textContent = p.cries.latest ? "Latest cry loaded." : "Legacy cry loaded.";
  } else {
    els.audio.removeAttribute("src");
    els.audio.load();
    els.audioNote.textContent = "No cry audio available for this Pokémon.";
  }

  fillMoves(els.move1, p.moves);
  fillMoves(els.move2, p.moves);
  fillMoves(els.move3, p.moves);
  fillMoves(els.move4, p.moves);

  els.addBtn.disabled = false;
}

function getSelectedMoves() {
  const picks = [els.move1.value, els.move2.value, els.move3.value, els.move4.value]
    .map(v => (v || "").trim())
    .filter(v => v.length > 0);

  // make unique (optional but sensible)
  return Array.from(new Set(picks));
}

function renderTeam() {
  const team = loadTeam();
  els.teamList.innerHTML = "";
  els.teamEmpty.style.display = team.length ? "none" : "block";

  team.forEach((member, idx) => {
    const item = document.createElement("div");
    item.className = "team-item";

    const img = document.createElement("img");
    img.src = member.spriteUrl || "";
    img.alt = `${member.name} image`;

    const info = document.createElement("div");

    const title = document.createElement("div");
    title.innerHTML = `<b>${capitalize(member.name)}</b> <span class="muted small">(ID: ${member.id})</span>`;

    const movesLine = document.createElement("div");
    if (member.moves?.length) {
      member.moves.forEach(mv => {
        const pill = document.createElement("span");
        pill.className = "pill";
        pill.textContent = mv;
        movesLine.appendChild(pill);
      });
    } else {
      movesLine.innerHTML = `<span class="muted">No moves selected.</span>`;
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      const t = loadTeam();
      t.splice(idx, 1);
      saveTeam(t);
      renderTeam();
    });

    info.appendChild(title);
    info.appendChild(movesLine);
    info.appendChild(document.createElement("div")).appendChild(removeBtn);

    item.appendChild(img);
    item.appendChild(info);

    els.teamList.appendChild(item);
  });
}

// -----------------------------
// Events
// -----------------------------
async function handleSearch() {
  setError("");
  setStatus("");
  els.addBtn.disabled = true;
  currentPokemon = null;

  const q = normalizeQuery(els.input.value);
  if (!q) {
    setError("Please enter a Pokémon name or ID.");
    return;
  }

  const url = `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(q)}/`;

  try {
    setStatus("Loading...");
    const { data, fromCache } = await cachedFetchJson(url);
    setStatus(fromCache ? "Loaded from cache." : "Fetched from API.");

    const p = {
      id: data.id,
      name: data.name,
      spriteUrl: pickSprite(data),
      cries: pickCry(data),
      moves: getMoveNames(data),
    };

    currentPokemon = p;
    renderCurrentPokemon(p);
  } catch (err) {
    console.error(err);
    setStatus("");
    els.result.classList.add("hidden");
    setError("Could not find that Pokémon. Try a valid name (pikachu) or ID (25).");
  }
}

function handleAddToTeam() {
  setError("");
  if (!currentPokemon) return;

  const team = loadTeam();
  if (team.length >= 6) {
    setError("Your team already has 6 Pokémon. Remove one before adding another.");
    return;
  }

  team.push({
    id: currentPokemon.id,
    name: currentPokemon.name,
    spriteUrl: currentPokemon.spriteUrl,
    moves: getSelectedMoves(),
  });

  saveTeam(team);
  renderTeam();
  setStatus("Added to team!");
}

function handleClearTeam() {
  saveTeam([]);
  renderTeam();
  setStatus("Team cleared.");
  setError("");
}

els.searchBtn.addEventListener("click", handleSearch);
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSearch();
});
els.addBtn.addEventListener("click", handleAddToTeam);
els.clearTeamBtn.addEventListener("click", handleClearTeam);

// Initial render
renderTeam();
