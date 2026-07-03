---
name: project-status
description: 查看项目当前状态和未完成的变更
allowed-tools: Bash(git *)
---

# 项目状态

## 动态上下文

- 当前分支：!`git branch --show-current`
- 未提交变更：!`git status --short`
- 最近提交：!`git log --oneline -5`

## 任务

基于以上信息，用简洁的格式总结项目当前状态。包含：
1. 当前在哪个分支
2. 有没有未提交的变更
3. 最近在做什么
