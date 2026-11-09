import { useEffect, useRef } from 'react';
import { pluginUrl, registerFrame, sendVisibility, type PluginManifest } from './plugins';

interface PluginFrameProps {
  plugin: PluginManifest;
  height: number;
  /** Whether the panel is on screen; the plugin is told on every change. */
  visible: boolean;
}

/** A plugin's UI: a sandboxed iframe, scripts only (ADR 0003). */
export function PluginFrame({ plugin, height, visible }: PluginFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    const frame = ref.current?.contentWindow;
    if (!frame) return;
    return registerFrame(frame, plugin.id);
  }, [plugin.id]);

  useEffect(() => {
    const frame = ref.current?.contentWindow;
    if (frame) sendVisibility(frame, visible);
  }, [visible]);

  // A freshly loaded document has missed earlier events: tell it where it stands.
  const onLoad = () => {
    const frame = ref.current?.contentWindow;
    if (frame) sendVisibility(frame, visibleRef.current);
  };

  return (
    <iframe
      ref={ref}
      className="plugin-frame"
      title={plugin.name}
      src={pluginUrl(plugin.id, plugin.entry)}
      sandbox="allow-scripts"
      style={{ height }}
      onLoad={onLoad}
    />
  );
}
