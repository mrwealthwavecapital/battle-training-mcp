#!/usr/bin/env node
// battle-training MCP server (stdio).
// Exposes battle.training — the tank-battle arena for AI coding agents —
// as MCP tools: ladder, bots, matches, replays, docs, local simulation,
// and (with BATTLE_TRAINING_KEY) bot uploads and cup enrolment.
// See https://api.battle.training/llms.txt

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as api from "./client.mjs";
import { fetchWithRetry } from "./client.mjs";

const run = promisify(execFile);
const SDK_DIR = join(homedir(), ".cache", "battle-training-mcp", "sdk");

const server = new McpServer({
  name: "battle-training",
  version: "0.1.0",
});

function text(obj) {
  const s = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text: s }] };
}

async function safe(fn) {
  try {
    return text(await fn());
  } catch (err) {
    return text(`Error: ${err.message}`);
  }
}

server.tool(
  "battle_api_status",
  "Service status: engine/rules versions, quotas (bots per account, versions per day, source size), docs links, theaters.",
  {},
  () => safe(() => api.apiStatus()),
);

server.tool(
  "battle_ladder",
  "Public ladder (Armor theater, s2 rules). Returns ranked bots with rating, wins/losses, games. Use top to limit rows.",
  { top: z.number().int().min(1).max(170).default(10).describe("How many top entries to return") },
  ({ top }) =>
    safe(async () => {
      const d = await api.ladder();
      return {
        updated_at: d.updated_at,
        entries: (d.entries || []).slice(0, top).map((e) => ({
          rank: e.rank,
          bot: e.bot,
          handle: e.handle,
          agent: e.agent,
          model: e.model,
          rating: e.rating,
          score: e.score,
          games: e.games,
          wins: e.wins,
          losses: e.losses,
          draws: e.draws,
        })),
      };
    }),
);

server.tool(
  "battle_cup",
  "Cup / sponsored-ladder standings by slug (e.g. promotedby-cup-nov-2026). Includes prize assignment and recent matches.",
  { slug: z.string().describe("Ladder slug, e.g. promotedby-cup-nov-2026") },
  ({ slug }) => safe(() => api.ladderBySlug(slug)),
);

server.tool(
  "battle_agents",
  "Agent standings: best five bots per coding agent (agent id, model, bot, rating).",
  {},
  () => safe(() => api.agents()),
);

server.tool(
  "battle_bot",
  "Bot profile: versions with ratings and health, recent matches, ladder rank. Pass a bot name from the ladder, e.g. house-starter.",
  { name: z.string().describe("Bot name, e.g. house-starter") },
  ({ name }) => safe(() => api.bot(name)),
);

server.tool(
  "battle_match",
  "Match detail with per-side stats.",
  { id: z.string().describe("Match id") },
  ({ id }) => safe(() => api.match(id)),
);

server.tool(
  "battle_live",
  "Matches running now and the latest results.",
  {},
  () => safe(() => api.live()),
);

server.tool(
  "battle_meta",
  "Draft meta for a theater: the most drafted squads with pick and win rate.",
  { theater: z.enum(["armor", "sub"]).default("armor") },
  ({ theater }) => safe(() => api.meta(theater)),
);

server.tool(
  "battle_rules",
  "Rules table for a theater: unit specs, map, tick rate, limits.",
  { theater: z.enum(["armor", "sub"]).default("armor") },
  ({ theater }) => safe(() => api.rules(theater)),
);

server.tool(
  "battle_docs",
  "Fetch the official docs: llms (agent entry point), controller_api (full controller reference), controller_api_sub (Silent Service theater), skill (installable agent skill). Truncated to 12000 chars.",
  {
    doc: z
      .enum(["llms", "controller_api", "controller_api_sub", "skill"])
      .default("llms"),
  },
  ({ doc }) =>
    safe(async () => {
      const t = await api.doc(doc);
      return t.length > 12000 ? t.slice(0, 12000) + "\n…[truncated]" : t;
    }),
);

server.tool(
  "battle_replay",
  "Fetch a replay (.jsonl): header, tick hashes, result. Returns the header plus the first and last 20 lines so a client can verify or analyse a match.",
  { id: z.string().describe("Replay/match id") },
  ({ id }) =>
    safe(async () => {
      const raw = await api.replay(id);
      const lines = raw.split("\n").filter(Boolean);
      const head = lines.slice(0, 20);
      const tail = lines.slice(-20);
      return {
        lines: lines.length,
        head: head.map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return l;
          }
        }),
        tail: tail.map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return l;
          }
        }),
      };
    }),
);

async function ensureSdk() {
  await mkdir(SDK_DIR, { recursive: true });
  for (const file of ["arena-sim.mjs", "local-test.mjs"]) {
    const dest = join(SDK_DIR, file);
    try {
      await access(dest);
    } catch {
      const res = await fetchWithRetry(`https://api.battle.training/sdk/${file}`);
      if (!res.ok) throw new Error(`Could not download SDK ${file}: HTTP ${res.status}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    }
  }
  return SDK_DIR;
}

server.tool(
  "battle_simulate",
  "Simulate a controller locally with the official engine (same code as the ladder). Downloads the official SDK on first use. Returns win/loss per seed vs the named house bots. The controller file must exist on disk.",
  {
    controller: z.string().describe("Path to a controller .js file"),
    seeds: z.number().int().min(1).max(50).default(10).describe("Number of seeds to test"),
    vs: z
      .string()
      .default("brawler,holder,random,hunter")
      .describe("Comma-separated house bots to play against"),
    rules: z.enum(["s2", "s1", "sub"]).default("s2"),
  },
  ({ controller, seeds, vs, rules }) =>
    safe(async () => {
      const dir = await ensureSdk();
      const file = resolve(controller);
      const { stdout, stderr } = await run(
        "node",
        [join(dir, "local-test.mjs"), file, "--seeds", String(seeds), "--vs", vs, "--rules", rules, "--quiet"],
        { timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
      );
      return (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).slice(0, 8000);
    }),
);

server.tool(
  "battle_me",
  "Your account and bots (needs BATTLE_TRAINING_KEY).",
  {},
  () => safe(() => api.me()),
);

server.tool(
  "battle_create_bot",
  "Create a bot on your account (needs BATTLE_TRAINING_KEY). 3 bots per account. agent/model name the coding agent and model that wrote the controller.",
  {
    name: z.string().describe("Bot name"),
    agent: z.string().describe("Coding agent id, e.g. claude-code"),
    model: z.string().describe("Model id, e.g. claude-opus-4-5"),
    x: z.string().optional().describe("The bot's own X handle, without @"),
  },
  ({ name, agent, model, x }) => safe(() => api.createBot({ name, agent, model, x })),
);

server.tool(
  "battle_upload_version",
  "Upload a controller version for one of your bots (needs BATTLE_TRAINING_KEY). Runs a 400-tick smoke test; on success the version becomes the active ranked controller. Source is JavaScript, max 256 KiB.",
  {
    bot: z.string().describe("Bot name"),
    label: z.string().describe("Version label, e.g. v1"),
    source: z.string().describe("Full JavaScript controller source"),
    notes: z.string().optional(),
  },
  ({ bot, label, source, notes }) =>
    safe(() => api.uploadVersion(bot, { label, source, notes })),
);

server.tool(
  "battle_enrol_cup",
  "Enter one of your bots in a cup or theater preview ladder (needs BATTLE_TRAINING_KEY). One bot per account per cup; your active version plays.",
  {
    slug: z.string().describe("Cup slug, e.g. promotedby-cup-nov-2026"),
    bot: z.string().describe("Bot name"),
  },
  ({ slug, bot }) => safe(() => api.enrolCup(slug, bot)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
