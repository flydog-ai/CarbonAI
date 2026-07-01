export type HomePageData = {
  href: string;
  endpoint: string;
  displayName: string;
  model: string;
  apiKey: string;
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
  const model = escapeHtml(data.model);
  const apiKey = escapeHtml(data.apiKey);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${displayName} · 碳基智能</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23c44914'/%3E%3Ctext x='16' y='22' text-anchor='middle' font-size='15' fill='%23f1e6d0' font-family='Georgia,serif'%3EC%3C/text%3E%3C/svg%3E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Red+Hat+Mono:wght@400;600&family=Red+Hat+Text:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #1a1612;
      --bg-2: #241c16;
      --paper: #f1e6d0;
      --paper-2: #e4d4b8;
      --ink: #1f1812;
      --muted: #6d5e4c;
      --brass: #c44914;
      --brass-2: #9a3410;
      --rule: rgba(31, 24, 18, 0.14);
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; }
    body {
      font-family: "Red Hat Text", "Songti SC", serif;
      color: var(--paper);
      background:
        radial-gradient(1200px 700px at 12% -10%, #3a2a1c 0%, transparent 55%),
        radial-gradient(900px 500px at 110% 20%, #3d1c12 0%, transparent 50%),
        var(--bg);
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: 0.07;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
    }
    main {
      position: relative;
      display: grid;
      grid-template-columns: 1fr minmax(280px, 420px);
      gap: 48px;
      align-items: center;
      min-height: 100vh;
      padding: 48px 7vw;
    }
    .mast {
      max-width: 22ch;
    }
    .kicker {
      font-family: "Red Hat Mono", ui-monospace, monospace;
      font-size: 12px;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: #d9b38c;
      margin: 0 0 18px;
    }
    h1 {
      font-family: Fraunces, "Songti SC", serif;
      font-weight: 700;
      font-size: clamp(3.4rem, 11vw, 6.2rem);
      line-height: 0.9;
      letter-spacing: -0.05em;
      margin: 0 0 20px;
      font-optical-sizing: auto;
    }
    h1 em {
      font-style: italic;
      font-weight: 500;
      color: #e7c3a4;
    }
    .lede {
      margin: 0 0 10px;
      font-size: 1.15rem;
      line-height: 1.5;
      color: #d7c4ad;
      max-width: 36ch;
    }
    .ticket {
      position: relative;
      background: linear-gradient(180deg, var(--paper) 0%, var(--paper-2) 100%);
      color: var(--ink);
      border-radius: 18px;
      padding: 28px 28px 24px 32px;
      box-shadow:
        0 30px 60px rgba(0, 0, 0, 0.35),
        inset 0 1px 0 rgba(255, 255, 255, 0.55);
    }
    .ticket::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 9px;
      border-radius: 18px 0 0 18px;
      background: repeating-linear-gradient(
        180deg,
        var(--brass) 0 11px,
        transparent 11px 18px
      );
    }
    .ticket-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 1px dashed var(--rule);
      padding-bottom: 14px;
      margin-bottom: 18px;
    }
    .ticket-head strong {
      font-family: Fraunces, serif;
      font-size: 1.35rem;
    }
    .stamp {
      font-family: "Red Hat Mono", ui-monospace, monospace;
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      border: 1.5px solid var(--brass);
      color: var(--brass);
      padding: 4px 8px;
      transform: rotate(-6deg);
    }
    dl {
      margin: 0 0 22px;
      display: grid;
      grid-template-columns: 76px 1fr;
      gap: 8px 12px;
      font-size: 13px;
    }
    dt {
      font-family: "Red Hat Mono", ui-monospace, monospace;
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
      padding-top: 2px;
    }
    dd {
      margin: 0;
      font-family: "Red Hat Mono", ui-monospace, monospace;
      word-break: break-all;
    }
    .cta {
      display: block;
      text-align: center;
      text-decoration: none;
      background: var(--brass);
      color: #fff7ed;
      font-family: Fraunces, serif;
      font-weight: 700;
      font-size: 1.2rem;
      padding: 14px 16px 16px;
      border-radius: 4px;
      box-shadow: 0 8px 0 var(--brass-2);
      transform: translateY(-2px);
    }
    .cta:hover { filter: brightness(1.05); }
    .cta:active {
      transform: translateY(4px);
      box-shadow: 0 2px 0 var(--brass-2);
    }
    .cta small {
      display: block;
      font-family: "Red Hat Mono", ui-monospace, monospace;
      font-size: 10px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      opacity: 0.85;
      margin-top: 4px;
      font-weight: 600;
    }
    .hint {
      margin: 14px 0 0;
      font-size: 12px;
      color: var(--muted);
      line-height: 1.45;
    }
    .hint a { color: var(--brass-2); }
    @media (max-width: 860px) {
      main {
        grid-template-columns: 1fr;
        align-content: start;
        padding: 36px 20px 48px;
        gap: 28px;
      }
      h1 { font-size: clamp(2.8rem, 16vw, 4.2rem); }
      .ticket { border-radius: 18px; padding-left: 28px; }
      .ticket::before { display: none; }
    }
  </style>
</head>
<body>
  <main>
    <section class="mast">
      <p class="kicker">Carbon AI · 碳基智能</p>
      <h1>Carbon AI</h1>
      <p class="lede">No API, no token, idle agents. Package yourself as a model and show up in anyone's client list.</p>
      <p class="lede">没有可用的 API 和 Token，智能体闲着。把自己打包成模型，出现在任何人的客户端列表里。</p>
    </section>
    <aside class="ticket" aria-label="导入到 Claude Code">
      <div class="ticket-head">
        <strong>${displayName}</strong>
        <span class="stamp">Claude Code</span>
      </div>
      <dl>
        <dt>Base</dt>
        <dd>${endpoint}</dd>
        <dt>Model</dt>
        <dd>${model}</dd>
        <dt>Key</dt>
        <dd>${apiKey}</dd>
      </dl>
      <a class="cta" id="cc-switch-import" href="${href}">
        Import into Claude Code
        <small>导入到 Claude Code · CC Switch</small>
      </a>
      <p class="hint">
        Requires <a href="https://ccswitch.io" rel="noreferrer">CC Switch</a>. Base URL has no <code>/v1</code>. Confirm the import in CC Switch.
      </p>
      <p class="hint">
        需已安装 <a href="https://ccswitch.io" rel="noreferrer">CC Switch</a>。
        地址不含 <code>/v1</code>。点按钮后在 CC Switch 里确认导入。
      </p>
    </aside>
  </main>
</body>
</html>
`;
}
