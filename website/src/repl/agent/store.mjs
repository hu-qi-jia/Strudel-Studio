import { persistentMap } from '@nanostores/persistent';
import { atom } from 'nanostores';

export const $modelConfig = persistentMap('agent-model-', {
  provider: 'openai',
  apiKey: '',
  baseUrl: '',
  model: 'gpt-4o',
  maxTokens: '16384',
  temperature: '0.7',
  // 默认串行：编辑器类工具共享 editor 状态与 savedCode 试听态，
  // 并行调用会在 await 边界互相覆盖（3.4）。用户仍可在设置里手动开启。
  parallelToolCalls: 'false',
});

export const $isAgentOpen = atom(false);

export const providerDefaults = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
  },
  gemini: {
    baseUrl: '',
    model: 'gemini-2.5-flash',
  },
};
