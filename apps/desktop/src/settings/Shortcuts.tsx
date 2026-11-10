import { useEffect, useRef, useState } from 'react';
import { Segmented, Setting } from './Controls';
import { modifierLabel } from './General';
import { MODIFIERS, type Modifier, type Shortcuts, type SnapSettings } from './settings';
import {
  duplicateShortcut,
  shortcutDesktop,
  shortcutLabel,
  shortcutOf,
  suspendShortcuts,
  type Desktop,
} from './shortcuts';

type Action = keyof Shortcuts;

/** Records the next key press for an action, and hands the keys back when done. */
function useRecorder(onRecord: (action: Action, shortcut: string) => void) {
  const [recording, setRecording] = useState<Action | null>(null);
  const callback = useRef(onRecord);
  callback.current = onRecord;

  useEffect(() => {
    if (!recording) return;
    void suspendShortcuts(true);
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape' && recording !== 'close') {
        setRecording(null);
        return;
      }
      const shortcut = shortcutOf(event);
      if (!shortcut) return;
      callback.current(recording, shortcut);
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      void suspendShortcuts(false);
    };
  }, [recording]);

  return [recording, setRecording] as const;
}

interface RowProps {
  label: string;
  hint?: string;
  action: Action;
  value: string | null;
  recording: Action | null;
  onRecord: (action: Action) => void;
  /** Absent when the shortcut cannot be removed. */
  onClear?: (() => void) | undefined;
  empty?: string;
}

function ShortcutRow({
  label,
  hint,
  action,
  value,
  recording,
  onRecord,
  onClear,
  empty,
}: RowProps) {
  const active = recording === action;
  return (
    <Setting label={label} {...(hint ? { hint } : {})}>
      <span className="setting__keys">
        {active ? (
          <kbd className="capture">Press a shortcut…</kbd>
        ) : value ? (
          <kbd>{shortcutLabel(value)}</kbd>
        ) : (
          <span className="setting__hint">{empty ?? 'None'}</span>
        )}
        <button type="button" className="btn" onClick={() => onRecord(action)}>
          Change
        </button>
        {onClear && value && (
          <button type="button" className="btn" onClick={onClear}>
            Clear
          </button>
        )}
      </span>
    </Setting>
  );
}

interface SectionProps {
  shortcuts: Shortcuts;
  snap: SnapSettings;
  onShortcuts: (shortcuts: Shortcuts) => void;
  onSnap: (snap: SnapSettings) => void;
}

const TOGGLE_NOTE: Record<Desktop, string> = {
  hyprland: 'Set in Hyprland while Overquid runs, and replaces Alt + Shift + X from your config.',
  gnome: 'Saved as a custom shortcut in GNOME.',
  manual:
    'This desktop cannot be configured from here. Bind the command "overquid toggle" in its keyboard settings.',
};

export function ShortcutsSection({ shortcuts, snap, onShortcuts, onSnap }: SectionProps) {
  const [desktop, setDesktop] = useState<Desktop | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    shortcutDesktop().then(setDesktop, () => setDesktop('manual'));
  }, []);

  const set = (action: Action, shortcut: string | null) => {
    const next = { ...shortcuts, [action]: shortcut ?? '' };
    if (action === 'toggle') next.toggle = shortcut;
    const taken = duplicateShortcut(next);
    if (taken) {
      setError(`${shortcutLabel(taken)} is already used by another action.`);
      return;
    }
    setError(null);
    onShortcuts(next);
  };

  const [recording, setRecording] = useRecorder(set);

  return (
    <>
      <h2 className="settings__heading">Show and hide</h2>
      <ShortcutRow
        label="Show or hide the overlay"
        action="toggle"
        value={shortcuts.toggle}
        empty="Set by your desktop"
        recording={recording}
        onRecord={setRecording}
        onClear={desktop === 'manual' ? undefined : () => set('toggle', null)}
      />
      {desktop && <p className="settings__note">{TOGGLE_NOTE[desktop]}</p>}
      <ShortcutRow
        label="Close the overlay"
        hint="Also gives the keyboard back from a pinned panel"
        action="close"
        value={shortcuts.close}
        recording={recording}
        onRecord={setRecording}
      />
      <h2 className="settings__heading">In the overlay</h2>
      <ShortcutRow
        label="Next overlay"
        action="next"
        value={shortcuts.next}
        recording={recording}
        onRecord={setRecording}
        onClear={() => set('next', null)}
      />
      <ShortcutRow
        label="Previous overlay"
        action="prev"
        value={shortcuts.prev}
        recording={recording}
        onRecord={setRecording}
        onClear={() => set('prev', null)}
      />
      <ShortcutRow
        label="Open the settings"
        action="settings"
        value={shortcuts.settings}
        recording={recording}
        onRecord={setRecording}
        onClear={() => set('settings', null)}
      />
      <h2 className="settings__heading">Panels</h2>
      <Setting label="Key held to snap panels" hint="Used when snapping is set to work while held">
        <Segmented<Modifier>
          label="Key held to snap panels"
          value={snap.key}
          options={MODIFIERS.map((key) => ({ value: key, label: modifierLabel[key] }))}
          onChange={(key) => onSnap({ ...snap, key })}
        />
      </Setting>
      {error && <p className="settings__error">{error}</p>}
    </>
  );
}
