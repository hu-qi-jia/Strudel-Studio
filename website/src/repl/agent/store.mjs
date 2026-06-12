import { persistentMap } from '@nanostores/persistent';
import { atom } from 'nanostores';

export const $modelConfig = persistentMap('agent-model-', {
  provider: 'openai',
  apiKey: '',
  baseUrl: '',
  model: 'gpt-4o',
  maxTokens: '4096',
  temperature: '0.7',
});

export const $isAgentOpen = atom(false);

export const providerDefaults = {
  openai: {
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4o',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-20250514',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
  },
};
