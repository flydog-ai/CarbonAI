# Contributing

Thanks for looking at Carbon AI. Please read this before sending a change.

# 贡献指南

感谢关注 Carbon AI。改代码或提 PR 前请先读本页。

Agent-facing rules (commits, copy, SSE invariants) live in [`AGENTS.md`](./AGENTS.md). This file is the human checklist.

给智能体的约束（提交、文案、SSE 不变量）在 [`AGENTS.md`](./AGENTS.md)。本文件是给人看的清单。

---

## Setup / 环境

Need Bun 1.2+.

需要 Bun 1.2+。

```bash
bun install
bun test
bun dev
```

Gateway: `http://127.0.0.1:12580`. Config: `carbon.toml`. Data: `~/.carbon-ai/`.

网关：`http://127.0.0.1:12580`。配置：`carbon.toml`。数据：`~/.carbon-ai/`。

---

## Pull requests / 拉取请求

1. One intent per PR. Do not mix an unrelated refactor into a protocol fix.
2. 一个 PR 一个意图。不要把无关重构塞进协议修复。
3. Run `bun test` before you push.
4. 推送前跑 `bun test`。
5. New HTTP behavior needs a real-listen test, not a golden string of SSE.
6. 新的 HTTP 行为要有真实 listen 测试，不要只提交一段拼出来的 SSE 字符串。
7. Update README when you add a user-facing path or env var. Keep **English first, Chinese second**.
8. 增加用户能碰到的路径或环境变量时改 README。保持**英文在前、中文在后**。
9. Do not force-push `main` unless a maintainer asked to rewrite it.
10. 除非维护者明确要求改写历史，否则不要 force `main`。

Commit shape is in `AGENTS.md`: same topic + unpushed → amend; different topic → new commit; bilingual body; no 72-column wrap.

提交格式见 `AGENTS.md`：同主题且未推送 → amend；不同主题 → 新开；正文双语；不要按 72 列硬折。

---

## What to work on / 做什么

Useful directions:

值得做的方向：

- OpenAI-compatible Chat Completions / Responses adapters (Codex, DeepSeek-style agents)
- OpenAI 兼容的 Chat Completions / Responses 适配器（Codex、DeepSeek 类智能体）
- Usage quotas, recharge, and assignable repliers
- 用量限额、充值、指派回复者
- Protocol fixtures and client simulators
- 协议 fixture 与客户端模拟器

Out of scope: proxying to a real model, Python, embeddings, image generation.

不做：转发到真实模型、Python、embeddings、图像生成。

---

## License / 许可

WTFPL. Software copyright FlyDogAI. See `LICENSE`.

WTFPL。软件版权归 FlyDogAI。见 `LICENSE`。
