export class Audio {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _envelope(duration, peak) {
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    return gain;
  }

  _noiseBuffer(duration) {
    const sampleRate = this.ctx.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  playGunshot() {
    const duration = 0.18;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(duration);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2500, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + duration);

    const gain = this._envelope(duration, 0.6);
    noise.connect(filter).connect(gain).connect(this.ctx.destination);
    noise.start();
    noise.stop(this.ctx.currentTime + duration);
  }

  playFootstep() {
    const duration = 0.08;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(duration);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 250;
    filter.Q.value = 1;

    const gain = this._envelope(duration, 0.3);
    noise.connect(filter).connect(gain).connect(this.ctx.destination);
    noise.start();
    noise.stop(this.ctx.currentTime + duration);
  }

  playJump() {
    const duration = 0.15;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, this.ctx.currentTime + duration);

    const gain = this._envelope(duration, 0.3);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playReload() {
    const clickDuration = 0.04;
    const gap = 0.09;
    const now = this.ctx.currentTime;

    [now, now + gap].forEach((startTime) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(500, startTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.4, startTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + clickDuration);

      osc.connect(gain).connect(this.ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + clickDuration);
    });
  }

  playRespawn() {
    const duration = 0.3;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(65.41, this.ctx.currentTime); // C2

    const gain = this._envelope(duration, 0.4);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playHit() {
    const duration = 0.1;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(900, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(200, this.ctx.currentTime + duration);

    const gain = this._envelope(duration, 0.25);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }
}
