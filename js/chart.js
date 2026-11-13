/* Workomax – dependency-free SVG line chart for the balance projection. */
(function () {
  'use strict';
  const WX = (window.WX = window.WX || {});
  const U = WX.util;

  function niceStep(range, target = 5) {
    const raw = range / target;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * pow;
  }

  function render(el, res, fmt) {
    const W = Math.max(280, el.clientWidth || 600);
    const H = W < 520 ? 210 : 260;
    const m = { l: 46, r: 14, t: 14, b: 28 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const n = res.days.length;
    if (!n) { el.innerHTML = '<p class="muted small">No days in range.</p>'; return; }

    const plan = [res.balance0, ...res.days.map((d) => d.balance)].map((v) => v / 60);
    const maxS = [res.balance0, ...res.days.map((d) => d.balanceMax)].map((v) => v / 60);
    const tgt = res.target / 60;
    let lo = Math.min(...plan, ...maxS, tgt, 0), hi = Math.max(...plan, ...maxS, tgt, 0);
    if (hi - lo < 1) { hi += 0.5; lo -= 0.5; }
    const step = niceStep(hi - lo);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;

    const x = (i) => m.l + (i / n) * iw;
    const y = (v) => m.t + ih - ((v - lo) / (hi - lo)) * ih;
    const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');

    // y grid
    let grid = '';
    for (let v = lo; v <= hi + 1e-9; v += step) {
      const yy = y(v).toFixed(1);
      grid += `<line class="${Math.abs(v) < 1e-9 ? 'zero' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
      grid += `<text class="axis" x="${m.l - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${U.fmtHours(v, fmt)}</text>`;
    }
    // x ticks
    let xt = '';
    const monthly = n > 50;
    let lastX = -1e9;
    res.days.forEach((d, i) => {
      const isTick = monthly ? d.date.getDate() === 1 : d.wd === 0;
      if (!isTick && i !== 0) return;
      const xx = x(i);
      if (xx - lastX < 44) return;
      lastX = xx;
      const lbl = monthly ? U.MON[d.date.getMonth()] + (d.date.getMonth() === 0 ? ' ' + d.date.getFullYear() : '') : U.fmtDateShort(d.date);
      xt += `<line class="tick" x1="${xx}" x2="${xx}" y1="${m.t + ih}" y2="${m.t + ih + 4}"/><text class="axis" x="${xx}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : 'middle'}">${lbl}</text>`;
    });

    // weekend / off shading
    let shade = '';
    res.days.forEach((d, i) => {
      if (d.planned === 0 && n <= 120) shade += `<rect class="offday" x="${x(i).toFixed(1)}" y="${m.t}" width="${(iw / n).toFixed(2)}" height="${ih}"/>`;
    });

    const reachI = res.reachDate ? res.days.findIndex((d) => +d.date === +res.reachDate) + 1 : -1;
    const tY = y(tgt).toFixed(1);

    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Projected balance from ${U.fmtDate(res.start)} to ${U.fmtDate(res.end)}">
        ${shade}${grid}${xt}
        <line class="target" x1="${m.l}" x2="${W - m.r}" y1="${tY}" y2="${tY}"/>
        <text class="target-lbl" x="${W - m.r - 4}" y="${+tY - 6}" text-anchor="end">Target ${U.fmtHours(tgt, fmt, { sign: true })}</text>
        <path class="s2" d="${path(maxS)}"/>
        <path class="s1" d="${path(plan)}"/>
        ${reachI > 0 ? `<circle class="reach" cx="${x(reachI)}" cy="${y(plan[reachI])}" r="5"/>` : ''}
        <g class="hover" visibility="hidden">
          <line class="cross" y1="${m.t}" y2="${m.t + ih}"/>
          <circle class="d2" r="4.5"/><circle class="d1" r="5"/>
        </g>
        <rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>
      </svg>
      <div class="tip" hidden></div>`;

    const svg = el.querySelector('svg'), hov = svg.querySelector('.hover'), tip = el.querySelector('.tip');
    const cross = hov.querySelector('.cross'), d1 = hov.querySelector('.d1'), d2 = hov.querySelector('.d2');
    const showMax = res.dir >= 0 ? 'Max possible' : 'Min possible';
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = U.clamp(Math.round(((px - m.l) / iw) * n), 1, n);
      const d = res.days[i - 1];
      const xx = x(i);
      cross.setAttribute('x1', xx); cross.setAttribute('x2', xx);
      d1.setAttribute('cx', xx); d1.setAttribute('cy', y(plan[i]));
      d2.setAttribute('cx', xx); d2.setAttribute('cy', y(maxS[i]));
      hov.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = `<b>${U.fmtDate(d.date, { weekday: true })}</b>
        <div><span class="sw s1"></span>Plan <b>${U.fmtMin(d.balance, fmt, { sign: true })}</b></div>
        <div><span class="sw s2"></span>${showMax} <b>${U.fmtMin(d.balanceMax, fmt, { sign: true })}</b></div>
        <div class="muted">${d.planned > 0 ? `Work ${U.fmtMin(d.planned, fmt)} h` : d.label || 'Not working'}</div>`;
      const left = (xx / W) * r.width;
      tip.style.left = Math.min(Math.max(left, 70), r.width - 70) + 'px';
      tip.style.top = Math.max(0, (Math.min(y(plan[i]), y(maxS[i])) / H) * r.height - 8) + 'px';
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => { hov.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  }

  function legend(res, fmt) {
    return `<span><i class="sw s1"></i>Planned balance</span>
      <span><i class="sw s2 dash"></i>${res.dir >= 0 ? 'Max possible' : 'Min possible'}</span>
      <span><i class="sw tg dash"></i>Target</span>`;
  }

  WX.chart = { render, legend };
})();
