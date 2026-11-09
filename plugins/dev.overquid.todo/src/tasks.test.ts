import { describe, expect, it } from 'vitest';
import { addTask, clearDone, parseTasks, removeTask, summary, toggleTask } from './tasks';

describe('tasks', () => {
  it('adds trimmed tasks and ignores blank ones', () => {
    const tasks = addTask([], '  buy milk ', 'a');
    expect(tasks).toEqual([{ id: 'a', text: 'buy milk', done: false }]);
    expect(addTask(tasks, '   ', 'b')).toBe(tasks);
  });

  it('checks, deletes and clears done tasks', () => {
    let tasks = addTask(addTask([], 'one', 'a'), 'two', 'b');
    tasks = toggleTask(tasks, 'a');
    expect(summary(tasks)).toBe('1 left');
    expect(clearDone(tasks).map((task) => task.id)).toEqual(['b']);
    expect(removeTask(tasks, 'b').map((task) => task.id)).toEqual(['a']);
    expect(summary(toggleTask(tasks, 'b'))).toBe('All done');
    expect(summary([])).toBe('Nothing to do');
  });

  it('reads stored tasks, dropping malformed ones', () => {
    expect(
      parseTasks([{ id: 'a', text: 'x', done: true }, { id: 1 }, 'nope', { id: 'b', text: 'y' }]),
    ).toEqual([
      { id: 'a', text: 'x', done: true },
      { id: 'b', text: 'y', done: false },
    ]);
    expect(parseTasks(null)).toEqual([]);
  });
});
