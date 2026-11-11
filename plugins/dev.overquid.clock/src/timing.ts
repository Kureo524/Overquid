/** Stopwatch, timer and alarms, as plain values: `now` is always passed in. */

export interface Stopwatch {
  /** When it was last started; `null` while stopped. */
  startedAt: number | null;
  /** Milliseconds counted before `startedAt`. */
  elapsed: number;
  /** Elapsed time at each lap, most recent last. */
  laps: number[];
}

export const NEW_STOPWATCH: Stopwatch = { startedAt: null, elapsed: 0, laps: [] };

export const stopwatchTime = (watch: Stopwatch, now: number) =>
  watch.elapsed + (watch.startedAt === null ? 0 : now - watch.startedAt);

export const startStopwatch = (watch: Stopwatch, now: number): Stopwatch =>
  watch.startedAt === null ? { ...watch, startedAt: now } : watch;

export const stopStopwatch = (watch: Stopwatch, now: number): Stopwatch => ({
  ...watch,
  elapsed: stopwatchTime(watch, now),
  startedAt: null,
});

/** Laps are capped so a forgotten stopwatch cannot grow its save without end. */
const MAX_LAPS = 99;

export const lapStopwatch = (watch: Stopwatch, now: number): Stopwatch => ({
  ...watch,
  laps: [...watch.laps, stopwatchTime(watch, now)].slice(-MAX_LAPS),
});

export interface Countdown {
  /** When it ends, while running; `null` while paused or not started. */
  endsAt: number | null;
  /** Milliseconds left, while paused. */
  left: number;
  /** Full duration, for Reset. */
  duration: number;
}

export const newCountdown = (duration: number): Countdown => ({
  endsAt: null,
  left: duration,
  duration,
});

export const countdownLeft = (timer: Countdown, now: number) =>
  timer.endsAt === null ? timer.left : Math.max(0, timer.endsAt - now);

export const startCountdown = (timer: Countdown, now: number): Countdown =>
  timer.endsAt === null ? { ...timer, endsAt: now + timer.left } : timer;

export const pauseCountdown = (timer: Countdown, now: number): Countdown => ({
  ...timer,
  left: countdownLeft(timer, now),
  endsAt: null,
});

export const isCountdownOver = (timer: Countdown, now: number) =>
  timer.endsAt !== null && now >= timer.endsAt;

export interface Alarm {
  id: string;
  /** `HH:MM`, local time. */
  time: string;
  label: string;
  enabled: boolean;
  daily: boolean;
  /** Day (`dayKey`) it last rang: an alarm rings once a day. */
  rang?: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

export const dayKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const minuteOf = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** Enabled alarms that should ring at this minute and have not yet today. */
export function dueAlarms(alarms: Alarm[], now: Date): Alarm[] {
  const minute = minuteOf(now);
  const day = dayKey(now);
  return alarms.filter((alarm) => alarm.enabled && alarm.time === minute && alarm.rang !== day);
}

/** The alarm after ringing: one-shot alarms switch off. */
export const afterRinging = (alarm: Alarm, now: Date): Alarm => ({
  ...alarm,
  rang: dayKey(now),
  enabled: alarm.daily,
});

/** `H:MM:SS`, or `MM:SS` under an hour. Tenths for the stopwatch. */
export function formatDuration(milliseconds: number, tenths = false): string {
  const total = Math.max(0, Math.floor(milliseconds / 100));
  const seconds = Math.floor(total / 10);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const base = `${pad(minutes)}:${pad(seconds % 60)}`;
  const withHours = hours > 0 ? `${hours}:${base}` : base;
  return tenths ? `${withHours}.${total % 10}` : withHours;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function parseStopwatch(value: unknown): Stopwatch {
  if (!isRecord(value)) return NEW_STOPWATCH;
  return {
    startedAt: isNumber(value.startedAt) ? value.startedAt : null,
    elapsed: isNumber(value.elapsed) ? value.elapsed : 0,
    laps: Array.isArray(value.laps) ? value.laps.filter(isNumber) : [],
  };
}

export function parseCountdown(value: unknown, fallback: number): Countdown {
  if (!isRecord(value)) return newCountdown(fallback);
  const duration = isNumber(value.duration) ? value.duration : fallback;
  return {
    endsAt: isNumber(value.endsAt) ? value.endsAt : null,
    left: isNumber(value.left) ? value.left : duration,
    duration,
  };
}

export function parseAlarms(value: unknown): Alarm[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string') return [];
    if (typeof entry.time !== 'string' || !/^\d\d:\d\d$/.test(entry.time)) return [];
    const alarm: Alarm = {
      id: entry.id,
      time: entry.time,
      label: typeof entry.label === 'string' ? entry.label : '',
      enabled: entry.enabled === true,
      daily: entry.daily === true,
    };
    if (typeof entry.rang === 'string') alarm.rang = entry.rang;
    return [alarm];
  });
}
