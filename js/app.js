/* Workomax – UI controller. */
(function () {
  'use strict';
  const U = WX.util, E = WX.engine, D = WX.defaults, S = WX.store, H = WX.holidays;
  const { esc } = U;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  let state = S.load();
  let res = null;

  const plan = () => state.plans[state.activeId];
  const fmt = () => state.prefs.fmt;
  const scopeObj = (scope) => (scope === 'prefs' ? state.prefs : scope === 'today' ? state.today : plan());
  const fh = (h, o) => U.fmtHours(h, fmt(), o);
  const fm = (m, o) => U.fmtMin(m, fmt(), o);
  const toMin = E.toMin;

  /* ============================== helpers ============================== */
  function toast(msg, opts = {}) {
    const el = document.createElement('div');
    el.className = 'toast ' + (opts.type || '');
    el.innerHTML = `<span>${msg}</span>`;
    if (opts.action) {
      const b = document.createElement('button');
      b.className = 'btn small ghost';
      b.textContent = opts.action.label;
      b.onclick = () => { opts.action.fn(); el.remove(); };
      el.appendChild(b);
    }
    $('#toasts').appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, opts.ms || 4200);
  }

  function ask({ title, text = '', input = null, ok = 'OK', danger = false }) {
    const dlg = $('#askDialog');
    $('#askTitle').textContent = title;
    $('#askText').textContent = text;
    const inp = $('#askInput');
    inp.hidden = input === null;
    inp.value = input ?? '';
    const okBtn = $('#askOk');
    okBtn.textContent = ok;
    okBtn.classList.toggle('danger', danger);
    dlg.returnValue = '';
    dlg.showModal();
    if (input !== null) setTimeout(() => { inp.focus(); inp.select(); }, 30);
    return new Promise((resolve) => {
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' ? (input !== null ? inp.value.trim() : true) : null), { once: true });
    });
  }

  function commit() {
    plan().updatedAt = new Date().toISOString();
    S.save(state);
    schedule();
  }
  let raf = 0;
  function schedule() { clearTimeout(raf); raf = setTimeout(renderAll, 0); }

  function applyTheme() {
    const t = state.prefs.theme;
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }
  const isDark = () => document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

  /* ============================== binding ============================== */
  function displayValue(el, val) {
    const k = el.dataset.kind;
    if (k === 'hours') return val === null || val === undefined || val === '' ? '' : fh(val, { sign: el.hasAttribute('data-signed') });
    return val ?? '';
  }

  function syncBound(force = false) {
    for (const el of $$('[data-bind]')) {
      const val = U.getPath(scopeObj(el.dataset.scope), el.dataset.bind);
      if (el.classList.contains('seg')) {
        for (const b of $$('button', el)) b.setAttribute('aria-pressed', String(String(b.dataset.value) === String(val)));
        continue;
      }
      if (el === document.activeElement && !force) continue;
      if (el.type === 'checkbox') el.checked = !!val;
      else el.value = displayValue(el, val);
      el.classList.remove('invalid');
    }
    // dependent UI
    const p = plan();
    const sd = $('#startDateIn');
    sd.disabled = p.situation.startMode !== 'fixed';
    if (sd.disabled && res) sd.value = U.iso(res.start);
    $('#customTargetField').hidden = state.today.targetMode !== 'custom';
    $$('#weekGrid .wk-row').forEach((r, i) => r.classList.toggle('off', !p.week[i].work));
    $('#stateHint').hidden = !(p.holidays.enabled && p.holidays.state === 'DE');
    $('#stateSel').disabled = !p.holidays.enabled;
  }

  function readEl(el) {
    const k = el.dataset.kind;
    if (k === 'bool') return { ok: true, v: el.checked };
    const raw = String(el.value).trim();
    if (k === 'hours') {
      if (raw === '') return el.hasAttribute('data-nullable') ? { ok: true, v: null } : { ok: false };
      const h = U.parseHours(raw);
      if (!Number.isFinite(h)) return { ok: false };
      if (h < 0 && !el.hasAttribute('data-signed')) return { ok: false };
      return { ok: true, v: Math.round(h * 10000) / 10000 };
    }
    if (k === 'number') {
      const n = parseFloat(raw.replace(',', '.'));
      return Number.isFinite(n) ? { ok: true, v: n } : { ok: false };
    }
    if (k === 'date') return raw ? { ok: true, v: raw } : { ok: false };
    return { ok: true, v: raw };
  }

  function setBound(scope, path, v) {
    const obj = scopeObj(scope);
    if (U.getPath(obj, path) === v) return;
    U.setPath(obj, path, v);
    if (!scope || scope === 'plan') {
      const p = plan();
      if (path.startsWith('legal.') && p.legalPreset !== 'custom') { p.legalPreset = 'custom'; buildPresets(); buildTips(); }
      if (path === 'situation.startMode' && v === 'fixed' && res) p.situation.startDate = U.iso(res.start);
      const m = path.match(/^daysOff\.(\d+)\.(from|to)$/);
      if (m) {
        const r = p.daysOff[+m[1]];
        if (r.to < r.from) { if (m[2] === 'from') r.to = r.from; else r.from = r.to; }
        if (r.from) { const inp = $(`[data-bind="daysOff.${m[1]}.${m[2] === 'from' ? 'to' : 'from'}"]`); if (inp) inp.value = m[2] === 'from' ? r.to : r.from; }
      }
      if (/^week\.\d+\.(min|max|target)$/.test(path)) sanitizeWeek(+path.split('.')[1]);
      commit();
    } else {
      if (scope === 'prefs' && path === 'theme') applyTheme();
      if (scope === 'prefs' && path === 'fmt') setTimeout(() => syncBound(true));
      S.save(state);
      schedule();
    }
  }

  function sanitizeWeek(i) {
    const w = plan().week[i];
    if (w.min > w.target) w.min = w.target;
    if (w.max < w.target) w.max = w.target;
  }

  function onField(e, final) {
    const el = e.target.closest('[data-bind]');
    if (!el || el.classList.contains('seg') || !el.matches('input,select,textarea')) return;
    const r = readEl(el);
    el.classList.toggle('invalid', !r.ok);
    if (!r.ok) return;
    setBound(el.dataset.scope, el.dataset.bind, r.v);
    if (final && el.dataset.kind === 'hours') el.value = displayValue(el, r.v);
  }
  document.addEventListener('input', (e) => { if (e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') onField(e, false); });
  document.addEventListener('change', (e) => onField(e, true));
  // Enter in a text field commits & blurs
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input.in:not([type=date]):not([type=time])') && !e.target.closest('dialog')) e.target.blur();
  });

  document.addEventListener('click', (e) => {
    const b = e.target.closest('.seg[data-bind] > button');
    if (!b) return;
    const seg = b.parentElement;
    let v = b.dataset.value;
    if (seg.dataset.kind === 'number') v = Number(v);
    setBound(seg.dataset.scope, seg.dataset.bind, v);
    syncBound();
  });

  /* ============================== structures ============================== */
  function buildWeek() {
    const p = plan();
    const prios = (sel) => [1, 2, 3, 4, 5, 6, 7].map((n) => `<option value="${n}" ${n === sel ? 'selected' : ''}>${n}</option>`).join('');
    $('#weekGrid').innerHTML = `
      <div class="wk-head"><span>Day</span><span>Work</span><span>Regular</span><span>Min</span><span>Max</span><span>Start</span><span title="Priority (1 = fill first)">Prio</span></div>
      ${p.week.map((w, i) => `
      <div class="wk-row ${w.work ? '' : 'off'}">
        <span class="wk-day">${U.WD_SHORT[i]}</span>
        <label class="switch" title="Working day"><input type="checkbox" data-bind="week.${i}.work" data-kind="bool" aria-label="${U.WD_LONG[i]} is a working day"><i></i></label>
        <input class="in hours" data-bind="week.${i}.target" data-kind="hours" inputmode="decimal" aria-label="${U.WD_LONG[i]} regular hours">
        <input class="in hours" data-bind="week.${i}.min" data-kind="hours" inputmode="decimal" aria-label="${U.WD_LONG[i]} minimum hours">
        <input class="in hours" data-bind="week.${i}.max" data-kind="hours" inputmode="decimal" aria-label="${U.WD_LONG[i]} maximum hours">
        <input class="in" type="time" data-bind="week.${i}.start" data-kind="time" aria-label="${U.WD_LONG[i]} start time">
        <select class="in" data-bind="week.${i}.priority" data-kind="number" aria-label="${U.WD_LONG[i]} priority">${prios(w.priority)}</select>
      </div>`).join('')}`;
  }

  function buildOff() {
    const p = plan();
    p.daysOff.sort((a, b) => (a.from || '').localeCompare(b.from || ''));
    $('#offList').innerHTML = p.daysOff.length
      ? p.daysOff.map((r, k) => {
        const n = r.from && r.to ? U.daysBetween(U.fromIso(r.from), U.fromIso(r.to)) + 1 : 0;
        return `<div class="off-item">
          <input class="in" type="date" data-bind="daysOff.${k}.from" data-kind="date" aria-label="From">
          <span class="muted">–</span>
          <input class="in" type="date" data-bind="daysOff.${k}.to" data-kind="date" aria-label="To">
          <input class="in label" data-bind="daysOff.${k}.label" data-kind="text" placeholder="Vacation" aria-label="Label">
          <span class="muted small nd">${n} d</span>
          <button class="btn icon ghost small" data-action="del-off" data-id="${r.id}" aria-label="Remove"><svg class="ico" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>`;
      }).join('')
      : '<p class="muted small empty">No vacation planned.</p>';
  }

  function buildTiers() {
    const p = plan();
    $('#breakTiers').innerHTML = p.legal.breaks.map((t, k) => `
      <div class="tier">
        <span>Working more than</span>
        <input class="in hours tiny" data-bind="legal.breaks.${k}.over" data-kind="hours" inputmode="decimal" aria-label="Threshold hours">
        <span>h → at least</span>
        <input class="in tiny" type="number" min="0" step="5" data-bind="legal.breaks.${k}.min" data-kind="number" aria-label="Break minutes">
        <span>min break</span>
        <button class="btn icon ghost small" data-action="del-tier" data-k="${k}" aria-label="Remove rule"><svg class="ico" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>`).join('');
  }

  function buildPresets() {
    const p = plan();
    const cards = Object.entries(D.LEGAL_PRESETS).map(([k, pr]) => `
      <button class="preset ${p.legalPreset === k ? 'active' : ''}" data-action="preset" data-k="${k}">
        <b>${esc(pr.label)}</b><small>${esc(pr.desc)}</small>
      </button>`).join('');
    $('#presetGrid').innerHTML = cards + `
      <div class="preset custom ${p.legalPreset === 'custom' ? 'active' : ''}"><b>Custom</b><small>${p.legalPreset === 'custom' ? 'Your own values are active.' : 'Change any value below.'}</small></div>`;
  }

  function buildTips() {
    const p = plan();
    const refs = (D.LEGAL_PRESETS[p.legalPreset] || D.LEGAL_PRESETS.arbzg).refs;
    for (const el of $$('[data-ref]')) el.dataset.tip = refs[el.dataset.ref] || '';
  }

  function buildStates() {
    $('#stateSel').innerHTML = H.STATES.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('');
  }

  function buildPlanMenu() {
    const items = state.order.map((id) => {
      const p = state.plans[id];
      return `<button role="menuitemradio" aria-checked="${id === state.activeId}" data-action="switch-plan" data-id="${id}">
        <b>${esc(p.name)}</b><small>Edited ${U.fmtDate(new Date(p.updatedAt))}</small></button>`;
    }).join('');
    $('#planMenu').innerHTML = `<div class="menu-label">Your plans</div>${items}<hr>
      <button role="menuitem" data-action="new-plan"><b>+ New plan</b></button>
      <button role="menuitem" data-action="dup-plan"><b>Duplicate this plan</b></button>
      <button role="menuitem" data-action="rename-plan"><b>Rename…</b></button>
      <button role="menuitem" class="danger" data-action="del-plan" ${state.order.length < 2 ? 'disabled' : ''}><b>Delete this plan</b></button>`;
    $('#planName').textContent = plan().name;
    document.title = `${plan().name} – Workomax`;
  }

  function buildAll() {
    buildWeek(); buildOff(); buildTiers(); buildPresets(); buildTips(); buildPlanMenu();
    $('#welcome').hidden = !!state.prefs.onboarded;
    renderAll();
    syncBound(true);
  }

  /* ============================== rendering ============================== */
  function renderAll() {
    const p = plan();
    try {
      res = E.compute(p);
    } catch (err) {
      console.error(err);
      $('#summary').innerHTML = `<p class="err">Something went wrong while calculating: ${esc(err.message)}</p>`;
      return;
    }
    syncBound();
    renderSummary();
    $('#chartLegend').innerHTML = WX.chart.legend(res, fmt());
    WX.chart.render($('#chart'), res, fmt());
    renderDays();
    renderHolidayList();
    renderSideSummaries();
    renderToday();
  }

  function renderSideSummaries() {
    const p = plan();
    const days = p.week.map((w, i) => (w.work ? U.WD_SHORT[i] : null)).filter(Boolean);
    const wk = p.week.reduce((s, w) => s + (w.work ? toMin(w.target) : 0), 0);
    $('#weekSummary').textContent = `${days.length} days · ${fm(wk)} h/week`;
    const st = H.STATES.find((s) => s[0] === p.holidays.state);
    $('#offSummary').textContent = `${p.daysOff.length} period${p.daysOff.length === 1 ? '' : 's'}${p.holidays.enabled ? ' · ' + (p.holidays.state === 'DE' ? 'nationwide' : st?.[0]) : ''}`;
  }

  function findEarliestEnd() {
    // How far would the end date need to move for the goal to be reachable?
    const p = U.clone(plan());
    const base = U.fromIso(p.situation.endDate);
    const test = (n) => { p.situation.endDate = U.iso(U.addDays(base, n)); return E.compute(p).reachable; };
    let hi = 7;
    while (hi <= 730 && !test(hi)) hi *= 2;
    if (hi > 730) { if (!test(730)) return null; hi = 730; }
    let lo = Math.floor(hi / 2);
    while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (test(mid)) hi = mid; else lo = mid; }
    return U.addDays(base, hi);
  }

  function renderSummary() {
    const r = res, p = plan();
    const need = r.rawNeed;
    let icon, title, sub, cls, extra = '';
    if (r.dir === 0) {
      cls = 'ok'; icon = '✓';
      title = 'You are already on target';
      sub = 'Just work your regular hours.';
    } else if (r.reachable) {
      cls = 'ok'; icon = '✓';
      title = `${fh(p.situation.target, { sign: true })} h reached on ${U.fmtDate(r.reachDate || r.end, { weekday: true })}`;
      const perDay = r.touchedDays ? r.allocated / r.touchedDays : 0;
      sub = r.dir > 0
        ? `Work <b>${fm(r.allocated)} h</b> extra in total – about <b>${fm(perDay)} h</b> more on ${r.touchedDays} day${r.touchedDays === 1 ? '' : 's'}.`
        : `Work <b>${fm(r.allocated)} h</b> less in total – about <b>${fm(perDay)} h</b> less on ${r.touchedDays} day${r.touchedDays === 1 ? '' : 's'}.`;
    } else {
      cls = 'bad'; icon = '!';
      title = `Not reachable by ${U.fmtDate(r.end, { weekday: true })}`;
      sub = `Short by <b>${fm(r.shortBy)} h</b>. The plan gets you to ${fm(r.finalBalance, { sign: true })} h.`;
      const ee = findEarliestEnd();
      extra = `<div class="suggest">
        ${ee ? `<button class="btn small primary" data-action="set-end" data-date="${U.iso(ee)}">Move end date to ${U.fmtDate(ee, { weekday: true })}</button>` : ''}
        <span class="muted small">or raise your max hours, add working days, or allow more weekly hours.</span></div>`;
    }
    const issues = r.errors + r.warns;
    const avg = r.avgCheck;
    const tiles = [
      ['Change needed', `${fm(need, { sign: true })} h`, need === 0 ? 'none' : need > 0 ? 'to build up' : 'to reduce'],
      [r.dir >= 0 ? 'Max you could add' : 'Max you could reduce', `${fm(r.roomTotal)} h`, 'within all limits'],
      ['Busiest week', r.busiest ? `${fm(r.busiest.fullTotal)} h` : '–', r.busiest ? `CW ${r.busiest.isoWeek}` : ''],
      ['Longest day', r.longest && r.longest.planned ? `${fm(r.longest.planned)} h` : '–', r.longest && r.longest.planned ? `${U.fmtDate(r.longest.date, { weekday: true, year: false })} · until ${U.fmtTime(r.longest.end)}` : ''],
    ];
    $('#summary').innerHTML = `
      <div class="hero-main ${cls}">
        <div class="hero-icon">${icon}</div>
        <div>
          <h2>${title}</h2>
          <p>${sub}</p>
          ${extra}
        </div>
      </div>
      <div class="tiles">
        ${tiles.map(([k, v, s]) => `<div class="tile"><span>${k}</span><b>${v}</b><small>${s}</small></div>`).join('')}
      </div>
      <div class="checks">
        <span class="pill ${issues ? (r.errors ? 'bad' : 'warn') : 'ok'}">
          ${issues ? `⚠ ${r.errors ? r.errors + ' legal issue' + (r.errors > 1 ? 's' : '') : ''}${r.errors && r.warns ? ', ' : ''}${r.warns ? r.warns + ' warning' + (r.warns > 1 ? 's' : '') : ''} – see marked days` : '✓ Plan respects all limits'}
        </span>
        ${avg ? `<span class="pill ${avg.ok ? 'ok' : 'bad'}" title="Averaged over ${Math.round(avg.windowWeeks)} weeks, assuming regular hours outside the plan">Ø ${fm(avg.avg)} h/week ${avg.ok ? '≤' : '>'} ${fm(avg.limit)} h</span>` : ''}
        <span class="pill neutral">${U.fmtDate(r.start, { weekday: true })} → ${U.fmtDate(r.end, { weekday: true })} · ${r.nDays} days · ${r.workDays} working</span>
      </div>`;
  }

  function statusLabel(d) {
    if (d.status === 'holiday') return { cls: 'holiday', t: d.label };
    if (d.status === 'vacation') return { cls: 'vacation', t: d.label };
    if (d.status === 'off') return { cls: 'vacation', t: d.label };
    if (d.status === 'free') return { cls: 'free', t: 'Free' };
    if (d.fixed && d.planned === 0) return { cls: 'flexi', t: 'Flexi day off' };
    return null;
  }

  function renderDays() {
    const r = res, hide = state.prefs.hideFree, today = U.todayIso();
    const maxDay = toMin(plan().legal.maxDay) || 600;
    const html = r.weeks.map((w) => {
      const first = w.days[0].date, last = w.days[w.days.length - 1].date;
      const rows = w.days.map((d) => {
        const st = statusLabel(d);
        if (hide && d.status === 'free' && !d.override) return '';
        const hasErr = d.warnings.some((x) => x.lvl === 'err'), hasWarn = d.warnings.some((x) => x.lvl === 'warn');
        const base = Math.min(d.planned, d.normal), plus = Math.max(0, d.planned - d.normal), minus = Math.max(0, d.normal - d.planned);
        const pct = (v) => ((v / maxDay) * 100).toFixed(1) + '%';
        const main = d.planned > 0 || d.status === 'work'
          ? `<span class="bar" aria-hidden="true"><i class="base" style="width:${pct(base)}"></i><i class="plus" style="width:${pct(plus)}"></i><i class="minus" style="width:${pct(minus)}"></i></span><b class="hrs">${fm(d.planned)}</b>`
          : '';
        const warn = d.warnings.length
          ? `<div class="d-warn">${d.warnings.map((x) => `<span class="${x.lvl}" ${x.ref ? `title="${esc(x.ref)}"` : ''}>${x.lvl === 'info' ? 'ℹ' : '⚠'} ${esc(x.text)}</span>`).join('')}</div>` : '';
        return `<button class="day s-${d.status} ${d.iso === today ? 'is-today' : ''} ${hasErr ? 'has-err' : hasWarn ? 'has-warn' : ''}" data-day="${d.iso}">
          <span class="d-date"><b>${U.WD_SHORT[d.wd]}</b> ${U.fmtDate(d.date, { year: false })}</span>
          <span class="d-main">${st ? `<span class="tag ${st.cls}">${esc(st.t)}</span>` : ''}${main}${d.note ? `<span class="note">${esc(d.note)}</span>` : ''}</span>
          <span class="d-time">${d.planned > 0 ? `${U.fmtTime(d.start)}–${U.fmtTime(d.end, { dayMarker: true })}<small>${d.brk ? ` · ${d.brk} min break` : ''}</small>` : ''}</span>
          <span class="d-delta ${d.delta > 0 ? 'pos' : d.delta < 0 ? 'neg' : ''}">${d.delta ? fm(d.delta, { sign: true }) : ''}</span>
          <span class="d-bal">${fm(d.balance, { sign: true })}</span>
          <span class="d-flag">${d.override ? '<svg class="ico" viewBox="0 0 24 24" aria-label="Edited"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>' : ''}</span>
          ${warn}
        </button>`;
      }).join('');
      const ww = w.warnings.length ? `<div class="w-warn">${w.warnings.map((x) => `<span class="${x.lvl}" ${x.ref ? `title="${esc(x.ref)}"` : ''}>⚠ ${esc(x.text)}</span>`).join('')}</div>` : '';
      return `<section class="week">
        <header class="week-head">
          <b>CW ${w.isoWeek}</b><span class="muted">${U.fmtDate(first, { year: false })}–${U.fmtDate(last, { year: false })}</span>
          <span class="spacer"></span>
          <span class="muted small">Week</span><b>${fm(w.fullTotal)} h</b>
          <span class="d-delta ${w.delta > 0 ? 'pos' : w.delta < 0 ? 'neg' : ''}">${w.delta ? fm(w.delta, { sign: true }) : '±0'}</span>
        </header>${ww}
        ${rows || '<p class="muted small empty">No working days.</p>'}
      </section>`;
    }).join('');
    $('#dayList').innerHTML = `<div class="day-cols"><span>Date</span><span>Hours</span><span>Time</span><span>Change</span><span>Balance</span><span></span></div>` + html;
  }

  function renderHolidayList() {
    const p = plan();
    if (!p.holidays.enabled) { $('#holList').innerHTML = ''; return; }
    const list = res.days.filter((d) => d.holiday);
    $('#holList').innerHTML = list.length
      ? `<span class="muted small">Public holidays in your plan:</span><div class="chips static">${list.map((d) => `<span title="${esc(d.holiday)}">${U.fmtDate(d.date, { weekday: true, year: false })} ${esc(d.holiday)}</span>`).join('')}</div>`
      : '<span class="muted small">No public holidays in your plan period.</span>';
  }

  /* ============================== today ============================== */
  function nowMinutes() { const n = new Date(); return n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60; }
  const hhmmNow = () => { const n = new Date(); return `${U.pad(n.getHours())}:${U.pad(n.getMinutes())}`; };

  function netFromGross(gross, gaps, p) {
    if (gross <= 0) return 0;
    const usual = toMin(p.usualBreak);
    const cands = [gross];
    const bs = new Set([0, usual]);
    for (const t of p.legal.breaks) { bs.add(+t.min || 0); bs.add(Math.max(+t.min || 0, usual)); cands.push(toMin(t.over)); }
    for (const b of bs) cands.push(gross - Math.max(0, b - gaps));
    let best = 0;
    for (const n of cands) if (n > 0 && n + Math.max(0, E.breakFor(n, p) - gaps) <= gross + 1e-6) best = Math.max(best, n);
    return best;
  }

  function ensureTodayDate() {
    const t = state.today, iso = U.todayIso();
    if (t.date !== iso) {
      const had = t.segments.length && t.date;
      t.date = iso; t.segments = []; t.booked = '';
      S.save(state);
      if (had) toast('New day – clock times were reset.');
    }
  }

  function todayCalc() {
    ensureTodayDate();
    const p = plan(), t = state.today, now = nowMinutes();
    const segs = t.segments.map((s, k) => ({ k, in: U.parseTime(s.in), out: U.parseTime(s.out) })).filter((s) => s.in != null).sort((a, b) => a.in - b.in);
    let gross = 0, closed = 0, gaps = 0, prevOut = null, open = null;
    segs.forEach((s, i) => {
      if (prevOut != null) gaps += Math.max(0, s.in - prevOut);
      let out = s.out;
      if (out == null && i < segs.length - 1) out = segs[i + 1].in;
      if (out == null) { open = s; gross += Math.max(0, now - s.in); prevOut = null; return; }
      const d = out >= s.in ? out - s.in : out + 1440 - s.in;
      gross += d; closed += d; prevOut = out;
    });
    const net = netFromGross(gross, gaps, p);
    const ctx = E.makeCtx(p, new Date(), new Date());
    const info = E.dayInfo(U.fromIso(t.date), p, ctx);
    const inPlan = res && res.days.find((d) => d.iso === t.date);
    const regular = info.normal;
    let target, targetSrc;
    if (t.targetMode === 'custom') { target = toMin(t.customTarget); targetSrc = 'custom target'; }
    else if (t.targetMode === 'plan' && inPlan) { target = inPlan.planned; targetSrc = 'your plan'; }
    else { target = regular; targetSrc = 'regular hours'; }
    const needGross = (T) => T + Math.max(0, E.breakFor(T, p) - gaps);
    const leaveAt = open ? open.in + (needGross(target) - closed) : null;
    const maxLegal = toMin(p.legal.maxDay);
    const leaveMax = open ? open.in + (needGross(maxLegal) - closed) : null;
    const firstIn = segs.length ? segs[0].in : null;
    const deducted = Math.max(0, gross - net);
    return { segs, gross, net, gaps, open, now, target, targetSrc, regular, leaveAt, leaveMax, maxLegal, firstIn, deducted, info, inPlan, p };
  }

  function renderToday() {
    const c = todayCalc(), t = state.today, p = c.p;
    $('#todayDate').textContent = U.fmtDate(U.fromIso(t.date), { weekday: true });
    const diff = c.net - c.target;
    const pct = c.target > 0 ? U.clamp((c.net / c.target) * 100, 0, 100) : (c.net > 0 ? 100 : 0);
    const overPct = c.target > 0 && c.net > c.target ? U.clamp(((c.net - c.target) / c.target) * 100, 0, 100) : 0;

    let big, sub, cls = '';
    if (!c.segs.length) {
      const start = Math.round(c.now);
      const leave = start + c.target + E.breakFor(c.target, p);
      big = 'Not clocked in yet';
      sub = c.target > 0 ? `Start now and you can leave at <b>${U.fmtTime(leave)}</b> (${fm(c.target)} h + ${E.breakFor(c.target, p)} min break).` : 'Today is not a working day in your plan.';
    } else if (c.open) {
      if (diff < 0) {
        big = `Leave at ${U.fmtTime(c.leaveAt)}`;
        sub = `${fm(-diff)} h to go for ${fm(c.target)} h (${c.targetSrc}).`;
      } else {
        cls = 'over';
        big = `+${fm(diff)} h overtime`;
        sub = `Target of ${fm(c.target)} h reached at ${U.fmtTime(c.leaveAt)}.`;
      }
    } else {
      cls = diff >= 0 ? 'over' : '';
      big = `Done: ${fm(c.net)} h`;
      sub = `${fm(diff, { sign: true })} h compared to ${fm(c.target)} h (${c.targetSrc}).`;
    }
    const maxWarn = c.open && c.now > c.leaveMax ? `<div class="alert bad">⚠ You passed the legal maximum of ${fh(p.legal.maxDay)} h – please clock out.</div>`
      : c.open && c.leaveMax - c.now < 30 ? `<div class="alert warn">The legal maximum (${fh(p.legal.maxDay)} h) is reached at ${U.fmtTime(c.leaveMax)}.</div>` : '';
    $('#todayHero').innerHTML = `
      <div class="today-top ${cls}">
        <div>
          <span class="eyebrow">${c.open ? 'Clocked in since ' + U.fmtTime(c.open.in) : c.segs.length ? 'Clocked out' : U.WD_LONG[U.wd(new Date())]}</span>
          <h2>${big}</h2>
          <p>${sub}</p>
        </div>
        <button class="btn primary big" data-action="clock">${c.open ? 'Clock out' : 'Clock in'} <small>${hhmmNow()}</small></button>
      </div>
      <div class="progress" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100">
        <i style="width:${pct}%"></i>${overPct ? `<i class="over" style="width:${overPct}%"></i>` : ''}
      </div>
      <div class="progress-lbl"><span>Worked <b>${fm(c.net)} h</b></span><span>Target <b>${fm(c.target)} h</b></span></div>
      ${maxWarn}`;

    // segments (don't rebuild while the user is typing a time)
    const segBusy = $('#segList').contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    if (segBusy) {
      $$('#segList .dur.live').forEach((el) => {
        const row = el.closest('.seg-row'), a = U.parseTime(row.querySelector('[data-f="in"]').value);
        if (a != null) el.innerHTML = `${fm(Math.max(0, c.now - a))} h <i class="dot"></i>`;
      });
    } else $('#segList').innerHTML = t.segments.length ? t.segments.map((s, k) => {
      const a = U.parseTime(s.in), b = U.parseTime(s.out);
      const dur = a != null ? (b != null ? (b >= a ? b - a : b + 1440 - a) : Math.max(0, c.now - a)) : null;
      return `<div class="seg-row">
        <input class="in" type="time" data-seg="${k}" data-f="in" value="${esc(s.in)}" aria-label="Clock in">
        <span class="muted">→</span>
        <input class="in" type="time" data-seg="${k}" data-f="out" value="${esc(s.out)}" aria-label="Clock out" ${!s.out ? 'placeholder="running"' : ''}>
        <span class="dur ${!s.out ? 'live' : ''}">${dur != null ? fm(dur) + ' h' : ''}${!s.out ? ' <i class="dot"></i>' : ''}</span>
        <button class="btn icon ghost small" data-action="del-seg" data-k="${k}" aria-label="Remove"><svg class="ico" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>`;
    }).join('') : '<p class="muted small empty">No times yet. Press “Clock in” or add your times manually.</p>';
    $$('[data-action="clock"]').forEach((b) => { if (!b.closest('#todayHero')) b.textContent = c.open ? 'Clock out' : 'Clock in'; });

    // stats
    const rows = [
      ['Regular hours today', c.regular ? `${fm(c.regular)} h` : 'day off'],
      c.inPlan ? ['Planned today', c.inPlan.planned ? `${fm(c.inPlan.planned)} h · ${U.fmtTime(c.inPlan.start)}–${U.fmtTime(c.inPlan.end)}` : 'off'] : null,
      ['Present (gross)', `${fm(c.gross)} h`],
      ['Breaks', `${Math.round(c.gaps + Math.max(0, c.deducted - 0))} min${c.deducted > 0 ? ` (${Math.round(c.deducted)} deducted)` : ''}`],
      ['Net worked', `<b>${fm(c.net)} h</b>`],
      c.open ? ['Latest legal clock-out', `${U.fmtTime(c.leaveMax)} <small class="muted">(${fh(p.legal.maxDay)} h)</small>`] : null,
      ['Effect on balance', `<b class="${c.net - c.regular >= 0 ? 'pos' : 'neg'}">${fm(c.net - c.regular, { sign: true })} h</b>`],
    ].filter(Boolean);
    $('#todayStats').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('');

    // booking
    const delta = Math.round(c.net - c.regular);
    let book = '';
    if (t.booked === t.date) {
      book = `<div class="alert ok">✓ Today was added to your balance in “${esc(p.name)}”.</div>`;
    } else if (c.segs.length) {
      book = `<button class="btn ${c.open ? '' : 'primary'} wide" data-action="book">Add ${fm(delta, { sign: true })} h to my balance</button>
        <p class="muted small">Updates “Current balance” in your plan (${fh(p.situation.balance, { sign: true })} → ${fm(toMin(p.situation.balance) + delta, { sign: true })} h) and starts the plan tomorrow.</p>`;
    }
    $('#bookBox').innerHTML = book;
  }

  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-seg]');
    if (!el) return;
    const s = state.today.segments[+el.dataset.seg];
    if (!s) return;
    s[el.dataset.f] = el.value;
    S.save(state);
    renderToday();
  });

  /* ============================== day dialog ============================== */
  let ddIso = null, ddMode = 'auto';
  const MODE_HINTS = {
    auto: 'Workomax decides the hours for this day.',
    fixed: 'This day is locked to the hours you enter – the rest of the plan adapts.',
    flexi: 'Take the day off using your flexitime balance (counts as 0 h worked).',
    off: 'Vacation, sick leave, training… credited – no effect on your balance.',
    work: 'Normally free – allow Workomax to schedule extra hours here if needed.',
  };
  function openDay(iso) {
    const d = res.days.find((x) => x.iso === iso);
    if (!d) return;
    ddIso = iso;
    const p = plan(), ov = p.overrides[iso];
    const modes = [['auto', 'Automatic'], ['fixed', 'Fixed hours']];
    if (d.regular) modes.push(['flexi', 'Flexi day off']);
    if (d.regular || ov?.type === 'off') modes.push(['off', 'Day off (credited)']);
    if (!d.regular) modes.push(['work', 'Available to work']);
    ddMode = !ov || ov.type === 'start' ? 'auto' : ov.type === 'fixed' ? (d.regular && +ov.hours === 0 ? 'flexi' : 'fixed') : ov.type;
    $('#ddTitle').textContent = U.fmtDate(d.date, { weekday: true }).replace(/^(\w+)/, (w) => U.WD_LONG[U.WD_SHORT.indexOf(w)]);
    const st = statusLabel(d);
    $('#ddSub').textContent = [st?.t, d.regular ? `Regular ${fm(d.normal)} h` : 'Not a regular working day', d.planned ? `currently ${fm(d.planned)} h` : ''].filter(Boolean).join(' · ');
    $('#ddMode').innerHTML = modes.map(([k, l]) => `<button type="button" data-mode="${k}">${l}</button>`).join('');
    $('#ddHours').value = ov?.type === 'fixed' ? fh(ov.hours) : fm(d.planned || d.normal);
    $('#ddStart').value = U.fmtTime(d.start);
    $('#ddNote').value = ov?.label || '';
    $('#ddReset').hidden = !ov;
    syncDd();
    $('#dayDialog').showModal();
  }
  function syncDd() {
    $$('#ddMode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === ddMode)));
    $('#ddModeHint').textContent = MODE_HINTS[ddMode];
    $('#ddHoursField').hidden = ddMode !== 'fixed';
    $('#ddStartField').hidden = ddMode === 'off' || ddMode === 'flexi';
    const d = res.days.find((x) => x.iso === ddIso);
    const lines = [];
    if (d && d.cap && ddMode !== 'off' && ddMode !== 'flexi') lines.push(`Max possible this day: <b>${fm(d.cap)} h</b> (law, your max, rest time & clock-out limits).`);
    if (d?.warnings.length) lines.push(...d.warnings.map((w) => `<span class="${w.lvl}">⚠ ${esc(w.text)}</span>`));
    $('#ddInfo').innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
  }
  $('#ddMode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    ddMode = b.dataset.mode; syncDd();
    if (ddMode === 'fixed') setTimeout(() => $('#ddHours').focus(), 0);
  });
  $('#ddHours').addEventListener('input', (e) => e.target.classList.toggle('invalid', !Number.isFinite(U.parseHours(e.target.value))));
  $('#ddReset').addEventListener('click', () => {
    delete plan().overrides[ddIso];
    $('#dayDialog').close('reset');
    commit(); toast('Day reset to automatic.');
  });
  $('#ddSave').addEventListener('click', saveDay);
  function saveDay() {
    const p = plan();
    const d = res.days.find((x) => x.iso === ddIso);
    const defStart = p.week[d.wd].start;
    const start = $('#ddStart').value;
    const label = $('#ddNote').value.trim();
    const ov = {};
    if (start && start !== defStart && ddMode !== 'off' && ddMode !== 'flexi') ov.start = start;
    if (label) ov.label = label;
    if (ddMode === 'fixed') {
      const h = U.parseHours($('#ddHours').value);
      if (!Number.isFinite(h) || h < 0) { toast('Please enter valid hours, e.g. 8:30 or 8.5', { type: 'bad' }); return; }
      ov.type = 'fixed'; ov.hours = Math.round(h * 10000) / 10000;
    } else if (ddMode === 'flexi') { ov.type = 'fixed'; ov.hours = 0; }
    else if (ddMode === 'off') { ov.type = 'off'; }
    else if (ddMode === 'work') { ov.type = 'work'; }
    else if (ov.start || ov.label) { ov.type = 'start'; }
    if (ov.type) p.overrides[ddIso] = ov; else delete p.overrides[ddIso];
    $('#dayDialog').close('save');
    commit();
  }
  $('#dayDialog').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveDay(); }
  });

  /* ============================== actions ============================== */
  function endPreset(k) {
    const s = res.start;
    const y = s.getFullYear(), m = s.getMonth();
    switch (k) {
      case 'w4': return U.addDays(s, 27);
      case 'm3': return U.addDays(new Date(y, m + 3, s.getDate(), 12), -1);
      case 'eom': return new Date(y, m + 1, 0, 12);
      case 'eoq': return new Date(y, Math.floor(m / 3) * 3 + 3, 0, 12);
      case 'eoy': return new Date(y, 11, 31, 12);
    }
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = S.parseImport(text);
      let firstId = null;
      for (const p of data.plans) {
        if (state.plans[p.id]) {
          const replace = await ask({ title: `“${p.name}” already exists`, text: 'Replace your saved version with the one from the file? Choose Cancel to keep both.', ok: 'Replace' });
          if (!replace) { p.id = U.uid(); p.name += ' (imported)'; }
        }
        if (!state.plans[p.id]) state.order.push(p.id);
        state.plans[p.id] = p;
        firstId = firstId || p.id;
      }
      if (data.prefs) state.prefs = U.withDefaults(data.prefs, state.prefs);
      if (firstId) state.activeId = firstId;
      S.save(state, true);
      applyTheme();
      buildAll();
      toast(`Opened ${data.plans.length === 1 ? '“' + esc(data.plans[0].name) + '”' : data.plans.length + ' plans'}.`, { type: 'ok' });
    } catch (err) {
      toast(esc(err.message), { type: 'bad', ms: 6000 });
    }
  }

  function exportCsv() {
    const dec = (m) => (m / 60).toFixed(2).replace('.', ',');
    const rows = [['Date', 'Weekday', 'Status', 'Regular (h)', 'Planned (h)', 'Planned (h:mm)', 'Break (min)', 'Start', 'End', 'Change (h)', 'Balance (h)', 'Notes']];
    for (const d of res.days) {
      const st = statusLabel(d);
      rows.push([U.fmtDate(d.date), U.WD_LONG[d.wd], st ? st.t : 'Work', dec(d.normal), dec(d.planned), U.fmtMin(d.planned), d.brk,
        d.planned ? U.fmtTime(d.start) : '', d.planned ? U.fmtTime(d.end) : '', dec(d.delta), dec(d.balance),
        [d.note, ...d.warnings.map((w) => w.text)].filter(Boolean).join(' | ')]);
    }
    const csv = '﻿' + rows.map((r) => r.map((c) => (/[;"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(';')).join('\r\n');
    U.download(`workomax-${U.slug(plan().name)}-${U.todayIso()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function closeMenus() {
    $$('.menu').forEach((m) => (m.hidden = true));
    $$('[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }
  function toggleMenu(btn, menu) {
    const open = menu.hidden;
    closeMenus();
    if (open) { if (menu.id === 'planMenu') buildPlanMenu(); menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
  }
  $('#planBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(e.currentTarget, $('#planMenu')); });
  $('#fileBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(e.currentTarget, $('#fileMenu')); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

  const ACTIONS = {
    'dismiss-welcome': () => { state.prefs.onboarded = true; S.save(state); $('#welcome').hidden = true; },
    'export-plan': () => { S.exportPlan(plan()); toast('Plan file downloaded. Open it any time via Save / Load.', { type: 'ok' }); },
    'export-all': () => S.exportAll(state),
    'export-csv': exportCsv,
    print: () => { switchView('planner'); setTimeout(() => window.print(), 50); },
    import: () => $('#importFile').click(),
    'switch-plan': (b) => { state.activeId = b.dataset.id; S.save(state); buildAll(); },
    'new-plan': async () => {
      const name = await ask({ title: 'New plan', text: 'Give your plan a name.', input: 'New plan', ok: 'Create' });
      if (!name) return;
      const base = plan();
      const p = D.defaultPlan(name);
      // keep the personal setup (week, law, company, holidays) – start with a clean goal
      Object.assign(p, U.clone({ week: base.week, usualBreak: base.usualBreak, shortDayNoBreak: base.shortDayNoBreak, holidays: base.holidays, legal: base.legal, legalPreset: base.legalPreset, company: base.company, calc: base.calc }));
      p.daysOff = [];
      p.situation.balance = base.situation.balance;
      state.plans[p.id] = p; state.order.push(p.id); state.activeId = p.id;
      S.save(state); buildAll(); toast(`Created “${esc(name)}”.`, { type: 'ok' });
    },
    'dup-plan': () => {
      const p = U.clone(plan());
      p.id = U.uid(); p.name += ' (copy)'; p.createdAt = p.updatedAt = new Date().toISOString();
      state.plans[p.id] = p; state.order.splice(state.order.indexOf(state.activeId) + 1, 0, p.id); state.activeId = p.id;
      S.save(state); buildAll(); toast('Plan duplicated.', { type: 'ok' });
    },
    'rename-plan': async () => {
      const name = await ask({ title: 'Rename plan', input: plan().name, ok: 'Rename' });
      if (!name) return;
      plan().name = name; commit(); buildPlanMenu();
    },
    'del-plan': async () => {
      if (state.order.length < 2) return;
      const p = plan();
      const ok = await ask({ title: `Delete “${p.name}”?`, text: 'This removes the plan from this browser. Download it first if you might need it again.', ok: 'Delete', danger: true });
      if (!ok) return;
      const idx = state.order.indexOf(p.id);
      delete state.plans[p.id]; state.order.splice(idx, 1);
      state.activeId = state.order[Math.max(0, idx - 1)];
      S.save(state); buildAll();
      toast(`Deleted “${esc(p.name)}”.`, {
        action: { label: 'Undo', fn: () => { state.plans[p.id] = p; state.order.splice(idx, 0, p.id); state.activeId = p.id; S.save(state); buildAll(); } },
      });
    },
    'reset-plan': async () => {
      const ok = await ask({ title: 'Reset this plan?', text: 'All settings of this plan go back to the defaults. Other plans are not affected.', ok: 'Reset', danger: true });
      if (!ok) return;
      const old = plan();
      const p = D.defaultPlan(old.name); p.id = old.id; p.daysOff = [];
      state.plans[p.id] = p; S.save(state); buildAll();
      toast('Plan reset.', { action: { label: 'Undo', fn: () => { state.plans[old.id] = old; S.save(state); buildAll(); } } });
    },
    'copy-monday': () => {
      const p = plan(), m = p.week[0];
      p.week.forEach((w, i) => { if (i && w.work) Object.assign(w, { target: m.target, min: m.min, max: m.max, start: m.start }); });
      buildWeek(); commit(); syncBound(true);
    },
    'add-off': () => {
      const p = plan();
      const from = U.iso(U.addDays(res.start, 7));
      p.daysOff.push({ id: U.uid(), from, to: from, label: 'Vacation' });
      buildOff(); commit(); syncBound(true);
      const items = $$('#offList .off-item');
      const idx = p.daysOff.findIndex((r) => r.from === from && r.label === 'Vacation');
      items[idx]?.querySelector('input')?.focus();
    },
    'del-off': (b) => {
      const p = plan();
      const i = p.daysOff.findIndex((r) => r.id === b.dataset.id);
      if (i < 0) return;
      const [r] = p.daysOff.splice(i, 1);
      buildOff(); commit(); syncBound(true);
      toast('Days off removed.', { action: { label: 'Undo', fn: () => { p.daysOff.push(r); buildOff(); commit(); syncBound(true); } } });
    },
    'add-tier': () => {
      const L = plan().legal;
      const last = L.breaks[L.breaks.length - 1];
      L.breaks.push({ over: last ? last.over + 1 : 6, min: last ? last.min + 15 : 30 });
      if (plan().legalPreset !== 'custom') { plan().legalPreset = 'custom'; buildPresets(); }
      buildTiers(); commit(); syncBound(true);
    },
    'del-tier': (b) => {
      plan().legal.breaks.splice(+b.dataset.k, 1);
      if (plan().legalPreset !== 'custom') { plan().legalPreset = 'custom'; buildPresets(); }
      buildTiers(); commit(); syncBound(true);
    },
    preset: (b) => {
      const p = plan(), old = { legal: U.clone(p.legal), preset: p.legalPreset };
      const pr = D.LEGAL_PRESETS[b.dataset.k];
      p.legal = U.clone(pr.legal); p.legalPreset = b.dataset.k;
      buildPresets(); buildTiers(); buildTips(); commit(); syncBound(true);
      toast(`Applied ${esc(pr.label)} limits.`, { action: { label: 'Undo', fn: () => { p.legal = old.legal; p.legalPreset = old.preset; buildPresets(); buildTiers(); buildTips(); commit(); syncBound(true); } } });
    },
    'set-end': (b) => { plan().situation.endDate = b.dataset.date; commit(); syncBound(true); },
    clock: () => {
      ensureTodayDate();
      const t = state.today;
      const open = t.segments.find((s) => s.in && !s.out);
      if (open) open.out = hhmmNow(); else t.segments.push({ in: hhmmNow(), out: '' });
      S.save(state); renderToday();
    },
    'add-seg': () => { ensureTodayDate(); state.today.segments.push({ in: '', out: '' }); S.save(state); renderToday(); $$('#segList input')[$$('#segList input').length - 2]?.focus(); },
    'del-seg': (b) => { state.today.segments.splice(+b.dataset.k, 1); S.save(state); renderToday(); },
    'clear-today': () => {
      const old = U.clone(state.today.segments);
      state.today.segments = []; S.save(state); renderToday();
      toast('Clock times cleared.', { action: { label: 'Undo', fn: () => { state.today.segments = old; S.save(state); renderToday(); } } });
    },
    book: () => {
      const c = todayCalc(), p = plan(), s = p.situation;
      const before = { balance: s.balance, bookedThrough: s.bookedThrough };
      const delta = Math.round(c.net - c.regular);
      s.balance = Math.round(((toMin(s.balance) + delta) / 60) * 10000) / 10000;
      s.bookedThrough = state.today.date;
      state.today.booked = state.today.date;
      commit(); syncBound(true);
      toast(`Balance is now ${fh(s.balance, { sign: true })} h.`, {
        type: 'ok',
        action: { label: 'Undo', fn: () => { Object.assign(s, before); state.today.booked = ''; commit(); syncBound(true); } },
      });
    },
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (b && ACTIONS[b.dataset.action] && !b.disabled) {
      e.preventDefault();
      closeMenus();
      ACTIONS[b.dataset.action](b);
      return;
    }
    const day = e.target.closest('[data-day]');
    if (day) openDay(day.dataset.day);
    const chip = e.target.closest('[data-end]');
    if (chip) { plan().situation.endDate = U.iso(endPreset(chip.dataset.end)); commit(); syncBound(true); }
  });

  $('#importFile').addEventListener('change', (e) => { importFile(e.target.files[0]); e.target.value = ''; });

  // drag & drop import
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; $('#dropOverlay').hidden = false; } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').hidden = true; } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('#dropOverlay').hidden = true;
    const f = e.dataTransfer?.files?.[0];
    if (f) importFile(f);
  });

  /* ============================== views & theme ============================== */
  function switchView(v) {
    if (!['planner', 'today', 'settings'].includes(v)) v = 'planner';
    $$('.view').forEach((s) => (s.hidden = s.dataset.view !== v));
    $$('.tabs [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v);
    if (v === 'planner' && res) WX.chart.render($('#chart'), res, fmt());
    if (v === 'today') renderToday();
  }
  $$('.tabs [data-view]').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
  window.addEventListener('hashchange', () => switchView(location.hash.slice(1)));

  $('#themeBtn').addEventListener('click', () => {
    state.prefs.theme = isDark() ? 'light' : 'dark';
    applyTheme(); S.save(state); syncBound();
  });

  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => res && !$('#view-planner').hidden && WX.chart.render($('#chart'), res, fmt()), 120); });

  // saved indicator
  document.addEventListener('wx:saved', () => {
    const el = $('#savedState');
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
    el.title = 'Saved in this browser at ' + new Date().toLocaleTimeString();
  });
  document.addEventListener('wx:save-failed', () => toast('Could not save in this browser (storage full or blocked). Download your plan file to be safe.', { type: 'bad', ms: 8000 }));
  window.addEventListener('beforeunload', () => S.save(state, true));
  // sync between tabs
  window.addEventListener('storage', (e) => { if (e.key === S.KEY) { state = S.load(); applyTheme(); buildAll(); } });

  // live clock for the Today view & midnight rollover for the planner
  let lastDay = U.todayIso();
  setInterval(() => {
    if (U.todayIso() !== lastDay) { lastDay = U.todayIso(); renderAll(); return; }
    if (!$('#view-today').hidden) renderToday();
  }, 1000);

  /* ============================== boot ============================== */
  applyTheme();
  buildStates();
  ensureTodayDate();
  buildAll();
  switchView(location.hash.slice(1) || 'planner');
  S.save(state);
  setTimeout(() => document.body.classList.remove('preload'), 60);
})();
