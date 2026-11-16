// The match: rounds, money, the bomb and the win. One object owns every number the HUD
// shows and every rule that ends a round, so the simulation, the bots and the HUD can never
// disagree about the state of the game. Vanguard defends, Raiders attack; a round ends by
// elimination, by the bomb exploding or being defused, or by the clock running out with no
// bomb planted. First to seven rounds takes the match, at most thirteen rounds.
import * as THREE from 'three';
import { WEAPONS, GRENADES, ARMOR_PRICE } from './weapons.js';
import { pick } from './rng.js';

export const ROUND_TIME = 100;
export const BUY_TIME = 12;
export const FUSE_TIME = 40;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const FIRST_TO = 7;
export const MAX_ROUNDS = 13;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500;
export const PLANT_REWARD = 300;
export const DEFUSE_REWARD = 300;

const _v = new THREE.Vector3();

export function createMatch(scene, world, agents, player, hooks) {
  const bombMesh = new THREE.Group();
  const bombBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.24),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#14161a'), roughness: 0.5, metalness: 0.5 }),
  );
  const bombLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#f07a1e') }),
  );
  bombLight.position.set(0, 0.16, 0);
  bombMesh.add(bombBody, bombLight);
  bombMesh.visible = false;
  scene.add(bombMesh);
  const bombLamp = new THREE.PointLight(new THREE.Color('#f07a1e'), 0, 6, 1.8);
  scene.add(bombLamp);
  // A beacon pillar over a planted bomb, so it reads across the map and in a still frame.
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 3.2, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#f07a1e'), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beacon.position.y = 1.7;
  beacon.visible = false;
  bombMesh.add(beacon);

  const match = {
    phase: 'menu',
    round: 1,
    wins: { vanguard: 0, raiders: 0 },
    money: 800,
    lossStreak: 0,
    roundTimeLeft: ROUND_TIME,
    buyTimeLeft: BUY_TIME,
    phaseTimeLeft: 0,
    roundReason: '',
    bomb: { planted: false, site: null, fuseLeft: 0, plantProgress: 0, defuseProgress: 0, planter: null, defuser: null, position: new THREE.Vector3() },
    stats: { kills: 0, deaths: 0, plants: 0, defuses: 0 },
    noise: [],
    roundHistory: [],
  };

  function aliveCount(team) {
    return agents.filter((a) => a.team === team && a.alive).length;
  }

  function emit(type, data = {}) {
    hooks.onEvent(type, { ...data, match });
  }

  function startMatch(random) {
    match.wins = { vanguard: 0, raiders: 0 };
    match.money = 800;
    match.lossStreak = 0;
    match.round = 1;
    match.stats = { kills: 0, deaths: 0, plants: 0, defuses: 0 };
    match.roundHistory = [];
    setupRound(random);
  }

  function setupRound(random) {
    // Spawns, health and weapons reset; Raiders pick a site and a carrier.
    const raiders = agents.filter((a) => a.team === 'raider');
    const vanguard = agents.filter((a) => a.team === 'vanguard' && !a.isPlayer); // the player is reset by onRoundSetup, not here
    const site = pick(random, ['A', 'B']);
    const carrier = pick(random, raiders);
    raiders.forEach((bot, i) => {
      const [x, z] = world.spawns.raiders[i % world.spawns.raiders.length];
      bot.isCarrier = bot === carrier;
      bot.targetSite = site;
      bot.holdAt = null;
      bot.route = [];
      bot.routeDest = null;
      bot.routeDone = false;
      hooks.equipBot(bot, match.round, random);
      hooks.resetBot(bot, x, z, Math.PI); // Raiders spawn north, facing south into the yard
    });
    vanguard.forEach((bot, i) => {
      const [x, z] = world.spawns.vanguard[(i + 1) % world.spawns.vanguard.length];
      bot.isCarrier = false;
      bot.targetSite = pick(random, ['A', 'B', 'mid']);
      bot.holdAt = null;
      bot.route = [];
      bot.routeDest = null;
      bot.routeDone = false;
      // Vanguard bots hold: half near their site, the rest mid and the lanes.
      const holdPool = bot.targetSite === 'A' ? world.holds.A : bot.targetSite === 'B' ? world.holds.B : world.holds.mid;
      bot.holdAt = pick(random, holdPool);
      hooks.equipBot(bot, match.round, random);
      hooks.resetBot(bot, x, z, 0); // Vanguard spawns south, facing north into the yard
    });
    match.bomb = { planted: false, site: null, fuseLeft: 0, plantProgress: 0, defuseProgress: 0, planter: null, defuser: null, position: new THREE.Vector3() };
    bombMesh.visible = false;
    bombLamp.intensity = 0;
    match.roundTimeLeft = ROUND_TIME;
    match.buyTimeLeft = BUY_TIME;
    match.phase = 'buy';
    match.phaseTimeLeft = BUY_TIME;
    hooks.onRoundSetup(match.round, site, carrier.name);
    emit('buyOpen', { site, carrier: carrier.name });
  }

  function startLive() {
    if (match.phase !== 'buy') return;
    match.phase = 'live';
    match.phaseTimeLeft = ROUND_TIME;
    emit('roundStart', { round: match.round });
  }

  function damageAgent(agent, amount, attacker, part = 'torso') {
    if (!agent.alive || match.phase === 'menu' || match.phase === 'matchEnd') return;
    let remaining = amount;
    if (agent.armor > 0) {
      const absorbed = Math.min(agent.armor, remaining * 0.5);
      agent.armor -= absorbed;
      remaining -= absorbed;
    }
    agent.health -= remaining;
    if (agent.isPlayer) emit('playerHurt', { amount: remaining, attacker: attacker?.name });
    if (agent.health > 0) return;
    agent.health = 0;
    agent.alive = false;
    agent.fall = 0;
    if (attacker && attacker.isPlayer && attacker !== agent) {
      match.money += KILL_REWARD;
      match.stats.kills += 1;
      emit('kill', { killer: attacker.name, victim: agent.name, part, reward: KILL_REWARD });
    } else {
      emit('kill', { killer: attacker?.name ?? '—', victim: agent.name, part });
    }
    if (agent.isPlayer) {
      match.stats.deaths += 1;
      emit('playerDied', {});
    }
    if (match.bomb.planter === agent) {
      match.bomb.planter = null;
      match.bomb.plantProgress = 0;
    }
    if (match.bomb.defuser === agent) {
      match.bomb.defuser = null;
      match.bomb.defuseProgress = 0;
    }
    if (agent.isCarrier && !match.bomb.planted) {
      // The bomb drops where the carrier fell: the nearest living Raider picks it
      // up and pushes on, so a round can still be won by planting after the first
      // carrier dies. Without this, one early death ends the objective entirely.
      agent.isCarrier = false;
      const living = agents.filter((a) => a.team === 'raider' && a.alive);
      if (living.length) {
        living.sort((a, b) => a.position.distanceToSquared(agent.position) - b.position.distanceToSquared(agent.position));
        const next = living[0];
        next.isCarrier = true;
        next.route = [];
        next.routeDest = null;
        next.holdAt = null;
        next.holdSince = -1;
        emit('bombPickup', { agent: next.name });
      }
    }
    checkRoundEnd();
  }

  function checkRoundEnd() {
    if (match.phase !== 'live') return;
    const van = aliveCount('vanguard');
    const rai = aliveCount('raider');
    if (rai === 0 && !match.bomb.planted) endRound('vanguard', 'Raiders eliminated');
    else if (van === 0 && !match.bomb.planted) endRound('raiders', 'Vanguard eliminated');
    else if (van === 0 && match.bomb.planted) {
      // No defender left alive: the bomb cannot be defused.
      endRound('raiders', 'Defenders eliminated — bomb detonates');
      detonate();
    }
  }

  function endRound(winner, reason) {
    if (match.phase !== 'live' && match.phase !== 'buy') return;
    match.phase = 'roundEnd';
    match.phaseTimeLeft = 4;
    match.roundReason = reason;
    match.wins[winner] += 1;
    if (winner === 'vanguard') {
      match.money += WIN_REWARD;
      match.lossStreak = 0;
    } else {
      match.lossStreak += 1;
      match.money += LOSS_REWARD + Math.min(3, match.lossStreak - 1) * LOSS_STREAK_BONUS;
    }
    match.roundHistory.push({ round: match.round, winner, reason });
    emit('roundEnd', { winner, reason, round: match.round, wins: { ...match.wins } });
    if (match.wins[winner] >= FIRST_TO || match.round >= MAX_ROUNDS) {
      match.phase = 'matchEnd';
      match.phaseTimeLeft = 0;
      emit('matchEnd', { winner: match.wins.vanguard > match.wins.raiders ? 'vanguard' : 'raiders', wins: { ...match.wins }, stats: { ...match.stats } });
    }
  }

  function detonate() {
    if (!match.bomb.planted) return;
    match.bomb.planted = false;
    bombMesh.visible = false;
    bombLamp.intensity = 0;
    emit('explode', { site: match.bomb.site, position: match.bomb.position.clone() });
    for (const agent of agents) {
      if (!agent.alive) continue;
      const d = agent.position.distanceTo(match.bomb.position);
      if (d < 12) damageAgent(agent, 200 * (1 - d / 14), null, 'frag');
    }
  }

  // The player (or a bot) holds the interact key inside a site to plant, or beside a
  // planted bomb to defuse. Progress resets the moment they stop or step away.
  function tryPlant(agent, dt) {
    const bomb = match.bomb;
    if (bomb.planted || !agent.isCarrier) return;
    const site = world.sites[agent.targetSite];
    if (!site || !site.plantBox.containsPoint(agent.position)) {
      bomb.planter = null;
      bomb.plantProgress = 0;
      return;
    }
    if (bomb.planter !== agent) {
      bomb.planter = agent;
      bomb.plantProgress = 0;
    }
    bomb.plantProgress += dt;
    emit('plantProgress', { agent: agent.name, progress: bomb.plantProgress / PLANT_TIME });
    if (bomb.plantProgress >= PLANT_TIME) {
      bomb.planted = true;
      bomb.site = agent.targetSite;
      bomb.fuseLeft = FUSE_TIME;
      bomb.position.copy(agent.position);
      bomb.position.y = 0.15;
      bombMesh.position.copy(bomb.position);
      bombMesh.visible = true;
      beacon.visible = true;
      bomb.planter = null;
      bomb.plantProgress = 0;
      if (agent.isPlayer) {
        match.money += PLANT_REWARD;
        match.stats.plants += 1;
      }
      emit('planted', { site: bomb.site, planter: agent.name });
    }
  }

  function tryDefuse(agent, dt) {
    const bomb = match.bomb;
    if (!bomb.planted) return;
    const d = agent.position.distanceTo(bomb.position);
    if (d > 2.4) {
      if (bomb.defuser === agent) {
        bomb.defuser = null;
        bomb.defuseProgress = 0;
      }
      return;
    }
    if (bomb.defuser !== agent) {
      bomb.defuser = agent;
      bomb.defuseProgress = 0;
    }
    bomb.defuseProgress += dt;
    emit('defuseProgress', { agent: agent.name, progress: bomb.defuseProgress / DEFUSE_TIME });
    if (bomb.defuseProgress >= DEFUSE_TIME) {
      bomb.planted = false;
      bombMesh.visible = false;
      bombLamp.intensity = 0;
      if (agent.isPlayer) {
        match.money += DEFUSE_REWARD;
        match.stats.defuses += 1;
      }
      emit('defused', { agent: agent.name });
      endRound('vanguard', 'Bomb defused');
    }
  }

  function playerInteract(dt) {
    if (match.phase !== 'live' || !player.alive) return;
    if (player.isCarrier) tryPlant(player, dt);
    else if (match.bomb.planted) tryDefuse(player, dt);
  }

  function buy(kind, id) {
    if (match.phase !== 'buy') return { ok: false, reason: 'not-buy-phase' };
    if (kind === 'weapon') {
      const def = WEAPONS[id];
      if (!def) return { ok: false, reason: 'unknown' };
      if (match.money < def.price) return { ok: false, reason: 'funds' };
      const result = hooks.buyWeapon(id);
      if (!result.ok) return result;
      match.money -= def.price;
      return { ok: true, cost: def.price };
    }
    if (kind === 'grenade') {
      const def = GRENADES[id];
      if (!def || match.money < def.price) return { ok: false, reason: 'funds' };
      hooks.buyGrenade(id);
      match.money -= def.price;
      return { ok: true, cost: def.price };
    }
    if (kind === 'armor') {
      if (match.money < ARMOR_PRICE) return { ok: false, reason: 'funds' };
      hooks.buyArmor();
      match.money -= ARMOR_PRICE;
      return { ok: true, cost: ARMOR_PRICE };
    }
    return { ok: false, reason: 'unknown' };
  }

  function step(dt, time, random) {
    if (match.phase === 'buy') {
      match.buyTimeLeft -= dt;
      match.phaseTimeLeft = match.buyTimeLeft;
      if (match.buyTimeLeft <= 0) startLive();
    } else if (match.phase === 'live') {
      match.roundTimeLeft -= dt;
      match.phaseTimeLeft = match.roundTimeLeft;
      if (match.bomb.planted) {
        match.bomb.fuseLeft -= dt;
        // The bomb lamp blinks faster as the fuse runs down.
        const rate = match.bomb.fuseLeft < 10 ? 0.18 : 0.5;
        const on = (time % rate) < rate / 2;
        bombLamp.intensity = on ? 14 : 0;
        bombLight.material.color.set(on ? 0xff2a1e : 0xf07a1e);
        if (match.bomb.fuseLeft <= 0) {
          detonate();
          endRound('raiders', 'Bomb detonated');
        }
      } else if (match.roundTimeLeft <= 0) {
        endRound('vanguard', 'Time expired — bomb never planted');
      }
    } else if (match.phase === 'roundEnd') {
      match.phaseTimeLeft -= dt;
      if (match.phaseTimeLeft <= 0) {
        match.round += 1;
        setupRound(random);
      }
    }
    match.noise.length = 0;
  }

  return {
    match,
    startMatch,
    startLive,
    setupRound,
    damageAgent,
    tryPlant,
    tryDefuse,
    playerInteract,
    buy,
    step,
    aliveCount,
    emit,
  };
}
