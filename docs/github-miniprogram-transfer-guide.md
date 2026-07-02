# 小程序版本上传 GitHub 与换电脑调试教程

这份文档用于把当前房屋租赁管理小程序版本上传到 GitHub，并在另一台电脑拉取后继续调试。

## 1. 先理解 Git 的三个区域

Git 日常操作可以理解成三层：

- 工作区：你本地正在编辑的真实文件。
- 暂存区：准备放进下一次提交的文件清单。
- 本地提交：一次快照，记录一组已经确认的改动。

常用命令：

```bash
git status
git add 文件或目录
git commit -m "提交说明"
git push origin 分支名
```

## 2. 先做安全检查

不要把本机路径、密钥、Token、调试缓存传到 GitHub。

本项目里这些不应该提交：

```text
.env
mcp.json
project.private.config.json
node_modules/
dist/
.cloudbase/
cli-agent-run/
screenshots/
miniprogram_backup_v1/
skills/
```

其中：

- `mcp.json` 是本机 AI/MCP 调试配置，包含微信开发者工具路径。
- `project.private.config.json` 是微信开发者工具生成的本机私有配置。
- 根目录 `/skills/` 是开发副本；小程序真正运行的是 `miniprogram/skills/`。

如果 `mcp.json` 或 `project.private.config.json` 已经被 Git 跟踪，需要手动停止跟踪，但保留本地文件：

```bash
git rm --cached mcp.json
git rm --cached project.private.config.json
```

## 3. 建议本次提交包含哪些内容

小程序换电脑调试必须包含：

```text
project.config.json
cloudbaserc.json
package.json
package-lock.json
miniprogram/
cloudfunctions/
config/
scripts/
docs/
.gitignore
.env.example
```

核心原因：

- `project.config.json` 告诉微信开发者工具小程序根目录和云函数目录。
- `miniprogram/` 是小程序前端、页面、Skill 卡片。
- `cloudfunctions/` 是云函数源码。
- `cloudbaserc.json` 记录 CloudBase 环境 ID。
- `package-lock.json` 锁定依赖版本，保证另一台电脑安装结果一致。

## 4. 推荐的手动提交流程

先看当前状态：

```bash
git status
```

如果远程地址里带了 GitHub Token，先改成普通地址：

```bash
git remote set-url origin https://github.com/xzmates/housing-rent-management.git
```

然后只暂存本次小程序版本需要的内容：

```bash
git add .gitignore
git add project.config.json cloudbaserc.json package.json package-lock.json
git add miniprogram cloudfunctions config scripts docs .env.example
```

检查暂存区：

```bash
git diff --cached --name-only
```

确认没有 `mcp.json`、`.env`、`project.private.config.json`、`screenshots/` 后，再提交：

```bash
git commit -m "Add mini program AI rental assistant version"
```

查看当前分支：

```bash
git branch --show-current
```

推送到 GitHub：

```bash
git push origin 当前分支名
```

例如当前分支是 `main`：

```bash
git push origin main
```

## 5. 另一台电脑如何拉取调试

安装准备：

- Git
- Node.js
- 微信开发者工具 AI 版本
- 有权限的微信开发者账号

拉取代码：

```bash
git clone https://github.com/xzmates/housing-rent-management.git
cd housing-rent-management
npm install
```

用微信开发者工具打开项目根目录，也就是包含 `project.config.json` 的目录。

打开后检查：

- AppID 是否为 `wxb4ede9db2f43070d`
- 云环境是否为 `cloud1-2gxr9nlc327f3b44`
- `miniprogram/skills/` 是否存在
- `cloudfunctions/executeVoiceScenario` 是否存在

如果云函数未部署，需要在微信开发者工具中重新上传并部署云函数。

## 6. 常见问题

### 为什么 `.gitignore` 之后文件还显示修改？

因为 `.gitignore` 只影响未跟踪文件。如果文件以前已经进过 Git，需要用：

```bash
git rm --cached 文件名
```

### 为什么不要 `git add .`？

当前项目里有调试截图、备份目录、本机配置。`git add .` 容易把不该上传的东西混进去。第一次整理建议用路径逐个 `git add`。

### 本地 commit 很乱怎么办？

先不要急着整理历史。最稳妥的做法是：

1. 创建一个新分支。
2. 只提交这次小程序迁移需要的文件。
3. 推送新分支到 GitHub。
4. 确认另一台电脑能拉取调试后，再决定是否合并到主分支。

创建新分支：

```bash
git switch -c mini-program-ai-skill-version
```
