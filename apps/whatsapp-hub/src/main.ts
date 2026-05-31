import "./index.css";
import {
  initBv, bvApi, makeToast, type BvToastFn,
  mountShell, statRow, dataTable, card, flash,
  relTime, pill, emptyState, h, iconEl,
} from "./bv-init";

interface WaState { state: string; qr: string | null; phone: string | null; available: boolean; error: string | null; }
interface Grant { from_app: string; label: string; desc: string; enabled: boolean; }
interface Msg { id: number; from_app: string; from_label: string; to: string | null; body: string | null; status: string; attribution: string | null; error: string | null; created_at: string; sent_at: string | null; }

const root = document.getElementById("root")!;
let toast: BvToastFn;
let merchantName = "Merchant";
let shell: ReturnType<typeof mountShell>;
let qrPoll: any = null;

(async () => {
  let session;
  if (import.meta.env.DEV && !new URLSearchParams(location.search).has("inkress_session")) {
    const m = await import("./dev-mock"); m.installMockFetch(); session = m.mockSession();
  } else {
    try { session = await initBv(); }
    catch (err: any) { root.innerHTML = ""; root.append(fatal(err?.message)); return; }
  }
  toast = makeToast(session.inkress);
  merchantName = session.merchant.name || session.merchant.username || "Merchant";

  shell = mountShell({
    brandIcon: "message",
    brandLogo: "/logo.svg",
    title: "WhatsApp Hub",
    subtitle: `${merchantName} · one WhatsApp connection, shared across your apps`,
    poweredBy: "Marketplace",
    tabs: [
      { id: "connection", label: "Connection", icon: "message", render: renderConnection },
      { id: "permissions", label: "App permissions", icon: "users", render: renderPermissions },
      { id: "activity", label: "Activity", icon: "list", render: renderActivity },
    ],
  });
})();

function stopPoll() { if (qrPoll) { clearInterval(qrPoll); qrPoll = null; } }

/* ----------------------------------------------------------------- Connection */
async function renderConnection(host: HTMLElement) {
  stopPoll();
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let wa: WaState; let stats: any;
  try { wa = await bvApi("/api/whatsapp"); stats = await bvApi("/api/stats").catch(() => ({ sent: 0, queued: 0, blocked: 0, failed: 0 })); }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.innerHTML = "";

  host.append(statRow([
    { k: "Status", v: wa.state === "connected" ? "Connected" : wa.state === "qr" ? "Scan QR" : wa.state === "connecting" ? "Connecting…" : "Not connected", tone: wa.state === "connected" ? "ok" : "accent", icon: "message" },
    { k: "Sent", v: String(stats.sent || 0), tone: "ok", icon: "send" },
    { k: "Queued", v: String(stats.queued || 0), icon: "clock" },
    { k: "Blocked", v: String(stats.blocked || 0), tone: stats.blocked ? "bad" : undefined, icon: "x" },
  ]));

  const body = h("div", { class: "wh-conn" });
  const paint = (s: WaState) => {
    body.innerHTML = "";
    if (!s.available) { body.append(emptyState({ icon: "alert", title: "WhatsApp unavailable", text: "This server can't run the WhatsApp bridge right now. Try again shortly." })); return; }
    if (s.state === "connected") {
      body.append(h("div", { class: "wh-ok" }, iconEl("check", 22),
        h("div", { style: { flex: "1" } }, h("strong", null, "WhatsApp connected"), s.phone ? h("div", { class: "bv-muted" }, "+" + s.phone) : null),
        h("button", { class: "ghost sm", onClick: async () => { await bvApi("/api/whatsapp/logout", { method: "POST" }); shell.select("connection"); } }, "Disconnect")));
      const to = h("input", { placeholder: "Recipient number e.g. 18761234567" }) as HTMLInputElement;
      const msg = h("input", { placeholder: "Message" }) as HTMLInputElement;
      body.append(h("div", { class: "wh-send" },
        h("p", { class: "bv-muted" }, "Send a test message to confirm everything works."),
        h("div", { class: "wh-send-row" }, to, msg, h("button", { class: "primary", onClick: async () => { if (!to.value || !msg.value) { toast("Number and message required", "warning"); return; } try { const r = await bvApi<{ status: string }>("/api/send", { method: "POST", body: JSON.stringify({ to: to.value, body: msg.value }) }); flash(r.status === "sent" ? "Sent ✓" : "Queued", "success"); to.value = ""; msg.value = ""; } catch (err: any) { toast(err?.message || "error", "error"); } } }, iconEl("send", 14), "Send"))));
      return;
    }
    if (s.state === "qr" && s.qr) {
      body.append(h("div", { class: "wh-qr-wrap" },
        h("img", { class: "wh-qr", src: s.qr, alt: "WhatsApp QR" }),
        h("div", { class: "wh-qr-steps" }, h("strong", null, "Link your WhatsApp"),
          h("ol", null, h("li", null, "Open WhatsApp on your phone"), h("li", null, "Settings → Linked devices → Link a device"), h("li", null, "Scan this code")))));
      return;
    }
    body.append(h("div", { class: "wh-start" },
      h("div", { class: "wh-illus" }, iconEl("message", 40)),
      h("p", null, "Connect your business WhatsApp once here. Every app you allow can then message your customers through this single connection — no separate logins, and you see exactly which app sent what."),
      s.error ? h("div", { class: "wh-err" }, iconEl("alert", 14), s.error) : null,
      h("button", { class: "primary", onClick: () => { void start(); } }, iconEl("message", 15), s.state === "connecting" ? "Connecting…" : "Connect WhatsApp")));
  };
  const start = async () => {
    try { const s = await bvApi<WaState>("/api/whatsapp/connect", { method: "POST" }); paint(s); pollUntilConnected(paint); }
    catch (err: any) { toast(err?.message || "Couldn't start", "error"); }
  };
  paint(wa);
  host.append(card({ title: "WhatsApp connection", body }));
  if (wa.state === "qr" || wa.state === "connecting") pollUntilConnected(paint);
}
function pollUntilConnected(paint: (s: WaState) => void) {
  stopPoll();
  qrPoll = setInterval(async () => {
    try { const ns = await bvApi<WaState>("/api/whatsapp"); paint(ns); if (ns.state === "connected") { stopPoll(); flash("WhatsApp connected", "success"); } }
    catch { /* */ }
  }, 2500);
}

/* --------------------------------------------------------------- Permissions */
interface Req { from_app: string; label: string; reason: string | null; attempts: number; requested_at: string }
async function renderPermissions(host: HTMLElement) {
  stopPoll();
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let data: { grants: Grant[] };
  let reqs: Req[] = [];
  try { data = await bvApi("/api/grants"); reqs = (await bvApi<{ requests: Req[] }>("/api/requests").catch(() => ({ requests: [] }))).requests; }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.innerHTML = "";

  // Pending access requests — apps that asked (or tried) to send but aren't granted.
  if (reqs.length) {
    const rlist = h("div", { class: "wh-grants" });
    for (const r of reqs) {
      rlist.append(h("div", { class: "wh-grant wh-req" },
        h("div", { class: "wh-grant-main" }, h("strong", null, r.label), h("div", { class: "bv-muted" }, r.reason || `Wants to message your customers via WhatsApp${r.attempts ? ` · ${r.attempts} attempt${r.attempts === 1 ? "" : "s"} held` : ""}`)),
        h("div", { class: "wh-req-actions" },
          h("button", { class: "ghost sm", onClick: async () => { try { await bvApi(`/api/requests/${r.from_app}/deny`, { method: "POST" }); flash("Request dismissed", "success"); shell.select("permissions"); } catch (err: any) { toast(err?.message || "error", "error"); } } }, "Deny"),
          h("button", { class: "primary sm", onClick: async () => { try { await bvApi("/api/grants", { method: "POST", body: JSON.stringify({ from_app: r.from_app, enabled: true }) }); flash(`${r.label} approved`, "success"); shell.select("permissions"); } catch (err: any) { toast(err?.message || "error", "error"); } } }, "Approve"))));
    }
    host.append(card({ title: `Access requests (${reqs.length})`, body: h("div", null,
      h("p", { class: "bv-muted wh-hint" }, "These apps have asked to message your customers through your WhatsApp. Approve the ones you trust; deny the rest. Nothing sends until you approve."),
      rlist) }));
  }

  const list = h("div", { class: "wh-grants" });
  for (const g of data.grants) {
    const toggle = h("input", { type: "checkbox", checked: g.enabled, onChange: async (e: any) => {
      try { await bvApi("/api/grants", { method: "POST", body: JSON.stringify({ from_app: g.from_app, enabled: e.target.checked }) }); flash(e.target.checked ? `${g.label} can send` : `${g.label} blocked`, "success"); }
      catch (err: any) { toast(err?.message || "error", "error"); e.target.checked = !e.target.checked; }
    } }) as HTMLInputElement;
    list.append(h("div", { class: "wh-grant" },
      h("div", { class: "wh-grant-main" }, h("strong", null, g.label), h("div", { class: "bv-muted" }, g.desc)),
      h("label", { class: "wh-switch" }, toggle, h("span", { class: "wh-slider" }))));
  }
  host.append(card({ title: "Which apps may send via WhatsApp", body: h("div", null,
    h("p", { class: "bv-muted wh-hint" }, "You're in control: an app can only message your customers through this hub when you switch it on. Turn one off any time without affecting the others — every message is logged with the app that sent it."),
    list) }));
}

/* ------------------------------------------------------------------ Activity */
async function renderActivity(host: HTMLElement) {
  stopPoll();
  host.append(h("div", { class: "bv-muted", style: { padding: "12px 2px" } }, "Loading…"));
  let data: { messages: Msg[] };
  try { data = await bvApi("/api/messages"); }
  catch (err: any) { host.innerHTML = ""; host.append(emptyState({ icon: "alert", title: "Couldn't load", text: err?.message })); return; }
  host.innerHTML = "";
  const tone: Record<string, "ok" | "accent" | "bad" | undefined> = { sent: "ok", queued: "accent", claimed: "accent", blocked: "bad", failed: "bad" };
  host.append(card({ title: "Message activity", body: data.messages.length ? dataTable<Msg>({
    columns: [
      { head: "When", cell: (m) => h("span", { class: "bv-muted" }, relTime(m.created_at)) },
      { head: "From app", cell: (m) => h("strong", null, m.from_label) },
      { head: "To", cell: (m) => h("div", null, h("span", null, m.to || "—"), m.body ? h("div", { class: "bv-muted wh-body" }, m.body) : null) },
      { head: "Status", cell: (m) => h("div", null, pill(m.status, tone[m.status]), m.error ? h("div", { class: "bv-muted wh-body" }, m.error) : null) },
    ], rows: data.messages,
  }) : emptyState({ icon: "list", title: "No messages yet", text: "When an allowed app sends a WhatsApp through the hub, it appears here — tagged with the app that sent it." }) }));
}

function fatal(msg?: string) { return h("div", { class: "bv-empty", style: { margin: "40px auto" } }, h("h3", null, "WhatsApp Hub couldn't load"), h("p", null, msg || "Open this app from the Inkress dashboard.")); }
