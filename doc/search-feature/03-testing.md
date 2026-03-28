# 03 测试方案

## 一、parseModelSuffix 单元测试

以下用例需在实现后通过 `node -e` 或 Jest 验证，覆盖多后缀并存、顺序无关、幂等性和已知限制场景。

| # | 输入 rawModel | 期望 cleanModel | 期望 thinking | 期望 search | 说明 |
|---|-------------|----------------|-------------|------------|------|
| 1 | `qwen-plus-thinking-search` | `qwen-plus` | true | true | 多后缀并存，thinking 在前 |
| 2 | `qwen-plus-search-thinking` | `qwen-plus` | true | true | 多后缀并存，search 在前 |
| 3 | `qwen-plus-thinking` | `qwen-plus` | true | false | 单后缀 thinking |
| 4 | `qwen-plus-search` | `qwen-plus` | false | true | 单后缀 search |
| 5 | `qwen-plus` | `qwen-plus` | false | false | 无后缀，不触发任何功能 |
| 6 | `qwen-max-search` | `qwen-max` ⚠️ | false | true | **已知限制**：真实模型名误识别 |
| 7 | `qwen-plus-thinking-thinking` | `qwen-plus` | true | false | 重复后缀，幂等性验证 |
| 8 | `qwen-plus-search-search` | `qwen-plus` | false | true | 重复后缀，幂等性验证 |
| 9 | `qwen-plus-search-thinking-search` | `qwen-plus` | true | true | 三个后缀混合 |
| 10 | `-thinking` | `` (空字符串) | true | false | 极端情况：只有后缀无模型名 |
| 11 | `qwen-turbo` | `qwen-turbo` | false | false | 后缀词出现在中间，不触发 |

> ⚠️ 用例 6（`qwen-max-search`）是已知无法完全规避的限制，测试仅用于确认行为文档一致，不作为失败标准。

---

## 二、功能集成 curl 测试

> 前置条件：服务运行在 `http://localhost:3000`，环境变量均未设置（默认值）。
> 替换 `YOUR_API_KEY` 为实际配置的 key。

### 2.1 后缀触发 thinking（-thinking 结尾）

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus-thinking",
    "messages": [{"role": "user", "content": "1+1等于几"}],
    "stream": false
  }' | jq '.choices[0].message | {content, reasoning_content}'
```

**验收**：响应中 `reasoning_content` 不为空，`content` 为最终答案。

---

### 2.2 enable_thinking 参数触发

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus",
    "enable_thinking": true,
    "messages": [{"role": "user", "content": "解释量子纠缠"}],
    "stream": false
  }' | jq '.choices[0].message | {content, reasoning_content}'
```

**验收**：`reasoning_content` 不为空。

---

### 2.3 reasoning_effort: low

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus",
    "reasoning_effort": "low",
    "messages": [{"role": "user", "content": "写一首短诗"}],
    "stream": false
  }' | jq '.choices[0].message | {content, reasoning_content}'
```

**验收**：thinking 开启（budget=2000），`reasoning_content` 不为空且较简短。

---

### 2.4 reasoning_effort: high

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus",
    "reasoning_effort": "high",
    "messages": [{"role": "user", "content": "分析中美贸易战的长期影响"}],
    "stream": false
  }' | jq '.choices[0].message | {content, reasoning_content}'
```

**验收**：thinking 开启（budget=20000），`reasoning_content` 较长。

---

### 2.5 reasoning_effort: none（明确关闭 thinking）

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus",
    "reasoning_effort": "none",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }' | jq '.choices[0].message | {content, reasoning_content}'
```

**验收**：`reasoning_content` 为 null 或不存在。

---

### 2.6 不传任何 thinking 参数（确认默认关闭）

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }' | jq '.choices[0].message | {content, reasoning_content}'
```

**验收**：`reasoning_content` 为 null 或不存在，**不再硬编码开启**。

---

### 2.7 后缀触发 search（-search 结尾）

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus-search",
    "messages": [{"role": "user", "content": "今天北京天气怎么样"}],
    "stream": false
  }' | jq '.choices[0].message.content'
```

**验收**：响应包含实时天气信息（非训练数据中的固定回答）。

---

### 2.8 extra_body.enable_search 触发

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus",
    "extra_body": {"enable_search": true},
    "messages": [{"role": "user", "content": "今天上海天气怎么样"}],
    "stream": false
  }' | jq '.choices[0].message.content'
```

**验收**：响应包含实时天气信息。

---

### 2.9 thinking + search 同时开启（后缀方式）

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus-thinking-search",
    "messages": [{"role": "user", "content": "今天有什么重要新闻，分析一下影响"}],
    "stream": false
  }' | jq '.choices[0].message | {content, reasoning_content}'
```

**验收**：`reasoning_content` 不为空（thinking 开启），且内容引用实时信息（search 开启）。

---

### 2.10 thinking + search 同时开启（参数方式）

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus",
    "enable_thinking": true,
    "extra_body": {"enable_search": true},
    "messages": [{"role": "user", "content": "今天有什么重要新闻，分析一下影响"}],
    "stream": false
  }' | jq '.choices[0].message | {content, reasoning_content}'
```

**验收**：同上。

---

### 2.11 流式请求（thinking + search）

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus-thinking-search",
    "messages": [{"role": "user", "content": "简单介绍一下量子计算"}],
    "stream": true
  }'
```

**验收**：SSE 流正常输出，包含 `reasoning_content` delta 和 `content` delta，无报错。

---

### 2.12 非流式请求

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus-thinking",
    "messages": [{"role": "user", "content": "简单介绍一下量子计算"}],
    "stream": false
  }' | jq .
```

**验收**：完整 JSON 响应，结构符合 OpenAI Chat Completions 格式。

---

### 2.13 带图片附件（确认不影响）

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-vl-plus",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "image_url", "image_url": {"url": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png"}},
        {"type": "text", "text": "这张图片里有什么"}
      ]
    }],
    "stream": false
  }' | jq '.choices[0].message.content'
```

**验收**：正确描述图片内容，附件处理流程不受后缀解析影响。

---

### 2.14 环境变量兜底（ENABLE_THINKING=true）

```bash
ENABLE_THINKING=true node index.js &

curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }' | jq '.choices[0].message | {content, reasoning_content}'
```

**验收**：即使不传任何参数，`reasoning_content` 不为空（环境变量兜底生效）。

---

### 2.15 边缘情况：thinking_budget 直接指定

```bash
curl -s http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus",
    "enable_thinking": true,
    "thinking_budget": 500,
    "messages": [{"role": "user", "content": "分析一个复杂问题"}],
    "stream": false
  }' | jq '.choices[0].message | {content, reasoning_content}'
```

**验收**：thinking 开启，budget=500（较小），`reasoning_content` 较短。
