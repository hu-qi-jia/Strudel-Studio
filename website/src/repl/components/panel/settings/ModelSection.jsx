import { useStore } from '@nanostores/react';
import { $modelConfig, providerDefaults } from '../../../agent/store.mjs';
import { FormItem, SelectInput, NumberSlider, Checkbox } from '../Forms.jsx';

const providerOptions = {
  anthropic: 'Anthropic Compatible',
  openai: 'OpenAI Compatible',
  gemini: 'Gemini',
};

const providerHints = {
  openai: {
    urlSublabel: 'Compatible with DeepSeek, Moonshot, GLM, etc.',
    urlPlaceholder: 'https://api.openai.com/v1',
    modelPlaceholder: 'gpt-4o / deepseek-chat / moonshot-v1-8k',
  },
  anthropic: {
    urlSublabel: 'Compatible with Anthropic-format third-party APIs',
    urlPlaceholder: 'https://api.anthropic.com/v1',
    modelPlaceholder: 'claude-sonnet-4-20250514',
  },
  gemini: {
    urlSublabel: 'Google Gemini API, no Base URL required',
    urlPlaceholder: '',
    modelPlaceholder: 'gemini-2.5-flash',
  },
};

export function ModelSection() {
  const config = useStore($modelConfig);
  const hints = providerHints[config.provider] || providerHints.openai;

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

      <FormItem
        label="API Key"
        sublabel="stored in this browser only (localStorage) — anyone with page/XSS access can read it. Use a key you can rotate."
      >
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

      <FormItem label="Base URL" sublabel={hints.urlSublabel}>
        <input
          type="text"
          value={config.baseUrl}
          onChange={(e) => updateField('baseUrl', e.target.value)}
          placeholder={hints.urlPlaceholder}
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
          placeholder={hints.modelPlaceholder}
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
          max={65536}
          step={1024}
        />
      </FormItem>

      <FormItem label="Advanced">
        <div className="flex flex-col gap-2">
          {config.provider === 'openai' && (
            <>
              <Checkbox
                label="Parallel Tool Calls"
                value={config.parallelToolCalls !== 'false'}
                onChange={(e) => updateField('parallelToolCalls', e.target.checked ? 'true' : 'false')}
              />
              <span
                className="text-[var(--fs-hint)]"
                style={{ color: 'color-mix(in srgb, var(--foreground) 40%, transparent)' }}
              >
                Allow the model to call multiple tools simultaneously. Off by default — code-editing tools share editor state and can race if run in parallel.
              </span>
            </>
          )}
        </div>
      </FormItem>
    </div>
  );
}
