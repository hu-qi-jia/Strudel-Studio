import cx from '@src/cx.mjs';
import { formatBytes } from '../../agent/utils.mjs';

export function ChatMessage({ message, renderers = {} }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  if (isSystem) return null;

  return (
    <div className={cx('flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
      {/* 角色标签 */}
      <span
        className="text-[var(--fs-label)] select-none"
        style={{ color: 'color-mix(in srgb, var(--foreground) 50%, transparent)' }}
      >
        {isUser ? 'you' : 'agent'}
      </span>

      {/* 消息内容 */}
      {message.content && (
        <div
          className={cx(
            'rounded-sm px-2.5 py-1.5 max-w-full overflow-hidden text-[var(--fs-input)]',
            isUser
              ? 'bg-foreground/10 text-foreground'
              : 'bg-transparent text-foreground',
          )}
          style={{
            wordBreak: 'break-word',
            ...(isUser
              ? {}
              : {}),
          }}
        >
          <MessageContent text={message.content} />
        </div>
      )}

      {/* 附件（用户消息） */}
      {isUser && message.attachments && message.attachments.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-end max-w-full">
          {message.attachments.map((a) => (
            <span
              key={a.handleId}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[var(--fs-hint)] border rounded-sm max-w-full"
              style={{
                borderColor: 'color-mix(in srgb, var(--foreground) 20%, transparent)',
                backgroundColor: 'color-mix(in srgb, var(--foreground) 6%, transparent)',
              }}
              title={`${a.mime} · ${formatBytes(a.size)}`}
            >
              <span className="truncate">📎 {a.name}</span>
            </span>
          ))}
        </div>
      )}

      {/* 工具调用展示 */}
      {message.toolInvocations && message.toolInvocations.length > 0 && (
        <div className="flex flex-col gap-1 w-full">
          {message.toolInvocations.map((inv, i) => {
            // 插件可声明自定义渲染器（registry.getRenderers()[toolName]）。
            // 仅当「有渲染器」且「存在结构化 resultData」时用它；否则回退通用 badge
            // （核心 13 工具无渲染器、或工具返回的是错误字符串时都走 badge，零影响）。
            const Renderer = renderers[inv.toolName];
            return Renderer && inv.resultData ? (
              <Renderer key={i} invocation={inv} />
            ) : (
              <ToolCallBadge key={i} invocation={inv} />
            );
          })}
        </div>
      )}
    </div>
  );
}

function ToolCallBadge({ invocation }) {
  const isSuccess = invocation.state === 'result';
  const isCalling = invocation.state === 'call' || invocation.state === 'partial';
  const name = invocation.toolName || 'tool';

  // Format tool arguments for display
  const argsDisplay = invocation.args
    ? Object.entries(invocation.args)
        .map(([k, v]) => {
          const val = typeof v === 'string' ? v : JSON.stringify(v);
          return `${k}: ${val.length > 40 ? val.slice(0, 40) + '...' : val}`;
        })
        .join(', ')
    : '';

  // Format result for display
  const resultStr = isSuccess && invocation.result
    ? (typeof invocation.result === 'string' ? invocation.result : JSON.stringify(invocation.result))
    : '';

  // 多行结果（如 edit_lines 的 before/after diff）用 pre-wrap 展示更多内容；
  // 单行结果仍用截断 + title。
  const isMultiline = resultStr.includes('\n');

  return (
    <div
      className={cx(
        'flex flex-col gap-0.5 px-2 py-1 rounded-sm text-[var(--fs-label)]',
        'border',
      )}
      style={{
        borderColor: 'color-mix(in srgb, var(--foreground) 15%, transparent)',
        backgroundColor: 'color-mix(in srgb, var(--foreground) 5%, transparent)',
      }}
    >
      <div className="flex items-center gap-1.5">
        <span style={{ color: 'color-mix(in srgb, var(--foreground) 60%, transparent)' }}>
          {isCalling ? '...' : isSuccess ? '>' : '!'}
        </span>
        <span className="font-mono">{name}</span>
        {argsDisplay && (
          <span
            className="truncate"
            style={{ color: 'color-mix(in srgb, var(--foreground) 45%, transparent)' }}
          >
            {argsDisplay}
          </span>
        )}
      </div>
      {isSuccess && resultStr && (
        isMultiline ? (
          <pre
            className="font-mono max-w-full whitespace-pre-wrap break-words max-h-40 overflow-auto m-0"
            style={{
              color: 'color-mix(in srgb, var(--foreground) 50%, transparent)',
              fontSize: 'var(--fs-hint, 11px)',
            }}
          >
            {resultStr.slice(0, 600)}
          </pre>
        ) : (
          <div
            className="font-mono truncate max-w-full"
            style={{
              color: 'color-mix(in srgb, var(--foreground) 50%, transparent)',
              fontSize: 'var(--fs-hint, 11px)',
            }}
            title={resultStr}
          >
            {resultStr.slice(0, 120)}
          </div>
        )
      )}
    </div>
  );
}

function MessageContent({ text }) {
  // 简单的代码块渲染
  const parts = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // 代码块前的文本
    if (match.index > lastIndex) {
      parts.push(
        <span key={`t-${lastIndex}`} style={{ whiteSpace: 'pre-wrap' }}>
          {text.slice(lastIndex, match.index)}
        </span>,
      );
    }
    // 代码块
    parts.push(
      <code
        key={`c-${match.index}`}
        className="block font-mono px-2 py-1 rounded-sm my-1 text-[var(--fs-input)]"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {match[2]}
      </code>,
    );
    lastIndex = match.index + match[0].length;
  }

  // 剩余文本
  if (lastIndex < text.length) {
    parts.push(
      <span key={`t-${lastIndex}`} style={{ whiteSpace: 'pre-wrap' }}>
        {text.slice(lastIndex)}
      </span>,
    );
  }

  return <>{parts}</>;
}
