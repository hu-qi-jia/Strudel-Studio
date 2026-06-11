import { useState } from 'react';
import PlayCircleIcon from '@heroicons/react/20/solid/PlayCircleIcon';
import StopCircleIcon from '@heroicons/react/20/solid/StopCircleIcon';
import cx from '@src/cx.mjs';
import { useSettings, setIsZen, setIsPanelOpened, setIsConsoleOpen, setIsSoundsOpen } from '../../settings.mjs';
import { Modal } from './Modal.jsx';
import { PatternsTab } from './panel/PatternsTab.jsx';
import { Reference } from './panel/Reference.jsx';
import '../Repl.css';

const { BASE_URL } = import.meta.env;
const baseNoTrailing = BASE_URL.endsWith('/') ? BASE_URL.slice(0, -1) : BASE_URL;

export function Header({ context, embedded = false }) {
  const { started, pending, isDirty, activeCode, handleTogglePlay, handleEvaluate, handleShuffle } = context;
  const isEmbedded = typeof window !== 'undefined' && (embedded || window.location !== window.parent.location);
  const { isZen, isButtonRowHidden, isCSSAnimationDisabled, fontFamily, isPanelOpen, isConsoleOpen, isSoundsOpen } = useSettings();
  const [showPatterns, setShowPatterns] = useState(false);
  const [showReference, setShowReference] = useState(false);

  return (
    <>
      <header
        id="header"
        className={cx(
          'flex-none text-foreground z-[100] select-none',
          !isZen && !isEmbedded && 'bg-lineHighlight',
          isZen ? 'h-12 w-8 fixed top-0 left-0' : 'sticky top-0 w-full border-b',
          isEmbedded ? 'flex' : 'md:flex flex-col',
        )}
        style={{ fontFamily, borderColor: 'color-mix(in srgb, var(--foreground) 10%, transparent)' }}
      >
        {/* Zen Mode logo */}
        {isZen && !isEmbedded && (
          <div
            className={cx(
              started && !isCSSAnimationDisabled && 'animate-spin',
              'cursor-pointer text-foreground fixed top-2 left-2 z-[101]',
            )}
            onClick={() => setIsZen(false)}
          >
            <span className="block text-foreground rotate-90 text-[var(--fs-body)]">꩜</span>
          </div>
        )}

        {/* 第一行 */}
        {!isZen && !isEmbedded && (
          <div className="flex items-center justify-between w-full py-1">
            {/* 左侧：logo + patterns / sounds / console */}
            <div className="flex items-center px-2 gap-1">
              {/* Logo */}
              <h1
                onClick={() => {
                  if (isEmbedded) window.open(window.location.href.replace('embed', ''));
                }}
                className={cx(
                  isEmbedded ? 'text-l cursor-pointer' : 'text-[var(--fs-body)]',
                  'text-foreground font-bold flex items-center space-x-1 cursor-pointer',
                )}
              >
                <div
                  className={cx(
                    started && !isCSSAnimationDisabled && 'animate-spin',
                    'cursor-pointer text-foreground',
                  )}
                  onClick={() => {
                    if (!isEmbedded) setIsZen(!isZen);
                  }}
                >
                  <span className="block text-foreground rotate-90">꩜</span>
                </div>
              </h1>

              <button
                onClick={() => setShowPatterns(true)}
                className="px-2 py-1 hover:opacity-50 text-[var(--fs-label)] rounded transition-colors cursor-pointer"
              >
                patterns
              </button>
              <button
                onClick={() => setIsSoundsOpen(!isSoundsOpen)}
                className={cx(
                  'px-2 py-1 hover:opacity-50 text-[var(--fs-label)] rounded transition-colors cursor-pointer',
                  isSoundsOpen && 'opacity-50',
                )}
              >
                sounds
              </button>
              <button
                onClick={() => setIsConsoleOpen(!isConsoleOpen)}
                className={cx(
                  'px-2 py-1 hover:opacity-50 text-[var(--fs-label)] rounded transition-colors cursor-pointer',
                  isConsoleOpen && 'opacity-50',
                )}
              >
                console
              </button>
            </div>

            {/* 右侧：reference / learn / settings */}
            <div className="flex items-center px-2 gap-1">
              {!isEmbedded && (
                <button
                  onClick={() => setShowReference(true)}
                  className="px-2 py-1 hover:opacity-50 text-[var(--fs-label)] rounded transition-colors cursor-pointer"
                >
                  reference
                </button>
              )}
              {!isEmbedded && (
                <a
                  title="learn"
                  href={`${baseNoTrailing}/workshop/getting-started/`}
                  className="hover:opacity-50 flex items-center space-x-1 text-[var(--fs-label)] rounded transition-colors px-2 py-1"
                >
                  <span>learn</span>
                </a>
              )}
              {!isEmbedded && (
                <button
                  title="settings"
                  onClick={() => setIsPanelOpened(!isPanelOpen)}
                  className="cursor-pointer hover:opacity-50 text-[var(--fs-label)] rounded transition-colors px-2 py-1"
                >
                  settings
                </button>
              )}
            </div>
          </div>
        )}

        {/* 第二行：play / update 按钮（与 patterns 左侧对齐） */}
        {!isZen && !isButtonRowHidden && (
          <div className="flex items-start w-full py-0.5 px-2 gap-1.5 pb-2.5">
            {/* play 按钮 - 带边框矩形样式 */}
            <button
              onClick={handleTogglePlay}
              title={started ? 'stop' : 'play'}
              className={cx(
                'px-3 py-0.5 text-[var(--fs-label)] cursor-pointer transition-colors border rounded-sm',
                'hover:opacity-80 active:bg-lineBackground',
                !started && !isCSSAnimationDisabled && 'animate-pulse',
              )}
              style={{
                borderColor: 'color-mix(in srgb, var(--foreground) 25%, transparent)',
                backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
              }}
            >
              {!pending ? (
                <span className="flex items-center space-x-1.5">
                  {started ? <StopCircleIcon className="w-3.5 h-3.5" /> : <PlayCircleIcon className="w-3.5 h-3.5" />}
                  <span>{started ? 'stop' : 'play'}</span>
                </span>
              ) : (
                <>loading...</>
              )}
            </button>

            {/* update 按钮 - 带边框矩形样式 */}
            <button
              onClick={handleEvaluate}
              title="update"
              className={cx(
                'px-3 py-0.5 text-[var(--fs-input)] cursor-pointer transition-colors border rounded-sm hover:opacity-80 active:bg-lineBackground',
                !isDirty || !activeCode ? 'opacity-50' : '',
              )}
              style={{
                borderColor: 'color-mix(in srgb, var(--foreground) 25%, transparent)',
                backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
              }}
            >
              update
            </button>
          </div>
        )}
      </header>

      {/* Patterns 弹窗 */}
      <Modal
        isOpen={showPatterns}
        onClose={() => setShowPatterns(false)}
        title="patterns"
      >
        <PatternsTab context={context} />
      </Modal>

      {/* Reference 弹窗 */}
      <Modal
        isOpen={showReference}
        onClose={() => setShowReference(false)}
        title="reference"
      >
        <Reference />
      </Modal>
    </>
  );
}
