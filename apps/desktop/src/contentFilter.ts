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

/** The site an exception is kept for: the host, without a leading `www.` (`content_filter::site_of`). */
export function siteOf(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:' && protocol !== 'http:') return null;
    return (
      hostname
        .replace(/\.$/, '')
        .toLowerCase()
        .replace(/^www\./, '') || null
    );
  } catch {
    return null;
  }
}

/** Whether the filter is off on `site`: an exception for it or a parent domain. */
export const isExcepted = (site: string, exceptions: string[]) =>
  exceptions.some((known) => site === known || site.endsWith(`.${known}`));

/** Sites where the user switched the filter off. */
export function useFilterExceptions(): string[] {
  const [sites, setSites] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    const stop = listen<string[]>('content-filter-exceptions', (event) => setSites(event.payload));
    invoke<string[]>('content_filter_exceptions').then(
      (current) => active && setSites(current),
      (error: unknown) => console.error('Cannot read the filter exceptions:', error),
    );
    return () => {
      active = false;
      void stop.then((unlisten) => unlisten());
    };
  }, []);
  return sites;
}

export const setSiteFilter = (site: string, filtered: boolean) =>
  invoke<string[]>('set_site_filter', { host: site, filtered });
