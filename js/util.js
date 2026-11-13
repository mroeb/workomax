/* Workomax – small helpers (time, dates, formatting). Plain script, attaches to window.WX */
(function () {
  'use strict';
  const WX = (window.WX = window.WX || {});

  const pad = (n, l = 2) => String(n).padStart(l, '0');

  /* ---------- Dates (always local, noon-anchored to dodge DST edges) ---------- */
  function fromIso(s) {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  }
  function iso(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function addDays(d, n) {
    const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
    return r;
  }
  function todayIso() { return iso(new Date()); }
  /** 0 = Monday … 6 = Sunday */
  function wd(d) { return (d.getDay() + 6) % 7; }
  function mondayOf(d) { return addDays(d, -wd(d)); }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
  function isoWeek(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  }

  const WD_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WD_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtDate(d, opts = {}) {
    if (typeof d === 'string') d = fromIso(d);
    if (!d) return '';
    const s = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
    const y = opts.year === false ? '' : d.getFullYear();
    return (opts.weekday ? WD_SHORT[wd(d)] + ' ' : '') + s + y;
  }
  function fmtDateShort(d) {
    if (typeof d === 'string') d = fromIso(d);
    return `${d.getDate()} ${MON[d.getMonth()]}`;
  }

  /* ---------- Hours / minutes ---------- */
  /**
   * Parse a duration typed by a human. Accepts "7:42", "7.7", "7,7", "-1:30", "1h30", "45m", "90min".
   * Returns hours (float) or NaN.
   */
  function parseHours(input) {
    if (typeof input === 'number') return input;
    let s = String(input ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/^\+/, '');
    if (!s) return NaN;
    let neg = false;
    if (s[0] === '-' || s[0] === '−') { neg = true; s = s.slice(1); }
    let h = NaN;
    let m;
    if ((m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?h?$/))) {
      h = +m[1] + +m[2] / 60 + (m[3] ? +m[3] / 3600 : 0);
    } else if ((m = s.match(/^(\d+)h(\d{1,2})(m|min)?$/))) {
      h = +m[1] + +m[2] / 60;
    } else if ((m = s.match(/^(\d+(?:[.,]\d+)?)(m|min)$/))) {
      h = parseFloat(m[1].replace(',', '.')) / 60;
    } else if ((m = s.match(/^(\d*(?:[.,]\d+)?)h?$/)) && m[1] !== '') {
      h = parseFloat(m[1].replace(',', '.'));
    }
    return neg ? -h : h;
  }

  /** Format minutes as "h:mm" or decimal hours. */
  function fmtMin(min, fmt = 'hm', opts = {}) {
    if (min == null || Number.isNaN(min)) return '–';
    const sign = min < 0 ? '−' : opts.sign && min > 0 ? '+' : '';
    const a = Math.abs(Math.round(min));
    let body;
    if (fmt === 'dec') {
      body = String(parseFloat((a / 60).toFixed(2)));
    } else {
      body = `${Math.floor(a / 60)}:${pad(a % 60)}`;
    }
    return sign + body + (opts.unit ? ' h' : '');
  }
  const fmtHours = (h, fmt, opts) => fmtMin(h * 60, fmt, opts);

  /** Clock time "HH:MM" -> minutes since midnight. */
  function parseTime(s) {
    if (s == null || s === '') return null;
    const m = String(s).match(/^(\d{1,2})[:.]?(\d{2})?$/);
    if (!m) return null;
    const h = +m[1], mi = +(m[2] || 0);
    if (h > 24 || mi > 59) return null;
    return h * 60 + mi;
  }
  /** minutes -> "HH:MM" (wraps past midnight, adds "+1" marker when asked) */
  function fmtTime(min, opts = {}) {
    if (min == null || Number.isNaN(min)) return '–';
    const r = Math.round(min);
    const day = Math.floor(r / 1440);
    const m = ((r % 1440) + 1440) % 1440;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}` + (opts.dayMarker && day > 0 ? ` +${day}` : '');
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setPath(obj, path, val) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (o[keys[i]] == null) o[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = val;
  }
  /** Deep-merge defaults into obj (obj wins), used to upgrade older saved plans. */
  function withDefaults(obj, def) {
    if (Array.isArray(def)) return Array.isArray(obj) ? obj : clone(def);
    if (def && typeof def === 'object') {
      const out = obj && typeof obj === 'object' && !Array.isArray(obj) ? { ...obj } : {};
      for (const k of Object.keys(def)) out[k] = withDefaults(out[k], def[k]);
      return out;
    }
    return obj === undefined ? def : obj;
  }

  function download(filename, text, type = 'application/json') {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  const slug = (s) => String(s || 'plan').toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'plan';

  WX.util = {
    pad, fromIso, iso, addDays, todayIso, wd, mondayOf, daysBetween, isoWeek,
    WD_SHORT, WD_LONG, MON, fmtDate, fmtDateShort,
    parseHours, fmtMin, fmtHours, parseTime, fmtTime,
    esc, uid, clone, clamp, getPath, setPath, withDefaults, download, slug,
  };
})();
