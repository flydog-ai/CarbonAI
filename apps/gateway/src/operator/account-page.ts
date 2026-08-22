export function renderAccountPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Account · Carbon AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&family=Red+Hat+Mono:wght@400;500&family=Red+Hat+Text:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root { --bg:#16120e; --paper:#efe4cf; --ink:#1c160f; --brass:#c44914; --muted:#6d5e4c; }
    * { box-sizing: border-box; }
    body { margin:0; font-family:"Red Hat Text","Songti SC",sans-serif; background:radial-gradient(800px 400px at 10% 0,#3a2418,transparent),var(--bg); color:var(--paper); }
    main { max-width: 560px; margin: 48px auto; padding: 0 20px 64px; }
    .card { background:var(--paper); color:var(--ink); border-radius:18px; padding:28px; margin-bottom:16px; }
    h1 { font-family:Fraunces,serif; margin:0 0 8px; }
    .kicker { font-family:"Red Hat Mono",monospace; font-size:11px; letter-spacing:.18em; text-transform:uppercase; color:var(--brass); }
    label { display:block; font-size:12px; letter-spacing:.08em; text-transform:uppercase; margin:12px 0 6px; }
    input { width:100%; padding:10px 12px; border-radius:6px; border:1px solid rgba(28,22,15,.18); background:#fffaf0; }
    button { margin-top:12px; background:var(--brass); color:#fff7ed; border:0; padding:10px 16px; border-radius:4px; font-family:Fraunces,serif; font-weight:700; cursor:pointer; }
    .ghost { background:transparent; color:var(--ink); border:1px solid rgba(28,22,15,.2); }
    .err { color:#9a3410; min-height:1.2em; font-size:13px; }
    .ok { color:#3f6b38; font-size:13px; }
    code, pre { font-family:"Red Hat Mono",monospace; font-size:12px; word-break:break-all; }
    .key { background:#fffaf0; padding:8px 10px; border-radius:6px; margin:6px 0; }
    a { color:var(--brass); }
    .sub { color:var(--muted); font-size:14px; line-height:1.45; }
  </style>
</head>
<body>
<main>
  <p class="kicker">Carbon AI</p>
  <h1>Account / 账号</h1>
  <p class="sub">Register to get an API key. Sign in to mint or revoke keys.<br>注册即获得一把 API key。登录后可再签发或作废。</p>
  <div id="gate" class="card">
    <form id="reg">
      <label>Username</label><input name="username" required minlength="3" maxlength="32">
      <label>Password</label><input name="password" type="password" required minlength="8">
      <p class="err" id="err"></p>
      <button type="submit">Register / 注册</button>
      <button type="button" class="ghost" id="login-btn">Sign in / 登录</button>
    </form>
  </div>
  <div id="me" class="card" hidden>
    <p id="who"></p>
    <p><a href="/ui">Operator desk / 操作台</a> · <a href="/admin">Admin / 管理</a></p>
    <p class="ok" id="secret"></p>
    <h2 style="font-family:Fraunces,serif;font-size:1.2rem">API keys</h2>
    <div id="keys"></div>
    <button type="button" id="mint">New key / 新 key</button>
    <button type="button" class="ghost" id="out">Sign out / 退出</button>
  </div>
</main>
<script>
  const $ = (id) => document.getElementById(id);
  async function api(path, opts={}) {
    const res = await fetch(path, { credentials:"same-origin", ...opts });
    const body = await res.json().catch(() => ({}));
    return { res, body };
  }
  async function showMe() {
    const { res, body } = await api("/api/me");
    if (!res.ok) { $("gate").hidden = false; $("me").hidden = true; return; }
    $("gate").hidden = true; $("me").hidden = false;
    $("who").textContent = body.user.username + " · " + body.user.role + (body.user.canReply ? " · replier" : "");
    const keys = await api("/api/me/keys");
    $("keys").innerHTML = (keys.body.keys||[]).map(k =>
      '<div class="key"><code>'+k.prefix+'</code> '+k.label+(k.revoked?' (revoked)':'')+
      (k.revoked?'':' <button data-id="'+k.id+'" class="ghost" style="margin:0 0 0 8px">Revoke</button>')+'</div>'
    ).join("") || "<p>No keys.</p>";
    $("keys").querySelectorAll("button[data-id]").forEach(btn => {
      btn.onclick = async () => { await api("/api/me/keys/"+btn.dataset.id+"/revoke", { method:"POST" }); showMe(); };
    });
  }
  async function submit(register) {
    $("err").textContent = "";
    const fd = new FormData($("reg"));
    const { res, body } = await api(register ? "/api/auth/register" : "/api/auth/login", {
      method:"POST", headers:{ "content-type":"application/json" },
      body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") })
    });
    if (!res.ok) { $("err").textContent = body.error || "failed"; return; }
    if (body.apiKey) $("secret").textContent = "Save this key, shown once / 请保存，只显示一次: " + body.apiKey;
    else $("secret").textContent = "";
    await showMe();
  }
  $("reg").onsubmit = (e) => { e.preventDefault(); submit(true); };
  $("login-btn").onclick = () => submit(false);
  $("out").onclick = async () => { await api("/api/auth/logout", { method:"POST" }); location.reload(); };
  $("mint").onclick = async () => {
    const { res, body } = await api("/api/me/keys", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify({ label: "key" }) });
    if (res.ok) $("secret").textContent = "New key / 新 key: " + body.apiKey;
    await showMe();
  };
  showMe();
</script>
</body>
</html>`;
}
