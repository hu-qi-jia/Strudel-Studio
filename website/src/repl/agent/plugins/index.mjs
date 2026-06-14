// plugins/index.mjs — 启动期注册内置插件。
//
// 引入即注册（副作用）：useAgent.jsx 顶部 `import './plugins/index.mjs'` 确保在
// 任意 getTools/getRenderers/getChatInputActions 调用前完成注册。
// register 用 Map.set，重复导入（模块缓存）幂等，安全。
//
// 新增内置插件：import + toolRegistry.register(...) 即可。

import { toolRegistry } from '../ToolRegistry.mjs';
import mp3Analyzer from './mp3-analyzer/plugin.mjs';

toolRegistry.register(mp3Analyzer);
