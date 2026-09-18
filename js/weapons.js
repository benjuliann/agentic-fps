import * as THREE from 'three';

const MAX_AMMO = 12;
const DAMAGE = 25;
const RANGE = 100;

export class Weapons {
  constructor(camera, level, dummies, audio) {
    this.camera = camera;
    this.level = level;
    this.dummies = dummies;
    this.audio = audio;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = RANGE;

    this.ammo = MAX_AMMO;
    this.maxAmmo = MAX_AMMO;
    this.kills = 0;

    this.listeners = { fire: [], hit: [], reload: [] };

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.fire();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyR') this.reload();
    });
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
