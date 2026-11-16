// Duskline Yard: an original industrial yard at dusk, built from boxes and canvas-drawn
// signs. Two bombsites, three lanes, one mid. Vanguard spawns south, Raiders north.
//   Site A (west, -21, -11): a half-open warehouse with crates and a raised dock.
//   Site B (east,  21, -11): a container yard with stacked steel boxes.
//   Mid (0, 0): a broken wall with a double-door gap; the fastest route, the riskiest.
// Every solid box is a collider for bodies and a surface a bullet stops on. The waypoint
// graph below the geometry is what the bots navigate; every edge is a clear walk.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

function makeSignTexture(letter, accent = '#f07a1e') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#232830';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, 236, 236);
  ctx.fillStyle = accent;
  ctx.font = 'bold 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 138);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeLabelTexture(text, color = '#e8e2d4') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(23,26,33,0.0)';
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = color;
  ctx.font = 'bold 72px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.04,
    });
  }
  const rust = new THREE.MeshStandardMaterial({ color: new THREE.Color('#7a4a2c'), roughness: 0.85, metalness: 0.15 });
  const steelBlue = new THREE.MeshStandardMaterial({ color: new THREE.Color('#46586e'), roughness: 0.6, metalness: 0.4 });
  const olive = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5c6248'), roughness: 0.85, metalness: 0.05 });
  const floorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2e3340'), roughness: 0.95, metalness: 0.02 });
  const sitePad = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.9, metalness: 0.02, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.25 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function floorPad(width, depth, x, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, depth), material);
    mesh.position.set(x, 0.03, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  // --- Ground and perimeter: 56 x 40 m, 4.6 m walls, open dusk sky. ---
  box(56.4, 0.4, 40.4, 0, -0.2, 0, floorMat);
  box(0.4, 4.6, 40.4, -28.2, 2.3, 0, materials.surface);
  box(0.4, 4.6, 40.4, 28.2, 2.3, 0, materials.surface);
  box(56.4, 4.6, 0.4, 0, 2.3, -20.2, materials.surface);
  box(56.4, 4.6, 0.4, 0, 2.3, 20.2, materials.surface);

  // --- Site A: warehouse, west. A U of walls with two entries, crates, a dock step. ---
  floorPad(10, 9, -21, -11, sitePad);
  box(0.5, 3.4, 9.4, -26.2, 1.7, -11, materials.surface);
  box(10.4, 3.4, 0.5, -21, 1.7, -15.7, materials.surface);
  box(3.4, 3.4, 0.5, -24.4, 1.7, -6.3, materials.surface);
  box(3.4, 3.4, 0.5, -17.6, 1.7, -6.3, materials.surface);
  box(1.2, 1.1, 1.2, -23.5, 0.55, -13.5, materials.hairline);
  box(1.2, 1.1, 1.2, -22.3, 0.55, -13.5, materials.hairline);
  box(1.2, 1.1, 1.2, -23.5, 0.55, -12.3, materials.hairline);
  box(1.2, 2.2, 1.2, -22.3, 1.1, -12.3, materials.hairline);
  box(2.4, 1.1, 1.2, -18.2, 0.55, -13.8, materials.hairline);
  // Kept clear of the conA -> aEnt approach diagonal and of the site entry lane.
  box(1.6, 0.9, 1.6, -20.5, 0.45, -13.5, materials.hairline);
  box(4.5, 0.9, 3.0, -24.5, 0.45, -8.5, materials.surface); // dock step, low enough to walk over
  box(0.9, 2.6, 0.9, -17.2, 1.3, -10.5, steelBlue);

  // --- Site B: container yard, east. Stacked boxes with gaps to slip through. ---
  floorPad(10, 9, 21, -11, sitePad);
  box(6.0, 2.6, 2.4, 24.5, 1.3, -14.5, rust);
  box(6.0, 2.6, 2.4, 24.5, 3.9, -14.5, steelBlue);
  box(6.0, 2.6, 2.4, 17.5, 1.3, -15.5, olive);
  box(2.4, 2.6, 6.0, 25.5, 1.3, -8.5, steelBlue);
  // The west container is short: it guards the site's north-west corner but leaves
  // the approach lane from the west (z -10..-7) open, so both sites stay reachable.
  box(2.4, 2.6, 3.0, 17.8, 1.3, -11.5, rust);
  // Loose crates on the site, kept clear of the plant spot at (21, -11) itself
  // and of the entry lane at x = 21.
  box(1.2, 1.1, 1.2, 20.5, 0.55, -13.2, materials.hairline);
  box(1.2, 1.1, 1.2, 23, 0.55, -12.3, materials.hairline);
  box(1.2, 2.2, 1.2, 23, 1.1, -6.5, materials.hairline);

  // --- Mid: a broken wall across the middle with a double-door gap at x = 0. ---
  box(10, 3.6, 0.6, -9.5, 1.8, 0, materials.surface);
  box(10, 3.6, 0.6, 9.5, 1.8, 0, materials.surface);
  box(4.6, 1.0, 0.6, -4.5, 3.1, 0, materials.hairline); // lintel over the west gap
  box(4.6, 1.0, 0.6, 4.5, 3.1, 0, materials.hairline);
  box(1.0, 3.6, 0.6, -2.4, 1.8, 0, materials.surface); // door posts
  box(1.0, 3.6, 0.6, 2.4, 1.8, 0, materials.surface);
  box(1.6, 1.1, 1.6, -3, 0.55, 4.5, materials.hairline); // mid cover, clear of the mid -> midW diagonal
  box(1.6, 1.1, 1.6, 5.5, 0.55, -2.6, materials.hairline);

  // --- Lane cover: crates and pillars down the west, east and connector lanes.
  // The tall lane crates sit off the lane centrelines (x = +/-13) so the lanes
  // stay walkable end to end. ---
  box(1.2, 1.1, 3.6, -15.5, 0.55, 7, materials.hairline);
  box(3.6, 1.1, 1.2, -13, 0.55, -1, materials.hairline);
  box(1.2, 2.4, 1.2, -13, 1.2, -7.5, steelBlue);
  box(1.2, 1.1, 3.6, 15.5, 0.55, 7, materials.hairline);
  box(3.6, 1.1, 1.2, 13, 0.55, -1, materials.hairline);
  box(1.2, 2.4, 1.2, 13, 1.2, -7.5, rust);
  // Connector-lane cover, kept south of the rsW/rsE -> midN diagonals.
  box(1.6, 0.9, 1.6, -7, 0.45, -13.5, materials.hairline);
  box(1.6, 0.9, 1.6, 7, 0.45, -13.5, materials.hairline);
  box(2.4, 0.9, 1.2, -6, 0.45, 13.5, materials.hairline);
  box(2.4, 0.9, 1.2, 6, 0.45, 13.5, materials.hairline);
  box(1.0, 2.8, 1.0, -20, 1.4, 3, steelBlue);
  box(1.0, 2.8, 1.0, 20, 1.4, 3, steelBlue);
  box(1.0, 2.8, 1.0, -20, 1.4, -3.5, rust);
  box(1.0, 2.8, 1.0, 20, 1.4, -3.5, rust);

  // --- Spawn cover, so neither team spawns in the open. Kept clear of the spawn
  // points themselves: a body must never spawn wedged against a collider. ---
  box(3.6, 1.1, 1.2, -4, 0.55, 14.5, materials.hairline);
  box(3.6, 1.1, 1.2, 4, 0.55, 14.5, materials.hairline);
  box(3.6, 1.1, 1.2, -4, 0.55, -14.5, materials.hairline);
  box(3.6, 1.1, 1.2, 4, 0.55, -14.5, materials.hairline);

  // --- Site signs: canvas-drawn letters, hung over each site and painted on its floor. ---
  function siteSign(letter, x, z) {
    const texture = makeSignTexture(letter);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: texture, transparent: false }),
    );
    board.position.set(x, 3.4, z + 4.4);
    board.rotation.y = Math.PI;
    group.add(board);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.85 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(x, 0.07, z);
    group.add(floor);
  }
  siteSign('A', -21, -11);
  siteSign('B', 21, -11);

  const yardSign = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 1.75),
    new THREE.MeshBasicMaterial({ map: makeLabelTexture('DUSKLINE YARD'), transparent: true }),
  );
  yardSign.position.set(0, 3.9, 19.9);
  yardSign.rotation.y = Math.PI;
  group.add(yardSign);

  // --- Skyline silhouettes beyond the walls, so the yard sits in a city at dusk. ---
  const skylineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#10131a') });
  const skyline = new THREE.Group();
  const skyBoxes = [
    [-40, 6, -30, 8, 12, 8], [ -24, 9, -34, 10, 18, 8], [-8, 5, -32, 7, 10, 8],
    [10, 8, -33, 9, 16, 8], [26, 6, -31, 8, 12, 8], [40, 10, -28, 9, 20, 8],
    [-42, 7, 10, 8, 14, 8], [42, 8, 12, 8, 16, 8], [-38, 5, 28, 8, 10, 8], [38, 6, 30, 8, 12, 8],
  ];
  for (const [x, y, z, w, h, d] of skyBoxes) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), skylineMat);
    mesh.position.set(x, y, z);
    skyline.add(mesh);
  }
  group.add(skyline);

  // --- Dusk sky: a gradient dome, dark blue overhead warming to amber at the horizon. ---
  function makeSkyTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, '#0d1322');
    gradient.addColorStop(0.45, '#27304a');
    gradient.addColorStop(0.72, '#6b4a38');
    gradient.addColorStop(0.88, '#c97a35');
    gradient.addColorStop(1, '#e8963f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 256);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(180, 24, 16),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false }),
  );
  scene.add(skyDome);

  // --- The dusk sun: a low amber disc in the west sky. ---
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(4.5, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff9a3c'), fog: false }),
  );
  sun.position.set(-60, 10, -40);
  sun.lookAt(0, 4, 0);
  group.add(sun);

  // --- Light: warm low sun from the west, cool sky fill, amber lamps over both sites. ---
  // The yard is lit bright enough to read at a glance: a strong hemisphere so no corner
  // goes black, a hard amber sun for long shadows, and a cool fill from the east.
  const sky = new THREE.HemisphereLight(new THREE.Color('#93a5c8'), new THREE.Color('#4a3826'), 1.5);
  scene.add(sky);

  const sunLight = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 3.0);
  sunLight.position.set(-24, 18, -4);
  sunLight.target.position.set(6, 0, 2);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -34;
  sunLight.shadow.camera.right = 34;
  sunLight.shadow.camera.top = 26;
  sunLight.shadow.camera.bottom = -26;
  sunLight.shadow.camera.far = 90;
  sunLight.shadow.bias = -0.0008;
  sunLight.shadow.normalBias = 0.03;
  scene.add(sunLight, sunLight.target);

  const fill = new THREE.DirectionalLight(new THREE.Color('#8b93a3'), 0.85);
  fill.position.set(18, 14, 16);
  scene.add(fill);

  for (const [x, z] of [[-21, -11], [21, -11]]) {
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 26, 18, 1.8);
    lamp.position.set(x, 4.2, z);
    scene.add(lamp);
  }

  // --- Waypoints: the graph the bots walk. Every edge is a clear straight walk.
  // Every node stands on open floor: none inside a wall, a crate or a container, and
  // none within a body's radius of one, or a bot walks into it and never arrives.
  // The west/east lanes do NOT cross the mid wall: they connect north and south
  // through the mid gaps (wlM/elM -> midW/midE -> mid -> midN), and the sites are
  // entered straight from the south (wlN/elN -> aEnt/bEnt), never across a corner.
  const nodes = {
    vs: [0, 16.5], vsW: [-13, 14], vsE: [13, 14],
    midS: [0, 10], mid: [0, 0], midN: [0, -8],
    wlS: [-13, 10.5], wlM: [-13, 2.5], wlN: [-13, -10.5],
    elS: [13, 10.5], elM: [13, 2.5], elN: [13, -10.5],
    aEnt: [-21, -7], aSite: [-21, -11], aBack: [-16.5, -8.5],
    bEnt: [21, -7], bSite: [21, -11], bBack: [23.5, -10],
    rs: [0, -16.5], rsW: [-13, -14], rsE: [13, -14],
    conA: [-7, -10], conB: [7, -10], midW: [-7, 2.5], midE: [7, 2.5],
  };
  const edges = {
    vs: ['midS'],
    vsW: ['wlS', 'midS'], vsE: ['elS', 'midS'],
    midS: ['vs', 'mid', 'wlS', 'elS'],
    mid: ['midS', 'midN', 'midW', 'midE'],
    midN: ['mid', 'conA', 'conB', 'rs'],
    wlS: ['vsW', 'midS', 'wlM'], wlM: ['wlS', 'midW'], wlN: ['rsW', 'conA', 'aEnt'],
    elS: ['vsE', 'midS', 'elM'], elM: ['elS', 'midE'], elN: ['rsE', 'conB', 'bEnt'],
    aEnt: ['wlN', 'conA', 'aSite'], aSite: ['aEnt', 'aBack'],
    aBack: ['aSite'],
    bEnt: ['elN', 'conB', 'bSite'], bSite: ['bEnt', 'bBack'],
    bBack: ['bSite'],
    rs: ['midN'],
    rsW: ['wlN', 'midN'], rsE: ['elN', 'midN'],
    conA: ['midN', 'aEnt'], conB: ['midN', 'bEnt'],
    midW: ['mid', 'wlM'], midE: ['mid', 'elM'],
  };

  function nearestNode(x, z) {
    let best = null;
    let bestD = Infinity;
    for (const [id, [nx, nz]] of Object.entries(nodes)) {
      const d = (nx - x) ** 2 + (nz - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  // Breadth-first path between nodes; returns an array of [x, z] waypoints, start excluded.
  function findPath(fromX, fromZ, toId) {
    const start = nearestNode(fromX, fromZ);
    if (start === toId) return [nodes[toId]];
    const prev = { [start]: null };
    const queue = [start];
    while (queue.length) {
      const current = queue.shift();
      for (const next of edges[current] ?? []) {
        if (next in prev) continue;
        prev[next] = current;
        if (next === toId) {
          const path = [];
          let step = next;
          while (step) {
            path.unshift(nodes[step]);
            step = prev[step];
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [nodes[toId]];
  }

  const sites = {
    A: { id: 'A', center: new THREE.Vector3(-21, 0, -11), plantBox: new THREE.Box3(new THREE.Vector3(-25.5, 0, -15), new THREE.Vector3(-16.5, 2.5, -7)) },
    B: { id: 'B', center: new THREE.Vector3(21, 0, -11), plantBox: new THREE.Box3(new THREE.Vector3(16.5, 0, -15), new THREE.Vector3(25.5, 2.5, -7)) },
  };

  const spawns = {
    vanguard: [[-2, 17.5], [0, 18], [2, 17.5], [-5, 16], [5, 16]],
    raiders: [[-2, -17.5], [0, -18], [2, -17.5], [-5, -16], [5, -16]],
  };

  return {
    colliders,
    shootables,
    group,
    nodes,
    findPath,
    nearestNode,
    sites,
    spawns,
    holds: {
      A: [[-16.5, -8.5], [-18.5, -9.5], [-21, -8.5]],
      B: [[23.5, -10], [19.5, -9], [21, -8.5]],
      mid: [[-7, 2.5], [7, 2.5], [0, -8]],
      west: [[-13, 2.5], [-13, -10.5]],
      east: [[13, 2.5], [13, -10.5]],
    },
  };
}
