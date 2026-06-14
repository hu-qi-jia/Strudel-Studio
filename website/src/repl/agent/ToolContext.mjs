// ToolContext.mjs — 为插件工具构建「收窄的能力对象」。
//
// 设计原则（方案 B 决策 #1、#3）：
// - 插件工具只能拿到它声明且用户已授予的能力，拿不到 editorRef / localStorage / 原始 fetch。
// - 不提供 editor:write：插件若要改代码，应返回建议，由 LLM 调核心 write_code（过 validateCode +
//   危险调用拦截）落地。单一写入口，安全收益继承。读/感知/net 才对插件开放。
// - audio:decode 直连 getAudioContext().decodeAudioData：不发声音、不切 context、不碰 scheduler，
//   对任务一修好的实时 context 零回归风险。禁止复用导出里的 setAudioContext swap。

import { getAudioContext } from '@strudel/webaudio';

// capability -> { facet(挂到 ctx 上的键名), build(deps) -> 该 facet 的实现 }
const CAPABILITIES = {
  'editor:read': {
    facet: 'editor',
    build: (deps) => ({
      read: () => deps.editorRef.current?.code ?? '',
    }),
  },
  'sounds:query': {
    facet: 'sounds',
    build: (deps) => ({
      query: (f) => deps.soundRegistry.query(f),
      get: (name) => deps.soundRegistry.getSound(name),
    }),
  },
  'attachments:read': {
    facet: 'attachments',
    build: (deps) => deps.attachments, // { list, read(handleId)->ArrayBuffer, meta(handleId) }
  },
  'audio:decode': {
    facet: 'audio',
    build: () => ({
      decode: (buf) => getAudioContext().decodeAudioData(buf),
    }),
  },
  'net:fetch': {
    facet: 'net',
    build: (deps) => ({
      // 白名单域 + credentials:'omit'：插件联网不经过页面 cookie，也接触不到 API key。
      fetch: makeWhitelistedFetch(deps.allowedDomains || []),
    }),
  },
};

function makeWhitelistedFetch(allowedDomains) {
  return async (url, opts = {}) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new Error(`net.fetch blocked: invalid url "${url}"`);
    }
    const ok = allowedDomains.some(
      (d) => u.hostname === d || u.hostname.endsWith('.' + d),
    );
    if (!ok) {
      throw new Error(
        `net.fetch blocked: ${u.hostname} is not in this plugin's allowlist [${allowedDomains.join(', ')}]`,
      );
    }
    return fetch(url, { ...opts, credentials: 'omit' });
  };
}

/**
 * 按已授予能力集，组装一个收窄的 ctx。
 * @param {Set<string>|string[]} grantedCaps
 * @param {object} deps — { editorRef, soundRegistry, attachments, allowedDomains }
 * @returns {object} ctx —— 只有被授权的 facet 才会出现
 */
export function buildToolContext(grantedCaps, deps) {
  const ctx = {};
  const caps = grantedCaps instanceof Set ? grantedCaps : new Set(grantedCaps);
  for (const [cap, def] of Object.entries(CAPABILITIES)) {
    if (!caps.has(cap)) continue;
    try {
      ctx[def.facet] = def.build(deps);
    } catch (e) {
      // 某个能力构建失败（如依赖未注入）不应拖垮其它能力，跳过即可
      console.warn(`[ToolContext] failed to build capability "${cap}":`, e);
    }
  }
  return ctx;
}

/** 框架支持的全部能力名（供设置面板展示/校验用）。 */
export const ALL_CAPABILITIES = Object.keys(CAPABILITIES);
