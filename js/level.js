import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const PARAPET_HEIGHT = 0.6;
const PARAPET_THICKNESS = 0.5;
const FLOOR_THICKNESS = 1;
const RAMP_THICKNESS = 1;
const COVER_HEIGHT = 2;
const COVER_SIZE = [1.6, COVER_HEIGHT, 1.6];
const FLOOR_TEXTURE_TILE = 4;
const SPAWN_EDGE_MARGIN = 2;
const SPAWN_MAX_ATTEMPTS = 30;
// Matches dummy.js's MAX_FIRE_RANGE (25) with a small margin, so a dummy
// that randomly respawns can't land within sniping range of the player's
// fixed spawn point - the same hazard the original fixed dummy placements
// were positioned to avoid (see the comment in main.js).
const MIN_RESPAWN_DIST_FROM_PLAYER_SPAWN = 26;

// Everything lives on one main rooftop. The HVAC/crane decks are small
// raised platforms sitting on top of it, reached by ramps (walkable without
// jumping) rather than being separate far-apart tiers. Only the main roof's
// outer edge has a parapet — it's the one edge that's a real fall (see the
// player's fall-damage check); the decks are a low, harmless step down back
// onto the roof.
const MAIN_ROOF = { x: [-35, 35], z: [-35, 35], y: 0 };
const HVAC_DECK = { x: [-30, -10], z: [0, 20], y: 2.2 };
const CRANE_DECK = { x: [10, 30], z: [-20, 0], y: 3 };

export class Level {
  constructor(scene, physics) {
    this.scene = scene;
    this.physics = physics;
    this.collidableMeshes = [];
    this.obstacles = [];
    this.areas = [MAIN_ROOF, HVAC_DECK, CRANE_DECK];
    this.spawnPoint = new THREE.Vector3(0, 2, 28);
    this.spawnYaw = 0;

    this.floorMat = new THREE.MeshBasicMaterial({ map: this._makeNoiseTexture(0x555555) });
    this.parapetMat = new THREE.MeshBasicMaterial({ map: this._makeNoiseTexture(0x888888) });
    this.propMat = new THREE.MeshBasicMaterial({ map: this._makeNoiseTexture(0x776655) });
    this.chimneyMat = new THREE.MeshBasicMaterial({ map: this._makeNoiseTexture(0x444444) });

    this._buildFloor(MAIN_ROOF);
    this._buildFloor(HVAC_DECK);
    this._buildFloor(CRANE_DECK);

    this._buildRamp(-20, 14, -8, MAIN_ROOF.y, 0, HVAC_DECK.y);
    this._buildRamp(20, 14, 0, CRANE_DECK.y, 8, MAIN_ROOF.y);
    this._buildBridge(-10, HVAC_DECK.y, 8, 10, CRANE_DECK.y, -8, 4);

    this._buildParapet(MAIN_ROOF);

    this._buildHvacUnits();
    this._buildCrane();
    this._buildChimneyCluster([15, MAIN_ROOF.y, 22]);
    this._buildChimneyCluster([-15, MAIN_ROOF.y, -22]);
    this._buildCover();
  }

  // Small tileable noise texture so flat-colored surfaces read as something
  // other than a solid fill, without introducing an image-asset pipeline
  // (consistent with audio.js's synthesized SFX and the dummy health bars'
  // CanvasTexture use).
  _makeNoiseTexture(hexColor) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const base = new THREE.Color(hexColor);
    const imageData = ctx.createImageData(size, size);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 30;
      imageData.data[i] = Math.min(255, Math.max(0, base.r * 255 + n));
      imageData.data[i + 1] = Math.min(255, Math.max(0, base.g * 255 + n));
      imageData.data[i + 2] = Math.min(255, Math.max(0, base.b * 255 + n));
      imageData.data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  // isObstacle marks props/walls that a random spawn point must avoid, as
  // opposed to floors/ramps/bridge which are the walkable ground itself.
  _addBox(size, position, material, isObstacle = true) {
    const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(position[0], position[1], position[2]);
    this.scene.add(mesh);
    this.collidableMeshes.push(mesh);

    const halfExtents = new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2);
    // Position must go through the constructor, not a post-construction
    // body.position.set() - cannon-es bakes the body's broadphase AABB at
    // construction time, so setting position afterward leaves a stale AABB
    // centered on the origin and silently breaks raycasts (e.g. the
    // player's grounded check) against anything not near (0,0,0).
    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Box(halfExtents),
      position: new CANNON.Vec3(position[0], position[1], position[2]),
    });
    this.physics.addBody(body);

    if (isObstacle) {
      this.obstacles.push({ x: position[0], z: position[2], halfX: size[0] / 2, halfZ: size[2] / 2 });
    }

    return mesh;
  }

  _addCylinder(radius, height, position, material, isObstacle = true) {
    const geo = new THREE.CylinderGeometry(radius, radius, height, 8);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(position[0], position[1], position[2]);
    this.scene.add(mesh);
    this.collidableMeshes.push(mesh);

    const body = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Cylinder(radius, radius, height, 8),
      position: new CANNON.Vec3(position[0], position[1], position[2]),
    });
    this.physics.addBody(body);

    if (isObstacle) {
      this.obstacles.push({ x: position[0], z: position[2], halfX: radius, halfZ: radius });
    }

    return mesh;
  }

  _buildFloor(area) {
    const width = area.x[1] - area.x[0];
    const depth = area.z[1] - area.z[0];
    const centerX = (area.x[0] + area.x[1]) / 2;
    const centerZ = (area.z[0] + area.z[1]) / 2;
    const mesh = this._addBox([width, FLOOR_THICKNESS, depth], [centerX, area.y - FLOOR_THICKNESS / 2, centerZ], this.floorMat, false);

    // Bigger floors need more texture tiles or the noise pattern stretches
    // into a blur; each floor gets its own material clone so repeat can
    // differ per area.
    mesh.material = this.floorMat.clone();
    mesh.material.map = this.floorMat.map.clone();
    mesh.material.map.needsUpdate = true;
    mesh.material.map.repeat.set(width / FLOOR_TEXTURE_TILE, depth / FLOOR_TEXTURE_TILE);
  }

  // Low knee-height parapet around an area's outer edges.
  _buildParapet(area) {
    const [x0, x1] = area.x;
    const [z0, z1] = area.z;
    const y = area.y + PARAPET_HEIGHT / 2;

    this._addBox([x1 - x0, PARAPET_HEIGHT, PARAPET_THICKNESS], [(x0 + x1) / 2, y, z0], this.parapetMat);
    this._addBox([x1 - x0, PARAPET_HEIGHT, PARAPET_THICKNESS], [(x0 + x1) / 2, y, z1], this.parapetMat);
    this._addBox([PARAPET_THICKNESS, PARAPET_HEIGHT, z1 - z0], [x0, y, (z0 + z1) / 2], this.parapetMat);
    this._addBox([PARAPET_THICKNESS, PARAPET_HEIGHT, z1 - z0], [x1, y, (z0 + z1) / 2], this.parapetMat);
  }

  // Ramp connecting two heights with real sloped collision: a box rotated
  // about X so its top face runs smoothly from (zNear, yNear) to (zFar, yFar).
  // Requires zNear < zFar.
  _buildRamp(centerX, width, zNear, yNear, zFar, yFar) {
    const dz = zFar - zNear;
    const dy = yFar - yNear;
    const length = Math.hypot(dz, dy);
    const angle = -Math.atan2(dy, dz);
    const centerZ = (zNear + zFar) / 2;
    const centerY = (yNear + yFar) / 2;

    const geo = new THREE.BoxGeometry(width, RAMP_THICKNESS, length);
    const mesh = new THREE.Mesh(geo, this.floorMat);
    mesh.position.set(centerX, centerY, centerZ);
    mesh.rotation.x = angle;
    this.scene.add(mesh);
    this.collidableMeshes.push(mesh);

    const halfExtents = new CANNON.Vec3(width / 2, RAMP_THICKNESS / 2, length / 2);
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(halfExtents) });
    body.position.set(centerX, centerY, centerZ);
    body.quaternion.setFromEuler(angle, 0, 0);
    // Position/quaternion set after construction leave cannon-es's cached
    // AABB stale (computed at the origin) - see the note in _addBox. Force
    // a recompute so raycasts (e.g. the player's grounded check) can find it.
    body.updateAABB();
    this.physics.addBody(body);
  }

  // Diagonal bridge connecting two decks that aren't aligned on either axis
  // (unlike _buildRamp's roof-to-deck ramps, which only slope along z). Tilts
  // about local X for the height change, then yaws about Y to point at the
  // other deck. No railings/parapet on the bridge itself, so falling off its
  // side over open rooftop is a real fall, like the main roof's edge.
  _buildBridge(x0, y0, z0, x1, y1, z1, width) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const horizontal = Math.hypot(dx, dz);
    const length = Math.hypot(horizontal, dy);
    const pitch = -Math.atan2(dy, horizontal);
    const yaw = Math.atan2(dx, dz);

    const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const q = qYaw.multiply(qPitch);

    const centerX = (x0 + x1) / 2;
    const centerY = (y0 + y1) / 2;
    const centerZ = (z0 + z1) / 2;

    const geo = new THREE.BoxGeometry(width, RAMP_THICKNESS, length);
    const mesh = new THREE.Mesh(geo, this.floorMat);
    mesh.position.set(centerX, centerY, centerZ);
    mesh.quaternion.copy(q);
    this.scene.add(mesh);
    this.collidableMeshes.push(mesh);

    const halfExtents = new CANNON.Vec3(width / 2, RAMP_THICKNESS / 2, length / 2);
    const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(halfExtents) });
    body.position.set(centerX, centerY, centerZ);
    body.quaternion.set(q.x, q.y, q.z, q.w);
    body.updateAABB();
    this.physics.addBody(body);
  }

  // Blocky crates for tactical cover (blocking dummies' LOS raycast near
  // their spawn points) and general rooftop clutter.
  _buildCover() {
    const positions = [
      // Near the main-roof dummy (0, 1, -20).
      [6, 1, -16],
      [-6, 1, -15],
      // Near the HVAC-deck dummy (-20, 3.2, 10).
      [-16, HVAC_DECK.y, 14],
      [-25, HVAC_DECK.y, 12],
      // Near the crane-deck dummy (26, 4, -5).
      [16, CRANE_DECK.y, -4],
      // General clutter, not tied to a dummy's LOS.
      [10, 1, 15],
      [-6, 1, -3],
    ];
    for (const [x, deckY, z] of positions) {
      this._addBox(COVER_SIZE, [x, deckY + COVER_HEIGHT / 2, z], this.propMat);
    }
  }

  _buildHvacUnits() {
    const size = [1.6, 1.4, 1.6];
    const y = HVAC_DECK.y + size[1] / 2;
    const positions = [
      [-26, y, 5],
      [-14, y, 8],
      [-20, y, 16],
    ];
    for (const pos of positions) this._addBox(size, pos, this.propMat);
  }

  _buildCrane() {
    const mastHeight = 8;
    const mastY = CRANE_DECK.y + mastHeight / 2;
    this._addBox([0.8, mastHeight, 0.8], [20, mastY, -10], this.propMat);

    const boomLength = 10;
    const boomY = CRANE_DECK.y + mastHeight;
    this._addBox([boomLength, 0.6, 0.6], [20 + boomLength / 2, boomY, -10], this.propMat);
  }

  // Random point on one of the walkable floor areas (main roof / HVAC deck /
  // crane deck), inset from the edges and clear of obstacle props, at
  // standing height for that area. Falls back to the first area's center if
  // no clear point is found within the attempt budget.
  getRandomSpawnPoint(radius = 0.6) {
    for (let attempt = 0; attempt < SPAWN_MAX_ATTEMPTS; attempt++) {
      const area = this.areas[Math.floor(Math.random() * this.areas.length)];
      const x = THREE.MathUtils.lerp(area.x[0] + SPAWN_EDGE_MARGIN, area.x[1] - SPAWN_EDGE_MARGIN, Math.random());
      const z = THREE.MathUtils.lerp(area.z[0] + SPAWN_EDGE_MARGIN, area.z[1] - SPAWN_EDGE_MARGIN, Math.random());
      const clear = this.obstacles.every((o) => Math.abs(x - o.x) > o.halfX + radius || Math.abs(z - o.z) > o.halfZ + radius);
      const farFromPlayerSpawn = Math.hypot(x - this.spawnPoint.x, z - this.spawnPoint.z) > MIN_RESPAWN_DIST_FROM_PLAYER_SPAWN;
      if (clear && farFromPlayerSpawn) return new THREE.Vector3(x, area.y + 1, z);
    }
    const fallback = this.areas[0];
    return new THREE.Vector3((fallback.x[0] + fallback.x[1]) / 2, fallback.y + 1, (fallback.z[0] + fallback.z[1]) / 2);
  }

  // The floor area a point's x/z falls within, preferring the smallest
  // matching area since HVAC_DECK/CRANE_DECK sit inside MAIN_ROOF's x/z
  // footprint (they're small islands raised above the main roof, not
  // disjoint rectangles) - used by dummy wander to keep a dummy bounded to
  // whichever area it's currently standing on.
  getAreaAt(x, z) {
    let best = null;
    let bestSize = Infinity;
    for (const area of this.areas) {
      if (x < area.x[0] || x > area.x[1] || z < area.z[0] || z > area.z[1]) continue;
      const size = (area.x[1] - area.x[0]) * (area.z[1] - area.z[0]);
      if (size < bestSize) {
        best = area;
        bestSize = size;
      }
    }
    return best || this.areas[0];
  }

  // A cluster of a few round vent stacks, like the chimney groups in the
  // reference rooftop image.
  _buildChimneyCluster(center) {
    const radius = 0.4;
    const height = 3;
    const offsets = [
      [0, 0],
      [1, 0.3],
      [-0.8, 0.6],
    ];
    for (const [dx, dz] of offsets) {
      this._addCylinder(radius, height, [center[0] + dx, center[1] + height / 2, center[2] + dz], this.chimneyMat);
    }
  }
}
