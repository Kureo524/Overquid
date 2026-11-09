/** A to-do item, as stored. */
export interface Task {
  id: string;
  text: string;
  done: boolean;
}

/** Reads stored tasks, dropping anything malformed. */
export function parseTasks(value: unknown): Task[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { id, text, done } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof text !== 'string') return [];
    return [{ id, text, done: done === true }];
  });
}

export const addTask = (tasks: Task[], text: string, id: string): Task[] => {
  const trimmed = text.trim();
  return trimmed ? [...tasks, { id, text: trimmed, done: false }] : tasks;
};

export const toggleTask = (tasks: Task[], id: string): Task[] =>
  tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task));

export const removeTask = (tasks: Task[], id: string): Task[] =>
  tasks.filter((task) => task.id !== id);

export const clearDone = (tasks: Task[]): Task[] => tasks.filter((task) => !task.done);

export function summary(tasks: Task[]): string {
  const left = tasks.filter((task) => !task.done).length;
  if (tasks.length === 0) return 'Nothing to do';
  return left === 0 ? 'All done' : `${left} left`;
}
