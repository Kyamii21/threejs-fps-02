// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's rate.
// The simulation owns the match, the player, the bots and the grenades; the render only
// copies body positions into the camera and draws. ?shot=start|buy|play|bomb|end with
// &seed=N sets up a deterministic frame for a capture, renders it twice, then freezes it
// and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createBody, keysToWish } from './player.js';
import { createWeaponView, WEAPONS, WEAPON_ORDER, GRENADES } from './weapons.js';
import { createCombat } from './combat.js';
import { createEffects } from './effects.js';
import { createGrenades } from './grenades.js';
import { createBot, equipBot, resetBotForRound, stepBot } from './bots.js';
import { createMatch } from './match.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const random = mulberry32(shot ? seed : (Date.now() % 2147483647));

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 220);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const combat = createCombat(world, effects);
const audio = createAudio();
const hud = createHud({
  onPlay,
  onBuy: (kind, id) => buy(kind, id),
  onDeploy: () => {
    hud.showBuyMenu(false);
    if (!shot) input.requestLock();
  },
});
const playerBody = createBody(world.colliders, 0, 17.5, 0);
const weaponView = createWeaponView(camera);
const input = createInput(renderer.domElement, onLockChange);

// --- Agents: the player plus nine bots. ---
const VAN_NAMES = ['Ash', 'Bram', 'Cleo', 'Dax'];
const RAI_NAMES = ['Vex', 'Nyx', 'Rook', 'Sable', 'Holt'];

const playerHitMat = new THREE.MeshBasicMaterial({ visible: false });
const playerHit = new THREE.Group();
const playerTorso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.8, 0.32), playerHitMat);
playerTorso.position.y = 1.0;
playerTorso.userData.part = 'torso';
const playerHead = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), playerHitMat);
playerHead.position.y = 1.53;
playerHead.userData.part = 'head';
const playerLegs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.85, 0.26), playerHitMat);
playerLegs.position.y = 0.45;
playerLegs.userData.part = 'legs';
playerHit.add(playerTorso, playerHead, playerLegs);
scene.add(playerHit);

const player = {
  id: 'you', name: 'You', team: 'vanguard', isPlayer: true,
  body: playerBody, position: playerBody.state.position,
  health: 100, armor: 0, alive: true, isCarrier: false,
  hitMeshes: [playerLegs, playerTorso, playerHead],
};
playerTorso.userData.agent = player;
playerHead.userData.agent = player;
playerLegs.userData.agent = player;

const bots = [];
VAN_NAMES.forEach((name, i) => {
  const [x, z] = world.spawns.vanguard[i + 1];
  bots.push(createBot(scene, world, `van${i}`, name, 'vanguard', x, z, 0));
});
RAI_NAMES.forEach((name, i) => {
  const [x, z] = world.spawns.raiders[i];
  bots.push(createBot(scene, world, `rai${i}`, name, 'raider', x, z, Math.PI));
});
const agents = [player, ...bots];

const botShootablesVan = world.shootables.concat(playerHit.children, bots.filter((b) => b.team === 'vanguard').flatMap((b) => b.hitMeshes));
const botShootablesRai = world.shootables.concat(bots.filter((b) => b.team === 'raider').flatMap((b) => b.hitMeshes));
const playerShootables = world.shootables.concat(bots.flatMap((b) => b.hitMeshes));

const grenades = createGrenades(scene, world, effects, (agent, amount, owner) => {
  match.damageAgent(agent, amount, owner, 'frag');
});

const match = createMatch(scene, world, agents, player, {
  onEvent,
  equipBot: (bot, round, rnd) => equipBot(bot, round, rnd),
  resetBot: (bot, x, z, yaw) => resetBotForRound(bot, x, z, yaw),
  buyWeapon: (id) => weaponView.buyWeapon(id),
  buyGrenade: (kind) => weaponView.buyGrenade(kind),
  buyArmor: () => weaponView.buyArmor(),
  onRoundSetup: (round, site, carrierName) => {
    playerBody.teleport(world.spawns.vanguard[0][0], world.spawns.vanguard[0][1], 0);
    player.health = 100;
    player.alive = true;
    player.fall = 0;
    weaponView.refillAmmo();
    hud.showBuyMenu(true);
    hud.markBuyAffordable(match.match.money);
    hud.setProgress(null, null);
    hud.showSpectate(false);
    if (!shot && input.state.locked) input.exitLock();
    hud.setBombStatus('BUY PHASE — CHECK THE MENU, THEN DEPLOY');
  },
});

const state = match.match;
let elapsed = 0;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let prevFiring = false;
let fovTarget = 74;
let shake = 0;

const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _eye = new THREE.Vector3();

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    hud.showBuyMenu(false);
  } else if (state.phase === 'live' && player.alive) {
    hud.showOverlay('paused');
  } else if (state.phase === 'buy') {
    hud.showBuyMenu(true);
  }
}

function onPlay() {
  audio.unlock();
  if (shot) return;
  if (state.phase === 'menu' || state.phase === 'matchEnd') {
    weaponView.resetForMatch();
    match.startMatch(random);
    started = true;
    hud.hideOverlay();
  }
  input.requestLock();
}

function buy(kind, id) {
  const result = match.buy(kind, id);
  if (result.ok) {
    audio.buy();
    hud.setMoney(state.money);
    hud.markBuyAffordable(state.money);
  } else {
    audio.denied();
  }
}

function onEvent(type, data) {
  switch (type) {
    case 'kill':
      hud.killFeed(data.killer, data.victim, data.part);
      if (data.killer === 'You') audio.kill();
      break;
    case 'playerHurt':
      hud.damageFlash();
      audio.hurt();
      shake = Math.min(0.5, shake + 0.25);
      break;
    case 'playerDied':
      hud.showOverlay('dead');
      break;
    case 'roundStart':
      hud.banner(`ROUND ${data.round}`, 'Vanguard defends — Raiders attack', 2200);
      hud.showBuyMenu(false);
      break;
    case 'roundEnd': {
      const won = data.winner === 'vanguard';
      hud.banner(won ? 'VANGUARD WINS THE ROUND' : 'RAIDERS WIN THE ROUND', data.reason, 3000);
      if (won) audio.roundWin();
      else audio.roundLose();
      break;
    }
    case 'planted':
      hud.banner('BOMB PLANTED', `Site ${data.site} — defuse it before the fuse runs out`, 3000);
      audio.plant();
      break;
    case 'bombPickup':
      hud.banner('BOMB PICKED UP', `${data.agent} carries the bomb now`, 2200);
      break;
    case 'defused':
      hud.banner('BOMB DEFUSED', `${data.agent} saved the yard`, 3000);
      break;
    case 'explode':
      audio.explosion();
      shake = 1;
      break;
    case 'matchEnd':
      hud.showOverlay('matchEnd', data);
      break;
    case 'plantProgress':
      hud.setProgress(`PLANTING — ${data.agent}`, data.progress);
      break;
    case 'defuseProgress':
      hud.setProgress(`DEFUSING — ${data.agent}`, data.progress);
      break;
    case 'buyOpen':
      hud.setMoney(state.money);
      break;
    default:
      break;
  }
  if (type !== 'plantProgress' && type !== 'defuseProgress') hud.setProgress(null, null);
}

function onShotFired(agent, position) {
  state.noise.push({ agent, position: position.clone() });
  if (agent === player) return;
  // A distant shot is quieter: only the firing bot's own volume is full.
}

function syncCamera() {
  const body = playerBody.state;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  if (shake > 0) {
    camera.position.x += (random() * 2 - 1) * shake * 0.05;
    camera.position.y += (random() * 2 - 1) * shake * 0.05;
    shake = Math.max(0, shake - 0.03);
  }
}

function syncPlayerHitMeshes() {
  const body = playerBody.state;
  playerHit.position.set(body.position.x, body.position.y, body.position.z);
  playerHit.rotation.y = body.yaw;
}

function playerShoot() {
  const def = weaponView.def();
  if (!weaponView.takeRound()) {
    audio.dryClick();
    return;
  }
  playerBody.eyePosition(_origin);
  camera.getWorldDirection(_direction);
  const spread = weaponView.spread(playerBody.groundSpeed(), input.state.aiming);
  const result = combat.fire({
    origin: _origin,
    direction: _direction,
    spread,
    random,
    damage: def.damage,
    headMult: def.headMult,
    shootables: playerShootables,
  });
  weaponView.pullTrigger();
  playerBody.recoil(def.recoil * (0.85 + random() * 0.3), (random() * 2 - 1) * def.recoil * 0.45);
  audio.shot(def.kind);
  onShotFired(player, _origin);
  if (result.hit && result.agent) {
    match.damageAgent(result.agent, result.damage, player, result.part);
    hud.hitMarker(result.agent.health <= 0, shot ? 4000 : 110);
    audio.hit();
  }
  const ammo = weaponView.state.ammo[weaponView.state.current];
  hud.setAmmo(ammo.mag, ammo.reserve, def.name, weaponView.state.grenades.frag, weaponView.state.grenades.smoke);
}

function throwGrenade(kind) {
  if (weaponView.state.grenades[kind] <= 0) return;
  weaponView.state.grenades[kind] -= 1;
  playerBody.eyePosition(_origin);
  camera.getWorldDirection(_direction);
  _origin.addScaledVector(_direction, 0.5);
  grenades.throwGrenade(_origin, _direction, kind, player);
  audio.step();
  const ammo = weaponView.state.ammo[weaponView.state.current];
  hud.setAmmo(ammo.mag, ammo.reserve, weaponView.def().name, weaponView.state.grenades.frag, weaponView.state.grenades.smoke);
}

function step(dt) {
  elapsed += dt;
  if (state.phase === 'live' || state.phase === 'buy') {
    // --- Player ---
    const look = input.takeLook();
    playerBody.look(look.x, look.y);
    keysToWish(input.state.keys, playerBody.state.yaw, _wish);
    const crouch = input.state.keys.has('ControlLeft') || input.state.keys.has('ControlRight') || input.state.keys.has('KeyC');
    const jump = input.state.keys.has('Space');
    playerBody.step(dt, _wish.x, _wish.z, crouch, jump);
    weaponView.step(dt, input.state.aiming);
    if (player.alive) {
      const def = weaponView.def();
      const trigger = def.auto ? input.state.firing : input.state.firing && !prevFiring;
      if (trigger && weaponView.ready()) playerShoot();
      else if (trigger && weaponView.state.ammo[weaponView.state.current].mag === 0) audio.dryClick();
      if (input.takePressed('KeyR')) {
        weaponView.reload();
        audio.reload();
      }
      if (input.takePressed('KeyG')) throwGrenade('frag');
      if (input.takePressed('KeyH')) throwGrenade('smoke');
      if (input.state.keys.has('KeyE')) match.playerInteract(dt);
      // Weapon select and buy: digits buy during the buy phase, switch otherwise.
      for (let i = 0; i < WEAPON_ORDER.length; i += 1) {
        if (!input.takePressed(`Digit${i + 1}`)) continue;
        const id = WEAPON_ORDER[i];
        if (state.phase === 'buy') buy('weapon', id);
        else weaponView.switchTo(id);
      }
      if (state.phase === 'buy' && input.takePressed('Digit5')) buy('grenade', 'frag');
      if (state.phase === 'buy' && input.takePressed('Digit6')) buy('grenade', 'smoke');
      if (state.phase === 'buy' && input.takePressed('Digit7')) buy('armor');
      if (input.takePressed('KeyB')) {
        if (state.phase === 'buy') hud.showBuyMenu(true);
      }
      if (input.takePressed('KeyM')) audio.toggleMute();
    }
    prevFiring = input.state.firing;

    // --- Bots ---
    for (const bot of bots) {
      stepBot(bot, dt, elapsed, {
        world,
        combat,
        random,
        phase: state.phase,
        bomb: state.bomb,
        player,
        agents,
        noise: state.noise,
        smokeClouds: grenades.clouds,
        shootables: bot.team === 'vanguard' ? botShootablesRai : botShootablesVan,
        onDamage: (agent, amount, attacker, part) => match.damageAgent(agent, amount, attacker, part),
        onShotFired,
        tryPlant: (agent, stepDt) => match.tryPlant(agent, stepDt),
        tryDefuse: (agent, stepDt) => match.tryDefuse(agent, stepDt),
        time: elapsed,
        dt,
      });
    }
    grenades.step(dt, elapsed, agents);
    syncPlayerHitMeshes();
  }
  match.step(dt, elapsed, random);
  effects.step(dt);
  shake = Math.max(0, shake - dt * 1.4);
}

function refreshHud() {
  const ammo = weaponView.state.ammo[weaponView.state.current];
  hud.setHealth(player.health, player.armor);
  hud.setAmmo(ammo.mag, ammo.reserve, weaponView.def().name, weaponView.state.grenades.frag, weaponView.state.grenades.smoke);
  hud.setMoney(state.money);
  hud.setScore(state.wins.vanguard, state.wins.raiders, state.round);
  hud.setTeamCounts(match.aliveCount('vanguard'), match.aliveCount('raider'));
  if (state.phase === 'buy') hud.setTimer(state.buyTimeLeft, 'BUY PHASE');
  else if (state.bomb.planted) hud.setTimer(state.bomb.fuseLeft, `BOMB — SITE ${state.bomb.site}`);
  else if (state.phase === 'live') hud.setTimer(state.roundTimeLeft, 'ROUND');
  else hud.setTimer(0, 'DUSKLINE YARD');
  if (state.bomb.planted) hud.setBombStatus(`BOMB PLANTED — SITE ${state.bomb.site} — DEFUSE IT`);
  else if (state.phase === 'live') hud.setBombStatus('DEFEND SITES A & B');
  else if (state.phase === 'buy') hud.setBombStatus('BUY PHASE — CHECK THE MENU, THEN DEPLOY');
  const spread = weaponView.spread(playerBody.groundSpeed(), input.state.aiming);
  hud.setCrosshairSpread(4 + spread * 900);
  // Aim-down-sights narrows the field of view; the sniper narrows it most.
  const target = input.state.aiming ? (weaponView.def().kind === 'sniper' ? 38 : 54) : 74;
  if (Math.abs(camera.fov - target) > 0.2) {
    camera.fov += (target - camera.fov) * 0.25;
    camera.updateProjectionMatrix();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen && state.phase !== 'menu') {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    refreshHud();
  }
  renderer.render(scene, camera);
}

// --- Deterministic captures for screenshots: run the sim, place the camera, freeze. ---
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAtPoint(x, y, z) {
  const body = playerBody.state;
  const dx = x - body.position.x;
  const dy = y - (body.position.y + body.eye);
  const dz = z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.showBuyMenu(false);
  weaponView.resetForMatch();
  match.startMatch(random);
  if (name === 'start') {
    playerBody.teleport(0, 17.5, 0);
    settle(30);
    aimAtPoint(0, 1.4, -8);
    hud.showBuyMenu(false);
    hud.showOverlay('start');
  } else if (name === 'buy') {
    playerBody.teleport(0, 17.5, 0);
    settle(30);
    aimAtPoint(0, 1.4, -8);
    hud.showBuyMenu(true);
    hud.markBuyAffordable(state.money);
  } else if (name === 'play') {
    // Let the round run so bots spread across the map, then stage a firefight at mid.
    match.startLive();
    settle(60 * 14);
    playerBody.teleport(-2, 6, 0);
    // Stage the firefight with a raider who does not carry the bomb: teleporting
    // the carrier would drag it off its push and delay the plant.
    const raider = bots.find((b) => b.team === 'raider' && b.alive && !b.isCarrier)
      ?? bots.find((b) => b.team === 'raider' && b.alive);
    if (raider) {
      raider.body.teleport(1, -3, Math.PI);
      raider.body.state.yaw = Math.PI;
    }
    settle(10);
    aimAtPoint(1, 1.2, -3);
    settle(2);
    playerShoot(); // fired last, so the tracer, flash and hit marker are in the frame
    hud.hideBanner(); // the plant banner would otherwise cover the firefight
  } else if (name === 'bomb') {
    match.startLive();
    settle(60 * 10);
    // Force a plant at Site A and stage the defence.
    const carrier = bots.find((b) => b.isCarrier) ?? bots.find((b) => b.team === 'raider');
    carrier.body.teleport(-21, -11, 0);
    state.bomb.planted = true;
    state.bomb.site = 'A';
    state.bomb.fuseLeft = 32;
    state.bomb.position.set(-21, 0.15, -11);
    // Stand inside the site's south approach, clear of the warehouse wall, so the
    // planted bomb and its beacon are in open view rather than behind a wall.
    playerBody.teleport(-18, -8.5, 0);
    settle(30);
    aimAtPoint(-21, 0.5, -11);
    hud.setBombStatus('BOMB PLANTED — SITE A · 0:32');
  } else if (name === 'end') {
    state.wins = { vanguard: 7, raiders: 4 };
    state.phase = 'matchEnd';
    hud.showOverlay('matchEnd', { winner: 'vanguard', wins: { vanguard: 7, raiders: 4 }, stats: { kills: 11, deaths: 3 }, history: [] });
    playerBody.teleport(0, 10, 0);
    settle(20);
    aimAtPoint(0, 1.4, -8);
  }
  refreshHud();
  paintOnceThenReady();
}

function paintOnceThenReady() {
  // One paint, then freeze: transient effects (tracer, muzzle flash, hit marker) are
  // still alive for the capture, and the first render already has shadows and matrices.
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 1) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
refreshHud();
// A read-only handle for play-testing and debugging: the match state and the agents.
window.__duskline = { match: state, agents, player, world };
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
