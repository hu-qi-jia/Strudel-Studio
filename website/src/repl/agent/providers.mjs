// providers.mjs - AI SDK provider 创建 + 消息转换
// System Prompt 已迁移到 ContextManager.mjs（动态构建）
// 意图检测已移除 - 使用 toolChoice: 'auto' 让 LLM 自己决定

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { modelMessageSchema } from 'ai';
import { formatBytes } from './utils.mjs';

/**
 * Create AI SDK model instance from config.
 * OpenAI compatible mode uses .chat() for Chat Completions API,
 * since third-party providers don't support the Responses API.
 */
export function getModel(config) {
  const temperature = parseFloat(config.temperature) || 0.7;

  switch (config.provider) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || undefined,
      });
      return openai.chat(config.model, { temperature });
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || undefined,
        headers: {
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      });
      return anthropic(config.model, { temperature });
    }
    case 'gemini': {
      const google = createGoogleGenerativeAI({
        apiKey: config.apiKey,
      });
      return google(config.model, { temperature });
    }
    default: {
      const openai = createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl || undefined,
      });
      return openai.chat(config.model, { temperature });
    }
  }
}

/**
 * Build providerOptions for streamText based on config.
 */
export function getProviderOptions(config) {
  const options = {};
  if (config.provider === 'openai') {
    options.openai = {
      parallelToolCalls: config.parallelToolCalls !== 'false',
    };
  }
  return options;
}

// ─── 按 provider 的上下文预算（token）──────────────────────────────────
// 不同模型上下文窗口差异巨大：Gemini 2.5 有 1M，Claude 200k，GPT-4o 128k。
// 原先 DEFAULT_CONTEXT_BUDGET=30000 硬编码对待所有模型——Gemini 用户白白浪费 970k，
// 长会话被无谓压缩。这里按 provider 给出推荐预算，ContextManager / useAgent 据此动态覆盖。
//
// 取值保守：留 20% 余量给 system prompt + 工具定义，避免触顶。
// 用户仍可在 config.mjs 的 DEFAULT_CONTEXT_BUDGET 调整未知 provider 的回退值。
export const CONTEXT_BUDGETS = {
  gemini: 800000, // Gemini 2.5: 1M 窗口，留 20% 余量
  anthropic: 160000, // Claude: 200k 窗口，留 20% 余量
  openai: 100000, // GPT-4o: 128k 窗口，留 ~20% 余量
};

// 按 config.provider 返回上下文预算。未知 provider 回退到 DEFAULT_CONTEXT_BUDGET。
export function getContextBudget(config, fallback) {
  const budget = CONTEXT_BUDGETS[config?.provider];
  return budget || fallback;
}

// ─── Message Conversion ──────────────────────────────────────────────

export function toCoreMessages(uiMessages) {
  const result = [];
  for (const msg of uiMessages) {
    if (msg.role === 'user') {
      // 跨 provider 安全：不向模型发原始音频（仅 Gemini 可靠支持，Anthropic 不支持）。
      // 改为把附件以「合成文本提示」告知模型——含 handleId，让模型调本地工具分析。
      // content 仍为字符串，不破坏 ContextManager 的 token 估算 / 关键词收集。
      let content = msg.content || '';
      const atts = Array.isArray(msg.attachments) ? msg.attachments : [];
      if (atts.length > 0) {
        const lines = atts.map(
          (a) =>
            `- "${a.name}" (${a.mime}, ${formatBytes(a.size)}) — read it via a tool using handleId="${a.handleId}"`,
        );
        content +=
          `\n\n[User attached ${atts.length} file(s). Do not assume their contents — use the provided tools ` +
          `(e.g. analyze_audio with the handleId) to inspect them, then act on what the tool returns.]\n` +
          lines.join('\n');
      }
      result.push({ role: 'user', content });
    } else if (msg.role === 'assistant') {
      // 只保留「已完成且结构完整」的工具调用：toolCallId / toolName 缺失会导致
      // assistant 的 tool-call 与随后的 tool-result 无法配对，触发 v6 schema 校验失败。
      // 这些调用会同时从 assistant(tool-call) 和 tool(tool-result) 两侧剔除，保持配对。
      const completedInvocations = (msg.toolInvocations || []).filter(
        (inv) =>
          inv.state === 'result' &&
          typeof inv.toolCallId === 'string' &&
          inv.toolCallId.length > 0 &&
          typeof inv.toolName === 'string' &&
          inv.toolName.length > 0,
      );
      const hasToolCalls = completedInvocations.length > 0;

      // 构建 assistant 消息的 content parts
      const parts = [];

      // 添加 text part（如果有内容）
      if (msg.content && msg.content.trim()) {
        parts.push({ type: 'text', text: msg.content });
      }

      // 添加 tool-call parts
      for (const inv of completedInvocations) {
        parts.push({
          type: 'tool-call',
          toolCallId: inv.toolCallId,
          toolName: inv.toolName,
          input: inv.args,
        });
      }

      // 跳过空消息
      if (parts.length === 0) continue;

      // 添加 assistant 消息
      result.push({ role: 'assistant', content: parts });

      // 如果有工具调用,添加对应的 tool 消息
      if (hasToolCalls) {
        const toolResults = completedInvocations.map((inv) => {
          // AI SDK v6: tool-result 的 output 必须是 discriminated union：
          //   { type: 'text', value: string } | { type: 'json', value: JSONValue }
          // 绝不能用 { result: ... } 这种任意对象——v6 的 zod 校验会抛
          // "The messages do not match the ModelMessage[] schema"。
          // inv.result 在 tool-result 事件回调里已被规范化为字符串，统一按 text 包装。
          const value =
            typeof inv.result === 'string'
              ? inv.result
              : inv.result == null
                ? '(no output)'
                : JSON.stringify(inv.result);
          return {
            type: 'tool-result',
            toolCallId: inv.toolCallId,
            toolName: inv.toolName,
            output: { type: 'text', value },
          };
        });

        result.push({
          role: 'tool',
          content: toolResults,
        });
      }
    }
  }
  // 开发期护栏：用 SDK 自带的 ModelMessage[] schema 校验产物。
  // 手写的 toCoreMessages 是 schema 错误的高发面（曾因 output 格式不匹配 v6 触发
  // "messages do not match the ModelMessage[] schema"）。DEV 模式下尽早暴露，
  // 生产模式不付出运行时开销。
  if (import.meta.env?.DEV) {
    const r = modelMessageSchema.array().safeParse(result);
    if (!r.success) {
      console.error(
        '[agent] toCoreMessages produced invalid ModelMessage[]:',
        r.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
        result,
      );
    }
  }
  return result;
}
