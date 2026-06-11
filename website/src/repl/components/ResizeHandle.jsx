import { useCallback, useRef, useEffect } from 'react';

/**
 * 可拖拽调节尺寸的手柄组件
 * @param {'left'|'top'} side - 手柄位置：left 表示面板在右侧（拖拽左边缘），top 表示面板在下方（拖拽上边缘）
 * @param {function} onResize - 尺寸变化回调，参数为新的尺寸值(px)
 * @param {number} minSize - 最小尺寸(px)
 * @param {number} maxSize - 最大尺寸(px)
 */
export function ResizeHandle({ side, onResize, minSize = 200, maxSize = 800 }) {
  const dragging = useRef(false);
  const startPos = useRef(0);
  const startSize = useRef(0);

  const handleMouseDown = useCallback(
    (e) => {
      e.preventDefault();
      dragging.current = true;
      startPos.current = side === 'top' ? e.clientY : e.clientX;
      // 获取当前面板尺寸
      const panel = e.target.parentElement;
      startSize.current = side === 'top' ? panel.offsetHeight : panel.offsetWidth;
      document.body.style.cursor = side === 'top' ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [side],
  );

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragging.current) return;
      let delta;
      if (side === 'left') {
        delta = startPos.current - e.clientX; // 向左拖 = 面板变宽
      } else if (side === 'right') {
        delta = e.clientX - startPos.current; // 向右拖 = 面板变宽
      } else {
        delta = startPos.current - e.clientY; // 向上拖 = 面板变高
      }
      const newSize = Math.min(maxSize, Math.max(minSize, startSize.current + delta));
      onResize(newSize);
    };

    const handleMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [side, onResize, minSize, maxSize]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className={cx(
        'flex-shrink-0 z-10 transition-colors',
        (side === 'left' || side === 'right') && 'w-1 cursor-col-resize hover:bg-foreground/20 active:bg-foreground/30',
        side === 'top' && 'h-1 cursor-row-resize hover:bg-foreground/20 active:bg-foreground/30',
      )}
    />
  );
}

function cx(...args) {
  return args.filter(Boolean).join(' ');
}
