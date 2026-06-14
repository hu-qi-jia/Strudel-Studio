// plugin.mjs — mp3-analyzer 插件清单（首个示范插件）。
//
// 声明：申请 attachments:read（读附件字节）+ audio:decode（浏览器内解码）两项能力。
// 工具 analyze_audio 在这两项「全部已授予」时才进入本轮 toolset（见 ToolRegistry.getTools）。
// 产物是「草稿 pattern + 特征」——不直接写编辑器，由 LLM 调核心 write_code 落地
// （单一写入口，复用 validateCode + 危险调用拦截 + 自动试听）。
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

  permissions: [
    {
      capability: 'attachments:read',
      reason: 'Read the bytes of your uploaded audio attachment for local analysis',
    },
    {
      capability: 'audio:decode',
      reason: 'Decode mp3/wav to PCM in-browser (no playback, no audio-context switching)',
    },
  ],

  tools: [
    {
      name: 'analyze_audio',
      description:
        'Analyze an attached audio file (mp3/wav/etc.) and derive a draft Strudel pattern capturing its rhythm (onsets + tempo) and melody (pitch contour). Pass the handleId given in the user message attachment note. Returns tempo, onset count, pitch range, a confidence note, and a ready-to-commit draftPattern. Then call write_code with the draftPattern (it auto-plays and validates). Rhythm/tempo are reliable; melody is monophonic best-effort.',
      requires: ['attachments:read', 'audio:decode'],
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
      execute: async (input, ctx) => analyze(input.handleId, ctx),
    },
  ],

  ui: {
    chatInputActions: [
      {
        id: 'upload-audio',
        label: 'upload audio for analysis',
        accept: 'audio/*',
        icon: '♪',
      },
    ],
    renderers: {
      analyze_audio: AnalysisPanel,
    },
  },
};

export default plugin;
