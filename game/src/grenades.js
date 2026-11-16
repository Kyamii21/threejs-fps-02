// Thrown grenades: a frag that bursts and a smoke that blinds. A grenade is a small
// physics body (gravity, a floor bounce, a wall stop) with a fuse; on expiry the frag deals
// falloff damage to every agent in its radius and the smoke registers a cloud that blocks
// line of sight for fifteen seconds. The cloud list is shared with combat.canSee.
import * as THREE from 'three';
import { GRENADES } from './weapons.js';

const probe = new THREE.Box3();

export function createGrenades(scene, world, effects, onDamage) {
  const active = [];
  const clouds = [];

  function throwGrenade(origin, direction, kind, owner) {
    const def = GRENADES[kind];
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(kind === 'frag' ? '#3a4150' : '#e8e2d4'), roughness: 0.5, metalness: 0.4 }),
    );
    mesh.position.copy(origin);
    mesh.castShadow = true;
    scene.add(mesh);
    active.push({
      mesh,
      position: mesh.position,
      velocity: new THREE.Vector3(direction.x * 13, direction.y * 13 + 3.2, direction.z * 13),
      kind,
      fuse: def.fuse,
      owner,
    });
  }

  function overlapsPoint(x, y, z) {
    probe.min.set(x - 0.09, y - 0.09, z - 0.09);
    probe.max.set(x + 0.09, y + 0.09, z + 0.09);
    for (const collider of world.colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  function step(dt, time, agents) {
    for (let i = active.length - 1; i >= 0; i -= 1) {
      const g = active[i];
      g.fuse -= dt;
      g.velocity.y -= 18 * dt;
      const next = g.position.clone().addScaledVector(g.velocity, dt);
      if (next.y < 0.09) {
        next.y = 0.09;
        g.velocity.y = Math.abs(g.velocity.y) > 1.5 ? -g.velocity.y * 0.35 : 0;
        g.velocity.x *= 0.65;
        g.velocity.z *= 0.65;
      } else if (overlapsPoint(next.x, next.y, next.z)) {
        g.velocity.multiplyScalar(-0.3);
      } else {
        g.position.copy(next);
      }
      if (g.fuse <= 0) {
        const def = GRENADES[g.kind];
        if (g.kind === 'frag') {
          effects.spawnExplosion(g.position);
          for (const agent of agents) {
            if (!agent.alive) continue;
            const d = agent.position.distanceTo(g.position);
            if (d > def.radius) continue;
            const falloff = 1 - (d / def.radius) * 0.7;
            onDamage(agent, def.damage * falloff, g.owner, 'frag');
          }
        } else {
          const cloud = { position: g.position.clone(), radius: def.radius, until: time + def.duration };
          clouds.push(cloud);
          effects.spawnSmoke(cloud);
        }
        scene.remove(g.mesh);
        active.splice(i, 1);
      }
    }
    for (let i = clouds.length - 1; i >= 0; i -= 1) {
      if (clouds[i].until <= time) clouds.splice(i, 1);
    }
  }

  return { throwGrenade, step, clouds, active };
}
