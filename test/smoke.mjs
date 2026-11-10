// Smoke test: live public API + local simulation of the example controller.
// No key needed. Run: npm test
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as api from "../src/client.mjs";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0;
async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`ok   ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

await check("api status returns versions", async () => {
  const d = await api.apiStatus();
  assert.equal(d.name, "battle.training");
  assert.ok(d.versions?.rules, "rules version present");
});

await check("ladder returns 170 entries", async () => {
  const d = await api.ladder();
  assert.ok(Array.isArray(d.entries) && d.entries.length >= 100);
  assert.equal(d.entries[0].rank, 1);
});

await check("bot house-starter has ratings", async () => {
  const d = await api.bot("house-starter");
  assert.equal(d.name, "house-starter");
  assert.ok(d.theaters?.armor?.rating > 0);
});

await check("live endpoint responds", async () => {
  const d = await api.live();
  assert.ok(d && typeof d === "object");
});

await check("docs llms.txt fetches", async () => {
  const t = await api.doc("llms");
  assert.ok(t.includes("battle.training"));
});

await check("local sim runs example controller", async () => {
  const { stdout } = await run(
    "node",
    ["src/cli.mjs", "simulate", "examples/money-scout.js", "--seeds", "4", "--vs", "brawler,random"],
    { cwd: root, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
  );
  assert.ok(/brawler|random/i.test(stdout), "sim output names house bots");
  assert.ok(/win|loss|draw|W|L/i.test(stdout), "sim output has results");
  console.log(stdout.split("\n").slice(0, 12).join("\n"));
});

console.log(`\n${pass} checks passed${process.exitCode ? " (with failures)" : ""}`);
