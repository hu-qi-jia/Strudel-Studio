import { useState, useCallback } from 'react';
import cx from '@src/cx.mjs';
import { useSettings, setIsSoundsOpen } from '../../../settings.mjs';
import { SoundsTab } from './SoundsTab';
import { XMarkIcon } from '@heroicons/react/16/solid';
import { ResizeHandle } from '../ResizeHandle';

export function SoundsSidebar({ position }) {
  const { fontFamily } = useSettings();

  const isLeft = position === 'left';
  const isBottom = position === 'bottom';

  const [width, setWidth] = useState(300);
  const [height, setHeight] = useState(220);

  const handleWidthResize = useCallback((newWidth) => {
    setWidth(newWidth);
  }, []);

  const handleHeightResize = useCallback((newHeight) => {
    setHeight(newHeight);
  }, []);

  return (
    <div
      className={cx(
        'flex bg-lineHighlight text-foreground overflow-hidden',
        isLeft && 'flex-row border-r',
        isBottom && 'flex-col border-t',
      )}
      style={{
        borderColor: 'color-mix(in srgb, var(--foreground) 10%, transparent)',
        fontFamily,
        ...(isLeft ? { width: `${width}px` } : {}),
        ...(isBottom ? { height: `${height}px` } : {}),
      }}
    >
      {/* 内容区 */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-2 py-1.5 flex-shrink-0 border-b"
          style={{ borderColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)' }}
        >
          <span className="text-[var(--fs-label)] font-medium select-none">sounds</span>
          <button
            onClick={() => setIsSoundsOpen(false)}
            className="text-foreground hover:opacity-50 cursor-pointer p-0.5 flex items-center justify-center"
          >
            <XMarkIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Sounds 内容 */}
        <div className="flex-1 overflow-auto">
          <SoundsTab />
        </div>
      </div>

      {/* 拖拽手柄 - 左侧面板时在右边缘 */}
      {isLeft && <ResizeHandle side="right" onResize={handleWidthResize} minSize={200} maxSize={800} />}
      {isBottom && <ResizeHandle side="top" onResize={handleHeightResize} minSize={100} maxSize={600} />}
    </div>
  );
}
