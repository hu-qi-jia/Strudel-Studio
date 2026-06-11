# Strudel 项目 Code Wiki

## 项目概述

**Strudel** 是 [TidalCycles](https://tidalcycles.org/) 的 JavaScript 移植版本,是一个用于网页实时编程(live coding)的音乐模式系统。它允许用户使用简洁的迷你记谱法(mini notation)来创建复杂的音乐模式,并通过 Web Audio API 实时播放。

- **官方网站**: https://strudel.cc/
- **源码仓库**: https://codeberg.org/uzu/strudel
- **许可证**: GNU Affero General Public License v3 (AGPL-3.0-or-later)
- **当前版本**: 1.2.x 系列

### 核心特性

- 🎵 **实时编程**: 支持实时编辑和播放音乐模式
- 🎨 **迷你记谱法**: 简洁的模式描述语法
- 🔊 **Web Audio**: 基于 Web Audio API 的音频引擎
- 🎹 **多种音源**: 支持采样、合成器、SoundFonts 等
- 🖥️ **REPL 环境**: 提供交互式编程环境
- 🌐 **跨平台**: 支持浏览器和桌面应用(Tauri)

## 文档导航

本 Wiki 文档包含以下部分:

1. [架构设计](./architecture.md) - 项目整体架构和技术栈
2. [核心模块](./core-modules.md) - 核心包详解和关键类说明
3. [扩展模块](./extension-modules.md) - 功能扩展包说明
4. [依赖关系](./dependencies.md) - 包依赖关系图和外部依赖
5. [开发指南](./development.md) - 项目运行、构建和开发流程

## 快速开始

### 安装依赖

```bash
# 克隆仓库
git clone https://codeberg.org/uzu/strudel.git
cd strudel

# 安装 pnpm (如果尚未安装)
npm install -g pnpm

# 安装项目依赖
pnpm install
```

### 启动开发服务器

```bash
# 启动 REPL 开发服务器
pnpm dev

# 或者
pnpm start
```

访问 http://localhost:3000 即可看到 Strudel REPL 界面。

### 运行测试

```bash
# 运行所有测试
pnpm test

# 运行测试并显示 UI
pnpm test-ui

# 运行测试覆盖率
pnpm test-coverage
```

## 项目结构

```
strudel/
├── packages/              # 核心包和扩展包
│   ├── core/             # 核心模式系统
│   ├── mini/             # 迷你记谱法解析器
│   ├── webaudio/         # Web Audio 绑定
│   ├── superdough/       # 音频引擎
│   ├── codemirror/       # 代码编辑器扩展
│   ├── repl/             # REPL 组件
│   └── ...               # 其他扩展包
├── website/              # 官方网站和文档
├── examples/             # 示例项目
├── src-tauri/            # Tauri 桌面应用配置
└── test/                 # 集成测试
```

## 技术栈

- **语言**: JavaScript (ES6+), TypeScript (部分)
- **包管理**: pnpm + Lerna (monorepo)
- **构建工具**: Vite
- **测试框架**: Vitest
- **前端框架**: Astro + React
- **代码编辑器**: CodeMirror 6
- **音频**: Web Audio API
- **桌面应用**: Tauri (可选)

## 社区资源

- **Discord**: [TidalCycles Discord](https://discord.com/invite/HGEdXmRkzT) (#strudel 频道)
- **论坛**: [Tidal Club Forum](https://club.tidalcycles.org/)
- **Mastodon**: [@strudel@social.toplap.org](https://social.toplap.org/@strudel)

## 贡献指南

详见 [CONTRIBUTING.md](../CONTRIBUTING.md) 或查看 [开发指南](./development.md)。

## 许可证

本项目采用 GNU Affero General Public License v3 许可证。这意味着:
- 可以自由使用、修改和分发
- 衍生作品必须使用相同的许可证
- 网络服务使用也需要开源
