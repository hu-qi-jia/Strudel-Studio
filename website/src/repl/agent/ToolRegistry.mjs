// ToolRegistry.mjs — agent 内置功能（工具扩展）注册中心（单例，仿 SoundRegistry.mjs）。
//
// 设计（v2）：不再向终端用户暴露「插件 / 权限授权」概念。所有已注册的内置功能默认启用，
// 工具按其声明的 requires 自动获得「最小权限 ctx」（capability-scoping 作为内部最小权限保留，
// 不再要用户勾选授权）。enabled/permissions 门控与 $pluginsConfig 一并移除——mp3-analyzer 这类
// 本地功能对用户而言就是 agent 的基础能力，零配置可用。
//
// 这仍是「开发者扩展 agent」的内部架构：新增功能 = 写一个清单 + register + 重新构建。
// 作者文档见 src/repl/agent/plugins/README.md。
//
// 安全护栏（留待未来）：net:fetch 类「网络外发」能力目前会随 requires 一起自动授权（当前无插件
// 使用）。未来若有功能用 net:fetch 做第三方外发，应改为「触发时单次确认」，而非此处静默授权。
//
// 校验：register() 强校验清单结构 + 工具名全局唯一（命名空间靠「冲突即报错」保证），
// 让开发者在应用加载时立即发现错误，而不是运行期才暴露。

import { tool } from 'ai';
import { buildToolContext } from './ToolContext.mjs';

// 内置功能清单（AgentFeature）类型（JSDoc；register 会强校验）：
//   { id, version, description?, permissions:[{capability,reason}],
//     tools:[{name,description,inputSchema,requires,execute}],
//     ui?: { chatInputActions?:[{id,label,accept?,icon?}], renderers?:{ [toolName]: ReactComp } } }

class ToolRegistry {
  constructor() {
    this.plugins = new Map();
    this._toolOwners = new Map(); // toolName -> pluginId，用于冲突检测
  }

  register(plugin) {
    validateManifest(plugin);
    // 同 id 重复注册（如模块热重载）：先清掉旧工具名归属，避免旧名残留阻塞
    if (this.plugins.has(plugin.id)) this.unregister(plugin.id);
    // 工具名冲突检测（命名空间保护）：工具名是 streamText tools 的全局键，
    // 两个功能重名会静默覆盖。注册期即抛错，强制开发者用唯一名（约定 <pluginId>_<verb> 前缀）。
    // 同时检测「本清单内部重名」：两个同名 tool 会让后者在 getTools()/getRenderers() 里
    // 静默 shadow 前者，同样难以排查，故一并 fail-fast。
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

  unregister(id) {
    const plugin = this.plugins.get(id);
    if (!plugin) return;
    for (const t of plugin.tools || []) this._toolOwners.delete(t.name);
    this.plugins.delete(id);
  }

  list() {
    return Array.from(this.plugins.values());
  }

  /**
   * 组装所有已注册插件的 AI-SDK 工具。每个工具按其 requires 自动获得最小权限 ctx。
   * @param {object} deps — 传给 ToolContext 的依赖（editorRef/soundRegistry/attachments/allowedDomains）
   * @returns {object} { toolName: ai-sdk tool } —— 供 streamText({ tools }) 使用
   */
  getTools(deps) {
    const tools = {};
    for (const plugin of this.plugins.values()) {
      for (const t of plugin.tools || []) {
        // least-privilege：ctx 只含工具声明的 requires 能力
        const caps = new Set(t.requires || []);
        const toolCtx = buildToolContext(caps, deps);
        tools[t.name] = tool({
          description: t.description,
          inputSchema: t.inputSchema,
          execute: async (input) => t.execute(input, toolCtx),
        });
      }
    }
    return tools;
  }

  /** 所有已注册插件的工具结果渲染器：{ toolName: ReactComp }。 */
  getRenderers() {
    const map = {};
    for (const plugin of this.plugins.values()) {
      Object.assign(map, plugin.ui?.renderers || {});
    }
    return map;
  }

  /** 所有已注册插件贡献的对话输入动作数组（如「上传音频」按钮）。 */
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
  need(Array.isArray(p.permissions), 'permissions must be an array');
  for (const perm of p.permissions) {
    need(perm && typeof perm === 'object', 'each permission must be an object');
    need(typeof perm.capability === 'string' && perm.capability.length > 0, 'each permission.capability must be a non-empty string');
    need(typeof perm.reason === 'string' && perm.reason.length > 0, `permission "${perm.capability}".reason must be a non-empty string`);
  }
  need(Array.isArray(p.tools) && p.tools.length > 0, 'tools must be a non-empty array');
  for (const t of p.tools) {
    need(t && typeof t === 'object', 'each tool must be an object');
    need(typeof t.name === 'string' && t.name.length > 0, 'each tool.name must be a non-empty string');
    need(/^[a-z0-9_]+$/.test(t.name), `tool.name "${t.name}" must match /^[a-z0-9_]+$/ (lowercase, digits, underscore) — provider function names reject other characters`);
    need(typeof t.description === 'string' && t.description.length > 0, `tool "${t.name}".description must be a non-empty string`);
    need(t.inputSchema && typeof t.inputSchema === 'object', `tool "${t.name}".inputSchema must be an object`);
    need(Array.isArray(t.requires), `tool "${t.name}".requires must be an array of capability strings`);
    need(typeof t.execute === 'function', `tool "${t.name}".execute must be a function`);
  }
  if (p.ui != null) {
    need(typeof p.ui === 'object', 'ui must be an object');
    if (p.ui.chatInputActions != null) need(Array.isArray(p.ui.chatInputActions), 'ui.chatInputActions must be an array');
    if (p.ui.renderers != null) need(p.ui.renderers && typeof p.ui.renderers === 'object', 'ui.renderers must be an object');
  }
}

export const toolRegistry = new ToolRegistry();
