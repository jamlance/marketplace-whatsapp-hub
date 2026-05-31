/** DEV-ONLY preview harness — tree-shaken from prod. */
import type { BvSession } from "./bv-init";

const SENDERS = [
  { from_app: "order-updates", label: "Order Update Messages", desc: "Order status notifications" },
  { from_app: "birthday-promotions", label: "Birthday Promotions", desc: "Birthday offers" },
  { from_app: "back-in-stock", label: "Back-in-Stock Alerts", desc: "Restock notifications" },
  { from_app: "get-it-sent", label: "Get It Sent", desc: "Delivery booking updates" },
  { from_app: "whatsapp-hub", label: "This app (manual sends)", desc: "Messages you send from here" },
];
let GRANTS: Record<string, boolean> = { "order-updates": true, "birthday-promotions": true, "back-in-stock": false, "get-it-sent": false, "whatsapp-hub": true };
let REQS: any[] = [
  { from_app: "back-in-stock", label: "Back-in-Stock Alerts", reason: null, attempts: 3, requested_at: new Date(Date.now() - 36e5).toISOString() },
  { from_app: "get-it-sent", label: "Get It Sent", reason: "Notify customers when their delivery is on the way", attempts: 1, requested_at: new Date(Date.now() - 8 * 36e5).toISOString() },
];
let WA: any = { state: "connected", qr: null, phone: "18765550101", available: true, error: null };
let MSGS: any[] = [
  { id: 4, from_app: "order-updates", from_label: "Order Update Messages", to: "18765557781", body: "Your order ORD-2207 is out for delivery 🛵", status: "sent", attribution: "Order Update Messages", error: null, created_at: new Date(Date.now() - 12 * 6e4).toISOString(), sent_at: new Date(Date.now() - 12 * 6e4).toISOString() },
  { id: 3, from_app: "birthday-promotions", from_label: "Birthday Promotions", to: "18765552210", body: "Happy birthday! 15% off this week 🎉", status: "sent", attribution: "Birthday Promotions", error: null, created_at: new Date(Date.now() - 3 * 36e5).toISOString(), sent_at: new Date(Date.now() - 3 * 36e5).toISOString() },
  { id: 2, from_app: "back-in-stock", from_label: "Back-in-Stock Alerts", to: "18765559930", body: "Item back in stock", status: "blocked", attribution: null, error: null, created_at: new Date(Date.now() - 5 * 36e5).toISOString(), sent_at: null },
  { id: 1, from_app: "whatsapp-hub", from_label: "This app (manual sends)", to: "18765550000", body: "Test message", status: "failed", attribution: null, error: "WhatsApp not paired for this merchant", created_at: new Date(Date.now() - 26 * 36e5).toISOString(), sent_at: null },
];
let MID = 4;

export function installMockFetch() {
  window.fetch = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url, location.origin);
    const body = init.body ? JSON.parse(init.body) : {};
    const json = (d: any, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });
    await new Promise((r) => setTimeout(r, 70));

    if (u.pathname === "/api/config") return json({ whatsapp: WA, senders: SENDERS, via_app: "whatsapp-hub", channel: "whatsapp" });
    if (u.pathname === "/api/whatsapp" && method === "GET") return json(WA);
    if (u.pathname === "/api/whatsapp/connect") { WA = { state: "qr", qr: "https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=wa-link-demo", phone: null, available: true, error: null }; setTimeout(() => { WA = { state: "connected", qr: null, phone: "18765550101", available: true, error: null }; }, 4000); return json(WA); }
    if (u.pathname === "/api/whatsapp/logout") { WA = { state: "idle", qr: null, phone: null, available: true, error: null }; return json(WA); }
    if (u.pathname === "/api/grants" && method === "GET") return json({ grants: SENDERS.map((s) => ({ ...s, enabled: !!GRANTS[s.from_app] })) });
    if (u.pathname === "/api/grants" && method === "POST") { GRANTS[body.from_app] = body.enabled !== false; REQS = REQS.filter((r) => r.from_app !== body.from_app); return json({ grant: { from_app: body.from_app, enabled: GRANTS[body.from_app] } }); }
    if (u.pathname === "/api/requests" && method === "GET") return json({ requests: REQS });
    const dm = u.pathname.match(/\/api\/requests\/([^/]+)\/deny/);
    if (dm) { REQS = REQS.filter((r) => r.from_app !== dm[1]); return json({ ok: true }); }
    if (u.pathname === "/api/send") { const st = WA.state === "connected" ? "sent" : "failed"; MSGS.unshift({ id: ++MID, from_app: "whatsapp-hub", from_label: "This app (manual sends)", to: body.to, body: body.body, status: st, attribution: st === "sent" ? "Manual" : null, error: st === "sent" ? null : "WhatsApp not paired", created_at: new Date().toISOString(), sent_at: st === "sent" ? new Date().toISOString() : null }); return json({ queued: true, id: MID, status: st }); }
    if (u.pathname === "/api/messages") return json({ messages: MSGS });
    if (u.pathname === "/api/stats") { let sent = 0, queued = 0, blocked = 0, failed = 0; for (const m of MSGS) { if (m.status === "sent") sent++; else if (m.status === "blocked") blocked++; else if (m.status === "queued" || m.status === "claimed") queued++; else if (m.status === "failed") failed++; } return json({ sent, queued, blocked, failed, by_app: [], connected: WA.state === "connected" }); }
    return new Response("{}", { status: 404 });
  };
}

export function mockSession(): BvSession {
  return {
    inkress: { notify: ({ message }: any) => console.log("[toast]", message) } as any,
    merchant: { id: 183, username: "island-threads", name: "Island Threads", currency_code: "JMD", email: "hello@islandthreads.jm", logo: null },
    user: { id: 90, name: "Owner", email: "owner@islandthreads.jm" },
    scopes: ["merchant_profile:read"],
  };
}
