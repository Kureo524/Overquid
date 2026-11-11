import type { ReactNode } from 'react';

/** One line of settings: what it is on the left, its control on the right. */
export function Setting({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting">
      <span className="setting__label">
        {label}
        {hint && <span className="setting__hint">{hint}</span>}
      </span>
      <span className="setting__control">{children}</span>
    </div>
  );
}

export function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      className="switch"
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      className="slider"
      type="range"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

/** A few mutually exclusive choices, side by side. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <span className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className="segmented__item"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}
