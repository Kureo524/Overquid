import {
  filterEnabled,
  describeFilter,
  setContentFilter,
  useContentFilter,
} from '../contentFilter';
import { Segmented, Setting, Switch } from './Controls';
import type { SnapMode, SnapSettings } from './settings';

/** How a modifier is named on the keyboard. */
export const modifierLabel = { Control: 'Ctrl', Shift: 'Shift', Alt: 'Alt', Meta: 'Super' };

interface GeneralProps {
  snap: SnapSettings;
  onSnap: (snap: SnapSettings) => void;
}

export function General({ snap, onSnap }: GeneralProps) {
  const filter = useContentFilter();
  return (
    <>
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
