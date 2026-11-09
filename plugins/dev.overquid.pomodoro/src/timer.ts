/**
 * Pomodoro timer: 25 minutes of work, then a 5 minute break, and a 15 minute
 * break after every fourth work session. Times are kept as an end date, not
 * a countdown, so the timer stays right while hidden or across restarts.
 */

export type Phase = 'work' | 'break' | 'long-break';

export interface Timer {
  phase: Phase;
  /** When the running phase ends (ms since epoch), or null when paused. */
  endsAt: number | null;
  /** Time left while paused (ms). */
  left: number;
  /** Work sessions completed. */
  completed: number;
}

const MINUTE = 60_000;
export const DURATIONS: Record<Phase, number> = {
  work: 25 * MINUTE,
  break: 5 * MINUTE,
  'long-break': 15 * MINUTE,
};

export const initial = (): Timer => ({
  phase: 'work',
  endsAt: null,
  left: DURATIONS.work,
  completed: 0,
});

export const running = (timer: Timer) => timer.endsAt !== null;

export const remaining = (timer: Timer, now: number) =>
  timer.endsAt === null ? timer.left : Math.max(0, timer.endsAt - now);

export const start = (timer: Timer, now: number): Timer =>
  running(timer) ? timer : { ...timer, endsAt: now + timer.left };

export const pause = (timer: Timer, now: number): Timer =>
  running(timer) ? { ...timer, endsAt: null, left: remaining(timer, now) } : timer;

/** Back to the start of the current phase, stopped. */
export const reset = (timer: Timer): Timer => ({
  ...timer,
  endsAt: null,
  left: DURATIONS[timer.phase],
});

/** The phase after `timer`'s, counting the work session just completed. */
function next(timer: Timer): Pick<Timer, 'phase' | 'completed'> {
  if (timer.phase !== 'work') return { phase: 'work', completed: timer.completed };
  const completed = timer.completed + 1;
  return { phase: completed % 4 === 0 ? 'long-break' : 'break', completed };
}

/** Skips to the next phase, stopped. */
export function skip(timer: Timer): Timer {
  const { phase, completed } = next(timer);
  return { phase, completed, endsAt: null, left: DURATIONS[phase] };
}

/**
 * Moves on once the running phase is over: the next phase starts right
 * away. Returns the phase that just ended, to announce it.
 */
export function tick(timer: Timer, now: number): { timer: Timer; ended: Phase | null } {
  if (timer.endsAt === null || now < timer.endsAt) return { timer, ended: null };
  const { phase, completed } = next(timer);
  return {
    timer: { phase, completed, endsAt: timer.endsAt + DURATIONS[phase], left: DURATIONS[phase] },
    ended: timer.phase,
  };
}

export function format(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Reads a stored timer, falling back to a fresh one. */
export function parseTimer(value: unknown): Timer {
  if (typeof value !== 'object' || value === null) return initial();
  const { phase, endsAt, left, completed } = value as Record<string, unknown>;
  const phases: Phase[] = ['work', 'break', 'long-break'];
  if (!phases.includes(phase as Phase)) return initial();
  const number = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  return {
    phase: phase as Phase,
    endsAt: number(endsAt) ? (endsAt as number) : null,
    left: number(left)
      ? Math.min(left as number, DURATIONS[phase as Phase])
      : DURATIONS[phase as Phase],
    completed: number(completed) ? Math.floor(completed as number) : 0,
  };
}
