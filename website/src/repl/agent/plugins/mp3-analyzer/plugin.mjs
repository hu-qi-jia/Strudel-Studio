// plugin.mjs — mp3-analyzer 插件清单（首个示范插件）。
//
// 内置功能：默认启用，无授权流程。工具 analyze_audio 收到稳定的 deps 对象
// （attachments.read + audio.decode）。产物是「草稿 pattern + 特征」——不直接写编辑器，
// 由 LLM 调核心 write_code 落地（单一写入口，复用 validateCode + 危险调用拦截 + 自动试听）。
//
// ui：
//   chatInputActions —— 贡献「上传音频」按钮到对话输入栏（accept=audio/*）。
//   renderers —— analyze_audio 的结果用 AnalysisPanel 渲染（读 invocation.resultData）。

import { jsonSchema } from 'ai';
import { analyze } from './analyzer.mjs';
import AnalysisPanel from './AnalysisPanel.jsx';

const plugin = {
  id: 'mp3-analyzer',
  version: '0.1.0',
  description:
    'Analyze an uploaded audio file and derive a draft Strudel pattern capturing its rhythm and melody.',

  tools: [
    {
      name: 'analyze_audio',
      description:
        'Analyze an attached audio file (mp3/wav/etc.) and derive a draft Strudel pattern capturing its rhythm (onsets + tempo) and melody (pitch contour). Pass the handleId given in the user message attachment note. Returns tempo, onset count, pitch range, a confidence note, and a ready-to-commit draftPattern. Then call write_code with the draftPattern (it auto-plays and validates). Rhythm/tempo are reliable; melody is monophonic best-effort.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          handleId: {
            type: 'string',
            description:
              'The handleId of the attached audio file to analyze (found in the user message attachment note).',
          },
        },
        required: ['handleId'],
      }),
      execute: async (input, deps) => analyze(input.handleId, deps),
    },
  ],

  ui: {
    chatInputActions: [
      {
        id: 'upload-audio',
        label: 'upload audio for analysis',
        accept: 'audio/*',
        // 语义名：ChatInput 的 ACTION_ICONS 映射成单色 plus 图标。
        icon: 'add',
      },
    ],
    renderers: {
      analyze_audio: AnalysisPanel,
    },
  },
};

export default plugin;
