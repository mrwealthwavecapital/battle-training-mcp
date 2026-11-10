// Minimal REST client for the battle.training public API.
// Docs: https://api.battle.training/llms.txt
// OpenAPI: https://api.battle.training/openapi.json
// Public endpoints need no key. Account endpoints need BATTLE_TRAINING_KEY.

export const API_BASE = process.env.BATTLE_TRAINING_API || "https://api.battle.training";

// The sandbox egress drops some TLS sockets (undici UND_ERR_SOCKET) while
// curl succeeds, so every request retries with backoff.
export async function fetchWithRetry(url, opts, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, opts);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

function key() {
  return process.env.BATTLE_TRAINING_KEY || null;
}

export async function get(path, { auth = false } = {}) {
  const headers = { Accept: "application/json" };
  if (auth) {
    const k = key();
    if (!k) throw new Error("This call needs BATTLE_TRAINING_KEY set in the environment.");
    headers.Authorization = `Bearer ${k}`;
  }
  const res = await fetchWithRetry(`${API_BASE}${path}`, { headers });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = typeof data === "object" && data?.error ? data.error : `HTTP ${res.status}`;
    throw new Error(`battle.training ${path} failed: ${msg}`);
  }
  return data;
}

export async function post(path, body, { auth = true } = {}) {
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  if (auth) {
    const k = key();
    if (!k) throw new Error("This call needs BATTLE_TRAINING_KEY set in the environment.");
    headers.Authorization = `Bearer ${k}`;
  }
  const res = await fetchWithRetry(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = typeof data === "object" && data?.error ? data.error : `HTTP ${res.status}`;
    throw new Error(`battle.training ${path} failed: ${msg}`);
  }
  return data;
}

export async function getText(path) {
  const res = await fetchWithRetry(`${API_BASE}${path}`, { headers: { Accept: "text/plain, text/markdown" } });
  if (!res.ok) throw new Error(`battle.training ${path} failed: HTTP ${res.status}`);
  return res.text();
}

// --- Public reads ---------------------------------------------------------

export const apiStatus = () => get("/api");
export const ladder = () => get("/api/ladder");
export const ladders = () => get("/api/ladders");
export const ladderBySlug = (slug) => get(`/api/ladders/${encodeURIComponent(slug)}`);
export const agents = () => get("/api/agents");
export const bot = (name) => get(`/api/bots/${encodeURIComponent(name)}`);
export const match = (id) => get(`/api/matches/${encodeURIComponent(id)}`);
export const recentMatches = () => get("/api/matches");
export const live = () => get("/api/live");
export const meta = (theater = "armor") => get(`/api/meta?theater=${encodeURIComponent(theater)}`);
export const rules = (theater = "armor") => get(`/api/rules?theater=${encodeURIComponent(theater)}`);
export const replay = (id) => getText(`/api/replays/${encodeURIComponent(id)}.jsonl`);

// --- Docs -----------------------------------------------------------------

const DOCS = {
  llms: "/llms.txt",
  controller_api: "/docs/controller-api.md",
  controller_api_sub: "/docs/controller-api-sub.md",
  skill: "/skill.md",
};
export const docNames = () => Object.keys(DOCS);
export const doc = (name) => {
  const path = DOCS[name];
  if (!path) throw new Error(`Unknown doc "${name}". Known: ${docNames().join(", ")}`);
  return getText(path);
};

// --- Account writes (need BATTLE_TRAINING_KEY) ------------------------------

export const me = () => get("/api/me", { auth: true });
export const createBot = ({ name, agent, model, x }) =>
  post("/api/bots", { name, agent, model, ...(x ? { x } : {}) });
export const uploadVersion = (botName, { label, source, notes }) =>
  post(`/api/bots/${encodeURIComponent(botName)}/versions`, {
    label,
    source,
    ...(notes ? { notes } : {}),
  });
export const enrolCup = (slug, botName) =>
  post(`/api/ladders/${encodeURIComponent(slug)}/enrol`, { bot: botName });
export const scrimmage = ({ bot, seed, vs }) =>
  post("/api/scrimmage", { bot, ...(seed ? { seed } : {}), ...(vs ? { vs } : {}) });
