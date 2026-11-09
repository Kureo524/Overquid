import { connect } from '@overquid/sdk';
import './style.css';

const overquid = connect();
const element = document.querySelector('time');
if (!element) throw new Error('<time> is missing');
const time = element;

const format = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

let timer: number | undefined;

function render() {
  const now = new Date();
  time.textContent = format.format(now);
  time.dateTime = now.toISOString();
}

/** Ticks on each new second, only while the panel is visible. */
function start() {
  stop();
  render();
  // Align on the next second so the display never lags behind the system clock.
  timer = window.setTimeout(
    () => {
      render();
      timer = window.setInterval(render, 1000);
    },
    1000 - (Date.now() % 1000),
  );
}

function stop() {
  window.clearTimeout(timer);
  window.clearInterval(timer);
  timer = undefined;
}

overquid.onShow(start);
overquid.onHide(stop);
render();
