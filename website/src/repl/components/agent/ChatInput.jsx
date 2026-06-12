import { useState, useRef } from 'react';
import cx from '@src/cx.mjs';

export function ChatInput({ onSend, disabled, onStop }) {
  const [input, setInput] = useState('');
  const textareaRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    onSend(input.trim());
    setInput('');
    // 重置 textarea 高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleInput = (e) => {
    setInput(e.target.value);
    // 自动调整高度
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  };

  const isStreaming = disabled;

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-1.5 p-2 border-t"
      style={{ borderColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)' }}
    >
      <textarea
        ref={textareaRef}
        value={input}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={disabled ? 'thinking...' : 'ask agent...'}
        rows={1}
        className={cx(
          'flex-1 resize-none bg-transparent text-foreground text-[var(--fs-input)]',
          'px-2 py-1.5 rounded-sm border outline-none',
          'placeholder:text-foreground/30',
        )}
        style={{
          borderColor: 'color-mix(in srgb, var(--foreground) 15%, transparent)',
          maxHeight: '120px',
          fontFamily: 'inherit',
        }}
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          className="px-2 py-1.5 text-[var(--fs-label)] cursor-pointer border rounded-sm hover:opacity-80 transition-colors"
          style={{
            borderColor: 'color-mix(in srgb, var(--foreground) 25%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
          }}
        >
          stop
        </button>
      ) : (
        <button
          type="submit"
          disabled={!input.trim() || disabled}
          className={cx(
            'px-2 py-1.5 text-[var(--fs-label)] cursor-pointer border rounded-sm transition-colors',
            (!input.trim() || disabled) && 'opacity-30 cursor-default',
          )}
          style={{
            borderColor: 'color-mix(in srgb, var(--foreground) 25%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
          }}
        >
          send
        </button>
      )}
    </form>
  );
}
