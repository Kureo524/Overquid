import { connect } from '@overquid/sdk';
import { ObsConnection } from './obs';
import './style.css';

const overquid = connect();

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`OBS: #${id} is missing`);
  return found as T;
}

const connectView = element('connect');
const controls = element('controls');
const status = element('status');
const portField = element<HTMLInputElement>('port');
const passwordField = element<HTMLInputElement>('password');
const connectButton = element<HTMLButtonElement>('connect-button');
const streamButton = element<HTMLButtonElement>('stream');
const recordButton = element<HTMLButtonElement>('record');
const sceneList = element('scenes');
const inputList = element('inputs');

let obs: ObsConnection | null = null;
let scene = '';
let scenes: string[] = [];
let inputs: { name: string; muted: boolean }[] = [];
let streaming = false;
let recording = false;

const report = (error: unknown) => console.error('OBS:', error);

function renderOutputs() {
  streamButton.textContent = streaming ? 'Stop stream' : 'Start stream';
  streamButton.setAttribute('aria-pressed', String(streaming));
  recordButton.textContent = recording ? 'Stop recording' : 'Record';
  recordButton.setAttribute('aria-pressed', String(recording));
}

function renderScenes() {
  sceneList.replaceChildren(
    ...scenes.map((name) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = name;
      button.setAttribute('aria-current', String(name === scene));
      button.addEventListener('click', () => {
        obs?.request('SetCurrentProgramScene', { sceneName: name }).catch(report);
      });
      item.append(button);
      return item;
    }),
  );
}

function renderInputs() {
  inputList.replaceChildren(
    ...inputs.map((input) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      const name = document.createElement('span');
      name.textContent = input.name;
      const state = document.createElement('span');
      state.textContent = input.muted ? 'Muted' : 'On';
      if (input.muted) state.className = 'muted';
      button.append(name, state);
      button.addEventListener('click', () => {
        obs?.request('ToggleInputMute', { inputName: input.name }).catch(report);
      });
      item.append(button);
      return item;
    }),
  );
}

/** Reads everything shown: done on connecting, then kept up by OBS's events. */
async function loadState(connection: ObsConnection) {
  const [sceneList_, stream, record, inputList_] = await Promise.all([
    connection.request('GetSceneList'),
    connection.request('GetStreamStatus'),
    connection.request('GetRecordStatus'),
    connection.request('GetInputList'),
  ]);
  scene = sceneList_.currentProgramSceneName as string;
  // OBS lists scenes bottom to top; its own window shows them the other way.
  scenes = (sceneList_.scenes as { sceneName: string }[]).map((s) => s.sceneName).reverse();
  streaming = stream.outputActive as boolean;
  recording = record.outputActive as boolean;
  const names = (inputList_.inputs as { inputName: string }[]).map((input) => input.inputName);
  const mutes = await Promise.all(
    names.map(async (name) => {
      try {
        const answer = await connection.request('GetInputMute', { inputName: name });
        return { name, muted: answer.inputMuted as boolean };
      } catch {
        // Sources without audio have no mute state.
        return null;
      }
    }),
  );
  inputs = mutes.filter((input) => input !== null);
  renderScenes();
  renderInputs();
  renderOutputs();
}

function onEvent(type: string, data: Record<string, unknown>) {
  if (type === 'CurrentProgramSceneChanged') {
    scene = data.sceneName as string;
    renderScenes();
  } else if (type === 'SceneListChanged' && obs) {
    void loadState(obs).catch(report);
  } else if (type === 'StreamStateChanged') {
    streaming = data.outputActive as boolean;
    renderOutputs();
  } else if (type === 'RecordStateChanged') {
    recording = data.outputActive as boolean;
    renderOutputs();
  } else if (type === 'InputMuteStateChanged') {
    inputs = inputs.map((input) =>
      input.name === data.inputName ? { ...input, muted: data.inputMuted as boolean } : input,
    );
    renderInputs();
  }
}

function show(connected: boolean) {
  connectView.hidden = connected;
  controls.hidden = !connected;
  connectButton.disabled = false;
}

function start() {
  obs?.close();
  connectButton.disabled = true;
  status.textContent = 'Connecting…';
  const port = Number(portField.value) || 4455;
  const password = passwordField.value;
  const connection = new ObsConnection(port, password, {
    onConnected: () => {
      show(true);
      overquid.storage.set('connection', { port, password }).catch(report);
      void loadState(connection).catch(report);
    },
    onClosed: (reason) => {
      if (obs !== connection) return;
      obs = null;
      status.textContent = reason;
      show(false);
    },
    onEvent,
  });
  obs = connection;
}

connectButton.addEventListener('click', start);
passwordField.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') start();
});
streamButton.addEventListener('click', () => {
  obs?.request('ToggleStream').catch(report);
});
recordButton.addEventListener('click', () => {
  obs?.request('ToggleRecord').catch(report);
});
element('disconnect').addEventListener('click', () => {
  obs?.close();
  obs = null;
  status.textContent = 'Not connected';
  show(false);
});

const saved = await overquid.storage
  .get<{ port: number; password: string }>('connection')
  .catch(() => undefined);
if (saved) {
  portField.value = String(saved.port);
  passwordField.value = saved.password;
}

/** Reconnects by itself when the panel comes back and OBS is running. */
function reconnect() {
  if (saved && !obs) start();
}
overquid.onShow(reconnect);
if (overquid.visible) reconnect();
