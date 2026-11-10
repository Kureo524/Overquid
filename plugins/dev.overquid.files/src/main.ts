import { connect, type FileEntry, type FolderListing } from '@overquid/sdk';
import { arrange, formatSize, join, type SortKey } from './view';
import './style.css';

const overquid = connect();

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Files: #${id} is missing`);
  return found as T;
}

const pathField = element<HTMLInputElement>('path');
const list = element('list');
const errorBar = element('error');
const hiddenBox = element<HTMLInputElement>('hidden');
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });

let listing: FolderListing | null = null;
let sort: SortKey = 'name';
let descending = false;
let selected: string | null = null;
/** The entry being renamed, or awaiting confirmation before going to the trash. */
let renaming: string | null = null;
let trashing: string | null = null;

function fail(error: unknown) {
  errorBar.textContent = String(error).replace(/^.*Error: /, '');
  errorBar.hidden = false;
}

async function go(path: string) {
  try {
    listing = await overquid.files.list(path);
    errorBar.hidden = true;
    selected = null;
    renaming = null;
    trashing = null;
    pathField.value = listing.path;
    render();
    overquid.storage.set('path', listing.path).catch(() => undefined);
  } catch (error) {
    fail(error);
  }
}

const refresh = () => (listing ? go(listing.path) : Promise.resolve());

function run(action: Promise<unknown>) {
  action.then(refresh).catch(fail);
}

function rowButton(label: string, onClick: () => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function nameEditor(entry: FileEntry, path: string) {
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = entry.name;
  input.spellcheck = false;
  const stop = (save: boolean) => {
    renaming = null;
    const name = input.value.trim();
    if (save && name && name !== entry.name) run(overquid.files.rename(path, name));
    else render();
  };
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('dblclick', (event) => event.stopPropagation());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') stop(true);
    if (event.key === 'Escape') stop(false);
  });
  input.addEventListener('blur', () => {
    if (renaming === entry.name) stop(false);
  });
  queueMicrotask(() => {
    input.focus();
    input.select();
  });
  return input;
}

function row(entry: FileEntry, folder: string) {
  const path = join(folder, entry.name);
  const item = document.createElement('li');
  item.className = 'row';
  item.setAttribute('aria-selected', String(selected === entry.name));

  const name = document.createElement('span');
  name.className = 'name';
  const icon = document.createElement('span');
  icon.className = entry.dir ? 'icon icon--dir' : 'icon';
  name.append(icon);
  if (renaming === entry.name) {
    name.append(nameEditor(entry, path));
  } else {
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = entry.link ? `${entry.name} →` : entry.name;
    name.append(label);
  }

  const size = document.createElement('span');
  size.className = 'dim';
  size.textContent = entry.dir ? '' : formatSize(entry.size);

  const modified = document.createElement('span');
  modified.className = 'dim';
  modified.textContent = entry.modified ? dateFormat.format(entry.modified * 1000) : '';

  item.append(name, size, modified);

  if (selected === entry.name && renaming !== entry.name) {
    const actions = document.createElement('span');
    actions.className = 'actions';
    actions.append(
      rowButton('Rename', () => {
        renaming = entry.name;
        render();
      }),
      trashing === entry.name
        ? rowButton('Really?', () => run(overquid.files.trash(path)))
        : rowButton('Trash', () => {
            trashing = entry.name;
            render();
          }),
    );
    item.append(actions);
  }

  item.addEventListener('click', () => {
    if (selected !== entry.name) trashing = null;
    selected = entry.name;
    render();
  });
  item.addEventListener('dblclick', () => {
    if (entry.dir) void go(path);
    else overquid.files.open(path).catch(fail);
  });
  return item;
}

function render() {
  if (!listing) return;
  const folder = listing.path;
  const entries = arrange(listing.entries, sort, descending, hiddenBox.checked);
  list.replaceChildren(...entries.map((entry) => row(entry, folder)));
  document.querySelectorAll<HTMLElement>('[data-sort]').forEach((header) => {
    header.setAttribute('aria-pressed', String(header.dataset.sort === sort));
  });
}

document.querySelectorAll<HTMLElement>('[data-sort]').forEach((header) => {
  header.addEventListener('click', () => {
    const key = header.dataset.sort as SortKey;
    descending = key === sort ? !descending : key !== 'name';
    sort = key;
    render();
  });
});

element('up').addEventListener('click', () => {
  if (listing?.parent) void go(listing.parent);
});
element('home').addEventListener('click', () => {
  overquid.files.home().then(go).catch(fail);
});
pathField.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void go(pathField.value);
});
hiddenBox.addEventListener('change', render);
element('new-folder').addEventListener('click', () => {
  if (!listing) return;
  const folder = listing.path;
  const existing = new Set(listing.entries.map((entry) => entry.name));
  let name = 'New folder';
  for (let number = 2; existing.has(name); number += 1) name = `New folder ${number}`;
  overquid.files
    .mkdir(folder, name)
    .then(async () => {
      await go(folder);
      selected = name;
      renaming = name;
      render();
    })
    .catch(fail);
});

const saved = await overquid.storage.get<string>('path').catch(() => undefined);
await go(saved ?? (await overquid.files.home()));
if (!listing) await overquid.files.home().then(go).catch(fail);
overquid.onShow(() => void refresh());
