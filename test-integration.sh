#!/bin/bash
# 功能集成测试脚本
# 使用方法: ./test-integration.sh <API_BASE_URL> <API_KEY>

BASE_URL="${1:-http://localhost:3000}"
API_KEY="${2:-test-key-123}"

echo "=========================================="
echo "功能集成测试"
echo "API Base URL: $BASE_URL"
echo "=========================================="

# 测试 1: 后缀触发 thinking
echo -e "\n[AC-02] 后缀触发 thinking"
curl -s "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus-thinking","messages":[{"role":"user","content":"1+1等于几"}],"stream":false}' | jq '.choices[0].message | has("reasoning_content")'

# 测试 2: 后缀触发 search
echo -e "\n[AC-03] 后缀触发 search"
curl -s "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus-search","messages":[{"role":"user","content":"今天天气"}],"stream":false}' | jq '.choices[0].message.content | length'

# 测试 3: 多后缀并存
echo -e "\n[AC-04] 多后缀并存"
curl -s "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus-thinking-search","messages":[{"role":"user","content":"你好"}],"stream":false}' | jq '.choices[0].message | has("reasoning_content")'

# 测试 4: enable_thinking 参数
echo -e "\n[AC-05] enable_thinking 参数"
curl -s "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus","enable_thinking":true,"messages":[{"role":"user","content":"你好"}],"stream":false}' | jq '.choices[0].message | has("reasoning_content")'

# 测试 5: 无参数，thinking 应关闭
echo -e "\n[AC-01] 无参数，thinking 应关闭"
curl -s "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-plus","messages":[{"role":"user","content":"你好"}],"stream":false}' | jq '.choices[0].message.reasoning_content'

echo -e "\n=========================================="
echo "测试完成"
