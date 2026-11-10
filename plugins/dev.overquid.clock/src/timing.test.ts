import { describe, expect, it } from 'vitest';
import {
  afterRinging,
  countdownLeft,
  dueAlarms,
  formatDuration,
  isCountdownOver,
  lapStopwatch,
  newCountdown,
  NEW_STOPWATCH,
  parseAlarms,
  parseCountdown,
  parseStopwatch,
  pauseCountdown,
  startCountdown,
  startStopwatch,
  stopStopwatch,
  stopwatchTime,
  type Alarm,
} from './timing';

describe('stopwatch', () => {
  it('counts while running and keeps its time when stopped', () => {
    const running = startStopwatch(NEW_STOPWATCH, 1000);
    expect(stopwatchTime(running, 4000)).toBe(3000);
    const stopped = stopStopwatch(running, 4000);
    expect(stopwatchTime(stopped, 9000)).toBe(3000);
    const again = startStopwatch(stopped, 10_000);
    expect(stopwatchTime(again, 11_000)).toBe(4000);
  });

  it('records laps', () => {
    const running = startStopwatch(NEW_STOPWATCH, 0);
    expect(lapStopwatch(running, 2500).laps).toEqual([2500]);
  });

  it('starting twice does not reset the start', () => {
    const running = startStopwatch(NEW_STOPWATCH, 1000);
    expect(startStopwatch(running, 5000)).toBe(running);
  });
});

describe('countdown', () => {
  it('runs, pauses and resumes', () => {
    const running = startCountdown(newCountdown(10_000), 0);
    expect(countdownLeft(running, 4000)).toBe(6000);
    const paused = pauseCountdown(running, 4000);
    expect(countdownLeft(paused, 99_000)).toBe(6000);
    expect(isCountdownOver(paused, 99_000)).toBe(false);
    const resumed = startCountdown(paused, 100_000);
    expect(countdownLeft(resumed, 103_000)).toBe(3000);
  });

  it('ends at zero, never below', () => {
    const running = startCountdown(newCountdown(1000), 0);
    expect(isCountdownOver(running, 1000)).toBe(true);
    expect(countdownLeft(running, 5000)).toBe(0);
  });
});

describe('alarms', () => {
  const at = (time: string) => new Date(`2026-11-10T${time}:30`);
  const alarm: Alarm = { id: 'a', time: '07:30', label: '', enabled: true, daily: false };

  it('rings at its minute, once a day', () => {
    expect(dueAlarms([alarm], at('07:30'))).toEqual([alarm]);
    expect(dueAlarms([alarm], at('07:31'))).toEqual([]);
    const rang = { ...alarm, rang: '2026-11-10' };
    expect(dueAlarms([rang], at('07:30'))).toEqual([]);
    expect(dueAlarms([rang], new Date('2026-11-11T07:30:00'))).toEqual([rang]);
  });

  it('ignores a disabled alarm', () => {
    expect(dueAlarms([{ ...alarm, enabled: false }], at('07:30'))).toEqual([]);
  });

  it('switches off a one-shot alarm, keeps a daily one', () => {
    expect(afterRinging(alarm, at('07:30')).enabled).toBe(false);
    const daily = afterRinging({ ...alarm, daily: true }, at('07:30'));
    expect(daily.enabled).toBe(true);
    expect(daily.rang).toBe('2026-11-10');
  });
});

describe('formatDuration', () => {
  it('shows minutes and seconds, hours when needed', () => {
    expect(formatDuration(65_000)).toBe('01:05');
    expect(formatDuration(3_665_000)).toBe('1:01:05');
    expect(formatDuration(-5)).toBe('00:00');
  });

  it('shows tenths for the stopwatch', () => {
    expect(formatDuration(1234, true)).toBe('00:01.2');
  });
});

describe('saved data', () => {
  it('survives anything malformed', () => {
    expect(parseStopwatch('x')).toEqual(NEW_STOPWATCH);
    expect(parseCountdown(null, 5000)).toEqual(newCountdown(5000));
    expect(parseAlarms([{ id: 'a' }, 3, { id: 'b', time: '7:30' }])).toEqual([]);
    expect(parseAlarms([{ id: 'a', time: '07:30', enabled: true }])).toEqual([
      { id: 'a', time: '07:30', label: '', enabled: true, daily: false },
    ]);
  });
});
