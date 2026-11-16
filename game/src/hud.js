// The DOM HUD: crosshair, hit marker, health, ammunition, money, the round timer and
// the score, the kill feed, the buy menu and the overlay panels. It never touches the
// simulation; main.js pushes numbers in and reads the play, buy and restart callbacks out.
// Every update is cached, so a number that did not change costs no DOM write.
const COPY = {
  start: {
    title: 'DUSKLINE YARD',
    copy: 'Round-based tactical FPS. Vanguard defends two sites; Raiders plant the bomb. First to 7 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'DUSKLINE YARD',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  dead: {
    title: 'You are down',
    copy: 'Your team fights on. You return next round.',
    action: 'Spectate',
  },
  matchEnd: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud(callbacks) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const matchStats = $('match-stats');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeCount = $('grenade-count');
  const healthValue = $('health-value');
  const healthFill = $('health-fill');
  const armorFill = $('armor-fill');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const timerLabel = $('timer-label');
  const scoreVan = $('score-van');
  const scoreRai = $('score-rai');
  const roundValue = $('round-value');
  const pipsVan = $('pips-van');
  const pipsRai = $('pips-rai');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const bombStatus = $('bomb-status');
  const progress = $('progress');
  const progressLabel = $('progress-label');
  const progressFill = $('progress-fill');
  const buyMenu = $('buymenu');
  const buyMoney = $('buy-money');
  const hitmarker = $('hitmarker');
  const crosshair = $('crosshair');
  const vignette = $('damage-vignette');
  const spectate = $('spectate');

  let last = {};
  let bannerTimer = 0;
  let hitTimer = 0;

  function setText(element, value, key) {
    if (last[key] === value) return;
    last[key] = value;
    element.textContent = value;
  }

  play.addEventListener('click', () => callbacks.onPlay());
  buyMenu.querySelectorAll('[data-buy]').forEach((button) => {
    button.addEventListener('click', () => {
      const [kind, id] = button.dataset.buy.split(':');
      callbacks.onBuy(kind, id);
    });
  });
  $('deploy').addEventListener('click', () => callbacks.onDeploy());

  return {
    setHealth(health, armor) {
      setText(healthValue, String(Math.max(0, Math.ceil(health))), 'hp');
      healthFill.style.width = `${Math.max(0, health)}%`;
      healthFill.classList.toggle('low', health <= 30);
      armorFill.style.width = `${Math.max(0, armor)}%`;
    },
    setAmmo(mag, reserve, name, frag, smoke) {
      setText(ammoMag, String(mag), 'mag');
      setText(ammoReserve, `/ ${reserve}`, 'reserve');
      setText(weaponName, name, 'wname');
      setText(grenadeCount, `◉ ${frag}  ◎ ${smoke}`, 'gren');
    },
    setMoney(value) {
      setText(moneyValue, `$${value}`, 'money');
      setText(buyMoney, `$${value}`, 'buymoney');
    },
    setTimer(seconds, label) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(timerValue, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, 'timer');
      setText(timerLabel, label, 'timerlabel');
      timerValue.classList.toggle('urgent', s <= 10);
    },
    setScore(van, rai, round) {
      setText(scoreVan, String(van), 'svan');
      setText(scoreRai, String(rai), 'srai');
      setText(roundValue, `ROUND ${round}`, 'round');
    },
    setTeamCounts(van, rai) {
      const vanPips = '●'.repeat(van) + '○'.repeat(Math.max(0, 5 - van));
      const raiPips = '●'.repeat(rai) + '○'.repeat(Math.max(0, 5 - rai));
      setText(pipsVan, vanPips, 'pvan');
      setText(pipsRai, raiPips, 'prai');
    },
    setBombStatus(text) {
      setText(bombStatus, text, 'bomb');
      bombStatus.hidden = !text;
    },
    hitMarker(killed, holdMs = 110) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    setCrosshairSpread(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    damageFlash() {
      vignette.classList.add('on');
      setTimeout(() => vignette.classList.remove('on'), 180);
    },
    killFeed(killer, victim, part) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      const head = part === 'head' ? ' ⌖' : '';
      line.textContent = `${killer} ▸ ${victim}${head}`;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.lastChild.remove();
      setTimeout(() => line.remove(), 6000);
    },
    banner(titleText, subText, ms = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), ms);
    },
    // Dismiss the banner at once, instead of waiting out its timer. The staged
    // screenshots use it so a transient banner does not cover the action.
    hideBanner() {
      clearTimeout(bannerTimer);
      banner.classList.remove('on');
    },
    setProgress(label, fraction) {
      if (fraction === null) {
        progress.hidden = true;
        return;
      }
      progress.hidden = false;
      progressLabel.textContent = label;
      progressFill.style.width = `${Math.round(fraction * 100)}%`;
    },
    showBuyMenu(show) {
      buyMenu.hidden = !show;
    },
    markBuyAffordable(money) {
      buyMenu.querySelectorAll('[data-buy]').forEach((button) => {
        const price = Number(button.dataset.price || 0);
        button.classList.toggle('poor', price > money);
      });
    },
    showOverlay(mode, data = {}) {
      const text = COPY[mode];
      title.textContent = text.title;
      if (mode === 'matchEnd') {
        copy.textContent = `${data.winner === 'vanguard' ? 'Vanguard takes the match' : 'Raiders take the match'} — ${data.wins.vanguard} : ${data.wins.raiders}. Kills ${data.stats.kills}, deaths ${data.stats.deaths}.`;
        matchStats.hidden = false;
        matchStats.textContent = `Rounds: ${data.history.map((h) => (h.winner === 'vanguard' ? 'V' : 'R')).join(' ')}`;
      } else {
        copy.textContent = text.copy;
        matchStats.hidden = true;
      }
      play.textContent = text.action;
      overlay.hidden = false;
      spectate.hidden = mode !== 'dead';
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    showSpectate(show) {
      spectate.hidden = !show;
    },
  };
}
