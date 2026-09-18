import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const MAX_HP = 100;
const RESPAWN_DELAY = 3;
const RESPAWN_CLEARANCE_RADIUS = 0.6;
const DUMMY_DAMAGE = 25;
const FIRE_COOLDOWN = 10;
const MAX_FIRE_RANGE = 15;
const LOOK_ARC = Math.PI / 2;
const LOOK_MIN_INTERVAL = 2;
const LOOK_MAX_INTERVAL = 4;
const LOOK_TURN_SPEED = 1.2;

// A dummy must hold sight on the player for REACTION_DELAY before it's
// allowed to fire, instead of snapping to a shot the instant sight is
// acquired. GUN_AIM_LERP_SPEED (a per-second slerp rate) is tuned so the gun
// has visibly swung onto target by the time REACTION_DELAY elapses.
const REACTION_DELAY = 0.5;
const GUN_AIM_LERP_SPEED = 6;

const MUZZLE_FLASH_DURATION = 0.06;
const MUZZLE_FLASH_COLOR = 0xffffaa;
const MUZZLE_TIP_COLOR = 0xffee88;

// Physics body sized to match the capsule mesh (radius 0.4, length 1.2, so
// total height 1.2 + 2*0.4 = 2.0). Own collision group so dummies collide
// with level geometry (crates, parapets) but pass through the player and
// each other - matches level.js's static bodies, which are on the default
// group (1), same as player.js's GROUND_GROUP.
const DUMMY_RADIUS = 0.4;
const DUMMY_HEIGHT = 2.0;
const DUMMY_MASS = 60;
const DUMMY_DAMPING = 0.9;
const DUMMY_GROUP = 4;
const GROUND_GROUP = 1;

const WANDER_SPEED = 3;
const WANDER_IDLE_MIN = 0.5;
const WANDER_IDLE_MAX = 1.5;
const WANDER_ARRIVE_DIST = 0.5;
const WANDER_EDGE_MARGIN = 3;

// Occasional hop while actively wandering (not during idle/guard-scan/firing
// pauses), gated by the same kind of grounded raycast player.js uses for its
// own jump so a dummy can't "jump" mid-air.
const DUMMY_JUMP_VELOCITY = 5;
const JUMP_MIN_INTERVAL = 3;
const JUMP_MAX_INTERVAL = 6;

class HealthBarSprite {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 128;
    this.canvas.height = 16;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    const material = new THREE.SpriteMaterial({ map: this.texture, depthTest: false });
    this.sprite = new THREE.Sprite(material);
    this.sprite.scale.set(1, 0.125, 1);
    this.sprite.renderOrder = 999;
  }

  update(hp, maxHp) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, w, h);

    const pct = Math.max(0, hp / maxHp);
    ctx.fillStyle = pct > 0.5 ? '#2ecc40' : pct > 0.2 ? '#ffcc00' : '#ff4136';
    ctx.fillRect(1, 1, (w - 2) * pct, h - 2);

    this.texture.needsUpdate = true;
  }
}

export class Dummy {
  constructor(scene, physics, position) {
    this.physics = physics;
    this.position = position.clone();
    this.maxHp = MAX_HP;
    this.hp = MAX_HP;
    this.respawnTimer = 0;

    this.facingYaw = 0;
    this.lookTargetYaw = 0;
    this.lookTimer = 0;
    this.fireTimer = 0;
    this.sightTimer = 0;
    this.raycaster = new THREE.Raycaster();

    this.wanderState = 'idle';
    this.wanderTimer = WANDER_IDLE_MIN + Math.random() * (WANDER_IDLE_MAX - WANDER_IDLE_MIN);
    this.wanderTarget = null;
    this.jumpTimer = JUMP_MIN_INTERVAL + Math.random() * (JUMP_MAX_INTERVAL - JUMP_MIN_INTERVAL);

    this.body = new CANNON.Body({
      mass: DUMMY_MASS,
      shape: new CANNON.Cylinder(DUMMY_RADIUS, DUMMY_RADIUS, DUMMY_HEIGHT, 8),
      position: new CANNON.Vec3(position.x, position.y, position.z),
      linearDamping: DUMMY_DAMPING,
      fixedRotation: true,
    });
    this.body.collisionFilterGroup = DUMMY_GROUP;
    this.body.collisionFilterMask = GROUND_GROUP;
    physics.addBody(this.body);

    const geo = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xcc3333 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(this.position);
    scene.add(this.mesh);

    // L-shaped gun (barrel + grip) instead of a single box: a lone box reads
    // as a tiny dot/square when aimed straight at the camera, giving no
    // visual cue that it's a gun pointed at the player. The grip stays
    // visible as a perpendicular bar from that same head-on angle.
    const gunMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
    this.gunMesh = new THREE.Group();
    // Slight right-and-forward offset approximating a held grip, rather than
    // sitting near the body's centerline.
    this.gunMesh.position.set(0.3, 0.1, -0.6);
    this.mesh.add(this.gunMesh);

    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.7), gunMat);
    this.gunMesh.add(barrel);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), gunMat);
    grip.position.set(0, -0.18, 0.22);
    this.gunMesh.add(grip);

    // Bright muzzle tip (matches the tracer color) so the barrel's front end
    // reads clearly even at a distance, plus a brief flash sprite shown only
    // while firing.
    const muzzleTip = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.06),
      new THREE.MeshBasicMaterial({ color: MUZZLE_TIP_COLOR })
    );
    muzzleTip.position.set(0, 0, -0.38);
    this.gunMesh.add(muzzleTip);

    this.muzzleFlash = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: MUZZLE_FLASH_COLOR, transparent: true, depthTest: false })
    );
    this.muzzleFlash.scale.set(0.35, 0.35, 0.35);
    this.muzzleFlash.position.set(0, 0, -0.42);
    this.muzzleFlash.visible = false;
    this.gunMesh.add(this.muzzleFlash);
    this.muzzleFlashTimer = 0;

    this.healthBar = new HealthBarSprite();
    this.healthBar.sprite.position.set(this.position.x, this.position.y + 1.4, this.position.z);
    this.healthBar.update(this.hp, this.maxHp);
    scene.add(this.healthBar.sprite);
  }

  takeDamage(amount) {
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.healthBar.update(this.hp, this.maxHp);

    if (this.hp === 0) {
      this.mesh.visible = false;
      this.healthBar.sprite.visible = false;
      this.respawnTimer = RESPAWN_DELAY;
    }
  }

  update(delta, player, level, audio, tracers) {
    this.healthBar.sprite.quaternion.copy(player.camera.quaternion);

    if (this.respawnTimer > 0) {
      this.respawnTimer -= delta;
      if (this.respawnTimer <= 0) {
        this.hp = this.maxHp;
        this.position.copy(level.getRandomSpawnPoint(RESPAWN_CLEARANCE_RADIUS));
        this.body.position.set(this.position.x, this.position.y, this.position.z);
        this.body.velocity.set(0, 0, 0);
        this.wanderState = 'idle';
        this.wanderTimer = WANDER_IDLE_MIN + Math.random() * (WANDER_IDLE_MAX - WANDER_IDLE_MIN);
        this.wanderTarget = null;
        this.jumpTimer = JUMP_MIN_INTERVAL + Math.random() * (JUMP_MAX_INTERVAL - JUMP_MIN_INTERVAL);
        this.sightTimer = 0;
        this.mesh.position.copy(this.position);
        this.healthBar.sprite.position.set(this.position.x, this.position.y + 1.4, this.position.z);
        this.mesh.visible = true;
        this.healthBar.sprite.visible = true;
        this.healthBar.update(this.hp, this.maxHp);
        audio.playRespawn();
      }
      return;
    }

    this.position.set(this.body.position.x, this.body.position.y, this.body.position.z);
    this.mesh.position.copy(this.position);
    this.healthBar.sprite.position.set(this.position.x, this.position.y + 1.4, this.position.z);

    const sight = this._canSeePlayer(player, level);
    this.sightTimer = sight ? this.sightTimer + delta : 0;

    const wasTurning = Math.abs(this._angleDiff(this.lookTargetYaw, this.facingYaw)) > 0.02;
    this._updateLook(delta, sight, player);
    this._updateGunAim(delta, sight, player);
    this._updateWander(delta, level, wasTurning || !!sight);
    this._updateFire(delta, player, audio, tracers, sight);
  }

  // Aims the gun mesh itself at the player's exact camera position while in
  // sight, so the visible barrel matches the tracer's direction instead of
  // just following the body's guard-scan yaw. Slerps toward the target
  // orientation instead of snapping instantly, so the dummy visibly swings
  // onto the player rather than instant-locking on. Resets to resting/forward
  // when not sighting so the gun doesn't stay pinned to a stale aim.
  _updateGunAim(delta, sight, player) {
    if (sight) {
      const startQuat = this.gunMesh.quaternion.clone();
      this.gunMesh.lookAt(player.camera.position);
      // Object3D.lookAt() points local +Z at the target, but the barrel/muzzle
      // are built along local -Z (matching the resting pose's forward
      // direction) - without this flip the grip end, not the muzzle, faces
      // the player.
      this.gunMesh.rotateY(Math.PI);
      const targetQuat = this.gunMesh.quaternion.clone();
      this.gunMesh.quaternion.copy(startQuat).slerp(targetQuat, Math.min(1, GUN_AIM_LERP_SPEED * delta));
    } else {
      this.gunMesh.rotation.set(0, 0, 0);
    }
  }

  // Idle guard scanning: turns toward a periodically-chosen yaw. While the
  // player is in sight, the body instead turns to face the player directly
  // (same turn-rate mechanism) so the gun's aim isn't pinned to a body still
  // oriented from the last guard-scan direction.
  _updateLook(delta, sight, player) {
    if (sight) {
      const dx = player.camera.position.x - this.position.x;
      const dz = player.camera.position.z - this.position.z;
      this.lookTargetYaw = Math.atan2(-dx, -dz);
    } else {
      this.lookTimer -= delta;
      if (this.lookTimer <= 0) {
        this.lookTargetYaw = this.facingYaw + (Math.random() * 2 - 1) * LOOK_ARC;
        this.lookTimer = LOOK_MIN_INTERVAL + Math.random() * (LOOK_MAX_INTERVAL - LOOK_MIN_INTERVAL);
      }
    }

    const diff = this._angleDiff(this.lookTargetYaw, this.facingYaw);
    const step = Math.sign(diff) * Math.min(Math.abs(diff), LOOK_TURN_SPEED * delta);
    this.facingYaw += step;
    this.mesh.rotation.y = this.facingYaw;
  }

  // Shortest signed distance from `b` to `a`, wrapped to [-PI, PI] - needed
  // once facing-the-player (via atan2, full range) is mixed with the guard
  // scan's turn-rate stepping, otherwise a target behind the dummy turns the
  // long way around.
  _angleDiff(a, b) {
    let diff = a - b;
    diff = ((diff + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return diff;
  }

  // Null if the player is out of range or blocked by level geometry;
  // otherwise the eye/distance used both to decide whether to pause
  // wandering and, once off cooldown, to actually fire.
  _canSeePlayer(player, level) {
    const eye = new THREE.Vector3(this.position.x, this.position.y + 1, this.position.z);
    const toPlayer = new THREE.Vector3().subVectors(player.camera.position, eye);
    const distance = toPlayer.length();
    if (distance < 0.001 || distance > MAX_FIRE_RANGE) return null;
    toPlayer.normalize();

    this.raycaster.set(eye, toPlayer);
    this.raycaster.far = distance;
    const hits = this.raycaster.intersectObjects(level.collidableMeshes, false);
    const blocked = hits.length > 0 && hits[0].distance < distance - 0.5;
    if (blocked) return null;

    return { eye };
  }

  // Hitscan fire at the player on a cooldown, only when line-of-sight to the
  // player isn't blocked by level geometry and the dummy has held sight for
  // at least REACTION_DELAY (see _updateGunAim) - so spotting the player
  // doesn't fire an instant shot.
  _updateFire(delta, player, audio, tracers, sight) {
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= delta;
      if (this.muzzleFlashTimer <= 0) this.muzzleFlash.visible = false;
    }

    if (this.fireTimer > 0) {
      this.fireTimer -= delta;
      return;
    }
    if (!sight || this.sightTimer < REACTION_DELAY) return;

    // Tracer starts at the gun mesh's muzzle (not the eye point used for the
    // LOS check) so the beam visibly comes from this dummy's gun, making it
    // clear which dummy is firing.
    const muzzle = this.gunMesh.localToWorld(new THREE.Vector3(0, 0, -0.35));

    player.takeDamage(DUMMY_DAMAGE);
    audio.playGunshot();
    tracers.spawn(muzzle, player.camera.position.clone());
    this.muzzleFlash.visible = true;
    this.muzzleFlashTimer = MUZZLE_FLASH_DURATION;
    this.fireTimer = FIRE_COOLDOWN;
  }

  // Wander to a random point within whichever floor area the dummy is
  // currently on, pausing (idle) between legs and whenever `paused` is true
  // (mid guard-scan turn, or with the player in sight/range). Movement is
  // done by setting horizontal body velocity so cannon-es collision with
  // cover crates/parapets stops the dummy like it would the player.
  _updateWander(delta, level, paused) {
    if (paused) {
      this.body.velocity.x = 0;
      this.body.velocity.z = 0;
      return;
    }

    if (this.wanderState === 'idle') {
      this.wanderTimer -= delta;
      if (this.wanderTimer <= 0) {
        this.wanderTarget = this._pickWanderTarget(level);
        this.wanderState = 'moving';
      }
      this.body.velocity.x = 0;
      this.body.velocity.z = 0;
      return;
    }

    const dx = this.wanderTarget.x - this.position.x;
    const dz = this.wanderTarget.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < WANDER_ARRIVE_DIST) {
      this.wanderState = 'idle';
      this.wanderTimer = WANDER_IDLE_MIN + Math.random() * (WANDER_IDLE_MAX - WANDER_IDLE_MIN);
      this.body.velocity.x = 0;
      this.body.velocity.z = 0;
      return;
    }

    this.body.velocity.x = (dx / dist) * WANDER_SPEED;
    this.body.velocity.z = (dz / dist) * WANDER_SPEED;

    this.jumpTimer -= delta;
    if (this.jumpTimer <= 0) {
      this.jumpTimer = JUMP_MIN_INTERVAL + Math.random() * (JUMP_MAX_INTERVAL - JUMP_MIN_INTERVAL);
      if (this._isGrounded()) this.body.velocity.y = DUMMY_JUMP_VELOCITY;
    }
  }

  // Same grounded raycast pattern as player.js's _isGrounded, so a dummy
  // only jumps (see _updateWander) when it's actually standing on something.
  _isGrounded() {
    const from = new CANNON.Vec3(this.body.position.x, this.body.position.y, this.body.position.z);
    const to = new CANNON.Vec3(from.x, from.y - (DUMMY_HEIGHT / 2 + 0.15), from.z);
    const result = new CANNON.RaycastResult();
    this.physics.world.raycastClosest(from, to, { collisionFilterMask: GROUND_GROUP }, result);
    return result.hasHit;
  }

  _pickWanderTarget(level) {
    const area = level.getAreaAt(this.position.x, this.position.z);
    return {
      x: THREE.MathUtils.lerp(area.x[0] + WANDER_EDGE_MARGIN, area.x[1] - WANDER_EDGE_MARGIN, Math.random()),
      z: THREE.MathUtils.lerp(area.z[0] + WANDER_EDGE_MARGIN, area.z[1] - WANDER_EDGE_MARGIN, Math.random()),
    };
  }
}
