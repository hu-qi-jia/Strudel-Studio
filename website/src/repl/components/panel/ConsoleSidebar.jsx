import { useState, useCallback, useEffect } from 'react';
import cx from '@src/cx.mjs';
import { useSettings, setIsConsoleOpen } from '../../../settings.mjs';
import { useStore } from '@nanostores/react';
import { $strudel_log_history } from '../useLogger';
import { XMarkIcon } from '@heroicons/react/16/solid';
import { ResizeHandle } from '../ResizeHandle';

export function ConsoleSidebar({ position }) {
  const log = useStore($strudel_log_history);
  const { fontFamily } = useSettings();

  const isRight = position === 'right';
  const isBottom = position === 'bottom';

  const [width, setWidth] = useState(300);
  const [height, setHeight] = useState(220);
  // maxSize tracks 70% of window height; updates on resize so drag limit stays accurate.
  const [maxHeight, setMaxHeight] = useState(() =>
    typeof window !== 'undefined' ? Math.floor(window.innerHeight * 0.7) : 700,
  );
  useEffect(() => {
    const update = () => setMaxHeight(Math.floor(window.innerHeight * 0.7));
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const handleWidthResize = useCallback((newWidth) => {
    setWidth(newWidth);
  }, []);

  const handleHeightResize = useCallback((newHeight) => {
    setHeight(newHeight);
  }, []);

  return (
    <div
      className={cx(
        'flex flex-col bg-lineHighlight text-foreground overflow-hidden',
        isRight && 'flex-row border-l',
        isBottom && 'border-t',
      )}
      style={{
        borderColor: 'color-mix(in srgb, var(--foreground) 10%, transparent)',
        fontFamily,
        ...(isRight ? { width: `${width}px` } : {}),
        ...(isBottom ? { height: `${height}px` } : {}),
      }}
    >
      {/* 拖拽手柄 */}
      {isRight && <ResizeHandle side="left" onResize={handleWidthResize} minSize={200} maxSize={800} />}
      {isBottom && (
        <ResizeHandle
          side="top"
          onResize={handleHeightResize}
          minSize={100}
          maxSize={maxHeight}
        />
      )}

      {/* 内容区 */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-2 py-1.5 flex-shrink-0 border-b"
          style={{ borderColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)' }}
        >
          <span className="text-[var(--fs-label)] font-medium select-none">console</span>
          <button
            onClick={() => setIsConsoleOpen(false)}
            className="text-foreground hover:opacity-50 cursor-pointer flex items-center justify-center w-6 h-6 rounded hover:bg-foreground/10 transition-colors"
          >
            <XMarkIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 日志内容 */}
        <div className="flex-1 overflow-auto p-2 text-[var(--fs-hint)]">
          <div className="space-y-1">
            {log.map((l) => {
              const message = linkify(l.message);
              const color = l.data?.hap?.value?.color;
              const time = l.timestamp
                ? new Date(l.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '';
              return (
                <div
                  key={l.id}
                  className={cx(
                    l.type === 'error' ? 'text-background bg-foreground' : 'text-foreground',
                    l.type === 'highlight' && 'underline',
                  )}
                  style={color ? { color } : {}}
                >
                  {time && (
                    <span
                      className="mr-1.5 select-none"
                      style={{ color: 'color-mix(in srgb, var(--foreground) 35%, transparent)' }}
                    >
                      {time}
                    </span>
                  )}
                  <span dangerouslySetInnerHTML={{ __html: message }} />
                  {l.count ? ` (${l.count})` : ''}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function linkify(inputText) {
  var replacedText, replacePattern1, replacePattern2, replacePattern3;

  replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
  replacedText = inputText.replace(replacePattern1, '<a class="underline" href="$1" target="_blank">$1</a>');

  replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
  replacedText = replacedText.replace(
    replacePattern2,
    '$1<a class="underline" href="http://$2" target="_blank">$2</a>',
  );

  replacePattern3 = /(([a-zA-Z0-9\-\_\.])+@[a-zA-Z\_]+?(\.[a-zA-Z]{2,6})+)/gim;
  replacedText = replacedText.replace(replacePattern3, '<a class="underline" href="mailto:$1">$1</a>');

  return replacedText;
}
