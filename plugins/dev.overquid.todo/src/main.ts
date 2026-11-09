import { connect, type Json } from '@overquid/sdk';
import {
  addTask,
  clearDone,
  parseTasks,
  removeTask,
  summary,
  toggleTask,
  type Task,
} from './tasks';
import './style.css';

const KEY = 'tasks';

const overquid = connect();
function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`To-do: ${selector} is missing`);
  return found;
}

const form = element<HTMLFormElement>('#add');
const input = element<HTMLInputElement>('#text');
const list = element<HTMLUListElement>('#list');
const count = element<HTMLElement>('#count');
const clear = element<HTMLButtonElement>('#clear');

let tasks: Task[] = [];

function update(next: Task[]) {
  tasks = next;
  render();
  overquid.storage
    .set(KEY, tasks as unknown as Json)
    .catch((error: unknown) => console.error('To-do:', error));
}

function render() {
  list.replaceChildren(
    ...tasks.map((task) => {
      const item = document.createElement('li');
      item.className = task.done ? 'done' : '';
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = task.done;
      box.addEventListener('change', () => update(toggleTask(tasks, task.id)));
      const text = document.createElement('span');
      text.textContent = task.text;
      label.append(box, text);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Delete ${task.text}`);
      remove.addEventListener('click', () => update(removeTask(tasks, task.id)));
      item.append(label, remove);
      return item;
    }),
  );
  count.textContent = summary(tasks);
  clear.hidden = !tasks.some((task) => task.done);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  update(addTask(tasks, input.value, crypto.randomUUID()));
  input.value = '';
});
clear.addEventListener('click', () => update(clearDone(tasks)));

tasks = parseTasks(await overquid.storage.get(KEY));
render();
