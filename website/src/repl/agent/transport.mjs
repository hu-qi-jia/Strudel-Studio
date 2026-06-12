import { getProvider, SYSTEM_PROMPT } from './providers.mjs';
import { editorTools, executeTool } from './tools.mjs';

export class DirectLLMTransport {
  constructor(getConfig, getEditorRef) {
    this.getConfig = getConfig;
    this.getEditorRef = getEditorRef;
  }

  async sendMessage({ messages, abortSignal }) {
    const config = this.getConfig();
    const provider = getProvider(config.provider);

    // 构造消息列表
    const allMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages,
    ];

    // 格式化消息
    const formattedMessages = provider.formatMessages(allMessages);

    // 发起流式请求
    const response = await provider.streamChat(
      formattedMessages,
      config,
      editorTools,
      abortSignal,
    );

    return this.processStream(response, provider, config, abortSignal);
  }

  async processStream(response, provider, config, abortSignal) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    // 使用 Map 按索引管理多个 tool call
    let toolCallsMap = new Map();

    // 返回一个可迭代的流式结果
    const stream = {
      async *[Symbol.asyncIterator]() {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const parsed = provider.parseSSELine(line);
              if (!parsed) continue;

              const result = parseProviderEvent(config.provider, parsed);
              if (!result) continue;

              if (result.done) {
                const toolCalls = Array.from(toolCallsMap.values());
                yield { type: 'done', content: fullContent, toolCalls };
                return;
              }

              if (result.content) {
                fullContent += result.content;
                yield { type: 'text', content: result.content };
              }

              // 处理多个 tool calls（OpenAI 格式，带 index）
              if (result.toolCalls) {
                for (const tc of result.toolCalls) {
                  const idx = tc.index ?? toolCallsMap.size;
                  if (tc.id) {
                    toolCallsMap.set(idx, {
                      id: tc.id,
                      name: tc.name,
                      args: tc.args || '',
                    });
                  } else if (toolCallsMap.has(idx)) {
                    const existing = toolCallsMap.get(idx);
                    if (tc.args) {
                      existing.args += tc.args;
                    }
                  }
                }
              }

              // 处理单个 toolCall（Anthropic/Gemini 格式）
              if (result.toolCall) {
                if (result.toolCall.id) {
                  const idx = toolCallsMap.size;
                  toolCallsMap.set(idx, {
                    id: result.toolCall.id,
                    name: result.toolCall.name,
                    args: result.toolCall.args || '',
                  });
                } else {
                  // 追加 args 到最后一个 tool call
                  const lastKey = toolCallsMap.size - 1;
                  if (lastKey >= 0 && toolCallsMap.has(lastKey)) {
                    const existing = toolCallsMap.get(lastKey);
                    if (result.toolCall.args) {
                      existing.args += result.toolCall.args;
                    }
                  }
                }
              }
            }
          }

          // 流结束但没收到 done 信号
          const toolCalls = Array.from(toolCallsMap.values());
          yield { type: 'done', content: fullContent, toolCalls };
        } catch (e) {
          if (e.name === 'AbortError') {
            const toolCalls = Array.from(toolCallsMap.values());
            yield { type: 'done', content: fullContent, toolCalls };
          } else {
            yield { type: 'error', error: e.message };
          }
        }
      },
    };

    return stream;
  }

  // 执行工具调用并返回结果
  async executeToolCalls(toolCalls) {
    const editorRef = this.getEditorRef();
    const results = [];
    for (const tc of toolCalls) {
      let args = {};
      try {
        args = typeof tc.args === 'string' ? JSON.parse(tc.args) : tc.args || {};
      } catch {
        args = {};
      }
      const result = executeTool(tc.name, args, editorRef);
      results.push({
        toolCallId: tc.id,
        toolName: tc.name,
        result: typeof result === 'string' ? result : JSON.stringify(result),
      });
    }
    return results;
  }
}

// 解析不同 provider 的 SSE 事件
function parseProviderEvent(provider, event) {
  switch (provider) {
    case 'openai':
      return parseOpenAIEvent(event);
    case 'anthropic':
      return parseAnthropicEvent(event);
    case 'gemini':
      return parseGeminiEvent(event);
    default:
      return parseOpenAIEvent(event);
  }
}

function parseOpenAIEvent(data) {
  if (data.done) return { done: true };

  const delta = data.choices?.[0]?.delta;
  if (!delta) return null;

  const result = {};

  if (delta.content) {
    result.content = delta.content;
  }

  // 处理多个 tool calls，保留 index 信息
  if (delta.tool_calls && delta.tool_calls.length > 0) {
    result.toolCalls = delta.tool_calls.map((tc) => ({
      index: tc.index ?? 0,
      id: tc.id || undefined,
      name: tc.function?.name || undefined,
      args: tc.function?.arguments || undefined,
    }));
  }

  if (data.choices?.[0]?.finish_reason === 'stop' || data.choices?.[0]?.finish_reason === 'tool_calls') {
    result.done = true;
  }

  return Object.keys(result).length > 0 ? result : null;
}

function parseAnthropicEvent(data) {
  if (data.type === 'message_stop') return { done: true };

  if (data.type === 'content_block_delta') {
    if (data.delta?.type === 'text_delta') {
      return { content: data.delta.text };
    }
    if (data.delta?.type === 'input_json_delta') {
      return {
        toolCall: { args: data.delta.partial_json },
      };
    }
  }

  if (data.type === 'content_block_start') {
    if (data.content_block?.type === 'tool_use') {
      return {
        toolCall: {
          id: data.content_block.id,
          name: data.content_block.name,
        },
      };
    }
  }

  return null;
}

function parseGeminiEvent(data) {
  if (!data.candidates?.[0]) return null;

  const candidate = data.candidates[0];
  const part = candidate.content?.parts?.[0];

  if (!part) return null;

  if (part.text) {
    return { content: part.text };
  }

  if (part.functionCall) {
    return {
      toolCall: {
        id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: part.functionCall.name,
        args: JSON.stringify(part.functionCall.args || {}),
      },
    };
  }

  if (candidate.finishReason === 'STOP') {
    return { done: true };
  }

  return null;
}
