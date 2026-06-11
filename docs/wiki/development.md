# 开发指南

本文档详细介绍如何开发、构建和测试 Strudel 项目。

## 环境准备

### 系统要求

- **Node.js**: >= 18.x
- **pnpm**: >= 8.x
- **Git**: 最新版本

### 安装 Node.js

推荐使用 [nvm](https://github.com/nvm-sh/nvm) (Node Version Manager):

```bash
# 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# 安装 Node.js
nvm install 20
nvm use 20

# 验证安装
node --version  # v20.x.x
npm --version   # 10.x.x
```

### 安装 pnpm

```bash
# 使用 npm 安装
npm install -g pnpm

# 或使用独立安装脚本
curl -fsSL https://get.pnpm.io/install.sh | sh -

# 验证安装
pnpm --version  # 8.x.x
```

### 安装 Git

```bash
# macOS (使用 Homebrew)
brew install git

# Linux (使用 apt)
sudo apt install git

# Windows
# 下载并安装: https://git-scm.com/download/win
```

## 项目设置

### 克隆仓库

```bash
# 从 Codeberg 克隆
git clone https://codeberg.org/uzu/strudel.git
cd strudel

# 或从 GitHub 镜像克隆 (如果可用)
git clone https://github.com/tidalcycles/strudel.git
cd strudel
```

### 安装依赖

```bash
# 安装所有依赖
pnpm install

# 这会:
# 1. 安装根目录依赖
# 2. 安装所有 packages/* 的依赖
# 3. 建立 workspace 链接
```

### 验证安装

```bash
# 运行测试
pnpm test

# 如果测试通过,说明安装成功
```

## 开发工作流

### 启动开发服务器

```bash
# 启动 REPL 开发服务器
pnpm dev

# 或
pnpm start

# 访问 http://localhost:3000
```

开发服务器支持:
- 热重载 (HMR)
- 实时预览
- 错误提示

### 代码编辑

推荐使用 [VS Code](https://code.visualstudio.com/):

#### 推荐扩展

```json
{
  "recommendations": [
    "esbenp.prettier-vscode",      // Prettier
    "dbaeumer.vscode-eslint",      // ESLint
    "orta.vscode-jest",            // Jest (Vitest)
    "ms-vscode.vscode-typescript-next"  // TypeScript
  ]
}
```

#### VS Code 设置

在 `.vscode/settings.json` 中:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "typescript.preferences.importModuleSpecifier": "relative"
}
```

### 代码风格

使用 Prettier 统一代码风格:

```bash
# 格式化所有文件
pnpm codeformat

# 检查格式
pnpm format-check
```

配置文件: `.prettierrc`

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5"
}
```

### 代码检查

使用 ESLint 进行代码检查:

```bash
# 运行 ESLint
pnpm lint

# 自动修复
pnpm lint --fix
```

配置文件: `eslint.config.mjs`

## 测试

### 运行测试

```bash
# 运行所有测试
pnpm test

# 运行测试并显示 UI
pnpm test-ui

# 运行测试覆盖率
pnpm test-coverage

# 运行特定包的测试
cd packages/core
pnpm test
```

### 测试框架

使用 [Vitest](https://vitest.dev/):

```javascript
// 示例测试文件: pattern.test.mjs
import { describe, it, expect } from 'vitest';
import { Pattern, sequence } from './pattern.mjs';

describe('Pattern', () => {
  it('should create a sequence', () => {
    const pattern = sequence('a', 'b', 'c');
    const events = pattern.queryArc(0, 1);
    expect(events).toHaveLength(3);
  });

  it('should reverse a pattern', () => {
    const pattern = sequence('a', 'b').rev();
    const events = pattern.queryArc(0, 1);
    expect(events[0].value).toBe('b');
  });
});
```

### 测试最佳实践

1. **单元测试**: 测试单个函数或类
2. **集成测试**: 测试多个模块的交互
3. **快照测试**: 测试输出是否匹配快照

#### 快照测试

```javascript
import { expect } from 'vitest';

it('should match snapshot', () => {
  const pattern = mini('a [b c]');
  const events = pattern.firstCycle();
  expect(events).toMatchSnapshot();
});
```

更新快照:

```bash
pnpm snapshot
```

### 基准测试

```bash
# 运行性能基准测试
pnpm bench

# 运行特定包的基准测试
cd packages/core
pnpm bench
```

基准测试示例:

```javascript
// pattern.bench.mjs
import { bench, describe } from 'vitest';
import { sequence } from './pattern.mjs';

describe('Pattern performance', () => {
  bench('sequence with 100 elements', () => {
    const values = Array.from({ length: 100 }, (_, i) => i);
    sequence(...values).queryArc(0, 1);
  });
});
```

## 构建

### 构建所有包

```bash
# 构建所有包
pnpm build

# 这会为每个包生成 dist/ 目录
```

### 构建单个包

```bash
cd packages/core
pnpm build
```

### 构建产物

每个包的构建产物:

```
packages/core/
├── dist/
│   ├── index.mjs      # ES 模块
│   └── index.mjs.map  # Source Map
└── package.json
```

### 构建配置

使用 [Vite](https://vitejs.dev/) 构建:

```javascript
// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'index.mjs',
      formats: ['es'],
      fileName: 'index'
    },
    sourcemap: true
  }
});
```

### 构建网站

```bash
# 构建生产版本
pnpm build

# 预览构建结果
pnpm preview
```

## 发布

### 版本管理

使用 Lerna 进行版本管理:

```bash
# 查看当前版本
npx lerna list

# 更新版本 (交互式)
npx lerna version --no-private

# 这会:
# 1. 更新 package.json 中的版本号
# 2. 创建 Git 标签
# 3. 推送到远程仓库
```

### 发布到 npm

```bash
# 登录 npm
npm login

# 干运行 (检查发布内容)
pnpm --filter "./packages/**" publish --dry-run

# 正式发布
pnpm --filter "./packages/**" publish --access public
```

### 发布检查清单

- [ ] 所有测试通过 (`pnpm test`)
- [ ] 代码格式正确 (`pnpm format-check`)
- [ ] ESLint 无错误 (`pnpm lint`)
- [ ] 更新 CHANGELOG
- [ ] 更新版本号
- [ ] 创建 Git 标签
- [ ] 发布到 npm

## 调试

### 浏览器调试

使用浏览器开发者工具:

1. 打开 http://localhost:3000
2. 按 F12 打开开发者工具
3. 在 Sources 面板中设置断点
4. 使用 Console 面板查看日志

### VS Code 调试

创建 `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["test"],
      "cwd": "${workspaceFolder}"
    }
  ]
}
```

### 日志调试

使用内置 logger:

```javascript
import { logger } from '@strudel/core';

logger('Debug message');
```

## 常见任务

### 添加新功能

1. 在适当的包中创建新文件
2. 实现功能
3. 导出函数/类
4. 编写测试
5. 更新文档

示例: 添加新的模式函数

```javascript
// packages/core/myfunction.mjs
import { Pattern } from './pattern.mjs';

/**
 * My custom pattern function
 * @param {any} value - The value
 * @returns {Pattern}
 */
export function myFunction(value) {
  return new Pattern((state) => {
    // 实现
  });
}

// packages/core/index.mjs
export * from './myfunction.mjs';
```

### 添加新包

1. 创建包目录:

```bash
mkdir packages/my-package
cd packages/my-package
```

2. 创建 package.json:

```json
{
  "name": "@strudel/my-package",
  "version": "1.0.0",
  "description": "My package",
  "main": "index.mjs",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "build": "vite build"
  },
  "dependencies": {
    "@strudel/core": "workspace:*"
  },
  "devDependencies": {
    "vite": "^6.0.11",
    "vitest": "^3.0.4"
  }
}
```

3. 创建源文件:

```javascript
// index.mjs
export * from './my-module.mjs';
```

4. 创建 Vite 配置:

```javascript
// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'index.mjs',
      formats: ['es']
    }
  }
});
```

5. 安装依赖:

```bash
cd ../..
pnpm install
```

### 修复 Bug

1. 创建测试用例重现 bug
2. 修复代码
3. 确保测试通过
4. 提交 PR

### 更新依赖

```bash
# 检查过时依赖
pnpm outdated

# 更新特定依赖
pnpm update package-name

# 更新所有依赖
pnpm update

# 更新到最新版本
pnpm update --latest
```

## CI/CD

### GitHub Actions / Forgejo Actions

配置文件: `.forgejo/workflows/test.yml`

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v3
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm test
```

### 运行所有检查

```bash
# 运行所有 CI 检查
pnpm check

# 这会运行:
# - format-check
# - lint
# - test
```

## 桌面应用

### 开发桌面应用

使用 [Tauri](https://tauri.app/):

```bash
# 安装 Tauri CLI
pnpm add -D @tauri-apps/cli

# 开发模式
pnpm tauri dev

# 构建生产版本
pnpm tauri build
```

### Tauri 配置

配置文件: `src-tauri/tauri.conf.json`

```json
{
  "build": {
    "beforeBuildCommand": "pnpm build",
    "beforeDevCommand": "pnpm dev",
    "devPath": "http://localhost:3000",
    "distDir": "../website/dist"
  },
  "tauri": {
    "bundle": {
      "active": true,
      "targets": "all"
    }
  }
}
```

## 性能优化

### 分析包体积

```bash
# 使用 vite-plugin-visualizer
pnpm add -D vite-plugin-visualizer

# 构建并生成报告
pnpm build

# 查看报告
open stats.html
```

### 优化建议

1. **Tree Shaking**: 使用 ES 模块
2. **代码分割**: 使用动态导入
3. **压缩**: 使用 Terser
4. **缓存**: 利用浏览器缓存

## 文档

### 生成 API 文档

```bash
# 使用 JSDoc 生成文档
pnpm jsdoc

# 生成 JSON 格式
pnpm jsdoc-json
```

### 编写文档

使用 JSDoc 注释:

```javascript
/**
 * Creates a pattern from a sequence of values.
 *
 * @param {...any} values - The values to sequence
 * @returns {Pattern} The resulting pattern
 * @example
 * const pattern = sequence('a', 'b', 'c');
 * // Creates a pattern that plays 'a', 'b', 'c' in sequence
 */
export function sequence(...values) {
  // ...
}
```

## 故障排除

### 常见问题

#### 1. 依赖安装失败

```bash
# 清除缓存
pnpm store prune

# 删除 node_modules
rm -rf node_modules
rm -rf packages/*/node_modules

# 重新安装
pnpm install
```

#### 2. 测试失败

```bash
# 更新快照
pnpm snapshot

# 运行单个测试
vitest run pattern.test.mjs
```

#### 3. 构建失败

```bash
# 清除构建产物
rm -rf packages/*/dist

# 重新构建
pnpm build
```

#### 4. 端口被占用

```bash
# 查找占用端口的进程
lsof -i :3000

# 杀死进程
kill -9 <PID>
```

### 获取帮助

- **Discord**: [TidalCycles Discord](https://discord.com/invite/HGEdXmRkzT)
- **论坛**: [Tidal Club Forum](https://club.tidalcycles.org/)
- **Issues**: [Codeberg Issues](https://codeberg.org/uzu/strudel/issues)

## 贡献流程

### 提交 Pull Request

1. Fork 仓库
2. 创建分支: `git checkout -b my-feature`
3. 进行更改
4. 运行测试: `pnpm test`
5. 提交更改: `git commit -am 'Add my feature'`
6. 推送分支: `git push origin my-feature`
7. 创建 Pull Request

### PR 检查清单

- [ ] 代码遵循项目风格
- [ ] 所有测试通过
- [ ] 添加了必要的测试
- [ ] 更新了相关文档
- [ ] PR 描述清晰

## 总结

开发 Strudel 需要理解:

1. **Monorepo 结构**: 多包管理
2. **工作流**: 开发、测试、构建、发布
3. **工具链**: pnpm, Vite, Vitest, ESLint, Prettier
4. **最佳实践**: 代码风格、测试、文档

遵循本指南,你可以高效地开发和维护 Strudel 项目。
