import * as THREE from 'three';

const MAX_HP = 100;
const RESPAWN_DELAY = 3;
const RESPAWN_CLEARANCE_RADIUS = 0.6;
const DUMMY_DAMAGE = 25;
const FIRE_COOLDOWN = 10;
const MAX_FIRE_RANGE = 25;
const LOOK_ARC = Math.PI / 2;
const LOOK_MIN_INTERVAL = 2;
const LOOK_MAX_INTERVAL = 4;
const LOOK_TURN_SPEED = 1.2;

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
  constructor(scene, position) {
    this.position = position.clone();
    this.maxHp = MAX_HP;
    this.hp = MAX_HP;
    this.respawnTimer = 0;

    this.facingYaw = 0;
    this.lookTargetYaw = 0;
    this.lookTimer = 0;
    this.fireTimer = 0;
    this.raycaster = new THREE.Raycaster();

    const geo = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xcc3333 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(this.position);
    scene.add(this.mesh);

    const gunGeo = new THREE.BoxGeometry(0.15, 0.15, 0.7);
    const gunMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
    this.gunMesh = new THREE.Mesh(gunGeo, gunMat);
    this.gunMesh.position.set(0.15, 0.1, -0.55);
    this.mesh.add(this.gunMesh);

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

  update(delta, player, level, audio) {
    this.healthBar.sprite.quaternion.copy(player.camera.quaternion);

    if (this.respawnTimer > 0) {
      this.respawnTimer -= delta;
      if (this.respawnTimer <= 0) {
        this.hp = this.maxHp;
        this.position.copy(level.getRandomSpawnPoint(RESPAWN_CLEARANCE_RADIUS));
        this.mesh.position.copy(this.position);
        this.healthBar.sprite.position.set(this.position.x, this.position.y + 1.4, this.position.z);
        this.mesh.visible = true;
        this.healthBar.sprite.visible = true;
        this.healthBar.update(this.hp, this.maxHp);
        audio.playRespawn();
      }
      return;
    }

    this._updateLook(delta);
    this._updateFire(delta, player, level, audio);
  }

  // Idle guard scanning: turns toward a periodically-chosen yaw. Runs
  // independently of firing, so the dummy keeps scanning even while shooting.
  _updateLook(delta) {
    this.lookTimer -= delta;
    if (this.lookTimer <= 0) {
      this.lookTargetYaw = this.facingYaw + (Math.random() * 2 - 1) * LOOK_ARC;
      this.lookTimer = LOOK_MIN_INTERVAL + Math.random() * (LOOK_MAX_INTERVAL - LOOK_MIN_INTERVAL);
    }

    const diff = this.lookTargetYaw - this.facingYaw;
    const step = Math.sign(diff) * Math.min(Math.abs(diff), LOOK_TURN_SPEED * delta);
    this.facingYaw += step;
    this.mesh.rotation.y = this.facingYaw;
  }

  // Hitscan fire at the player on a cooldown, only when line-of-sight to the
  // player isn't blocked by level geometry.
  _updateFire(delta, player, level, audio) {
    if (this.fireTimer > 0) {
      this.fireTimer -= delta;
      return;
    }

    const eye = new THREE.Vector3(this.position.x, this.position.y + 1, this.position.z);
    const toPlayer = new THREE.Vector3().subVectors(player.camera.position, eye);
    const distance = toPlayer.length();
    if (distance < 0.001 || distance > MAX_FIRE_RANGE) return;
    toPlayer.normalize();

    this.raycaster.set(eye, toPlayer);
    this.raycaster.far = distance;
    const hits = this.raycaster.intersectObjects(level.collidableMeshes, false);
    const blocked = hits.length > 0 && hits[0].distance < distance - 0.5;
    if (blocked) return;

    player.takeDamage(DUMMY_DAMAGE);
    audio.playGunshot();
    this.fireTimer = FIRE_COOLDOWN;
  }
}
