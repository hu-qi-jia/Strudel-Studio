import cx from '@src/cx.mjs';

export function ButtonGroup({ value, onChange, items, buttonStyle }) {
  return (
    <div className="flex max-w-lg">
      {Object.entries(items).map(([key, label]) => (
        <button
          key={key}
          id={key}
          onClick={() => onChange(key)}
          className={cx(
            'px-2 py-0.5 border-b whitespace-nowrap transition-colors',
            value === key ? 'border-foreground' : 'border-transparent text-foreground/50 hover:text-foreground/70',
          )}
          style={{ height: '28px', fontSize: 'var(--fs-input)', ...buttonStyle }}
        >
          {label.toLowerCase()}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({ label, value, onChange, disabled = false }) {
  return (
    <label className="flex items-center gap-1 cursor-pointer hover:opacity-80" style={{ fontSize: 'var(--fs-input)' }}>
      <input
        disabled={disabled}
        type="checkbox"
        checked={value}
        onChange={onChange}
        style={{ width: '14px', height: '14px', margin: 0 }}
      />
      <span>{label}</span>
    </label>
  );
}

export function SelectInput({ value, options, onChange }) {
  return (
    <select
      className="w-full px-2 py-1 border outline-none transition-colors"
      style={{
        height: '32px',
        fontSize: 'var(--fs-input)',
        lineHeight: '1.4',
        backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
        color: 'var(--foreground)',
        borderColor: 'color-mix(in srgb, var(--foreground) 20%, transparent)',
        borderRadius: '0',
      }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {Object.entries(options).map(([k, label]) => (
        <option key={k} className="bg-background text-foreground" value={k}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function NumberSlider({ value, onChange, step = 1, ...rest }) {
  return (
    <div className="flex items-center gap-2">
      <input
        className="flex-1 outline-none"
        type="range"
        style={{
          height: '14px',
          accentColor: 'var(--caret)',
          background: `color-mix(in srgb, var(--foreground) 20%, transparent)`,
          borderRadius: '4px',
        }}
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        {...rest}
      />
      <input
        type="number"
        value={value}
        step={step}
        className="w-12 px-1 py-0.5 border outline-none text-center"
        style={{
          height: '32px',
          fontSize: 'var(--fs-input)',
          lineHeight: '1.4',
          backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
          color: 'var(--foreground)',
          borderColor: 'color-mix(in srgb, var(--foreground) 20%, transparent)',
          borderRadius: '0',
        }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function FormItem({ label, children, sublabel }) {
  return (
    <div
      className="flex flex-col gap-1 mb-3 pb-3 border-b last:border-b-0"
      style={{ borderColor: 'color-mix(in srgb, var(--foreground) 10%, transparent)' }}
    >
      <label className="text-[var(--fs-label)] font-medium text-foreground flex items-center justify-between cursor-default">
        {label}
      </label>
      {children}
      {sublabel && (
        <span
          className="text-[var(--fs-hint)]"
          style={{ color: 'color-mix(in srgb, var(--foreground) 40%, transparent)' }}
        >
          {sublabel}
        </span>
      )}
    </div>
  );
}
