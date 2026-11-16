// The arsenal: four guns and two grenades, each one row of numbers. The numbers are the
// balance: damage, head multiplier, magazine, fire gap, reload time, spread standing still
// and on the move, recoil kick and price. Nothing else in the game hard-codes a weapon;
// bots buy and shoot from these same rows, so the player and the bots play by one set of
// rules. Spread grows with movement speed and shrinks while aiming, so stopping to aim pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', short: 'P9', kind: 'pistol',
    damage: 34, headMult: 4, mag: 12, reserve: 48, gap: 0.16, auto: false,
    reload: 1.4, spreadStill: 0.004, spreadMove: 0.02, recoil: 0.011, price: 0,
  },
  smg: {
    id: 'smg', name: 'KX-9 Ripper', short: 'KX-9', kind: 'smg',
    damage: 26, headMult: 4, mag: 32, reserve: 96, gap: 0.075, auto: true,
    reload: 1.9, spreadStill: 0.006, spreadMove: 0.026, recoil: 0.006, price: 1500,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Longshot', short: 'VK-47', kind: 'rifle',
    damage: 36, headMult: 4, mag: 30, reserve: 90, gap: 0.105, auto: true,
    reload: 2.3, spreadStill: 0.003, spreadMove: 0.024, recoil: 0.009, price: 2700,
  },
  sniper: {
    id: 'sniper', name: 'LM-88 Marksman', short: 'LM-88', kind: 'sniper',
    damage: 88, headMult: 4, mag: 5, reserve: 15, gap: 1.15, auto: false,
    reload: 3.0, spreadStill: 0.0008, spreadMove: 0.05, recoil: 0.03, price: 4750,
  },
};

export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'sniper'];

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, fuse: 1.6, radius: 6.5, damage: 110 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300, fuse: 1.4, radius: 5, duration: 15 },
};

export const ARMOR_PRICE = 650;

// One view model per weapon, built from boxes in the palette's steel and ink. The model
// lives on the camera, kicks back on every shot, dips on reload and slides toward the
// centre while aiming down the sights.
const MODEL_SPECS = {
  pistol: { receiver: [0.07, 0.09, 0.24], barrel: [0.04, 0.04, 0.16], stock: null, grip: [0.06, 0.14, 0.07] },
  smg: { receiver: [0.08, 0.1, 0.34], barrel: [0.04, 0.04, 0.22], stock: [0.06, 0.07, 0.16], grip: [0.06, 0.13, 0.07] },
  rifle: { receiver: [0.09, 0.1, 0.44], barrel: [0.045, 0.045, 0.42], stock: [0.075, 0.08, 0.24], grip: [0.06, 0.13, 0.07] },
  sniper: { receiver: [0.09, 0.11, 0.5], barrel: [0.04, 0.04, 0.6], stock: [0.075, 0.08, 0.26], grip: [0.06, 0.13, 0.07], scope: [0.06, 0.07, 0.22] },
};

export function createWeaponView(camera) {
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.canvas), roughness: 0.6, metalness: 0.3 });

  const models = {};
  for (const id of WEAPON_ORDER) {
    const spec = MODEL_SPECS[id];
    const model = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(...spec.receiver), bodyMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(...spec.barrel), gripMat);
    barrel.position.set(0, 0.025, -(spec.receiver[2] / 2 + spec.barrel[2] / 2 - 0.02));
    model.add(receiver, barrel);
    if (spec.stock) {
      const stock = new THREE.Mesh(new THREE.BoxGeometry(...spec.stock), gripMat);
      stock.position.set(0, -0.02, spec.receiver[2] / 2 + spec.stock[2] / 2 - 0.02);
      model.add(stock);
    }
    if (spec.grip) {
      const grip = new THREE.Mesh(new THREE.BoxGeometry(...spec.grip), darkMat);
      grip.position.set(0, -0.1, 0.06);
      grip.rotation.x = 0.25;
      model.add(grip);
    }
    if (spec.scope) {
      const scope = new THREE.Mesh(new THREE.BoxGeometry(...spec.scope), darkMat);
      scope.position.set(0, 0.09, -0.05);
      model.add(scope);
    }
    model.position.set(0.24, -0.2, -0.42);
    model.scale.setScalar(0.85);
    model.visible = false;
    camera.add(model);
    models[id] = model;
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.17, 0.17),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.2, -1.02);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = {
    current: 'pistol',
    ammo: { pistol: { mag: 12, reserve: 48 }, smg: { mag: 0, reserve: 0 }, rifle: { mag: 0, reserve: 0 }, sniper: { mag: 0, reserve: 0 } },
    owned: new Set(['pistol']),
    cooldown: 0,
    reloadLeft: 0,
    reloadTotal: 1,
    flash: 0,
    kick: 0,
    aimBlend: 0,
    grenades: { frag: 0, smoke: 0 },
    armor: 0,
  };

  function def() {
    return WEAPONS[state.current];
  }

  function step(dt, aiming) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const target = aiming ? 1 : 0;
    state.aimBlend += (target - state.aimBlend) * Math.min(1, dt * 10);
    const model = models[state.current];
    const baseX = 0.24 * (1 - state.aimBlend);
    const baseY = -0.2 + 0.045 * state.aimBlend;
    const baseZ = -0.42 + state.kick - 0.06 * state.aimBlend;
    model.position.set(baseX, baseY, baseZ);
    model.rotation.x = state.kick * 2.2;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (state.reloadTotal - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const ammo = state.ammo[state.current];
        const need = def().mag - ammo.mag;
        const take = Math.min(need, ammo.reserve);
        ammo.mag += take;
        ammo.reserve -= take;
      }
    }
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
  }

  return {
    state,
    def,
    step,
    ready() {
      const ammo = state.ammo[state.current];
      return ammo.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().gap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      const ammo = state.ammo[state.current];
      if (ammo.mag <= 0) return false;
      ammo.mag -= 1;
      return true;
    },
    reload() {
      const ammo = state.ammo[state.current];
      if (state.reloadLeft > 0 || ammo.mag === def().mag || ammo.reserve === 0) return;
      state.reloadLeft = def().reload;
      state.reloadTotal = def().reload;
    },
    spread(speed, aiming) {
      const d = def();
      const move = Math.min(1, speed / 5.4);
      const base = d.spreadStill + move * d.spreadMove;
      return aiming ? base * 0.45 : base;
    },
    switchTo(id) {
      if (!state.owned.has(id) || id === state.current) return false;
      models[state.current].visible = false;
      state.current = id;
      state.reloadLeft = 0;
      models[id].visible = true;
      return true;
    },
    buyWeapon(id) {
      if (state.owned.has(id)) return { ok: false, reason: 'owned' };
      state.owned.add(id);
      const d = WEAPONS[id];
      state.ammo[id] = { mag: d.mag, reserve: d.reserve };
      models[state.current].visible = false;
      state.current = id;
      state.reloadLeft = 0;
      models[id].visible = true;
      return { ok: true };
    },
    buyGrenade(kind) {
      state.grenades[kind] += 1;
      return true;
    },
    buyArmor() {
      state.armor = 100;
      return true;
    },
    refillAmmo() {
      for (const id of state.owned) {
        const d = WEAPONS[id];
        state.ammo[id] = { mag: d.mag, reserve: d.reserve };
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    resetForMatch() {
      state.owned = new Set(['pistol']);
      state.current = 'pistol';
      state.ammo = { pistol: { mag: 12, reserve: 48 }, smg: { mag: 0, reserve: 0 }, rifle: { mag: 0, reserve: 0 }, sniper: { mag: 0, reserve: 0 } };
      state.grenades = { frag: 0, smoke: 0 };
      state.armor = 0;
      for (const id of WEAPON_ORDER) models[id].visible = id === 'pistol';
      state.reloadLeft = 0;
      state.cooldown = 0;
    },
  };
}
