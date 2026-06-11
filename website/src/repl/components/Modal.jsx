import cx from '@src/cx.mjs';
import { useSettings } from '../../settings.mjs';

/**
 * 可复用弹窗组件
 * @param {boolean} isOpen - 是否显示弹窗
 * @param {function} onClose - 关闭弹窗回调
 * @param {string} title - 弹窗标题
 * @param {ReactNode} children - 弹窗内容
 * @param {string} className - 额外的内容区样式
 */
export function Modal({ isOpen, onClose, title, children, className = '' }) {
  const { fontFamily } = useSettings();

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onClick={onClose}
    >
      {/* 遮罩层 */}
      <div className="absolute inset-0 bg-black/50" />

      {/* 弹窗内容 - 使用 Tailwind 主题颜色 */}
      <div
        className="relative bg-background text-foreground shadow-xl max-w-[700px] w-[90vw] h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{ fontFamily }}
      >
        {/* 弹窗标题栏 */}
        <div
          className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0"
          style={{ borderColor: 'color-mix(in srgb, var(--foreground) 10%, transparent)' }}
        >
          <span className="text-[var(--fs-label)] font-medium">{title}</span>
          <button
            onClick={onClose}
            className="text-[var(--fs-input)] hover:text-foreground cursor-pointer leading-none"
            style={{ color: 'color-mix(in srgb, var(--foreground) 40%, transparent)' }}
          >
            ✕
          </button>
        </div>

        {/* 弹窗主体 - 取消滚动 */}
        <div className={cx('flex-1 min-h-0', className)}>
          {children}
        </div>
      </div>
    </div>
  );
}
