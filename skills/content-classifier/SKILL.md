---
name: content-classifier
description: 识别内容类型（论点/操作/事实/叙事），决定提取策略
metadata:
  ikr:
    priority: normal
    always: false
---

# Content Classifier Skill

## 四种类型定义
- **argument（论点型）**：作者在论证一个主张，有观点有依据
- **operation（操作型）**：描述如何做某件事，有步骤有条件
- **fact（事实型）**：陈述数据、定义、客观规律
- **narrative（叙事型）**：讲案例、故事、复盘

## 分类规则
- 一篇内容可以同时包含多种类型
- 识别主类型（占比最大）+ 次要类型（按段落）
- 主类型决定整体摘要结构
- 含时效性数据（数字、统计、调研）标记 hasTimelyData: true

## 常见混合模式
- 观点文章（argument 主 + narrative 次）
- 操作指南（operation 主 + fact 次）
- 案例分析（narrative 主 + argument 次）
- 行业报告（fact 主 + argument 次）
