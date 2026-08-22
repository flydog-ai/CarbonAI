import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorKey, jsonBody } from "./api.ts";
import {
  IconChat,
  IconCog,
  IconCollapse,
  IconCopy,
  IconGrid,
  IconImport,
  IconKey,
  IconTrash,
  IconUsers,
  LangSwitch,
  Modal,
  Pill,
} from "./components.tsx";
import { detectLang, translate } from "./i18n.ts";
import { copyText, fmtWhen, groupThreads, isLive, readView, secretPrefix, setViewUrl } from "./lib.ts";
import type { ApiKey, ConnectInfo, ContextBlock, ContextPage, GuestKey, Job, Lang, SiteSettings, User, View } from "./types.ts";

type Gate = "boot" | "setup" | "login" | "app";

export function App() {
  const [lang, setLangState] = useState<Lang>(detectLang);
  const [gate, setGate] = useState<Gate>("boot");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>(readView);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("carbon-sb") === "1");
  const [sbOpen, setSbOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [connect, setConnect] = useState<ConnectInfo | null>(null);
  const [brand, setBrand] = useState("Carbon AI");
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const t = useCallback((key: string, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);

  const isAdmin = user?.role === "superadmin";
  const canDesk = Boolean(user?.canReply);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.body.dataset.lang = lang;
    document.title = t("docTitle");
  }, [lang, t]);

  useEffect(() => {
    void (async () => {
      const s = await api<{ name?: string }>("/api/site");
      if (s.res.ok && s.body.name) setBrand(s.body.name);
    })();
    void boot();
  }, []);

  async function boot(secret?: string) {
    const setup = await api<{ needsSetup?: boolean }>("/api/setup/status");
    if (setup.res.ok && setup.body.needsSetup) {
      setGate("setup");
      return;
    }
    const me = await api<{ user?: User }>("/api/me");
    const u = me.res.ok ? me.body.user : null;
    if (!u) {
      setGate("login");
      return;
    }
    setUser(u);
    const conn = await api<ConnectInfo>("/api/me/connect");
    if (conn.res.ok) {
      setConnect(conn.body);
      if (conn.body.siteName) setBrand(conn.body.siteName);
    }
    if (secret) rememberSecret(secret);
    const next = readView();
    const allowed = (next === "users" || next === "settings") && u.role !== "superadmin" ? "home" : next;
    setView(allowed);
    setViewUrl(allowed);
    setGate("app");
  }

  function rememberSecret(secret: string, meta?: { id?: string; prefix?: string }) {
    setSecrets((prev) => {
      const next = { ...prev };
      if (meta?.id) next[meta.id] = secret;
      const prefix = meta?.prefix || secretPrefix(secret);
      next[prefix] = secret;
      next.__latest = secret;
      return next;
    });
  }

  function secretFor(k: ApiKey): string {
    return secrets[k.id] || secrets[k.prefix] || "";
  }

  function go(next: View) {
    const allowed = (next === "users" || next === "settings") && user?.role !== "superadmin" ? "home" : next;
    setView(allowed);
    setViewUrl(allowed);
    setSbOpen(false);
  }

  function changeLang(next: Lang) {
    setLangState(next);
    localStorage.setItem("carbon-lang", next);
  }

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  }

  async function copy(text: string, ok: string) {
    flash((await copyText(text)) ? ok : t("keys.copyFailed"));
  }

  const statusLabel = (s: string) => {
    const sk = `status.${s}`;
    const rk = `role.${s}`;
    const a = t(sk);
    if (a !== sk) return a;
    const b = t(rk);
    return b !== rk ? b : s;
  };

  if (gate === "boot") return null;
  if (gate === "setup") return <Setup t={t} lang={lang} brand={brand} onLang={changeLang} onDone={(s) => void boot(s)} />;
  if (gate === "login") {
    return (
      <Login
        t={t}
        lang={lang}
        brand={brand}
        onLang={changeLang}
        mode={authMode}
        setMode={setAuthMode}
        onDone={(s) => void boot(s)}
      />
    );
  }
  if (!user) return null;

  const shellClass = `shell${collapsed ? " collapsed" : ""}${sbOpen ? " sb-open" : ""}`;

  return (
    <div className={shellClass} onClick={() => setMenuOpen(false)}>
      {sbOpen ? <div className="overlay" onClick={() => setSbOpen(false)} /> : null}
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">C</span>
          <div className="brand-text">
            <strong>{brand}</strong>
            <small>{t("brand.sub")}</small>
          </div>
        </div>
        <nav className="nav">
          {!isAdmin ? (
            <button type="button" className={`nav-btn${view === "home" ? " on" : ""}`} onClick={() => go("home")}>
              <IconGrid />
              <span className="nav-text">{t("nav.overview")}</span>
            </button>
          ) : null}
          {isAdmin ? (
            <div>
              <div className="nav-label">{t("nav.admin")}</div>
              <button type="button" className={`nav-btn${view === "home" ? " on" : ""}`} onClick={() => go("home")}>
                <IconGrid />
                <span className="nav-text">{t("nav.overview")}</span>
              </button>
              <button type="button" className={`nav-btn${view === "users" ? " on" : ""}`} onClick={() => go("users")}>
                <IconUsers />
                <span className="nav-text">{t("nav.users")}</span>
              </button>
              <button type="button" className={`nav-btn${view === "settings" ? " on" : ""}`} onClick={() => go("settings")}>
                <IconCog />
                <span className="nav-text">{t("nav.settings")}</span>
              </button>
            </div>
          ) : null}
          {canDesk ? (
            <div>
              <div className="nav-label">{t("nav.operate")}</div>
              <button type="button" className={`nav-btn${view === "desk" ? " on" : ""}`} onClick={() => go("desk")}>
                <IconChat />
                <span className="nav-text">{t("nav.sessions")}</span>
              </button>
            </div>
          ) : null}
          <div>
            <div className="nav-label">{t(isAdmin ? "nav.myAccount" : "nav.account")}</div>
            <button type="button" className={`nav-btn${view === "keys" ? " on" : ""}`} onClick={() => go("keys")}>
              <IconKey />
              <span className="nav-text">{t("nav.keys")}</span>
            </button>
          </div>
        </nav>
        <div className="foot">
          <button
            type="button"
            className="nav-btn"
            onClick={() => {
              const next = !collapsed;
              setCollapsed(next);
              localStorage.setItem("carbon-sb", next ? "1" : "0");
            }}
          >
            <IconCollapse />
            <span className="nav-text">{t(collapsed ? "nav.expand" : "nav.collapse")}</span>
          </button>
        </div>
      </aside>
      <section className="main">
        <header className="header">
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <button type="button" className="btn btn-secondary btn-sm burger" onClick={() => setSbOpen(true)}>
              ☰
            </button>
            <div>
              <h2>{t(`view.${view}.title`)}</h2>
              <p className="desc">{t(`view.${view}.desc`)}</p>
            </div>
          </div>
          <div className="header-right">
            <LangSwitch lang={lang} onChange={changeLang} />
            <div className="who-wrap">
              <button
                type="button"
                className="who-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
              >
                <span className="avatar">{(user.username[0] || "?").toUpperCase()}</span>
                <span className="who-meta">
                  <b>{user.username}</b>
                  <span>
                    {t(`role.${user.role}`)}
                    {canDesk ? ` · ${t("role.reply")}` : ""}
                  </span>
                </span>
              </button>
              {menuOpen ? (
                <div className="menu">
                  <a href="/">{t("menu.home")}</a>
                  <button
                    type="button"
                    onClick={async () => {
                      await api("/api/auth/logout", { method: "POST" });
                      location.href = "/console";
                    }}
                  >
                    {t("menu.signOut")}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <div className={`content${view === "desk" && canDesk ? " bleed" : ""}`}>
          {view === "home" ? (
            <Overview t={t} isAdmin={isAdmin} canDesk={canDesk} user={user} connect={connect} go={go} copy={copy} statusLabel={statusLabel} />
          ) : null}
          {view === "desk" ? <Sessions t={t} canDesk={canDesk} statusLabel={statusLabel} /> : null}
          {view === "keys" ? (
            <Keys t={t} connect={connect} secretFor={secretFor} rememberSecret={rememberSecret} copy={copy} flash={flash} statusLabel={statusLabel} />
          ) : null}
          {view === "users" && isAdmin ? <Users t={t} statusLabel={statusLabel} /> : null}
          {view === "settings" && isAdmin ? <Settings t={t} flash={flash} onSite={setBrand} /> : null}
        </div>
      </section>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function Setup({
  t,
  lang,
  brand,
  onLang,
  onDone,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  lang: Lang;
  brand: string;
  onLang: (l: Lang) => void;
  onDone: (secret?: string) => void;
}) {
  const [err, setErr] = useState("");
  return (
    <div className="gate">
      <div className="lang-bar">
        <LangSwitch lang={lang} onChange={onLang} />
      </div>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const username = String(fd.get("username") || "").trim();
          const password = String(fd.get("password") || "");
          const confirm = String(fd.get("confirm") || "");
          if (password !== confirm) {
            setErr(t("err.mismatch"));
            return;
          }
          const { res, body } = await api<{ error?: string; apiKey?: string }>("/api/setup", jsonBody({ username, password }));
          if (!res.ok) {
            setErr(errorKey(body.error) ? t(errorKey(body.error)!) : body.error || t("err.setupFailed"));
            return;
          }
          onDone(body.apiKey);
        }}
      >
        <div className="mark lg">C</div>
        <p className="brand-name">{brand}</p>
        <h1 style={{ textAlign: "center" }}>{t("setup.title")}</h1>
        <p className="sub" style={{ textAlign: "center" }}>{t("setup.sub")}</p>
        <label>{t("field.username")}</label>
        <input name="username" defaultValue="admin" autoComplete="username" required minLength={3} maxLength={32} />
        <label>{t("field.password")}</label>
        <input name="password" type="password" autoComplete="new-password" required minLength={8} />
        <label>{t("field.confirm")}</label>
        <input name="confirm" type="password" autoComplete="new-password" required minLength={8} />
        <p className="err">{err}</p>
        <button className="btn btn-wide" type="submit">{t("setup.submit")}</button>
      </form>
      <p className="copy">{t("copyright")}</p>
    </div>
  );
}

function Login({
  t,
  lang,
  brand,
  onLang,
  mode,
  setMode,
  onDone,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  lang: Lang;
  brand: string;
  onLang: (l: Lang) => void;
  mode: "login" | "register";
  setMode: (m: "login" | "register") => void;
  onDone: (secret?: string) => void;
}) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="gate">
      <div className="lang-bar">
        <LangSwitch lang={lang} onChange={onLang} />
      </div>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const username = String(fd.get("username") || "").trim();
          const password = String(fd.get("password") || "");
          if (!username || password.length < 8) {
            setErr(t("err.needUserPass"));
            return;
          }
          setBusy(true);
          setErr("");
          const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
          const { res, body } = await api<{ error?: string; apiKey?: string }>(path, jsonBody({ username, password }));
          setBusy(false);
          if (!res.ok) {
            setErr(errorKey(body.error) ? t(errorKey(body.error)!) : body.error || t("err.loginFailed"));
            return;
          }
          const me = await api("/api/me");
          if (!me.res.ok) {
            setErr(t("err.cookie"));
            return;
          }
          onDone(body.apiKey);
        }}
      >
        <div className="mark lg">C</div>
        <p className="brand-name">{brand}</p>
        <h1 style={{ textAlign: "center" }}>{t(mode === "register" ? "register.title" : "login.title")}</h1>
        <p className="sub" style={{ textAlign: "center" }}>{t(mode === "register" ? "register.sub" : "login.sub")}</p>
        <label>{t("field.username")}</label>
        <input name="username" autoComplete="username" required minLength={3} maxLength={32} />
        <label>{t("field.password")}</label>
        <input name="password" type="password" autoComplete="current-password" required minLength={8} />
        <p className="err">{err}</p>
        <button className="btn btn-wide" type="submit" disabled={busy}>
          {busy ? t(mode === "register" ? "creating" : "signingIn") : t(mode === "register" ? "register.title" : "signin")}
        </button>
        <p className="foot">
          {mode === "register" ? t("hasAccount") : t("noAccount")}{" "}
          <button type="button" className="btn-ghost" style={{ color: "var(--primary)", fontWeight: 600 }} onClick={() => setMode(mode === "register" ? "login" : "register")}>
            {mode === "register" ? t("signin") : t("createOne")}
          </button>
        </p>
      </form>
      <p className="copy">
        <a href="/" style={{ color: "#9ca3af" }}>{t("backHome")}</a>
        <br />
        {t("copyright")}
      </p>
    </div>
  );
}

function Overview({
  t,
  isAdmin,
  canDesk,
  user,
  connect,
  go,
  copy,
  statusLabel,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  isAdmin: boolean;
  canDesk: boolean;
  user: User;
  connect: ConnectInfo | null;
  go: (v: View) => void;
  copy: (text: string, ok: string) => void;
  statusLabel: (s: string) => string;
}) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [guest, setGuest] = useState<GuestKey[]>([]);
  const [guestLoaded, setGuestLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const k = await api<{ keys?: ApiKey[] }>("/api/me/keys");
      if (k.res.ok) setKeys(k.body.keys || []);
      if (canDesk) {
        const j = await api<{ jobs?: Job[] }>("/api/operator/jobs");
        if (j.res.ok) setJobs(j.body.jobs || []);
      }
      if (isAdmin) {
        const u = await api<{ users?: User[] }>("/api/admin/users");
        if (u.res.ok) setUsers(u.body.users || []);
        const g = await api<{ keys?: GuestKey[] }>("/api/me/guest-key");
        setGuestLoaded(true);
        if (g.res.ok) setGuest(g.body.keys || []);
      }
    })();
  }, [canDesk, isAdmin]);

  const live = groupThreads(jobs).filter(isLive);
  const activeKeys = keys.filter((k) => !k.revoked);

  return (
    <div>
      <div className="stats">
        {isAdmin ? (
          <>
            <Stat k={t("home.statUsers")} v={users.length} h={t("home.statUsersHint")} />
            <Stat k={t("home.statLive")} v={canDesk ? live.length : "—"} h={canDesk ? t("home.statLiveHint") : t("home.statLiveNeed")} />
            <Stat k={t("home.statYourKeys")} v={activeKeys.length} h={t("home.statYourKeysAdmin")} />
            <Stat k={t("home.statGuest")} v={guest[0]?.prefix || t("home.guestUnset")} h={t("home.statGuestHint")} />
          </>
        ) : (
          <>
            <Stat k={t("home.statYourKeys")} v={activeKeys.length} h={t("home.statYourKeysUser")} />
            <Stat k={t("home.sessions")} v={canDesk ? live.length : t("home.sessionsOff")} h={canDesk ? t("home.liveThreads") : t("home.noReply")} />
            <Stat k={t("home.role")} v={t(`role.${user.role}`)} />
            <Stat k={t("home.apiKeys")} v={keys.length} />
          </>
        )}
      </div>
      {isAdmin && guestLoaded ? (
        <div className="notice">
          {guest.length
            ? t("home.guestSet", { keys: guest.map((g) => `${g.label} ${g.prefix}`).join(" · ") })
            : t("home.guestMissing")}
        </div>
      ) : null}
      <div className="home-grid">
        <div className="card card-pad">
          {isAdmin ? (
            <>
              <h3>{t("nav.users")}</h3>
              {users.length ? (
                <table>
                  <tbody>
                    {users.slice(0, 8).map((u) => (
                      <tr key={u.id}>
                        <td>{u.username}</td>
                        <td><Pill status={u.role} label={statusLabel(u.role)} /></td>
                        <td><Pill status={u.canReply ? "completed" : "off"} label={statusLabel(u.canReply ? "completed" : "off")} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="empty">{t("home.noUsers")}</p>
              )}
              <p style={{ margin: "12px 0 0" }}>
                <button className="btn btn-sm" type="button" onClick={() => go("users")}>{t("home.openUsers")}</button>
              </p>
            </>
          ) : (
            <>
              <h3>{t("home.connect")}</h3>
              <p className="sub">{t("home.connectHint")}</p>
              {connect?.endpoint ? (
                <p>
                  {t("home.endpoint")}: <code className="mono">{connect.endpoint}</code>{" "}
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => copy(connect.endpoint, t("keys.endpointCopied"))}>{t("home.copy")}</button>
                </p>
              ) : null}
              {connect?.model ? (
                <p>{t("home.model")}: <code className="mono">{connect.model}</code></p>
              ) : null}
              <p style={{ margin: "12px 0 0" }}>
                <button className="btn btn-sm" type="button" onClick={() => go("keys")}>{t("home.manageKeys")}</button>
              </p>
            </>
          )}
        </div>
        <div className="card card-pad">
          <h3>{canDesk ? t("home.liveSessions") : t("home.apiKeys")}</h3>
          {canDesk ? (
            live.length ? (
              <table>
                <tbody>
                  {live.slice(0, 6).map((j) => (
                    <tr key={j.id}>
                      <td><Pill status={j.status} label={statusLabel(j.status)} /></td>
                      <td>{j.lastUserPreview || t("desk.noUserText")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty">{t("home.noLive")}</p>
            )
          ) : activeKeys.length ? (
            <table>
              <tbody>
                {activeKeys.slice(0, 6).map((k) => (
                  <tr key={k.id}>
                    <td>{k.label}</td>
                    <td className="mono">{k.prefix}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty">{t("home.noKeys")}</p>
          )}
          <p style={{ margin: "12px 0 0" }}>
            <button className="btn btn-sm btn-secondary" type="button" onClick={() => go(canDesk ? "desk" : "keys")}>
              {canDesk ? t("home.openSessions") : t("home.allKeys")}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v, h }: { k: string; v: string | number; h?: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {h ? <div className="h">{h}</div> : null}
    </div>
  );
}

function tagLabel(t: (k: string, v?: Record<string, string | number>) => string, kind?: string): string {
  if (!kind || kind === "text") return "";
  const key = `tag.${kind}`;
  const label = t(key);
  return label !== key ? label : kind.replaceAll("_", " ").replaceAll("-", " ");
}

function BlockBody({ block }: { block: ContextBlock }) {
  if (block.fields?.length) {
    return (
      <dl className="kv">
        {block.fields.map((row, i) => (
          <div key={i} className="kv-row">
            {row.key ? <dt>{row.key}</dt> : null}
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <pre>{block.excerpt}{block.truncated ? "…" : ""}</pre>;
}

function ChatItem({
  block,
  t,
}: {
  block: ContextBlock;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const lane = block.lane || (block.role === "assistant" ? "assistant" : block.role === "user" ? "user" : "system");
  const mine = block.source === "reply";
  const title =
    mine
      ? t("desk.you")
      : tagLabel(t, block.title || (block.kind && block.kind !== "text" ? block.kind : undefined)) ||
        (t(`blk.${block.role}`) !== `blk.${block.role}` ? t(`blk.${block.role}`) : block.role);
  const extra = block.truncated ? ` · ${t("desk.truncated")}` : "";

  if (lane === "system" || lane === "meta" || lane === "tool") {
    return (
      <article className={`msg meta lane-${lane}${block.collapsed ? " collapsed" : ""}`}>
        <button
          type="button"
          className="msg-head"
          onClick={(e) => e.currentTarget.parentElement?.classList.toggle("collapsed")}
        >
          {title}{extra}
        </button>
        <BlockBody block={block} />
      </article>
    );
  }

  return (
    <article className={`msg ${lane}${mine ? " you" : ""}`}>
      <div className="msg-head">
        {title}
        {block.kind && block.kind !== "text" && lane === "assistant" ? ` · ${block.kind}` : ""}
        {extra}
      </div>
      <BlockBody block={block} />
    </article>
  );
}

function Sessions({
  t,
  canDesk,
  statusLabel,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  canDesk: boolean;
  statusLabel: (s: string) => string;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [system, setSystem] = useState<ContextBlock[]>([]);
  const [blocks, setBlocks] = useState<ContextBlock[]>([]);
  const [you, setYou] = useState<ContextBlock[]>([]);
  const [cursor, setCursor] = useState("0");
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const [head, setHead] = useState<Job | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!canDesk) return;
    const { res, body } = await api<{ jobs?: Job[] }>("/api/operator/jobs");
    if (res.ok) setJobs(body.jobs || []);
  }, [canDesk]);

  useEffect(() => {
    void refresh();
    if (!canDesk) return;
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [canDesk, refresh]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [blocks, you, selected]);

  async function openJob(id: string, reset = true, fromCursor?: string) {
    setSelected(id);
    setErr("");
    const meta = await api<Job>(`/api/operator/jobs/${id}`);
    if (meta.res.ok) setHead(meta.body);
    const cur = reset ? "0" : (fromCursor ?? cursor);
    const page = await api<ContextPage>(
      `/api/operator/jobs/${id}/context?cursor=${encodeURIComponent(cur)}&limit=50`,
    );
    if (!page.res.ok) return;
    const next = page.body;
    if (reset) setSystem(next.system || []);
    setBlocks((prev) => (reset ? next.blocks || [] : prev.concat(next.blocks || [])));
    setYou(next.reply || []);
    setCursor(next.nextCursor || "0");
    setHasMore(Boolean(next.hasMore));
    await refresh();
  }

  async function sendReply() {
    setErr("");
    if (!selected) {
      setErr(t("desk.pickFirst"));
      return;
    }
    const text = draft.trim();
    if (!text) return;
    const { res, body } = await api<{ error?: string }>(`/api/operator/jobs/${selected}/complete`, jsonBody({ text }));
    if (!res.ok) {
      setErr(body.error || t("desk.sendFailed"));
      return;
    }
    setDraft("");
    await openJob(selected, true);
  }

  const threads = groupThreads(jobs);
  const live = threads.filter(isLive);
  const rest = threads.filter((j) => !live.includes(j)).slice(0, 24);
  const rows = live.concat(rest);
  const emptyChat = !blocks.length && !you.length && !system.length;

  if (!canDesk) {
    return (
      <div className="card card-pad">
        <h3>{t("desk.lockedTitle")}</h3>
        <p className="sub" style={{ margin: 0 }}>{t("desk.locked")}</p>
      </div>
    );
  }

  return (
    <div className="desk">
      <aside className="inbox">
        {rows.length ? rows.map((j) => (
          <button key={j.id} type="button" className={`job${selected === j.id ? " on" : ""}`} onClick={() => void openJob(j.id)}>
            <div className="meta">
              <Pill status={j.status} label={statusLabel(j.status)} />
              {j.clientLabel || j.displayModel || j.model}
              {j.turnCount && j.turnCount > 1 ? ` · ${t("desk.turn")} ${j.turnCount}` : ""}
              {" · "}
              {t("desk.wait", { n: Math.round((j.waitMs || 0) / 1000) })}
            </div>
            <div className="prev">{j.lastUserPreview || t("desk.noUserText")}</div>
          </button>
        )) : <p className="empty">{t("desk.empty")}</p>}
      </aside>
      <div className="work">
        <header className="work-head">
          <p className="sub" style={{ margin: 0 }}>
            {head ? `${t("desk.client")} · ${head.clientLabel || "—"}` : t("desk.select")}
            {head?.threadId ? ` · ${head.threadId}` : ""}
          </p>
          <h1>
            {head ? <><Pill status={head.status} label={statusLabel(head.status)} /> {head.displayModel || head.model}</> : t("desk.inbox")}
          </h1>
        </header>
        <div className="ctx" ref={scroller}>
          {system.length ? (
            <details className="sys-pack">
              <summary>
                {t("desk.systemPack")}
                <span>{t("desk.systemPackHint", { n: system.length })}</span>
              </summary>
              {system.map((b, i) => <ChatItem key={`sys-${i}`} block={b} t={t} />)}
            </details>
          ) : null}
          {emptyChat && !head ? <p className="empty">{t("desk.emptyLive")}</p> : null}
          <div className="transcript">
            {blocks.map((b, i) => <ChatItem key={`m-${i}`} block={b} t={t} />)}
            {you.map((b, i) => <ChatItem key={`y-${i}`} block={b} t={t} />)}
          </div>
          {hasMore ? (
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => selected && void openJob(selected, false, cursor)}>
              {t("desk.loadMore")}
            </button>
          ) : null}
        </div>
        <footer className="composer">
          <textarea
            value={draft}
            placeholder={t("desk.placeholder")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void sendReply();
            }}
          />
          <button className="btn" type="button" onClick={() => void sendReply()}>{t("desk.send")}</button>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={async () => {
              if (!selected) return;
              await api(`/api/operator/jobs/${selected}/cancel`, { method: "POST" });
              await refresh();
            }}
          >{t("desk.cancel")}</button>
        </footer>
      </div>
      {err ? <p className="err desk-err">{err}</p> : null}
    </div>
  );
}

function Keys({
  t,
  connect,
  secretFor,
  rememberSecret,
  copy,
  flash,
  statusLabel,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  connect: ConnectInfo | null;
  secretFor: (k: ApiKey) => string;
  rememberSecret: (s: string, meta?: { id?: string; prefix?: string }) => void;
  copy: (text: string, ok: string) => void;
  flash: (msg: string) => void;
  statusLabel: (s: string) => string;
}) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [ccHref, setCcHref] = useState("");
  const [hint, setHint] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteFor, setPasteFor] = useState<ApiKey | null>(null);
  const [pasteVal, setPasteVal] = useState("");
  const [pasteErr, setPasteErr] = useState("");
  const [confirm, setConfirm] = useState<ApiKey | null>(null);

  async function load() {
    const { res, body } = await api<{ keys?: ApiKey[] }>("/api/me/keys");
    if (res.ok) setKeys(body.keys || []);
  }
  useEffect(() => { void load(); }, []);

  async function importCc(apiKey: string) {
    const { res, body } = await api<{ href?: string; error?: string; endpoint?: string; model?: string }>("/api/me/cc-switch", jsonBody({ apiKey }));
    if (!res.ok || !body.href) {
      flash(errorKey(body.error) ? t(errorKey(body.error)!) : t("keys.importFailed"));
      return false;
    }
    rememberSecret(apiKey);
    window.location.href = body.href;
    return true;
  }

  const rows = keys.filter((k) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return k.label.toLowerCase().includes(s) || k.prefix.toLowerCase().includes(s);
  });

  return (
    <div>
      {connect ? (
        <div className="endpoint">
          <span>{t("keys.baseUrl")}</span>
          <code className="mono">{connect.endpoint}</code>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => copy(connect.endpoint, t("keys.endpointCopied"))}>{t("keys.copy")}</button>
          <span style={{ color: "var(--muted)" }}>{t("keys.noV1")}</span>
          {connect.model ? <> · {t("keys.model")} <code className="mono">{connect.model}</code></> : null}
        </div>
      ) : null}
      <div className="toolbar">
        <input className="search" value={q} placeholder={t("keys.search")} onChange={(e) => setQ(e.target.value)} />
        <button className="btn" type="button" onClick={() => { setLabel(""); setCreateOpen(true); }}>{t("keys.create")}</button>
      </div>
      <div className="card" style={{ overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>{t("keys.colName")}</th>
              <th>{t("keys.colKey")}</th>
              <th>{t("keys.colStatus")}</th>
              <th>{t("keys.colCreated")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((k) => (
              <tr key={k.id}>
                <td>{k.label}</td>
                <td className="mono">{k.prefix}</td>
                <td><Pill status={k.revoked ? "error" : "completed"} label={statusLabel(k.revoked ? "disabled" : "active")} /></td>
                <td>{fmtWhen(k.createdAt, t)}</td>
                <td className="actions">
                  {!k.revoked ? (
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => {
                        const s = secretFor(k);
                        if (s) void importCc(s);
                        else { setPasteFor(k); setPasteVal(""); setPasteErr(""); setPasteOpen(true); }
                      }}
                    >
                      <IconImport />
                      {t("keys.importCc")}
                    </button>
                  ) : null}
                  <button type="button" className="icon-btn" onClick={() => copy(k.prefix, t("keys.prefixCopied"))}>
                    <IconCopy />
                    {t("keys.copy")}
                  </button>
                  {!k.revoked ? (
                    <button type="button" className="icon-btn danger" onClick={() => setConfirm(k)}>
                      <IconTrash />
                      {t("keys.delete")}
                    </button>
                  ) : null}
                </td>
              </tr>
            )) : (
              <tr><td colSpan={5} className="empty">{t("keys.empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={createOpen} title={t("keys.dialogTitle")} onClose={() => setCreateOpen(false)} footer={
        <>
          <button className="btn btn-secondary" type="button" onClick={() => setCreateOpen(false)}>{t("confirm.cancel")}</button>
          <button className="btn" type="button" onClick={async () => {
            const { res, body } = await api<{ apiKey?: string; id?: string; prefix?: string; error?: string }>("/api/me/keys", jsonBody({ label: label.trim() || "key" }));
            if (!res.ok || !body.apiKey) {
              flash(body.error || t("keys.createFailed"));
              return;
            }
            rememberSecret(body.apiKey, { id: body.id, prefix: body.prefix });
            setSecret(body.apiKey);
            const cc = await api<{ href?: string; endpoint?: string; model?: string }>("/api/me/cc-switch", jsonBody({ apiKey: body.apiKey }));
            if (cc.res.ok && cc.body.href) {
              setCcHref(cc.body.href);
              setHint(t("keys.importHint", { endpoint: cc.body.endpoint || "", model: cc.body.model || "" }));
            }
            setCreateOpen(false);
            await load();
          }}>{t("keys.createBtn")}</button>
        </>
      }>
        <p className="sub">{t("keys.dialogSub")}</p>
        <label>{t("field.name")}</label>
        <input value={label} placeholder={t("keys.namePlaceholder")} onChange={(e) => setLabel(e.target.value)} />
      </Modal>

      <Modal open={Boolean(secret)} title={t("keys.secretTitle")} onClose={() => setSecret("")} footer={
        <>
          <button className="btn btn-secondary" type="button" onClick={() => copy(secret, t("keys.keyCopied"))}>{t("keys.copy")}</button>
          <button className="btn" type="button" onClick={() => setSecret("")}>{t("keys.done")}</button>
        </>
      }>
        <p className="sub">{t("keys.secretSub")}</p>
        <div className="secret-box">{secret}</div>
        <p className="err" style={{ color: "var(--muted)" }}>{hint || (connect ? t("keys.secretHint", { endpoint: connect.endpoint, model: connect.model || "" }) : "")}</p>
        {ccHref ? <p style={{ margin: "12px 0 0" }}><a className="btn btn-sm" href={ccHref}>{t("keys.importCc")}</a></p> : null}
      </Modal>

      <Modal open={pasteOpen} title={t("keys.importPasteTitle")} onClose={() => setPasteOpen(false)} footer={
        <>
          <button className="btn btn-secondary" type="button" onClick={() => setPasteOpen(false)}>{t("confirm.cancel")}</button>
          <button className="btn" type="button" onClick={async () => {
            if (!pasteVal.trim()) { setPasteErr(t("keys.importNeedKey")); return; }
            if (pasteFor) rememberSecret(pasteVal.trim(), { id: pasteFor.id, prefix: pasteFor.prefix });
            const ok = await importCc(pasteVal.trim());
            if (ok) setPasteOpen(false);
            else setPasteErr(t("keys.importFailed"));
          }}>{t("keys.importGo")}</button>
        </>
      }>
        <p className="sub">{t("keys.importPasteSub")}</p>
        <label>{t("keys.colKey")}</label>
        <input className="mono" value={pasteVal} placeholder={t("keys.importPastePlaceholder")} onChange={(e) => setPasteVal(e.target.value)} />
        <p className="err">{pasteErr}</p>
      </Modal>

      <Modal open={Boolean(confirm)} title={t("keys.deleteTitle")} onClose={() => setConfirm(null)} footer={
        <>
          <button className="btn btn-secondary" type="button" onClick={() => setConfirm(null)}>{t("confirm.cancel")}</button>
          <button className="btn btn-danger" type="button" onClick={async () => {
            if (!confirm) return;
            await api(`/api/me/keys/${confirm.id}`, { method: "DELETE" });
            setConfirm(null);
            await load();
          }}>{t("keys.delete")}</button>
        </>
      }>
        <p className="sub">{confirm ? t("keys.deleteMsg", { name: confirm.label }) : ""}</p>
      </Modal>
    </div>
  );
}

function Users({
  t,
  statusLabel,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  statusLabel: (s: string) => string;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    const { res, body } = await api<{ users?: User[]; error?: string }>("/api/admin/users");
    if (!res.ok) { setErr(t("err.forbidden")); return; }
    setErr("");
    setUsers(body.users || []);
  }
  useEffect(() => { void load(); }, []);

  const rows = users.filter((u) => u.username.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div>
      <p className="err">{err}</p>
      <div className="toolbar">
        <input className="search" value={q} placeholder={t("users.search")} onChange={(e) => setQ(e.target.value)} />
        <span className="sub" style={{ margin: 0 }}>{t("users.note", { n: users.length })}</span>
      </div>
      <div className="card" style={{ overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>{t("users.colUser")}</th>
              <th>{t("users.colRole")}</th>
              <th>{t("users.colReply")}</th>
              <th>{t("users.colStatus")}</th>
              <th>{t("users.colCreated")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((u) => {
              const admin = u.role === "superadmin";
              return (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td><Pill status={u.role} label={statusLabel(u.role)} /></td>
                  <td>
                    {admin ? (u.canReply ? t("users.yes") : t("users.no")) : (
                      <button
                        type="button"
                        className={`switch${u.canReply ? " on" : ""}`}
                        title={t("users.toggleReply")}
                        onClick={async () => {
                          await api(`/api/admin/users/${u.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ canReply: !u.canReply }) });
                          await load();
                        }}
                      />
                    )}
                  </td>
                  <td><Pill status={u.disabled ? "error" : "completed"} label={statusLabel(u.disabled ? "disabled" : "active")} /></td>
                  <td>{fmtWhen(u.createdAt, t)}</td>
                  <td className="actions">
                    {admin ? null : (
                      <button
                        className="btn btn-sm btn-secondary"
                        type="button"
                        onClick={async () => {
                          await api(`/api/admin/users/${u.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ disabled: !u.disabled }) });
                          await load();
                        }}
                      >
                        {u.disabled ? t("users.enable") : t("users.disable")}
                      </button>
                    )}
                  </td>
                </tr>
              );
            }) : (
              <tr><td colSpan={6} className="empty">{t("users.empty")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Settings({
  t,
  flash,
  onSite,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  flash: (msg: string) => void;
  onSite: (name: string) => void;
}) {
  const [form, setForm] = useState<SiteSettings>({
    name: "Carbon AI",
    nameZh: "碳基智能",
    publicOrigin: "",
    defaultDisplay: "Carbon AI",
    autoOrigin: "",
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { res, body } = await api<SiteSettings & { error?: string }>("/api/admin/settings");
    if (!res.ok) {
      setErr(t("err.forbidden"));
      return;
    }
    setErr("");
    setForm({
      name: body.name || "Carbon AI",
      nameZh: body.nameZh || "碳基智能",
      publicOrigin: body.publicOrigin || "",
      defaultDisplay: body.defaultDisplay || "Carbon AI",
      autoOrigin: body.autoOrigin || "",
    });
  }
  useEffect(() => { void load(); }, []);

  return (
    <div className="card card-pad" style={{ maxWidth: 560 }}>
      <h3>{t("settings.title")}</h3>
      <p className="sub">{t("settings.sub")}</p>
      <label>{t("settings.name")}</label>
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={64} />
      <label>{t("settings.nameZh")}</label>
      <input value={form.nameZh} onChange={(e) => setForm({ ...form, nameZh: e.target.value })} maxLength={64} />
      <label>{t("settings.origin")}</label>
      <input
        className="mono"
        value={form.publicOrigin}
        placeholder={form.autoOrigin || "http://127.0.0.1:12580"}
        onChange={(e) => setForm({ ...form, publicOrigin: e.target.value })}
      />
      <p className="sub" style={{ marginTop: 6 }}>{t("settings.originHint")}</p>
      <label>{t("settings.display")}</label>
      <input value={form.defaultDisplay} onChange={(e) => setForm({ ...form, defaultDisplay: e.target.value })} maxLength={64} />
      <p className="err">{err}</p>
      <p style={{ margin: "16px 0 0" }}>
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            const { res, body } = await api<SiteSettings & { error?: string }>("/api/admin/settings", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                name: form.name,
                nameZh: form.nameZh,
                publicOrigin: form.publicOrigin,
                defaultDisplay: form.defaultDisplay,
              }),
            });
            setBusy(false);
            if (!res.ok) {
              setErr(body.error || t("settings.saveFailed"));
              return;
            }
            setForm({
              name: body.name,
              nameZh: body.nameZh,
              publicOrigin: body.publicOrigin,
              defaultDisplay: body.defaultDisplay,
              autoOrigin: body.autoOrigin || form.autoOrigin,
            });
            onSite(body.name);
            flash(t("settings.saved"));
          }}
        >
          {busy ? t("settings.saving") : t("settings.save")}
        </button>
      </p>
    </div>
  );
}
