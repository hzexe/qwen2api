#!/usr/bin/env node
/**
 * parseModelSuffix 单元测试
 * 参考文档: doc/search-feature/03-testing.md
 */

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

// 测试用例
const testCases = [
  // # | 输入 | 期望 cleanModel | 期望 thinking | 期望 search | 说明
  ['qwen-plus-thinking-search', 'qwen-plus', true, true, '多后缀并存，thinking 在前'],
  ['qwen-plus-search-thinking', 'qwen-plus', true, true, '多后缀并存，search 在前'],
  ['qwen-plus-thinking', 'qwen-plus', true, false, '单后缀 thinking'],
  ['qwen-plus-search', 'qwen-plus', false, true, '单后缀 search'],
  ['qwen-plus', 'qwen-plus', false, false, '无后缀'],
  ['qwen-max-search', 'qwen-max', false, true, '真实模型名误识别（已知限制）'],
  ['qwen-plus-thinking-thinking', 'qwen-plus', true, false, '重复后缀，幂等性'],
  ['qwen-plus-search-search', 'qwen-plus', false, true, '重复后缀，幂等性'],
  ['qwen-plus-search-thinking-search', 'qwen-plus', true, true, '三个后缀混合'],
  ['-thinking', '', true, false, '极端情况：只有后缀'],
  ['qwen-turbo', 'qwen-turbo', false, false, '后缀词在中间，不触发'],
];

let passed = 0;
let failed = 0;

console.log('parseModelSuffix 单元测试\n');
console.log('='.repeat(80));

for (const [input, expectedClean, expectedThinking, expectedSearch, desc] of testCases) {
  const result = parseModelSuffix(input);
  const ok = result.cleanModel === expectedClean 
    && result.enableThinking === expectedThinking 
    && result.enableSearch === expectedSearch;
  
  if (ok) {
    passed++;
    console.log(`✓ ${input.padEnd(30)} → ${result.cleanModel.padEnd(15)} thinking=${result.enableThinking} search=${result.enableSearch}`);
  } else {
    failed++;
    console.log(`✗ ${input.padEnd(30)} → 期望: ${expectedClean.padEnd(15)} thinking=${expectedThinking} search=${expectedSearch}`);
    console.log(`  实际: ${result.cleanModel.padEnd(46)} thinking=${result.enableThinking} search=${result.enableSearch}`);
    console.log(`  说明: ${desc}`);
  }
}

console.log('='.repeat(80));
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);

process.exit(failed > 0 ? 1 : 0);
