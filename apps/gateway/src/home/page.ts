export type HomePageData = {
  href: string;
  endpoint: string;
  displayName: string;
  siteName?: string;
  siteNameZh?: string;
  model: string;
  apiKey: string;
  siteKey?: boolean;
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
  const siteKey = Boolean(data.siteKey);

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
    .panel-actions { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; }
    .panel-actions .btn { width: 100%; }
    .pills { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; max-width: 1120px; margin: 0 auto 36px; }
    .pill {
      display: inline-flex; align-items: center; gap: 8px;
      background: var(--card); border: 1px solid var(--line); border-radius: 999px;
      padding: 8px 14px; font-size: 13px; font-weight: 600; box-shadow: var(--shadow);
    }
    .pill i { width: 8px; height: 8px; border-radius: 999px; background: var(--primary); display: block; }
    .section { max-width: 1120px; margin: 0 auto 48px; }
    .section h2 { margin: 0 0 8px; font-size: 1.25rem; }
    .section .sub { margin: 0 0 18px; color: var(--muted); font-size: 14px; line-height: 1.55; }
    .specs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .spec {
      background: var(--card); border: 1px solid var(--line); border-radius: 14px;
      padding: 16px 18px; box-shadow: var(--shadow);
    }
    .spec .k { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
    html[data-lang="zh"] .spec .k { text-transform: none; letter-spacing: .04em; }
    .spec .v { font-size: 1.15rem; font-weight: 700; margin: 6px 0 4px; letter-spacing: -0.02em; }
    .spec .h { font-size: 12px; color: var(--muted); line-height: 1.45; }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .fit {
      background: var(--card); border: 1px solid var(--line); border-radius: 16px;
      padding: 20px; box-shadow: var(--shadow);
    }
    .fit h3 { margin: 0 0 12px; font-size: 15px; }
    .fit ul { margin: 0; padding: 0; list-style: none; }
    .fit li { padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 14px; line-height: 1.5; color: var(--ink); }
    .fit li:last-child { border-bottom: 0; }
    .fit.yes h3 { color: var(--ok); }
    .tabs { display: flex; gap: 6px; margin: 0 0 12px; }
    .tabs button {
      border: 1px solid var(--line); background: var(--card); color: var(--muted);
      border-radius: 999px; padding: 6px 12px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
    }
    .tabs button.on { background: var(--soft); color: var(--primary); border-color: transparent; }
    pre.code {
      margin: 0; background: var(--secret); color: var(--secret-ink); border-radius: 12px;
      padding: 14px 16px; font-family: "Red Hat Mono", ui-monospace, monospace; font-size: 12px;
      line-height: 1.65; overflow: auto; white-space: pre-wrap; word-break: break-all;
    }
    .code-head { display: flex; justify-content: flex-end; margin: 0 0 8px; }
    .steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .step {
      background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; box-shadow: var(--shadow);
    }
    .step b { display: block; font-size: 12px; color: var(--primary); margin-bottom: 8px; }
    .step p { margin: 0; font-size: 14px; line-height: 1.55; color: var(--muted); }
    .fine { font-size: 12px; color: var(--muted); line-height: 1.55; margin: 16px 0 0; }
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
      .hero, .features, .specs, .split, .steps { grid-template-columns: 1fr; }
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
          <p class="kicker" data-i18n="kicker">Carbon-certified inference</p>
          <h1>${siteName}</h1>
          <p class="lede" data-i18n="lede">A drop-in model endpoint. Anthropic Messages and OpenAI-compatible HTTP. Completions are attended: the stream stays open until the desk returns a result.</p>
          <div class="cta-row">
            <a class="btn btn-primary" href="#connect" data-i18n="cta.connect">Connect in three minutes</a>
            <a class="btn btn-secondary" href="/console" data-i18n="cta.console">Open console</a>
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
              <code class="mono" id="home-model">${model}</code>
              <span></span>
            </div>
            <div class="row">
              <span data-i18n="${siteKey ? "row.siteKey" : "row.key"}">${siteKey ? "Default key" : "Guest key"}</span>
              <code class="mono" id="home-key">${apiKey || "—"}</code>
              ${hasKey ? `<button class="btn btn-secondary btn-sm" type="button" data-copy="home-key" data-i18n="copy">Copy</button>` : `<span></span>`}
            </div>
            <div class="loop" aria-hidden="true">
              <div><span class="cmd">POST</span> /v1/messages</div>
              <div class="wait" data-i18n="loop.wait">SSE open — desk composing</div>
              <div class="ok" data-i18n="loop.ok">completion streamed on the same socket</div>
            </div>
            ${
              hasImport || hasKey
                ? `<div class="panel-actions">${
                    hasImport
                      ? `<a class="btn btn-primary" id="cc-switch-import" href="${href}" data-i18n="cta.import">Import into Claude Code</a>`
                      : ""
                  }${
                    hasKey
                      ? `<button class="btn btn-secondary" type="button" id="home-promo" data-i18n="cta.promo">Copy a share blurb</button>`
                      : ""
                  }</div>`
                : ""
            }
            ${
              hasKey
                ? siteKey
                  ? `<p class="hint" data-i18n="hint.siteKey">This is the operator's default key. Jobs land on the site desk. Sign in at /console to mint a key that lands on your own desk.</p>`
                  : `<p class="hint" data-i18n="hint.guest">This import uses the local guest key from carbon.toml. No account. Anyone with the key can open jobs on this gateway.</p>`
                : `<p class="hint" data-i18n="hint.nokey">No site default key yet. Sign in at /console to create the operator and mint a key.</p>`
            }
            <p class="hint" data-i18n="hint.cc">If Import does nothing, copy Base / Key / Model by hand. One URL and one key; /v1 is optional.</p>
          </div>
        </aside>
      </section>
      <div class="pills">
        <span class="pill"><i></i><span data-i18n="pill.hang">Attended completions</span></span>
        <span class="pill"><i></i><span data-i18n="pill.nov1">One URL, one key, dual protocols</span></span>
        <span class="pill"><i></i><span data-i18n="pill.keys">Caller identity on every job</span></span>
      </div>
      <section class="section" id="card">
        <h2 data-i18n="card.title">Model card</h2>
        <p class="sub" data-i18n="card.sub">Figures from the runtime, not a training paper. Measured at the desk this instance is bound to.</p>
        <div class="specs">
          <article class="spec"><div class="k" data-i18n="card.p.k">Parameters</div><div class="v" data-i18n="card.p.v">Undisclosed</div><div class="h" data-i18n="card.p.h">Carbon-scale. No public checkpoint on this hop.</div></article>
          <article class="spec"><div class="k" data-i18n="card.c.k">Context</div><div class="v" data-i18n="card.c.v">Session</div><div class="h" data-i18n="card.c.h">Full inbound window. Working memory at the desk.</div></article>
          <article class="spec"><div class="k" data-i18n="card.t.k">Throughput</div><div class="v" data-i18n="card.t.v">Interactive</div><div class="h" data-i18n="card.t.h">Tokens as they are composed. Not a batch race.</div></article>
          <article class="spec"><div class="k" data-i18n="card.r.k">Protocols</div><div class="v" data-i18n="card.r.v">Dual-stack</div><div class="h" data-i18n="card.r.h">Anthropic Messages, Chat Completions, Responses.</div></article>
          <article class="spec"><div class="k" data-i18n="card.a.k">Availability</div><div class="v" data-i18n="card.a.v">Attended</div><div class="h" data-i18n="card.a.h">High during desk hours. Streams hold with heartbeats.</div></article>
          <article class="spec"><div class="k" data-i18n="card.e.k">Energy</div><div class="v" data-i18n="card.e.v">Desk-scale</div><div class="h" data-i18n="card.e.h">No extra GPU cluster on this path.</div></article>
        </div>
      </section>
      <section class="section">
        <div class="split">
          <article class="fit yes">
            <h3 data-i18n="fit.yes">Suited for</h3>
            <ul>
              <li data-i18n="fit.y1">Payloads as sent — tools, traces, images the client actually attached</li>
              <li data-i18n="fit.y2">Saying when something is unknown instead of interpolating a stack</li>
              <li data-i18n="fit.y3">Replies that read like a colleague, not a brochure</li>
              <li data-i18n="fit.y4">Agents that can set a custom base URL and keep their SDK</li>
            </ul>
          </article>
          <article class="fit">
            <h3 data-i18n="fit.no">Not a fit</h3>
            <ul>
              <li data-i18n="fit.n1">Unattended 24×7 millisecond batch</li>
              <li data-i18n="fit.n2">Unbounded parallel completions</li>
              <li data-i18n="fit.n3">Racing a GPU on tokens per second</li>
            </ul>
          </article>
        </div>
      </section>
      <section class="section" id="connect">
        <h2 data-i18n="connect.title">Connect in three minutes</h2>
        <p class="sub" data-i18n="connect.sub">Point the base URL here. The rest of the client stays as-is. The guest key on this page is for trying the endpoint, not for production traffic.</p>
        <div class="tabs" role="tablist">
          <button type="button" class="on" data-tab="anthropic">Anthropic</button>
          <button type="button" data-tab="openai">OpenAI</button>
        </div>
        <div class="code-head"><button class="btn btn-secondary btn-sm" type="button" data-copy="curl-active" data-i18n="copy">Copy</button></div>
        <div data-pane="anthropic">
          <pre class="code" id="curl-anthropic">curl ${endpoint}/v1/messages \\
  -H "x-api-key: ${apiKey || "sk-carbon-…"}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{"model":"${model}","max_tokens":128,"stream":true,"messages":[{"role":"user","content":"ping"}]}'</pre>
        </div>
        <div data-pane="openai" hidden>
          <pre class="code" id="curl-openai">curl ${endpoint}/v1/chat/completions \\
  -H "Authorization: Bearer ${apiKey || "sk-carbon-…"}" \\
  -H "content-type: application/json" \\
  -d '{"model":"${model}","stream":true,"messages":[{"role":"user","content":"ping"}]}'</pre>
        </div>
      </section>
      <section class="section">
        <h2 data-i18n="how.title">How a completion returns</h2>
        <p class="sub" data-i18n="how.sub">Same socket. Same vendor envelope. The wait is the product.</p>
        <div class="steps">
          <article class="step"><b>01</b><p data-i18n="how.1">The client POSTs to /v1/messages, /v1/chat/completions, or /v1/responses.</p></article>
          <article class="step"><b>02</b><p data-i18n="how.2">The stream stays open. Heartbeats keep the connection through desk time.</p></article>
          <article class="step"><b>03</b><p data-i18n="how.3">The completion is written back in the protocol the client already speaks.</p></article>
        </div>
        <p class="fine" data-i18n="how.fine">Long waits stay on the wire; the job is not dropped. If the desk is away, the client still holds a real request.</p>
      </section>
      <section class="features">
        <article class="feat">
          <div class="icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg></div>
          <h3 data-i18n="f1.title">Attended inference</h3>
          <p data-i18n="f1.body">This hop does not sample a frozen checkpoint. Completions are composed at the desk and streamed when ready.</p>
        </article>
        <article class="feat">
          <div class="icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z"/></svg></div>
          <h3 data-i18n="f2.title">One URL, any protocol</h3>
          <p data-i18n="f2.body">The gateway reads the request and answers as Anthropic Messages, Chat Completions, or Responses. Same key either way.</p>
        </article>
        <article class="feat">
          <div class="icon"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"/></svg></div>
          <h3 data-i18n="f3.title">Operations console</h3>
          <p data-i18n="f3.body">Sign in to work the queue, mint named keys, and (if you are superadmin) manage users and site settings.</p>
        </article>
      </section>
      <section class="clients">
        <h2 data-i18n="clients.title">Works with the clients you already run</h2>
        <p class="sub" data-i18n="clients.sub">Any agent that can set a custom base URL can point here.</p>
        <div class="chips">
          <span class="chip">Claude Code <span class="badge" data-i18n="live">live</span></span>
          <span class="chip">CC Switch <span class="badge" data-i18n="live">live</span></span>
          <span class="chip">Codex <span class="badge" data-i18n="live">live</span></span>
          <span class="chip"><span data-i18n="clients.openai">OpenAI-style</span> <span class="badge" data-i18n="live">live</span></span>
        </div>
        <p class="fine" data-i18n="legal">Attended inference. Latency tracks desk availability. Not a stand-in for an unattended GPU cluster. Completions are not refundable; nudges are in-protocol.</p>
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
        kicker: "Carbon-certified inference",
        lede: "A drop-in model endpoint. Anthropic Messages and OpenAI-compatible HTTP. Completions are attended: the stream stays open until the desk returns a result.",
        "cta.import": "Import into Claude Code",
        "cta.console": "Open console",
        "cta.connect": "Connect in three minutes",
        "cta.promo": "Copy a share blurb",
        promo: "Found a limited-time, forever-free model API and token. Grab it and floor it.\\n\\nBase URL: {base}\\nKey: {key}\\nModel: {model}\\n\\nPoint your client here. OpenAI-compatible and Anthropic Messages. No SDK changes.",
        "row.base": "Base URL",
        "row.model": "Model",
        "row.key": "Guest key",
        "row.siteKey": "Default key",
        copy: "Copy",
        "loop.wait": "SSE open — desk composing",
        "loop.ok": "completion streamed on the same socket",
        "hint.guest": "This import uses the local guest key from carbon.toml. No account. Anyone with the key can open jobs on this gateway.",
        "hint.siteKey": "This is the operator's default key. Jobs land on the site desk. Sign in at /console to mint a key that lands on your own desk.",
        "hint.nokey": "No site default key yet. Sign in at /console to create the operator and mint a key.",
        "hint.cc": "If Import does nothing, copy Base / Key / Model by hand. One URL and one key; /v1 is optional.",
        "pill.hang": "Attended completions",
        "pill.nov1": "One URL, one key, dual protocols",
        "pill.keys": "Caller identity on every job",
        "card.title": "Model card",
        "card.sub": "Figures from the runtime, not a training paper. Measured at the desk this instance is bound to.",
        "card.p.k": "Parameters",
        "card.p.v": "Undisclosed",
        "card.p.h": "Carbon-scale. No public checkpoint on this hop.",
        "card.c.k": "Context",
        "card.c.v": "Session",
        "card.c.h": "Full inbound window. Working memory at the desk.",
        "card.t.k": "Throughput",
        "card.t.v": "Interactive",
        "card.t.h": "Tokens as they are composed. Not a batch race.",
        "card.r.k": "Protocols",
        "card.r.v": "Dual-stack",
        "card.r.h": "Anthropic Messages, Chat Completions, Responses.",
        "card.a.k": "Availability",
        "card.a.v": "Attended",
        "card.a.h": "High during desk hours. Streams hold with heartbeats.",
        "card.e.k": "Energy",
        "card.e.v": "Desk-scale",
        "card.e.h": "No extra GPU cluster on this path.",
        "fit.yes": "Suited for",
        "fit.no": "Not a fit",
        "fit.y1": "Payloads as sent — tools, traces, images the client actually attached",
        "fit.y2": "Saying when something is unknown instead of interpolating a stack",
        "fit.y3": "Replies that read like a colleague, not a brochure",
        "fit.y4": "Agents that can set a custom base URL and keep their SDK",
        "fit.n1": "Unattended 24×7 millisecond batch",
        "fit.n2": "Unbounded parallel completions",
        "fit.n3": "Racing a GPU on tokens per second",
        "connect.title": "Connect in three minutes",
        "connect.sub": "Point the base URL here. The rest of the client stays as-is. The key on this page is the site default. Sign in to mint a key that lands on your own desk.",
        "how.title": "How a completion returns",
        "how.sub": "Same socket. Same vendor envelope. The wait is the product.",
        "how.1": "The client POSTs to /v1/messages, /v1/chat/completions, or /v1/responses.",
        "how.2": "The stream stays open. Heartbeats keep the connection through desk time.",
        "how.3": "The completion is written back in the protocol the client already speaks.",
        "how.fine": "Long waits stay on the wire; the job is not dropped. If the desk is away, the client still holds a real request.",
        "f1.title": "Attended inference",
        "f1.body": "This hop does not sample a frozen checkpoint. Completions are composed at the desk and streamed when ready.",
        "f2.title": "One URL, any protocol",
        "f2.body": "The gateway reads the request and answers as Anthropic Messages, Chat Completions, or Responses. Same key either way.",
        "f3.title": "Operations console",
        "f3.body": "Sign in to work the queue, mint named keys, and (if you are superadmin) manage users and site settings.",
        "clients.title": "Works with the clients you already run",
        "clients.sub": "Any agent that can set a custom base URL can point here.",
        "clients.openai": "OpenAI-style",
        legal: "Attended inference. Latency tracks desk availability. Not a stand-in for an unattended GPU cluster. Completions are not refundable; nudges are in-protocol.",
        live: "live",
        soon: "next",
        copied: "Copied",
        copyFailed: "Copy failed — select the text instead",
        "theme.light": "Light",
        "theme.dark": "Dark",
      },
      zh: {
        "nav.console": "控制台",
        kicker: "碳基认证推理",
        lede: "即插即用的模型接口，兼容 Anthropic Messages 与 OpenAI HTTP。补全为值守推理：流会一直开着，直到工作台返回结果。",
        "cta.import": "导入到 Claude Code",
        "cta.console": "打开控制台",
        "cta.connect": "三分钟接入",
        "cta.promo": "复制推广文案",
        promo: "终于发现了一个限时免费、永久免费的 API 和 Token 地址，兄弟们抓紧时间，狠狠地开蹬！\\n\\n接口: {base}\\n密钥: {key}\\n模型: {model}\\n\\n改个 base_url 就能接，OpenAI / Anthropic 都行，SDK 不用动。",
        "row.base": "接口地址",
        "row.model": "模型",
        "row.key": "匿名密钥",
        "row.siteKey": "默认密钥",
        copy: "复制",
        "loop.wait": "SSE 保持 — 工作台正在生成",
        "loop.ok": "补全在同一条连接上回流",
        "hint.guest": "这一键导入用的是 carbon.toml 里的本地匿名密钥，不用登录。拿到这把 key 就能往本机网关丢任务。",
        "hint.siteKey": "这是站点默认密钥（管理员工作台的第一把有效密钥）。任务进站点工作台。到 /console 登录后签发的密钥，只会进你自己的会话，不会串号。",
        "hint.nokey": "还没有站点默认密钥。到 /console 创建管理员并签发一把密钥。",
        "hint.cc": "点了没反应：请手动抄地址、密钥、模型。一个地址一把密钥，/v1 可有可无。",
        "pill.hang": "值守补全",
        "pill.nov1": "一个地址，一把密钥，双协议",
        "pill.keys": "每个任务带调用方身份",
        "card.title": "模型卡",
        "card.sub": "来自运行时的实测，不是训练论文。测点：本实例绑定的工作台。",
        "card.p.k": "参数量",
        "card.p.v": "未公开",
        "card.p.h": "碳基规模。这一跳没有可下载的权重文件。",
        "card.c.k": "上下文",
        "card.c.v": "会话",
        "card.c.h": "完整入站窗口。工作记忆在工作台。",
        "card.t.k": "吞吐",
        "card.t.v": "交互式",
        "card.t.h": "边写边出 token。不是批次竞速。",
        "card.r.k": "协议",
        "card.r.v": "双栈",
        "card.r.h": "Anthropic Messages、Chat Completions、Responses。",
        "card.a.k": "可用率",
        "card.a.v": "值守",
        "card.a.h": "工作时段内高可用。流用心跳撑住思考时间。",
        "card.e.k": "能耗",
        "card.e.v": "工位级",
        "card.e.h": "这条路径上不再叠一层 GPU 集群。",
        "fit.yes": "适合",
        "fit.no": "不适合",
        "fit.y1": "按实际载荷处理：工具、轨迹、客户端真正附上的图",
        "fit.y2": "不知道就说不知道，而不是补一段听起来很完整的栈",
        "fit.y3": "回复像同事，不像宣传册",
        "fit.y4": "能自定义模型地址、不必改 SDK 的智能体",
        "fit.n1": "无人值守的 7×24 毫秒级批处理",
        "fit.n2": "无上限并行补全",
        "fit.n3": "和 GPU 比 token/s",
        "connect.title": "三分钟接入",
        "connect.sub": "把 base URL 指过来，客户端其余部分不用动。本页是站点默认密钥。登录后签发的密钥只会进你自己的会话。",
        "how.title": "补全怎么回来",
        "how.sub": "同一条连接。同一套厂商信封。等待本身就是产品。",
        "how.1": "客户端 POST 到 /v1/messages、/v1/chat/completions 或 /v1/responses。",
        "how.2": "流保持打开。心跳撑过工作台时间。",
        "how.3": "补全按客户端已经在用的协议写回去。",
        "how.fine": "长等待留在链路上，任务不会被丢掉。工作台不在时，客户端仍然握着一次真实请求。",
        "f1.title": "值守推理",
        "f1.body": "这一跳不从冻结的权重文件里采样。补全在工作台生成，就绪后回流。",
        "f2.title": "一个地址，任意协议",
        "f2.body": "网关看请求体自动走 Anthropic Messages、Chat Completions 或 Responses。同一把密钥。",
        "f3.title": "运行控制台",
        "f3.body": "登录后处理队列、签发记名密钥。超级管理员还可以管用户和站点设置。",
        "clients.title": "接你已经在跑的客户端",
        "clients.sub": "任何能自定义模型地址的智能体都可以指过来。",
        "clients.openai": "OpenAI 风格",
        legal: "值守推理。时延随工作台可用性变化。不能替代无人值守的 GPU 集群。补全不退款；催促走协议内重试。",
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
        var id = btn.getAttribute("data-copy");
        var node = id === "curl-active"
          ? document.querySelector("[data-pane]:not([hidden]) .code")
          : document.getElementById(id);
        var text = node ? node.textContent : "";
        try {
          await navigator.clipboard.writeText(text);
          toast(I18N[lang].copied);
        } catch (e) {
          toast(I18N[lang].copyFailed);
        }
      });
    });
    var promoBtn = document.getElementById("home-promo");
    if (promoBtn) {
      promoBtn.addEventListener("click", async function () {
        var lang = document.documentElement.dataset.lang || "en";
        var tpl = (I18N[lang] && I18N[lang].promo) || I18N.en.promo;
        var text = tpl
          .replace("{base}", (document.getElementById("home-endpoint") || {}).textContent || "")
          .replace("{key}", (document.getElementById("home-key") || {}).textContent || "")
          .replace("{model}", (document.getElementById("home-model") || {}).textContent || "");
        try {
          await navigator.clipboard.writeText(text);
          toast(I18N[lang].copied);
        } catch (e) {
          toast(I18N[lang].copyFailed);
        }
      });
    }
    document.querySelectorAll("[data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-tab");
        document.querySelectorAll("[data-tab]").forEach(function (b) {
          b.classList.toggle("on", b === btn);
        });
        document.querySelectorAll("[data-pane]").forEach(function (p) {
          p.hidden = p.getAttribute("data-pane") !== id;
        });
      });
    });
    apply(detectLang());
    applyTheme(detectTheme());
  </script>
</body>
</html>
`;
}
