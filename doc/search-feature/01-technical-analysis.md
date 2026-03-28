# 01 技术分析

## 一、现有实现分析（smanx/qwen2api）

### 1.1 Thinking 当前实现

**代码位置**：`core.js` ~L698

```javascript
feature_config: {
  thinking_enabled: true,
  output_schema: 'phase',
  research_mode: 'normal',
  auto_thinking: true,
  thinking_format: 'summary',
  auto_search: enableSearch,
}
```

**问题**：
- `thinking_enabled` 硬编码为 `true`，无法关闭
- 无 `thinking_budget` 控制
- 不读取任何请求参数

### 1.2 Search 当前实现

**代码位置**：`core.js` ~L680

```javascript
const enableSearch = process.env.ENABLE_SEARCH === 'true';
const chatType = enableSearch ? 'search' : 't2t';
```

**问题**：
- 只看全局环境变量，无 per-request 控制
- 不支持 `extra_body.enable_search` 参数

### 1.3 Model 处理

**代码位置**：`core.js` ~L650

```javascript
const actualModel = model || 'qwen3.5-plus';
```

**特点**：
- 直接透传给上游
- 无任何后缀解析逻辑

---

## 二、与 Rfym21/Qwen2API 对比

### 2.1 后缀路由机制

| 项目 | 后缀解析方式 | 多后缀支持 |
|------|------------|----------|
| Rfym21 | `endsWith` 单次检测 + `replace` | ❌ 不支持 |
| 本次改造 | 迭代剥离循环 | ✅ 支持 |

**Rfym21 的问题**：
```javascript
// Rfym21 实现
model = model.replace('-search', '');
model = model.replace('-thinking', '');
```
- 只能识别固定顺序
- `qwen-plus-thinking-search` 会失败

**本次改造方案**：
```javascript
// 迭代剥离
while (changed) {
  changed = false;
  for (const [suffix, setter] of Object.entries(SUFFIX_MAP)) {
    if (model.endsWith(suffix)) {
      setter();
      model = model.slice(0, -suffix.length);
      changed = true;
      break;
    }
  }
}
```
- 无顺序依赖
- 支持任意数量后缀

### 2.2 Thinking 返回格式

| 项目 | 返回方式 | 优点 | 缺点 |
|------|---------|------|------|
| smanx | `reasoning_content` 字段 | OpenAI SDK 兼容 | 无前端展示友好性 |
| Rfym21 | `.setHorizontalGroup(...)` 文本包裹 | 前端可直接展示 | 非 OpenAI 标准 |

**本次决策**：保持 smanx 的 `reasoning_content` 方式。

---

## 三、本次改造技术原则

### 3.1 迭代剥离

解决多后缀并存问题：
- 每轮扫描所有已知后缀
- 命中一个就剥离并记录 flag
- 重新开始直到无命中

### 3.2 优先级链（Thinking）

```
1. model 后缀 -thinking（per-request，最高优先级）
2. body.enable_thinking（Qwen 官方参数）
3. body.reasoning_effort（OpenAI 原生参数）
4. 环境变量 ENABLE_THINKING（全局兜底）
```

### 3.3 双入口（Search）

```
入口 1：迭代剥离识别到 -search 后缀
入口 2：body.extra_body.enable_search === true
```

### 3.4 reasoning_effort 映射

| reasoning_effort | enable_thinking | thinking_budget |
|-----------------|----------------|-----------------|
| `"low"` | true | 2000 |
| `"medium"` | true | 8000 |
| `"high"` | true | 20000 |
| `"none"` | false | - |

---

## 四、已知限制

### 真实模型名与后缀冲突

阿里云存在 `qwen-max-search` 这样的真实模型名，以 `-search` 结尾。

**问题**：
- 迭代剥离会将其识别为"开启 search + 调用 qwen-max"
- 实际调用了错误的模型

**无法完全规避的原因**：
1. 无法预知阿里云未来发布的模型名
2. 维护白名单有成本且易过期
3. `endsWith` 方式本身无法区分"后缀"和"模型名一部分"

**当前处理**：
- 文档明确说明此限制
- 建议用户遇到真实模型名带后缀时，改用参数方式

---

## 五、兼容性评估

| 现有功能 | 是否受影响 | 说明 |
|---------|-----------|------|
| 图片生成 `/v1/images/generations` | ❌ 否 | 独立端点，不经过模型解析 |
| 视频分析（yt-dlp） | ❌ 否 | 走 `body.video_url`，不依赖 model 名 |
| 文件附件 | ❌ 否 | 走 `messages[].content[].type` |
| 多轮对话 | ❌ 否 | cleanModel 干净，不影响上下文 |
| 流式响应 | ❌ 否 | 后缀解析在请求构造前完成 |
| 环境变量 `ENABLE_SEARCH` | ⚠️ 变化 | 降级为兜底，优先级降低 |
