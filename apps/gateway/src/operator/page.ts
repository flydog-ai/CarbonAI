export function renderOperatorPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Operator desk · Carbon AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Red+Hat+Mono:wght@400;500;600&family=Red+Hat+Text:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #16120e;
      --panel: #1f1913;
      --paper: #efe4cf;
      --ink: #1c160f;
      --muted: #8a7b68;
      --brass: #c44914;
      --line: rgba(239, 228, 207, 0.12);
      --live: #d4a017;
      --ok: #6b8f5e;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; }
    body {
      font-family: "Red Hat Text", "Songti SC", sans-serif;
      background:
        radial-gradient(900px 500px at 0% 0%, #3a2418 0%, transparent 50%),
        var(--bg);
      color: var(--paper);
    }
    button, input, textarea { font: inherit; }
    .login {
      min-height: 100%;
      display: grid;
      place-items: center;
      padding: 32px;
    }
    .login card, .login .card {
      width: min(420px, 100%);
      background: var(--paper);
      color: var(--ink);
      padding: 28px;
      border-radius: 18px;
    }
    .kicker {
      font-family: "Red Hat Mono", ui-monospace, monospace;
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--brass);
      margin: 0 0 8px;
    }
    h1 { font-family: Fraunces, serif; font-size: 2rem; margin: 0 0 12px; }
    .sub { color: var(--muted); margin: 0 0 22px; line-height: 1.45; font-size: 14px; }
    label { display: block; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
    input, textarea {
      width: 100%;
      border: 1px solid rgba(28,22,15,0.18);
      background: #fffaf0;
      color: var(--ink);
      padding: 10px 12px;
      border-radius: 6px;
    }
    textarea { min-height: 120px; resize: vertical; }
    .btn {
      margin-top: 14px;
      background: var(--brass);
      color: #fff7ed;
      border: 0;
      padding: 10px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-family: Fraunces, serif;
      font-weight: 700;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .err { color: #9a3410; font-size: 13px; min-height: 1.2em; margin: 8px 0 0; }
    .desk { display: grid; grid-template-columns: 320px 1fr; height: 100%; }
    .inbox {
      border-right: 1px solid var(--line);
      overflow: auto;
      padding: 18px 14px;
    }
    .inbox h2 {
      font-family: "Red Hat Mono", ui-monospace, monospace;
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      margin: 0 14px 12px;
      color: var(--muted);
    }
    .job {
      display: block;
      width: 100%;
      text-align: left;
      background: transparent;
      border: 1px solid transparent;
      color: inherit;
      padding: 12px;
      border-radius: 10px;
      cursor: pointer;
      margin-bottom: 6px;
    }
    .job:hover, .job.on { background: rgba(239,228,207,0.06); border-color: var(--line); }
    .job .meta { font-family: "Red Hat Mono", ui-monospace, monospace; font-size: 11px; color: var(--muted); }
    .job .prev { margin: 6px 0 0; font-size: 13px; line-height: 1.35; }
    .pill { display: inline-block; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; padding: 2px 6px; border-radius: 999px; border: 1px solid var(--line); }
    .pill.pending, .pill.claimed, .pill.streaming { color: var(--live); border-color: var(--live); }
    .pill.completed { color: var(--ok); border-color: var(--ok); }
    .work { display: grid; grid-template-rows: auto 1fr auto; min-height: 0; }
    .work-head { padding: 16px 22px 10px; border-bottom: 1px solid var(--line); }
    .ctx { overflow: auto; padding: 16px 22px 24px; }
    .blk {
      background: rgba(239,228,207,0.05);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 10px;
    }
    .blk .who { font-family: "Red Hat Mono", ui-monospace, monospace; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
    .blk pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: "Red Hat Mono", ui-monospace, monospace; font-size: 12.5px; line-height: 1.45; }
    .blk.collapsed pre { max-height: 4.4em; overflow: hidden; opacity: 0.75; }
    .composer {
      border-top: 1px solid var(--line);
      padding: 14px 22px 18px;
      background: #1a1510;
    }
    .row { display: flex; gap: 12px; align-items: flex-end; }
    .ghost { background: transparent; color: var(--paper); border: 1px solid var(--line); }
    .empty { padding: 48px 24px; color: var(--muted); }
    @media (max-width: 860px) {
      .desk { grid-template-columns: 1fr; grid-template-rows: 40% 60%; }
    }
  </style>
</head>
<body>
  <div id="login" class="login">
    <form class="card" id="login-form">
      <p class="kicker">Carbon AI</p>
      <h1>Operator desk</h1>
      <p class="sub">Paste the operator token from the gateway log.<br>把网关日志里的 operator_token 贴进来。</p>
      <label for="token">Operator token</label>
      <input id="token" name="token" type="password" autocomplete="current-password" required>
      <p class="err" id="login-err"></p>
      <button class="btn" type="submit">Enter / 进入</button>
    </form>
  </div>
  <div id="desk" class="desk" hidden>
    <aside class="inbox">
      <h2>Inbox · 收件</h2>
      <div id="jobs"></div>
    </aside>
    <section class="work">
      <header class="work-head" id="head">
        <p class="kicker">Waiting / 等待选择</p>
        <h1 style="font-size:1.4rem;margin:0">Pick a job</h1>
      </header>
      <div class="ctx" id="ctx"><p class="empty">Live jobs appear here. 挂起的任务会出现在这里。</p></div>
      <footer class="composer">
        <div class="row">
          <textarea id="reply" placeholder="Reply as the model… / 以模型身份回复"></textarea>
          <div>
            <button class="btn" id="send" type="button">Send / 发送</button>
            <button class="btn ghost" id="cancel" type="button">Cancel / 取消</button>
          </div>
        </div>
        <p class="err" id="send-err" style="color:#e7c3a4"></p>
      </footer>
    </section>
  </div>
  <script>
    const $ = (id) => document.getElementById(id);
    let selected = null;
    let nextCursor = "0";
    let loadingMore = false;

    async function api(path, opts = {}) {
      const res = await fetch(path, { credentials: "same-origin", ...opts });
      const text = await res.text();
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
      return { res, body };
    }

    function pill(status) {
      return '<span class="pill ' + status + '">' + status + '</span>';
    }

    function renderJobs(jobs) {
      const live = jobs.filter((j) => j.status === "pending" || j.status === "claimed" || j.status === "streaming");
      const rest = jobs.filter((j) => !live.includes(j)).slice(0, 12);
      const rows = [...live, ...rest];
      $("jobs").innerHTML = rows.map((j) => {
        const wait = Math.round((j.waitMs || 0) / 1000) + "s";
        const prev = (j.lastUserPreview || "(no user text / 无用户文本)").replace(/[<>&]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
        return '<button class="job' + (selected === j.id ? ' on' : '') + '" data-id="' + j.id + '">'
          + '<div class="meta">' + pill(j.status) + ' ' + (j.displayModel || j.model) + ' · ' + wait + '</div>'
          + '<div class="prev">' + prev + '</div></button>';
      }).join("") || '<p class="empty">No jobs yet. 还没有任务。</p>';
      for (const btn of $("jobs").querySelectorAll(".job")) {
        btn.onclick = () => openJob(btn.dataset.id);
      }
    }

    async function refresh() {
      const { res, body } = await api("/api/operator/jobs");
      if (res.status === 401) {
        $("desk").hidden = true;
        $("login").hidden = false;
        return;
      }
      renderJobs(body.jobs || []);
    }

    function blkHtml(b) {
      const cls = b.collapsed ? "blk collapsed" : "blk";
      const who = b.role + (b.kind && b.kind !== "text" ? " · " + b.kind : "");
      const text = (b.excerpt || "").replace(/[<>&]/g, (c) => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
      return '<article class="' + cls + '"><div class="who">' + who + (b.truncated ? " · truncated" : "") + '</div><pre>' + text + '</pre></article>';
    }

    async function openJob(id, reset) {
      selected = id;
      if (reset !== false) {
        nextCursor = "0";
        $("ctx").innerHTML = "";
      }
      const meta = await api("/api/operator/jobs/" + id);
      if (!meta.res.ok) return;
      const j = meta.body;
      $("head").innerHTML = '<p class="kicker">' + j.id + '</p><h1 style="font-size:1.35rem;margin:0">' + pill(j.status) + ' ' + (j.displayModel || j.model) + '</h1>'
        + '<p class="sub" style="margin:8px 0 0">' + (j.toolNames || []).slice(0, 8).join(", ") + '</p>';
      const page = await api("/api/operator/jobs/" + id + "/context?cursor=" + encodeURIComponent(nextCursor) + "&limit=20");
      if (!page.res.ok) return;
      $("ctx").insertAdjacentHTML("beforeend", (page.body.blocks || []).map(blkHtml).join(""));
      nextCursor = page.body.nextCursor;
      if (page.body.hasMore) {
        const more = document.createElement("button");
        more.className = "btn ghost";
        more.textContent = "Load more / 继续";
        more.onclick = () => { more.remove(); openJob(id, false); };
        $("ctx").appendChild(more);
      }
      $("ctx").querySelectorAll(".blk.collapsed").forEach((el) => {
        el.onclick = () => el.classList.toggle("collapsed");
      });
      await refresh();
    }

    $("login-form").onsubmit = async (e) => {
      e.preventDefault();
      $("login-err").textContent = "";
      const { res, body } = await api("/api/operator/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: $("token").value }),
      });
      if (!res.ok) {
        $("login-err").textContent = body.error || "Login failed / 登录失败";
        return;
      }
      $("login").hidden = true;
      $("desk").hidden = false;
      await refresh();
    };

    $("send").onclick = async () => {
      $("send-err").textContent = "";
      if (!selected) { $("send-err").textContent = "Pick a job first. 先选一条任务。"; return; }
      const text = $("reply").value.trim();
      if (!text) return;
      $("send").disabled = true;
      const { res, body } = await api("/api/operator/jobs/" + selected + "/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      $("send").disabled = false;
      if (!res.ok) {
        $("send-err").textContent = body.error || "Send failed / 发送失败";
        return;
      }
      $("reply").value = "";
      await openJob(selected, true);
    };

    $("cancel").onclick = async () => {
      if (!selected) return;
      await api("/api/operator/jobs/" + selected + "/cancel", { method: "POST" });
      await refresh();
    };

    (async () => {
      const { res } = await api("/api/operator/session");
      if (res.ok) {
        $("login").hidden = true;
        $("desk").hidden = false;
        await refresh();
      }
      setInterval(refresh, 2000);
    })();
  </script>
</body>
</html>
`;
}
