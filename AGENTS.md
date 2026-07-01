# Agent notes

This file is the contract for coding agents working in this repo. Follow it unless the user explicitly overrides it.

# 给智能体的说明

本文件是本仓库里编码智能体的约束。用户没有明确改口时，一律按这里做。

---

## Product / 产品

Carbon AI packages a **human operator** as a model API. The gateway **does not call any LLM**.

Carbon AI 把**人工操作者**包装成模型 API。网关**不调用任何 LLM**。

- Speak **Anthropic Messages** and **OpenAI-compatible** HTTP so any agent that can set a custom base URL can connect (Claude Code, Codex, DeepSeek-style clients, and others).
- 走 **Anthropic Messages** 与 **OpenAI 兼容** HTTP，任何能自定义模型地址的智能体都可以接（Claude Code、Codex、DeepSeek 类客户端等）。
- Do not frame the product as Claude Code-only. Name a specific client only when the task is that integration (e.g. the CC Switch button).
- 不要把产品写成只服务 Claude Code。只有任务就是某个接入时，才点名具体客户端（例如 CC Switch 按钮）。
- Stack: TypeScript, Bun 1.2+ (Node 22 only if abort/SSE spikes fail). **No Python.**
- 技术栈：TypeScript、Bun 1.2+（仅当 abort/SSE 尖峰失败才切 Node 22）。**禁止 Python。**

---

## Copy / 文案

Docs, commit messages, and similar copy are bilingual: **English first, Chinese second.**

文档、commit 说明和同类文案均为双语：**英文在前，中文在后。**

- Public copy is international: independent developer, idle agents, no usable API/token, remote pairing. Do not write about account bans, regional network blocks, or geopolitics.
- 对外文案要国际化：独立开发者、闲置的智能体、没有可用的 API/Token、远程结对。不要写封号、地区网络限制或地缘政治。
- README is for humans. Agent rules stay in this file, not README.
- README 给人类看。智能体规则留在本文件，不要写进 README。

---

## Git commits / 提交

### Same topic vs new commit / 同主题与新开

```
Same topic + rewritable history → git commit --amend (or squash to one)
Different topic                 → new commit
```

同主题且历史可改写 → `git commit --amend`（或压成一条）。
不同主题 → 必须新开 commit。

**Rewritable** = not yet pushed to a shared remote, or only on a private branch (`--force-with-lease` is OK there). **Never force** shared `main` / `dev` unless the user explicitly asks to rewrite.

**可改写** = 尚未推到共享远端，或只在自己的私有分支上（那里可用 `--force-with-lease`）。**禁止** force 共享的 `main` / `dev`，除非用户明确要求改写历史。

Same topic includes: finishing the same feature, copy tweaks on the same doc, the same bug plus a hole found while testing, the same naming change after feedback. Adjacent time ≠ same topic.

同主题包括：同一功能的续写、同一文档的改文案、同一 bug 修完后自测的小洞、同一命名按反馈改口。时间挨着 ≠ 同主题。

Before commit: `git status -sb` and `git log --oneline origin/<tracking>..HEAD`. If the unpushed chain is one topic, amend or squash. Message describes the **final** state, not "adjust again".

提交前看 `git status -sb` 和 `git log --oneline origin/<tracking>..HEAD`。未推送串若是同一主题，amend 或压平。message 写**最终语义**，不要写「再次调整」。

Wait for the user to say 提交 / commit unless they already asked to land it.

用户说「提交」再 commit；除非他们已经要求落地。

### Message format / 说明格式

```
type: English subject (imperative, no trailing period)

English body, one idea per line. Do not hard-wrap at 72 columns.
中文正文，每个要点一整行，不要按 72 列硬折。
```

`type` is `feat` / `fix` / `docs` / `chore` / `refactor` / `test`. Scope optional: `feat(gateway): …`.

Bug fixes may use:

```
Problem: …
Cause: …
Fix: …
问题：…
问题原因：…
解决方案：…
```

Do not add Co-authored-by or other trailers unless asked.

不要擅自加 Co-authored-by 等 trailer。

Renames: `git mv old new` first, then edit. Git should show `renamed:`.

重命名：先 `git mv old new` 再改内容，让 git 识别为 rename。

Do not commit `.idea/`, `.DS_Store`, `node_modules/`, secrets, or `~/.carbon-ai` data.

不要提交 `.idea/`、`.DS_Store`、`node_modules/`、密钥、或 `~/.carbon-ai` 数据。

---

## Code / 代码

- Match existing style. Small, factual comments only when the constraint is non-obvious.
- 跟周围代码走。注释只写非显而易见的约束。
- Do not mount gzip/compress on SSE. Set SSE headers **before** `stream()`. `idleTimeout` must stay `0` so a human think-time does not drop the socket.
- 不要给 SSE 套 gzip/compress。SSE 头必须在 `stream()` **之前**设好。`idleTimeout` 必须保持 `0`，人思考时不能断流。
- Vendor SSE is written by `SseWriter` / protocol adapters, not Hono `streamSSE`.
- 厂商 SSE 由 `SseWriter` / 协议适配器写，不走 Hono `streamSSE`。
- Accept any `model` string. Aliases are display-only. Prefer `claude-*` ids in Claude Code import so the local client stays quiet.
- `model` 接受任意字符串。alias 只影响展示。给 Claude Code 导入时优先 `claude-*` id，避免客户端本地告警。
- Client keys: SHA-256 then `timingSafeEqual` on the digests. Never `timingSafeEqual` on raw keys of unequal length.
- 客户端 key：先 SHA-256，再对摘要 `timingSafeEqual`。禁止对长度不同的原始 key 直接 `timingSafeEqual`。
- Config file is `carbon.toml`. Env prefix is `CARBON_*`. Packages live under `@carbon-ai/*`.
- 配置文件是 `carbon.toml`。环境变量前缀 `CARBON_*`。包名在 `@carbon-ai/*`。

---

## Tests / 测试

```bash
bun test
```

Gateway behavior that talks HTTP (listen, SSE, abort, `/v1/messages`) must use a **real** local port, not concatenated strings.

涉及真实 HTTP 的网关行为（listen、SSE、abort、`/v1/messages`）必须打本机端口，禁止只拼字符串。

Do not skip the suite to land a change. If a test is wrong, fix the test.

不要为了交代码跳过测试。测试错了就改测试。

---

## Security / 安全

- `operator_token` is root for the local console. `sk-carbon-local` is a client key. Neither belongs in git, screenshots of secrets, or public issues.
- `operator_token` 是本机控制台 root。`sk-carbon-local` 是客户端 key。都不要进 git、密钥截图或公开 issue。
- Loopback by default. Do not bind `0.0.0.0` unless the user asks, and then origin checks are mandatory.
- 默认 loopback。不要绑 `0.0.0.0`，除非用户要求；绑了就必须校验 Origin。

---

## Contributions / 贡献

Humans: see `CONTRIBUTING.md`. Agents follow this file and that one together.

人类看 `CONTRIBUTING.md`。智能体同时遵守本文件和那份。
