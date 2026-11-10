import {
  filterEnabled,
  describeFilter,
  setContentFilter,
  useContentFilter,
} from '../contentFilter';
import { useEffect, useState } from 'react';
import { Segmented, Setting, Switch } from './Controls';
import { listMonitors, type Monitor, type SnapMode, type SnapSettings } from './settings';

/** How a modifier is named on the keyboard. */
export const modifierLabel = { Control: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Super' };

interface GeneralProps {
  snap: SnapSettings;
  onSnap: (snap: SnapSettings) => void;
  monitor: string | null;
  onMonitor: (monitor: string | null) => void;
}

export function General({ snap, onSnap, monitor, onMonitor }: GeneralProps) {
  const filter = useContentFilter();
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  useEffect(() => {
    listMonitors().then(setMonitors, () => setMonitors([]));
  }, []);
  return (
    <>
      {monitors.length > 1 && (
        <>
          <h2 className="settings__heading">Screen</h2>
          <Setting
            label="Show the overlay on"
            hint="Pick a second screen and press the pin in the bar to leave an overlay there"
          >
            <Segmented
              label="Show the overlay on"
              value={monitor ?? ''}
              options={[
                { value: '', label: 'Focused screen' },
                ...monitors.map((screen) => ({
                  value: screen.id,
                  label: `${screen.name} ${screen.width}×${screen.height}`,
                })),
              ]}
              onChange={(value) => onMonitor(value || null)}
            />
          </Setting>
        </>
      )}
      <h2 className="settings__heading">Panels</h2>
      <Setting
        label="Snapping"
        hint="Panels stick to the screen and to each other when moved or resized"
      >
        <Segmented<SnapMode>
          label="Snapping"
          value={snap.mode}
          options={[
            { value: 'hold', label: `While holding ${modifierLabel[snap.key]}` },
            { value: 'always', label: 'Always' },
            { value: 'off', label: 'Off' },
          ]}
          onChange={(mode) => onSnap({ ...snap, mode })}
        />
      </Setting>
      <h2 className="settings__heading">Web panels</h2>
      <Setting label="Block ads and trackers" hint={describeFilter(filter)}>
        <Switch
          label="Block ads and trackers"
          checked={filterEnabled(filter)}
          onChange={(enabled) => {
            setContentFilter(enabled).catch((error: unknown) =>
              console.error('Cannot switch the content filter:', error),
            );
          }}
        />
      </Setting>
    </>
  );
}
