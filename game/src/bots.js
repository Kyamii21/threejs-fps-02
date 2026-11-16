// Bot agents: nine teammates and opponents who play the same game the player does. Each
// bot is a body with a weapon, a route through the waypoint graph and a small state machine:
// advance along its route, hold a position and scan, engage what it sees, plant the bomb
// when it carries it, defuse when the other side planted. Bots see through a field of view
// and a line-of-sight ray (smoke blinds them, as it blinds the player), hear nearby
// gunshots, and shoot in bursts with a reaction time and an aim error that grows with
// distance, so a still target at long range is dangerous and a moving one is not.
import * as THREE from 'three';
import { createBody } from './player.js';
import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { TEAM } from './palette.js';
import { pick } from './rng.js';

const EYE_HEIGHT = 1.55;
const HEAD_Y = 1.53;
const TORSO_Y = 1.0;
const LEGS_Y = 0.45;
const REACTION_MIN = 0.38;
const REACTION_MAX = 0.75;
const PERCEIVE_EVERY = 0.12;
const SIGHT_RANGE = 46;
const FOV_COS = 0.35; // about 100 degrees

const _eye = new THREE.Vector3();
const _target = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _facing = new THREE.Vector3();
const _wish = new THREE.Vector3();

function buildBotMeshes(team) {
  const colors = TEAM[team];
  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(colors.cloth), roughness: 0.65, metalness: 0.05 });
  const trim = new THREE.MeshStandardMaterial({ color: new THREE.Color(colors.trim), roughness: 0.6, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#14161a'), roughness: 0.7, metalness: 0.2 });

  const group = new THREE.Group();
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.85, 0.26), trim);
  legs.position.y = LEGS_Y;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.8, 0.32), cloth);
  torso.position.y = TORSO_Y;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), cloth);
  head.position.y = HEAD_Y;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.05), dark);
  visor.position.set(0, HEAD_Y + 0.02, -0.15);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), dark);
  gun.position.set(0.22, 1.05, -0.35);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.16), trim);
  pack.position.set(0, 1.05, 0.24);
  group.add(legs, torso, head, visor, gun, pack);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { group, legs, torso, head };
}

export function createBot(scene, world, id, name, team, spawnX, spawnZ, yaw) {
  const body = createBody(world.colliders, spawnX, spawnZ, yaw);
  const meshes = buildBotMeshes(team);
  scene.add(meshes.group);

  const agent = {
    id,
    name,
    team,
    isPlayer: false,
    body,
    group: meshes.group,
    position: body.state.position,
    health: 100,
    armor: 0,
    alive: true,
    weapon: { def: WEAPONS.pistol, mag: 12, reserve: 48, cooldown: 0, reloadLeft: 0 },
    hitMeshes: [meshes.legs, meshes.torso, meshes.head],
    // AI state
    state: 'advance',
    route: [],
    routeIndex: 0,
    holdAt: null,
    holdUntil: 0,
    targetSite: null,
    isCarrier: false,
    seen: null, // { agent, time } — the position lives in seenPos, reused, never re-allocated
    seenPos: new THREE.Vector3(),
    plantWait: 0, // seconds the carrier has stood on the site waiting to plant
    holdSince: -1, // when the current hold began; -1 means not yet timed
    stuckCount: 0, // consecutive re-paths without progress; the carrier switches sites at 3
    engageSince: 0, // when the current fight began; the carrier breaks off after 5 s
    pushUntil: 0, // the carrier does not stop to fight again before this time
    reactAt: 0,
    burstLeft: 0,
    burstPauseUntil: 0,
    perceiveAt: 0,
    strafeDir: 1,
    strafeUntil: 0,
    stuckSince: 0,
    lastProgress: null,
    investigate: null,
    fall: 0,
  };
  meshes.legs.userData = { agent, part: 'legs' };
  meshes.torso.userData = { agent, part: 'torso' };
  meshes.head.userData = { agent, part: 'head' };
  return agent;
}

// Equip a bot for a round: rifles from round three on, a sniper for one Raider, a frag
// for a third of the team, armour once the money would allow it.
export function equipBot(agent, round, random) {
  let def = WEAPONS.pistol;
  if (round >= 3) def = random() < 0.85 ? WEAPONS.rifle : WEAPONS.smg;
  else if (round === 2) def = random() < 0.5 ? WEAPONS.smg : WEAPONS.pistol;
  agent.weapon = { def, mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0 };
  agent.armor = round >= 3 ? 100 : 0;
  agent.grenades = random() < 0.3 ? { frag: 1, smoke: 0 } : { frag: 0, smoke: 0 };
  agent.health = 100;
  agent.alive = true;
  agent.fall = 0;
  agent.group.rotation.set(0, 0, 0);
  agent.group.position.y = 0;
}

export function resetBotForRound(agent, spawnX, spawnZ, yaw) {
  agent.body.teleport(spawnX, spawnZ, yaw);
  agent.state = 'advance';
  agent.route = [];
  agent.routeIndex = 0;
  agent.holdAt = null;
  agent.holdSince = -1;
  agent.plantWait = 0;
  agent.stuckCount = 0;
  agent.engageSince = 0;
  agent.pushUntil = 0;
  agent.seen = null;
  agent.investigate = null;
  agent.burstLeft = 0;
  agent.burstPauseUntil = 0;
  agent.stuckSince = 0;
  agent.lastProgress = null;
}

function syncMeshes(agent) {
  const p = agent.position;
  agent.group.position.set(p.x, p.y, p.z);
  agent.group.rotation.y = agent.body.state.yaw;
  if (!agent.alive) {
    agent.fall = Math.min(1, agent.fall + 0.06);
    agent.group.rotation.x = -agent.fall * 1.45;
    agent.group.position.y = -agent.fall * 0.1;
  }
}

function aimAt(agent, x, y, z, dt, error) {
  const eye = agent.body.eyePosition(_eye);
  const dx = x - eye.x;
  const dy = y - eye.y;
  const dz = z - eye.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  const targetYaw = Math.atan2(-dx, -dz);
  const targetPitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  let dyaw = targetYaw - agent.body.state.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  const turn = Math.min(1, dt * 7);
  agent.body.state.yaw += dyaw * turn;
  agent.body.state.pitch += (targetPitch - agent.body.state.pitch) * turn;
  // Aim error is added at fire time, not to the body, so the bot's gun stays honest.
  return error;
}

// One bot, one fixed step. ctx carries everything the bot may touch: the match phase,
// the bomb, the other agents, the combat helpers and the noise other agents made.
export function stepBot(agent, dt, time, ctx) {
  if (!agent.alive) {
    syncMeshes(agent);
    return;
  }
  const { world, combat, random, phase, bomb, player, agents, noise, onDamage, onShotFired } = ctx;
  const weapon = agent.weapon;
  weapon.cooldown = Math.max(0, weapon.cooldown - dt);
  if (weapon.reloadLeft > 0) {
    weapon.reloadLeft = Math.max(0, weapon.reloadLeft - dt);
    if (weapon.reloadLeft === 0) {
      const need = weapon.def.mag - weapon.mag;
      const take = Math.min(need, weapon.reserve);
      weapon.mag += take;
      weapon.reserve -= take;
    }
  }

  // --- Perception, throttled and staggered so nine bots do not raycast on one frame.
  // Bots only perceive and fight while the round is live.
  if (phase === 'live' && time >= agent.perceiveAt) {
    agent.perceiveAt = time + PERCEIVE_EVERY + random() * 0.06;
    const eye = agent.body.eyePosition(_eye);
    let best = null;
    let bestD = Infinity;
    for (const other of agents) {
      if (other === agent || !other.alive || other.team === agent.team) continue;
      const d = eye.distanceTo(other.position);
      if (d > SIGHT_RANGE || d >= bestD) continue;
      _target.copy(other.position);
      _target.y += 1.1;
      _dir.copy(_target).sub(eye).normalize();
      _facing.set(-Math.sin(agent.body.state.yaw), 0, -Math.cos(agent.body.state.yaw));
      if (_dir.dot(_facing) < FOV_COS && d > 6) continue; // outside the field of view, unless very close
      if (!combat.canSee(eye, _target, ctx.smokeClouds)) continue;
      best = other;
      bestD = d;
    }
    if (best) {
      if (!agent.seen || agent.seen.agent !== best) {
        agent.reactAt = time + REACTION_MIN + random() * (REACTION_MAX - REACTION_MIN);
      }
      agent.seen = { agent: best, time };
      agent.seenPos.set(best.position.x, best.position.y + 1.1, best.position.z);
      // The bomb carrier does not stop to trade shots at range: it only fights
      // enemies close enough to block the push, and after five seconds of fighting
      // it breaks off and pushes on, or the bomb never reaches the site.
      const carrying = agent.isCarrier && !bomb.planted;
      if (carrying && (bestD > 14 || time < agent.pushUntil)) {
        agent.state = 'advance';
      } else {
        agent.state = 'engage';
        if (carrying && !agent.engageSince) agent.engageSince = time;
      }
    } else if (agent.seen && time - agent.seen.time > 2.5) {
      agent.seen = null;
      agent.engageSince = 0;
      agent.investigate = agent.investigate ?? null;
      if (agent.state === 'engage') agent.state = 'advance';
    }
    // Hearing: a shot within 26 m is a position worth investigating.
    for (const event of noise) {
      if (event.agent === agent || event.agent.team === agent.team) continue;
      if (event.position.distanceToSquared(agent.position) > 26 * 26) continue;
      if (!agent.seen) agent.investigate = { x: event.position.x, z: event.position.z, time };
    }
  }

  const body = agent.body.state;
  let wishX = 0;
  let wishZ = 0;
  let crouch = false;

  // The carrier breaks off a long fight and pushes to the site instead of dying
  // in a staring contest at mid: five seconds of trading shots is enough.
  if (phase === 'live' && agent.isCarrier && !bomb.planted && agent.state === 'engage' && agent.engageSince && time - agent.engageSince > 5) {
    agent.seen = null;
    agent.engageSince = 0;
    agent.pushUntil = time + 6;
    agent.state = 'advance';
  }

  if (phase !== 'live') {
    // Between rounds the bots stand at spawn; nothing to do but idle.
  } else if (phase === 'live' && agent.state === 'engage' && agent.seen) {
    const target = agent.seenPos;
    const distance = Math.hypot(target.x - body.position.x, target.z - body.position.z);
    aimAt(agent, target.x, target.y, target.z, dt, 0);
    // Strafe to stay hard to hit; close in if far, back off if point blank.
    if (time >= agent.strafeUntil) {
      agent.strafeDir = random() < 0.5 ? -1 : 1;
      agent.strafeUntil = time + 0.7 + random() * 0.7;
    }
    const forward = distance > 16 ? 0.7 : distance < 4 ? -0.5 : 0;
    const sin = Math.sin(body.yaw);
    const cos = Math.cos(body.yaw);
    wishX = -sin * forward + cos * agent.strafeDir * 0.8;
    wishZ = -cos * forward - sin * agent.strafeDir * 0.8;
    const wishLen = Math.hypot(wishX, wishZ) || 1;
    wishX /= wishLen;
    wishZ /= wishLen;

    // Fire in bursts once the reaction time has passed.
    if (time >= agent.reactAt && weapon.cooldown === 0 && weapon.reloadLeft === 0 && time >= agent.burstPauseUntil) {
      if (weapon.mag === 0) {
        if (weapon.reserve > 0) weapon.reloadLeft = weapon.def.reload;
      } else {
        if (agent.burstLeft === 0) agent.burstLeft = 3 + Math.floor(random() * 4);
        agent.burstLeft -= 1;
        const error = 0.012 + (distance / SIGHT_RANGE) * 0.05 + agent.body.groundSpeed() * 0.004;
        const eye = agent.body.eyePosition(_eye);
        _dir.set(-Math.sin(body.yaw) * Math.cos(body.pitch), Math.sin(body.pitch), -Math.cos(body.yaw) * Math.cos(body.pitch));
        const result = combat.fire({
          origin: eye,
          direction: _dir,
          spread: error,
          random,
          damage: weapon.def.damage,
          headMult: weapon.def.headMult,
          shootables: ctx.shootables,
        });
        weapon.mag -= 1;
        weapon.cooldown = weapon.def.gap;
        onShotFired(agent, eye);
        if (result.hit && result.agent) onDamage(result.agent, result.damage, agent, result.part);
        if (agent.burstLeft === 0) agent.burstPauseUntil = time + 0.45 + random() * 0.6;
      }
    }
  } else {
    // --- Role behaviour: routes, holds, the bomb. Helpers return a wish direction; the
    // one body.step at the end of this function does the moving. ---
    const targetSite = agent.targetSite;
    if (agent.team === 'raider' && bomb.planted) {
      // The bomb is down: Raiders defend the planted site.
      if (!agent.holdAt) agent.holdAt = pick(random, world.holds[targetSite] ?? world.holds.mid);
      const w = moveToward(agent, agent.holdAt[0], agent.holdAt[1], dt);
      wishX = w.x;
      wishZ = w.z;
      agent.state = 'hold';
    } else if (agent.team === 'vanguard' && bomb.planted) {
      // Defenders retake: run to the planted site, then defuse.
      const site = world.sites[bomb.site];
      const d = Math.hypot(site.center.x - body.position.x, site.center.z - body.position.z);
      if (d < 2.2) {
        ctx.tryDefuse(agent, dt);
      } else {
        const w = followRoute(agent, site.center.x, site.center.z, ctx, dt);
        wishX = w.x;
        wishZ = w.z;
      }
    } else if (agent.team === 'raider' && agent.isCarrier && targetSite) {
      const site = world.sites[targetSite];
      const d = Math.hypot(site.center.x - body.position.x, site.center.z - body.position.z);
      if (d < 2.5) {
        // On the site: plant when it is clear, or after five seconds under fire — a
        // carrier that waits for a perfectly empty site never plants at all.
        agent.plantWait += dt;
        const siteClear = !agents.some((other) => other.alive && other.team !== agent.team && other.position.distanceTo(site.center) < 9);
        if (siteClear || agent.plantWait > 5) {
          ctx.tryPlant(agent, dt);
        }
      } else {
        agent.plantWait = 0;
        if (agent.stuckCount >= 3) {
          // Three re-paths without progress: this site is not reachable from here,
          // so try the other one instead of walking into the same wall all round.
          agent.targetSite = agent.targetSite === 'A' ? 'B' : 'A';
          agent.stuckCount = 0;
          agent.route = [];
        }
        const w = followRoute(agent, site.center.x, site.center.z, ctx, dt);
        wishX = w.x;
        wishZ = w.z;
      }
    } else if (agent.holdAt) {
      if (agent.holdSince < 0) agent.holdSince = time;
      const quietFor = time - agent.holdSince;
      const rotateAfter = agent.team === 'raider' ? 12 : 25;
      if (phase === 'live' && !bomb.planted && quietFor > rotateAfter) {
        // Nothing came down the lane: Raiders push on toward the site, Vanguard rotates
        // to a new hold, so a round never stalls into a staring contest.
        agent.holdAt = null;
        agent.holdSince = -1;
        agent.route = [];
        agent.state = 'advance';
      } else {
        const w = moveToward(agent, agent.holdAt[0], agent.holdAt[1], dt);
        wishX = w.x;
        wishZ = w.z;
        agent.state = 'hold';
        // Scan the lane while holding.
        body.yaw += Math.sin(time * 0.5 + agent.id.length) * dt * 0.4;
      }
    } else if (agent.investigate && time - agent.investigate.time < 6) {
      const w = followRoute(agent, agent.investigate.x, agent.investigate.z, ctx, dt);
      wishX = w.x;
      wishZ = w.z;
    } else {
      // Advance along the route; when it ends, pick a hold near the objective.
      if (!agent.route.length) {
        const dest = agent.team === 'raider' && targetSite
          ? world.sites[targetSite].center
          : pick(random, world.holds[targetSite ?? 'mid']);
        agent.routeDest = [dest.x, dest.z];
        agent.route = world.findPath(body.position.x, body.position.z, nearestNodeId(world, dest.x, dest.z));
        agent.routeIndex = 0;
      }
      const w = followRoute(agent, null, null, ctx, dt);
      wishX = w.x;
      wishZ = w.z;
      if (!agent.route.length && agent.routeDest) {
        agent.holdAt = agent.team === 'raider' && targetSite
          ? pick(random, world.holds[targetSite])
          : agent.routeDest;
        agent.routeDest = null;
      }
    }
  }

  // Crouch when holding a low angle or when the route says so; never while engaging.
  agent.body.step(dt, wishX, wishZ, crouch, false);
  syncMeshes(agent);
}

function nearestNodeId(world, x, z) {
  return world.nearestNode(x, z);
}

// Turn toward a point and return the wish direction for the caller's one body.step.
const _wishOut = { x: 0, z: 0 };

function moveToward(agent, x, z, dt) {
  const body = agent.body.state;
  const dx = x - body.position.x;
  const dz = z - body.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 0.6) {
    _wishOut.x = 0;
    _wishOut.z = 0;
    return _wishOut;
  }
  const targetYaw = Math.atan2(-dx, -dz);
  let dyaw = targetYaw - body.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  body.yaw += dyaw * Math.min(1, dt * 6);
  _wishOut.x = dx / distance;
  _wishOut.z = dz / distance;
  return _wishOut;
}

function followRoute(agent, destX, destZ, ctx, dt) {
  const body = agent.body.state;
  if (destX !== null && destZ !== null) {
    if (!agent.route.length || agent.routeDone) {
      agent.route = ctx.world.findPath(body.position.x, body.position.z, nearestNodeId(ctx.world, destX, destZ));
      agent.routeIndex = 0;
      agent.routeDone = false;
    }
  }
  if (!agent.route.length) {
    _wishOut.x = 0;
    _wishOut.z = 0;
    return _wishOut;
  }
  const node = agent.route[agent.routeIndex];
  if (!node) {
    agent.route = [];
    agent.routeDone = true;
    _wishOut.x = 0;
    _wishOut.z = 0;
    return _wishOut;
  }
  const dx = node[0] - body.position.x;
  const dz = node[1] - body.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1.1) {
    agent.routeIndex += 1;
    if (agent.routeIndex >= agent.route.length) {
      agent.route = [];
      agent.routeDone = true;
      agent.stuckCount = 0;
    }
    _wishOut.x = 0;
    _wishOut.z = 0;
    return _wishOut;
  }
  // Stuck detection: no progress in 1.5 s means re-path.
  if (!agent.lastProgress || Math.hypot(body.position.x - agent.lastProgress.x, body.position.z - agent.lastProgress.z) > 0.4) {
    agent.lastProgress = { x: body.position.x, z: body.position.z, time: ctx.time };
  } else if (ctx.time - agent.lastProgress.time > 1.5) {
    agent.route = [];
    agent.lastProgress = null;
    agent.stuckCount = (agent.stuckCount ?? 0) + 1;
    _wishOut.x = 0;
    _wishOut.z = 0;
    return _wishOut;
  }
  const targetYaw = Math.atan2(-dx, -dz);
  let dyaw = targetYaw - body.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  body.yaw += dyaw * Math.min(1, dt * 6);
  _wishOut.x = dx / distance;
  _wishOut.z = dz / distance;
  return _wishOut;
}
