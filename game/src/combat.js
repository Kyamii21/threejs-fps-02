// Hitscan combat: one ray, one verdict. A shot is a ray from a muzzle with spread jitter;
// the first thing it meets decides the outcome. Bot bodies carry three hit zones (head,
// torso, legs) with different multipliers, so a head shot pays four times a body shot.
// The player's body is three invisible meshes the bots raycast against, so both sides
// resolve through the same code. World geometry stops bullets: a ray that meets a crate
// first never reaches the bot behind it.
import * as THREE from 'three';

export const ZONE_MULT = { head: 4, torso: 1, legs: 0.75 };

const raycaster = new THREE.Raycaster();
const jitter = new THREE.Vector3();

export function createCombat(world, effects) {
  // Fire one hitscan shot. origin and direction are world-space vectors (direction is
  // mutated by spread jitter; pass a scratch vector you own). shootables is the list of
  // meshes this shooter may hit: world meshes plus the other side's bodies.
  function fire({ origin, direction, spread, random, damage, headMult = 4, range = 90, shootables }) {
    jitter.set((random() * 2 - 1) * spread, (random() * 2 - 1) * spread, (random() * 2 - 1) * spread);
    direction.add(jitter).normalize();
    raycaster.set(origin, direction);
    raycaster.far = range;
    const hits = raycaster.intersectObjects(shootables, false);
    const end = new THREE.Vector3().copy(origin).addScaledVector(direction, range);
    if (!hits.length) {
      effects.spawnTracer(origin, end);
      return { hit: false, point: end, distance: range };
    }
    const hit = hits[0];
    const point = hit.point;
    effects.spawnTracer(origin, point);
    const agent = hit.object.userData.agent;
    if (agent) {
      const part = hit.object.userData.part ?? 'torso';
      const mult = part === 'head' ? headMult : ZONE_MULT[part] ?? 1;
      return { hit: true, agent, part, point, distance: hit.distance, damage: damage * mult };
    }
    effects.spawnSparks(point, hit.face?.normal ?? null);
    return { hit: true, agent: null, part: 'world', point, distance: hit.distance, damage: 0 };
  }

  // Line of sight between two eye points: clear when no world mesh crosses the segment,
  // and when no live smoke cloud swallows it.
  const losRay = new THREE.Raycaster();
  const losDir = new THREE.Vector3();
  function canSee(from, to, smokeClouds) {
    losDir.copy(to).sub(from);
    const distance = losDir.length();
    if (distance < 0.01) return true;
    losDir.divideScalar(distance);
    losRay.set(from, losDir);
    losRay.far = distance;
    if (losRay.intersectObjects(world.shootables, false).length) return false;
    for (const cloud of smokeClouds) {
      if (cloud.until <= 0) continue;
      // Distance from the cloud centre to the sight segment.
      const cx = cloud.position.x - from.x;
      const cy = cloud.position.y - from.y;
      const cz = cloud.position.z - from.z;
      const t = Math.max(0, Math.min(distance, cx * losDir.x + cy * losDir.y + cz * losDir.z));
      const dx = from.x + losDir.x * t - cloud.position.x;
      const dy = from.y + losDir.y * t - cloud.position.y;
      const dz = from.z + losDir.z * t - cloud.position.z;
      if (dx * dx + dy * dy + dz * dz < cloud.radius * cloud.radius * 0.64) return false;
    }
    return true;
  }

  return { fire, canSee };
}
