# 02 模块改动计划

## 模块 1：新增 `parseModelSuffix(rawModel)` 函数

### 现状
无任何后缀解析，model 直接透传上游。

### 改动目标
新增纯函数 `parseModelSuffix`，迭代剥离所有已知后缀，返回干净模型名和功能 flag。

### 伪代码

```javascript
function parseModelSuffix(rawModel) {
  const flags = { enableThinking: false, enableSearch: false };
  const SUFFIX_MAP = {
    '-thinking': () => { flags.enableThinking = true; },
    '-search':   () => { flags.enableSearch = true; },
  };

  let model = rawModel;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [suffix, setter] of Object.entries(SUFFIX_MAP)) {
      if (model.endsWith(suffix)) {
        setter();
        model = model.slice(0, -suffix.length);
        changed = true;
        break; // 每次只剥一个，重新从头扫
      }
    }
  }

  return { cleanModel: model, ...flags };
}
```

### 放置位置
`core.js` 顶部工具函数区，`handleChatCompletions` 之前。

---

## 模块 2：Thinking 控制改造

### 现状
```javascript
// 硬编码
feature_config: {
  thinking_enabled: true,
  output_schema: 'phase',
}
```

### 改动目标
实现完整优先级链，返回 `{ thinkingEnabled, thinkingBudget }`。

### 伪代码

```javascript
function resolveThinking(body, suffixFlags) {
  // budget 优先级
  let budget = undefined;
  if (body.thinking_budget != null) {
    budget = body.thinking_budget;
  } else if (body.reasoning_effort) {
    const budgetMap = { low: 2000, medium: 8000, high: 20000 };
    budget = budgetMap[body.reasoning_effort];
  } else if (process.env.THINKING_BUDGET) {
    budget = parseInt(process.env.THINKING_BUDGET);
  }

  // enabled 优先级
  let enabled;
  if (suffixFlags.enableThinking) {
    // 1. model 后缀 -thinking
    enabled = true;
  } else if (body.enable_thinking != null) {
    // 2. Qwen 官方参数
    enabled = !!body.enable_thinking;
  } else if (body.reasoning_effort != null) {
    // 3. OpenAI reasoning_effort
    enabled = body.reasoning_effort !== 'none';
  } else {
    // 4. 环境变量兜底
    enabled = process.env.ENABLE_THINKING === 'true';
  }

  return { thinkingEnabled: enabled, thinkingBudget: budget };
}
```

### 调用位置
`handleChatCompletions` 内，构造上游请求体前调用。

---

## 模块 3：Search 控制改造

### 现状
```javascript
const enableSearch = process.env.ENABLE_SEARCH === 'true';
const chatType = enableSearch ? 'search' : 't2t';
```

### 改动目标
双入口控制，per-request 优先于全局。

### 伪代码

```javascript
function resolveSearch(body, suffixFlags) {
  // 入口 1：model 后缀
  if (suffixFlags.enableSearch) return true;
  // 入口 2：extra_body.enable_search
  if (body.extra_body?.enable_search === true) return true;
  // 兜底：全局环境变量
  if (process.env.ENABLE_SEARCH === 'true') return true;
  return false;
}
```

---

## 模块 4：上游请求 `feature_config` 组装

### 改动目标
根据 `resolveThinking` 结果动态组装，不再硬编码。

### 伪代码

```javascript
const { thinkingEnabled, thinkingBudget } = resolveThinking(body, suffixFlags);
const enableSearch = resolveSearch(body, suffixFlags);

const requestBody = {
  model: cleanModel,          // parseModelSuffix 剥离后的干净名称
  messages: normalizedMessages,
  stream: true,
  chat_type: enableSearch ? 'search' : 't2t',
  feature_config: {
    thinking_enabled: thinkingEnabled,
    output_schema: 'phase',
    ...(thinkingBudget != null ? { thinking_budget: thinkingBudget } : {}),
  },
};
```

---

## 模块 5：返回处理确认

### 现状
smanx 已将 thinking 内容映射到 `reasoning_content` 字段（OpenAI 风格）。

### 改动目标
**不改动**，保持 `reasoning_content` 返回方式。  
确认不引入 `<think>...</think>` 文本包裹（Rfym21 风格），保持 OpenAI SDK 兼容。

---

## 模块 6：环境变量清单

| 变量名 | 状态 | 默认值 | 说明 |
|--------|------|--------|------|
| `ENABLE_SEARCH` | **保留，降级为兜底** | `false` | 全局 search 开关，现在优先级低于 per-request 控制 |
| `ENABLE_THINKING` | **新增** | `false` | 全局 thinking 兜底开关 |
| `THINKING_BUDGET` | **新增** | 无（不设上限） | 全局 thinking budget 兜底 |

---

## 模块 7：README 更新要点

1. 新增「模型名后缀控制」章节，说明：
   - `-thinking`：开启思考模式
   - `-search`：开启联网搜索
   - 可叠加：`qwen-plus-thinking-search`
2. 新增「请求参数」章节，列出支持的参数：
   - `enable_thinking`
   - `thinking_budget`
   - `reasoning_effort`（low/medium/high/none）
   - `extra_body.enable_search`
3. 新增「环境变量」章节，更新变量说明
4. 新增「已知限制」章节，说明真实模型名与后缀冲突问题
