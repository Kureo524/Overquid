import { useEffect, useRef } from 'react';
import { pluginUrl, registerFrame, type PluginManifest } from './plugins';

/** A plugin's UI: a sandboxed iframe, scripts only (see ADR 0003). */
export function PluginFrame({ plugin, height }: { plugin: PluginManifest; height: number }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const frame = ref.current?.contentWindow;
    if (!frame) return;
    return registerFrame(frame, plugin.id);
  }, [plugin.id]);

  return (
    <iframe
      ref={ref}
      className="plugin-frame"
      title={plugin.name}
      src={pluginUrl(plugin.id, plugin.entry)}
      sandbox="allow-scripts"
      style={{ height }}
    />
  );
}
