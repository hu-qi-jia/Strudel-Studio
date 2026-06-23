import { useState, useRef } from 'react';
import { useStore } from '@nanostores/react';
import cx from '@src/cx.mjs';
import './agent.css';
import { registerAttachment, removeAttachment } from '../../agent/attachments.mjs';
import { $webSearchMode } from '../../agent/store.mjs';

// Monochrome (currentColor) icon — colored by theme/active state, no colored emoji.
function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18" />
      <path d="M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
const ACTION_ICONS = { add: PlusIcon };

// Token compact display: 4200 → 4.2k
function fmtTokens(n) {
  const v = Number(n) || 0;
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}

export function ChatInput({
  onSend,
  disabled,
  onStop,
  chatInputActions = [],
  tokenUsage,
  contextTokens = 0,
  contextBudget = 30000,
  messageCount = 0,
  onCompress,
  isCompressing = false,
}) {
  const [input, setInput] = useState('');
  const [pendingAtts, setPendingAtts] = useState([]);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const pendingActionRef = useRef(null);
  const webMode = useStore($webSearchMode);

  // Streaming OR compressing: lock input to avoid interleaving with in-flight messagesRef writes
  const blocked = disabled || isCompressing;

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (blocked) return;
    if (!input.trim() && pendingAtts.length === 0) return;
    onSend(input.trim(), pendingAtts);
    setInput('');
    setPendingAtts([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleInput = (e) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 60) + 'px';
    // Add has-scroll class when content exceeds max-height
    if (ta.scrollHeight > 60) {
      ta.classList.add('has-scroll');
    } else {
      ta.classList.remove('has-scroll');
    }
  };

  const openPicker = (action) => {
    pendingActionRef.current = action;
    if (fileInputRef.current) {
      fileInputRef.current.accept = action.accept || '';
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFilesPicked = async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      try {
        const meta = await registerAttachment(f);
        setPendingAtts((prev) => [...prev, meta]);
      } catch (err) {
        console.warn('[chat] failed to attach file:', f.name, err);
        alert(`Could not attach "${f.name}": ${err?.message || err}`);
      }
    }
  };

  const removePending = async (handleId) => {
    setPendingAtts((prev) => prev.filter((a) => a.handleId !== handleId));
    await removeAttachment(handleId);
  };

  const isStreaming = disabled;
  const canSend = !blocked && (input.trim() || pendingAtts.length > 0);

  // Context near budget: soft hint (irreversible operation not as permanent small link)
  const ctxRatio = contextBudget > 0 ? contextTokens / contextBudget : 0;
  const pct = contextBudget > 0 ? Math.round((contextTokens / contextBudget) * 100) : 0;

  return (
    <form className="agent-input" onSubmit={handleSubmit}>
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFilesPicked} />

      {/* Pending attachment chips (no emoji, text labels) */}
      {pendingAtts.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
          {pendingAtts.map((a) => (
            <span key={a.handleId} className="agent-attach">
              <span className="agent-attach-name">{a.name}</span>
              <button type="button" onClick={() => removePending(a.handleId)} className="agent-attach-x" title="remove">×</button>
            </span>
          ))}
        </div>
      )}

      {/* textarea only, full width */}
      <div className="agent-input-row" style={{ alignItems: 'stretch' }}>
        <textarea
          ref={textareaRef}
          className="agent-textarea"
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={blocked}
          placeholder={disabled ? 'thinking…' : 'ask agent…'}
          rows={1}
        />
      </div>

      {/* footer: left actions (web / attach) / right (ctx + send/stop) */}
      <div className="agent-input-row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="agent-toolrow">
          <button
            type="button"
            onClick={() => $webSearchMode.set(!webMode)}
            disabled={blocked}
            title={webMode ? 'Web mode on — click to turn off' : 'Web mode off — click to search online this turn'}
            aria-pressed={webMode}
            className="agent-icon-btn"
          >
            <GlobeIcon />
          </button>
          {chatInputActions.map((action) => {
            const ActionIcon = action.icon && ACTION_ICONS[action.icon];
            return (
              <button
                key={action.id}
                type="button"
                onClick={() => openPicker(action)}
                disabled={blocked}
                title={action.label}
                className="agent-icon-btn"
              >
                {ActionIcon ? <ActionIcon /> : '+'}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
          {messageCount > 0 && (
            <div className="agent-footer-stat">
              <span
                className={cx(ctxRatio > 0.85 && 'is-warn')}
                title={`context: ${contextTokens} / ${contextBudget} tokens (${pct}%) · ${messageCount} messages${
                  tokenUsage ? ` · last turn: ${tokenUsage.total} tokens (in ${tokenUsage.prompt}, out ${tokenUsage.completion})` : ''
                }`}
              >
                {contextTokens}/{fmtTokens(contextBudget)} ({pct}%)
              </span>
            </div>
          )}
          {messageCount > 0 && (
            <button
              type="button"
              onClick={onCompress}
              disabled={blocked}
              className="agent-btn"
              title="Summarize older messages into a short note (keeps the last few turns verbatim)."
            >
              {isCompressing ? 'compressing…' : 'compress'}
            </button>
          )}
          {/* send/stop button aligned to textarea right edge */}
          {isStreaming ? (
            <button type="button" className="agent-btn agent-btn--stop" onClick={onStop}>stop</button>
          ) : (
            <button type="submit" className="agent-btn" disabled={!canSend}>send</button>
          )}
        </div>
      </div>
    </form>
  );
}
