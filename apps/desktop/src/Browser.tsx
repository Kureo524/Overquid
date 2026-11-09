import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  filterEnabled,
  isExcepted,
  setSiteFilter,
  siteOf,
  useContentFilter,
  useFilterExceptions,
} from './contentFilter';
import { WebSlot } from './WebSlot';

/** What the core reports about a web panel's page (`web_panels::PageState`). */
interface PageState {
  panelId: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

type Navigation =
  { kind: 'load'; input: string } | { kind: 'back' | 'forward' | 'reload' | 'stop' | 'home' };

interface BrowserProps {
  panelId: string;
  name: string;
  visible: boolean;
}

/** The current page of a web panel, as reported by the core. */
function usePage(panelId: string): PageState | null {
  const [page, setPage] = useState<PageState | null>(null);
  useEffect(() => {
    const stop = listen<PageState>('web-page', (event) => {
      if (event.payload.panelId === panelId) setPage(event.payload);
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [panelId]);
  return page;
}

/** A browser plugin: navigation bar over a web panel (ADR 0004). */
export function Browser({ panelId, name, visible }: BrowserProps) {
  const page = usePage(panelId);
  const filter = useContentFilter();
  const exceptions = useFilterExceptions();
  const site = page ? siteOf(page.url) : null;
  const filtered = site !== null && !isExcepted(site, exceptions);
  // What the user is typing; null shows the page's address.
  const [draft, setDraft] = useState<string | null>(null);
  // A click that focuses the address bar selects it all: the mouse button
  // release would otherwise put the caret back and drop the selection.
  const selectOnRelease = useRef(false);

  const navigate = (navigation: Navigation) => {
    invoke('web_navigate', { panelId, navigation }).catch((error: unknown) =>
      console.error(`Browser ${panelId}:`, error),
    );
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = draft?.trim();
    if (input) navigate({ kind: 'load', input });
    setDraft(null);
    const field = event.currentTarget.elements.namedItem('address');
    if (field instanceof HTMLElement) field.blur();
  };

  return (
    <div className="browser">
      <form className="browser__bar" onSubmit={onSubmit}>
        <BarButton
          label="Back"
          disabled={!page?.canGoBack}
          onClick={() => navigate({ kind: 'back' })}
        >
          <path d="M10 3 5 8l5 5" />
        </BarButton>
        <BarButton
          label="Forward"
          disabled={!page?.canGoForward}
          onClick={() => navigate({ kind: 'forward' })}
        >
          <path d="m6 3 5 5-5 5" />
        </BarButton>
        {page?.loading ? (
          <BarButton label="Stop" onClick={() => navigate({ kind: 'stop' })}>
            <path d="m4 4 8 8M12 4l-8 8" />
          </BarButton>
        ) : (
          <BarButton label="Reload" onClick={() => navigate({ kind: 'reload' })}>
            <path d="M12.5 8A4.5 4.5 0 1 1 11 4.6M12.5 2.5v3h-3" />
          </BarButton>
        )}
        <input
          name="address"
          className="browser__address mono"
          aria-label="Address or search"
          placeholder="Search or enter an address"
          spellCheck={false}
          autoComplete="off"
          value={draft ?? page?.url ?? ''}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.target.select()}
          onMouseDown={(event) => {
            selectOnRelease.current = document.activeElement !== event.currentTarget;
          }}
          onMouseUp={(event) => {
            if (selectOnRelease.current) event.preventDefault();
            selectOnRelease.current = false;
          }}
          onBlur={() => setDraft(null)}
        />
        {filterEnabled(filter) && site !== null && (
          <BarButton
            label={filtered ? `Turn the content filter off on ${site}` : `Filter ${site} again`}
            pressed={filtered}
            onClick={() => {
              setSiteFilter(site, !filtered).catch((error: unknown) =>
                console.error(`Content filter on ${site}:`, error),
              );
            }}
          >
            <path d="M8 1.8 13.2 3.8v4c0 3-2.2 5.3-5.2 6.4-3-1.1-5.2-3.4-5.2-6.4v-4Z" />
            {!filtered && <path d="m3 3 10 10" />}
          </BarButton>
        )}
      </form>
      <WebSlot panelId={panelId} name={name} visible={visible} />
    </div>
  );
}

function BarButton({
  label,
  disabled = false,
  pressed,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  /** For toggles: shown highlighted when on. */
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={(event) => {
        onClick();
        // Keys typed later are meant for the page, not this button.
        event.currentTarget.blur();
      }}
    >
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}
