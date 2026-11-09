import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

/** The content filter's state (`content_filter::Status`, ADR 0005). */
export type FilterStatus =
  | { state: 'off' }
  | { state: 'loading' }
  | { state: 'on'; lists: number; scriptlets: number }
  | { state: 'error'; message: string };

export function describeFilter(status: FilterStatus): string {
  switch (status.state) {
    case 'off':
      return 'Off';
    case 'loading':
      return 'Updating filter lists…';
    case 'on':
      return `On: ${status.lists} lists, ${status.scriptlets} scriptlets`;
    case 'error':
      return `Error: ${status.message}`;
  }
}

/** Whether the user switched the filter on (loading counts as on). */
export const filterEnabled = (status: FilterStatus) => status.state !== 'off';

export const setContentFilter = (enabled: boolean) => invoke('set_content_filter', { enabled });

export function useContentFilter(): FilterStatus {
  const [status, setStatus] = useState<FilterStatus>({ state: 'off' });
  useEffect(() => {
    let active = true;
    const stop = listen<FilterStatus>('content-filter', (event) => setStatus(event.payload));
    invoke<FilterStatus>('content_filter_status').then(
      (current) => active && setStatus(current),
      (error: unknown) => console.error('Cannot read the content filter status:', error),
    );
    return () => {
      active = false;
      void stop.then((unlisten) => unlisten());
    };
  }, []);
  return status;
}
