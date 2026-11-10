import { useEffect, useState } from 'react';
import {
  ACCENT_LIGHTNESS,
  ACCENT_PRESETS,
  DEFAULT_THEME,
  GLASS_RANGE,
  hexToHsl,
  hslToHex,
  INK_LIGHTNESS,
  INK_PRESETS,
  isHex,
  VEIL_RANGE,
  type Theme,
} from '../theme';
import { Setting, Slider } from './Controls';

interface ColorProps {
  label: string;
  value: string;
  presets: { name: string; color: string }[];
  lightness: { min: number; max: number };
  onChange: (color: string) => void;
}

/**
 * Presets, plus sliders and a hex field. Not `<input type="color">`: its GTK
 * dialog would open as a window behind the overlay's layer.
 */
function ColorPicker({ label, value, presets, lightness, onChange }: ColorProps) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const hsl = hexToHsl(value);
  const set = (change: Partial<typeof hsl>) => onChange(hslToHex({ ...hsl, ...change }));
  return (
    <>
      <Setting label={label}>
        <span className="swatches">
          {presets.map((preset) => (
            <button
              key={preset.color}
              type="button"
              className="swatch"
              title={preset.name}
              aria-label={`${label}: ${preset.name}`}
              aria-pressed={preset.color === value}
              style={{ backgroundColor: preset.color }}
              onClick={() => onChange(preset.color)}
            />
          ))}
        </span>
        <input
          className="field"
          aria-label={`${label} colour code`}
          spellCheck={false}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (isHex(event.target.value)) onChange(event.target.value.toLowerCase());
          }}
          onBlur={() => setText(value)}
        />
      </Setting>
      <Setting label="Hue">
        <Slider
          label={`${label} hue`}
          min={0}
          max={359}
          step={1}
          value={hsl.h}
          onChange={(h) => set({ h })}
        />
      </Setting>
      <Setting label="Saturation">
        <Slider
          label={`${label} saturation`}
          min={0}
          max={100}
          step={1}
          value={hsl.s}
          onChange={(s) => set({ s })}
        />
      </Setting>
      <Setting label="Lightness">
        <Slider
          label={`${label} lightness`}
          min={lightness.min}
          max={lightness.max}
          step={1}
          value={hsl.l}
          onChange={(l) => set({ l })}
        />
      </Setting>
    </>
  );
}

export function Appearance({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (theme: Theme) => void;
}) {
  return (
    <>
      <h2 className="settings__heading">Colours</h2>
      <ColorPicker
        label="Accent"
        value={theme.accent}
        presets={ACCENT_PRESETS}
        lightness={ACCENT_LIGHTNESS}
        onChange={(accent) => onChange({ ...theme, accent })}
      />
      <h2 className="settings__heading">Glass</h2>
      <ColorPicker
        label="Ink"
        value={theme.ink}
        presets={INK_PRESETS}
        lightness={INK_LIGHTNESS}
        onChange={(ink) => onChange({ ...theme, ink })}
      />
      <Setting label="Panel opacity">
        <Slider
          label="Panel opacity"
          {...GLASS_RANGE}
          step={0.01}
          value={theme.glass}
          onChange={(glass) => onChange({ ...theme, glass })}
        />
      </Setting>
      <Setting label="Veil over the desktop" hint="Dims what is under the overlay; 0 removes it">
        <Slider
          label="Veil over the desktop"
          {...VEIL_RANGE}
          step={0.01}
          value={theme.veil}
          onChange={(veil) => onChange({ ...theme, veil })}
        />
      </Setting>
      <div className="setting">
        <span />
        <button type="button" className="btn" onClick={() => onChange(DEFAULT_THEME)}>
          Reset colours
        </button>
      </div>
    </>
  );
}
