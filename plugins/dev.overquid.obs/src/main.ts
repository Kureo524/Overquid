import { connect } from '@overquid/sdk';
import { ObsConnection, randomPassword } from './obs';
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
const launchView = element('launch');
const startButton = element<HTMLButtonElement>('start');
const workspaceField = element<HTMLInputElement>('workspace');
const preview = element<HTMLImageElement>('preview');

/** OBS's desktop entry, the same for a distribution package and the Flatpak. */
const OBS_APP = 'com.obsproject.Studio';
/** How long OBS gets to start before the plugin stops knocking. */
const LAUNCH_PATIENCE = 45_000;
const RETRY_EVERY = 1500;
/** Pause between two images of the live view: about ten a second at most. */
const PREVIEW_PAUSE = 100;

let obs: ObsConnection | null = null;
let scene = '';
let scenes: string[] = [];
let inputs: { name: string; muted: boolean }[] = [];
let streaming = false;
let recording = false;

/** When to stop retrying after starting OBS; 0 when not waiting for it. */
let waitingUntil = 0;

const report = (error: unknown) => console.error('OBS:', error);

/** Shows the current scene, one image after the other, while the panel is visible. */
async function watch(connection: ObsConnection) {
  while (obs === connection && overquid.visible) {
    try {
      const width = Math.round(preview.clientWidth * devicePixelRatio) || 640;
      const answer = await connection.request('GetSourceScreenshot', {
        sourceName: scene,
        imageFormat: 'jpg',
        imageWidth: Math.min(1920, Math.max(160, width)),
        imageCompressionQuality: 70,
      });
      if (obs !== connection) return;
      preview.src = answer.imageData as string;
      preview.hidden = false;
    } catch {
      // No scene yet, or OBS is busy: try again a little later.
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_PAUSE));
  }
  watching = false;
}
let watching = false;
function startWatching() {
  if (!obs || watching || !overquid.visible) return;
  watching = true;
  void watch(obs);
}

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
  startButton.disabled = false;
  if (!connected) preview.hidden = true;
}

function start() {
  obs?.close();
  connectButton.disabled = true;
  startButton.disabled = true;
  if (!waitingUntil) status.textContent = 'Connecting…';
  const port = Number(portField.value) || 4455;
  const password = passwordField.value;
  const connection = new ObsConnection(port, password, {
    onConnected: () => {
      waitingUntil = 0;
      show(true);
      overquid.storage.set('connection', { port, password }).catch(report);
      void loadState(connection).then(startWatching).catch(report);
    },
    onClosed: (reason) => {
      if (obs !== connection) return;
      obs = null;
      watching = false;
      if (waitingUntil && reason !== 'Wrong password') {
        if (Date.now() < waitingUntil) {
          setTimeout(() => {
            if (waitingUntil && !obs) start();
          }, RETRY_EVERY);
          return;
        }
        reason =
          'OBS started but does not answer. It may be asking something on its workspace, or its WebSocket server is off: in OBS, once, Tools › WebSocket Server Settings › Enable.';
      }
      waitingUntil = 0;
      status.textContent = reason;
      show(false);
    },
    onEvent,
  });
  obs = connection;
}

/** Starts OBS with a password of the plugin's own, then connects as soon as it answers. */
async function launch() {
  startButton.disabled = true;
  const workspace = workspaceField.value.trim();
  let password = await overquid.storage.get<string>('launchPassword').catch(() => undefined);
  if (!password) {
    password = randomPassword();
    await overquid.storage.set('launchPassword', password).catch(report);
  }
  overquid.storage.set('workspace', workspace).catch(report);
  const port = Number(portField.value) || 4455;
  try {
    await overquid.apps.launch(OBS_APP, {
      args: [
        '--websocket_port',
        String(port),
        '--websocket_password',
        password,
        // Out of sight, nobody would see OBS ask about its last shutdown.
        '--disable-shutdown-check',
        ...(workspace ? [] : ['--minimize-to-tray']),
      ],
      ...(workspace ? { workspace } : {}),
    });
  } catch (error) {
    status.textContent = String(error).replace(/^.*Error: /, '');
    startButton.disabled = false;
    return;
  }
  passwordField.value = password;
  status.textContent = 'Starting OBS…';
  waitingUntil = Date.now() + LAUNCH_PATIENCE;
  start();
}

connectButton.addEventListener('click', () => {
  waitingUntil = 0;
  start();
});
startButton.addEventListener('click', () => void launch());
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
  watching = false;
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

const workspace = await overquid.storage.get<string>('workspace').catch(() => undefined);
workspaceField.value = workspace ?? 'special:obs';
launchView.hidden = !(await overquid.apps.installed(OBS_APP).catch(() => false));

/** Reconnects by itself when the panel comes back and OBS is running. */
function reconnect() {
  if (obs) startWatching();
  else if (saved && !waitingUntil) start();
}
overquid.onShow(reconnect);
if (overquid.visible) reconnect();
