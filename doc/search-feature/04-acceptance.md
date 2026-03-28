# 04 验收标准

## 一、验收清单

### 核心功能

- [ ] **[AC-01]** 模型名不带任何后缀时，thinking 默认关闭（不再硬编码 true）
- [ ] **[AC-02]** 模型名以 `-thinking` 结尾时，thinking 开启
- [ ] **[AC-03]** 模型名以 `-search` 结尾时，search 开启
- [ ] **[AC-04]** 模型名同时带 `-thinking` 和 `-search`（任意顺序）时，两者均正确开启
- [ ] **[AC-05]** `enable_thinking: true` 参数可触发 thinking
- [ ] **[AC-06]** `enable_thinking: false` 参数可明确关闭 thinking（即使环境变量为 true）
- [ ] **[AC-07]** `extra_body.enable_search: true` 参数可触发 search
- [ ] **[AC-08]** `reasoning_effort: "low"` 触发 thinking，budget=2000
- [ ] **[AC-09]** `reasoning_effort: "medium"` 触发 thinking，budget=8000
- [ ] **[AC-10]** `reasoning_effort: "high"` 触发 thinking，budget=20000
- [ ] **[AC-11]** `reasoning_effort: "none"` 明确关闭 thinking
- [ ] **[AC-12]** `thinking_budget` 直接指定数字时，优先于 `reasoning_effort` 映射值
- [ ] **[AC-13]** 环境变量 `ENABLE_THINKING=true` 在无请求参数时生效作为兜底
- [ ] **[AC-14]** 环境变量 `ENABLE_SEARCH=true` 在无请求参数时生效作为兜底
- [ ] **[AC-15]** thinking 返回格式为 `reasoning_content` 字段，无 `<tool_call>setHorizontalGroup(...)` 文本包裹

### 兼容性

- [ ] **[AC-16]** 图片生成端点 `/v1/images/generations` 功能不受影响
- [ ] **[AC-17]** 带图片附件的 chat 请求正常处理，附件内容正确传递
- [ ] **[AC-18]** 流式响应（`stream: true`）正常工作，SSE 格式无变化
- [ ] **[AC-19]** 非流式响应（`stream: false`）正常工作，JSON 结构符合 OpenAI 格式
- [ ] **[AC-20]** 多轮对话上下文正常维持，剥离后缀后的 cleanModel 不影响上下文

### parseModelSuffix 单元测试

- [ ] **[AC-21]** `qwen-plus-thinking-search` → cleanModel=`qwen-plus`, thinking=true, search=true
- [ ] **[AC-22]** `qwen-plus-search-thinking` → cleanModel=`qwen-plus`, thinking=true, search=true
- [ ] **[AC-23]** `qwen-plus-thinking` → cleanModel=`qwen-plus`, thinking=true, search=false
- [ ] **[AC-24]** `qwen-plus-search` → cleanModel=`qwen-plus`, thinking=false, search=true
- [ ] **[AC-25]** `qwen-plus` → cleanModel=`qwen-plus`, thinking=false, search=false
- [ ] **[AC-26]** `qwen-plus-thinking-thinking` → cleanModel=`qwen-plus`, thinking=true（幂等）
- [ ] **[AC-27]** `qwen-plus-search-search` → cleanModel=`qwen-plus`, search=true（幂等）

---

## 二、上线前检查项

- [ ] 所有 AC-01 ~ AC-27 均已验证通过
- [ ] `ENABLE_SEARCH` 旧用户迁移说明已更新到 README（行为变化：从全局开变为兜底）
- [ ] 新环境变量 `ENABLE_THINKING`、`THINKING_BUDGET` 已在 README 和 `.env.example` 中说明
- [ ] 已在本地用真实 Qwen Web cookie 做端到端测试（至少覆盖 thinking + search 同时开启）
- [ ] 代码已提交到 `search` 分支并推送到 `origin`
- [ ] commit message 格式规范，引用本文档路径

---

## 三、已知限制

### 真实模型名与后缀冲突

**问题**：阿里云存在以 `-search` 结尾的真实模型名（如 `qwen-max-search`）。迭代剥离会将其误识别为"开启 search + 调用 qwen-max"，导致实际调用了错误的模型。

**当前处理**：文档说明，不做硬拦截。

**用户规避方式**：遇到真实模型名带后缀字符时，改用参数方式控制：
```json
{
  "model": "qwen-max-search",
  "extra_body": { "enable_search": true }
}
```
注意：此时 model 名不会被剥离，直接透传 `qwen-max-search` 给上游（该模型本身可能就支持搜索）。

---

## 四、后续可扩展点

| 扩展点 | 说明 | 优先级 |
|--------|------|--------|
| 真实模型白名单 | 维护一份已知真实模型名列表，命中则跳过后缀剥离 | 低 |
| thinking 档位后缀 | 支持 `-thinking-low`、`-thinking-high` 直接控制 budget 档位 | 低 |
| `/models` 接口虚拟模型 | 在模型列表中暴露 `-thinking`、`-search` 等虚拟模型名，方便客户端选择 | 中 |
| `-deep-research` 后缀 | 待上游能力稳定后支持 | 低 |
| tools 协议支持 search | 通过 `tools: [{type: "web_search"}]` 触发搜索（OpenAI Responses 风格） | 中 |
