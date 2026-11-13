/* Workomax – German public holidays (gesetzliche Feiertage) per federal state.
 * Sources: Feiertagsgesetze der Länder. Only state-wide holidays are included;
 * purely local ones (e.g. Augsburger Friedensfest, Fronleichnam in parts of SN/TH)
 * can be added as days off manually. "BY-MH" = Bavarian communities with
 * predominantly Catholic population (Mariä Himmelfahrt is a holiday there).
 */
(function () {
  'use strict';
  const WX = (window.WX = window.WX || {});
  const { iso, addDays } = WX.util;

  const STATES = [
    ['DE', 'Nationwide holidays only'],
    ['BW', 'Baden-Württemberg'],
    ['BY', 'Bayern'],
    ['BY-MH', 'Bayern (with Mariä Himmelfahrt)'],
    ['BE', 'Berlin'],
    ['BB', 'Brandenburg'],
    ['HB', 'Bremen'],
    ['HH', 'Hamburg'],
    ['HE', 'Hessen'],
    ['MV', 'Mecklenburg-Vorpommern'],
    ['NI', 'Niedersachsen'],
    ['NW', 'Nordrhein-Westfalen'],
    ['RP', 'Rheinland-Pfalz'],
    ['SL', 'Saarland'],
    ['SN', 'Sachsen'],
    ['ST', 'Sachsen-Anhalt'],
    ['SH', 'Schleswig-Holstein'],
    ['TH', 'Thüringen'],
  ];

  /** Easter Sunday (Gregorian, anonymous algorithm) */
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day, 12);
  }

  /** Buß- und Bettag: the Wednesday before 23 November */
  function bussUndBettag(y) {
    const d = new Date(y, 10, 22, 12);
    const back = (d.getDay() - 3 + 7) % 7;
    return addDays(d, -back);
  }

  const ALL = null; // marker: applies everywhere
  function rulesFor(y) {
    const E = easter(y);
    const f = (m, d) => new Date(y, m - 1, d, 12);
    return [
      [f(1, 1), 'Neujahr', ALL],
      [f(1, 6), 'Heilige Drei Könige', ['BW', 'BY', 'BY-MH', 'ST']],
      [f(3, 8), 'Internationaler Frauentag', ['BE', 'MV']],
      [addDays(E, -2), 'Karfreitag', ALL],
      [addDays(E, 0), 'Ostersonntag', ['BB']],
      [addDays(E, 1), 'Ostermontag', ALL],
      [f(5, 1), 'Tag der Arbeit', ALL],
      [addDays(E, 39), 'Christi Himmelfahrt', ALL],
      [addDays(E, 49), 'Pfingstsonntag', ['BB']],
      [addDays(E, 50), 'Pfingstmontag', ALL],
      [addDays(E, 60), 'Fronleichnam', ['BW', 'BY', 'BY-MH', 'HE', 'NW', 'RP', 'SL']],
      [f(8, 15), 'Mariä Himmelfahrt', ['SL', 'BY-MH']],
      [f(9, 20), 'Weltkindertag', ['TH']],
      [f(10, 3), 'Tag der Deutschen Einheit', ALL],
      [f(10, 31), 'Reformationstag', ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH']],
      [f(11, 1), 'Allerheiligen', ['BW', 'BY', 'BY-MH', 'NW', 'RP', 'SL']],
      [bussUndBettag(y), 'Buß- und Bettag', ['SN']],
      [f(12, 25), '1. Weihnachtstag', ALL],
      [f(12, 26), '2. Weihnachtstag', ALL],
    ];
  }

  const cache = new Map();
  /** Map iso-date -> holiday name for a state and an inclusive year range. */
  function holidayMap(state, fromYear, toYear) {
    const key = `${state}|${fromYear}|${toYear}`;
    if (cache.has(key)) return cache.get(key);
    const map = {};
    for (let y = fromYear; y <= toYear; y++) {
      for (const [date, name, states] of rulesFor(y)) {
        if (states === ALL || states.includes(state)) map[iso(date)] = name;
      }
    }
    cache.set(key, map);
    return map;
  }

  WX.holidays = { STATES, easter, holidayMap };
})();
