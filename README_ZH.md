# Qwen2API

中文 | [English](README.md)

将 Qwen Chat 转换为 OpenAI 兼容的 API 代理服务。

## 功能特性

- 🔄 OpenAI API 兼容格式
- 🚀 支持流式响应 (SSE)
- 🔐 可选的 API Token 认证
- 🌐 多平台部署支持
- 🖼️ 支持图片生成
- 🎬📄 支持视频解析、图片与文档解析
- 💬 内置 Web 聊天界面

## 部署方式

### Docker

```bash
# 构建镜像
docker build -t qwen2api .

# 运行容器
docker run -d -p 8765:8765 -e API_TOKENS=your_token qwen2api
```

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/smanx/qwen2api)

1. Fork 本仓库
2. 在 Vercel 中导入项目
3. 可选：设置环境变量 `API_TOKENS`

### Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/smanx/qwen2api)

1. Fork 本仓库
2. 在 Netlify 中导入项目
3. 可选：设置环境变量 `API_TOKENS`

### Cloudflare Workers

```bash
# 安装 wrangler
npm install -g wrangler

# 登录
wrangler login

# 部署
wrangler deploy
```

在 Cloudflare Dashboard 中设置环境变量 `API_TOKENS`。

## 公共服务

提供两个公共服务供测试使用：

| 服务地址 | 平台 |
|----------|------|
| `https://qwen2api-n.smanx.xx.kg` | Netlify |
| ~~`https://qwen2api-v.smanx.xx.kg`~~ | ~~Vercel~~ （使用超额已停机） |

- 无需 API Token（密钥为空）
- 建议自行部署以获得更稳定的服务

## 注意事项

- ✅ `/v1/chat/completions` 已支持附件与多模态消息（图片/文件/音频）。
- ✅ 支持图片理解与文档解析流程（可在对话中直接使用）。
- ⚠️ 附件会按 Qwen Web 的流程先上传到 Qwen OSS，文件较大时请求耗时会增加。
- ❌ **不支持工具调用** - 项目未实现 OpenAI 风格的工具/函数调用功能。

### 限制说明（视频链接 / 大文件）

- 通过视频链接分析、以及上传大文件进行分析：**不支持无服务器函数部署**（例如 Vercel / Netlify Functions / Cloudflare Workers）。
  这类环境通常会受限于运行时长、请求体大小、以及文件系统/子进程能力。
- 视频链接分析还需要宿主机安装 `yt-dlp` 工具。
  如需使用该能力，请选择 Docker / 本地 Express 部署。

### 附件兼容格式（OpenAI 风格）

`messages[].content` 支持以下分段格式：

- `{"type":"text","text":"..."}` / `{"type":"input_text","input_text":"..."}`
- `{"type":"image_url","image_url":{"url":"https://..."}}`
- `{"type":"input_image","image_url":"https://..."}`
- `{"type":"file","file_data":"data:...base64,...","filename":"a.pdf"}`
- `{"type":"input_file","file_data":"<base64>","filename":"a.txt"}`
- `{"type":"audio","file_data":"https://..."}` / `{"type":"input_audio", ...}`

另外也兼容消息级 `files` / `attachments` 传参。

## 模型名后缀控制

从 `search` 分支起，支持通过模型名后缀控制 thinking 和 search 功能：

| 后缀 | 功能 | 示例 |
|------|------|------|
| `-thinking` | 开启思考模式 | `qwen-plus-thinking` |
| `-search` | 开启联网搜索 | `qwen-plus-search` |
| 可叠加 | 同时开启多个功能 | `qwen-plus-thinking-search` |

**后缀解析规则**：
- 后缀可叠加，顺序无关（`-thinking-search` 和 `-search-thinking` 效果相同）
- 后缀会被自动剥离，实际上游模型名为纯净模型名

**已知限制**：
- 阿里云存在真实模型名如 `qwen-max-search`，会被误识别为"开启搜索"
- 遇到此类模型名时，建议改用参数方式控制（见下文）

## 请求参数

### Thinking 控制

| 参数 | 类型 | 说明 |
|------|------|------|
| `enable_thinking` | boolean | Qwen 官方参数，是否开启思考模式 |
| `thinking_budget` | number | 思考 token 预算（如 2000、8000、20000） |
| `reasoning_effort` | string | OpenAI 风格参数，可选值：`low` / `medium` / `high` / `none` |

**reasoning_effort 映射**：
- `low` → thinking_budget=2000
- `medium` → thinking_budget=8000
- `high` → thinking_budget=20000
- `none` → 关闭思考

**优先级链**（从高到低）：
1. 模型名后缀 `-thinking`
2. `enable_thinking` 参数
3. `reasoning_effort` 参数
4. 环境变量 `ENABLE_THINKING`（兜底）

### Search 控制

| 参数 | 类型 | 说明 |
|------|------|------|
| `extra_body.enable_search` | boolean | 是否开启联网搜索 |

**优先级链**（从高到低）：
1. 模型名后缀 `-search`
2. `extra_body.enable_search` 参数
3. 环境变量 `ENABLE_SEARCH`（兜底）

### 示例

```bash
# 后缀控制 thinking
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus-thinking","messages":[{"role":"user","content":"1+1等于几"}]}'

# 参数控制 thinking
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus","enable_thinking":true,"messages":[{"role":"user","content":"解释量子纠缠"}]}'

# OpenAI 风格 reasoning_effort
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus","reasoning_effort":"high","messages":[{"role":"user","content":"分析中美贸易战"}]}'

# 后缀控制 search
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus-search","messages":[{"role":"user","content":"今天北京天气"}]}'

# 参数控制 search
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus","extra_body":{"enable_search":true},"messages":[{"role":"user","content":"今天新闻"}]}'

# 同时开启 thinking + search
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus-thinking-search","messages":[{"role":"user","content":"今天有什么重要新闻，分析一下"}]}'
```

## 环境变量

| 变量名 | 说明 | 必填 |
|--------|------|------|
| `API_TOKENS` | API 密钥，多个用逗号分隔 | 否 |
| `ENABLE_THINKING` | 全局 thinking 开关（`true` 开启，默认关闭），会被请求参数覆盖 | 否 |
| `THINKING_BUDGET` | 全局 thinking token 预算（会被请求参数覆盖） | 否 |
| `ENABLE_SEARCH` | 全局 search 开关（`true` 开启，默认关闭），会被请求参数覆盖 | 否 |
| `CHAT_DETAIL_LOG` | 是否开启详细对话/上传日志（`true/1/on/yes` 开启，默认关闭） | 否 |
| `JSON_BODY_LIMIT` | Express JSON 请求体大小上限（默认 `20mb`，仅本地/Docker 的 Express 运行时生效） | 否 |

> **安全提示（API_TOKENS）：** 如果未配置 `API_TOKENS`，服务将允许无鉴权访问所有接口（`/v1/models`、`/v1/chat/completions` 等）。公网部署时强烈建议设置至少一个 token，并通过 `Authorization: Bearer <token>` 访问。

## 已知限制

1. **真实模型名冲突**：阿里云存在如 `qwen-max-search` 这样的真实模型名，后缀解析会将其误识别为"开启搜索"。遇到此类情况，建议：
   - 使用 `extra_body.enable_search` 参数控制
   - 或在请求中明确设置 `enable_thinking: false`

2. **Tool calling 不支持**：项目未实现 OpenAI 风格的工具/函数调用功能。

3. **视频链接分析限制**：不支持无服务器函数部署（Vercel / Netlify Functions / Cloudflare Workers）。

## 使用方法

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/v1/models` | GET | 获取模型列表 |
| `/v1/chat/completions` | POST | 聊天完成 |
| `/v1/images/generations` | POST | 图片生成 |
| `/chat` | GET | 内置 Web 聊天页面 |
| `/` | GET | 健康检查 |

### Web 聊天页面

在浏览器打开 `https://your-domain/chat` 即可使用内置聊天 UI。

- 支持流式输出、附件上传、可选视频链接（填写链接后发送会自动进入视频分析；留空为普通对话）
- 可切换日志面板；开启后请求会使用 `/v1/chat/completions/log`
- 顶部栏提供中英文切换

### 请求示例

```bash
# 获取模型列表
curl https://your-domain/v1/models \
  -H "Authorization: Bearer your_token"

# 聊天完成
curl https://your-domain/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "model": "qwen3.5-plus",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# 图片生成（比例字符串格式）
curl https://your-domain/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "model": "qwen3.5-plus",
    "prompt": "一只可爱的小猫在花园里",
    "n": 1,
    "size": "1:1",
    "response_format": "url"
  }'

# 图片生成（OpenAI 尺寸格式）
curl https://your-domain/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "model": "qwen3.5-plus",
    "prompt": "一片壮丽的山水风景",
    "n": 1,
    "size": "1024x1024",
    "response_format": "b64_json"
  }'
```

### 图片生成参数说明

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 否 | 模型名称，默认为 `qwen3.5-plus` |
| `prompt` | string | 是 | 图片描述文本 |
| `n` | number | 否 | 生成图片数量，默认为 1，最大 10 |
| `size` | string | 否 | 图片尺寸/比例，默认为 `1:1` |
| `response_format` | string | 否 | 响应格式：`url`（默认）或 `b64_json` |

#### size 参数支持的格式

**格式 1：比例字符串（推荐）**
- `1:1` - 正方形
- `16:9` - 宽屏（横向）
- `9:16` - 竖屏（纵向）
- `4:3` - 传统比例（横向）
- `3:4` - 传统比例（纵向）

**格式 2：OpenAI 兼容的尺寸格式**
- `1024x1024` - 会自动映射到最接近的比例（1:1）
- `1920x1080` - 会自动映射到最接近的比例（16:9）
- 其他任何宽高组合都会自动映射到支持的比例

#### 响应格式

**url 格式（默认）：**
```json
{
  "created": 1234567890,
  "data": [
    {
      "url": "https://example.com/image.png"
    }
  ]
}
```

**b64_json 格式：**
```json
{
  "created": 1234567890,
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ..."
    }
  ]
}
```

### OpenAI SDK 示例

```python
from openai import OpenAI

client = OpenAI(
    api_key="your_token",
    base_url="https://your-domain/v1"
)

response = client.chat.completions.create(
    model="qwen3.5-plus",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)

for chunk in response:
    print(chunk.choices[0].delta.content, end="")
```

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'your_token',
  baseURL: 'https://your-domain/v1'
});

const stream = await client.chat.completions.create({
  model: 'qwen3.5-plus',
  messages: [{ role: 'user', content: 'Hello!' }],
  stream: true
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content || '');
}
```

## 支持的模型

- `qwen3.5-plus`
- `qwen3.5-flash`
- `qwen3.5-turbo`
- 以及 Qwen Chat 支持的其他模型

## 项目结构

```
qwen2api/
├── core.js              # 核心业务逻辑
├── index.js             # Docker / 本地入口
├── api/
│   └── index.js         # Vercel 入口
├── netlify/
│   └── functions/
│       └── api.js       # Netlify 入口
├── worker.js            # Cloudflare Workers 入口
├── Dockerfile
├── vercel.json
├── netlify.toml
└── wrangler.toml
```

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 服务运行在 http://localhost:8765
```

## 免责声明

本项目仅供学习和测试使用，请勿用于生产环境或商业用途。使用本项目所产生的一切后果由使用者自行承担，与项目作者无关。

## License

MIT
