import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  ThemeSwitch,
} from "./components.tsx";
import { detectLang, translate } from "./i18n.ts";
import { callerTitle, copyText, filterTools, formatParams, fmtWhen, groupThreads, initials, isLive, isPresent, readView, secretPrefix, setViewUrl, threadKey } from "./lib.ts";
import { ChatItem } from "./ChatItem.tsx";
import { pendingFromTool, ToolDraftCard, type PendingTool } from "./ToolDraft.tsx";
import { Mark } from "./brand/Mark.tsx";
import { applyTheme, detectTheme, persistTheme, themeIsLocked } from "./theme.ts";
import type { ApiKey, Caller, ConnectInfo, ContextBlock, ContextPage, GuestKey, Job, Lang, PublicTool, SiteSettings, Theme, User, View } from "./types.ts";

type Gate = "boot" | "setup" | "login" | "app";

export function App() {
  const [lang, setLangState] = useState<Lang>(detectLang);
  const [theme, setTheme] = useState<Theme>(detectTheme);
  const themeLocked = useRef(themeIsLocked());
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
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (themeLocked.current) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      if (themeLocked.current) return;
      const next = mq.matches ? "dark" : "light";
      setTheme(next);
      applyTheme(next);
    };
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

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

  function changeTheme(next: Theme) {
    themeLocked.current = true;
    setTheme(next);
    persistTheme(next);
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
  if (gate === "setup") {
    return (
      <Setup t={t} lang={lang} theme={theme} brand={brand} onLang={changeLang} onTheme={changeTheme} onDone={(s) => void boot(s)} />
    );
  }
  if (gate === "login") {
    return (
      <Login
        t={t}
        lang={lang}
        theme={theme}
        brand={brand}
        onLang={changeLang}
        onTheme={changeTheme}
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
          <Mark />
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
            <ThemeSwitch theme={theme} onChange={changeTheme} t={t} />
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
            <Keys t={t} connect={connect} secretFor={secretFor} rememberSecret={rememberSecret} copy={copy} flash={flash} />
          ) : null}
          {view === "users" && isAdmin ? <Users t={t} statusLabel={statusLabel} /> : null}
          {view === "settings" && isAdmin ? <Settings t={t} flash={flash} onSite={setBrand} copy={copy} canDesk={canDesk} /> : null}
        </div>
      </section>
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

function Setup({
  t,
  lang,
  theme,
  brand,
  onLang,
  onTheme,
  onDone,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  lang: Lang;
  theme: Theme;
  brand: string;
  onLang: (l: Lang) => void;
  onTheme: (theme: Theme) => void;
  onDone: (secret?: string) => void;
}) {
  const [err, setErr] = useState("");
  return (
    <div className="gate">
      <div className="lang-bar">
        <ThemeSwitch theme={theme} onChange={onTheme} t={t} />
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
        <Mark large />
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
  theme,
  brand,
  onLang,
  onTheme,
  mode,
  setMode,
  onDone,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  lang: Lang;
  theme: Theme;
  brand: string;
  onLang: (l: Lang) => void;
  onTheme: (theme: Theme) => void;
  mode: "login" | "register";
  setMode: (m: "login" | "register") => void;
  onDone: (secret?: string) => void;
}) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="gate">
      <div className="lang-bar">
        <ThemeSwitch theme={theme} onChange={onTheme} t={t} />
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
        <Mark large />
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

function kindLabel(t: (k: string, v?: Record<string, string | number>) => string, kind?: string): string {
  if (!kind) return "";
  const key = `client.${kind}`;
  const label = t(key);
  return label === key ? kind : label;
}

function sessionMeta(
  t: (k: string, v?: Record<string, string | number>) => string,
  j: Job | null,
): string {
  if (!j) return "";
  const parts = [kindLabel(t, j.clientKind), j.clientIp].filter(Boolean);
  if (isLive(j) || j.presence === "live") parts.push(t("desk.waiting"));
  else if (j.presence === "online") parts.push(t("desk.online"));
  else if (j.lastSeenAt) parts.push(t("desk.lastSeen", { when: fmtWhen(j.lastSeenAt, t) }));
  if (j.turnCount && j.turnCount > 1) parts.push(t("desk.turns", { n: j.turnCount }));
  return parts.join(" · ");
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
  const [callers, setCallers] = useState<Caller[]>([]);

  useEffect(() => {
    void (async () => {
      const k = await api<{ keys?: ApiKey[] }>("/api/me/keys");
      if (k.res.ok) setKeys(k.body.keys || []);
      if (canDesk) {
        const j = await api<{ jobs?: Job[] }>("/api/operator/jobs");
        if (j.res.ok) setJobs(j.body.jobs || []);
        const c = await api<{ callers?: Caller[] }>("/api/operator/callers");
        if (c.res.ok) setCallers(c.body.callers || []);
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
  const activeKeys = keys;
  const onlineN = callers.filter((c) => c.presence === "live" || c.presence === "online").length;

  return (
    <div>
      <div className="stats">
        {isAdmin ? (
          <>
            <Stat k={t("home.statUsers")} v={users.length} h={t("home.statUsersHint")} />
            <Stat k={t("home.statLive")} v={canDesk ? live.length : "—"} h={canDesk ? t("home.statLiveHint") : t("home.statLiveNeed")} />
            <Stat k={t("home.statOnline")} v={canDesk ? onlineN : "—"} h={t("home.statOnlineHint")} />
            <Stat k={t("home.statGuest")} v={guest[0]?.prefix || t("home.guestUnset")} h={t("home.statGuestHint")} />
          </>
        ) : (
          <>
            <Stat k={t("home.statYourKeys")} v={activeKeys.length} h={t("home.statYourKeysUser")} />
            <Stat k={t("home.sessions")} v={canDesk ? live.length : t("home.sessionsOff")} h={canDesk ? t("home.liveThreads") : t("home.noReply")} />
            <Stat k={t("home.statOnline")} v={canDesk ? onlineN : "—"} h={t("home.statOnlineHint")} />
            <Stat k={t("home.role")} v={t(`role.${user.role}`)} />
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
            <>
              {live.length ? (
                <table>
                  <tbody>
                    {live.slice(0, 6).map((j) => (
                      <tr key={j.id}>
                        <td><Pill status={j.status} label={statusLabel(j.status)} /></td>
                        <td>{callerTitle(j, t("desk.client"))}</td>
                        <td>{kindLabel(t, j.clientKind)}</td>
                        <td>{j.lastUserPreview || t("desk.noUserText")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="empty">{t("home.noLive")}</p>
              )}
              {callers.length ? (
                <table style={{ marginTop: 12 }}>
                  <tbody>
                    {callers.slice(0, 6).map((c) => (
                      <tr key={c.id}>
                        <td><Pill status={c.presence === "idle" ? "off" : "streaming"} label={c.presence === "idle" ? t("desk.idle") : t("desk.online")} /></td>
                        <td>{c.label}</td>
                        <td>{c.clientKindLabel || kindLabel(t, c.clientKind)}</td>
                        <td className="mono">{c.clientIp || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </>
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
      {canDesk ? <WechatBind t={t} copy={copy} /> : null}
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

function ChevronDown() {
  return (
    <svg className="tools-chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d="M2.2 4.2a.75.75 0 0 1 1.06 0L6 6.94 8.74 4.2a.75.75 0 1 1 1.06 1.06L6.53 8.53a.75.75 0 0 1-1.06 0L2.2 5.26a.75.75 0 0 1 0-1.06z" fill="currentColor" />
    </svg>
  );
}

const ToolPicker = memo(function ToolPicker({
  catalog,
  open,
  queued,
  onOpen,
  onClose,
  onPick,
  t,
}: {
  catalog: PublicTool[];
  open: boolean;
  queued: number;
  onOpen: () => void;
  onClose: () => void;
  onPick: (tool: PublicTool) => void;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => filterTools(catalog, q), [catalog, q]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
    else setQ("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!catalog.length) return null;

  if (!open) {
    return (
      <div className="tools-bar">
        <button
          type="button"
          className="tools-open"
          aria-expanded={false}
          aria-controls="desk-tool-picker"
          onClick={onOpen}
        >
          <span className="tools-open-label">{queued ? t("desk.toolsAddMore") : t("desk.toolsAdd")}</span>
          <span className="tools-open-count">{t("desk.toolsCount", { n: catalog.length })}</span>
          <ChevronDown />
        </button>
      </div>
    );
  }

  return (
    <div className="tool-panel" id="desk-tool-picker" ref={panelRef} role="region" aria-label={t("desk.toolsTitle")}>
      <div className="tool-panel-head">
        <div className="tool-panel-title">
          <b>{t("desk.toolsTitle")}</b>
          <span>{t("desk.toolsCount", { n: catalog.length })}</span>
        </div>
        <button type="button" className="btn btn-sm btn-secondary tools-close" onClick={onClose}>
          {t("desk.toolsClose")}
        </button>
      </div>
      <input
        ref={searchRef}
        className="tools-search"
        value={q}
        placeholder={t("desk.toolsSearch")}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const first = shown[0];
            if (first) onPick(first);
          }
        }}
      />
      <p className="tools-hint">{t("desk.toolsHint")}</p>
      {shown.length === 0 ? (
        <p className="tools-empty">{t("desk.toolsEmpty")}</p>
      ) : (
        <div className="tool-list" role="listbox">
          {shown.map((tool) => {
            const sig = formatParams(tool.params);
            return (
              <button
                key={tool.key}
                type="button"
                className="tool-row"
                title={[sig, tool.description].filter(Boolean).join("\n") || tool.kind}
                onClick={() => onPick(tool)}
              >
                <span className="name">{tool.name}</span>
                <span className="kind">{tool.kind.replaceAll("_", " ")}</span>
                {sig ? <span className="sig">{sig}</span> : null}
              </button>
            );
          })}
        </div>
      )}
      {q.trim() && shown.length !== catalog.length ? (
        <p className="tools-meta">{t("desk.toolsFiltered", { shown: shown.length, n: catalog.length })}</p>
      ) : null}
    </div>
  );
});

function lastClientTurnIsToolResult(blocks: ContextBlock[]): boolean {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!;
    if (b.kind === "tool_result") return true;
    if (b.lane === "user") return false;
    if (b.source === "reply") continue;
  }
  return false;
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
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [system, setSystem] = useState<ContextBlock[]>([]);
  const [blocks, setBlocks] = useState<ContextBlock[]>([]);
  const [you, setYou] = useState<ContextBlock[]>([]);
  const [cursor, setCursor] = useState("0");
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [catalog, setCatalog] = useState<PublicTool[]>([]);
  const [pending, setPending] = useState<PendingTool[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [head, setHead] = useState<Job | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);
  const openedSig = useRef("");

  const threads = groupThreads(jobs);
  const selectedRow = selectedThread ? threads.find((j) => threadKey(j) === selectedThread) ?? null : null;
  const selectedSig = selectedRow ? `${selectedRow.id}:${selectedRow.status}:${selectedRow.turnCount ?? 1}` : "";

  const refresh = useCallback(async () => {
    if (!canDesk) return;
    const { res, body } = await api<{ jobs?: Job[] }>("/api/operator/jobs");
    if (res.ok) setJobs(body.jobs || []);
  }, [canDesk]);

  const loadChat = useCallback(async (jobId: string, reset: boolean, fromCursor = "0") => {
    setErr("");
    const meta = await api<Job>(`/api/operator/jobs/${jobId}`);
    if (meta.res.ok) setHead(meta.body);
    const cur = reset ? "0" : fromCursor;
    const page = await api<ContextPage>(
      `/api/operator/jobs/${jobId}/context?tail=1&cursor=${encodeURIComponent(cur)}&limit=80`,
    );
    if (!page.res.ok) return;
    const next = page.body;
    const el = scroller.current;
    const prevHeight = el?.scrollHeight ?? 0;
    if (reset) {
      setSystem(next.system || []);
      setBlocks(next.blocks || []);
      setYou(next.reply || []);
      setCatalog(next.tools || []);
      stickBottom.current = true;
    } else {
      stickBottom.current = false;
      setBlocks((prev) => (next.blocks || []).concat(prev));
    }
    setCursor(next.nextCursor || "0");
    setHasMore(Boolean(next.hasMore));
    if (!reset && el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight - prevHeight;
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!canDesk) return;
    const id = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(id);
  }, [canDesk, refresh]);

  useEffect(() => {
    setDraft("");
    setPending([]);
    setErr("");
    setToolsOpen(false);
  }, [selectedThread]);

  const selectedJobId = selectedRow?.id;
  useEffect(() => {
    if (!selectedJobId || !selectedSig) {
      openedSig.current = "";
      setHead(null);
      setSystem([]);
      setBlocks([]);
      setYou([]);
      setCatalog([]);
      setHasMore(false);
      return;
    }
    if (openedSig.current === selectedSig) return;
    openedSig.current = selectedSig;
    void loadChat(selectedJobId, true);
  }, [selectedJobId, selectedSig, loadChat]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !stickBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [blocks, you, selectedThread]);

  const queueTool = useCallback((tool: PublicTool) => {
    setPending((prev) => [
      ...prev,
      { ...pendingFromTool(tool), id: `${tool.key}-${Date.now()}-${prev.length}` },
    ]);
    setToolsOpen(false);
  }, []);

  const openTools = useCallback(() => setToolsOpen(true), []);
  const closeTools = useCallback(() => setToolsOpen(false), []);

  async function sendReply() {
    setErr("");
    if (!selectedRow) {
      setErr(t("desk.pickFirst"));
      return;
    }
    const text = draft.trim();
    const tools = pending.map((p) => ({ name: p.name, kind: p.kind, input: p.input }));
    if (!text && tools.length === 0) {
      setErr(t("desk.needReply"));
      return;
    }
    setSending(true);
    const { res, body } = await api<{ error?: string }>(
      `/api/operator/jobs/${selectedRow.id}/complete`,
      jsonBody({ text: draft, tools: tools.length ? tools : undefined }),
    );
    setSending(false);
    if (!res.ok) {
      setErr(body.error || t("desk.sendFailed"));
      return;
    }
    setDraft("");
    setPending([]);
    openedSig.current = "";
    await refresh();
  }

  if (!canDesk) {
    return (
      <div className="card card-pad">
        <h3>{t("desk.lockedTitle")}</h3>
        <p className="sub" style={{ margin: 0 }}>{t("desk.locked")}</p>
      </div>
    );
  }

  const liveHead = head ? isLive(head) : false;
  const emptyChat = !blocks.length && !you.length && !system.length;
  const who = head || selectedRow;
  const whoTitle = who ? callerTitle(who, t("desk.client")) : t("desk.client");

  return (
    <div className={`desk${selectedThread ? " has-chat" : ""}`}>
      <aside className="inbox">
        <div className="inbox-head">{t("desk.inbox")}</div>
        {threads.length ? threads.map((j) => (
          <button
            key={threadKey(j)}
            type="button"
            className={`conv${threadKey(j) === selectedThread ? " on" : ""}${isLive(j) ? " live" : ""}`}
            onClick={() => setSelectedThread(threadKey(j))}
          >
            <span className="conv-avatar">{initials(callerTitle(j, t("desk.client")))}</span>
            <span className="conv-main">
              <span className="conv-top">
                <b>{callerTitle(j, t("desk.client"))}</b>
                <time>{fmtWhen(j.createdAt, t)}</time>
              </span>
              {kindLabel(t, j.clientKind) ? <span className="conv-kind">{kindLabel(t, j.clientKind)}</span> : null}
              <span className="conv-prev">{j.lastUserPreview || t("desk.noUserText")}</span>
            </span>
            {isLive(j) ? (
              <span className="conv-dot" title={statusLabel(j.status)} />
            ) : isPresent(j) ? (
              <span className="conv-dot online" title={t("desk.online")} />
            ) : null}
          </button>
        )) : <p className="empty">{t("desk.empty")}</p>}
      </aside>
      <div className="work">
        {selectedRow || head ? (
          <>
            <header className="work-head">
              <button type="button" className="chat-back" onClick={() => setSelectedThread(null)} aria-label={t("desk.back")}>
                ←
              </button>
              <span className="conv-avatar sm">{initials(whoTitle)}</span>
              <div className="chat-who">
                <h1>{whoTitle}</h1>
                <p>{sessionMeta(t, who) || (liveHead ? t("desk.waiting") : head ? statusLabel(head.status) : t("desk.select"))}</p>
              </div>
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
              {hasMore ? (
                <button
                  className="earlier"
                  type="button"
                  onClick={() => selectedRow && void loadChat(selectedRow.id, false, cursor)}
                >
                  {t("desk.earlier")}
                </button>
              ) : null}
              {emptyChat ? <p className="empty">{t("desk.emptyLive")}</p> : null}
              <div className="transcript">
                {blocks.map((b, i) => <ChatItem key={`m-${i}`} block={b} t={t} />)}
                {you.map((b, i) => <ChatItem key={`y-${i}`} block={b} t={t} />)}
              </div>
            </div>
            <div className="work-foot">
            {err ? <p className="err desk-err">{err}</p> : null}
            {liveHead ? (
              <footer className="composer">
                <ToolPicker
                  catalog={catalog}
                  open={toolsOpen}
                  queued={pending.length}
                  onOpen={openTools}
                  onClose={closeTools}
                  onPick={queueTool}
                  t={t}
                />
                {pending.length ? (
                  <div className="tool-drafts">
                    {pending.map((p) => (
                      <ToolDraftCard
                        key={p.id}
                        draft={p}
                        t={t}
                        onChange={(next) => setPending((prev) => prev.map((x) => (x.id === p.id ? next : x)))}
                        onRemove={() => setPending((prev) => prev.filter((x) => x.id !== p.id))}
                      />
                    ))}
                  </div>
                ) : null}
                <div className="composer-row">
                  <textarea
                    value={draft}
                    placeholder={lastClientTurnIsToolResult(blocks) ? t("desk.continueHint") : t("desk.placeholder")}
                    disabled={sending}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void sendReply();
                    }}
                  />
                  <div className="composer-actions">
                    <button className="btn" type="button" disabled={sending} onClick={() => void sendReply()}>{t("desk.send")}</button>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={sending}
                      onClick={async () => {
                        if (!selectedRow) return;
                        await api(`/api/operator/jobs/${selectedRow.id}/cancel`, { method: "POST" });
                        openedSig.current = "";
                        await refresh();
                      }}
                    >{t("desk.cancel")}</button>
                  </div>
                </div>
              </footer>
            ) : (
              <footer className="composer read-only">
                <p>{you.some((b) => b.kind === "tool_use") ? t("desk.waitTools") : t("desk.readOnly")}</p>
              </footer>
            )}
            </div>
          </>
        ) : (
          <div className="chat-empty">
            <p>{t("desk.pickHint")}</p>
          </div>
        )}
      </div>
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
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  connect: ConnectInfo | null;
  secretFor: (k: ApiKey) => string;
  rememberSecret: (s: string, meta?: { id?: string; prefix?: string }) => void;
  copy: (text: string, ok: string) => void;
  flash: (msg: string) => void;
}) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
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
    return k.label.toLowerCase().includes(s) || k.prefix.toLowerCase().includes(s) || (k.apiKey ?? "").toLowerCase().includes(s);
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
              <th>{t("keys.colCreated")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((k) => (
              <tr key={k.id}>
                <td>{k.label}</td>
                <td className="mono">{k.apiKey || k.prefix}</td>
                <td>{fmtWhen(k.createdAt, t)}</td>
                <td className="actions">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => {
                      const s = k.apiKey || secretFor(k);
                      if (s) void importCc(s);
                      else { setPasteFor(k); setPasteVal(""); setPasteErr(""); setPasteOpen(true); }
                    }}
                  >
                    <IconImport />
                    {t("keys.importCc")}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => {
                      if (k.apiKey) copy(k.apiKey, t("keys.keyCopied"));
                      else flash(t("keys.copyNeedFull"));
                    }}
                  >
                    <IconCopy />
                    {t("keys.copy")}
                  </button>
                  <button type="button" className="icon-btn danger" onClick={() => setConfirm(k)}>
                    <IconTrash />
                    {t("keys.delete")}
                  </button>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={4} className="empty">{t("keys.empty")}</td></tr>
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
            setCreateOpen(false);
            setLabel("");
            flash(t("keys.created"));
            await load();
          }}>{t("keys.createBtn")}</button>
        </>
      }>
        <p className="sub">{t("keys.dialogSub")}</p>
        <label>{t("field.name")}</label>
        <input value={label} placeholder={t("keys.namePlaceholder")} onChange={(e) => setLabel(e.target.value)} />
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
  copy,
  canDesk,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  flash: (msg: string) => void;
  onSite: (name: string) => void;
  copy: (text: string, ok: string) => void;
  canDesk: boolean;
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
    <div>
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
    <ChannelAdmin t={t} flash={flash} copy={copy} />
    {canDesk ? <div style={{ marginTop: 16 }}><WechatBind t={t} copy={copy} /></div> : null}
    </div>
  );
}

type WechatChannel = {
  id?: string;
  enabled?: boolean;
  appId?: string;
  tokenSet?: boolean;
  secretSet?: boolean;
  aesSet?: boolean;
  bound?: number;
};

function ChannelAdmin({
  t,
  flash,
  copy,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  flash: (msg: string) => void;
  copy: (text: string, ok: string) => void;
}) {
  const [callbackUrl, setCallbackUrl] = useState("");
  const [httpsRequired, setHttpsRequired] = useState(false);
  const [wechat, setWechat] = useState<WechatChannel | null>(null);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [token, setToken] = useState("");
  const [aesKey, setAesKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    const { res, body } = await api<{
      callbackUrl?: string;
      httpsRequired?: boolean;
      wechat?: WechatChannel | null;
      error?: string;
    }>("/api/admin/channels");
    if (!res.ok) {
      setErr(body.error || t("err.forbidden"));
      return;
    }
    setErr("");
    setCallbackUrl(body.callbackUrl || "");
    setHttpsRequired(Boolean(body.httpsRequired));
    setWechat(body.wechat || null);
    setAppId(body.wechat?.appId || "");
    setEnabled(Boolean(body.wechat?.enabled));
  }
  useEffect(() => { void load(); }, []);

  return (
    <div className="card card-pad" style={{ maxWidth: 560, marginTop: 16 }}>
      <h3>{t("channels.title")}</h3>
      <p className="sub">{t("channels.sub")}</p>
      <label>{t("channels.callback")}</label>
      <p>
        <code className="mono">{callbackUrl || "—"}</code>{" "}
        {callbackUrl ? (
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => copy(callbackUrl, t("keys.copied"))}>
            {t("channels.copyUrl")}
          </button>
        ) : null}
      </p>
      {httpsRequired ? <p className="err">{t("channels.httpsNeed")}</p> : null}
      <label>{t("channels.appId")}</label>
      <input className="mono" value={appId} onChange={(e) => setAppId(e.target.value)} />
      <label>{t("channels.appSecret")}</label>
      <input
        className="mono"
        type="password"
        value={appSecret}
        placeholder={wechat?.secretSet ? t("channels.secretKeep") : ""}
        onChange={(e) => setAppSecret(e.target.value)}
      />
      <label>{t("channels.token")}</label>
      <input className="mono" value={token} placeholder={wechat?.tokenSet ? t("channels.secretKeep") : ""} onChange={(e) => setToken(e.target.value)} />
      <label>{t("channels.aes")}</label>
      <input className="mono" value={aesKey} placeholder={wechat?.aesSet ? t("channels.secretKeep") : ""} onChange={(e) => setAesKey(e.target.value)} />
      <p style={{ marginTop: 12 }}>
        <label>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t("channels.enable")}
        </label>
      </p>
      <p className="err">{err}</p>
      <p style={{ margin: "16px 0 0" }}>
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            const { res, body } = await api<{
              callbackUrl?: string;
              httpsRequired?: boolean;
              wechat?: WechatChannel | null;
              error?: string;
            }>("/api/admin/channels", {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                kind: "wechat_mp",
                appId,
                appSecret: appSecret || undefined,
                token: token || undefined,
                aesKey: aesKey || undefined,
                enabled,
              }),
            });
            setBusy(false);
            if (!res.ok) {
              setErr(body.error || t("settings.saveFailed"));
              return;
            }
            setAppSecret("");
            setToken("");
            setAesKey("");
            setCallbackUrl(body.callbackUrl || callbackUrl);
            setHttpsRequired(Boolean(body.httpsRequired));
            setWechat(body.wechat || null);
            setAppId(body.wechat?.appId || appId);
            setEnabled(Boolean(body.wechat?.enabled));
            flash(t("channels.saved"));
          }}
        >
          {busy ? t("settings.saving") : t("settings.save")}
        </button>
      </p>
    </div>
  );
}

function WechatBind({
  t,
  copy,
}: {
  t: (k: string, v?: Record<string, string | number>) => string;
  copy: (text: string, ok: string) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [bound, setBound] = useState(false);
  const [peer, setPeer] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");

  async function load() {
    const { res, body } = await api<{
      enabled?: boolean;
      wechat?: { bound?: boolean; peerMasked?: string };
      error?: string;
    }>("/api/me/channels");
    if (!res.ok) return;
    setEnabled(Boolean(body.enabled));
    setBound(Boolean(body.wechat?.bound));
    setPeer(body.wechat?.peerMasked || "");
  }
  useEffect(() => { void load(); }, []);

  return (
    <div className="card card-pad" style={{ maxWidth: 560, marginTop: 16 }}>
      <h3>{t("channels.bind")}</h3>
      <p className="sub">
        {bound ? t("channels.bound", { peer }) : enabled ? t("channels.unbound") : t("channels.needEnable")}
      </p>
      {err ? <p className="err">{err}</p> : null}
      {code ? (
        <p>
          <code className="mono">{code}</code>{" "}
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => copy(code, t("keys.copied"))}>
            {t("channels.copyCode")}
          </button>
        </p>
      ) : null}
      {code ? <p className="sub">{t("channels.bindHint")}</p> : null}
      <p style={{ margin: "12px 0 0", display: "flex", gap: 8 }}>
        <button
          className="btn btn-sm"
          type="button"
          disabled={!enabled}
          onClick={async () => {
            setErr("");
            const { res, body } = await api<{ code?: string; error?: string }>("/api/me/channels/bind-code", {
              method: "POST",
            });
            if (!res.ok || !body.code) {
              setErr(body.error || t("channels.needEnable"));
              return;
            }
            setCode(body.code);
          }}
        >
          {t("channels.bind")}
        </button>
        {bound ? (
          <button
            className="btn btn-sm btn-secondary"
            type="button"
            onClick={async () => {
              await api("/api/me/channels/unbind", { method: "POST" });
              setBound(false);
              setPeer("");
              setCode("");
              await load();
            }}
          >
            {t("channels.unbind")}
          </button>
        ) : null}
      </p>
    </div>
  );
}
