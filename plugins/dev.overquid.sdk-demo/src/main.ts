import { connect } from '@overquid/sdk';
import './style.css';

// A plugin in a few lines: lifecycle events and data kept by the core.
const overquid = connect();

const element = (id: string) => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} is missing`);
  return found;
};

let shown = 0;
const renderVisibility = () => {
  element('visibility').textContent = overquid.visible ? 'visible' : 'hidden';
  element('shown').textContent = String(shown);
};
overquid.onShow(() => {
  shown += 1;
  renderVisibility();
});
overquid.onHide(renderVisibility);

let count = (await overquid.storage.get<number>('count')) ?? 0;
element('count').textContent = String(count);
element('increment').addEventListener('click', async (event) => {
  count += 1;
  element('count').textContent = String(count);
  await overquid.storage.set('count', count);
  // Keys typed later are meant for the app underneath, not this button.
  (event.currentTarget as HTMLButtonElement).blur();
});
