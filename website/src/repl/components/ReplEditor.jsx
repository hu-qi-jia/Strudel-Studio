import Loader from '@src/repl/components/Loader';
import { ConsoleSidebar } from '@src/repl/components/panel/ConsoleSidebar';
import { SoundsSidebar } from '@src/repl/components/panel/SoundsSidebar';
import { SettingsModal } from '@src/repl/components/panel/SettingsModal';
import { Code } from '@src/repl/components/Code';
import UserFacingErrorMessage from '@src/repl/components/UserFacingErrorMessage';
import { Header } from './Header';
import { AgentSidebar } from './agent/AgentSidebar';
import { useSettings } from '@src/settings.mjs';
import { useLogger } from '@src/repl/components/useLogger';

export default function ReplEditor(Props) {
  const { context, ...editorProps } = Props;
  const { containerRef, editorRef, error, init, pending } = context;
  const settings = useSettings();
  const { isZen, isConsoleOpen, consolePosition, isSoundsOpen, soundsPosition, isAgentOpen } = settings;

  useLogger();

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

        {/* Agent - 右侧位置（最右侧） */}
        {!isZen && isAgentOpen && <AgentSidebar context={context} />}
      </div>

      {/* 设置弹窗 */}
      <SettingsModal context={context} />
    </div>
  );
}
