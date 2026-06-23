import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { generateText } from 'ai';
import { $modelConfig } from './store.mjs';
import { MessageBuffer, streamAssistantTurn, nextId } from './engine.mjs';
import { getModel, getProviderOptions, toCoreMessages, getContextBudget } from './providers.mjs';
import { createTools } from './tools.mjs';
import { contextManager, DEFAULT_CONTEXT_BUDGET } from './ContextManager.mjs';
import {
  isGenerationRequest,
  turnProducedPlayingCode,
  buildContinuationNudge,
  STEP_BUDGET,
  COST_BUDGET_TOKENS,
  REPEAT_TOOL_LIMIT,
  costBudgetExceeded,
  detectRepeatedToolCall,
} from './Guardrail.mjs';
// 可调参数集中表（步数/重试/预算/成本护栏）。调参改 config.mjs 即可，不必动业务逻辑。
import {
  MAX_CONTINUATIONS,
  MAX_STREAM_RETRIES,
  STREAM_RETRY_DELAY,
  COMPRESS_KEEP_PAIRS,
  ENABLE_INTENT_DETECTION,
} from './config.mjs';
import { saveMessages, loadMessages, clearMessages } from './storage.mjs';
import { soundRegistry } from './SoundRegistry.mjs';
import { toolRegistry } from './ToolRegistry.mjs';
import { attachmentsCapability } from './attachments.mjs';
// 内置插件（mp3-analyzer 等）在 ToolRegistry 构造时硬编码注册，无需副作用 import。
import { $viewingPatternData } from '../../user_pattern_utils.mjs';

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
// 判定逻辑（isGenerationRequest / turnProducedPlayingCode）、催办函数
// (buildContinuationNudge)、单次请求总步数预算 (STEP_BUDGET) 抽到纯模块 Guardrail.mjs，
// 便于用普通 node 单测覆盖（useAgent 依赖 React，无法直接在 node 下 import 测试）。

// 把消息历史压成纯文本摘要输入（给「压缩上下文」用）。
// 超长时截断最旧部分，避免单次摘要请求过大。
function buildTranscript(messages, maxChars = 24000) {
  const lines = [];
  for (const m of messages) {
    const who = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : m.role;
    let body = typeof m.content === 'string' ? m.content : '';
    if (Array.isArray(m.toolInvocations)) {
      for (const inv of m.toolInvocations) {
        const res = typeof inv.result === 'string' ? inv.result : '';
        body += `\n[tool:${inv.toolName}] ${res}`;
      }
    }
    if (body.trim()) lines.push(`${who}: ${body.trim()}`);
  }
  let text = lines.join('\n\n');
  if (text.length > maxChars) {
    text = '[…earlier truncated…]\n\n' + text.slice(text.length - maxChars);
  }
  return text;
}

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
  // 「压缩上下文」进行中（禁用按钮 + 显示 …）。
  const [isCompressing, setIsCompressing] = useState(false);
  // p2/p6 human-in-the-loop：工具调用前需用户确认（write_code 全量替换 / analyze_pattern_audio 中断播放）。
  // pendingApproval 形如 { info, resolve }：info 给 UI 渲染（diff/提示），resolve(true|false) 结束等待。
  const [pendingApproval, setPendingApproval] = useState(null);

  const abortRef = useRef(null);
  const messagesEndRef = useRef(null);
  const saveTimerRef = useRef(null);
  const currentProjectIdRef = useRef(null);
  // 切项目竞态守卫令牌：连续快速切 A→B 时，loadMessages 的两次 promise 谁后 resolve
  // 谁就赢 setMessages。用单调递增令牌让陈旧 resolve 自我丢弃（见下方 effect）。
  const loadTokenRef = useRef(0);

  const messagesRef = useRef([]);
  // 跨护栏轮次累计的步数，用于「单次 sendMessage 总步数预算」，防止病态会话烧 token
  const totalStepsRef = useRef(0);
  // 成本护栏：单次 sendMessage 累计 token（跨护栏多轮）。onStep 里累加，触顶即 abort。
  const tokenTotalRef = useRef(0);
  // 重复调用检测：单次 sendMessage 内的工具调用序列（{toolName, args}）。
  // onStep 里追加，detectRepeatedToolCall 据此判定是否卡在循环。
  const callHistoryRef = useRef([]);

  // ─── p2/p6 human-in-the-loop 确认回路 ───────────────────────
  // requestApproval(info) 返回 Promise<boolean>：工具调用前 await 它，
  // UI 拿 info 渲染 diff 预览 / 中断提示 + 批准/拒绝按钮；
  // 用户点击 → approveApproval/rejectApproval 用 functional setState 拿到当前
  // pendingApproval 调用 resolve(true|false) 解除 await，并清空 state。
  const requestApproval = useCallback((info) => {
    return new Promise((resolve) => {
      setPendingApproval({ info, resolve });
    });
  }, []);
  const approveApproval = useCallback(() => {
    setPendingApproval((cur) => {
      if (cur?.resolve) cur.resolve(true);
      return null;
    });
  }, []);
  const rejectApproval = useCallback(() => {
    setPendingApproval((cur) => {
      if (cur?.resolve) cur.resolve(false);
      return null;
    });
  }, []);

  // 核心 13 工具（一等公民，直接闭包 editorRef）+ 内置功能工具（默认全部启用，按 requires 自动最小授权）。
  const tools = useMemo(() => {
    const core = createTools(editorRef, { requestApproval });
    const pluginDeps = { editorRef, soundRegistry, attachments: attachmentsCapability, allowedDomains: [] };
    return { ...core, ...toolRegistry.getTools(pluginDeps) };
  }, [editorRef, requestApproval]);

  // 内置功能贡献的对话输入动作 / 结果渲染器。注册表是静态单例（启动期 import 即注册），
  // 故空依赖即可——稳定 identity，避免每次渲染都返回新数组/对象触发下游多余重渲染。
  const chatInputActions = useMemo(() => toolRegistry.getChatInputActions(), []);
  const toolRenderers = useMemo(() => toolRegistry.getRenderers(), []);

  // ─── 项目隔离：监听 viewingPatternData 变化 ──────────────────

  useEffect(() => {
    const newProjectId = getProjectIdFromPattern(viewingPatternData);

    if (currentProjectIdRef.current === newProjectId) return;

    // 切换 pattern 前，必须中止在途的流。否则流的 buffer 会继续往
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
    // 竞态守卫：连续快速切 A→B 时，两次 loadMessages 的 promise 谁后 resolve 谁就赢
    // setMessages，可能把 A 的对话显示 / autosave 到 B 名下。用单调递增令牌丢弃陈旧结果
    // ——只有「最近一次切换」的 load resolve 才生效。
    const myToken = ++loadTokenRef.current;
    loadMessages(newProjectId).then((saved) => {
      if (loadTokenRef.current !== myToken) return; // 已被更新的切换取代，丢弃
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
      // 无 key：内联给出可见提示，而非静默 return false（用户 otherwise 只看到「没反应」）。
      // 不记录用户输入——配置 key 后让其重新发送，避免历史里留下「问了但没答」的孤儿消息。
      if (!modelConfig.apiKey) {
        const hint = {
          id: nextId(),
          role: 'assistant',
          content: 'Set your API key in **Settings → Model** to start using the agent.',
        };
        messagesRef.current = [...messagesRef.current, hint];
        setMessages(messagesRef.current);
        return false;
      }
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
      tokenTotalRef.current = 0; // 成本护栏计数器随新请求归零
      callHistoryRef.current = []; // 重复检测历史随新请求归零

      const abortController = new AbortController();
      abortRef.current = abortController;

      const config = $modelConfig.get();
      const model = getModel(config);

      // 本轮（用户这一次发言）在 messagesRef 中的起始下标，
      // 用于判断「这一轮是否真的产出了可播放代码」。
      const turnStartIdx = messagesRef.current.length;

      // 流式更新的缓冲区（封装「立即写 ref + 50ms 批量写 React state」语义，见 engine.mjs）
      const buffer = new MessageBuffer({
        get: () => messagesRef.current,
        commit: (m) => {
          messagesRef.current = m;
        },
        render: (m) => setMessages(m),
      });

      // 单轮执行：构建 system + 输入消息，交给 engine.streamAssistantTurn 流式消费 + 收尾刷新。
      // isContinuation=true 时在输入末尾追加催办消息（催办只进模型输入，不入 UI/历史）。
      const runTurn = async (isContinuation) => {
        const currentCode = editorRef.current?.editor?.state?.doc.toString() ?? '';
        const system = contextManager.buildSystemPrompt(text, {
          messages: messagesRef.current,
          currentCode,
        });
        // 按 provider 动态上下文预算（Gemini 800k / Claude 160k / GPT-4o 100k），
        // 替代原先硬编码 30000——长会话不再被无谓压缩，Gemini 用户可用满 1M 窗口。
        const contextBudget = getContextBudget(config, DEFAULT_CONTEXT_BUDGET);
        let coreInput = contextManager.compressMessages(toCoreMessages(messagesRef.current), contextBudget);
        if (isContinuation) {
          // 催办消息：模型停下却没写码时，注入一条提示让它继续。
          // buildContinuationNudge 包含原始用户请求摘要——长对话压缩后
          // compressMessages 可能丢弃较早的消息，但催办中的请求摘要确保
          // 模型始终知道用户要什么，不会因丢失上下文而反复空转。
          coreInput = [...coreInput, { role: 'user', content: buildContinuationNudge(text) }];
        }
        return streamAssistantTurn({
          model,
          system,
          messages: coreInput,
          tools,
          config,
          signal: abortController.signal,
          buffer,
          onStep: ({ usage: stepUsage, toolCalls }) => {
            setStepCount((prev) => prev + 1);
            totalStepsRef.current += 1; // 跨护栏轮次的累计步数，用于总预算
            // 成本闸：单次 sendMessage 的总步数触顶（STEP_BUDGET）即立刻 abort。
            // maxSteps 是「单轮」上限，STEP_BUDGET 是「单次请求」上限；这里在每步回调里
            // 堵住——一旦跨轮累计达预算，连当前这轮也一并中止（正常任务远不到，永不触发）。
            if (totalStepsRef.current >= STEP_BUDGET && !abortController.signal.aborted) {
              abortController.abort();
            }
            // usage 以 onStepFinish 累加为唯一来源（跨护栏多轮也能正确累计）。
            if (stepUsage) {
              tokenTotalRef.current +=
                (stepUsage.inputTokens || 0) + (stepUsage.outputTokens || 0);
              setTokenUsage((prev) => ({
                prompt: (prev?.prompt || 0) + (stepUsage.inputTokens || 0),
                completion: (prev?.completion || 0) + (stepUsage.outputTokens || 0),
                total: (prev?.total || 0) + (stepUsage.inputTokens || 0) + (stepUsage.outputTokens || 0),
              }));
              // 成本护栏：累计 token 触顶（COST_BUDGET_TOKENS）即 abort。
              // 防病态会话烧钱——50 步 × 4k token ≈ 200k，与 Claude 上下文对齐。
              // COST_BUDGET_TOKENS=0 表示不限制（见 config.mjs）。
              const cost = costBudgetExceeded(tokenTotalRef.current);
              if (cost.exceeded && !abortController.signal.aborted) {
                abortController.abort();
              }
            }
            // 重复调用检测：同工具同参数连续 > REPEAT_TOOL_LIMIT 次 = 卡循环，立即 abort。
            // 典型场景：模型反复 list_sounds 相同参数、反复 write_code 相同代码。
            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
              for (const tc of toolCalls) {
                callHistoryRef.current.push({ toolName: tc.toolName, args: tc.input });
              }
              const rep = detectRepeatedToolCall(callHistoryRef.current);
              if (rep.repeated && !abortController.signal.aborted) {
                abortController.abort();
              }
            }
          },
          onFinish: (reason) => {
            if (reason) setFinishReason(reason);
          },
          onError: (errorText) => setError(errorText),
        });
      };

      // ─── 任务完成护栏 ───────────────────────────────────────
      // 模型有时在「查询音色」后自行停下、不写代码就结束。这里做结构化兜底：
      // 一轮跑完后，若是生成类请求却没产出可播放代码，就注入催办再跑一轮，最多 N 轮。
      // 流级错误（网络抖动、provider 5xx 抖动等）不再直接放弃——重试若干次，
      // 因为这类错误往往是暂时的，重试即可恢复，避免用户手动重发。
      try {
        // MAX_CONTINUATIONS / MAX_STREAM_RETRIES / STREAM_RETRY_DELAY 来自 config.mjs（顶部 import）
        let continuationRound = 0;
        let streamRetries = 0;
        while (continuationRound <= MAX_CONTINUATIONS) {
          if (abortController.signal.aborted) break;
          if (totalStepsRef.current >= STEP_BUDGET) break; // 3.5: 触顶即停
          const turn = await runTurn(continuationRound > 0);
          if (abortController.signal.aborted) break;
          // 流级错误重试：网络抖动 / provider 5xx 抖动等暂时性错误重试即可恢复。
          // 之前直接 break 会导致用户看到「Error: ...」且任务中断，需手动重发。
          if (!turn.ok) {
            if (streamRetries < MAX_STREAM_RETRIES && !abortController.signal.aborted) {
              streamRetries++;
              // 重试静默进行：不再把「_[retrying...]_」写进对话流（污染 transcript）。
              // 用户侧的可见反馈由 isStreaming + 输入框「thinking…」placeholder 承担。
              await new Promise((r) => setTimeout(r, STREAM_RETRY_DELAY));
              // 重试时不递增 continuationRound（这不是催办，是同一轮的重试）
              continue;
            }
            break; // 重试耗尽，真正放弃
          }
          // 成功一轮后重置流级重试计数（下一轮的暂时性错误独立计数）
          streamRetries = 0;
          if (continuationRound >= MAX_CONTINUATIONS) break;
          if (totalStepsRef.current >= STEP_BUDGET) break; // 3.5
          // 非生成类请求（仅在启用意图检测时判断）：文字回答即可，不强制写码。
          // ENABLE_INTENT_DETECTION=false 时跳过此判断——假设所有请求都可能需要写码，
          // 让 turnProducedPlayingCode 统一决定是否需要继续。
          if (ENABLE_INTENT_DETECTION && !isGenerationRequest(text)) break;
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
          buffer.flushNow((prev) => {
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
    // 若工具正停在 requestApproval 等用户确认，stop 时一并拒绝，
    // 否则 Promise 永悬、UI 卡在确认框（流已 abort 但 await 无人解除）。
    setPendingApproval((cur) => {
      if (cur?.resolve) cur.resolve(false);
      return null;
    });
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

  // 上下文估算（供 UI「ctx X / 预算」显示）。粗略：4 字符 ≈ 1 token。
  // 预算按 provider 动态：Gemini 800k / Claude 160k / GPT-4o 100k，未知回退 DEFAULT_CONTEXT_BUDGET。
  const contextInfo = useMemo(
    () => ({
      tokens: contextManager.estimateContextTokens(messages),
      count: messages.length,
      budget: getContextBudget(modelConfig, DEFAULT_CONTEXT_BUDGET),
    }),
    [messages, modelConfig],
  );

  // 压缩上下文：把较早的对话用模型压成摘要，保留最近 KEEP 轮原文。
  // 独立于 sendMessage 主循环——只在空闲时运行，失败则历史不变。
  const compressHistory = useCallback(async () => {
    if (!modelConfig.apiKey) return;
    // 流式进行中或在压缩中，忽略；避免与 sendMessage 交错写 messagesRef。
    if (abortRef.current || isCompressing) return;
    const msgs = messagesRef.current;
    const KEEP = COMPRESS_KEEP_PAIRS;
    // 至少要有值得压缩的旧消息，否则 no-op。
    if (msgs.length <= KEEP + 1) return;
    const oldMsgs = msgs.slice(0, msgs.length - KEEP);
    const recentMsgs = msgs.slice(msgs.length - KEEP);

    setIsCompressing(true);
    try {
      const transcript = buildTranscript(oldMsgs);
      const config = $modelConfig.get();
      const model = getModel(config);
      const result = await generateText({
        model,
        maxTokens: 1024,
        providerOptions: getProviderOptions(config),
        messages: [
          {
            role: 'system',
            content:
              'You compress a Strudel (TidalCycles) music live-coding chat into a concise continuity summary. Preserve compactly: user goals/intents; key musical decisions (tempo cpm/cps, genre/style, sounds, structure); the final Strudel code patterns created or edited (quote them verbatim — they are the source of truth); unresolved issues. Drop chitchat and failed attempts. Aim for ≤400 words. Output only the summary, no preamble.',
          },
          { role: 'user', content: transcript },
        ],
      });
      const summary = (result?.text || '').trim();
      if (!summary) return; // 空摘要：保持历史不变
      const summaryMsg = {
        id: nextId(),
        role: 'user',
        content: `[此前对话已压缩为摘要]\n${summary}`,
      };
      const newMsgs = [summaryMsg, ...recentMsgs];
      messagesRef.current = newMsgs;
      setMessages(newMsgs);
      setTokenUsage(null); // 压缩后旧的「本轮」统计不再相关
      if (currentProjectIdRef.current) {
        saveMessages(currentProjectIdRef.current, newMsgs);
      }
    } catch (e) {
      // 失败：历史不动，在对话里给一条可见的错误提示。
      const errorMsg = `上下文压缩失败：${e?.message || e}`;
      const errorAssistant = { id: nextId(), role: 'assistant', content: errorMsg };
      const newMsgs = [...messagesRef.current, errorAssistant];
      messagesRef.current = newMsgs;
      setMessages(newMsgs);
    } finally {
      setIsCompressing(false);
    }
  }, [modelConfig.apiKey, isCompressing]);

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
    // 上下文估算（tokens/count/budget）+ 手动压缩 + 压缩中标志
    contextInfo,
    compressHistory,
    isCompressing,
    // p2/p6 human-in-the-loop：工具调用前的确认回路（write_code diff / analyze_pattern_audio 中断提示）
    pendingApproval,
    approveApproval,
    rejectApproval,
  };
}
