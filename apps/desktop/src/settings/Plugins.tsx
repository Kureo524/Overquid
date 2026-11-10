import { useCallback, useEffect, useState } from 'react';
import {
  fetchCatalog,
  installPlugin,
  isNewer,
  uninstallPlugin,
  type CatalogEntry,
  type InstalledPlugin,
  type PluginManifest,
} from '../plugins';
import { Switch } from './Controls';

/** What a plugin may do, in words: shown before installing. */
export function accessOf(manifest: PluginManifest): string {
  const access = [
    ...manifest.permissions,
    ...manifest.network.map((host) => `network: ${host}`),
    ...(manifest.web
      ? [manifest.web.browser ? 'opens any website' : `website: ${manifest.web.hosts.join(', ')}`]
      : []),
  ];
  return access.length > 0 ? `Can use: ${access.join(' · ')}` : 'Needs no special access';
}

interface SectionProps {
  plugins: InstalledPlugin[];
  disabled: string[];
  onDisabled: (disabled: string[]) => void;
  onChanged: () => void;
  onRemoved: (id: string) => void;
}

export function PluginsSection({
  plugins,
  disabled,
  onDisabled,
  onChanged,
  onRemoved,
}: SectionProps) {
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCatalog = useCallback(() => {
    setCatalog(null);
    setCatalogError(null);
    fetchCatalog().then(setCatalog, (failure: unknown) => setCatalogError(String(failure)));
  }, []);
  useEffect(loadCatalog, [loadCatalog]);

  const run = (id: string, action: () => Promise<unknown>, after?: () => void) => {
    setBusy(id);
    setError(null);
    action()
      .then(() => {
        after?.();
        onChanged();
      })
      .catch((failure: unknown) => setError(String(failure)))
      .finally(() => setBusy(null));
  };

  const offers = (catalog ?? []).flatMap(({ manifest }) => {
    const known = plugins.find((plugin) => plugin.id === manifest.id);
    if (known && !isNewer(manifest.version, known.version)) return [];
    return [{ manifest, update: known !== undefined }];
  });
  const sorted = [...plugins].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <h2 className="settings__heading">Available</h2>
      {catalog === null && !catalogError && <p className="settings__empty">Loading the catalog…</p>}
      {catalogError && (
        <div className="plugin-row">
          <p className="settings__empty">The catalog cannot be reached.</p>
          <button type="button" className="btn" onClick={loadCatalog}>
            Retry
          </button>
        </div>
      )}
      {catalog !== null && offers.length === 0 && (
        <p className="settings__empty">Everything from the catalog is installed.</p>
      )}
      {offers.map(({ manifest, update }) => (
        <div key={manifest.id} className="plugin-row">
          <div className="plugin-row__info">
            <span className="plugin-row__name">{manifest.name}</span>
            <span className="plugin-row__version">{manifest.version}</span>
            {manifest.description && <p className="plugin-row__text">{manifest.description}</p>}
            <p className="plugin-row__meta">{accessOf(manifest)}</p>
          </div>
          <div className="plugin-row__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy !== null}
              onClick={() => run(manifest.id, () => installPlugin(manifest.id))}
            >
              {busy === manifest.id ? 'Installing…' : update ? 'Update' : 'Install'}
            </button>
          </div>
        </div>
      ))}
      {error && <p className="settings__error">{error}</p>}
      <h2 className="settings__heading">Installed</h2>
      {sorted.map((plugin) => (
        <div key={plugin.id} className="plugin-row">
          <div className="plugin-row__info">
            <span className="plugin-row__name">{plugin.name}</span>
            <span className="plugin-row__version">{plugin.version}</span>
            {plugin.description && <p className="plugin-row__text">{plugin.description}</p>}
            <p className="plugin-row__meta">{accessOf(plugin)}</p>
          </div>
          <div className="plugin-row__actions">
            {plugin.removable && (
              <button
                type="button"
                className="btn"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    plugin.id,
                    () => uninstallPlugin(plugin.id),
                    () => onRemoved(plugin.id),
                  )
                }
              >
                {busy === plugin.id ? 'Removing…' : 'Remove'}
              </button>
            )}
            <Switch
              label={`Enable ${plugin.name}`}
              checked={!disabled.includes(plugin.id)}
              onChange={(enabled) =>
                onDisabled(
                  enabled ? disabled.filter((id) => id !== plugin.id) : [...disabled, plugin.id],
                )
              }
            />
          </div>
        </div>
      ))}
    </>
  );
}
