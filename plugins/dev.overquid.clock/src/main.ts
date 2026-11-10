import { connect, type Json } from '@overquid/sdk';
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
  type Countdown,
  type Stopwatch,
} from './timing';
import './style.css';

const overquid = connect();

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Clock: #${id} is missing`);
  return found as T;
}

const DEFAULT_TIMER = 5 * 60 * 1000;

const [savedStopwatch, savedTimer, savedAlarms] = await Promise.all([
  overquid.storage.get('stopwatch').catch(() => undefined),
  overquid.storage.get('timer').catch(() => undefined),
  overquid.storage.get('alarms').catch(() => undefined),
]);
let stopwatch: Stopwatch = parseStopwatch(savedStopwatch);
let timer: Countdown = parseCountdown(savedTimer, DEFAULT_TIMER);
let alarms: Alarm[] = parseAlarms(savedAlarms);

function save(key: string, value: unknown) {
  overquid.storage
    .set(key, value as Json)
    .catch((error: unknown) => console.error('Clock:', error));
}

// Clock tab
const time = element<HTMLTimeElement>('time');
const date = element('date');
const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });

// Ringing banner
const ringingBar = element('ringing');
const ringingText = element('ringing-text');
element('dismiss').addEventListener('click', () => {
  ringingBar.hidden = true;
});

function ring(title: string, body: string) {
  ringingText.textContent = body ? `${title}: ${body}` : title;
  ringingBar.hidden = false;
  beep();
  overquid.notify({ title, body }).catch((error: unknown) => console.error('Clock:', error));
}

/** Three short tones. Silent if the page may not play sound yet. */
function beep() {
  try {
    const audio = new AudioContext();
    [0, 0.3, 0.6].forEach((offset) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = 880;
      gain.gain.value = 0.15;
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(audio.currentTime + offset);
      oscillator.stop(audio.currentTime + offset + 0.15);
    });
  } catch (error) {
    console.error('Clock: no sound:', error);
  }
}

// Stopwatch
const swDisplay = element('stopwatch');
const swToggle = element<HTMLButtonElement>('sw-toggle');
const lapList = element('laps');

function setStopwatch(next: Stopwatch) {
  stopwatch = next;
  save('stopwatch', stopwatch);
  render();
}

swToggle.addEventListener('click', () => {
  const now = Date.now();
  setStopwatch(
    stopwatch.startedAt === null ? startStopwatch(stopwatch, now) : stopStopwatch(stopwatch, now),
  );
});
element('sw-lap').addEventListener('click', () => {
  setStopwatch(lapStopwatch(stopwatch, Date.now()));
});
element('sw-reset').addEventListener('click', () => {
  setStopwatch(NEW_STOPWATCH);
});

// Timer
const timerDisplay = element('timer');
const timerToggle = element<HTMLButtonElement>('timer-toggle');
const timerSetup = element('timer-setup');
const minutes = element<HTMLInputElement>('timer-min');
const seconds = element<HTMLInputElement>('timer-sec');

function setTimer(next: Countdown) {
  timer = next;
  save('timer', timer);
  sync();
  render();
}

const chosenDuration = () =>
  (Math.max(0, Number(minutes.value) || 0) * 60 + Math.max(0, Number(seconds.value) || 0)) * 1000;

function syncFields() {
  const total = Math.round(timer.duration / 1000);
  minutes.value = String(Math.floor(total / 60));
  seconds.value = String(total % 60);
}

timerToggle.addEventListener('click', () => {
  const now = Date.now();
  if (timer.endsAt !== null) {
    setTimer(pauseCountdown(timer, now));
    return;
  }
  // Fresh timer: use the fields. A paused one resumes.
  const fresh = timer.left === timer.duration || timer.left === 0;
  const base = fresh ? newCountdown(chosenDuration()) : timer;
  if (base.left > 0) setTimer(startCountdown(base, now));
});
element('timer-reset').addEventListener('click', () => {
  setTimer(newCountdown(chosenDuration()));
});
syncFields();

// Alarms
const alarmList = element('alarms');
const alarmsEmpty = element('alarms-empty');
const alarmTime = element<HTMLInputElement>('alarm-time');
const alarmLabel = element<HTMLInputElement>('alarm-label');

function setAlarms(next: Alarm[]) {
  alarms = next;
  save('alarms', alarms);
  sync();
  renderAlarms();
}

// Not a <form>: the plugin's sandbox forbids submitting one.
function addAlarm() {
  if (!alarmTime.value) return;
  const alarm: Alarm = {
    id: crypto.randomUUID(),
    time: alarmTime.value,
    label: alarmLabel.value.trim(),
    enabled: true,
    daily: false,
  };
  setAlarms([...alarms, alarm].sort((a, b) => a.time.localeCompare(b.time)));
  alarmLabel.value = '';
}
element('alarm-add').addEventListener('click', addAlarm);
alarmLabel.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') addAlarm();
});

function renderAlarms() {
  alarmsEmpty.hidden = alarms.length > 0;
  alarmList.replaceChildren(
    ...alarms.map((alarm) => {
      const row = document.createElement('li');
      row.className = 'alarm';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = alarm.enabled;
      toggle.title = 'On or off';
      toggle.setAttribute('aria-label', `Alarm at ${alarm.time}`);
      toggle.addEventListener('change', () => {
        setAlarms(alarms.map((a) => (a.id === alarm.id ? { ...a, enabled: toggle.checked } : a)));
      });
      const hour = document.createElement('strong');
      hour.textContent = alarm.time;
      const label = document.createElement('span');
      label.className = 'dim';
      label.textContent = alarm.label;
      const daily = document.createElement('label');
      daily.className = 'dim';
      const dailyBox = document.createElement('input');
      dailyBox.type = 'checkbox';
      dailyBox.checked = alarm.daily;
      dailyBox.addEventListener('change', () => {
        setAlarms(alarms.map((a) => (a.id === alarm.id ? { ...a, daily: dailyBox.checked } : a)));
      });
      daily.append(dailyBox, ' Daily');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        setAlarms(alarms.filter((a) => a.id !== alarm.id));
      });
      row.append(toggle, hour, label, daily, remove);
      return row;
    }),
  );
}

// Tabs
let tab = 'clock';
const tabs = document.querySelectorAll<HTMLButtonElement>('[data-tab]');
const views = document.querySelectorAll<HTMLElement>('[data-view]');
tabs.forEach((button) => {
  button.addEventListener('click', () => {
    tab = button.dataset.tab ?? 'clock';
    tabs.forEach((other) => other.setAttribute('aria-selected', String(other === button)));
    views.forEach((view) => {
      view.hidden = view.dataset.view !== tab;
    });
    render();
    button.blur();
  });
});

function render() {
  const now = new Date();
  if (tab === 'clock') {
    time.textContent = timeFormat.format(now);
    time.dateTime = now.toISOString();
    date.textContent = dateFormat.format(now);
  } else if (tab === 'stopwatch') {
    swDisplay.textContent = formatDuration(stopwatchTime(stopwatch, now.getTime()), true);
    swToggle.textContent = stopwatch.startedAt === null ? 'Start' : 'Stop';
    if (lapList.childElementCount !== stopwatch.laps.length) {
      lapList.replaceChildren(
        ...[...stopwatch.laps].reverse().map((lap) => {
          const item = document.createElement('li');
          item.textContent = formatDuration(lap, true);
          return item;
        }),
      );
    }
  } else if (tab === 'timer') {
    timerDisplay.textContent = formatDuration(countdownLeft(timer, now.getTime()));
    const running = timer.endsAt !== null;
    const paused = !running && timer.left > 0 && timer.left !== timer.duration;
    timerToggle.textContent = running ? 'Pause' : paused ? 'Resume' : 'Start';
    timerSetup.hidden = running || paused;
  }
}

/** Timers and alarms keep working while the panel is hidden. */
function check() {
  const now = new Date();
  if (isCountdownOver(timer, now.getTime())) {
    timer = newCountdown(timer.duration);
    save('timer', timer);
    ring('Timer finished', '');
    render();
  }
  const due = dueAlarms(alarms, now);
  if (due.length > 0) {
    setAlarms(
      alarms.map((alarm) =>
        due.some((ringing) => ringing.id === alarm.id) ? afterRinging(alarm, now) : alarm,
      ),
    );
    due.forEach((alarm) => ring(`Alarm ${alarm.time}`, alarm.label));
  }
}

let checking: number | undefined;

/** Only wakes up every second when something may ring. */
function sync() {
  const active = timer.endsAt !== null || alarms.some((alarm) => alarm.enabled);
  if (active && checking === undefined) {
    checking = window.setInterval(check, 1000);
  } else if (!active && checking !== undefined) {
    window.clearInterval(checking);
    checking = undefined;
  }
}

let ticking: number | undefined;

/** Redraws often enough for the stopwatch's tenths, only while visible. */
function start() {
  stop();
  render();
  ticking = window.setInterval(render, 100);
}

function stop() {
  window.clearInterval(ticking);
  ticking = undefined;
}

overquid.onShow(start);
overquid.onHide(stop);
// The panel may already have been shown while the saved data was loading.
if (overquid.visible) start();
render();
renderAlarms();
sync();
check();
