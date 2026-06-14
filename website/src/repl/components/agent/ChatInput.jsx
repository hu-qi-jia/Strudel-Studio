import { useState, useRef } from 'react';
import cx from '@src/cx.mjs';
import { registerAttachment, removeAttachment } from '../../agent/attachments.mjs';

export function ChatInput({ onSend, disabled, onStop, chatInputActions = [] }) {
  const [input, setInput] = useState('');
  // 待发送附件的元数据（handleId/mime/name/size）；发送时随消息一起带出，随后清空。
  const [pendingAtts, setPendingAtts] = useState([]);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const pendingActionRef = useRef(null);

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    // 允许：有文本 或 有待发附件
    if (disabled) return;
    if (!input.trim() && pendingAtts.length === 0) return;
    onSend(input.trim(), pendingAtts);
    setInput('');
    setPendingAtts([]);
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
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  };

  const openPicker = (action) => {
    pendingActionRef.current = action;
    if (fileInputRef.current) {
      fileInputRef.current.accept = action.accept || '';
      fileInputRef.current.value = ''; // 允许重复选同一个文件
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
  // isStreaming === disabled，故 !disabled 已隐含 !isStreaming；不再重复。
  const canSend = !disabled && (input.trim() || pendingAtts.length > 0);

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-1 p-2 border-t"
      style={{ borderColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)' }}
    >
      {/* 隐藏文件输入（由插件贡献的 chatInputAction 触发） */}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFilesPicked}
      />

      {/* 待发附件 chips */}
      {pendingAtts.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {pendingAtts.map((a) => (
            <span
              key={a.handleId}
              className={cx(
                'inline-flex items-center gap-1 px-1.5 py-0.5 text-[var(--fs-hint)] border rounded-sm',
              )}
              style={{
                borderColor: 'color-mix(in srgb, var(--foreground) 20%, transparent)',
                backgroundColor: 'color-mix(in srgb, var(--foreground) 6%, transparent)',
              }}
            >
              <span>📎 {a.name}</span>
              <button
                type="button"
                onClick={() => removePending(a.handleId)}
                className="cursor-pointer hover:opacity-60"
                style={{ lineHeight: 1 }}
                title="remove"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1.5">
        {/* 插件贡献的上传按钮 */}
        {chatInputActions.map((action) => (
          <button
            key={action.id}
            type="button"
            onClick={() => openPicker(action)}
            disabled={disabled}
            title={action.label}
            className={cx(
              'px-1.5 py-1.5 text-[var(--fs-label)] border rounded-sm transition-colors',
              disabled ? 'opacity-30 cursor-default' : 'cursor-pointer hover:opacity-80',
            )}
            style={{
              borderColor: 'color-mix(in srgb, var(--foreground) 25%, transparent)',
              backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
            }}
          >
            {action.icon || '＋'}
          </button>
        ))}

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
            disabled={!canSend}
            className={cx(
              'px-2 py-1.5 text-[var(--fs-label)] border rounded-sm transition-colors',
              !canSend && 'opacity-30 cursor-default',
              canSend && 'cursor-pointer',
            )}
            style={{
              borderColor: 'color-mix(in srgb, var(--foreground) 25%, transparent)',
              backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
            }}
          >
            send
          </button>
        )}
      </div>
    </form>
  );
}
