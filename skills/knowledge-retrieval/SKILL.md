---
name: knowledge-retrieval
description: 知识库检索策略，根据问题类型优化召回质量
metadata:
  ikr:
    priority: normal
    always: true
---

# Knowledge Retrieval Skill

## 检索优先级
1. 用户知识库（个人积累）> 通用 AI 知识
2. 近期收录（2周内）> 较早收录
3. 高留存分值（经常被调取）> 低留存分值

## 类型匹配
- "怎么做"类问题 → 优先召回 operation 类型卡片
- "为什么"类问题 → 优先召回 argument 类型卡片
- "案例参考"类问题 → 优先召回 narrative 类型卡片
- 数据支撑需求 → 优先召回 fact 类型卡片

## 时效性处理
fact 类型卡片如果 data_published_at 超过 2 年，在引用时注明：
"（数据来自 XXXX 年，建议核实最新数据）"

## 来源标注规范
- 来自知识库：「来自《文章标题》」
- 来自通用知识：「来自通用知识」
- 两者结合：分别标注
