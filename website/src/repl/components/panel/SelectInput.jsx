import React from 'react';
//      value: ?ID, options: Map<ID, any>, onChange: ID => null, onClick: event => void, isDisabled: boolean
export function SelectInput({ value, options, onChange, onClick, isDisabled }) {
  return (
    <select
      disabled={isDisabled}
      onClick={onClick}
      className="w-full px-2 py-1 border text-foreground"
      style={{
        height: '32px',
        fontSize: 'var(--fs-input)',
        lineHeight: '1.4',
        backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
        borderColor: 'color-mix(in srgb, var(--foreground) 20%, transparent)',
        borderRadius: '0',
      }}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.size == 0 && <option value={value}>{`${value ?? 'select an option'}`}</option>}
      {Array.from(options.keys()).map((id) => (
        <option key={id} className="bg-background text-foreground" value={id}>
          {options.get(id)}
        </option>
      ))}
    </select>
  );
}
