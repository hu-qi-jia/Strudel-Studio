// AnalysisPanel.jsx — analyze_audio 工具结果的自定义渲染器。
// 由 ChatMessage 在「存在结构化 resultData」时分发渲染（见 ChatMessage 的 renderers 查表）。
// 展示 tempo / 时长 / onset 数 / 音高范围 / 置信度提示 + 草稿 pattern（只读）。
// 产物本体（草稿 pattern）经 LLM 调 write_code 写入编辑器；本面板偏辅助展示。

import cx from '@src/cx.mjs';

const F_60 = 'color-mix(in srgb, var(--foreground) 60%, transparent)';
const F_45 = 'color-mix(in srgb, var(--foreground) 45%, transparent)';
const F_35 = 'color-mix(in srgb, var(--foreground) 35%, transparent)';
const BORDER = 'color-mix(in srgb, var(--foreground) 15%, transparent)';
const BG = 'color-mix(in srgb, var(--foreground) 5%, transparent)';

function Stat({ label, value }) {
  return (
    <span style={{ color: F_45 }}>
      {label} <b style={{ color: F_60 }}>{value}</b>
    </span>
  );
}

export default function AnalysisPanel({ invocation }) {
  const data = invocation?.resultData;
  // ChatMessage 仅在 resultData 存在时分发本渲染器（无 data 会回退 ToolCallBadge，
  // call 态的「...」也由 ToolCallBadge 显示）；此处防御性兜底。
  if (!data) return null;
  const tempo = data.tempo || {};
  const pr = data.pitchRange;

  return (
    <div
      className={cx('flex flex-col gap-1 px-2 py-1.5 rounded-sm text-[var(--fs-label)] border w-full')}
      style={{ borderColor: BORDER, backgroundColor: BG }}
    >
      <div className="flex items-center gap-1.5">
        <span style={{ color: F_60 }}>♪</span>
        <span className="font-mono">analyze_audio</span>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        <Stat label="tempo" value={tempo.bpm ? `≈ ${Math.round(tempo.bpm)} BPM` : '—'} />
        <Stat label="duration" value={`${data.durationSec ?? '—'}s`} />
        <Stat label="onsets" value={data.onsetCount ?? 0} />
        {pr && <Stat label="pitch" value={`${pr.low}–${pr.high}`} />}
        {data.melodyNoteCount != null && (
          <Stat label="melody" value={`${data.melodyNoteCount} notes`} />
        )}
      </div>

      {data.confidenceNote && (
        <div style={{ color: F_35, lineHeight: 1.3 }}>{data.confidenceNote}</div>
      )}

      {data.draftPattern && (
        <pre
          className="font-mono whitespace-pre-wrap break-words max-h-40 overflow-auto m-0"
          style={{ color: F_45, fontSize: 'var(--fs-hint, 11px)' }}
        >
          {data.draftPattern}
        </pre>
      )}
    </div>
  );
}
