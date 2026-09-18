export class HUD {
  constructor(player, weapons, { onPlayClick }) {
    this.player = player;
    this.weapons = weapons;

    this.healthEl = document.getElementById('health');
    this.healthTextEl = document.getElementById('health-text');
    this.healthBarEl = document.getElementById('health-bar-fill');
    this.ammoEl = document.getElementById('ammo');
    this.ammoTextEl = document.getElementById('ammo-text');
    this.ammoBarEl = document.getElementById('ammo-bar-fill');
    this.crosshairEl = document.getElementById('crosshair');
    this.vignetteEl = document.getElementById('damage-vignette');
    this.overlayEl = document.getElementById('overlay');
    this.timerEl = document.getElementById('timer');
    this.kdEl = document.getElementById('kd');
    this.resultsEl = document.getElementById('results');
    this.resultsShown = false;

    this.overlayEl.addEventListener('click', onPlayClick);

    weapons.on('fire', () => this._refreshAmmo());
    weapons.on('reload', () => this._refreshAmmo());
    weapons.on('hit', () => this._flashCrosshair());
    player.on('damage', () => this._flashVignette());

    this._refreshAmmo();
  }

  _refreshAmmo() {
    this.ammoTextEl.textContent = `Ammo: ${this.weapons.ammo} / ${this.weapons.maxAmmo}`;
    this.ammoBarEl.style.width = `${(this.weapons.ammo / this.weapons.maxAmmo) * 100}%`;
  }

  _flashCrosshair() {
    this.crosshairEl.classList.add('hit');
    setTimeout(() => this.crosshairEl.classList.remove('hit'), 100);
  }

  _flashVignette() {
    this.vignetteEl.classList.add('flash');
    // Force a reflow so the instant (transition: none) opacity:1 state is
    // committed before removing the class re-enables the fade-out transition
    // - otherwise both class changes can collapse into one frame and the
    // flash never paints.
    void this.vignetteEl.offsetWidth;
    this.vignetteEl.classList.remove('flash');
  }

  update(timeLeft, matchOver) {
    this.healthTextEl.textContent = `Health: ${Math.ceil(this.player.health)}`;
    this.healthBarEl.style.width = `${(this.player.health / 100) * 100}%`;
    this.overlayEl.hidden = this.player.isLocked;
    this.crosshairEl.hidden = !this.player.isLocked;

    const kills = this.weapons.kills;
    const deaths = this.player.deaths;
    this.timerEl.textContent = `Time: ${this._formatTime(timeLeft)}`;
    this.kdEl.textContent = `Kills: ${kills}  Deaths: ${deaths}  K/D: ${this._formatKD(kills, deaths)}`;

    if (matchOver && !this.resultsShown) {
      this.resultsShown = true;
      this.resultsEl.textContent = `Results\nKills: ${kills}\nDeaths: ${deaths}\nK/D: ${this._formatKD(kills, deaths)}`;
      this.resultsEl.hidden = false;
    }
  }

  _formatTime(seconds) {
    const total = Math.ceil(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  _formatKD(kills, deaths) {
    return (deaths === 0 ? kills : kills / deaths).toFixed(2);
  }
}
