import { editorTools } from './tools.mjs';

const SYSTEM_PROMPT = `You are an AI assistant for Strudel, a music live-coding environment based on TidalCycles.
You help users write, modify, and debug Strudel code.
Use the provided tools to read and modify the code in the editor.

Strudel uses mini notation to describe musical patterns, for example:
- s("bd sd hh oh") plays drum hits
- note("c3 eb3 g3").s("sawtooth") plays notes
- $: prefix means the pattern loops every cycle
- .bank("tr909") switches drum machine sound bank
- .slow(2) slows the pattern down by 2x
- .fast(2) speeds the pattern up by 2x
- .rev() reverses the pattern
- .every(3, x => x.rev()) applies an effect every 3rd cycle

CRITICAL - The following methods/functions do NOT exist in Strudel and will cause "is not defined" errors:
- ❌ .reverb() — does NOT exist! Use .room() and .size() instead
- ❌ .echo() — does NOT exist! Use .delay() instead
- ❌ .chorus() — does NOT exist!
- ❌ .flanger() — does NOT exist!
- ❌ .phaser() — does NOT exist!
- ❌ .compressor() — does NOT exist!
- ❌ .limiter() — does NOT exist!
- ❌ .wah() — does NOT exist!
- ❌ .tremolo() — DOES exist but only for specific synth types

Available effects and controls (method chains on patterns):
- Reverb: .room(0.7).size(0.8) — room sets reverb level, size sets room size
- Delay: .delay(0.5).delaytime(0.25).delayfeedback(0.7)
- Filter: .lpf(1000).lpq(5) for low-pass, .hpf(500) for high-pass
- Distortion: .shape(0.5) or .drive(0.5)
- Gain: .gain(0.8) or .amp(0.8)
- Panning: .pan(0.5)
- Dry/Wet: .dry(0.5) (0=wet, 1=dry)
- Crush/bitcrush: .crush(8)
- Attack/Release: .attack(0.01).release(0.3)
- Sustain: .sustain(0.5)
- Band-pass filter: .bandf(1000).bandq(5)

Common sound sources:
- .s("piano") or .s("superpiano") for piano sounds
- .s("sawtooth"), .s("supersaw") for saw waves
- .s("square"), .s("supersquare") for square waves
- .s("sine"), .s("supersine") for sine waves
- .s("bd"), .s("sd"), .s("hh"), .s("oh") for drum hits

Example piano with reverb:
note("c3 e3 g3 c4").s("superpiano").room(0.7).size(0.8).gain(0.8)

When the user asks to modify code, first use read_code to see the current code, then use write_code or replace_code to modify it.
After modifying, you can use execute_code to let the user hear the result.
Always explain what you are doing and why.`;

// OpenAI 兼容 provider（覆盖 DeepSeek、Ollama、one-api 等兼容端点）
const openaiProvider = {
  async streamChat(messages, config, tools, signal) {
    const url = `${config.baseUrl || 'https://api.openai.com'}/v1/chat/completions`;
    const body = {
      model: config.model,
      messages,
      stream: true,
      temperature: parseFloat(config.temperature) || 0.7,
      max_tokens: parseInt(config.maxTokens) || 4096,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error: ${res.status} ${err}`);
    }
    return res;
  },

  formatMessages(messages) {
    const formatted = messages
      .filter((m) => m.role !== 'system' || m.role === 'system')
      .map((m) => {
        const msg = { role: m.role, content: m.content || '' };
        // 处理工具调用
        if (m.toolInvocations && m.toolInvocations.length > 0) {
          msg.tool_calls = m.toolInvocations.map((inv) => ({
            id: inv.toolCallId,
            type: 'function',
            function: {
              name: inv.toolName,
              arguments: JSON.stringify(inv.args),
            },
          }));
          // 如果有 tool_calls，content 可能为空
          if (!msg.content) delete msg.content;
        }
        // 工具结果消息
        if (m.role === 'tool') {
          msg.tool_call_id = m.toolCallId;
          msg.content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        }
        return msg;
      });

    // 验证：确保每个 assistant 的 tool_calls 都有对应的 tool result
    const validated = [];
    for (let i = 0; i < formatted.length; i++) {
      const msg = formatted[i];
      validated.push(msg);

      if (msg.role === 'assistant' && msg.tool_calls) {
        const toolCallIds = msg.tool_calls.map((tc) => tc.id);
        const resultIds = [];
        for (let j = i + 1; j < formatted.length; j++) {
          if (formatted[j].role === 'tool') {
            resultIds.push(formatted[j].tool_call_id);
          } else {
            break;
          }
        }
        const missingIds = toolCallIds.filter((id) => !resultIds.includes(id));
        for (const id of missingIds) {
          validated.push({
            role: 'tool',
            tool_call_id: id,
            content: 'Tool execution result not available',
          });
        }
      }
    }

    return validated;
  },

  parseSSELine(line) {
    if (!line || !line.startsWith('data: ')) return null;
    const data = line.slice(6).trim();
    if (data === '[DONE]') return { done: true };
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  },
};

// Anthropic 兼容 provider
const anthropicProvider = {
  async streamChat(messages, config, tools, signal) {
    const url = `${config.baseUrl || 'https://api.anthropic.com'}/v1/messages`;
    // 分离 system 消息
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');
    const body = {
      model: config.model,
      messages: nonSystemMessages,
      stream: true,
      max_tokens: parseInt(config.maxTokens) || 4096,
      temperature: parseFloat(config.temperature) || 0.7,
    };
    if (systemMessages.length > 0) {
      body.system = systemMessages.map((m) => ({ type: 'text', text: m.content })).pop().text;
    }
    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error: ${res.status} ${err}`);
    }
    return res;
  },

  formatMessages(messages) {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: m.toolCallId,
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
              },
            ],
          };
        }
        const msg = { role: m.role, content: m.content || '' };
        if (m.toolInvocations && m.toolInvocations.length > 0) {
          msg.content = m.content || '';
          msg.content = [
            ...(msg.content ? [{ type: 'text', text: msg.content }] : []),
            ...m.toolInvocations.map((inv) => ({
              type: 'tool_use',
              id: inv.toolCallId,
              name: inv.toolName,
              input: inv.args,
            })),
          ];
        }
        return msg;
      });
  },

  parseSSELine(line) {
    if (!line || !line.startsWith('data: ')) return null;
    const data = line.slice(6).trim();
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  },
};

// Gemini provider
const geminiProvider = {
  async streamChat(messages, config, tools, signal) {
    const url = `${config.baseUrl || 'https://generativelanguage.googleapis.com'}/v1beta/models/${config.model}:streamGenerateContent?alt=sse&key=${config.apiKey}`;
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        const role = m.role === 'assistant' ? 'model' : 'user';
        const parts = [];
        if (m.content) {
          parts.push({ text: m.content });
        }
        if (m.toolInvocations) {
          for (const inv of m.toolInvocations) {
            parts.push({
              functionCall: { name: inv.toolName, args: inv.args },
            });
          }
        }
        if (m.role === 'tool') {
          parts.push({
            functionResponse: {
              name: m.toolName || 'unknown',
              response: { result: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) },
            },
          });
        }
        return { role, parts };
      });
    const body = {
      contents,
      generationConfig: {
        temperature: parseFloat(config.temperature) || 0.7,
        maxOutputTokens: parseInt(config.maxTokens) || 4096,
      },
    };
    // system instruction
    const systemMsg = messages.find((m) => m.role === 'system');
    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }
    if (tools && tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          })),
        },
      ];
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API error: ${res.status} ${err}`);
    }
    return res;
  },

  formatMessages(messages) {
    return messages; // Gemini uses its own format in streamChat
  },

  parseSSELine(line) {
    if (!line || !line.startsWith('data: ')) return null;
    const data = line.slice(6).trim();
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  },
};

export function getProvider(name) {
  switch (name) {
    case 'openai':
      return openaiProvider;
    case 'anthropic':
      return anthropicProvider;
    case 'gemini':
      return geminiProvider;
    default:
      return openaiProvider;
  }
}

export { SYSTEM_PROMPT };
