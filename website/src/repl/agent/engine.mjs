// engine.mjs — 流式执行引擎。
//
// 从 useAgent.jsx 抽出的两块「框架无关」逻辑（见 agent 评审 Tier 4）：
//   1. MessageBuffer —— 「立即写 ref + 50ms 批量写 React state」的合并语义，让高频
//      text-delta 不逐字符触发重渲染，而 tool-call / finish-step 即时可见。
//   2. streamAssistantTurn —— 单轮 streamText 的事件循环（reasoning / text / tool-call /
//      tool-result / finish-step / error），消费 fullStream，收尾刷新。
// React state 写回经 buffer 的回调完成，故本模块不直接依赖 React，可在 node 下静态分析。

import { streamText } from 'ai';
import { getProviderOptions } from './providers.mjs';
// STATIC_PREFIX 用于 Anthropic prompt caching：system prompt 的静态前缀在请求间不变，
// 打上 cacheControl 后 Anthropic 缓存这段 ~1.2k token，后续请求命中缓存省 90% 输入 token。
// 非 Anthropic provider 不拆分，system 仍为字符串（零开销）。
import { STATIC_PREFIX } from './ContextManager.mjs';

/**
 * 为 Anthropic provider 把 system prompt 拆成 [静态前缀(缓存), 动态部分] 两段。
 * 静态前缀在请求间不变 → Anthropic cacheControl 命中 → 省 ~90% 输入 token。
 * 非 Anthropic provider 直接返回原字符串（零开销）。
 *
 * @param {string} system - 完整 system prompt
 * @param {object} config - modelConfig 快照（取 provider）
 * @returns {string|Array} 字符串（非 Anthropic）或 system parts 数组（Anthropic）
 */
function formatSystemForProvider(system, config) {
  if (config?.provider !== 'anthropic') return system;
  // system 以 STATIC_PREFIX 开头（buildSystemPrompt 第一行就是 prompt = STATIC_PREFIX）
  if (typeof system !== 'string' || !system.startsWith(STATIC_PREFIX)) {
    return system; // 结构不符预期，安全回退
  }
  const dynamicPart = system.slice(STATIC_PREFIX.length);
  const parts = [
    {
      type: 'text',
      text: STATIC_PREFIX,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
  ];
  if (dynamicPart) {
    parts.push({ type: 'text', text: dynamicPart });
  }
  return parts;
}

/**
 * 工具调用可观测性：把工具输入摘要为可读字符串（截断长参数，避免日志爆炸）。
 * 只取关键参数（code/start_line/keyword/handleId 等），其余参数名列出但不展开值。
 */
function summarizeToolInput(toolName, input) {
  if (!input || typeof input !== 'object') return input;
  const keys = Object.keys(input);
  if (keys.length === 0) return '{}';
  // 关键参数：截断到 80 字符
  const parts = [];
  for (const k of keys) {
    const v = input[k];
    let s;
    if (typeof v === 'string') {
      s = v.length > 80 ? v.slice(0, 80) + '…' : v;
      // 代码类参数只取首行
      if (k === 'code' || k === 'new_code') {
        const firstLine = v.split('\n')[0];
        s = firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine;
        s = `"${s}" (${v.split('\n').length} lines)`;
      } else {
        s = `"${s}"`;
      }
    } else {
      s = String(v);
    }
    parts.push(`${k}=${s}`);
  }
  return `{${parts.join(', ')}}`;
}

let _id = 0;
/** 单调递增的消息 id（跨 hook 实例也唯一，避免热重载后 id 碰撞）。 */
export function nextId() {
  return `msg_${Date.now()}_${++_id}`;
}

export class MessageBuffer {
  // get:    () => 当前 messages（读 ref，保证 updater 看到最新值）
  // commit: (m) => 立即写 ref（同上）
  // render: (m) => 写 React state（UI）
  // schedule 立刻 commit ref 但把 render 批量到 50ms 后；flushNow 立刻 commit+render
  // 并取消挂起的批量；flushPending 把挂起的批量立刻 render。
  constructor({ get, commit, render }) {
    this._get = get;
    this._commit = commit;
    this._render = render;
    this._pending = null;
    this._timer = null;
  }
  schedule(updater) {
    const next = updater(this._get());
    this._commit(next);
    this._pending = next;
    if (!this._timer) this._timer = setTimeout(() => this._flush(), 50);
  }
  flushNow(updater) {
    const next = updater(this._get());
    this._commit(next);
    this._render(next);
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
      this._pending = null;
    }
  }
  _flush() {
    if (this._pending) {
      this._render(this._pending);
      this._pending = null;
    }
    this._timer = null;
  }
  flushPending() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._pending) {
      this._render(this._pending);
      this._pending = null;
    }
  }
}

/**
 * 单轮 streamText 执行：消费 fullStream 事件，写入 buffer，收尾刷新。
 * @param {object} o
 * @param {object} o.model    AI SDK model 实例
 * @param {string} o.system   system prompt
 * @param {Array}  o.messages core messages（已压缩）
 * @param {object} o.tools    AI SDK tools 映射
 * @param {object} o.config   $modelConfig 快照（取 maxTokens 等）
 * @param {AbortSignal} o.signal
 * @param {MessageBuffer} o.buffer
 * @param {(usage)=>void} [o.onStep]   onStepFinish 回调（步数/token/预算闸）
 * @param {(reason)=>void} [o.onFinish]
 * @returns {Promise<{ok: boolean}>} ok=false 表示流级错误（非工具错误），调用方据此重试
 */
export async function streamAssistantTurn({ model, system, messages, tools, config, signal, buffer, onStep, onFinish, onError }) {
  const result = streamText({
    model,
    system: formatSystemForProvider(system, config),
    messages,
    tools,
    toolChoice: 'auto',
    maxSteps: 100,
    maxRetries: 3, // provider 429/5xx 自动重试，避免一次抖动就让用户手动重发
    maxTokens: parseInt(config.maxTokens, 10) || 16384,
    providerOptions: getProviderOptions(config),
    abortSignal: signal,
    onStepFinish: onStep,
    onFinish: ({ finishReason: reason }) => {
      // 只取 finishReason；usage 交给 onStep 累加（见 useAgent 的 onStep）。
      if (reason && onFinish) onFinish(reason);
    },
  });

  let currentAssistantId = null;
  let currentContent = '';
  let currentReasoning = '';
  let currentToolInvocations = [];
  // 流级错误（非工具错误，如 schema/transport 错误）标记。
  // 工具错误（isToolError）由 SDK 反馈给模型继续，不算流级失败。
  let streamError = false;

  // 工具调用可观测性：记录每个 tool-call 的开始时间，在 tool-result 时计算耗时。
  // 用 console.debug（默认不显示，浏览器 console 开启 Verbose 级别才可见），
  // 不影响生产性能，调试时一键开启即可看到完整工具调用链。
  const toolCallStartTimes = new Map();

  const ensureAssistant = (withReasoning = false) => {
    if (currentAssistantId) return;
    currentAssistantId = nextId();
    currentContent = '';
    currentReasoning = '';
    currentToolInvocations = [];
    const seed = withReasoning
      ? { id: currentAssistantId, role: 'assistant', content: '', reasoning: '', toolInvocations: [] }
      : { id: currentAssistantId, role: 'assistant', content: '', toolInvocations: [] };
    buffer.flushNow((prev) => [...prev, seed]);
  };

  for await (const event of result.fullStream) {
    if (signal.aborted) break;

    try {
      switch (event.type) {
        // 推理/思考流（AI SDK v6）：reasoning-start / reasoning-delta / reasoning-end。
        // 原生支持思考的模型走这条；GLM/DeepSeek/Qwen 等把 <think>...</think> 当普通文本，
        // 走 text-delta，由 ChatMessage 的 <think> 解析折叠——两条路在 UI 都折叠展示。
        // reasoning 只进 UI（message.reasoning），不回灌给模型（toCoreMessages 忽略它），
        // 避免某些 provider 把外部 reasoning 文本当作非法输入。
        case 'reasoning-start': {
          ensureAssistant(true);
          if (event.text) {
            // 部分实现把首段文本放在 start.text；累积它（与 delta 合并）。
            currentReasoning += event.text;
            buffer.schedule((prev) =>
              prev.map((m) => (m.id === currentAssistantId ? { ...m, reasoning: currentReasoning } : m)),
            );
          }
          break;
        }
        case 'reasoning-delta': {
          ensureAssistant(true);
          if (event.textDelta) {
            currentReasoning += event.textDelta;
            buffer.schedule((prev) =>
              prev.map((m) => (m.id === currentAssistantId ? { ...m, reasoning: currentReasoning } : m)),
            );
          }
          break;
        }
        case 'reasoning-end': {
          // reasoning-end 有时会重复全文——忽略，避免与累积的 delta 重复拼接。
          break;
        }
        case 'text-delta': {
          ensureAssistant(false);
          currentContent += event.text;
          buffer.schedule((prev) =>
            prev.map((m) => (m.id === currentAssistantId ? { ...m, content: currentContent } : m)),
          );
          break;
        }

        case 'tool-call': {
          ensureAssistant(false);
          // 可观测性：记录工具调用开始
          toolCallStartTimes.set(event.toolCallId, performance.now());
          console.debug(`[tool] → ${event.toolName}`, summarizeToolInput(event.toolName, event.input));
          currentToolInvocations = [
            ...currentToolInvocations,
            {
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.input,
              state: 'call',
            },
          ];
          buffer.flushNow((prev) => {
            const exists = prev.find((m) => m.id === currentAssistantId);
            if (exists) {
              return prev.map((m) =>
                m.id === currentAssistantId
                  ? { ...m, content: currentContent, toolInvocations: currentToolInvocations }
                  : m,
              );
            }
            return [
              ...prev,
              { id: currentAssistantId, role: 'assistant', content: currentContent, toolInvocations: currentToolInvocations },
            ];
          });
          break;
        }

        case 'tool-result': {
          // 可观测性：记录工具调用完成（耗时 + 状态）
          const startTime = toolCallStartTimes.get(event.toolCallId);
          if (startTime) {
            const duration = (performance.now() - startTime).toFixed(0);
            const output = event.output;
            const status = output && typeof output === 'object'
              ? (output.ok ? 'ok' : 'err')
              : 'done';
            console.debug(`[tool] ← ${event.toolName} (${duration}ms, ${status})`);
            toolCallStartTimes.delete(event.toolCallId);
          }
          currentToolInvocations = currentToolInvocations.map((inv) =>
            inv.toolCallId === event.toolCallId
              ? {
                  ...inv,
                  state: 'result',
                  result:
                    typeof event.output === 'string'
                      ? event.output
                      : // 结构化工具返回（如 code-edit 的 { ok, playing, message }）：
                        // 取 message 给模型/UI 展示，避免把对象 JSON.stringify 成丑字符串。
                        // 仍把完整对象存到 resultData，供护栏读 playing、插件渲染器读字段。
                        event.output?.message ?? JSON.stringify(event.output),
                  // 保留结构化产物供护栏（turnProducedPlayingCode 读 playing）
                  // 与插件自定义渲染器使用（核心工具无渲染器，仍读 result 字符串，不受影响）。
                  resultData:
                    event.output && typeof event.output === 'object' ? event.output : undefined,
                }
              : inv,
          );
          buffer.flushNow((prev) =>
            prev.map((m) =>
              m.id === currentAssistantId ? { ...m, toolInvocations: currentToolInvocations } : m,
            ),
          );
          break;
        }

        case 'finish-step': {
          buffer.flushPending();
          currentAssistantId = null;
          currentContent = '';
          currentReasoning = '';
          currentToolInvocations = [];
          break;
        }

        case 'error': {
          const errorText = event.error?.message || String(event.error);
          const isToolError = event.error?.toolResult !== undefined;
          if (!isToolError) streamError = true; // 流级失败，调用方据此重试
          if (currentAssistantId) {
            buffer.flushNow((prev) =>
              prev.map((m) =>
                m.id === currentAssistantId
                  ? { ...m, content: currentContent || (isToolError ? '' : `Error: ${errorText}`) }
                  : m,
              ),
            );
          } else if (!isToolError) {
            const errorId = nextId();
            buffer.flushNow((prev) => [
              ...prev,
              { id: errorId, role: 'assistant', content: `Error: ${errorText}` },
            ]);
          }
          if (!isToolError && onError) onError(errorText);
          break;
        }
      }
    } catch (eventError) {
      // 捕获单个事件处理的错误，避免整个流静默失败。
      // 注意：与 error 事件不同，事件处理异常不标记 streamError（保持与重构前一致——
      // 这类异常极罕见，原实现也未据此触发重试）。仅写错误消息 + 通知调用方。
      const errorText = eventError.message || String(eventError);
      console.error('[Agent] Event processing error:', eventError);
      if (currentAssistantId) {
        buffer.flushNow((prev) =>
          prev.map((m) =>
            m.id === currentAssistantId
              ? { ...m, content: currentContent || `Error processing event: ${errorText}` }
              : m,
          ),
        );
      } else {
        const errorId = nextId();
        buffer.flushNow((prev) => [...prev, { id: errorId, role: 'assistant', content: `Error: ${errorText}` }]);
      }
      if (onError) onError(errorText);
    }
  }

  // 流结束后刷新
  buffer.flushPending();
  return { ok: !streamError };
}
