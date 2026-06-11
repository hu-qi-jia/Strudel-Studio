// settings sub-tabs
import { useState } from 'react';
import { useSettings } from '../../../settings.mjs';
import { AudioSection } from './settings/AudioSection.jsx';
import { AppearanceSection } from './settings/AppearanceSection.jsx';
import { EditorSection } from './settings/EditorSection.jsx';

const TABS = [
  { key: 'audio', label: 'audio' },
  { key: 'appearance', label: 'appearance' },
  { key: 'editor', label: 'editor' },
];

const SECTIONS = {
  audio: AudioSection,
  appearance: AppearanceSection,
  editor: EditorSection,
};

export function SettingsTab({ started }) {
  const [activeTab, setActiveTab] = useState('audio');
  const { fontFamily } = useSettings();
  const ActiveSection = SECTIONS[activeTab];

  return (
    <div className="text-foreground w-full min-w-0 font-[inherit]" style={{ fontFamily }}>
      {/* 子标签栏 */}
      <div
        className="flex border-b px-2"
        style={{ borderColor: 'color-mix(in srgb, var(--foreground) 12%, transparent)' }}
      >
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-3 py-1.5 text-[var(--fs-label)] transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === key ? 'text-foreground border-b-2 border-[var(--caret)]' : ''
            }`}
            style={activeTab !== key ? { color: 'color-mix(in srgb, var(--foreground) 40%, transparent)' } : {}}
          >
            {label}
          </button>
        ))}
      </div>
      {/* 内容区 */}
      <div className="px-3 py-2 space-y-0 overflow-y-auto min-w-0">
        <ActiveSection started={started} />
      </div>
    </div>
  );
}
