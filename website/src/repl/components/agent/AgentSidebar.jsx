import { useState, useCallback } from 'react';
import cx from '@src/cx.mjs';
import { useSettings, setIsAgentOpen, setIsPanelOpened } from '../../../settings.mjs';
import { useAgent } from '../../agent/useAgent.jsx';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ResizeHandle } from '../ResizeHandle';
import { XMarkIcon } from '@heroicons/react/16/solid';

export function AgentSidebar({ context }) {
  const { editorRef } = context;
  const { fontFamily } = useSettings();
  const [width, setWidth] = useState(360);

  const {
    messages,
    isStreaming,
    tokenUsage,
    stepCount,
    finishReason,
    needsConfig,
    messagesEndRef,
    sendMessage,
    stop,
    clearHistory,
    chatInputActions,
    toolRenderers,
  } = useAgent(editorRef);

  const handleResize = useCallback((newWidth) => setWidth(newWidth), []);

  const handleSend = useCallback(
    async (text, attachments) => {
      if (needsConfig) {
        setIsPanelOpened(true);
        return;
      }
      await sendMessage(text, attachments);
    },
    [needsConfig, sendMessage],
  );

  return (
    <div
      className={cx('flex bg-lineHighlight text-foreground overflow-hidden border-l')}
      style={{
        width: `${width}px`,
        fontFamily,
        borderColor: 'color-mix(in srgb, var(--foreground) 10%, transparent)',
      }}
    >
      <ResizeHandle side="left" onResize={handleResize} minSize={280} maxSize={600} />

      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-2 py-1.5 flex-shrink-0 border-b"
          style={{ borderColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)' }}
        >
          <span className="text-[var(--fs-label)] font-medium select-none">agent</span>
          <div className="flex items-center gap-1.5">
            {isStreaming && stepCount > 0 && (
              <span
                className="text-[var(--fs-label)] select-none"
                style={{ color: 'color-mix(in srgb, var(--foreground) 40%, transparent)' }}
              >
                step {stepCount}
              </span>
            )}
            {tokenUsage && (
              <span
                className="text-[var(--fs-label)] select-none"
                style={{ color: 'color-mix(in srgb, var(--foreground) 35%, transparent)' }}
                title={`prompt: ${tokenUsage.prompt} / completion: ${tokenUsage.completion}${finishReason ? `\nfinish: ${finishReason}` : ''}`}
              >
                {tokenUsage.total}t
              </span>
            )}
            {messages.length > 0 && (
              <button
                onClick={clearHistory}
                className="text-foreground hover:opacity-50 cursor-pointer p-0.5 text-[var(--fs-label)]"
                title="clear chat"
              >
                clear
              </button>
            )}
            <button
              onClick={() => setIsAgentOpen(false)}
              className="text-foreground hover:opacity-50 cursor-pointer flex items-center justify-center w-6 h-6 rounded hover:bg-foreground/10 transition-colors"
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
            <ChatMessage key={msg.id} message={msg} renderers={toolRenderers} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入框 */}
        <ChatInput
          onSend={handleSend}
          disabled={isStreaming}
          onStop={stop}
          chatInputActions={chatInputActions}
        />
      </div>
    </div>
  );
}
