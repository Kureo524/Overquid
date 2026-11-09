import { connect, type Json } from '@overquid/sdk';
import { roomUrl } from './address';
import { Connection } from './connection';
import { HINT_STATUS, PROGRESSION, TRAP, USEFUL, type NetworkItem } from './protocol';
import { LOG_SIZE, type Line, type Part, type Session } from './session';
import { parseSettings } from './settings';
import './style.css';

const KEY = 'settings';
const overquid = connect();

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Archipelago: ${selector} is missing`);
  return found;
}

const join = element<HTMLFormElement>('#join');
const server = element<HTMLInputElement>('#server');
const name = element<HTMLInputElement>('#name');
const password = element<HTMLInputElement>('#password');
const notify = element<HTMLInputElement>('#notify');
const connectButton = element<HTMLButtonElement>('#connect');
const joinError = element<HTMLElement>('#join-error');
const room = element<HTMLElement>('#room');
const status = element<HTMLElement>('#status');
const retry = element<HTMLButtonElement>('#retry');
const say = element<HTMLFormElement>('#say');
const message = element<HTMLInputElement>('#text');
const views = {
  log: element<HTMLOListElement>('#log'),
  items: element<HTMLOListElement>('#items'),
  hints: element<HTMLOListElement>('#hints'),
};
type Tab = keyof typeof views;
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')];

const STATUS = {
  connecting: 'Connecting',
  online: 'Online',
  reconnecting: 'Reconnecting',
  offline: 'Offline',
} as const;

let settings = parseSettings(await overquid.storage.get(KEY), () => crypto.randomUUID());
let connection: Connection | null = null;
let tab: Tab = 'log';
let shownItems: NetworkItem[] | null = null;
let shownHints: Session['hints'] | null = null;

function save() {
  overquid.storage
    .set(KEY, settings as unknown as Json)
    .catch((error: unknown) => console.error('Archipelago:', error));
}

function start(url: string) {
  connection?.close();
  shownItems = shownHints = null;
  views.log.replaceChildren();
  connection = new Connection(
    url,
    { name: settings.name, password: settings.password, uuid: settings.uuid },
    { change: render, received: queueNotification },
  );
  render();
}

// Items announced together when they arrive close to each other (a release,
// a friend's burst of checks): notifications are limited to 5 a minute.
let pending: NetworkItem[] = [];
let flush: ReturnType<typeof setTimeout> | undefined;
function queueNotification(items: NetworkItem[]) {
  if (!settings.notify || overquid.visible) return;
  pending.push(...items);
  clearTimeout(flush);
  flush = setTimeout(() => {
    const session = connection?.session;
    if (session && pending.length > 0) {
      overquid
        .notify(session.announce(pending))
        .catch((error: unknown) => console.warn('Archipelago:', error));
    }
    pending = [];
  }, 1500);
}

function span(text: string, className: string) {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

function itemClass(flags: number) {
  if (flags & PROGRESSION) return 'item progression';
  if (flags & TRAP) return 'item trap';
  if (flags & USEFUL) return 'item useful';
  return 'item';
}

function part({ text, kind, flags, color }: Part) {
  const node = span(text, kind === 'item' ? itemClass(flags ?? 0) : kind);
  if (color) node.dataset.color = color;
  return node;
}

function lineElement(line: Line) {
  const item = document.createElement('li');
  item.dataset.id = String(line.id);
  item.dataset.type = line.type;
  item.append(...line.parts.map(part));
  return item;
}

/** Appends new lines only, and follows them if the log was scrolled to the end. */
function renderLog(session: Session) {
  const list = views.log;
  const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
  const last = Number((list.lastElementChild as HTMLElement | null)?.dataset.id ?? 0);
  list.append(...session.log.filter((line) => line.id > last).map(lineElement));
  while (list.childElementCount > LOG_SIZE) list.firstElementChild?.remove();
  if (atEnd) list.scrollTop = list.scrollHeight;
}

function row(main: Node[], meta: string) {
  const item = document.createElement('li');
  const title = document.createElement('div');
  title.append(...main);
  item.append(title, span(meta, 'meta'));
  return item;
}

function renderItems(session: Session) {
  if (shownItems === session.items) return;
  shownItems = session.items;
  views.items.replaceChildren(
    ...[...session.items].reverse().map((item) => {
      const from =
        item.player === session.slot ? 'Your world' : `From ${session.playerName(item.player)}`;
      return row(
        [span(session.itemName(item.item, session.slot), itemClass(item.flags))],
        `${from} · ${session.locationName(item.location, item.player)}`,
      );
    }),
  );
  if (session.items.length === 0) views.items.append(row([], 'No item received yet.'));
}

function renderHints(session: Session) {
  if (shownHints === session.hints) return;
  shownHints = session.hints;
  // Hints still to find first, the receiver's priorities first among them.
  const hints = [...session.hints].sort(
    (a, b) => Number(a.found) - Number(b.found) || b.status - a.status,
  );
  views.hints.replaceChildren(
    ...hints.map((hint) => {
      const item = span(
        session.itemName(hint.item, hint.receivingPlayer),
        itemClass(hint.itemFlags),
      );
      const main: Node[] = [item];
      if (hint.receivingPlayer !== session.slot) {
        main.push(
          document.createTextNode(' for '),
          span(session.playerName(hint.receivingPlayer), 'player'),
        );
      }
      const world =
        hint.findingPlayer === session.slot
          ? 'your world'
          : `${session.playerName(hint.findingPlayer)}'s world`;
      const meta = [`${session.locationName(hint.location, hint.findingPlayer)} in ${world}`];
      if (hint.entrance) meta.push(`via ${hint.entrance}`);
      meta.push(HINT_STATUS[hint.status] ?? '');
      const node = row(main, meta.filter(Boolean).join(' · '));
      node.dataset.found = String(hint.found);
      return node;
    }),
  );
  if (hints.length === 0)
    views.hints.append(row([], 'No hint yet. Ask with !hint followed by an item name.'));
}

function render() {
  const current = connection;
  const inRoom = current !== null && current.joined;
  join.hidden = inRoom;
  room.hidden = !inRoom;
  if (!current || !inRoom) {
    const connecting = current?.status === 'connecting';
    connectButton.disabled = connecting;
    connectButton.textContent = connecting ? 'Connecting…' : 'Connect';
    joinError.textContent = current?.error ?? joinError.textContent;
    if (current?.status === 'offline') connection = null;
    return;
  }
  const session = current.session;
  element('#slot').textContent = session.playerName(session.slot);
  element('#game').textContent = session.games.get(session.slot) ?? '';
  status.textContent = STATUS[current.status];
  status.dataset.status = current.status;
  status.title = current.status === 'offline' ? current.error : '';
  retry.hidden = current.status !== 'offline';
  message.disabled = current.status !== 'online';
  element('#checks').textContent = `${session.checked.size} / ${session.locations}`;
  element('#points').textContent = String(session.hintPoints);
  element('#points').title =
    session.hintPrice > 0 ? `A hint costs ${session.hintPrice} points` : 'Hints are free';
  renderLog(session);
  if (tab === 'items') renderItems(session);
  if (tab === 'hints') renderHints(session);
}

join.addEventListener('submit', (event) => {
  event.preventDefault();
  const address = roomUrl(server.value);
  if ('error' in address) {
    joinError.textContent = address.error;
    return;
  }
  joinError.textContent = '';
  settings = {
    ...settings,
    server: server.value.trim(),
    name: name.value.trim(),
    password: password.value,
    notify: notify.checked,
    rejoin: true,
  };
  save();
  start(address.url);
});

element<HTMLButtonElement>('#leave').addEventListener('click', () => {
  connection?.close();
  connection = null;
  settings = { ...settings, rejoin: false };
  save();
  joinError.textContent = '';
  render();
});
retry.addEventListener('click', () => connection?.retry());

for (const button of tabs) {
  button.addEventListener('click', () => {
    tab = button.dataset.tab as Tab;
    for (const other of tabs) other.setAttribute('aria-selected', String(other === button));
    for (const [key, view] of Object.entries(views)) view.hidden = key !== tab;
    render();
  });
}

say.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = message.value.trim();
  if (!text || !connection) return;
  if (text.startsWith('/')) {
    // The official client's own commands: their answers are the tabs here.
    connection.session.note(
      'Server commands start with ! (!hint, !remaining…). Items and hints have their tabs.',
    );
    render();
  } else {
    connection.say(text);
  }
  message.value = '';
});

server.value = settings.server;
name.value = settings.name;
password.value = settings.password;
notify.checked = settings.notify;
const saved = roomUrl(settings.server);
if (settings.rejoin && settings.name && 'url' in saved) start(saved.url);
else render();
