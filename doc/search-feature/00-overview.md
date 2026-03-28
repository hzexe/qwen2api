# 00 变更概述

## 背景

`smanx/qwen2api` 是一个将 `chat.qwen.ai` Web 接口包装成 OpenAI 兼容接口的代理服务。其原始实现中，thinking 和 search 功能存在以下问题，导致无法灵活使用。

## 现有实现痛点

### 1. Thinking 硬编码，无法关闭
`core.js` 中 `feature_config.thinking_enabled` 被硬编码为 `true`，所有请求均开启思考模式，用户无法按需关闭，也无法控制思考 budget，导致：
- 简单问答也进入思考模式，响应变慢
- 无法通过请求参数灵活控制
- 不兼容 OpenAI SDK 的 `reasoning_effort` 参数

### 2. Search 只有全局环境变量
`ENABLE_SEARCH` 环境变量一旦设置，所有请求都开启联网搜索，无法 per-request 控制，导致：
- 不需要搜索的对话也走搜索模式，增加延迟和成本
- 无法通过请求参数按需开启
- 不兼容 OpenAI SDK 的 `extra_body` 扩展参数

### 3. 不兼容 OpenAI SDK 标准参数
- `reasoning_effort`（OpenAI o-series 标准）无法使用
- `enable_thinking` / `thinking_budget`（Qwen 官方参数）无法使用
- 使用 OpenAI SDK 的用户必须修改底层配置才能控制这些功能

## 本次变更目标

1. **Thinking per-request 化**：支持通过模型后缀、请求参数、环境变量三层优先级控制 thinking 开关和 budget
2. **Search per-request 化**：支持通过模型后缀和 `extra_body.enable_search` 双入口控制联网搜索
3. **兼容 OpenAI SDK**：支持 `reasoning_effort`、`enable_thinking`、`thinking_budget` 等标准/扩展参数
4. **同时启用多功能**：支持 thinking + search 同时开启（如模型名 `qwen-plus-thinking-search`）

## 不在本次范围内

- 图片生成端点（`/v1/images/generations`）：独立路由，不受影响，不改动
- 视频分析（yt-dlp 流程）：语义与 Rfym21 的 `-video`（文生视频）完全不同，本次跳过
- 文件附件处理逻辑（`normalizeContentParts`、`uploadAttachments`）：不改动
- `-deep-research` 后缀：上游能力不稳定，暂不支持
- 返回格式变更：保持现有 `reasoning_content` 字段，不添加 `<think>` 包裹
