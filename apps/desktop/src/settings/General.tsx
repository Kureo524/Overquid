import {
  filterEnabled,
  describeFilter,
  setContentFilter,
  useContentFilter,
} from '../contentFilter';
import { Setting, Switch } from './Controls';

export function General() {
  const filter = useContentFilter();
  return (
    <>
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
