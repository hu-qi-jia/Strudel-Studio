import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { streamText } from 'ai';
import { $modelConfig } from './store.mjs';
import { getModel, getProviderOptions, toCoreMessages } from './providers.mjs';
import { createTools } from './tools.mjs';
import { contextManager } from './ContextManager.mjs';
import { saveMessages, loadMessages, clearMessages } from './storage.mjs';
import { soundRegistry } from './SoundRegistry.mjs';
import { toolRegistry } from './ToolRegistry.mjs';
import { attachmentsCapability } from './attachments.mjs';
// 副作用导入：启动期注册内置插件（mp3-analyzer 等）。必须在任意 getTools/
// getRenderers/getChatInputActions 调用前完成——import 在模块体执行前解析，安全。
import './plugins/index.mjs';
import { $viewingPatternData } from '../../user_pattern_utils.mjs';

let messageIdCounter = 0;
function nextId() {
  return `msg_${Date.now()}_${++messageIdCounter}`;
}

/**
 * 从 viewingPatternData 中提取项目 ID
 * 格式: "pattern_{id}"
 */
function getProjectIdFromPattern(patternData) {
  try {
    const data = typeof patternData === 'string' ? JSON.parse(patternData) : patternData;
    if (data?.id) return `pattern_${data.id}`;
  } catch {}
  // fallback: 用 URL hash
  if (typeof window !== 'undefined') {
    return `hash_${window.location.hash || 'default'}`;
  }
  return 'default';
}

// ─── 任务完成护栏 ────────────────────────────────────────────
// 代码编辑类工具：只有这些工具成功执行（产出可播放代码）才算「完成任务」
const CODE_EDIT_TOOLS = new Set(['write_code', 'edit_lines', 'insert_code', 'replace_code']);

// 判定用户这次发言是否为「生成/修改类请求」——需要写出可播放代码才算完成。
// 对明显的提问/信息类（how/what/为什么/...吗？）返回 false，不强制写码。
// 偏好「宁可多触发」：在音乐 REPL 里，演示一段 pattern 几乎总是有益的；
// 而漏掉生成请求会导致 agent 停在中途（这正是要修的 bug）。
function isGenerationRequest(text) {
  const t = (text || '').trim();
  if (!t) return false;
  // 明显的提问/信息类：不强制写码
  if (/^(how|what|why|when|where|who|which|can you|could you|explain|tell me|what's|whats|does|do you|is there|are there|show me how)\b/i.test(t)) return false;
  if (/^(怎么|如何|啥|什么|为啥|为什么|为何|哪儿|哪里|是否|能否|能不能|可以吗|请问|介绍|解释|哪个|哪种|有没有)/.test(t)) return false;
  if (/[?？]\s*$/.test(t) || /(吗|嘛|呢)\s*[?？]?\s*$/.test(t) || /是不是|对不对|能不能/.test(t)) return false;
  // 控制类指令（停止/暂停/静音/清空/重置）：不需要写码
  if (/^(stop|pause|halt|silence|quiet|mute|clear|reset|turn off|undo)\b/i.test(t)) return false;
  if (/^(停|停下|停止|暂停|静音|关掉|关上|清空|清除|重置|取消|不要|别)/.test(t)) return false;
  // 生成/修改类：含音乐名词或生成/修改动词即触发
  return /\b(give|make|create|write|generate|play|produce|compose|drum|beat|melody|song|music|pattern|loop|bass|track|808|909|piano|chord|arp|sequence|riff|add|change|swap|replace|remove|turn|remix)\b|给我|来一|来个|来段|来首|来点|写一|写段|写首|生成|创作|做一|做段|做首|弄一|弄个|整一|整段|加点|加个|加上|再加|加|改成|改一|换成|变成|配一|编一|弹一|鼓|琴|贝斯|吉他|合成|节奏|旋律|和弦|低音|节拍|音色/i.test(t);
}

// 判定本轮（自 sinceIdx 起）是否已产出「成功播放的代码」
function turnProducedPlayingCode(messages, sinceIdx) {
  for (let i = sinceIdx; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    for (const inv of m.toolInvocations || []) {
      if (CODE_EDIT_TOOLS.has(inv.toolName) && inv.state === 'result') {
        const r = typeof inv.result === 'string' ? inv.result : '';
        // 与 tools.mjs 中各工具成功返回的措辞保持一致
        if (/playing|applied successfully|inserted at|replaced successfully|edited lines/i.test(r)) {
          return true;
        }
      }
    }
  }
  return false;
}

// 催办消息：模型在「只查询不写码」后停下时注入，强制其继续写出可播放代码。
// 仅进入模型输入，不写入 messagesRef / 不显示在 UI。
const CONTINUATION_NUDGE =
  'SYSTEM — CONTINUATION REQUIRED: Your previous turn ended WITHOUT writing any playing Strudel code (you only listed or described sounds). Listing sounds is NOT a complete answer to a music-generation request. Stop exploring. Do NOT call list_sounds again. Immediately call write_code with a concrete, playable Strudel pattern that fulfills the request — use a $: prefix on every simultaneous track. Only after it reports playing should you stop and briefly confirm to the user what you made.';

/**
 * useAgent - 封装所有 agent 逻辑，分离 UI 和业务
 */
export function useAgent(editorRef) {
  const modelConfig = useStore($modelConfig);
  const viewingPatternData = useStore($viewingPatternData);

  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [tokenUsage, setTokenUsage] = useState(null);
  const [stepCount, setStepCount] = useState(0);
  const [finishReason, setFinishReason] = useState(null);
  const [error, setError] = useState(null);

  const abortRef = useRef(null);
  const messagesEndRef = useRef(null);
  const saveTimerRef = useRef(null);
  const currentProjectIdRef = useRef(null);

  const messagesRef = useRef([]);
  // 跨护栏轮次累计的步数，用于「单次 sendMessage 总步数预算」，防止病态会话烧 token
  const totalStepsRef = useRef(0);

  // 核心 13 工具（一等公民，直接闭包 editorRef）+ 内置功能工具（默认全部启用，按 requires 自动最小授权）。
  const tools = useMemo(() => {
    const core = createTools(editorRef);
    const pluginDeps = { editorRef, soundRegistry, attachments: attachmentsCapability, allowedDomains: [] };
    return { ...core, ...toolRegistry.getTools(pluginDeps) };
  }, [editorRef]);

  // 内置功能贡献的对话输入动作 / 结果渲染器。注册表是静态单例（启动期 import 即注册），
  // 故空依赖即可——稳定 identity，避免每次渲染都返回新数组/对象触发下游多余重渲染。
  const chatInputActions = useMemo(() => toolRegistry.getChatInputActions(), []);
  const toolRenderers = useMemo(() => toolRegistry.getRenderers(), []);

  // ─── 项目隔离：监听 viewingPatternData 变化 ──────────────────

  useEffect(() => {
    const newProjectId = getProjectIdFromPattern(viewingPatternData);

    if (currentProjectIdRef.current === newProjectId) return;

    // 切换 pattern 前，必须中止在途的流。否则流的 flushNow/scheduleUpdate 会继续往
    // messagesRef 写旧项目内容，而下面 loadMessages 又把 messagesRef 换成新项目消息，
    // 导致跨项目污染；finally 里的 saveMessages 还会把污染数据存到新 projectId 下。
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // 同时清掉防抖保存定时器，避免切到新项目后用旧内容覆盖新项目的存储
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    setIsStreaming(false);

    // 先保存当前项目的消息
    if (currentProjectIdRef.current && messagesRef.current.length > 0) {
      saveMessages(currentProjectIdRef.current, messagesRef.current);
    }

    // 切换到新项目
    currentProjectIdRef.current = newProjectId;
    loadMessages(newProjectId).then((saved) => {
      setMessages(saved);
      messagesRef.current = saved;
      // 切换 pattern 时一并重置统计，避免显示上一个 pattern 的 token/step
      setTokenUsage(null);
      setStepCount(0);
      setFinishReason(null);
      setError(null);
    });
  }, [viewingPatternData]); // 关键：依赖 viewingPatternData

  // 自动保存（防抖 2 秒）
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (messagesRef.current.length > 0 && currentProjectIdRef.current) {
        saveMessages(currentProjectIdRef.current, messagesRef.current);
      }
    }, 2000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages]);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 发送消息
  const sendMessage = useCallback(
    async (text, attachments = []) => {
      if (!modelConfig.apiKey) return false;
      // 并发防护：流进行中拒绝新请求，避免两个流交错写入共享 messagesRef
      if (abortRef.current) return false;

      const userMessage = {
        id: nextId(),
        role: 'user',
        content: text,
        // 附件元数据（纯 JSON，可持久化）。二进制按 handleId 留在 IDB。
        attachments: Array.isArray(attachments) ? attachments : [],
      };
      const newMessages = [...messagesRef.current, userMessage];
      setMessages(newMessages);
      messagesRef.current = newMessages;
      setIsStreaming(true);
      setTokenUsage(null);
      setStepCount(0);
      setFinishReason(null);
      setError(null);
      totalStepsRef.current = 0;

      const abortController = new AbortController();
      abortRef.current = abortController;

      const config = $modelConfig.get();
      const model = getModel(config);

      // 本轮（用户这一次发言）在 messagesRef 中的起始下标，
      // 用于判断「这一轮是否真的产出了可播放代码」。
      const turnStartIdx = messagesRef.current.length;

      // 流式更新的缓冲区
      let pendingUpdate = null;
      let updateTimer = null;

      const flushUpdate = () => {
        if (pendingUpdate) {
          setMessages(pendingUpdate);
          messagesRef.current = pendingUpdate;
          pendingUpdate = null;
        }
        updateTimer = null;
      };

      const scheduleUpdate = (updater) => {
        const newMsgs = updater(messagesRef.current);
        messagesRef.current = newMsgs;
        pendingUpdate = newMsgs;
        if (!updateTimer) {
          updateTimer = setTimeout(flushUpdate, 50);
        }
      };

      const flushNow = (updater) => {
        const newMsgs = updater(messagesRef.current);
        setMessages(newMsgs);
        messagesRef.current = newMsgs;
        if (updateTimer) {
          clearTimeout(updateTimer);
          updateTimer = null;
          pendingUpdate = null;
        }
      };

      // 单轮 streamText 执行：构建 system + 输入消息、流式消费、收尾刷新。
      // isContinuation=true 时在输入末尾追加催办消息（催办只进模型输入，不入 UI/历史）。
      const runOneTurn = async (isContinuation) => {
        const currentCode = editorRef.current?.editor?.state?.doc.toString() ?? '';
        const system = contextManager.buildSystemPrompt(text, {
          messages: messagesRef.current,
          currentCode,
        });
        let coreInput = contextManager.compressMessages(toCoreMessages(messagesRef.current));
        if (isContinuation) {
          coreInput = [...coreInput, { role: 'user', content: CONTINUATION_NUDGE }];
        }

        const result = streamText({
          model,
          system,
          messages: coreInput,
          tools,
          toolChoice: 'auto',
          maxSteps: 100,
          maxRetries: 3, // 3.6: provider 429/5xx 自动重试，避免一次抖动就让用户手动重发
          maxTokens: parseInt(config.maxTokens, 10) || 16384,
          providerOptions: getProviderOptions(config),
          abortSignal: abortController.signal,
          onStepFinish: ({ usage: stepUsage }) => {
            setStepCount((prev) => prev + 1);
            totalStepsRef.current += 1; // 3.5: 跨护栏轮次的累计步数，用于总预算
            // 1.4: usage 以 onStepFinish 累加为唯一来源（跨护栏多轮也能正确累计）。
            // 不在 onFinish 里覆写——否则每个 continuation 轮都会把累计清成单轮值。
            if (stepUsage) {
              setTokenUsage((prev) => ({
                prompt: (prev?.prompt || 0) + (stepUsage.inputTokens || 0),
                completion: (prev?.completion || 0) + (stepUsage.outputTokens || 0),
                total: (prev?.total || 0) + (stepUsage.inputTokens || 0) + (stepUsage.outputTokens || 0),
              }));
            }
          },
          onFinish: ({ finishReason: reason }) => {
            // 只取 finishReason；usage 交给 onStepFinish 累加（见上）。
            if (reason) setFinishReason(reason);
          },
        });

        let currentAssistantId = null;
        let currentContent = '';
        let currentToolInvocations = [];
        // 3.7: 流级错误（非工具错误，如 schema/transport 错误）标记。
        // 工具错误（isToolError）由 SDK 反馈给模型继续，不算流级失败。
        let streamError = false;

        for await (const event of result.fullStream) {
          if (abortController.signal.aborted) break;

          try {
            switch (event.type) {
              case 'text-delta': {
                if (!currentAssistantId) {
                  currentAssistantId = nextId();
                  currentContent = '';
                  currentToolInvocations = [];
                  flushNow((prev) => [
                    ...prev,
                    { id: currentAssistantId, role: 'assistant', content: '', toolInvocations: [] },
                  ]);
                }
                currentContent += event.text;
                scheduleUpdate((prev) =>
                  prev.map((m) =>
                    m.id === currentAssistantId ? { ...m, content: currentContent } : m,
                  ),
                );
                break;
              }

              case 'tool-call': {
                if (!currentAssistantId) {
                  currentAssistantId = nextId();
                  currentContent = '';
                  currentToolInvocations = [];
                }
                currentToolInvocations = [
                  ...currentToolInvocations,
                  {
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    args: event.input,
                    state: 'call',
                  },
                ];
                flushNow((prev) => {
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
                currentToolInvocations = currentToolInvocations.map((inv) =>
                  inv.toolCallId === event.toolCallId
                    ? {
                        ...inv,
                        state: 'result',
                        result:
                          typeof event.output === 'string'
                            ? event.output
                            : JSON.stringify(event.output),
                        // 保留结构化产物供插件自定义渲染器使用（核心工具无渲染器，仍读 result 字符串，不受影响）。
                        resultData:
                          event.output && typeof event.output === 'object'
                            ? event.output
                            : undefined,
                      }
                    : inv,
                );
                flushNow((prev) =>
                  prev.map((m) =>
                    m.id === currentAssistantId
                      ? { ...m, toolInvocations: currentToolInvocations }
                      : m,
                  ),
                );
                break;
              }

              case 'finish-step': {
                if (updateTimer) {
                  clearTimeout(updateTimer);
                  updateTimer = null;
                }
                if (pendingUpdate) {
                  setMessages(pendingUpdate);
                  messagesRef.current = pendingUpdate;
                  pendingUpdate = null;
                }
                currentAssistantId = null;
                currentContent = '';
                currentToolInvocations = [];
                break;
              }

              case 'error': {
                const errorText = event.error?.message || String(event.error);
                const isToolError = event.error?.toolResult !== undefined;
                if (!isToolError) streamError = true; // 3.7: 标记流级失败，护栏据此停止重试
                if (currentAssistantId) {
                  flushNow((prev) =>
                    prev.map((m) =>
                      m.id === currentAssistantId
                        ? { ...m, content: currentContent || (isToolError ? '' : `Error: ${errorText}`) }
                        : m,
                    ),
                  );
                } else if (!isToolError) {
                  const errorId = nextId();
                  flushNow((prev) => [
                    ...prev,
                    { id: errorId, role: 'assistant', content: `Error: ${errorText}` },
                  ]);
                }
                if (!isToolError) {
                  setError(errorText);
                }
                break;
              }
            }
          } catch (eventError) {
            // 捕获单个事件处理的错误，避免整个流静默失败
            const errorText = eventError.message || String(eventError);
            console.error('[Agent] Event processing error:', eventError);
            if (currentAssistantId) {
              flushNow((prev) =>
                prev.map((m) =>
                  m.id === currentAssistantId
                    ? { ...m, content: currentContent || `Error processing event: ${errorText}` }
                    : m,
                ),
              );
            } else {
              const errorId = nextId();
              flushNow((prev) => [
                ...prev,
                { id: errorId, role: 'assistant', content: `Error: ${errorText}` },
              ]);
            }
            setError(errorText);
          }
        }

        // 流结束后刷新
        if (updateTimer) {
          clearTimeout(updateTimer);
          updateTimer = null;
        }
        if (pendingUpdate) {
          setMessages(pendingUpdate);
          messagesRef.current = pendingUpdate;
          pendingUpdate = null;
        }
        return { ok: !streamError };
      };

      // ─── 任务完成护栏 ───────────────────────────────────────
      // 模型有时在「查询音色」后自行停下、不写代码就结束。这里做结构化兜底：
      // 一轮跑完后，若是生成类请求却没产出可播放代码，就注入催办再跑一轮，最多 N 轮。
      try {
        const MAX_CONTINUATIONS = 3;
        // 3.5: 单次 sendMessage 的总步数预算（护栏多轮 × 每轮 maxSteps 的硬上限），
        // 防止病态会话无限烧 token。
        const STEP_BUDGET = 30;
        let continuationRound = 0;
        while (continuationRound <= MAX_CONTINUATIONS) {
          if (abortController.signal.aborted) break;
          if (totalStepsRef.current >= STEP_BUDGET) break; // 3.5: 触顶即停
          const turn = await runOneTurn(continuationRound > 0);
          if (abortController.signal.aborted) break;
          if (!turn.ok) break; // 3.7: 流级错误，不再重试（再开也是注定失败）
          if (continuationRound >= MAX_CONTINUATIONS) break;
          if (totalStepsRef.current >= STEP_BUDGET) break; // 3.5
          // 非生成类请求（提问/信息类）：文字回答即可，不强制写码
          if (!isGenerationRequest(text)) break;
          // 已写出可播放代码：任务完成
          if (turnProducedPlayingCode(messagesRef.current, turnStartIdx)) break;
          // 否则：模型停下却没写码 → 催办再来一轮
          continuationRound++;
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          let errorMsg = e.message || String(e);
          if (e.statusCode) {
            errorMsg = `API Error ${e.statusCode}: ${e.responseBody || e.message}`;
          } else if (e.cause) {
            errorMsg = `${e.message}: ${e.cause.message || e.cause}`;
          }
          flushNow((prev) => {
            const lastIdx = prev.findLastIndex((m) => m.role === 'assistant');
            if (lastIdx >= 0) {
              return prev.map((m, i) =>
                i === lastIdx ? { ...m, content: `Error: ${errorMsg}` } : m,
              );
            }
            return [...prev, { id: nextId(), role: 'assistant', content: `Error: ${errorMsg}` }];
          });
          setError(errorMsg);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
        // 3.8: 取消防抖保存定时器，避免流结束后陈旧的 autosave 用旧 messagesRef
        // 覆盖下面这次更新鲜的显式保存（IndexedDB put 是 last-write-wins）。
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        if (currentProjectIdRef.current) {
          saveMessages(currentProjectIdRef.current, messagesRef.current);
        }
      }

      return true;
    },
    [modelConfig.apiKey, tools],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    messagesRef.current = [];
    setTokenUsage(null);
    setStepCount(0);
    setFinishReason(null);
    setError(null);
    if (currentProjectIdRef.current) {
      clearMessages(currentProjectIdRef.current);
    }
  }, []);

  const needsConfig = !modelConfig.apiKey;

  return {
    messages,
    isStreaming,
    tokenUsage,
    stepCount,
    finishReason,
    error,
    needsConfig,
    messagesEndRef,
    sendMessage,
    stop,
    clearHistory,
    // 内置功能贡献的对话输入动作（如「上传音频」按钮）/ 结果渲染器（供 ChatMessage 分发）
    chatInputActions,
    toolRenderers,
  };
}
