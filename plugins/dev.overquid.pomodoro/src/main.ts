import { connect, type Json } from '@overquid/sdk';
import {
  format,
  parseTimer,
  pause,
  remaining,
  reset,
  running,
  skip,
  start,
  tick,
  type Phase,
  type Timer,
} from './timer';
import './style.css';

const KEY = 'timer';
const overquid = connect();

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Pomodoro: ${selector} is missing`);
  return found;
}

const phaseLabel = element<HTMLElement>('#phase');
const time = element<HTMLTimeElement>('#time');
const toggle = element<HTMLButtonElement>('#toggle');

const LABELS: Record<Phase, string> = { work: 'Focus', break: 'Break', 'long-break': 'Long break' };
const ENDED: Record<Phase, { title: string; body: string }> = {
  work: { title: 'Time for a break', body: 'Focus session done. Step away for a few minutes.' },
  break: { title: 'Back to work', body: 'Break over: next focus session started.' },
  'long-break': { title: 'Back to work', body: 'Long break over: next focus session started.' },
};

let timer: Timer = parseTimer(await overquid.storage.get(KEY));

function save() {
  overquid.storage
    .set(KEY, timer as unknown as Json)
    .catch((error: unknown) => console.error('Pomodoro:', error));
}

function update(next: Timer) {
  timer = next;
  save();
  render();
}

function render() {
  phaseLabel.textContent = `${LABELS[timer.phase]} · ${timer.completed} done`;
  phaseLabel.dataset.phase = timer.phase;
  time.textContent = format(remaining(timer, Date.now()));
  toggle.textContent = running(timer) ? 'Pause' : 'Start';
}

// Keeps running while the panel is hidden: the end of a phase is announced
// by a notification.
window.setInterval(() => {
  const { timer: next, ended } = tick(timer, Date.now());
  if (ended) {
    update(next);
    overquid.notify(ENDED[ended]).catch((error: unknown) => console.error('Pomodoro:', error));
  } else {
    render();
  }
}, 250);

toggle.addEventListener('click', () =>
  update(running(timer) ? pause(timer, Date.now()) : start(timer, Date.now())),
);
element<HTMLButtonElement>('#reset').addEventListener('click', () => update(reset(timer)));
element<HTMLButtonElement>('#skip').addEventListener('click', () => update(skip(timer)));

render();
