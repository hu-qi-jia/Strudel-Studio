import Loader from '@src/repl/components/Loader';
import { HorizontalPanel, VerticalPanel } from '@src/repl/components/panel/Panel';
import { ConsoleSidebar } from '@src/repl/components/panel/ConsoleSidebar';
import { SoundsSidebar } from '@src/repl/components/panel/SoundsSidebar';
import { Code } from '@src/repl/components/Code';
import UserFacingErrorMessage from '@src/repl/components/UserFacingErrorMessage';
import { Header } from './Header';
import { useSettings } from '@src/settings.mjs';

export default function ReplEditor(Props) {
  const { context, ...editorProps } = Props;
  const { containerRef, editorRef, error, init, pending } = context;
  const settings = useSettings();
  const { panelPosition, isZen, isConsoleOpen, consolePosition, isSoundsOpen, soundsPosition } = settings;

  /*
   * 布局逻辑：
   * - consolePosition 独立于 panelPosition
   * - 右侧布局：[编辑器] [Console右侧?] [设置面板右侧?]
   * - 底部布局：[编辑器 + 设置面板底部?] [Console底部?]
   */

  return (
    <div className="h-full flex flex-col relative" {...editorProps}>
      <Loader active={pending} />
      <Header context={context} />

      <div className="grow flex relative overflow-hidden">
        {/* Sounds - 左侧位置 */}
        {!isZen && isSoundsOpen && soundsPosition === 'left' && (
          <SoundsSidebar position="left" />
        )}

        {/* 左侧：编辑器 + 底部面板 */}
        <div className="grow flex flex-col relative overflow-hidden">
          <div className="grow flex relative overflow-hidden">
            <Code containerRef={containerRef} editorRef={editorRef} init={init} />
          </div>
          <UserFacingErrorMessage error={error} />
          {/* 设置面板 - 底部位置 */}
          {!isZen && panelPosition === 'bottom' && <HorizontalPanel context={context} />}
          {/* Console - 底部位置 */}
          {!isZen && isConsoleOpen && consolePosition === 'bottom' && (
            <ConsoleSidebar position="bottom" />
          )}
          {/* Sounds - 底部位置 */}
          {!isZen && isSoundsOpen && soundsPosition === 'bottom' && (
            <SoundsSidebar position="bottom" />
          )}
        </div>

        {/* Console - 右侧位置 */}
        {!isZen && isConsoleOpen && consolePosition === 'right' && (
          <ConsoleSidebar position="right" />
        )}

        {/* 设置面板 - 右侧位置（在 console 右侧） */}
        {!isZen && panelPosition === 'right' && <VerticalPanel context={context} />}
      </div>
    </div>
  );
}
