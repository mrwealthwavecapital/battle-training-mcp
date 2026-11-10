// money-scout — an example controller for battle.training (Season 2 "Drafted").
//
// A four-role squad: the scout races to objectives and spots, the MBT holds the
// nearest point and fights, the artillery shells from max range, and the drone
// orbits the centre hill to keep vision. Written for this repo as a worked
// example of the controller API — run it with:
//   battle-training simulate examples/money-scout.js --seeds 20
//
// Docs: https://api.battle.training/docs/controller-api.md

const FP = 65536;
const FULL = 4096;

let rules, map, side, center;
const lastPos = {}; // unit id -> {x, y, tick}

function dist2(ax, ay, bx, by) {
  const dx = (bx - ax) / FP, dy = (by - ay) / FP;
  return dx * dx + dy * dy;
}
function angleTo(ax, ay, bx, by) {
  return Math.round((Math.atan2(by - ay, bx - ax) / (2 * Math.PI)) * FULL) & (FULL - 1);
}
function angDiff(a, b) {
  let d = (b - a) & (FULL - 1);
  return d > FULL / 2 ? d - FULL : d;
}
function tileAt(x, y) {
  const tx = Math.floor(x / FP), ty = Math.floor(y / FP);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return -1;
  return map.terrain[ty * map.width + tx];
}
function groundPassable(x, y) {
  const t = tileAt(x, y);
  return t !== 2 && t !== 4 && t !== 6; // water, rock, ruin
}
// Objective worth driving to: weight falls off with distance squared, so near
// points win; enemy-held points are worth contesting, ours are skipped.
function pickObjective(o, x, y) {
  let best = null, score = -1;
  for (const p of o.objectives || []) {
    if (p.owner === side && p.state === "held") continue;
    const contest = p.owner !== null && p.owner !== side ? 1.5 : 1;
    const s = (p.weight * contest) / (1 + dist2(x, y, p.x, p.y));
    if (s > score) { score = s; best = p; }
  }
  return best ? [best.x, best.y] : center;
}
function nearestContact(o, x, y) {
  let target = null, best = Infinity;
  for (const c of o.contacts) {
    const d = dist2(x, y, c.x, c.y);
    if (d < best) { best = d; target = c; }
  }
  return { target, distTiles: target ? Math.sqrt(best) : Infinity };
}
function drive(u, goal, o) {
  const order = { id: u.id };
  if (!goal || !o.canMove) return order;
  const spec = rules.units[u.kind] || {};
  const turnRate = spec.turnRate || 64;
  let want = angleTo(u.x, u.y, goal[0], goal[1]);
  // Fan out around obstacles; drones fly over everything.
  if (u.kind !== "drone") {
    const probe = [0, 256, -256, 512, -512, 1024, -1024];
    for (const off of probe) {
      const a = (want + off) & (FULL - 1);
      const rad = (a / FULL) * 2 * Math.PI;
      if (groundPassable(u.x + Math.cos(rad) * FP * 2, u.y + Math.sin(rad) * FP * 2)) {
        want = a;
        break;
      }
    }
  }
  const d = angDiff(u.heading, want);
  order.steer = Math.max(-FP, Math.min(FP, Math.round((d / turnRate) * FP)));
  order.throttle = Math.abs(d) > 768 ? Math.round(FP * 0.25) : FP;
  // Stuck? Reverse out and turn hard.
  const prev = lastPos[u.id];
  if (prev && o.tick - prev.tick >= 40) {
    const moved = dist2(prev.x, prev.y, u.x, u.y);
    if (moved < 0.04 && order.throttle > 0) {
      order.throttle = -FP;
      order.steer = FP;
    }
    lastPos[u.id] = { x: u.x, y: u.y, tick: o.tick };
  } else if (!prev) {
    lastPos[u.id] = { x: u.x, y: u.y, tick: o.tick };
  }
  if (u.blocked) { order.throttle = -FP; order.steer = FP; }
  return order;
}

globalThis.controller = {
  draft(h) {
    if (!h.draft) return undefined;
    const pick = ["scout", "mbt", "artillery", "drone"];
    const cost = pick.reduce((c, k) => c + (h.draft.costs[k] ?? 99), 0);
    return cost <= h.draft.budget && pick.every((k) => h.draft.roster.includes(k))
      ? pick
      : undefined;
  },

  hello(h) {
    rules = h.rules;
    map = h.map;
    side = h.side;
    center = [
      Math.floor(map.width / 2) * FP + FP / 2,
      Math.floor(map.height / 2) * FP + FP / 2,
    ];
  },

  tick(o) {
    const units = [];
    const sayTick = o.tick % 400 === 0;
    for (const u of o.units) {
      if (!u.alive) continue;
      const spec = rules.units[u.kind] || {};
      const gun = spec.gun || {};
      const { target, distTiles } = nearestContact(o, u.x, u.y);
      let goal = null;

      if (u.kind === "scout") {
        // Race to objectives; never stop to brawl.
        goal = pickObjective(o, u.x, u.y);
      } else if (u.kind === "mbt") {
        goal = pickObjective(o, u.x, u.y);
        // Hold and fight when an enemy is in gun range.
        if (target && distTiles < (gun.maxRange || 30 * FP) / FP * 0.75) goal = null;
      } else if (u.kind === "artillery") {
        // Keep the enemy at arm's length: inside min range, back away.
        if (target && distTiles < ((gun.minRange || 0) / FP) * 1.4) {
          goal = [u.x * 2 - target.x, u.y * 2 - target.y];
        } else {
          goal = pickObjective(o, u.x, u.y);
        }
      } else if (u.kind === "drone") {
        // Orbit the centre hill for vision; offset per unit id so drones spread.
        const orbit = 14 + (u.id % 3) * 6;
        const a = ((o.tick * 2 + u.id * 137) % FULL) / FULL * 2 * Math.PI;
        goal = [
          Math.round(center[0] + Math.cos(a) * orbit * FP),
          Math.round(center[1] + Math.sin(a) * orbit * FP),
        ];
      } else {
        goal = pickObjective(o, u.x, u.y);
      }

      const order = drive(u, goal, o);

      // Weapons.
      if (target && gun.mode === "direct" && u.reload === 0) {
        order.aimAt = [target.x, target.y];
        const aimed =
          Math.abs(angDiff(u.turret, angleTo(u.x, u.y, target.x, target.y))) <=
          (gun.aimTolerance || 102);
        if (aimed && distTiles <= (gun.maxRange || 0) / FP) order.fire = true;
      } else if (target && gun.mode === "indirect" && u.reload === 0) {
        // Lead the target: shells take ~2s + 0.05s/tile; aim where it will be.
        const flightTicks = 40 + Math.round(distTiles * 1);
        const leadX = Math.round(target.x + Math.cos((target.heading / FULL) * 2 * Math.PI) * (target.speed || 0) * flightTicks);
        const leadY = Math.round(target.y + Math.sin((target.heading / FULL) * 2 * Math.PI) * (target.speed || 0) * flightTicks);
        const inRange =
          distTiles >= (gun.minRange || 0) / FP && distTiles <= (gun.maxRange || 0) / FP;
        // Only fire if the lead point itself is still in range (else the shell is refused).
        const leadDist = Math.sqrt(dist2(u.x, u.y, leadX, leadY));
        if (inRange && leadDist >= (gun.minRange || 0) / FP && leadDist <= (gun.maxRange || 0) / FP) {
          order.fire = [leadX, leadY];
        }
      } else if (target && gun.mode === "none" && u.kind !== "drone") {
        // Secondary gun only (engineer MG): fire when close.
        if (u.reload2 === 0 && distTiles <= 8) order.fire = true;
      }
      units.push(order);
    }
    const out = { units };
    if (sayTick) out.say = "money-scout holding points";
    return out;
  },
};
