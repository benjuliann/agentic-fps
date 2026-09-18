import * as THREE from 'three';
import { Physics } from './physics.js';
import { Level } from './level.js';
import { Player } from './player.js';
import { Weapons } from './weapons.js';
import { HUD } from './hud.js';
import { Dummy } from './dummy.js';
import { Audio } from './audio.js';

const FOOTSTEP_INTERVAL = 0.35;
const MATCH_DURATION = 90;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const physics = new Physics();
const level = new Level(scene, physics);
const player = new Player(camera, renderer.domElement, physics, level.spawnPoint);
player.yaw = level.spawnYaw;

const audio = new Audio();

// Placed on the HVAC/crane decks and the open roof, well away from the
// spawn point so the player isn't shot immediately on spawn/respawn.
const dummies = [
  new Dummy(scene, new THREE.Vector3(-20, 3.2, 10)),
  new Dummy(scene, new THREE.Vector3(26, 4, -5)),
  new Dummy(scene, new THREE.Vector3(0, 1, -20)),
];

const weapons = new Weapons(camera, level, dummies, audio);

const hud = new HUD(player, weapons, {
  onPlayClick: () => {
    player.requestPointerLock();
    audio.resume();
  },
});

let footstepTimer = 0;
const clock = new THREE.Clock();

let matchStarted = false;
let timeLeft = MATCH_DURATION;

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);

  physics.step(delta);
  player.update();

  if (!matchStarted && player.isLocked) matchStarted = true;
  if (matchStarted) timeLeft = Math.max(0, timeLeft - delta);

  if (player.consumeJumpEvent()) audio.playJump();

  if (player.moving) {
    footstepTimer -= delta;
    if (footstepTimer <= 0) {
      audio.playFootstep();
      footstepTimer = FOOTSTEP_INTERVAL;
    }
  } else {
    footstepTimer = 0;
  }

  for (const dummy of dummies) dummy.update(delta, player, level, audio);

  hud.update(timeLeft, timeLeft === 0);

  renderer.render(scene, camera);
}

animate();
