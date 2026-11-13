/* Workomax – planning engine. Pure functions: plan in, schedule out.
 * All internal values are integer minutes.
 */
(function () {
  'use strict';
  const WX = (window.WX = window.WX || {});
  const U = WX.util;
  const { fromIso, iso, addDays, wd, mondayOf, parseTime } = U;

  const toMin = (h) => Math.round((Number(h) || 0) * 60);
  const num = (v, d = 0) => (v === null || v === '' || v === undefined || Number.isNaN(+v) ? d : +v);

  /** Break (minutes) needed / taken for a given amount of net work (minutes). */
  function breakFor(workMin, plan) {
    if (workMin <= 0) return 0;
    let b = 0;
    for (const t of plan.legal.breaks || []) {
      if (workMin > toMin(t.over)) b = Math.max(b, num(t.min));
    }
    const usual = toMin(plan.usualBreak);
    if (usual > 0 && (!plan.shortDayNoBreak || b > 0)) b = Math.max(b, usual);
    return b;
  }
  /** Legally required minimum break only (no personal habit). */
  function legalBreakFor(workMin, plan) {
    let b = 0;
    for (const t of plan.legal.breaks || []) if (workMin > toMin(t.over)) b = Math.max(b, num(t.min));
    return b;
  }

  /** Largest net work that fits into a presence span (work + break). */
  function maxWorkForSpan(span, plan) {
    if (!(span > 0)) return 0;
    if (span === Infinity) return Infinity;
    const usual = toMin(plan.usualBreak);
    const cands = [];
    const bs = new Set([0, usual]);
    for (const t of plan.legal.breaks || []) { bs.add(num(t.min)); bs.add(Math.max(num(t.min), usual)); cands.push(toMin(t.over)); }
    for (const b of bs) cands.push(span - b);
    let best = 0;
    for (const h of cands) {
      if (h > 0 && h + breakFor(h, plan) <= span) best = Math.max(best, h);
    }
    return best;
  }

  function resolveStart(plan, today = U.todayIso()) {
    const s = plan.situation;
    let d;
    if (s.startMode === 'today') d = fromIso(today);
    else if (s.startMode === 'tomorrow') d = addDays(fromIso(today), 1);
    else d = fromIso(s.startDate) || fromIso(today);
    // days already booked into the balance (via the Today tab) are skipped
    const booked = fromIso(s.bookedThrough);
    if (booked && booked >= d) d = addDays(booked, 1);
    return d;
  }

  function buildOffMap(plan) {
    const map = {};
    for (const r of plan.daysOff || []) {
      const a = fromIso(r.from), b = fromIso(r.to || r.from);
      if (!a || !b) continue;
      const n = Math.min(U.daysBetween(a, b), 3660);
      for (let i = 0; i <= n; i++) map[iso(addDays(a, i))] = r.label || 'Day off';
    }
    return map;
  }

  function dayInfo(d, plan, ctx) {
    const id = iso(d), w = wd(d), cfg = plan.week[w], ov = plan.overrides?.[id];
    const holiday = ctx.hol[id] || null;
    const vac = ctx.off[id] || null;
    const regular = cfg.work && !holiday && !vac;
    let status, label = '';
    if (ov?.type === 'off') { status = 'off'; label = ov.label || 'Day off'; }
    else if (ov?.type === 'fixed' || ov?.type === 'work') status = 'work';
    else if (holiday) { status = 'holiday'; label = holiday; }
    else if (vac) { status = 'vacation'; label = vac; }
    else status = cfg.work ? 'work' : 'free';
    const normal = status === 'work' && regular ? toMin(cfg.target) : 0;
    const fixed = ov?.type === 'fixed';
    return {
      date: d, iso: id, wd: w, status, label, holiday, vacation: vac,
      regular, forced: status === 'work' && !regular,
      normal,
      fixed, fixedMin: fixed ? toMin(ov.hours) : null,
      start: parseTime(ov?.start) ?? parseTime(cfg.start) ?? 360,
      min: toMin(cfg.min), max: toMin(cfg.max), priority: num(cfg.priority, w + 1),
      note: ov?.label && ov?.type !== 'off' ? ov.label : '',
      override: ov || null,
    };
  }

  function makeCtx(plan, start, end) {
    const hol = plan.holidays?.enabled
      ? WX.holidays.holidayMap(plan.holidays.state || 'DE', start.getFullYear() - 1, end.getFullYear() + 1)
      : {};
    return { hol, off: buildOffMap(plan) };
  }

  function overlapsNight(startMin, endMin, L) {
    const ns = parseTime(L.nightStart), ne = parseTime(L.nightEnd);
    if (ns == null || ne == null) return false;
    // check across today and the following night
    if (ne < ns) return startMin < ne || endMin > ns;
    return startMin < ne && endMin > ns;
  }

  /** Distribute `need` minutes over items. */
  function allocate(items, need, dir, strategy, weekRoom, budget, g) {
    const wr = { ...weekRoom };
    let bud = budget, rem = need;
    const alloc = new Map();
    // Hand out whole rounding steps; a smaller piece is only allowed to exactly
    // fill a day up to its limit or to finish the total.
    const canGive = (it, amt) => {
      const left = it.room - (alloc.get(it.idx) || 0);
      let a = Math.min(amt, left);
      if (dir > 0) a = Math.min(a, wr[it.week], bud);
      if (a <= 0) return 0;
      if (a >= g) {
        const s = Math.floor(a / g) * g;
        return a === left || a === rem ? a : s;
      }
      return a === left || a === rem ? a : 0;
    };
    const give = (it, a) => {
      alloc.set(it.idx, (alloc.get(it.idx) || 0) + a);
      rem -= a;
      if (dir > 0) { wr[it.week] -= a; bud -= a; }
    };
    let order = items.slice();
    if (strategy === 'early') order.sort((a, b) => a.idx - b.idx);
    else if (strategy === 'late') order.sort((a, b) => b.idx - a.idx);
    else order.sort((a, b) => a.priority - b.priority || a.idx - b.idx);

    if (strategy === 'even') {
      let progress = true;
      while (rem > 0 && progress) {
        progress = false;
        for (const it of order) {
          if (rem <= 0) break;
          const a = canGive(it, Math.min(g, rem));
          if (a > 0) { give(it, a); progress = true; }
        }
      }
    } else {
      for (const it of order) {
        if (rem <= 0) break;
        const a = canGive(it, rem);
        if (a > 0) give(it, a);
      }
    }
    return { alloc, rem };
  }

  function compute(plan, todayIso = U.todayIso()) {
    const L = plan.legal, C = plan.company || {}, S = plan.situation;
    const g = Math.max(1, num(plan.calc?.granularity, 5));

    let start = resolveStart(plan, todayIso);
    let end = fromIso(S.endDate) || addDays(start, 91);
    if (end < start) end = start;
    const nDays = Math.min(U.daysBetween(start, end) + 1, 3 * 366);
    end = addDays(start, nDays - 1);
    const ctx = makeCtx(plan, start, end);

    const days = [];
    for (let i = 0; i < nDays; i++) days.push(dayInfo(addDays(start, i), plan, ctx));
    const tail = dayInfo(addDays(end, 1), plan, ctx);

    const latestEnd = parseTime(C.latestEnd);
    const nightStart = parseTime(L.nightStart);
    const capWeekMin = Math.min(num(L.maxWeek, Infinity) || Infinity, num(C.maxWeek, Infinity) || Infinity) * 60;

    // --- per-day caps
    days.forEach((d, i) => {
      d.idx = i;
      d.week = iso(mondayOf(d.date));
      if (d.status !== 'work') { d.cap = 0; return; }
      const next = days[i + 1] || tail;
      let span = Infinity;
      if (latestEnd != null) span = Math.min(span, latestEnd - d.start);
      if (L.noNight && nightStart != null) span = Math.min(span, nightStart - d.start);
      if (next.status === 'work') span = Math.min(span, 1440 + next.start - d.start - toMin(L.rest));
      d.cap = Math.max(0, Math.min(toMin(L.maxDay), d.max || Infinity, maxWorkForSpan(span, plan)));
    });

    // --- week bases (including days of the week outside the plan, assumed at their normal hours)
    const weekBase = {};
    const baseOf = (d) => (d.status !== 'work' ? 0 : d.fixed ? d.fixedMin : d.normal);
    const seenWeeks = new Set(days.map((d) => d.week));
    for (const wk of seenWeeks) {
      const mon = fromIso(wk);
      let sum = 0;
      for (let k = 0; k < 7; k++) {
        const dt = addDays(mon, k);
        const inPlan = dt >= start && dt <= end;
        const d = inPlan ? days[U.daysBetween(start, dt)] : dayInfo(dt, plan, ctx);
        sum += baseOf(d);
      }
      weekBase[wk] = sum;
    }
    const weekRoom = {};
    for (const wk of seenWeeks) weekRoom[wk] = Math.max(0, capWeekMin - weekBase[wk]);

    // --- averaging budget (§3 ArbZG: 48 h/week on average over 24 weeks / 6 months)
    let budget = Infinity, avgInfo = null;
    if (L.avgEnabled && num(L.avgWeek) > 0) {
      const planWeeks = nDays / 7;
      const windowWeeks = Math.max(num(L.avgWeeks, 24), planWeeks);
      const normalWeekly = plan.week.reduce((s, c) => s + (c.work ? toMin(c.target) : 0), 0);
      const outside = normalWeekly * (windowWeeks - planWeeks);
      const basePlan = days.reduce((s, d) => s + baseOf(d), 0);
      const limit = toMin(L.avgWeek) * windowWeeks;
      budget = Math.max(0, limit - outside - basePlan);
      avgInfo = { windowWeeks, normalWeekly, outside, limit };
    }

    // --- what is needed
    const balance0 = toMin(S.balance), target = toMin(S.target);
    const fixedDelta = days.reduce((s, d) => s + (d.status === 'work' && d.fixed ? d.fixedMin - d.normal : 0), 0);
    const rawNeed = target - balance0 - fixedDelta;
    const dir = rawNeed > 0 ? 1 : rawNeed < 0 ? -1 : 0;
    const needAbs = Math.abs(rawNeed);

    const flex = days.filter((d) => d.status === 'work' && !d.fixed);
    const itemsFor = (dd) =>
      flex.map((d) => ({
        idx: d.idx, priority: d.priority, week: d.week,
        room: dd > 0 ? Math.max(0, d.cap - d.normal) : Math.max(0, d.normal - d.min),
      })).filter((it) => it.room > 0);

    const effDir = dir || 1;
    const items = itemsFor(effDir);
    const res = dir ? allocate(items, needAbs, dir, S.strategy, weekRoom, budget, g) : { alloc: new Map(), rem: 0 };
    const maxRes = allocate(items, Infinity, effDir, 'priority', weekRoom, budget, g);
    const roomTotal = [...maxRes.alloc.values()].reduce((a, b) => a + b, 0);
    const allocated = needAbs - (dir ? res.rem : 0);

    // --- materialise schedule
    let bal = balance0, balMax = balance0, reachIdx = -1;
    days.forEach((d) => {
      const a = res.alloc.get(d.idx) || 0;
      const am = maxRes.alloc.get(d.idx) || 0;
      if (d.status !== 'work') d.planned = 0;
      else if (d.fixed) d.planned = d.fixedMin;
      else d.planned = d.normal + dir * a;
      d.adjust = d.status === 'work' && !d.fixed ? dir * a : 0;
      d.delta = d.planned - d.normal;
      d.brk = d.planned > 0 ? breakFor(d.planned, plan) : 0;
      d.end = d.planned > 0 ? d.start + d.planned + d.brk : null;
      bal += d.delta;
      d.balance = bal;
      const pm = d.status !== 'work' ? 0 : d.fixed ? d.fixedMin : d.normal + effDir * am;
      balMax += pm - d.normal;
      d.balanceMax = balMax;
      if (a > 0) reachIdx = d.idx;
      d.warnings = [];
    });

    // --- checks
    const refs = (WX.defaults.LEGAL_PRESETS[plan.legalPreset] || WX.defaults.LEGAL_PRESETS.arbzg).refs;
    const law = (k) => (plan.legalPreset && plan.legalPreset !== 'custom' ? refs[k] : '');
    days.forEach((d, i) => {
      if (!(d.planned > 0)) return;
      const W = d.warnings;
      if (d.planned > toMin(L.maxDay)) W.push({ lvl: 'err', key: 'maxDay', text: `More than ${U.fmtHours(L.maxDay, 'hm')} h legal daily maximum`, ref: law('maxDay') });
      if (d.fixed && d.max && d.planned > d.max) W.push({ lvl: 'warn', text: 'Above your personal max for this weekday' });
      const next = days[i + 1];
      if (next && next.planned > 0) {
        const rest = 1440 + next.start - d.end;
        d.restAfter = rest;
        if (rest < toMin(L.rest)) W.push({ lvl: 'err', key: 'rest', text: `Only ${U.fmtMin(rest)} h rest before next day (min ${U.fmtHours(L.rest, 'hm')} h)`, ref: law('rest') });
      }
      if (latestEnd != null && d.end > latestEnd) W.push({ lvl: 'warn', text: `Ends after your latest clock-out (${C.latestEnd})` });
      if (overlapsNight(d.start, d.end, L)) {
        W.push(L.noNight
          ? { lvl: 'err', text: `Night work ${L.nightStart}–${L.nightEnd} not allowed`, ref: law('night') }
          : { lvl: 'info', text: `Touches night time (${L.nightStart}–${L.nightEnd})`, ref: law('night') });
      }
      if (L.noSunday && (d.wd === 6 || d.holiday)) W.push({ lvl: 'warn', text: d.holiday ? 'Work on a public holiday needs a legal exception' : 'Sunday work needs a legal exception', ref: law('sunday') });
      if (L.noSaturday && d.wd === 5) W.push({ lvl: 'warn', text: 'Saturday work not allowed under this preset', ref: law('saturday') });
      if (num(C.maxBalance, null) != null && C.maxBalance !== '' && d.balance > toMin(C.maxBalance)) W.push({ lvl: 'warn', text: 'Balance above your flexitime account limit' });
      if (num(C.minBalance, null) != null && C.minBalance !== '' && d.balance < toMin(C.minBalance)) W.push({ lvl: 'warn', text: 'Balance below your flexitime account limit' });
    });

    // --- weeks
    const weeks = [];
    const byWeek = new Map();
    for (const d of days) {
      if (!byWeek.has(d.week)) { const w = { key: d.week, days: [], warnings: [] }; byWeek.set(d.week, w); weeks.push(w); }
      byWeek.get(d.week).days.push(d);
    }
    for (const w of weeks) {
      w.total = w.days.reduce((s, d) => s + d.planned, 0);
      w.normal = w.days.reduce((s, d) => s + d.normal, 0);
      w.delta = w.total - w.normal;
      // full calendar week total incl. days outside the plan
      const outsideBase = weekBase[w.key] - w.days.reduce((s, d) => s + baseOf(d), 0);
      w.fullTotal = w.total + outsideBase;
      w.worked = w.days.filter((d) => d.planned > 0).length;
      w.isoWeek = U.isoWeek(fromIso(w.key));
      if (w.fullTotal > capWeekMin) w.warnings.push({ lvl: 'err', text: `Week total ${U.fmtMin(w.fullTotal)} h exceeds ${U.fmtMin(capWeekMin)} h`, ref: law('maxWeek') });
      if (num(L.maxDaysWeek, 7) < 7 && w.worked > num(L.maxDaysWeek, 7)) w.warnings.push({ lvl: 'warn', text: `${w.worked} working days (max ${L.maxDaysWeek})`, ref: law('days') });
    }

    // --- averaging check
    let avgCheck = null;
    if (avgInfo) {
      const planned = days.reduce((s, d) => s + d.planned, 0);
      const avg = (planned + avgInfo.outside) / avgInfo.windowWeeks;
      avgCheck = { avg, limit: toMin(L.avgWeek), ok: avg <= toMin(L.avgWeek) + 0.5, windowWeeks: avgInfo.windowWeeks };
    }

    const all = days.flatMap((d) => d.warnings).concat(weeks.flatMap((w) => w.warnings));
    const finalBalance = days.length ? days[days.length - 1].balance : balance0;
    const shortBy = dir ? Math.max(0, needAbs - allocated) : 0;
    const workDays = days.filter((d) => d.planned > 0).length;
    const touched = days.filter((d) => d.adjust !== 0);
    const busiest = weeks.reduce((m, w) => (!m || w.fullTotal > m.fullTotal ? w : m), null);
    const longest = days.reduce((m, d) => (!m || d.planned > m.planned ? d : m), null);

    return {
      start, end, nDays, days, weeks, g,
      balance0, target, rawNeed, dir, needAbs, allocated, shortBy,
      reachable: dir === 0 || shortBy <= 0,
      reachDate: reachIdx >= 0 ? days[reachIdx].date : null,
      finalBalance, roomTotal,
      maxEndBalance: days.length ? days[days.length - 1].balanceMax : balance0,
      workDays, touchedDays: touched.length,
      avgAdjust: touched.length ? allocated / touched.length : 0,
      busiest, longest, avgCheck,
      errors: all.filter((w) => w.lvl === 'err').length,
      warns: all.filter((w) => w.lvl === 'warn').length,
      ctx,
    };
  }

  WX.engine = { compute, breakFor, legalBreakFor, maxWorkForSpan, resolveStart, dayInfo, makeCtx, toMin };
})();
