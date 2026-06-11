import cx from '@src/cx.mjs';

const baseStyle = {
  height: '32px',
  fontSize: 'var(--fs-input)',
  lineHeight: '1.4',
  backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
  borderColor: 'color-mix(in srgb, var(--foreground) 20%, transparent)',
  borderRadius: '0',
  overflow: 'hidden',
};

export function Textbox({ onChange, className, style, ...inputProps }) {
  return (
    <input
      className={cx(
        'px-2 py-1 border text-foreground placeholder-foreground/50 w-full',
        className,
      )}
      style={{ ...baseStyle, ...style }}
      onChange={(e) => onChange(e.target.value)}
      {...inputProps}
    />
  );
}
