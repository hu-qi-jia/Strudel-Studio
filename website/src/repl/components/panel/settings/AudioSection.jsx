import { useSettings, settingsMap } from '@root/website/src/settings.mjs';
import { isUdels } from '@root/website/src/repl/util.mjs';
import { Checkbox, FormItem, SelectInput } from '../Forms.jsx';
import { AudioDeviceSelector } from '../AudioDeviceSelector.jsx';
import { AudioEngineTargetSelector } from '../AudioEngineTargetSelector.jsx';
import { confirmDialog } from '@root/website/src/repl/util.mjs';
import { DEFAULT_MAX_POLYPHONY, setMaxPolyphony, setMultiChannelOrbits } from '@strudel/webaudio';

const RELOAD_MSG = 'Changing this setting requires the window to reload itself. OK?';

export function AudioSection({ started }) {
  const { audioDeviceName, audioEngineTarget, maxPolyphony, multiChannelOrbits } = useSettings();
  const shouldAlwaysSync = isUdels();
  const canChangeAudioDevice = AudioContext.prototype.setSinkId != null;

  return (
    <div className="space-y-1 w-full">
      {canChangeAudioDevice && (
        <FormItem label="Audio Output Device">
          <AudioDeviceSelector
            isDisabled={started}
            audioDeviceName={audioDeviceName}
            onChange={(audioDeviceName) => {
              confirmDialog(RELOAD_MSG).then((r) => {
                if (r == true) {
                  settingsMap.setKey('audioDeviceName', audioDeviceName);
                  return window.location.reload();
                }
              });
            }}
          />
        </FormItem>
      )}
      <FormItem label="Audio Engine Target">
        <AudioEngineTargetSelector
          target={audioEngineTarget}
          onChange={(target) => {
            confirmDialog(RELOAD_MSG).then((r) => {
              if (r == true) {
                settingsMap.setKey('audioEngineTarget', target);
                return window.location.reload();
              }
            });
          }}
        />
      </FormItem>
      <FormItem label="Maximum Polyphony">
        <input
          type="number"
          defaultValue={maxPolyphony}
          onBlur={(e) => {
            let v = parseInt(e.target.value);
            v = isNaN(v) || v < 1 ? DEFAULT_MAX_POLYPHONY : v;
            setMaxPolyphony(v);
            settingsMap.setKey('maxPolyphony', v);
          }}
          className="w-full px-2 py-1 border outline-none text-foreground"
          style={{
            height: '32px',
            fontSize: 'var(--fs-input)',
            lineHeight: '1.4',
            backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
            borderColor: 'color-mix(in srgb, var(--foreground) 20%, transparent)',
            borderRadius: '0',
          }}
        />
      </FormItem>
      <FormItem>
        <Checkbox
          label="Multi Channel Orbits"
          onChange={(cbEvent) => {
            const val = cbEvent.target.checked;
            confirmDialog(RELOAD_MSG).then((r) => {
              if (r == true) {
                settingsMap.setKey('multiChannelOrbits', val);
                setMultiChannelOrbits(val);
                return window.location.reload();
              }
            });
          }}
          value={multiChannelOrbits}
        />
      </FormItem>
    </div>
  );
}
