export function renderAdminPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Admin · Carbon AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&family=Red+Hat+Mono:wght@400;500&family=Red+Hat+Text:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root { --bg:#16120e; --paper:#efe4cf; --ink:#1c160f; --brass:#c44914; --muted:#6d5e4c; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:"Red Hat Text","Songti SC",sans-serif; background:var(--bg); color:var(--paper); }
    main { max-width: 720px; margin: 40px auto; padding: 0 20px 64px; }
    table { width:100%; border-collapse: collapse; background:var(--paper); color:var(--ink); border-radius:12px; overflow:hidden; }
    th, td { text-align:left; padding:10px 12px; border-bottom:1px solid rgba(28,22,15,.1); font-size:14px; }
    th { font-family:"Red Hat Mono",monospace; font-size:11px; letter-spacing:.1em; text-transform:uppercase; }
    button { background:var(--brass); color:#fff7ed; border:0; padding:6px 10px; border-radius:4px; cursor:pointer; }
    .ghost { background:transparent; color:var(--ink); border:1px solid rgba(28,22,15,.25); }
    a { color:#e7c3a4; }
    h1 { font-family:Fraunces,serif; }
    .err { color:#f87171; }
  </style>
</head>
<body>
<main>
  <p><a href="/account">Account</a> · <a href="/ui">Desk</a></p>
  <h1>Users / 用户</h1>
  <p class="err" id="err"></p>
  <table><thead><tr><th>User</th><th>Role</th><th>Reply</th><th>Status</th><th></th></tr></thead><tbody id="rows"></tbody></table>
</main>
<script>
  async function api(path, opts={}) {
    const res = await fetch(path, { credentials:"same-origin", ...opts });
    const body = await res.json().catch(()=>({}));
    return { res, body };
  }
  async function load() {
    const { res, body } = await api("/api/admin/users");
    if (!res.ok) { document.getElementById("err").textContent = body.error || "forbidden — sign in as superadmin"; return; }
    document.getElementById("rows").innerHTML = body.users.map(u =>
      "<tr><td>"+u.username+"</td><td>"+u.role+"</td><td>"+(u.canReply?"yes":"no")+
      "</td><td>"+(u.disabled?"disabled":"active")+"</td><td>"+
      (u.role==="superadmin"?"":
        "<button data-id='"+u.id+"' data-k='canReply' data-v='"+(u.canReply?0:1)+"'>Toggle reply</button> "+
        "<button class='ghost' data-id='"+u.id+"' data-k='disabled' data-v='"+(u.disabled?0:1)+"'>"+(u.disabled?"Enable":"Disable")+"</button>"
      )+"</td></tr>"
    ).join("");
    document.querySelectorAll("button[data-id]").forEach(btn => {
      btn.onclick = async () => {
        const key = btn.dataset.k;
        const val = btn.dataset.v === "1";
        await api("/api/admin/users/"+btn.dataset.id, {
          method:"PATCH", headers:{ "content-type":"application/json" },
          body: JSON.stringify({ [key]: val })
        });
        load();
      };
    });
  }
  load();
</script>
</body>
</html>`;
}
