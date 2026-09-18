import * as THREE from 'three';

const TRACER_DURATION = 0.15;
const TRACER_COLOR = 0xffee88;

// Short-lived line segments drawn for both the player's and dummies' shots,
// faded out and removed after TRACER_DURATION. update() must be called once
// per frame from the main loop.
export class TracerManager {
  constructor(scene) {
    this.scene = scene;
    this.active = [];
  }

  spawn(from, to) {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const material = new THREE.LineBasicMaterial({ color: TRACER_COLOR, transparent: true, opacity: 1 });
    const line = new THREE.Line(geometry, material);
    this.scene.add(line);
    this.active.push({ line, timeLeft: TRACER_DURATION });
  }

  update(delta) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const tracer = this.active[i];
      tracer.timeLeft -= delta;
      if (tracer.timeLeft <= 0) {
        this.scene.remove(tracer.line);
        tracer.line.geometry.dispose();
        tracer.line.material.dispose();
        this.active.splice(i, 1);
      } else {
        tracer.line.material.opacity = tracer.timeLeft / TRACER_DURATION;
      }
    }
  }
}
