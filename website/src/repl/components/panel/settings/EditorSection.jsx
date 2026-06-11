import { defaultSettings, settingsMap, useSettings } from '@root/website/src/settings.mjs';
import { isUdels } from '@root/website/src/repl/util.mjs';
import { ButtonGroup, Checkbox, FormItem } from '../Forms.jsx';
import { confirmDialog } from '@root/website/src/repl/util.mjs';

const RELOAD_MSG = 'Changing this setting requires the window to reload itself. OK?';

export function EditorSection() {
  const {
    keybindings,
    isBracketClosingEnabled,
    isBracketMatchingEnabled,
    isLineNumbersDisplayed,
    isPatternHighlightingEnabled,
    isActiveLineHighlighted,
    isAutoCompletionEnabled,
    isTooltipEnabled,
    isFlashEnabled,
    isButtonRowHidden,
    isCSSAnimationDisabled,
    isSyncEnabled,
    isLineWrappingEnabled,
    panelPosition,
    togglePanelTrigger,
    isTabIndentationEnabled,
    isMultiCursorEnabled,
    consolePosition,
  } = useSettings();
  const shouldAlwaysSync = isUdels();

  return (
    <div className="space-y-1 w-full">
      <FormItem label="Keybindings">
        <ButtonGroup
          value={keybindings}
          onChange={(keybindings) => settingsMap.setKey('keybindings', keybindings)}
          items={{ codemirror: 'Codemirror', vim: 'Vim', emacs: 'Emacs', vscode: 'VSCode' }}
        />
      </FormItem>
      <FormItem label="Panel Position">
        <ButtonGroup
          value={panelPosition}
          onChange={(value) => settingsMap.setKey('panelPosition', value)}
          items={{ bottom: 'Bottom', right: 'Right' }}
        />
      </FormItem>
      <FormItem label="Console Position">
        <ButtonGroup
          value={consolePosition}
          onChange={(value) => settingsMap.setKey('consolePosition', value)}
          items={{ bottom: 'Bottom', right: 'Right' }}
        />
      </FormItem>
      <FormItem label="Open Panel on">
        <ButtonGroup
          value={togglePanelTrigger}
          onChange={(value) => settingsMap.setKey('togglePanelTrigger', value)}
          items={{ click: 'Click', hover: 'Hover' }}
        />
      </FormItem>
      <FormItem label="More Settings">
        <div className="flex flex-col gap-2">
          <Checkbox
            label="Enable bracket matching"
            onChange={(cbEvent) => settingsMap.setKey('isBracketMatchingEnabled', cbEvent.target.checked)}
            value={isBracketMatchingEnabled}
          />
          <Checkbox
            label="Auto close brackets"
            onChange={(cbEvent) => settingsMap.setKey('isBracketClosingEnabled', cbEvent.target.checked)}
            value={isBracketClosingEnabled}
          />
          <Checkbox
            label="Display line numbers"
            onChange={(cbEvent) => settingsMap.setKey('isLineNumbersDisplayed', cbEvent.target.checked)}
            value={isLineNumbersDisplayed}
          />
          <Checkbox
            label="Highlight active line"
            onChange={(cbEvent) => settingsMap.setKey('isActiveLineHighlighted', cbEvent.target.checked)}
            value={isActiveLineHighlighted}
          />
          <Checkbox
            label="Highlight events in code"
            onChange={(cbEvent) => settingsMap.setKey('isPatternHighlightingEnabled', cbEvent.target.checked)}
            value={isPatternHighlightingEnabled}
          />
          <Checkbox
            label="Enable auto-completion"
            onChange={(cbEvent) => settingsMap.setKey('isAutoCompletionEnabled', cbEvent.target.checked)}
            value={isAutoCompletionEnabled}
          />
          <Checkbox
            label="Enable tooltips on Ctrl and hover"
            onChange={(cbEvent) => settingsMap.setKey('isTooltipEnabled', cbEvent.target.checked)}
            value={isTooltipEnabled}
          />
          <Checkbox
            label="Enable line wrapping"
            onChange={(cbEvent) => settingsMap.setKey('isLineWrappingEnabled', cbEvent.target.checked)}
            value={isLineWrappingEnabled}
          />
          <Checkbox
            label="Enable Tab indentation"
            onChange={(cbEvent) => settingsMap.setKey('isTabIndentationEnabled', cbEvent.target.checked)}
            value={isTabIndentationEnabled}
          />
          <Checkbox
            label="Enable Multi-Cursor (Cmd/Ctrl+Click)"
            onChange={(cbEvent) => settingsMap.setKey('isMultiCursorEnabled', cbEvent.target.checked)}
            value={isMultiCursorEnabled}
          />
          <Checkbox
            label="Enable flashing on evaluation"
            onChange={(cbEvent) => settingsMap.setKey('isFlashEnabled', cbEvent.target.checked)}
            value={isFlashEnabled}
          />
          <Checkbox
            label="Sync across Browser Tabs / Windows"
            onChange={(cbEvent) => {
              const newVal = cbEvent.target.checked;
              confirmDialog(RELOAD_MSG).then((r) => {
                if (r) {
                  settingsMap.setKey('isSyncEnabled', newVal);
                  window.location.reload();
                }
              });
            }}
            disabled={shouldAlwaysSync}
            value={isSyncEnabled}
          />
          <Checkbox
            label="Hide top buttons"
            onChange={(cbEvent) => settingsMap.setKey('isButtonRowHidden', cbEvent.target.checked)}
            value={isButtonRowHidden}
          />
          <Checkbox
            label="Disable CSS Animations"
            onChange={(cbEvent) => settingsMap.setKey('isCSSAnimationDisabled', cbEvent.target.checked)}
            value={isCSSAnimationDisabled}
          />
        </div>
      </FormItem>
      <FormItem label="Zen Mode">Try clicking the logo in the top left!</FormItem>
      <FormItem label="Reset Settings">
        <button
          className="w-full max-w-[300px] px-3 py-1.5 rounded text-[var(--fs-input)] border hover:opacity-50 transition-opacity cursor-pointer"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--foreground) 7%, transparent)',
            color: 'var(--foreground)',
            borderColor: 'color-mix(in srgb, var(--foreground) 15%, transparent)',
          }}
          onClick={() => {
            confirmDialog('Sure?').then((r) => {
              if (r) {
                const { userPatterns } = settingsMap.get();
                settingsMap.set({ ...defaultSettings, userPatterns });
              }
            });
          }}
        >
          restore default settings
        </button>
      </FormItem>
    </div>
  );
}
