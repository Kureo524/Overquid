import { connect } from '@overquid/sdk';
import './style.css';

const overquid = connect();
const count = document.querySelector<HTMLElement>('#count');

// Counts how many times the panel was shown, kept by Overquid between
// launches (`storage` permission in manifest.json).
overquid.onShow(async () => {
  const shown = ((await overquid.storage.get<number>('shown')) ?? 0) + 1;
  await overquid.storage.set('shown', shown);
  if (count) count.textContent = `${shown} time${shown === 1 ? '' : 's'}`;
});
