// ToolContext.mjs — 为插件工具构建稳定的依赖对象。
//
// 瘦身版（见 agent 评审 Tier 3）：
// - 插件是仓库内编译、强制启用的内置功能（无第三方加载、无运行时隔离需求），
//   故不再维护 capability scoping / least-privilege ctx / net:fetch 域名白名单——
//   那套机制对「作者自己写的、打进 bundle 的函数」零安全增益，纯属架构宇航。
// - 仍把依赖收窄成一个稳定的小对象（editor.read / sounds / attachments / audio.decode），
//   让插件不直接接触 editorRef / 全局 audio context，便于测试与替换实现。
// - 不提供 editor:write：插件若要改代码，应返回建议，由 LLM 调核心 write_code 落地
//   （单一写入口，复用 validateCode + 危险调用拦截 + 自动试听）。读/感知/解码才对插件开放。

import { getAudioContext } from '@strudel/webaudio';

/**
 * 组装插件依赖对象（一次性，所有插件共享同一实例）。
 * @param {object} deps — { editorRef, soundRegistry, attachments }
 * @returns {object} { editor, sounds, attachments, audio }
 */
export function buildPluginDeps(deps) {
  return {
    editor: {
      read: () => deps.editorRef.current?.code ?? '',
    },
    sounds: {
      query: (f) => deps.soundRegistry.query(f),
      get: (name) => deps.soundRegistry.getSound(name),
    },
    // attachments: { list, read(handleId)->ArrayBuffer, meta(handleId) }（由 attachments.mjs 提供）
    attachments: deps.attachments,
    audio: {
      // 直连 decodeAudioData：不发声音、不切 context、不碰 scheduler，
      // 对实时音频路径零回归风险。
      decode: (buf) => getAudioContext().decodeAudioData(buf),
    },
  };
}
