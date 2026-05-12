# 简单GTO · Bot V2.3 PRD

> 生成日期：2026-05-12
> 状态：已确权，第二批/第三批实现中

## 1. 背景

当前 Bot V2 已完成 1-3 个 regular 桌池、本机长期画像、board texture、听牌识别、pot odds 与多街下注线。用户实测反馈是：7 个 AI 仍然打得偏弱，且不够符合各自牌手设定。

根因不是桌池数量，而是行为模型仍偏向“同一套决策函数 + 不同频率参数”。V2.3 需要让 AI 从参数差异升级为牌手策略差异。

## 2. 小版本目标

- 让 7 个 AI 的打法更像真实现金局牌手。
- 强 regular 不只是更凶，而是有更合理的翻前范围、3Bet、盲位防守和价值下注倾向。
- 非 regular 保留漏洞，但不能低智到破坏训练质量。
- 用户能明显感到不同 AI 的打法差异。
- 不引入完整 solver、云端模型调用或账号系统。

## 3. 第一批范围

第一批只做高收益、低风险内容：

- 建立牌手档案策略层。
- 给 regular / TAG / balanced / pressure / weak-tight / LAG / calling-station / maniac / recreational 配置翻前策略。
- 翻前决策接入位置范围。
- 面对 open 时区分 call、3Bet、fold。
- 盲位防守保留独立逻辑。
- 增加单元测试，确保不同 AI 同一场景下动作不同。

## 4. 明确不做

- 不做全量 GTO solver。
- 不做云端学习模型。
- 不做用户自选难度。
- 不重构整个 `src/app.js`。
- 不改桌面快捷按钮。
- 不改 Windows / Mac 启动配置。

## 5. 牌手设定

### 强 Regular · TAG

- 入池更干净。
- 翻前 3Bet 以强价值和少量 blocker bluff 为主。
- 面对松弱用户，主要通过位置和价值下注获利。

### 强 Regular · 平衡型

- 范围最接近训练基准。
- 翻前 open / call / 3Bet 保持均衡。
- exploit 用户漏洞时幅度克制。

### 强 Regular · 攻击型

- BTN/CO/SB 偷盲更积极。
- 面对用户过度弃牌时增加 3Bet bluff。
- 翻后继续下注和施压频率更高。

### 紧弱

- 入池少。
- 面对 3Bet、c-bet、二 barrel 容易弃牌。
- 不应随意跟注边缘牌。

### 松凶

- 入池宽。
- 攻击频率高。
- 有 semi-bluff 和 steal，但仍受牌力、位置和底池赔率约束。

### 跟注站

- 跟注范围宽。
- 诈唬少。
- 不容易被小注 bluff 赶走。

### 疯鱼

- 波动大，open 和 3Bet 更宽。
- 可能过度加注，但仍要避免明显非法或完全无牌力动作。

### 普通娱乐玩家

- 有常见错误。
- 冷跟偏多、3Bet 偏少。
- 不像极端标签玩家。

## 6. 验收标准

- `bun run verify` 通过。
- 同一手牌在 weak-tight 与 LAG / pressure regular 下会出现不同翻前策略。
- regular 面对可 exploit 的用户长期画像会提高偷盲和 3Bet 压力。
- BB 免费行动仍然 check，不会 fold。
- 文档、测试和代码在同一小版本提交中保持一致。

## 7. 第二批范围：翻后策略

第二批把翻后从统一分数判断升级为牌手画像驱动：

- 强 Regular · TAG：干燥高张面稳定 c-bet，湿润无权益牌面减少空枪；河牌更重视价值下注。
- 强 Regular · 平衡型：下注、过牌、跟注阈值更接近训练基准。
- 强 Regular · 攻击型：有主动权时持续施压；有 blocker / draw 时更多 semi-bluff。
- 紧弱：无强牌时减少 c-bet / barrel，面对压力更容易弃牌。
- 松凶：更常用 probe、barrel 和 semi-bluff，但仍受牌面权益约束。
- 跟注站：诈唬少、加注少、跟注阈值低，小到中等下注更难打走。
- 疯鱼：攻击和加注频率最高，下注尺度更大，保留高波动特征。
- 普通娱乐玩家：偏被动跟注，偶尔不合理 probe，但不极端。

## 8. 第三批范围：下注尺度

第三批给每类 AI 独立下注尺度：

- 价值下注、诈唬下注、持续施压、试探下注、加注倍数分开配置。
- TAG / balanced 尺度更稳定，pressure regular 更会用中大尺度压迫。
- calling station 倾向小注跟注、少主动大注。
- maniac 使用更宽、更大的下注尺度，制造波动。

## 9. 第二/三批验收标准

- `buildBotPostflopPlan` 暴露可测试的翻后计划。
- 同一翻后局面下，weak-tight、calling-station、regular-pressure、maniac 的价值下注阈值、跟注阈值、诈唬频率和下注尺度明显不同。
- 面对下注时 calling-station 比 weak-tight 更容易跟注。
- regular-pressure 在有主动权和听牌权益时，比 regular-tag 更愿意持续施压。
- maniac 的压力下注尺度高于 TAG。
- 桌面快捷按钮仍指向主项目目录，不指向临时 worktree。
