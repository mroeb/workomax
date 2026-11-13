/* Workomax – default plan & legal presets.
 * Legal values checked against the current statutes (as of Nov 2026):
 *  - ArbZG  (Arbeitszeitgesetz)          §2(3)/(4), §3, §4, §5, §6, §9, §10
 *  - JArbSchG (Jugendarbeitsschutzgesetz) §8, §11, §13, §14, §15, §16, §17, §18
 *  - MuSchG (Mutterschutzgesetz)          §4, §5, §6
 * A reform replacing the daily by a weekly maximum (ArbZG) was only a draft
 * (Referentenentwurf, June 2026) and is NOT in force – every value stays editable.
 */
(function () {
  'use strict';
  const WX = (window.WX = window.WX || {});
  const { addDays, iso } = WX.util;

  const LEGAL_PRESETS = {
    arbzg: {
      label: 'Adults (ArbZG)',
      short: 'ArbZG',
      desc: 'Arbeitszeitgesetz – the default for employees aged 18+.',
      legal: {
        maxDay: 10,
        maxWeek: 60,
        avgEnabled: true,
        avgWeek: 48,
        avgWeeks: 24,
        breaks: [{ over: 6, min: 30 }, { over: 9, min: 45 }],
        maxContinuous: 6,
        rest: 11,
        nightStart: '23:00',
        nightEnd: '06:00',
        noNight: false,
        noSunday: true,
        noSaturday: false,
        maxDaysWeek: 6,
      },
      refs: {
        maxDay: '§3 ArbZG: 8 h per working day (Mon–Sat), extendable to 10 h.',
        maxWeek: '§3 + §9 ArbZG: 6 working days × 10 h = 60 h absolute weekly ceiling.',
        avg: '§3 ArbZG: on average no more than 8 h per working day (= 48 h/week) within 6 calendar months or 24 weeks.',
        breaks: '§4 ArbZG: 30 min if working more than 6 h, 45 min if more than 9 h. Breaks may be split into blocks of at least 15 min.',
        maxContinuous: '§4 ArbZG: never more than 6 h in a row without a break.',
        rest: '§5 ArbZG: at least 11 h uninterrupted rest after the end of the daily working time (10 h in some sectors, e.g. hospitals, hospitality, with compensation).',
        night: '§2(3) ArbZG: night time is 23:00–06:00 (bakeries 22:00–05:00). Night workers (§6): max 10 h only if 8 h average within 1 month / 4 weeks.',
        sunday: '§9 ArbZG: no work on Sundays and public holidays (00–24 h) unless an exception under §10 applies.',
        saturday: 'Saturday is a regular working day (Werktag) under the ArbZG.',
        days: '§3/§9 ArbZG: up to 6 working days (Mon–Sat).',
      },
    },
    jarbschg: {
      label: 'Minors (JArbSchG)',
      short: 'JArbSchG',
      desc: 'Jugendarbeitsschutzgesetz – employees under 18.',
      legal: {
        maxDay: 8.5,
        maxWeek: 40,
        avgEnabled: false,
        avgWeek: 40,
        avgWeeks: 1,
        breaks: [{ over: 4.5, min: 30 }, { over: 6, min: 60 }],
        maxContinuous: 4.5,
        rest: 12,
        nightStart: '20:00',
        nightEnd: '06:00',
        noNight: true,
        noSunday: true,
        noSaturday: true,
        maxDaysWeek: 5,
      },
      refs: {
        maxDay: '§8 JArbSchG: max 8 h per day; 8.5 h only if other workdays of the same week are shorter.',
        maxWeek: '§8 JArbSchG: max 40 h per week.',
        avg: 'No averaging – the weekly 40 h limit applies to every single week.',
        breaks: '§11 JArbSchG: 30 min for more than 4.5 up to 6 h, 60 min for more than 6 h; blocks of at least 15 min.',
        maxContinuous: '§11 JArbSchG: never more than 4.5 h in a row without a break.',
        rest: '§13 JArbSchG: at least 12 h uninterrupted free time after work.',
        night: '§14 JArbSchG: only between 06:00 and 20:00 (sector exceptions for 16+).',
        sunday: '§17/§18 JArbSchG: no work on Sundays and public holidays (sector exceptions).',
        saturday: '§16 JArbSchG: no work on Saturdays (sector exceptions).',
        days: '§15 JArbSchG: 5-day week.',
      },
    },
    muschg: {
      label: 'Pregnant / breastfeeding (MuSchG)',
      short: 'MuSchG',
      desc: 'Mutterschutzgesetz – note: overtime is largely prohibited.',
      legal: {
        maxDay: 8.5,
        maxWeek: 45,
        avgEnabled: false,
        avgWeek: 45,
        avgWeeks: 2,
        breaks: [{ over: 6, min: 30 }, { over: 9, min: 45 }],
        maxContinuous: 6,
        rest: 11,
        nightStart: '20:00',
        nightEnd: '06:00',
        noNight: true,
        noSunday: true,
        noSaturday: false,
        maxDaysWeek: 6,
      },
      refs: {
        maxDay: '§4(1) MuSchG: max 8.5 h per day (8 h if under 18).',
        maxWeek: '§4(1) MuSchG: max 90 h per double week (approximated here as 45 h/week). Also: not more than the contractual weekly hours on average per month – i.e. building up overtime is generally not allowed.',
        avg: 'Limits apply per double week.',
        breaks: 'Breaks per §4 ArbZG; additional breaks for breastfeeding (§7 MuSchG).',
        maxContinuous: '§4 ArbZG: never more than 6 h in a row without a break.',
        rest: '§4(2) MuSchG: at least 11 h uninterrupted rest.',
        night: '§5 MuSchG: no work between 20:00 and 06:00 (20–22 h only with official approval, §28).',
        sunday: '§6 MuSchG: no work on Sundays/public holidays unless she explicitly agrees and exceptions apply.',
        saturday: 'Saturday is a regular working day.',
        days: 'Up to 6 working days.',
      },
    },
  };

  function defaultWeek() {
    // From the Excel preset: Mon–Fri working, priority 1..7, max 10 h, min 4 h, start 06:00, target 7.7 h
    return [0, 1, 2, 3, 4, 5, 6].map((i) => ({
      work: i < 5,
      target: 7.7,
      priority: i + 1,
      min: 4,
      max: 10,
      start: '06:00',
    }));
  }

  function defaultPlan(name = 'My plan') {
    const today = new Date();
    return {
      id: WX.util.uid(),
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      situation: {
        balance: 1.85,            // h – current flexitime balance
        target: 30,               // h – balance to reach
        startMode: 'today',       // 'today' | 'tomorrow' | 'fixed'
        startDate: iso(today),
        endDate: iso(addDays(today, 91)), // 92 calendar days like the Excel preset
        strategy: 'even',         // 'even' | 'priority' | 'early' | 'late'
        bookedThrough: '',        // last day already booked into the balance (Today tab)
      },
      week: defaultWeek(),
      usualBreak: 0.75,           // h
      shortDayNoBreak: true,      // skip the usual break when the law requires none
      daysOff: [
        { id: WX.util.uid(), from: '2026-11-23', to: '2026-11-27', label: 'Vacation' },
      ],
      holidays: { enabled: true, state: 'DE' },
      overrides: {},              // iso -> { type: 'fixed'|'off'|'work', hours, start, label }
      legalPreset: 'arbzg',
      legal: WX.util.clone(LEGAL_PRESETS.arbzg.legal),
      company: {
        latestEnd: '',            // e.g. "20:00" – Gleitzeitrahmen
        maxWeek: null,            // contractual weekly cap (h)
        maxBalance: null,         // flexitime account upper limit (h)
        minBalance: null,         // flexitime account lower limit (h)
      },
      calc: { granularity: 5 },   // minutes
    };
  }

  const DEFAULT_PREFS = { theme: 'auto', fmt: 'hm', hideFree: true, onboarded: false };
  const DEFAULT_TODAY = { date: '', segments: [], targetMode: 'plan', customTarget: 7.7 };

  WX.defaults = { LEGAL_PRESETS, defaultPlan, defaultWeek, DEFAULT_PREFS, DEFAULT_TODAY };
})();
