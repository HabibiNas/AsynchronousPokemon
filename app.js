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
  audio: document.getElementById("pokeAudio"),
  audioNote: document.getElementById("audioNote"),

  move1: document.getElementById("move1"),
  move2: document.getElementById("move2"),
  move3: document.getElementById("move3"),
  move4: document.getElementById("move4"),
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

function fillMoves(selectEl, moves) {
  selectEl.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "";
  selectEl.appendChild(placeholder);

  for (const m of moves) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    selectEl.appendChild(opt);
  }

  selectEl.value = "";
}

function pickSprites(pokeJson) {
  // big image = official artwork
  const official = pokeJson?.sprites?.other?.["official-artwork"]?.front_default || "";
  // team sprite = small front sprite (like screenshot table)
  const small = pokeJson?.sprites?.front_default || official;
  return { official, small };
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

  // Big image
  els.pokeImg.src = p.bigImg || "";
  els.pokeImg.alt = `${p.name} image`;

  // Audio
  const cryUrl = p.cries.latest || p.cries.legacy;
  if (cryUrl) {
    els.audio.src = cryUrl;
    els.audio.load();
    els.audioNote.textContent = "";
  } else {
    els.audio.removeAttribute("src");
    els.audio.load();
    els.audioNote.textContent = "";
  }

  // Moves
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

  // Unique moves (optional, but nice)
  return Array.from(new Set(picks));
}

// -----------------------------
// Team table render (like screenshot)
// -----------------------------
function renderTeam() {
  const team = loadTeam();
  const table = document.getElementById("teamTable");
  table.innerHTML = "";

  if (!team.length) {
    table.style.display = "none";
    return;
  }

  table.style.display = "table";

  team.forEach((member) => {
    const tr = document.createElement("tr");

    const tdSprite = document.createElement("td");
    tdSprite.className = "team-sprite";

    const img = document.createElement("img");
    img.src = member.spriteUrl || "";
    img.alt = `${member.name} sprite`;
    tdSprite.appendChild(img);

    const tdMoves = document.createElement("td");
    tdMoves.className = "team-moves";

    const ul = document.createElement("ul");
    const moves = member.moves || [];

    if (moves.length) {
      moves.forEach(mv => {
        const li = document.createElement("li");
        li.textContent = mv;
        ul.appendChild(li);
      });
    } else {
      const li = document.createElement("li");
      li.textContent = "(no moves selected)";
      ul.appendChild(li);
    }

    tdMoves.appendChild(ul);

    tr.appendChild(tdSprite);
    tr.appendChild(tdMoves);
    table.appendChild(tr);
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
    setStatus(fromCache ? "" : ""); // keep clean like screenshot

    const sprites = pickSprites(data);

    currentPokemon = {
      id: data.id,
      name: data.name,
      bigImg: sprites.official,
      teamImg: sprites.small,
      cries: pickCry(data),
      moves: getMoveNames(data),
    };

    renderCurrentPokemon(currentPokemon);
  } catch (err) {
    console.error(err);
    els.result.classList.add("hidden");
    setStatus("");
    setError("Could not find that Pokémon. Try a valid name (snorlax) or ID (143).");
  }
}

function handleAddToTeam() {
  setError("");
  if (!currentPokemon) return;

  const team = loadTeam();
  if (team.length >= 6) {
    setError("Team is full (6).");
    return;
  }

  team.push({
    id: currentPokemon.id,
    name: currentPokemon.name,
    spriteUrl: currentPokemon.teamImg || currentPokemon.bigImg,
    moves: getSelectedMoves(),
  });

  saveTeam(team);
  renderTeam();
}

function handleClearTeam() {
  saveTeam([]);
  renderTeam();
}

els.searchBtn.addEventListener("click", handleSearch);
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSearch();
});
els.addBtn.addEventListener("click", handleAddToTeam);
els.clearTeamBtn.addEventListener("click", handleClearTeam);

// Initial render
renderTeam();
