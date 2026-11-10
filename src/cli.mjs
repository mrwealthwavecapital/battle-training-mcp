#!/usr/bin/env node
// battle-training CLI: ladder, bot, cup, live, agents, meta, rules, docs,
// replay, status, simulate, me, upload-version.
// Usage: battle-training <command> [args] [--json]
// Full docs: https://api.battle.training/llms.txt

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import * as api from "./client.mjs";
import { fetchWithRetry } from "./client.mjs";

const run = promisify(execFile);
const SDK_DIR = join(homedir(), ".cache", "battle-training-mcp", "sdk");

const [cmd, ...rest] = process.argv.slice(2);
const json = rest.includes("--json");
const args = rest.filter((a) => a !== "--json");

function out(data) {
  if (json) console.log(JSON.stringify(data, null, 2));
  else if (typeof data === "string") console.log(data);
  else console.log(JSON.stringify(data, null, 2));
}

function usage() {
  console.log(`battle-training — CLI for battle.training (tank-battle arena for AI coding agents)

Usage: battle-training <command> [args]

  status                 service status, versions, quotas
  ladder [N]             top N of the public ladder (default 10)
  cup <slug>             cup standings, e.g. promotedby-cup-nov-2026
  agents                 agent standings (best bots per coding agent)
  bot <name>             bot profile, e.g. house-starter
  match <id>             match detail
  live                   matches running now + latest results
  meta [armor|sub]       most drafted squads with pick/win rate
  rules [armor|sub]      rules table
  docs [llms|controller_api|controller_api_sub|skill]
  replay <id>            replay header + first/last lines
  simulate <file> [--seeds N] [--vs brawler,holder,random,hunter]
                         run the official engine locally on a controller
  me                     your account and bots (needs BATTLE_TRAINING_KEY)
  upload-version <bot> <label> <file>
                         upload a controller version (needs BATTLE_TRAINING_KEY)

Set BATTLE_TRAINING_KEY for account calls. Docs: https://battle.training`);
}

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

try {
  switch (cmd) {
    case "status":
      out(await api.apiStatus());
      break;
    case "ladder": {
      const n = parseInt(args[0] || "10", 10);
      const d = await api.ladder();
      out({
        updated_at: d.updated_at,
        entries: (d.entries || []).slice(0, n),
      });
      break;
    }
    case "cup":
      if (!args[0]) throw new Error("cup needs a slug, e.g. promotedby-cup-nov-2026");
      out(await api.ladderBySlug(args[0]));
      break;
    case "agents":
      out(await api.agents());
      break;
    case "bot":
      if (!args[0]) throw new Error("bot needs a name, e.g. house-starter");
      out(await api.bot(args[0]));
      break;
    case "match":
      if (!args[0]) throw new Error("match needs an id");
      out(await api.match(args[0]));
      break;
    case "live":
      out(await api.live());
      break;
    case "meta":
      out(await api.meta(args[0] || "armor"));
      break;
    case "rules":
      out(await api.rules(args[0] || "armor"));
      break;
    case "docs":
      out(await api.doc(args[0] || "llms"));
      break;
    case "replay": {
      if (!args[0]) throw new Error("replay needs an id");
      const raw = await api.replay(args[0]);
      const lines = raw.split("\n").filter(Boolean);
      out({ lines: lines.length, head: lines.slice(0, 3), tail: lines.slice(-3) });
      break;
    }
    case "simulate": {
      if (!args[0]) throw new Error("simulate needs a controller file");
      const seeds = (() => {
        const i = args.indexOf("--seeds");
        return i >= 0 ? args[i + 1] : "10";
      })();
      const vs = (() => {
        const i = args.indexOf("--vs");
        return i >= 0 ? args[i + 1] : "brawler,holder,random,hunter";
      })();
      const dir = await ensureSdk();
      const { stdout, stderr } = await run(
        "node",
        [join(dir, "local-test.mjs"), resolve(args[0]), "--seeds", seeds, "--vs", vs, "--rules", "s2"],
        { timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
      );
      process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      break;
    }
    case "me":
      out(await api.me());
      break;
    case "upload-version": {
      if (args.length < 3) throw new Error("upload-version needs <bot> <label> <file>");
      const source = await readFile(resolve(args[2]), "utf8");
      out(await api.uploadVersion(args[0], { label: args[1], source }));
      break;
    }
    default:
      usage();
      if (cmd) process.exitCode = 1;
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
}
