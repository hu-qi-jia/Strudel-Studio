import cx from '@src/cx.mjs';

export function ChatMessage({ message }) {
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

      {/* 工具调用展示 */}
      {message.toolInvocations && message.toolInvocations.length > 0 && (
        <div className="flex flex-col gap-1 w-full">
          {message.toolInvocations.map((inv, i) => (
            <ToolCallBadge key={i} invocation={inv} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolCallBadge({ invocation }) {
  const isSuccess = invocation.state === 'result';
  const isCalling = invocation.state === 'call' || invocation.state === 'partial';
  const name = invocation.toolName || 'tool';

  return (
    <div
      className={cx(
        'flex items-center gap-1.5 px-2 py-1 rounded-sm text-[var(--fs-label)]',
        'border',
      )}
      style={{
        borderColor: 'color-mix(in srgb, var(--foreground) 15%, transparent)',
        backgroundColor: 'color-mix(in srgb, var(--foreground) 5%, transparent)',
      }}
    >
      <span style={{ color: 'color-mix(in srgb, var(--foreground) 60%, transparent)' }}>
        {isCalling ? '...' : isSuccess ? '>' : '!'}
      </span>
      <span className="font-mono">{name}</span>
      {isSuccess && invocation.result && (
        <span
          className="truncate max-w-[200px]"
          style={{ color: 'color-mix(in srgb, var(--foreground) 50%, transparent)' }}
        >
          {typeof invocation.result === 'string'
            ? invocation.result.slice(0, 60)
            : JSON.stringify(invocation.result).slice(0, 60)}
        </span>
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
