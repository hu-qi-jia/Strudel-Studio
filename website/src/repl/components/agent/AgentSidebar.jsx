import { useState, useCallback, useMemo } from 'react';
import { useSettings, setIsAgentOpen } from '../../../settings.mjs';
import { useAgent } from '../../agent/useAgent.jsx';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ResizeHandle } from '../ResizeHandle';
import { XMarkIcon } from '@heroicons/react/16/solid';
import './agent.css';

// Empty state examples: click to send, lowering the barrier for "what can I ask?"
const EXAMPLES = [
  'give me a lo-fi drum beat',
  'make a 4-track house beat',
  'add reverb to the piano',
  'write a C minor bass line',
];

// ─── p2/p6 human-in-the-loop approval card ───────────────────────────
// Before tool call (write_code full replace / analyze_pattern_audio interrupt playback),
// show preview to user + approve/reject.
// write_code: show old→new line-level diff preview (naive line-by-line comparison,
// sufficient for quick preview in live-coding scenarios).
// analyze_pattern_audio: show notification about playback interruption.
function simpleLineDiff(oldText, newText) {
  // Naive line-by-line diff: same lines → context, different lines → del+add.
  // May have noise for mid-section insert/delete, but in live-coding scenarios
  // agent mostly does full rewrites or local edits, line-by-line comparison
  // is enough for users to quickly see "what changed".
  // Full Myers diff would be over-engineering for this use case.
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);
  const rows = [];
  for (let i = 0; i < maxLen; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === n) {
      rows.push({ type: 'ctx', text: o ?? '' });
    } else {
      if (o !== undefined) rows.push({ type: 'del', text: o });
      if (n !== undefined) rows.push({ type: 'add', text: n });
    }
  }
  return rows;
}

function ApprovalCard({ pending, onApprove, onReject }) {
  const { info } = pending;
  const diffRows = useMemo(() => {
    if (info.tool === 'write_code' && typeof info.oldCode === 'string' && typeof info.newCode === 'string') {
      return simpleLineDiff(info.oldCode, info.newCode);
    }
    return null;
  }, [info]);

  const oldLines = info.oldCode ? info.oldCode.split('\n').length : 0;
  const newLines = info.newCode ? info.newCode.split('\n').length : 0;

  return (
    <div className="agent-approval">
      <div className="agent-approval-head">
        <span className="agent-approval-tool">{info.tool === 'write_code' ? 'write_code' : 'analyze_pattern_audio'}</span>
        <span className="agent-approval-summary">{info.summary || info.message}</span>
      </div>
      {diffRows && (
        <div className="agent-approval-meta">
          current {oldLines} lines → new {newLines} lines
        </div>
      )}
      {diffRows && (
        <pre className="agent-approval-diff">
          {diffRows.map((r, i) => (
            <div key={i} className={`agent-diff-line agent-diff-line--${r.type}`}>
              <span className="agent-diff-marker">{r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' '}</span>
              <span className="agent-diff-text">{r.text || ' '}</span>
            </div>
          ))}
        </pre>
      )}
      <div className="agent-approval-actions">
        <button type="button" className="agent-btn agent-approval-reject" onClick={onReject}>
          reject
        </button>
        <button type="button" className="agent-btn agent-approval-approve" onClick={onApprove} autoFocus>
          approve
        </button>
      </div>
    </div>
  );
}

export function AgentSidebar({ context }) {
  const { editorRef } = context;
  const { fontFamily } = useSettings();
  const [width, setWidth] = useState(360);

  const {
    messages,
    isStreaming,
    needsConfig,
    messagesEndRef,
    sendMessage,
    stop,
    clearHistory,
    chatInputActions,
    toolRenderers,
    contextInfo,
    tokenUsage,
    compressHistory,
    isCompressing,
    pendingApproval,
    approveApproval,
    rejectApproval,
  } = useAgent(editorRef);

  const handleResize = useCallback((newWidth) => setWidth(newWidth), []);

  const handleSend = useCallback(
    async (text, attachments) => {
      if (needsConfig) {
        // Inline hint instead of silently opening settings: let user know why nothing happened.
        // sendMessage would return false when no key is configured; here we provide visible feedback.
        const ok = await sendMessage(text, attachments);
        if (!ok) {
          // sendMessage returns false when no key — already wrote "needs config" into conversation flow (see useAgent).
        }
        return;
      }
      await sendMessage(text, attachments);
    },
    [needsConfig, sendMessage],
  );

  const handleClear = useCallback(() => {
    if (messages.length === 0) return;
    if (window.confirm('Clear this conversation? This cannot be undone.')) {
      clearHistory();
    }
  }, [messages.length, clearHistory]);

  return (
    <div className="agent-panel" style={{ width: `${width}px`, fontFamily }}>
      <ResizeHandle side="left" onResize={handleResize} minSize={280} maxSize={800} />

      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {/* Header: only name + clear + close. Streaming status shown via input placeholder and tool capsule. */}
        <div className="agent-header">
          <span className="agent-title">agent</span>
          <div className="agent-header-actions">
            {messages.length > 0 && (
              <button onClick={handleClear} className="agent-text-btn" title="Clear conversation">clear</button>
            )}
            <button
              onClick={() => setIsAgentOpen(false)}
              className="agent-icon-btn"
              title="Close"
              style={{ width: '24px', height: '24px' }}
            >
              <XMarkIcon style={{ width: '14px', height: '14px' }} />
            </button>
          </div>
        </div>

        {/* Message list */}
        <div className="agent-scroll">
          {messages.length === 0 ? (
            <div className="agent-empty">
              <span className="agent-empty-hint">Ask the agent to write or modify code, or try:</span>
              <div className="agent-empty-examples">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className="agent-example" onClick={() => handleSend(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                renderers={toolRenderers}
                isStreaming={isStreaming && i === messages.length - 1}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* p2/p6 human-in-the-loop: approval card before tool call (write_code diff / analyze_pattern_audio interrupt hint).
            Rendered between message list and input — visible but doesn't block conversation history. */}
        {pendingApproval && (
          <ApprovalCard
            pending={pendingApproval}
            onApprove={approveApproval}
            onReject={rejectApproval}
          />
        )}

        {/* Input area */}
        <ChatInput
          onSend={handleSend}
          disabled={isStreaming || !!pendingApproval}
          onStop={stop}
          chatInputActions={chatInputActions}
          contextTokens={contextInfo.tokens}
          contextBudget={contextInfo.budget}
          messageCount={contextInfo.count}
          tokenUsage={tokenUsage}
          onCompress={compressHistory}
          isCompressing={isCompressing}
        />
      </div>
    </div>
  );
}
