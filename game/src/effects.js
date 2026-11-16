// Cheap, pooled effects: tracers, impact sparks, smoke puffs and explosions. Nothing here
// allocates in the hot loop: every tracer, spark and smoke sprite comes from a fixed pool
// and is reused, so a firefight never triggers the garbage collector mid-frame.
import * as THREE from 'three';

function makeSmokeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(200,205,215,0.85)');
  gradient.addColorStop(0.6, 'rgba(170,175,185,0.45)');
  gradient.addColorStop(1, 'rgba(160,165,175,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeDotTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const TRACER_POOL = 24;
const SPARK_COUNT = 240;
const SMOKE_POOL = 48;

export function createEffects(scene) {
  // --- Tracers: one beam per shot, a thin additive box from muzzle to impact, fading
  // in 90 ms. A real box, not a 1 px line, so the shot reads in a still frame. ---
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const material = new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1), material);
    beam.visible = false;
    beam.frustumCulled = false;
    scene.add(beam);
    tracers.push({ beam, life: 0 });
  }
  let tracerCursor = 0;
  const _mid = new THREE.Vector3();

  function spawnTracer(from, to) {
    const tracer = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % TRACER_POOL;
    const length = from.distanceTo(to);
    tracer.beam.scale.set(1, 1, Math.max(0.01, length));
    _mid.addVectors(from, to).multiplyScalar(0.5);
    tracer.beam.position.copy(_mid);
    tracer.beam.lookAt(to);
    tracer.beam.visible = true;
    tracer.beam.material.opacity = 0.9;
    tracer.life = 0.09;
  }

  // --- Sparks: one Points cloud, 240 particles with velocity and life. ---
  const sparkGeometry = new THREE.BufferGeometry();
  const sparkPositions = new Float32Array(SPARK_COUNT * 3);
  const sparkVelocities = new Float32Array(SPARK_COUNT * 3);
  const sparkLife = new Float32Array(SPARK_COUNT);
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  const sparks = new THREE.Points(sparkGeometry, new THREE.PointsMaterial({ color: 0xffc46b, size: 0.12, map: makeDotTexture(), transparent: true, opacity: 0.95, depthWrite: false, alphaTest: 0.01 }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkCursor = 0;

  function spawnSparks(point, normal) {
    const baseX = normal ? normal.x : 0;
    const baseY = normal ? normal.y : 1;
    const baseZ = normal ? normal.z : 0;
    for (let n = 0; n < 8; n += 1) {
      const i = sparkCursor;
      sparkCursor = (sparkCursor + 1) % SPARK_COUNT;
      sparkPositions[i * 3] = point.x;
      sparkPositions[i * 3 + 1] = point.y;
      sparkPositions[i * 3 + 2] = point.z;
      sparkVelocities[i * 3] = baseX * 2 + (Math.random() * 2 - 1) * 2.5;
      sparkVelocities[i * 3 + 1] = baseY * 2 + Math.random() * 2.5;
      sparkVelocities[i * 3 + 2] = baseZ * 2 + (Math.random() * 2 - 1) * 2.5;
      sparkLife[i] = 0.35 + Math.random() * 0.2;
    }
  }

  // --- Smoke: sprites that grow and drift while their cloud lives. ---
  const smokeTexture = makeSmokeTexture();
  const smokes = [];
  for (let i = 0; i < SMOKE_POOL; i += 1) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture, transparent: true, opacity: 0, depthWrite: false }));
    sprite.visible = false;
    scene.add(sprite);
    smokes.push({ sprite, life: 0, total: 1, seed: Math.random() * 10 });
  }
  let smokeCursor = 0;

  function spawnSmoke(cloud) {
    for (let n = 0; n < 14; n += 1) {
      const slot = smokes[smokeCursor];
      smokeCursor = (smokeCursor + 1) % SMOKE_POOL;
      const angle = (n / 14) * Math.PI * 2;
      const radius = Math.random() * cloud.radius * 0.7;
      slot.sprite.position.set(
        cloud.position.x + Math.cos(angle) * radius,
        cloud.position.y + 0.8 + Math.random() * 1.6,
        cloud.position.z + Math.sin(angle) * radius,
      );
      slot.sprite.scale.setScalar(2.5);
      slot.life = 15;
      slot.total = 15;
      slot.sprite.visible = true;
    }
  }

  // --- Explosion: an expanding shell and a flash light. ---
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0, depthWrite: false }),
  );
  blast.visible = false;
  scene.add(blast);
  const blastLight = new THREE.PointLight(0xff9a3c, 0, 22, 1.6);
  scene.add(blastLight);
  let blastLife = 0;

  function spawnExplosion(position) {
    blast.position.copy(position);
    blast.position.y = Math.max(0.6, position.y);
    blast.visible = true;
    blastLife = 0.45;
    blastLight.position.copy(blast.position);
    blastLight.intensity = 120;
  }

  function step(dt) {
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.beam.material.opacity = Math.max(0, tracer.life / 0.09) * 0.9;
      if (tracer.life <= 0) tracer.beam.visible = false;
    }
    let anySpark = false;
    for (let i = 0; i < SPARK_COUNT; i += 1) {
      if (sparkLife[i] <= 0) continue;
      anySpark = true;
      sparkLife[i] -= dt;
      sparkVelocities[i * 3 + 1] -= 9 * dt;
      sparkPositions[i * 3] += sparkVelocities[i * 3] * dt;
      sparkPositions[i * 3 + 1] += sparkVelocities[i * 3 + 1] * dt;
      sparkPositions[i * 3 + 2] += sparkVelocities[i * 3 + 2] * dt;
      if (sparkPositions[i * 3 + 1] < 0.02) sparkPositions[i * 3 + 1] = 0.02;
    }
    if (anySpark) sparkGeometry.attributes.position.needsUpdate = true;
    for (const slot of smokes) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const age = slot.total - slot.life;
      const scale = 2.5 + age * 0.35;
      slot.sprite.scale.setScalar(scale);
      slot.sprite.position.y += dt * 0.25;
      slot.sprite.material.opacity = Math.min(0.85, slot.life / 3) * 0.8;
      if (slot.life <= 0) slot.sprite.visible = false;
    }
    if (blastLife > 0) {
      blastLife -= dt;
      const t = 1 - Math.max(0, blastLife) / 0.45;
      blast.scale.setScalar(0.5 + t * 6);
      blast.material.opacity = Math.max(0, 0.85 * (1 - t));
      blastLight.intensity = Math.max(0, 120 * (1 - t));
      if (blastLife <= 0) {
        blast.visible = false;
        blastLight.intensity = 0;
      }
    }
  }

  return { spawnTracer, spawnSparks, spawnSmoke, spawnExplosion, step };
}
