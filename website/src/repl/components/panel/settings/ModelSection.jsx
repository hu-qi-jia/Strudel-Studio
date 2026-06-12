import { useStore } from '@nanostores/react';
import { $modelConfig, providerDefaults } from '../../../agent/store.mjs';
import { FormItem, SelectInput, NumberSlider } from '../Forms.jsx';

const providerOptions = {
  anthropic: 'Anthropic 兼容',
  openai: 'OpenAI 兼容',
  gemini: 'Gemini',
};

export function ModelSection() {
  const config = useStore($modelConfig);

  const updateField = (key, value) => {
    $modelConfig.setKey(key, value);
  };

  const handleProviderChange = (provider) => {
    const defaults = providerDefaults[provider];
    $modelConfig.setKey('provider', provider);
    $modelConfig.setKey('baseUrl', defaults.baseUrl);
    $modelConfig.setKey('model', defaults.model);
  };

  return (
    <div className="space-y-1 w-full">
      <FormItem label="Provider">
        <SelectInput
          options={providerOptions}
          value={config.provider}
          onChange={handleProviderChange}
        />
      </FormItem>

      <FormItem label="API Key" sublabel="stored locally, never sent to third-party servers">
        <input
          type="password"
          value={config.apiKey}
          onChange={(e) => updateField('apiKey', e.target.value)}
          placeholder="sk-..."
          className="w-full px-2 py-1 border outline-none text-foreground"
          style={{
            height: '32px',
            fontSize: 'var(--fs-input)',
            lineHeight: '1.4',
            backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
            borderColor: 'color-mix(in srgb, var(--foreground) 20%, transparent)',
            borderRadius: '0',
          }}
        />
      </FormItem>

      <FormItem label="Base URL" sublabel="leave empty to use default endpoint">
        <input
          type="text"
          value={config.baseUrl}
          onChange={(e) => updateField('baseUrl', e.target.value)}
          placeholder={providerDefaults[config.provider]?.baseUrl || ''}
          className="w-full px-2 py-1 border outline-none text-foreground"
          style={{
            height: '32px',
            fontSize: 'var(--fs-input)',
            lineHeight: '1.4',
            backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
            borderColor: 'color-mix(in srgb, var(--foreground) 20%, transparent)',
            borderRadius: '0',
          }}
        />
      </FormItem>

      <FormItem label="Model">
        <input
          type="text"
          value={config.model}
          onChange={(e) => updateField('model', e.target.value)}
          placeholder={providerDefaults[config.provider]?.model || ''}
          className="w-full px-2 py-1 border outline-none text-foreground"
          style={{
            height: '32px',
            fontSize: 'var(--fs-input)',
            lineHeight: '1.4',
            backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
            borderColor: 'color-mix(in srgb, var(--foreground) 20%, transparent)',
            borderRadius: '0',
          }}
        />
      </FormItem>

      <FormItem label="Temperature">
        <NumberSlider
          value={parseFloat(config.temperature) || 0.7}
          onChange={(v) => updateField('temperature', String(v))}
          min={0}
          max={2}
          step={0.1}
        />
      </FormItem>

      <FormItem label="Max Tokens">
        <NumberSlider
          value={parseInt(config.maxTokens) || 4096}
          onChange={(v) => updateField('maxTokens', String(v))}
          min={256}
          max={16384}
          step={256}
        />
      </FormItem>
    </div>
  );
}
