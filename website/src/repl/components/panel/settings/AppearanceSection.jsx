import { useSettings, settingsMap } from '@root/website/src/settings.mjs';
import { themes } from '@strudel/codemirror';
import { FormItem, SelectInput, NumberSlider } from '../Forms.jsx';

const themeOptions = Object.fromEntries(Object.keys(themes).map((k) => [k, k]));
const fontFamilyOptions = {
  monospace: 'monospace',
  Courier: 'Courier',
  CutiePi: 'CutiePi',
  JetBrains: 'JetBrains',
  Hack: 'Hack',
  FiraCode: 'FiraCode',
  'FiraCode-SemiBold': 'FiraCode SemiBold',
  teletext: 'teletext',
  mode7: 'mode7',
  BigBlueTerminal: 'BigBlueTerminal',
  x3270: 'x3270',
  Monocraft: 'Monocraft',
  PressStart: 'PressStart2P',
  'we-come-in-peace': 'we-come-in-peace',
  galactico: 'galactico',
};

export function AppearanceSection() {
  const { theme, fontSize, fontFamily } = useSettings();

  return (
    <div className="space-y-1 w-full">
      <FormItem label="Theme">
        <SelectInput options={themeOptions} value={theme} onChange={(theme) => settingsMap.setKey('theme', theme)} />
      </FormItem>
      <FormItem label="Font Family">
        <SelectInput
          options={fontFamilyOptions}
          value={fontFamily}
          onChange={(fontFamily) => settingsMap.setKey('fontFamily', fontFamily)}
        />
      </FormItem>
      <FormItem label="Font Size">
        <NumberSlider
          value={fontSize}
          onChange={(fontSize) => settingsMap.setKey('fontSize', fontSize)}
          min={10}
          max={40}
          step={2}
        />
      </FormItem>
    </div>
  );
}
