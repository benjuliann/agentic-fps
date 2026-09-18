import * as THREE from 'three';

const MAX_AMMO = 12;
const DAMAGE = 25;
const RANGE = 100;

// First-person viewmodel gun: a static mesh anchored to the camera (bottom
// right of the screen), not physics-tracked. Same L-shaped barrel+grip look
// as the dummies' guns, scaled down for a close-up view. Gives the player's
// own tracer a visible muzzle point to originate from, instead of the
// invisible camera/raycaster origin used before.
const GUN_OFFSET = new THREE.Vector3(0.25, -0.25, -0.5);
const GUN_BARREL_LENGTH = 0.35;
const GUN_MUZZLE_LOCAL = new THREE.Vector3(0, 0, -GUN_BARREL_LENGTH / 2);

export class Weapons {
  constructor(camera, level, dummies, audio, tracers) {
    this.camera = camera;
    this.level = level;
    this.dummies = dummies;
    this.audio = audio;
    this.tracers = tracers;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = RANGE;

    this.ammo = MAX_AMMO;
    this.maxAmmo = MAX_AMMO;
    this.kills = 0;

    this.listeners = { fire: [], hit: [], reload: [] };

    this._buildGunModel();

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.fire();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR') this.reload();
    });
  }

  _buildGunModel() {
    this.gunGroup = new THREE.Group();
    this.gunGroup.position.copy(GUN_OFFSET);
    this.camera.add(this.gunGroup);

    const gunMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, GUN_BARREL_LENGTH), gunMat);
    this.gunGroup.add(barrel);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.05), gunMat);
    grip.position.set(0, -0.09, 0.11);
    this.gunGroup.add(grip);
  }

  on(event, callback) {
    this.listeners[event].push(callback);
  }

  _emit(event, data) {
    for (const callback of this.listeners[event]) callback(data);
  }

  fire() {
    if (!document.pointerLockElement) return;
    if (this.ammo <= 0) return;

    this.ammo--;
    this.audio.playGunshot();
    this._emit('fire', { ammo: this.ammo });

    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const targets = [...this.level.collidableMeshes, ...this.dummies.map((d) => d.mesh)];
    const hits = this.raycaster.intersectObjects(targets, false);

    this.gunGroup.updateMatrixWorld(true);
    const origin = this.gunGroup.localToWorld(GUN_MUZZLE_LOCAL.clone());
    const rayOrigin = this.raycaster.ray.origin;
    const end = hits.length > 0
      ? hits[0].point.clone()
      : rayOrigin.clone().add(this.raycaster.ray.direction.clone().multiplyScalar(RANGE));
    this.tracers.spawn(origin, end);

    if (hits.length > 0) {
      const hit = hits[0];
      const dummy = this.dummies.find((d) => d.mesh === hit.object);
      if (dummy) {
        const wasAlive = dummy.hp > 0;
        dummy.takeDamage(DAMAGE);
        this.audio.playHit();
        if (wasAlive && dummy.hp === 0) this.kills++;
      }
      this._emit('hit', { point: hit.point, object: hit.object, dummy: !!dummy });
    }
  }

  reload() {
    this.ammo = this.maxAmmo;
    this.audio.playReload();
    this._emit('reload', { ammo: this.ammo });
  }
}
