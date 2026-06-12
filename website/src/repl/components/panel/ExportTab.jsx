import cx from '@src/cx.mjs';
import { useState } from 'react';
import { FormItem, Checkbox } from './Forms';
import { getAudioContext } from '@strudel/webaudio';

const inputStyle = {
  height: '32px',
  fontSize: 'var(--fs-input)',
  lineHeight: '1.4',
  backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
  borderColor: 'color-mix(in srgb, var(--foreground) 20%, transparent)',
  borderRadius: '0',
};

export default function ExportTab({ handleExport }) {
  const [downloadName, setDownloadName] = useState('');
  const [startCycle, setStartCycle] = useState(0);
  const [endCycle, setEndCycle] = useState(1);
  const [sampleRate, setSampleRate] = useState(48000);
  const [multiChannelOrbits, setMultiChannelOrbits] = useState(true);
  const [maxPolyphony, setMaxPolyphony] = useState(1024);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [length, setLength] = useState(1);
  const [errorMsg, setErrorMsg] = useState('');

  const refreshProgress = () => {
    const audioContext = getAudioContext();
    if (audioContext instanceof OfflineAudioContext) {
      setProgress(audioContext.currentTime);
      setLength(audioContext.length / sampleRate);
      setTimeout(refreshProgress, 100);
    }
  };

  return (
    <div className="text-foreground w-full p-3 overflow-y-auto h-full">
      <FormItem label="File name" sublabel="Leave empty to use current date">
        <input
          type="text"
          disabled={exporting}
          placeholder=""
          className={cx('w-full px-2 py-1 border outline-none text-foreground', exporting && 'opacity-50')}
          style={inputStyle}
          value={downloadName}
          onChange={(e) => setDownloadName(e.target.value)}
        />
      </FormItem>

      <div className="flex gap-3">
        <div className="flex-1">
          <FormItem label="Start cycle">
            <input
              type="number"
              min={0}
              disabled={exporting}
              className={cx('w-full px-2 py-1 border outline-none text-foreground', exporting && 'opacity-50')}
              style={inputStyle}
              value={startCycle}
              onBlur={(e) => {
                let v = parseInt(e.target.value);
                v = isNaN(v) ? 0 : Math.max(0, v);
                setStartCycle(v);
              }}
              onChange={(e) => setStartCycle(parseInt(e.target.value) || 0)}
            />
          </FormItem>
        </div>
        <div className="flex-1">
          <FormItem label="End cycle">
            <input
              type="number"
              min={1}
              disabled={exporting}
              className={cx('w-full px-2 py-1 border outline-none text-foreground', exporting && 'opacity-50')}
              style={inputStyle}
              value={endCycle}
              onBlur={(e) => {
                let v = parseInt(e.target.value);
                v = isNaN(v) ? Math.max(startCycle + 1, parseInt(v)) : v;
                setEndCycle(v);
              }}
              onChange={(e) => setEndCycle(parseInt(e.target.value) || 1)}
            />
          </FormItem>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <FormItem label="Sample rate">
            <input
              type="number"
              min={1}
              disabled={exporting}
              className={cx('w-full px-2 py-1 border outline-none text-foreground', exporting && 'opacity-50')}
              style={inputStyle}
              value={sampleRate}
              onBlur={(e) => {
                let v = parseInt(e.target.value);
                v = isNaN(v) ? 1 : Math.max(1, v);
                setSampleRate(v);
              }}
              onChange={(e) => setSampleRate(parseInt(e.target.value) || 48000)}
            />
          </FormItem>
        </div>
        <div className="flex-1">
          <FormItem label="Max polyphony">
            <input
              type="number"
              min={1}
              disabled={exporting}
              className={cx('w-full px-2 py-1 border outline-none text-foreground', exporting && 'opacity-50')}
              style={inputStyle}
              value={maxPolyphony}
              onBlur={(e) => {
                let v = parseInt(e.target.value);
                v = isNaN(v) ? Math.max(1, parseInt(v)) : v;
                setMaxPolyphony(v);
              }}
              onChange={(e) => setMaxPolyphony(Math.max(1, parseInt(e.target.value) || 1024))}
            />
          </FormItem>
        </div>
      </div>

      <FormItem>
        <Checkbox
          label="Multi Channel Orbits"
          disabled={exporting}
          value={multiChannelOrbits}
          onChange={(e) => setMultiChannelOrbits(e.target.checked)}
        />
      </FormItem>

      <button
        className={cx(
          'w-full py-2 border rounded-sm text-[var(--fs-label)] cursor-pointer transition-colors relative overflow-hidden',
          exporting && 'opacity-50 cursor-not-allowed',
        )}
        style={{
          borderColor: 'color-mix(in srgb, var(--foreground) 25%, transparent)',
          backgroundColor: 'color-mix(in srgb, var(--foreground) 8%, transparent)',
        }}
        disabled={exporting}
        onClick={async () => {
          setExporting(true);
          setErrorMsg('');
          setTimeout(refreshProgress, 2000);
          try {
            await handleExport(startCycle, endCycle, sampleRate, maxPolyphony, multiChannelOrbits, downloadName);
          } catch (err) {
            setErrorMsg(err?.message || 'Export failed');
          } finally {
            setExporting(false);
            setProgress(0);
            setLength(1);
          }
        }}
      >
        {exporting && (
          <div
            className="absolute top-0 left-0 bottom-0"
            style={{
              width: `${(progress / length) * 100}%`,
              backgroundColor: 'color-mix(in srgb, var(--foreground) 12%, transparent)',
            }}
          />
        )}
        <span className="relative">{exporting ? `Exporting... ${Math.min(100, Math.round((progress / length) * 100))}%` : 'Export to WAV'}</span>
      </button>

      {errorMsg && (
        <p className="mt-2 text-[var(--fs-hint)]" style={{ color: '#e55' }}>
          {errorMsg}
        </p>
      )}
    </div>
  );
}
