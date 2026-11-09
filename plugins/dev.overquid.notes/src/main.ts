import { connect, type OverquidClient } from '@overquid/sdk';
import './style.css';

const KEY = 'note';
/** Typing pauses this long before the note is saved. */
const SAVE_DELAY = 400;

const overquid: OverquidClient = connect();
function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Notes: ${selector} is missing`);
  return found;
}

const note = element<HTMLTextAreaElement>('#note');
const status = element<HTMLElement>('#status');

let timer: number | undefined;
let saved = '';

async function save() {
  window.clearTimeout(timer);
  timer = undefined;
  const text = note.value;
  if (text === saved) return;
  try {
    await overquid.storage.set(KEY, text);
    saved = text;
    status.textContent = 'Saved';
  } catch (error) {
    status.textContent = 'Not saved';
    console.error('Notes:', error);
  }
}

note.addEventListener('input', () => {
  status.textContent = '';
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void save(), SAVE_DELAY);
});
// Hiding the overlay must not lose what was just typed.
overquid.onHide(() => void save());

const stored = await overquid.storage.get<string>(KEY);
saved = typeof stored === 'string' ? stored : '';
note.value = saved;
