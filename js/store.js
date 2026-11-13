/* Workomax – persistence: localStorage autosave + file export/import. */
(function () {
  'use strict';
  const WX = (window.WX = window.WX || {});
  const U = WX.util, D = WX.defaults;
  const KEY = 'workomax.v1';
  const FILE_APP = 'workomax';
  const FILE_VERSION = 1;

  function upgradePlan(p) {
    const base = D.defaultPlan(p?.name || 'Imported plan');
    const out = U.withDefaults(p || {}, base);
    if (!Array.isArray(out.week) || out.week.length !== 7) out.week = D.defaultWeek();
    out.week = out.week.map((w, i) => U.withDefaults(w, D.defaultWeek()[i]));
    if (!Array.isArray(out.legal.breaks)) out.legal.breaks = U.clone(D.LEGAL_PRESETS.arbzg.legal.breaks);
    out.daysOff = (out.daysOff || []).map((r) => ({ id: r.id || U.uid(), from: r.from, to: r.to || r.from, label: r.label || '' }));
    if (!out.overrides || typeof out.overrides !== 'object') out.overrides = {};
    if (!out.id) out.id = U.uid();
    return out;
  }

  function fresh() {
    const p = D.defaultPlan('My plan');
    return { plans: { [p.id]: p }, order: [p.id], activeId: p.id, prefs: { ...D.DEFAULT_PREFS }, today: { ...D.DEFAULT_TODAY } };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return fresh();
      const s = JSON.parse(raw);
      const st = {
        plans: {},
        order: [],
        activeId: s.activeId,
        prefs: U.withDefaults(s.prefs, D.DEFAULT_PREFS),
        today: U.withDefaults(s.today, D.DEFAULT_TODAY),
      };
      for (const id of s.order || Object.keys(s.plans || {})) {
        if (s.plans?.[id]) { const p = upgradePlan(s.plans[id]); st.plans[p.id] = p; st.order.push(p.id); }
      }
      if (!st.order.length) return fresh();
      if (!st.plans[st.activeId]) st.activeId = st.order[0];
      return st;
    } catch (e) {
      console.warn('Workomax: could not read saved data, starting fresh.', e);
      return fresh();
    }
  }

  let timer = null;
  function save(state, immediate) {
    const write = () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
        WX.store.lastSaved = new Date();
        document.dispatchEvent(new CustomEvent('wx:saved'));
      } catch (e) {
        console.error(e);
        document.dispatchEvent(new CustomEvent('wx:save-failed', { detail: e }));
      }
    };
    clearTimeout(timer);
    if (immediate) write(); else timer = setTimeout(write, 250);
  }

  function exportPlan(plan) {
    const data = { app: FILE_APP, kind: 'plan', version: FILE_VERSION, exportedAt: new Date().toISOString(), plan };
    U.download(`workomax-${U.slug(plan.name)}-${U.todayIso()}.json`, JSON.stringify(data, null, 2));
  }
  function exportAll(state) {
    const data = {
      app: FILE_APP, kind: 'backup', version: FILE_VERSION, exportedAt: new Date().toISOString(),
      plans: state.order.map((id) => state.plans[id]), prefs: state.prefs,
    };
    U.download(`workomax-backup-${U.todayIso()}.json`, JSON.stringify(data, null, 2));
  }

  /** Parse an imported file's text. Returns { plans: [...], prefs? } or throws. */
  function parseImport(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
    if (!data || data.app !== FILE_APP) {
      // be forgiving: a bare plan object
      if (data && data.situation && data.week) return { plans: [upgradePlan(data)] };
      throw new Error('This does not look like a Workomax file.');
    }
    if (data.kind === 'plan' && data.plan) return { plans: [upgradePlan(data.plan)] };
    if (data.kind === 'backup' && Array.isArray(data.plans)) return { plans: data.plans.map(upgradePlan), prefs: data.prefs };
    throw new Error('Unknown Workomax file type.');
  }

  WX.store = { KEY, load, save, fresh, upgradePlan, exportPlan, exportAll, parseImport, lastSaved: null };
})();
