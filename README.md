# Carbon AI

Carbon-based intelligence. An independent developer, wrapped as a drop-in model API for coding agents and clients.

The gateway **does not call any LLM**. Agents send requests; you read the full context on this machine and reply (keyboard or browser speech); the gateway writes the response back over **Anthropic Messages** or **OpenAI-compatible** JSON / SSE — so Claude Code, Codex, DeepSeek-style clients, and other agents can all point at the same endpoint.

# 碳基智能

一位独立开发者，把自己包装成智能体与客户端可直接调用的模型 API。

网关**不调用任何 LLM**：agent 把请求打过来，你在本机看完整上下文并亲手回复（键盘或浏览器语音），网关按 **Anthropic Messages** 或 **OpenAI 兼容** 的 JSON / SSE 写回去。Claude Code、Codex、DeepSeek 类客户端以及其它能自定义模型地址的智能体，都可以接到同一个入口。

---

## Project background

I work as an independent developer with collaborators across time zones. For a while the agents on my machine had no usable API, no token, and nothing they could actually call — so they sat idle.

I also spend a lot of time on remote pairing: diagnosing a machine, walking through a codebase, sitting behind someone else's agent as a human operator. When the session needs facts from their environment, their agent should collect that information and send it back.

If those clients were unused anyway, it made sense to package myself as a model. Any compatible agent can call that endpoint to talk to me, and I show up in their provider list like any other API.

## 项目背景

我是一名面向国际协作的独立开发者，经常和不同时区的人一起工作。有一段时间，手头的智能体没有可用的 API、也没有 Token，接不上任何模型，所以一直闲置。

同时我常做远程结对：帮人排查机器、一起看代码，并作为人工操作者坐在对方的 agent 后面。当会话需要现场信息时，应该由他们的 agent 采集并回传。

既然这些客户端闲着，不如把自己打包成一个模型。任何兼容的智能体都可以调用这个接口和我对话，我也会像普通 API 供应商一样出现在他们的列表里。

---

## Status

Two protocol families: **Anthropic Messages** (live: `POST /v1/messages`, `GET /v1/models`) and **OpenAI-compatible** Chat Completions / Responses (next, for Codex, DeepSeek-style clients, and similar agents).

Two doors: **`/`** is for agents (homepage Import uses the **local guest key** from `carbon.toml`, no account). **`/console`** is for humans (setup / login / desk / named keys / users). `/ui`, `/account`, `/admin` redirect to `/console`.

Empty database: open `/console` and create the first superadmin. Unattended: `bootstrap_password` in `carbon.toml` or `CARBON_BOOTSTRAP_PASSWORD`. Lost password: first line of `~/.carbon-ai/reset-bootstrap`, then restart or reload `/console`. Quotas, billing, and assignable repliers come later.

Runtime is **TypeScript** (Bun 1.2+; fall back to Node 22 if abort/SSE spikes fail). Console is a Vite + React SPA, built into `apps/console/dist` and served by the same Bun/Hono process at `/console`. No Python.

## 当前进度

两条协议线：**Anthropic Messages**（已上：`POST /v1/messages`、`GET /v1/models`）和 **OpenAI 兼容** 的 Chat Completions / Responses（接下来做，给 Codex、DeepSeek 类客户端等智能体用）。

两扇门：**`/`** 给智能体（首页 Import 用 `carbon.toml` 里的**本地匿名 key**，不用登录）。**`/console`** 给人（首次建超管 / 登录 / 操作台 / 记名 key / 用户）。`/ui`、`/account`、`/admin` 跳到 `/console`。

空库：打开 `/console` 创建第一位超管。无人值守：`bootstrap_password` 或 `CARBON_BOOTSTRAP_PASSWORD`。密码丢了：`~/.carbon-ai/reset-bootstrap` 第一行，然后重启或刷新 `/console`。限额、充值、指派回复者以后再做。

运行时是 **TypeScript**（Bun 1.2+；若 abort/SSE 尖峰失败则改 Node 22）。控制台是 Vite + React SPA，编进 `apps/console/dist`，由同一个 Bun/Hono 进程在 `/console` 提供。不使用 Python。

---

## Run

```bash
bun install
bun test
bun start
```

Default listen:

- `http://127.0.0.1:12580` (prefer this in client config)
- `http://[::1]:12580` (so `http://localhost:12580` works on macOS)

Loopback only. Data dir defaults to `~/.carbon-ai/` (keeps Desktop / iCloud out of the path).

## 跑起来

```bash
bun install
bun test
bun start
```

默认监听：

- `http://127.0.0.1:12580`（推荐写进客户端）
- `http://[::1]:12580`（所以 `http://localhost:12580` 在 macOS 上也能通）

不绑定局域网。数据目录默认 `~/.carbon-ai/`（避开 Desktop / iCloud）。

| Path | English | 中文 |
|---|---|---|
| `GET /` | Home; Import uses the local guest key (`sk-carbon-local`); no account | 首页；Import 用本地匿名 key（`sk-carbon-local`），不用登录 |
| `GET /console` | People UI: setup, login, keys, desk, users, settings | 给人用的控制台：建超管、登录、密钥、操作台、用户、设置 |
| `GET /ui` `/account` `/admin` | Redirect to `/console` | 跳到 `/console` |
| `GET /v1/models` | Model list (client key required; Anthropic shape if `anthropic-version` is set) | 模型列表（要客户端 key；带 `anthropic-version` 时为 Anthropic 形状） |
| `POST /v1/messages` | Anthropic Messages, SSE or JSON; hangs until the operator `complete`s | Anthropic Messages，SSE 或 JSON；挂起直到操作者 `complete` |
| `POST /v1/messages/count_tokens` | Heuristic `input_tokens` | 启发式 input_tokens |
| `GET /health` | liveness | liveness |
| `GET /ready` | readiness | readiness |
| `HEAD` / `GET /api/hello` | Claude Code warmup, 200 empty body | Claude Code warmup，200 空 body |
| `GET /debug/sse-hang?seconds=60&id=…` | Hanging SSE: first frame immediately, then `: ping` + `data: {"t":N}` every second | 挂起 SSE：立刻首帧，每秒 `: ping` + `data: {"t":N}` |
| `GET /debug/sse-status?id=…` | Hang session status (including abort channel) | 上述 hang 会话状态（含 abort 通道） |
| `POST /debug/jobs` | Create a job (debug; not a vendor protocol) | 创建任务（调试用，还不接厂商协议） |
| `GET /debug/jobs/:id/stream` | Hanging SSE until `complete` / cancel | 挂起 SSE，直到 `complete` / 取消 |
| `POST /debug/jobs/:id/complete` | Simulate an operator reply | 模拟操作者回复 |

Config: repo-root `carbon.toml`. Also `CARBON_PORT`, `CARBON_HOST`, `CARBON_DATA_DIR`, `CARBON_CONFIG`, `CARBON_BOOTSTRAP_USERNAME`, `CARBON_BOOTSTRAP_PASSWORD`, `CARBON_SITE_NAME`, `CARBON_SITE_NAME_ZH`, `CARBON_PUBLIC_ORIGIN`. Superadmin Settings in `/console` can set site name and public origin without editing the file.

Dev: `bun dev` (gateway watch + Vite rebuild of the console). `bun start` builds `apps/console/dist` then starts one Bun process.

配置见仓库根目录 `carbon.toml`。也可用 `CARBON_PORT`、`CARBON_HOST`、`CARBON_DATA_DIR`、`CARBON_CONFIG`、`CARBON_BOOTSTRAP_USERNAME`、`CARBON_BOOTSTRAP_PASSWORD`、`CARBON_SITE_NAME`、`CARBON_SITE_NAME_ZH`、`CARBON_PUBLIC_ORIGIN`。超级管理员可在 `/console` 的设置里改站点名和对外域名，不必改文件。

开发：`bun dev`（网关 watch + 控制台 Vite 重建）。`bun start` 先编 `apps/console/dist`，再单进程启动。

---

## Clients

Any agent that can set a custom model base URL can point here.

Anthropic-style (e.g. Claude Code): `ANTHROPIC_BASE_URL=http://127.0.0.1:12580` (**do not** append `/v1`), `ANTHROPIC_AUTH_TOKEN=sk-carbon-local` (local guest key), and a model id such as `claude-sonnet-4-6`. The home-page Import button writes this. Named keys from `/console` identify the caller.

OpenAI-style (e.g. Codex, DeepSeek-compatible clients): `base_url` **does** include `/v1`. The Responses / Chat Completions adapters are not wired yet.

The gateway hangs the SSE until a human replies. Sign in at `/console` with a replier account and send from the desk, or `POST /debug/jobs/:id/complete` with `{"text":"…"}`.

## 客户端

任何能自定义模型地址的智能体都可以指过来。

Anthropic 风格（如 Claude Code）：`ANTHROPIC_BASE_URL=http://127.0.0.1:12580`（**不要**加 `/v1`），`ANTHROPIC_AUTH_TOKEN=sk-carbon-local`（本地匿名 key），模型 id 如 `claude-sonnet-4-6`。首页 Import 会写入这些。`/console` 签发的记名 key 用来区分调用方。

OpenAI 风格（如 Codex、DeepSeek 兼容客户端）：`base_url` **要**带 `/v1`。Responses / Chat Completions 适配器还没接。

网关会挂起 SSE 等人回复。到 `/console` 用有回复权的账号登录，在操作台发送，或 `POST /debug/jobs/:id/complete` `{"text":"…"}`。

---

## PR 1 spikes (Bun 1.3.14 / macOS)

`bun test` hits a real local port over HTTP. It does not string-concat frames.

- Dual-stack: `/health` is 200 on both `127.0.0.1` and `[::1]`
- SSE: `Content-Type` starts with `text/event-stream`; first byte < 2s; `{"done":true}` appears before body end
- After client `AbortController`, the hang is marked `cancelled` in **≤ 2s** (Bun local abort **works**; no need to switch to Node 22 for this)
- A 12s hang still gets frames, so `idleTimeout: 0` overrides Bun's default 10s

`Bun.serve` idle-disconnects at 10s by default. Carbon AI sets `idleTimeout` to `0` (disabled), otherwise SSE dies while a human is thinking.

## PR 1 尖峰（Bun 1.3.14 / macOS）

`bun test` 用真实 HTTP 打本机端口，不是拼接字符串：

- 双栈：`127.0.0.1` 与 `[::1]` 的 `/health` 均为 200
- SSE：`Content-Type` 以 `text/event-stream` 开头；首字节 < 2s；`{"done":true}` 出现在 body 结束之前
- 客户端 `AbortController` 后 **≤ 2s** 把 hang 标成 `cancelled`（Bun 本机 abort **可用**，不必为此切 Node 22）
- 挂起 12s 仍有帧，说明 `idleTimeout: 0` 盖过了 Bun 默认 10s

`Bun.serve` 默认 10s 空闲断开。Carbon AI 把 `idleTimeout` 设为 `0`（禁用），否则人思考时 SSE 会被运行时掐掉。

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Agent rules: [AGENTS.md](./AGENTS.md).

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)。智能体约束：[AGENTS.md](./AGENTS.md)。
