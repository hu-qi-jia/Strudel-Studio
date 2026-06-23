import { useState, useRef, useEffect } from 'react';
import cx from '@src/cx.mjs';
import './agent.css';
import { formatBytes } from '../../agent/utils.mjs';
import { splitThinking } from '../../agent/thinkingParse.mjs';

export function ChatMessage({ message, renderers = {}, isStreaming = false }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) return null;

  return (
    <div className={cx('agent-msg', isUser ? 'agent-msg--user' : 'agent-msg--agent')}>
      <span className="agent-role">{isUser ? 'you' : 'agent'}</span>

      {/* Native reasoning stream (reasoning): auto-open during streaming, real-time scroll */}
      {message.reasoning && message.reasoning.trim() && !isUser && (
        <ThinkingBlock text={message.reasoning} autoOpen={isStreaming} />
      )}

      {/* Message body */}
      {message.content && (
        <div className="agent-bubble">
          <MessageContent text={message.content} autoOpen={isStreaming} />
        </div>
      )}

      {/* Attachments (user messages) — no emoji, use text labels */}
      {isUser && message.attachments && message.attachments.length > 0 && (
        <div className="agent-tools" style={{ alignItems: 'flex-end' }}>
          {message.attachments.map((a) => (
            <span key={a.handleId} className="agent-attach" title={`${a.mime} · ${formatBytes(a.size)}`}>
              <span className="agent-attach-name">{a.name}</span>
            </span>
          ))}
        </div>
      )}

      {/* Tool calls: collapsible list (reuses thinking block style) + custom renderers */}
      {message.toolInvocations && message.toolInvocations.length > 0 && (
        <ToolCalls invocations={message.toolInvocations} renderers={renderers} />
      )}
    </div>
  );
}

// ── Tool calls area: collapsible list of all tool calls (reuses thinking block style)
//    + plugin custom renderers (e.g. audio analysis panel) ──
function ToolCalls({ invocations, renderers }) {
  const custom = [];
  for (const inv of invocations) {
    const Renderer = renderers[inv.toolName];
    if (Renderer && inv.resultData) custom.push(inv);
  }

  return (
    <div className="agent-tools">
      <ToolCallsBlock invocations={invocations} />
      {custom.map((inv, i) => {
        const Renderer = renderers[inv.toolName];
        return <Renderer key={`c-${i}`} invocation={inv} />;
      })}
    </div>
  );
}

// Collapsible list of all tool calls, reusing the thinking block (<details className="agent-thinking">).
// Collapsed by default — shows count in summary; expand to see each call's args + result.
function ToolCallsBlock({ invocations }) {
  if (invocations.length === 0) return null;

  const completed = invocations.filter((inv) => inv.state === 'result').length;
  const total = invocations.length;

  return (
    <details className="agent-thinking">
      <summary>
        <span className="agent-tool-name">tools</span>
        <span className="agent-tool-count" style={{ marginLeft: 'auto' }}>
          {completed}/{total}
        </span>
      </summary>
      <div className="agent-thinking-body" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {invocations.map((inv, i) => (
          <ToolCallRow key={i} inv={inv} />
        ))}
      </div>
    </details>
  );
}

function ToolCallRow({ inv }) {
  const isResult = inv.state === 'result';
  const isError = isResult && typeof inv.result === 'string' && inv.result.toLowerCase().startsWith('error');
  const status = !isResult ? 'run' : isError ? 'err' : 'ok';
  const statusGlyph = status === 'ok' ? '✓' : status === 'err' ? '✗' : '·';

  const argsStr = inv.args ? JSON.stringify(inv.args) : '';
  const argsDisplay = argsStr.length > 80 ? argsStr.slice(0, 80) + '…' : argsStr;

  return (
    <div className={`agent-tool is-${status}`}>
      <div className="agent-tool-head">
        <span className={`agent-tool-status agent-tool-status--${status}`}>{statusGlyph}</span>
        <span className="agent-tool-name">{inv.toolName}</span>
        <span className="agent-tool-args">{argsDisplay}</span>
      </div>
      {isResult && inv.result && (
        <div className="agent-tool-result">{inv.result}</div>
      )}
    </div>
  );
}

// ── Collapsible thinking block: auto-open during streaming, real-time auto-scroll to bottom.
//    Width stays 100% whether open or collapsed (CSS .agent-thinking { width: 100% }). ──
function ThinkingBlock({ text, autoOpen = false }) {
  const trimmed = (text || '').trim();
  const [open, setOpen] = useState(autoOpen);
  const bodyRef = useRef(null);
  const autoOpenedRef = useRef(false);

  // One-time auto-open when streaming starts; user can close afterwards (won't re-open).
  useEffect(() => {
    if (autoOpen && !autoOpenedRef.current) {
      setOpen(true);
      autoOpenedRef.current = true;
    }
  }, [autoOpen]);

  // Real-time auto-scroll to bottom while text streams in (only when open).
  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [trimmed, open]);

  if (!trimmed) return null;

  return (
    <details className="agent-thinking" open={open} onToggle={(e) => setOpen(e.target.open)}>
      <summary>
        <span className="agent-tool-name">thinking</span>
      </summary>
      <div className="agent-thinking-body" ref={bodyRef}>{trimmed}</div>
    </details>
  );
}

// Single text segment (thinking stripped): parse ``` code blocks, rest as pre-wrap text.
function TextWithCode({ text }) {
  if (!text) return null;
  const parts = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`t-${lastIndex}`} style={{ whiteSpace: 'pre-wrap' }}>
          {text.slice(lastIndex, match.index)}
        </span>,
      );
    }
    parts.push(<code key={`c-${match.index}`} className="agent-code">{match[2]}</code>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(
      <span key={`t-${lastIndex}`} style={{ whiteSpace: 'pre-wrap' }}>
        {text.slice(lastIndex)}
      </span>,
    );
  }
  return <>{parts}</>;
}

function MessageContent({ text, autoOpen = false }) {
  const segments = splitThinking(text);
  if (segments.length === 0) return null;
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'thinking' ? (
          <ThinkingBlock key={`th-${i}`} text={seg.text} autoOpen={autoOpen} />
        ) : (
          <TextWithCode key={`tx-${i}`} text={seg.text} />
        ),
      )}
    </>
  );
}
