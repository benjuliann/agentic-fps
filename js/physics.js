import * as CANNON from 'cannon-es';

const FIXED_TIME_STEP = 1 / 60;
const MAX_SUB_STEPS = 10;

export class Physics {
  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    this.world.defaultContactMaterial.friction = 0;
  }

  addBody(body) {
    this.world.addBody(body);
  }

  step(delta) {
    this.world.step(FIXED_TIME_STEP, delta, MAX_SUB_STEPS);
  }
}
