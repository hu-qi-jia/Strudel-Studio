// ToolRegistry.mjs — agent 内置工具聚合器（单例）。
//
// 瘦身完成版：不再维护「插件注册中心」概念——3 个内置功能（mp3-analyzer /
// web-research / song-library）在构造时硬编码注册，无动态 register/unregister API。
// 此前的「半截子瘦身」保留了注册中心 API 却无第三方插件使用，纯属架构宇航。
//
// 保留的价值：getTools/getRenderers/getChatInputActions 聚合 3 个内置功能的
// 工具/UI 渲染器/聊天输入动作，供 useAgent 统一消费。
//
// 新增内置功能：在 BUILTIN_PLUGINS 数组加一条 import + 即可，无需 register 调用。

import { tool } from 'ai';
import { buildPluginDeps } from './ToolContext.mjs';
import mp3Analyzer from './plugins/mp3-analyzer/plugin.mjs';
import webResearch from './plugins/web-research/plugin.mjs';
import songLibrary from './plugins/song-library/plugin.mjs';

// 内置功能清单（硬编码，无动态注册）。新增功能在此追加一行即可。
const BUILTIN_PLUGINS = [mp3Analyzer, webResearch, songLibrary];

class ToolRegistry {
  constructor() {
    this.plugins = new Map();
    this._toolOwners = new Map(); // toolName -> pluginId，用于冲突检测
    for (const p of BUILTIN_PLUGINS) this._register(p);
  }

  // 内部注册（仅构造时调用，不公开）。保留冲突检测让开发期 fail-fast。
  _register(plugin) {
    validateManifest(plugin);
    const seenInThis = new Set();
    for (const t of plugin.tools || []) {
      if (seenInThis.has(t.name)) {
        throw new Error(
          `[ToolRegistry] plugin "${plugin.id}" declares duplicate tool name "${t.name}"`,
        );
      }
      seenInThis.add(t.name);
      const owner = this._toolOwners.get(t.name);
      if (owner) {
        throw new Error(
          `[ToolRegistry] tool name "${t.name}" is already owned by plugin "${owner}"; ` +
            `plugin "${plugin.id}" must use a unique name (convention: <pluginId>_<verb>).`,
        );
      }
    }
    this.plugins.set(plugin.id, plugin);
    for (const t of plugin.tools || []) this._toolOwners.set(t.name, plugin.id);
  }

  /**
   * 组装所有内置插件的 AI-SDK 工具。依赖对象构建一次，所有插件共享。
   * @param {object} deps — { editorRef, soundRegistry, attachments }
   * @returns {object} { toolName: ai-sdk tool } —— 供 streamText({ tools }) 使用
   */
  getTools(deps) {
    const pluginDeps = buildPluginDeps(deps);
    const tools = {};
    for (const plugin of this.plugins.values()) {
      for (const t of plugin.tools || []) {
        tools[t.name] = tool({
          description: t.description,
          inputSchema: t.inputSchema,
          execute: async (input) => t.execute(input, pluginDeps),
        });
      }
    }
    return tools;
  }

  /** 所有内置插件的工具结果渲染器：{ toolName: ReactComp }。 */
  getRenderers() {
    const map = {};
    for (const plugin of this.plugins.values()) {
      Object.assign(map, plugin.ui?.renderers || {});
    }
    return map;
  }

  /** 所有内置插件贡献的对话输入动作数组（如「上传音频」按钮）。 */
  getChatInputActions() {
    const actions = [];
    for (const plugin of this.plugins.values()) {
      actions.push(...(plugin.ui?.chatInputActions || []));
    }
    return actions;
  }
}

// 清单结构强校验——开发期 fail-fast，报错信息点名缺哪个字段。
function validateManifest(p) {
  const where = p && p.id ? `plugin "${p.id}"` : 'a plugin';
  const need = (cond, msg) => {
    if (!cond) throw new Error(`[ToolRegistry] invalid manifest for ${where}: ${msg}`);
  };
  need(p && typeof p === 'object', 'manifest must be an object');
  need(typeof p.id === 'string' && p.id.length > 0, 'id must be a non-empty string');
  need(typeof p.version === 'string', 'version must be a string');
  need(Array.isArray(p.tools) && p.tools.length > 0, 'tools must be a non-empty array');
  for (const t of p.tools) {
    need(t && typeof t === 'object', 'each tool must be an object');
    need(typeof t.name === 'string' && t.name.length > 0, 'each tool.name must be a non-empty string');
    need(/^[a-z0-9_]+$/.test(t.name), `tool.name "${t.name}" must match /^[a-z0-9_]+$/ (lowercase, digits, underscore) — provider function names reject other characters`);
    need(typeof t.description === 'string' && t.description.length > 0, `tool "${t.name}".description must be a non-empty string`);
    need(t.inputSchema && typeof t.inputSchema === 'object', `tool "${t.name}".inputSchema must be an object`);
    need(typeof t.execute === 'function', `tool "${t.name}".execute must be a function`);
  }
  if (p.ui != null) {
    need(typeof p.ui === 'object', 'ui must be an object');
    if (p.ui.chatInputActions != null) need(Array.isArray(p.ui.chatInputActions), 'ui.chatInputActions must be an array');
    if (p.ui.renderers != null) need(p.ui.renderers && typeof p.ui.renderers === 'object', 'ui.renderers must be an object');
  }
}

export const toolRegistry = new ToolRegistry();
