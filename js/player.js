import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const MOVE_SPEED = 6;
const SPRINT_SPEED = 10;
const DEFAULT_DAMPING = 0.9;
const SPRINT_DAMPING = 0.3;
const JUMP_VELOCITY = 6;
const EYE_HEIGHT = 1.6;
const PLAYER_RADIUS = 0.4;
const PLAYER_HEIGHT = 1.8;
const GROUND_GROUP = 1;
const PLAYER_GROUP = 2;
const MAX_HEALTH = 100;
const FALL_DEATH_Y = -15;
const FALL_DAMAGE = 100;

export class Player {
  constructor(camera, domElement, physics, spawnPosition) {
    this.camera = camera;
    this.domElement = domElement;
    this.physics = physics;

    this.isLocked = false;
    this.health = MAX_HEALTH;
    this.deaths = 0;
    this.moving = false;
    this.justJumped = false;
    this.spawnPosition = new CANNON.Vec3(spawnPosition.x, spawnPosition.y, spawnPosition.z);

    this.yaw = 0;
    this.pitch = 0;
    this.camera.rotation.order = 'YXZ';

    this.keys = { forward: false, back: false, left: false, right: false, jump: false, sprint: false };
    this.listeners = { damage: [] };

    this.body = new CANNON.Body({
      mass: 70,
      shape: new CANNON.Cylinder(PLAYER_RADIUS, PLAYER_RADIUS, PLAYER_HEIGHT, 8),
      position: new CANNON.Vec3(spawnPosition.x, spawnPosition.y, spawnPosition.z),
      linearDamping: DEFAULT_DAMPING,
      fixedRotation: true,
    });
    this.body.collisionFilterGroup = PLAYER_GROUP;
    physics.addBody(this.body);

    this._setupPointerLock();
    this._setupKeyboard();
  }

  requestPointerLock() {
    this.domElement.requestPointerLock();
  }

  consumeJumpEvent() {
    const jumped = this.justJumped;
    this.justJumped = false;
    return jumped;
  }

  on(event, callback) {
    this.listeners[event].push(callback);
  }

  _emit(event, data) {
    for (const callback of this.listeners[event]) callback(data);
  }

  takeDamage(amount) {
    if (this.health <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this._emit('damage', { amount });
    if (this.health === 0) {
      this.deaths++;
      this.respawn();
    }
  }

  respawn() {
    this.health = MAX_HEALTH;
    this.body.position.set(this.spawnPosition.x, this.spawnPosition.y, this.spawnPosition.z);
    this.body.velocity.set(0, 0, 0);
  }

  _setupPointerLock() {
    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.domElement;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      const sensitivity = 0.0025;
      this.yaw -= e.movementX * sensitivity;
      this.pitch -= e.movementY * sensitivity;
      const maxPitch = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
    });
  }

  _setupKeyboard() {
    window.addEventListener('keydown', (e) => this._onKey(e.code, true));
    window.addEventListener('keyup', (e) => this._onKey(e.code, false));
  }

  _onKey(code, down) {
    switch (code) {
      case 'KeyW': this.keys.forward = down; break;
      case 'KeyS': this.keys.back = down; break;
      case 'KeyA': this.keys.left = down; break;
      case 'KeyD': this.keys.right = down; break;
      case 'Space': if (down) this.keys.jump = true; break;
      case 'ShiftLeft':
      case 'ShiftRight': this.keys.sprint = down; break;
    }
  }

  _isGrounded() {
    const from = new CANNON.Vec3(this.body.position.x, this.body.position.y, this.body.position.z);
    const to = new CANNON.Vec3(from.x, from.y - (PLAYER_HEIGHT / 2 + 0.15), from.z);
    const result = new CANNON.RaycastResult();
    this.physics.world.raycastClosest(from, to, { collisionFilterMask: GROUND_GROUP }, result);
    return result.hasHit;
  }

  update() {
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);

    let moveX = 0;
    let moveZ = 0;
    if (this.keys.forward) { moveX += forward.x; moveZ += forward.z; }
    if (this.keys.back) { moveX -= forward.x; moveZ -= forward.z; }
    if (this.keys.right) { moveX += right.x; moveZ += right.z; }
    if (this.keys.left) { moveX -= right.x; moveZ -= right.z; }

    const len = Math.hypot(moveX, moveZ);
    const grounded = this._isGrounded();
    this.moving = len > 0.001 && grounded;

    this.body.linearDamping = this.keys.sprint ? SPRINT_DAMPING : DEFAULT_DAMPING;

    if (len > 0.001) {
      moveX /= len;
      moveZ /= len;
      const speed = this.keys.sprint ? SPRINT_SPEED : MOVE_SPEED;
      this.body.velocity.x = moveX * speed;
      this.body.velocity.z = moveZ * speed;
    } else {
      this.body.velocity.x = 0;
      this.body.velocity.z = 0;
    }

    if (this.keys.jump && grounded) {
      this.body.velocity.y = JUMP_VELOCITY;
      this.justJumped = true;
      this.keys.jump = false;
    }

    if (this.body.position.y < FALL_DEATH_Y) this.takeDamage(FALL_DAMAGE);

    this.camera.position.set(
      this.body.position.x,
      this.body.position.y + EYE_HEIGHT - PLAYER_HEIGHT / 2,
      this.body.position.z
    );
  }
}
