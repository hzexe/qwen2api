---
title: Qwen2API
emoji: 🚀
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
---

# Qwen2API

[中文文档](README_ZH.md) | English

A proxy service that converts Qwen Chat to an OpenAI-compatible API.

## Features

- 🔄 OpenAI API compatible format
- 🚀 Streaming response support (SSE)
- 🔐 Optional API Token authentication
- 🌐 Multi-platform deployment support
- 🖼️ Image generation support
- 🎬📄 Video analysis, image and document parsing support
- 💬 Built-in web chat interface

## Deployment

### Docker

```bash
# Build image
docker build -t qwen2api .

# Run container
docker run -d -p 8765:8765 -e API_TOKENS=your_token qwen2api
```

### Hugging Face Spaces (Docker)

1. Create a new **Docker** Space on Hugging Face.
2. Push this repository to the Space.
3. Optional: set `API_TOKENS` in Space Variables/Secrets.
4. The app listens on port `7860` in container mode (already configured in `Dockerfile`).

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/smanx/qwen2api)

1. Fork this repository
2. Import the project in Vercel
3. Optional: Set environment variable `API_TOKENS`

### Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/smanx/qwen2api)

1. Fork this repository
2. Import the project in Netlify
3. Optional: Set environment variable `API_TOKENS`

### Cloudflare Workers

```bash
# Install wrangler
npm install -g wrangler

# Login
wrangler login

# Deploy
wrangler deploy
```

Set the environment variable `API_TOKENS` in the Cloudflare Dashboard.

## Public Services

Two public services are available for testing:

| Service URL | Platform |
|-------------|----------|
| `https://qwen2api-n.smanx.xx.kg` | Netlify |
| ~~`https://qwen2api-v.smanx.xx.kg`~~ | ~~Vercel~~ (Usage limit exceeded, service stopped) |

- No API Token required (leave key empty)
- Self-deployment is recommended for more stable service

## Important Notes

- ✅ The `/v1/chat/completions` endpoint now supports attachments and multimodal message parts, including image/file/audio inputs.
- ✅ Supports image understanding and document parsing workflows in chat requests.
- ⚠️ Attachments are uploaded to Qwen OSS through the same workflow used by Qwen Web, so request latency increases when sending large files.
- ❌ **Tool calling is not supported** - The project does not implement OpenAI-style tool/function calling capabilities.

### Limitations (Video URL / Large Files)

- Video URL analysis and large-file analysis are **not supported on serverless function deployments** (e.g. Vercel / Netlify Functions / Cloudflare Workers).
  These environments typically have strict limits on runtime, request body size, and filesystem/process access.
- Video URL analysis requires `yt-dlp` to be installed on the host machine.
  Use the Docker/local Express deployment if you need this feature.

### Attachment Compatibility (OpenAI-style)

You can use these message content part formats in `messages[].content` arrays:

- `{"type":"text","text":"..."}` / `{"type":"input_text","input_text":"..."}`
- `{"type":"image_url","image_url":{"url":"https://..."}}`
- `{"type":"input_image","image_url":"https://..."}`
- `{"type":"file","file_data":"data:...base64,...","filename":"a.pdf"}`
- `{"type":"input_file","file_data":"<base64>","filename":"a.txt"}`
- `{"type":"audio","file_data":"https://..."}` / `{"type":"input_audio", ...}`

The proxy also accepts legacy message-level `files` / `attachments` arrays for compatibility.

## Model Name Suffix Control

Starting from the `search` branch, you can control thinking and search features via model name suffixes:

| Suffix | Feature | Example |
|--------|---------|---------|
| `-thinking` | Enable thinking mode | `qwen-plus-thinking` |
| `-search` | Enable web search | `qwen-plus-search` |
| Stackable | Combine multiple features | `qwen-plus-thinking-search` |

**Parsing rules**:
- Suffixes are stackable and order-independent (`-thinking-search` equals `-search-thinking`)
- Suffixes are automatically stripped, upstream model name is clean

**Known limitation**:
- Real model names like `qwen-max-search` may be misidentified as "enable search"
- Use parameter-based control for such models (see below)

## Request Parameters

### Thinking Control

| Parameter | Type | Description |
|-----------|------|-------------|
| `enable_thinking` | boolean | Qwen official parameter to enable/disable thinking |
| `thinking_budget` | number | Thinking token budget (e.g., 2000, 8000, 20000) |
| `reasoning_effort` | string | OpenAI-style parameter: `low` / `medium` / `high` / `none` |

**reasoning_effort mapping**:
- `low` → thinking_budget=2000
- `medium` → thinking_budget=8000
- `high` → thinking_budget=20000
- `none` → disable thinking

**Priority chain** (high to low):
1. Model name suffix `-thinking`
2. `enable_thinking` parameter
3. `reasoning_effort` parameter
4. Environment variable `ENABLE_THINKING` (fallback)

### Search Control

| Parameter | Type | Description |
|-----------|------|-------------|
| `extra_body.enable_search` | boolean | Enable web search |

**Priority chain** (high to low):
1. Model name suffix `-search`
2. `extra_body.enable_search` parameter
3. Environment variable `ENABLE_SEARCH` (fallback)

### Examples

```bash
# Suffix control thinking
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus-thinking","messages":[{"role":"user","content":"What is 1+1?"}]}'

# Parameter control thinking
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus","enable_thinking":true,"messages":[{"role":"user","content":"Explain quantum entanglement"}]}'

# OpenAI-style reasoning_effort
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus","reasoning_effort":"high","messages":[{"role":"user","content":"Analyze trade war"}]}'

# Suffix control search
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus-search","messages":[{"role":"user","content":"Today weather in Beijing"}]}'

# Parameter control search
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus","extra_body":{"enable_search":true},"messages":[{"role":"user","content":"Today news"}]}'

# Enable both thinking + search
curl https://your-domain/v1/chat/completions \
  -H "Authorization: Bearer your_token" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus-thinking-search","messages":[{"role":"user","content":"Analyze today major news"}]}'
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `API_TOKENS` | API keys, multiple keys separated by commas | No |
| `ENABLE_THINKING` | Global thinking switch (`true` to enable, default off), overridden by request params | No |
| `THINKING_BUDGET` | Global thinking token budget, overridden by request params | No |
| `ENABLE_SEARCH` | Global search switch (`true` to enable, default off), overridden by request params | No |
| `CHAT_DETAIL_LOG` | Enable detailed chat/upload logs (`true/1/on/yes` to enable, default off) | No |
| `JSON_BODY_LIMIT` | Express JSON body size limit (default `20mb`, only for local/Docker Express runtime) | No |

> **Note:** Web search is now controlled per-request via suffix or `extra_body.enable_search`. The `ENABLE_SEARCH` variable acts as a fallback default.

> **Security Note (API_TOKENS):** If `API_TOKENS` is not configured, the service allows unauthenticated access to all endpoints (`/v1/models`, `/v1/chat/completions`, etc.). For public deployments, it's strongly recommended to set at least one token and access via `Authorization: Bearer <token>`.

## Known Limitations

1. **Real model name conflict**: Real model names like `qwen-max-search` may be misidentified as "enable search". Workaround:
   - Use `extra_body.enable_search` parameter for control
   - Or explicitly set `enable_thinking: false` in requests

2. **Tool calling not supported**: The project does not implement OpenAI-style tool/function calling.

3. **Video URL analysis limitations**: Not supported on serverless deployments (Vercel / Netlify Functions / Cloudflare Workers).

## Usage

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/models` | GET | Get model list |
| `/v1/chat/completions` | POST | Chat completion |
| `/v1/images/generations` | POST | Image generation |
| `/chat` | GET | Built-in web chat UI |
| `/` | GET | Health check |

### Web Chat UI

Open `https://your-domain/chat` in a browser to use the built-in chat page.

- Supports streaming output, attachments, and an optional video URL (auto switches to video analysis when a URL is provided)
- Logs panel can be toggled on/off; when enabled the request uses `/v1/chat/completions/log`
- Language toggle (ZH/EN) is available in the top bar

### Request Examples

```bash
# Get model list
curl https://your-domain/v1/models \
  -H "Authorization: Bearer your_token"

# Chat completion
curl https://your-domain/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "model": "qwen3.5-plus",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'

# Image generation (ratio string format)
curl https://your-domain/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "model": "qwen3.5-plus",
    "prompt": "A cute kitten in a garden",
    "n": 1,
    "size": "1:1",
    "response_format": "url"
  }'

# Image generation (OpenAI size format)
curl https://your-domain/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "model": "qwen3.5-plus",
    "prompt": "A beautiful landscape",
    "n": 1,
    "size": "1024x1024",
    "response_format": "b64_json"
  }'
```

### Image Generation Parameter Reference

#### Request Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | string | No | Model name, default: `qwen3.5-plus` |
| `prompt` | string | Yes | Image description text |
| `n` | number | No | Number of images to generate, default: 1, max: 10 |
| `size` | string | No | Image size/ratio, default: `1:1` |
| `response_format` | string | No | Response format: `url` (default) or `b64_json` |

#### Supported size parameter formats

**Format 1: Ratio string (recommended)**
- `1:1` - Square
- `16:9` - Widescreen (landscape)
- `9:16` - Portrait (vertical)
- `4:3` - Traditional ratio (landscape)
- `3:4` - Traditional ratio (portrait)

**Format 2: OpenAI compatible size format**
- `1024x1024` - Automatically maps to closest ratio (1:1)
- `1920x1080` - Automatically maps to closest ratio (16:9)
- Any other width/height combination will automatically map to a supported ratio

#### Response Formats

**url format (default):**
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

**b64_json format:**
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

### OpenAI SDK Examples

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

## Supported Models

- `qwen3.5-plus`
- `qwen3.5-flash`
- `qwen3.5-turbo`
- And other models supported by Qwen Chat

## Project Structure

```
qwen2api/
├── core.js              # Core business logic
├── index.js             # Docker / Local entry point
├── api/
│   └── index.js         # Vercel entry point
├── netlify/
│   └── functions/
│       └── api.js       # Netlify entry point
├── worker.js            # Cloudflare Workers entry point
├── Dockerfile
├── vercel.json
├── netlify.toml
└── wrangler.toml
```

## Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Server runs at http://localhost:8765
```

## Disclaimer

This project is for learning and testing purposes only. Do not use it in production or commercial environments. Users are solely responsible for any consequences arising from the use of this project, and the project author assumes no liability.

## License

MIT
