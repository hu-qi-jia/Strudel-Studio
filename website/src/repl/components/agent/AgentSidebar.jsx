import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useStore } from '@nanostores/react';
import cx from '@src/cx.mjs';
import { useSettings, setIsAgentOpen, setIsPanelOpened } from '../../../settings.mjs';
import { $modelConfig } from '../../agent/store.mjs';
import { DirectLLMTransport } from '../../agent/transport.mjs';
import { executeTool } from '../../agent/tools.mjs';
import { saveMessages, loadMessages, getProjectId, clearMessages } from '../../agent/storage.mjs';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ResizeHandle } from '../ResizeHandle';
import { XMarkIcon } from '@heroicons/react/16/solid';

let messageIdCounter = 0;
function nextId() {
  return `msg_${Date.now()}_${++messageIdCounter}`;
}

export function AgentSidebar({ context }) {
  const { editorRef } = context;
  const { fontFamily } = useSettings();
  const modelConfig = useStore($modelConfig);

  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [width, setWidth] = useState(360);
  const abortRef = useRef(null);
  const messagesEndRef = useRef(null);
  const saveTimerRef = useRef(null);
  const loadedProjectRef = useRef(null);

  const transport = useMemo(
    () =>
      new DirectLLMTransport(
        () => $modelConfig.get(),
        () => editorRef,
      ),
    [editorRef],
  );

  useEffect(() => {
    const projectId = getProjectId();
    if (loadedProjectRef.current === projectId) return;
    loadedProjectRef.current = projectId;
    loadMessages(projectId).then((saved) => {
      if (saved.length > 0) {
        setMessages(saved);
      }
    });
  }, []);

  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (messages.length > 0) {
        saveMessages(getProjectId(), messages);
      }
    }, 1000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleResize = useCallback((newWidth) => {
    setWidth(newWidth);
  }, []);

  const handleSend = useCallback(
    async (text) => {
      if (!modelConfig.apiKey) {
        setIsPanelOpened(true);
        return;
      }

      const userMessage = { id: nextId(), role: 'user', content: text };
      const newMessages = [...messages, userMessage];
      setMessages(newMessages);
      setIsStreaming(true);

      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        let currentMessages = newMessages;

        // 循环处理多轮 tool calls
        while (true) {
          const stream = await transport.sendMessage({
            messages: currentMessages.filter((m) => m.role !== 'system'),
            abortSignal: abortController.signal,
          });

          const assistantMessage = {
            id: nextId(),
            role: 'assistant',
            content: '',
            toolInvocations: [],
          };
          setMessages((prev) => [...prev, assistantMessage]);

          let fullContent = '';
          let toolCalls = [];

          for await (const chunk of stream) {
            if (chunk.type === 'text') {
              fullContent += chunk.content;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, content: fullContent }
                    : m,
                ),
              );
            } else if (chunk.type === 'done') {
              fullContent = chunk.content || fullContent;
              toolCalls = chunk.toolCalls || [];
            } else if (chunk.type === 'error') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMessage.id
                    ? { ...m, content: `Error: ${chunk.error}` }
                    : m,
                ),
              );
              return;
            }
          }

          // 没有 tool calls，对话结束
          if (toolCalls.length === 0) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessage.id
                  ? { ...m, content: fullContent }
                  : m,
              ),
            );
            break;
          }

          // 处理 tool calls
          const toolInvocations = toolCalls.map((tc) => ({
            toolCallId: tc.id,
            toolName: tc.name,
            args: typeof tc.args === 'string' ? (() => { try { return JSON.parse(tc.args); } catch { return {}; } })() : tc.args || {},
            state: 'call',
          }));

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessage.id
                ? { ...m, content: fullContent, toolInvocations }
                : m,
            ),
          );

          const toolResults = await transport.executeToolCalls(toolCalls);

          const updatedInvocations = toolInvocations.map((inv, i) => ({
            ...inv,
            state: 'result',
            result: toolResults[i]?.result,
          }));

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessage.id
                ? { ...m, toolInvocations: updatedInvocations }
                : m,
            ),
          );

          const toolResultMessages = toolResults.map((tr) => ({
            id: nextId(),
            role: 'tool',
            toolCallId: tr.toolCallId,
            toolName: tr.toolName,
            content: tr.result,
          }));

          // 更新 currentMessages 用于下一轮请求
          currentMessages = [
            ...currentMessages,
            { ...assistantMessage, content: fullContent, toolInvocations: updatedInvocations },
            ...toolResultMessages,
          ];

          // 在 UI 中添加 tool result 消息
          setMessages((prev) => [...prev, ...toolResultMessages]);

          // 继续循环，获取 follow-up 响应
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          setMessages((prev) => {
            const lastIdx = prev.findLastIndex((m) => m.role === 'assistant');
            if (lastIdx >= 0) {
              return prev.map((m, i) =>
                i === lastIdx ? { ...m, content: `Error: ${e.message}` } : m,
              );
            }
            return [...prev, { id: nextId(), role: 'assistant', content: `Error: ${e.message}` }];
          });
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, modelConfig.apiKey, transport],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
  }, []);

  const handleClear = useCallback(() => {
    setMessages([]);
    clearMessages(getProjectId());
  }, []);

  return (
    <div
      className={cx(
        'flex bg-lineHighlight text-foreground overflow-hidden border-l',
      )}
      style={{
        width: `${width}px`,
        fontFamily,
        borderColor: 'color-mix(in srgb, var(--foreground) 10%, transparent)',
      }}
    >
      {/* 拖拽手柄 - 左边缘 */}
      <ResizeHandle side="left" onResize={handleResize} minSize={280} maxSize={600} />

      {/* 内容区 */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {/* 标题栏 - 与 SoundsSidebar 一致 */}
        <div
          className="flex items-center justify-between px-2 py-1.5 flex-shrink-0 border-b"
          style={{ borderColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)' }}
        >
          <span className="text-[var(--fs-label)] font-medium select-none">agent</span>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={handleClear}
                className="text-foreground hover:opacity-50 cursor-pointer p-0.5 text-[var(--fs-label)]"
                title="clear chat"
              >
                clear
              </button>
            )}
            <button
              onClick={() => setIsAgentOpen(false)}
              className="text-foreground hover:opacity-50 cursor-pointer p-0.5 flex items-center justify-center"
            >
              <XMarkIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 消息列表 */}
        <div className="flex-1 overflow-auto p-2 space-y-3 min-h-0">
          {messages.length === 0 && (
            <div
              className="flex items-center justify-center h-full text-[var(--fs-label)]"
              style={{ color: 'color-mix(in srgb, var(--foreground) 30%, transparent)' }}
            >
              <span>ask agent to write or modify code</span>
            </div>
          )}
          {messages.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入框 */}
        <ChatInput onSend={handleSend} disabled={isStreaming} onStop={handleStop} />
      </div>
    </div>
  );
}
