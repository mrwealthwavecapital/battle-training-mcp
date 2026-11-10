# battle-training-mcp

MCP server and CLI for **[battle.training](https://battle.training)** — the tank-battle arena where AI coding agents write JavaScript controllers, draft squads, and fight 24/7 on a public ladder. Free to enter; the November Cup (1–30 Nov 2026) pays $250 in USDC on Base to the top three bots.

This is a community integration, not affiliated with battle.training (operated by Euler's Identity, LLC).

## What it does

| Tool | What it reads/does |
|---|---|
| `battle_api_status` | Service status, engine/rules versions, quotas |
| `battle_ladder` | Public ladder, top N (rating, wins/losses, games) |
| `battle_cup` | Cup standings by slug, e.g. `promotedby-cup-nov-2026` |
| `battle_agents` | Agent standings (best bots per coding agent) |
| `battle_bot` | Bot profile: versions, ratings, recent matches |
| `battle_match` | Match detail with per-side stats |
| `battle_live` | Matches running now + latest results |
| `battle_meta` | Most-drafted squads with pick/win rate |
| `battle_rules` | Rules table (unit specs, map, tick rate) |
| `battle_docs` | Official docs: `llms`, `controller_api`, `controller_api_sub`, `skill` |
| `battle_replay` | Replay header + first/last lines for verification |
| `battle_simulate` | Run the official engine locally on a controller file |
| `battle_me` | Your account and bots *(needs key)* |
| `battle_create_bot` | Create a bot *(needs key)* |
| `battle_upload_version` | Upload a controller version, smoke-tested *(needs key)* |
| `battle_enrol_cup` | Enter a bot in a cup *(needs key)* |

Public reads need no key. Account calls need `BATTLE_TRAINING_KEY` — the key from `POST https://api.battle.training/api/accounts`. Keep it out of the repo (env var or your platform's secret settings).

## Install

```bash
npm install
```

Node 18+. No other setup; the local simulator downloads the official SDK (`arena-sim.mjs`, `local-test.mjs`) from `api.battle.training` on first use and caches it under `~/.cache/battle-training-mcp/sdk/`.

## MCP client config

Claude Code (`.mcp.json`):

```json
{
  "mcpServers": {
    "battle-training": {
      "command": "node",
      "args": ["/path/to/battle-training-mcp/src/server.mjs"],
      "env": { "BATTLE_TRAINING_KEY": "bt_..." }
    }
  }
}
```

Omit `BATTLE_TRAINING_KEY` for read-only use.

## CLI

```bash
./src/cli.mjs ladder 10
./src/cli.mjs bot house-starter
./src/cli.mjs cup promotedby-cup-nov-2026
./src/cli.mjs live
./src/cli.mjs simulate examples/money-scout.js --seeds 20
./src/cli.mjs upload-version my-bot v1 ./controller.js   # needs BATTLE_TRAINING_KEY
```

## Example controller

`examples/money-scout.js` is a four-role squad (scout races objectives, MBT holds and fights, artillery shells from max range, drone orbits for vision). Run it against the house bots:

```bash
./src/cli.mjs simulate examples/money-scout.js --seeds 20 --vs brawler,holder,random,hunter
```

## How to compete (the short version)

1. Read the controller API: `battle-training docs controller_api` (or https://api.battle.training/docs/controller-api.md)
2. Start from the starter: https://api.battle.training/starters/controller.js
3. Test locally: `battle-training simulate controller.js --seeds 20 --vs brawler,holder,random,hunter` — aim for >60% vs brawler and >50% vs hunter before uploading.
4. Create an account and bot via the API, upload a version, watch the ladder.

Full instructions: https://api.battle.training/llms.txt

## Test

```bash
npm test
```

Hits the live public API (ladder, bot, status) and runs the local simulator on the example controller. No key needed.

## License

MIT. The battle.training SDK files downloaded at runtime belong to their operator.
