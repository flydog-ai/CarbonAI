export type HomePageData = {
  href: string;
  endpoint: string;
  displayName: string;
  siteName?: string;
  siteNameZh?: string;
  model: string;
  apiKey: string;
  visitorKey?: boolean;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderHomePage(data: HomePageData): string {
  const href = escapeHtml(data.href);
  const endpoint = escapeHtml(data.endpoint);
  const displayName = escapeHtml(data.displayName);
  const siteName = escapeHtml(data.siteName || "Carbon AI");
  const siteNameZh = escapeHtml(data.siteNameZh || "碳基智能");
  const model = escapeHtml(data.model);
  const apiKey = escapeHtml(data.apiKey);
  const hasKey = Boolean(data.apiKey);
  const hasImport = Boolean(data.href);
  const visitorKey = Boolean(data.visitorKey);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${siteName} · ${siteNameZh}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600;700&family=Red+Hat+Mono:wght@400;600&family=Red+Hat+Text:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script>
    (function () {
      try {
        var s = localStorage.getItem("carbon-lang");
        var l = s === "zh" || s === "en" ? s : (String(navigator.language || "").toLowerCase().indexOf("zh") === 0 ? "zh" : "en");
        document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
        document.documentElement.dataset.lang = l;
      } catch (e) {}
      var saved = null;
      try { saved = localStorage.getItem("carbon-theme"); } catch (e) {}
      var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      var theme = saved === "light" || saved === "dark" ? saved : dark ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.style.colorScheme = theme;
    })();
  </script>
  <style>
    :root, [data-theme="light"] {
      color-scheme: light;
      --bg: #eef1f3;
      --bg-2: #e3e8eb;
      --card: #f7f9fa;
      --ink: #161b1f;
      --muted: #667178;
      --line: #d4dce0;
      --primary: #1f6b72;
      --primary-2: #15555b;
      --primary-ink: #f2fbfb;
      --soft: #e3f0f1;
      --ok: #2f7d5b;
      --hover: #e8eef0;
      --secret: #161b1f;
      --secret-ink: #e8eef0;
      --toast: #161b1f;
      --toast-ink: #f2fbfb;
      --shadow: 0 1px 2px rgb(22 27 31 / 6%), 0 10px 24px rgb(22 27 31 / 6%);
      --shadow-lg: 0 20px 50px rgb(22 27 31 / 14%);
    }
    [data-theme="dark"] {
      color-scheme: dark;
      --bg: #101417;
      --bg-2: #171c20;
      --card: #1a2024;
      --ink: #e6eef1;
      --muted: #8a99a1;
      --line: #2c353b;
      --primary: #6ec9c4;
      --primary-2: #8ad9d4;
      --primary-ink: #0c1a1b;
      --soft: #1a2c2e;
      --ok: #6ec89a;
      --hover: #22292e;
      --secret: #0c0f12;
      --secret-ink: #e6eef1;
      --toast: #e6eef1;
      --toast-ink: #101417;
      --shadow: 0 1px 2px rgb(0 0 0 / 35%), 0 10px 24px rgb(0 0 0 / 28%);
      --shadow-lg: 0 20px 50px rgb(0 0 0 / 45%);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      font-family: "Red Hat Text", "PingFang SC", "Noto Sans SC", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(720px 420px at 110% -10%, color-mix(in srgb, var(--primary) 14%, transparent), transparent 60%),
        radial-gradient(640px 380px at -10% 110%, color-mix(in srgb, var(--primary) 9%, transparent), transparent 55%),
        linear-gradient(180deg, var(--soft) 0%, var(--bg) 48%);
    }
    body::before {
      content: ""; position: fixed; inset: 0; pointer-events: none; opacity: .4;
      background-image: linear-gradient(color-mix(in srgb, var(--primary) 8%, transparent) 1px, transparent 1px),
        linear-gradient(90deg, color-mix(in srgb, var(--primary) 8%, transparent) 1px, transparent 1px);
      background-size: 48px 48px;
    }
    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .wrap { position: relative; min-height: 100vh; display: flex; flex-direction: column; }
    header {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 16px 7vw; z-index: 2;
    }
    .brand { display: flex; align-items: center; gap: 10px; color: inherit; text-decoration: none; }
    .brand:hover { text-decoration: none; }
    .mark {
      width: 36px; height: 36px; border-radius: 10px;
      overflow: hidden; display: block; line-height: 0; background: #161b1f; flex: 0 0 36px;
    }
    .mark svg { width: 100%; height: 100%; display: block; }
    .brand strong {
      font-family: Oswald, "Noto Sans SC", "PingFang SC", sans-serif;
      font-weight: 600;
      letter-spacing: 0.04em;
      font-size: 1.1rem;
    }
    .nav { display: flex; align-items: center; gap: 8px; }
    .lang-switch {
      display: inline-flex; border: 1px solid var(--line); border-radius: 999px;
      overflow: hidden; background: var(--card); padding: 2px;
    }
    .lang-switch button {
      border: 0; background: transparent; cursor: pointer; padding: 5px 10px;
      border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--muted); font-family: inherit;
    }
    .lang-switch button.on { background: var(--soft); color: var(--primary); }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      border: 0; cursor: pointer; font-weight: 600; border-radius: 10px;
      padding: 10px 16px; font-family: inherit; font-size: 14px; white-space: nowrap;
    }
    .btn-primary { background: var(--primary); color: var(--primary-ink); }
    .btn-primary:hover { background: var(--primary-2); text-decoration: none; }
    .btn-secondary { background: var(--card); color: var(--ink); border: 1px solid var(--line); }
    .btn-secondary:hover { background: var(--hover); text-decoration: none; }
    .btn-sm { padding: 6px 10px; font-size: 12px; border-radius: 8px; }
    main { flex: 1; padding: 28px 7vw 64px; }
    .hero {
      display: grid; grid-template-columns: 1fr minmax(280px, 440px);
      gap: 48px; align-items: center; max-width: 1120px; margin: 0 auto 48px;
    }
    .kicker {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
      color: var(--primary); background: var(--soft); border: 1px solid var(--line);
      border-radius: 999px; padding: 4px 10px; margin: 0 0 16px;
    }
    html[data-lang="zh"] .kicker { text-transform: none; letter-spacing: .04em; }
    h1 {
      font-family: Oswald, "Noto Sans SC", "PingFang SC", sans-serif;
      font-weight: 600;
      font-size: clamp(2.6rem, 5.5vw, 3.8rem);
      letter-spacing: 0.03em; line-height: 1.05; margin: 0 0 14px;
    }
    .lede { margin: 0 0 22px; font-size: 1.08rem; line-height: 1.6; color: var(--muted); max-width: 40ch; }
    .cta-row { display: flex; flex-wrap: wrap; gap: 10px; }
    .panel {
      background: var(--card); border: 1px solid var(--line); border-radius: 16px;
      box-shadow: var(--shadow-lg); overflow: hidden;
    }
    .panel-head {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 14px 18px; border-bottom: 1px solid var(--line); background: var(--bg-2);
    }
    .dots { display: flex; gap: 6px; }
    .dots i { width: 10px; height: 10px; border-radius: 999px; display: block; }
    .dots .r { background: #f87171; } .dots .a { background: #fbbf24; } .dots .g { background: #34d399; }
    .panel-head b { font-size: 13px; }
    .panel-body { padding: 18px 18px 16px; }
    .row {
      display: grid; grid-template-columns: 92px 1fr auto; gap: 8px; align-items: center;
      padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 13px;
    }
    .row:last-of-type { border-bottom: 0; }
    .row span { color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    html[data-lang="zh"] .row span { text-transform: none; letter-spacing: .04em; }
    .mono { font-family: "Red Hat Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; }
    .loop {
      margin: 14px 0 0; background: var(--secret); color: var(--secret-ink); border-radius: 12px;
      padding: 12px 14px; font-family: "Red Hat Mono", ui-monospace, monospace; font-size: 12px; line-height: 1.7;
    }
    .loop .ok { color: var(--ok); } .loop .wait { color: var(--primary); } .loop .cmd { color: #7eb8e8; }
    .hint { margin: 12px 0 0; font-size: 12px; color: var(--muted); line-height: 1.5; }
    .panel-actions { margin-top: 14px; }
    .panel-actions .btn { width: 100%; }
    .pills { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; max-width: 1120px; margin: 0 auto 36px; }
    .pill {
      display: inline-flex; align-items: center; gap: 8px;
      background: var(--card); border: 1px solid var(--line); border-radius: 999px;
      padding: 8px 14px; font-size: 13px; font-weight: 600; box-shadow: var(--shadow);
    }
    .pill i { width: 8px; height: 8px; border-radius: 999px; background: var(--primary); display: block; }
    .features { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; max-width: 1120px; margin: 0 auto 40px; }
    .feat {
      background: var(--card); border: 1px solid var(--line); border-radius: 16px;
      padding: 20px; box-shadow: var(--shadow);
    }
    .icon {
      width: 40px; height: 40px; border-radius: 12px; background: var(--soft); color: var(--primary);
      display: grid; place-items: center; margin-bottom: 12px;
    }
    .icon svg { width: 20px; height: 20px; }
    .feat h3 { margin: 0 0 8px; font-size: 16px; }
    .feat p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.55; }
    .clients { max-width: 1120px; margin: 0 auto; text-align: center; }
    .clients h2 { margin: 0 0 8px; font-size: 1.25rem; }
    .clients .sub { margin: 0 0 16px; color: var(--muted); font-size: 14px; }
    .chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
    .chip {
      display: inline-flex; align-items: center; gap: 8px;
      background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; font-size: 13px; font-weight: 600;
    }
    .chip .badge { font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; background: var(--ok); color: #fff; border-radius: 999px; padding: 2px 7px; }
    html[data-lang="zh"] .chip .badge { text-transform: none; }
    .chip .soon { background: var(--bg-2); color: var(--muted); }
    footer {
      border-top: 1px solid var(--line); padding: 18px 7vw; display: flex; flex-wrap: wrap;
      justify-content: space-between; gap: 10px; color: var(--muted); font-size: 13px; background: color-mix(in srgb, var(--card) 70%, transparent);
    }
    .toast {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: var(--toast); color: var(--toast-ink); padding: 10px 14px; border-radius: 10px; font-size: 13px;
      opacity: 0; pointer-events: none; transition: opacity .2s;
    }
    .toast.on { opacity: 1; }
    @media (max-width: 900px) {
      .hero, .features { grid-template-columns: 1fr; }
      header, main, footer { padding-left: 20px; padding-right: 20px; }
      .row { grid-template-columns: 1fr; gap: 4px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="brand" href="/">
        <span class="mark" aria-hidden="true"><svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect width="32" height="32" rx="8" fill="#161b1f"/><path d="M21 24.66 11 24.66 6 16 11 7.34 21 7.34" fill="none" stroke="#6ec9c4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><polygon fill="#6ec9c4" points="18.4,16 17.2,18.078 14.8,18.078 13.6,16 14.8,13.922 17.2,13.922"/></svg></span>
        <strong>${siteName}</strong>
      </a>
      <div class="nav">
        <div class="lang-switch" role="group" aria-label="Appearance">
          <button type="button" data-set-theme="light" data-i18n="theme.light">Light</button>
          <button type="button" data-set-theme="dark" data-i18n="theme.dark">Dark</button>
        </div>
        <div class="lang-switch" role="group">
          <button type="button" data-set-lang="en">English</button>
          <button type="button" data-set-lang="zh">中文</button>
        </div>
        <a class="btn btn-secondary btn-sm" href="/console" data-i18n="nav.console">Console</a>
      </div>
    </header>
    <main>
      <section class="hero">
        <div>
          <p class="kicker" data-i18n="kicker">Human as a model API</p>
          <h1>${siteName}</h1>
          <p class="lede" data-i18n="lede">No LLM behind this gateway. Agents send a request; a person on this machine reads the context and replies. Compatible clients see a normal model endpoint.</p>
          <div class="cta-row">
            <a class="btn btn-primary" href="/console" data-i18n="cta.console">Open console</a>
          </div>
        </div>
        <aside class="panel" aria-label="Guest key">
          <div class="panel-head">
            <span class="dots" aria-hidden="true"><i class="r"></i><i class="a"></i><i class="g"></i></span>
            <b>${displayName}</b>
          </div>
          <div class="panel-body">
            <div class="row">
              <span data-i18n="row.base">Base URL</span>
              <code class="mono" id="home-endpoint">${endpoint}</code>
              <button class="btn btn-secondary btn-sm" type="button" data-copy="home-endpoint" data-i18n="copy">Copy</button>
            </div>
            <div class="row">
              <span data-i18n="row.model">Model</span>
              <code class="mono">${model}</code>
              <span></span>
            </div>
            <div class="row">
              <span data-i18n="row.key">Guest key</span>
              <code class="mono" id="home-key">${apiKey || "—"}</code>
              ${hasKey ? `<button class="btn btn-secondary btn-sm" type="button" data-copy="home-key" data-i18n="copy">Copy</button>` : `<span></span>`}
            </div>
            <div class="loop" aria-hidden="true">
              <div><span class="cmd">POST</span> /v1/messages</div>
              <div class="wait" data-i18n="loop.wait">SSE hanging — waiting for a human</div>
              <div class="ok" data-i18n="loop.ok">operator replies → stream completes</div>
            </div>
            ${
              hasImport
                ? `<div class="panel-actions"><a class="btn btn-primary" id="cc-switch-import" href="${href}" data-i18n="cta.import">Import into Claude Code</a></div>`
                : ""
            }
            ${
              hasKey
                ? visitorKey
                  ? `<p class="hint" data-i18n="hint.visitor">This import uses a guest key for this browser. No account. The operator sees a guest id, not your name.</p>`
                  : `<p class="hint" data-i18n="hint.guest">This import uses the local guest key from carbon.toml. No account. Anyone with the key can open jobs on this gateway.</p>`
                : `<p class="hint" data-i18n="hint.nokey">No local guest key in carbon.toml. Sign in at /console and mint a user key.</p>`
            }
            <p class="hint" data-i18n="hint.cc">If Import does nothing, copy Base / Key / Model by hand. One URL and one key; /v1 is optional.</p>
          </div>
        </aside>
      </section>
      <div class="pills">
        <span class="pill"><i></i><span data-i18n="pill.hang">Hangs until a person replies</span></span>
        <span class="pill"><i></i><span data-i18n="pill.nov1">One URL, one key, any client</span></span>
        <span class="pill"><i></i><span data-i18n="pill.keys">Named keys identify the caller</span></span>
      </div>
      <section class="features">
        <article class="feat">
          <div class="icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg></div>
          <h3 data-i18n="f1.title">A person, packaged as a model</h3>
          <p data-i18n="f1.body">The gateway does not call any LLM. You read the full context on this machine and reply. Clients treat it like any other API.</p>
        </article>
        <article class="feat">
          <div class="icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"/></svg></div>
          <h3 data-i18n="f2.title">Anthropic and OpenAI, live</h3>
          <p data-i18n="f2.body">Anthropic Messages plus OpenAI Chat Completions and Responses. Codex and similar agents can point here.</p>
        </article>
        <article class="feat">
          <div class="icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"/></svg></div>
          <h3 data-i18n="f3.title">Console for humans</h3>
          <p data-i18n="f3.body">Sign in to reply on Sessions, mint named keys, and (if you are superadmin) manage users and site settings.</p>
        </article>
      </section>
      <section class="clients">
        <h2 data-i18n="clients.title">Talks to the clients you already use</h2>
        <p class="sub" data-i18n="clients.sub">Any agent that can set a custom base URL can point here.</p>
        <div class="chips">
          <span class="chip">Claude Code <span class="badge" data-i18n="live">live</span></span>
          <span class="chip">CC Switch <span class="badge" data-i18n="live">live</span></span>
          <span class="chip">Codex <span class="badge" data-i18n="live">live</span></span>
          <span class="chip"><span data-i18n="clients.openai">OpenAI-style</span> <span class="badge" data-i18n="live">live</span></span>
        </div>
      </section>
    </main>
    <footer>
      <span>© 2026 ${siteName}</span>
      <a href="https://github.com/flydog-ai/CarbonAI" rel="noreferrer">GitHub</a>
    </footer>
  </div>
  <div class="toast" id="toast"></div>
  <script>
    const I18N = {
      en: {
        "nav.console": "Console",
        kicker: "Human as a model API",
        lede: "No LLM behind this gateway. Agents send a request; a person on this machine reads the context and replies. Compatible clients see a normal model endpoint.",
        "cta.import": "Import into Claude Code",
        "cta.console": "Open console",
        "row.base": "Base URL",
        "row.model": "Model",
        "row.key": "Guest key",
        copy: "Copy",
        "loop.wait": "SSE hanging — waiting for a human",
        "loop.ok": "operator replies → stream completes",
        "hint.guest": "This import uses the local guest key from carbon.toml. No account. Anyone with the key can open jobs on this gateway.",
        "hint.visitor": "This import uses a guest key for this browser. No account. The operator sees a guest id, not your name.",
        "hint.nokey": "No local guest key in carbon.toml. Sign in at /console and mint a user key.",
        "hint.cc": "If Import does nothing, copy Base / Key / Model by hand. One URL and one key; /v1 is optional.",
        "pill.hang": "Hangs until a person replies",
        "pill.nov1": "One URL, one key, any client",
        "pill.keys": "Named keys identify the caller",
        "f1.title": "A person, packaged as a model",
        "f1.body": "The gateway does not call any LLM. You read the full context on this machine and reply. Clients treat it like any other API.",
        "f2.title": "One URL, any protocol",
        "f2.body": "The gateway reads the request and answers as Anthropic Messages, Chat Completions, or Responses. Same key either way.",
        "f3.title": "Console for humans",
        "f3.body": "Sign in to reply on Sessions, mint named keys, and (if you are superadmin) manage users and site settings.",
        "clients.title": "Talks to the clients you already use",
        "clients.sub": "Any agent that can set a custom base URL can point here.",
        "clients.openai": "OpenAI-style",
        live: "live",
        soon: "next",
        copied: "Copied",
        copyFailed: "Copy failed — select the text instead",
        "theme.light": "Light",
        "theme.dark": "Dark",
      },
      zh: {
        "nav.console": "控制台",
        kicker: "把人包装成模型 API",
        lede: "网关不调用任何 LLM。智能体把请求打过来，本机的人看完整上下文并亲手回复。对客户端来说，这就是一个普通模型接口。",
        "cta.import": "导入到 Claude Code",
        "cta.console": "打开控制台",
        "row.base": "接口地址",
        "row.model": "模型",
        "row.key": "匿名密钥",
        copy: "复制",
        "loop.wait": "SSE 挂起 — 等人回复",
        "loop.ok": "操作者回复 → 流结束",
        "hint.guest": "这一键导入用的是 carbon.toml 里的本地匿名密钥，不用登录。拿到这把 key 就能往本机网关丢任务。",
        "hint.visitor": "这一键导入用的是这台浏览器的匿名密钥，不用登录。操作者看到的是访客编号，不是你的名字。",
        "hint.nokey": "toml 里没有本地匿名密钥。到 /console 登录并签发用户密钥。",
        "hint.cc": "点了没反应：请手动抄地址、密钥、模型。一个地址一把密钥，/v1 可有可无。",
        "pill.hang": "一直挂到有人回复",
        "pill.nov1": "一个地址，一把密钥，任意客户端",
        "pill.keys": "记名密钥用来识别调用方",
        "f1.title": "把人包装成模型",
        "f1.body": "网关不调用任何 LLM。你在本机看完整上下文并亲手回复。客户端把它当成普通 API。",
        "f2.title": "一个地址，任意协议",
        "f2.body": "网关看请求体自动走 Anthropic Messages、Chat Completions 或 Responses。同一把密钥。",
        "f3.title": "给人用的控制台",
        "f3.body": "登录后在会话里回复、签发记名密钥。超级管理员还可以管用户和站点设置。",
        "clients.title": "接你已经在用的客户端",
        "clients.sub": "任何能自定义模型地址的智能体都可以指过来。",
        "clients.openai": "OpenAI 风格",
        live: "已上",
        soon: "接下来",
        copied: "已复制",
        copyFailed: "复制失败，请手动选中文本",
        "theme.light": "浅色",
        "theme.dark": "深色",
      }
    };
    function detectLang() {
      try {
        var s = localStorage.getItem("carbon-lang");
        if (s === "zh" || s === "en") return s;
      } catch (e) {}
      return String(navigator.language || "en").toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
    }
    function apply(lang) {
      document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
      document.documentElement.dataset.lang = lang;
      document.querySelectorAll("[data-i18n]").forEach(function (el) {
        var key = el.getAttribute("data-i18n");
        var text = (I18N[lang] && I18N[lang][key]) || I18N.en[key];
        if (text) el.textContent = text;
      });
      document.querySelectorAll("[data-set-lang]").forEach(function (btn) {
        btn.classList.toggle("on", btn.getAttribute("data-set-lang") === lang);
      });
      try { localStorage.setItem("carbon-lang", lang); } catch (e) {}
    }
    function applyTheme(theme) {
      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.style.colorScheme = theme;
      document.querySelectorAll("[data-set-theme]").forEach(function (btn) {
        btn.classList.toggle("on", btn.getAttribute("data-set-theme") === theme);
      });
      try { localStorage.setItem("carbon-theme", theme); } catch (e) {}
    }
    function detectTheme() {
      try {
        var s = localStorage.getItem("carbon-theme");
        if (s === "light" || s === "dark") return s;
      } catch (e) {}
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    function toast(msg) {
      var el = document.getElementById("toast");
      el.textContent = msg;
      el.classList.add("on");
      setTimeout(function () { el.classList.remove("on"); }, 1800);
    }
    document.querySelectorAll("[data-set-lang]").forEach(function (btn) {
      btn.addEventListener("click", function () { apply(btn.getAttribute("data-set-lang")); });
    });
    document.querySelectorAll("[data-set-theme]").forEach(function (btn) {
      btn.addEventListener("click", function () { applyTheme(btn.getAttribute("data-set-theme")); });
    });
    document.querySelectorAll("[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var lang = document.documentElement.dataset.lang || "en";
        var node = document.getElementById(btn.getAttribute("data-copy"));
        var text = node ? node.textContent : "";
        try {
          await navigator.clipboard.writeText(text);
          toast(I18N[lang].copied);
        } catch (e) {
          toast(I18N[lang].copyFailed);
        }
      });
    });
    apply(detectLang());
    applyTheme(detectTheme());
  </script>
</body>
</html>
`;
}
