#!/usr/bin/env node
/**
 * resolveThinking 和 resolveSearch 单元测试
 */

// 从 core.js 提取函数
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
        break;
      }
    }
  }
  return { cleanModel: model, ...flags };
}

function resolveThinking(body, suffixFlags, env) {
  let budget = undefined;
  if (body.thinking_budget != null) {
    budget = parseInt(body.thinking_budget);
  } else if (body.reasoning_effort) {
    const budgetMap = { low: 2000, medium: 8000, high: 20000 };
    budget = budgetMap[body.reasoning_effort];
  } else if (env?.THINKING_BUDGET) {
    budget = parseInt(env.THINKING_BUDGET);
  }

  let enabled;
  if (suffixFlags.enableThinking) {
    enabled = true;
  } else if (body.enable_thinking != null) {
    enabled = !!body.enable_thinking;
  } else if (body.reasoning_effort != null) {
    enabled = body.reasoning_effort !== 'none';
  } else {
    enabled = (env?.ENABLE_THINKING || '').toLowerCase() === 'true';
  }

  return { thinkingEnabled: enabled, thinkingBudget: budget };
}

function resolveSearch(body, suffixFlags, env) {
  if (suffixFlags.enableSearch) return true;
  if (body.extra_body?.enable_search === true) return true;
  return (env?.ENABLE_SEARCH || '').toLowerCase() === 'true';
}

// 测试用例
console.log('=== resolveThinking 测试 ===\n');

let passed = 0, failed = 0;

// AC-02: 后缀触发 thinking
let result = resolveThinking({}, { enableThinking: true }, {});
if (result.thinkingEnabled === true) { passed++; console.log('✓ AC-02: 后缀触发 thinking'); }
else { failed++; console.log('✗ AC-02 失败'); }

// AC-05: enable_thinking 参数
result = resolveThinking({ enable_thinking: true }, { enableThinking: false }, {});
if (result.thinkingEnabled === true) { passed++; console.log('✓ AC-05: enable_thinking 参数'); }
else { failed++; console.log('✗ AC-05 失败'); }

// AC-06: enable_thinking: false
result = resolveThinking({ enable_thinking: false }, { enableThinking: false }, { ENABLE_THINKING: 'true' });
if (result.thinkingEnabled === false) { passed++; console.log('✓ AC-06: enable_thinking: false 覆盖环境变量'); }
else { failed++; console.log('✗ AC-06 失败'); }

// AC-08: reasoning_effort: low
result = resolveThinking({ reasoning_effort: 'low' }, { enableThinking: false }, {});
if (result.thinkingEnabled === true && result.thinkingBudget === 2000) { passed++; console.log('✓ AC-08: reasoning_effort: low, budget=2000'); }
else { failed++; console.log('✗ AC-08 失败'); }

// AC-09: reasoning_effort: medium
result = resolveThinking({ reasoning_effort: 'medium' }, { enableThinking: false }, {});
if (result.thinkingEnabled === true && result.thinkingBudget === 8000) { passed++; console.log('✓ AC-09: reasoning_effort: medium, budget=8000'); }
else { failed++; console.log('✗ AC-09 失败'); }

// AC-10: reasoning_effort: high
result = resolveThinking({ reasoning_effort: 'high' }, { enableThinking: false }, {});
if (result.thinkingEnabled === true && result.thinkingBudget === 20000) { passed++; console.log('✓ AC-10: reasoning_effort: high, budget=20000'); }
else { failed++; console.log('✗ AC-10 失败'); }

// AC-11: reasoning_effort: none
result = resolveThinking({ reasoning_effort: 'none' }, { enableThinking: false }, {});
if (result.thinkingEnabled === false) { passed++; console.log('✓ AC-11: reasoning_effort: none 关闭 thinking'); }
else { failed++; console.log('✗ AC-11 失败'); }

// AC-12: thinking_budget 直接指定
result = resolveThinking({ enable_thinking: true, thinking_budget: 5000 }, { enableThinking: false }, {});
if (result.thinkingBudget === 5000) { passed++; console.log('✓ AC-12: thinking_budget=5000 优先级最高'); }
else { failed++; console.log('✗ AC-12 失败'); }

// AC-13: 环境变量兜底
result = resolveThinking({}, { enableThinking: false }, { ENABLE_THINKING: 'true' });
if (result.thinkingEnabled === true) { passed++; console.log('✓ AC-13: 环境变量 ENABLE_THINKING 兜底'); }
else { failed++; console.log('✗ AC-13 失败'); }

// AC-01: 无参数，thinking 关闭
result = resolveThinking({}, { enableThinking: false }, {});
if (result.thinkingEnabled === false) { passed++; console.log('✓ AC-01: 无参数时 thinking 关闭'); }
else { failed++; console.log('✗ AC-01 失败'); }

console.log('\n=== resolveSearch 测试 ===\n');

// AC-03: 后缀触发 search
result = resolveSearch({}, { enableSearch: true }, {});
if (result === true) { passed++; console.log('✓ AC-03: 后缀触发 search'); }
else { failed++; console.log('✗ AC-03 失败'); }

// AC-07: extra_body.enable_search
result = resolveSearch({ extra_body: { enable_search: true } }, { enableSearch: false }, {});
if (result === true) { passed++; console.log('✓ AC-07: extra_body.enable_search 触发'); }
else { failed++; console.log('✗ AC-07 失败'); }

// AC-14: 环境变量兜底
result = resolveSearch({}, { enableSearch: false }, { ENABLE_SEARCH: 'true' });
if (result === true) { passed++; console.log('✓ AC-14: 环境变量 ENABLE_SEARCH 兜底'); }
else { failed++; console.log('✗ AC-14 失败'); }

// 无参数，search 关闭
result = resolveSearch({}, { enableSearch: false }, {});
if (result === false) { passed++; console.log('✓ 无参数时 search 关闭'); }
else { failed++; console.log('✗ 失败'); }

console.log('\n========================================');
console.log(`总计: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
