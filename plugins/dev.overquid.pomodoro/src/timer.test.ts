import { describe, expect, it } from 'vitest';
import {
  DURATIONS,
  format,
  initial,
  parseTimer,
  pause,
  remaining,
  reset,
  skip,
  start,
  tick,
} from './timer';

const MINUTE = 60_000;

describe('timer', () => {
  it('counts down from an end date, and pauses where it was', () => {
    let timer = start(initial(), 0);
    expect(remaining(timer, 10 * MINUTE)).toBe(15 * MINUTE);
    timer = pause(timer, 10 * MINUTE);
    expect(remaining(timer, 99 * MINUTE)).toBe(15 * MINUTE);
    timer = start(timer, 100 * MINUTE);
    expect(remaining(timer, 105 * MINUTE)).toBe(10 * MINUTE);
  });

  it('moves to a break when work is over, and starts it right away', () => {
    const { timer, ended } = tick(start(initial(), 0), 25 * MINUTE + 1);
    expect(ended).toBe('work');
    expect(timer.phase).toBe('break');
    expect(timer.completed).toBe(1);
    expect(remaining(timer, 26 * MINUTE)).toBe(4 * MINUTE);
    expect(tick(timer, 26 * MINUTE).ended).toBeNull();
  });

  it('takes a long break after every fourth work session', () => {
    let timer = initial();
    const phases: string[] = [];
    for (let i = 0; i < 8; i++) {
      timer = skip(timer);
      phases.push(timer.phase);
    }
    expect(phases).toEqual([
      'break',
      'work',
      'break',
      'work',
      'break',
      'work',
      'long-break',
      'work',
    ]);
    expect(timer.completed).toBe(4);
  });

  it('resets the current phase', () => {
    const timer = reset(pause(start(skip(initial()), 0), MINUTE));
    expect(timer).toMatchObject({ phase: 'break', endsAt: null, left: DURATIONS.break });
  });

  it('formats minutes and seconds, rounding up', () => {
    expect(format(25 * MINUTE)).toBe('25:00');
    expect(format(61_001)).toBe('01:02');
    expect(format(0)).toBe('00:00');
  });

  it('reads a stored timer, or starts afresh', () => {
    expect(parseTimer({ phase: 'break', endsAt: 5, left: 1000, completed: 2 })).toEqual({
      phase: 'break',
      endsAt: 5,
      left: 1000,
      completed: 2,
    });
    expect(parseTimer({ phase: 'nap' })).toEqual(initial());
    expect(parseTimer({ phase: 'work', left: 10 * 60 * MINUTE }).left).toBe(DURATIONS.work);
    expect(parseTimer(null)).toEqual(initial());
  });
});
