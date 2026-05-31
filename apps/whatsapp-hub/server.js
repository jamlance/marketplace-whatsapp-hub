import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { mountAppCore } from "@inkress/apps-core";
import * as wa from "./whatsapp.js";
import * as channel from "@inkress/apps-core/channel";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
const VIA_APP = "whatsapp-hub";
const CHANNEL = "whatsapp";
for (const k of ["OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET", "INKRESS_API_BASE"]) {
  if (!process.env[k]) { console.error(`[whatsapp-hub] Missing env: ${k}`); process.exit(1); }
}

// Apps that may route WhatsApp through this hub. The merchant grants each one;
// nothing sends without an enabled grant. `from_app` matches the sender app's
// own handle (what it passes as fromApp when calling channel.enqueue).
const SENDERS = [
  { from_app: "order-updates", label: "Order Update Messages", desc: "Order status notifications" },
  { from_app: "birthday-promotions", label: "Birthday Promotions", desc: "Birthday offers" },
  { from_app: "back-in-stock", label: "Back-in-Stock Alerts", desc: "Restock notifications" },
  { from_app: "get-it-sent", label: "Get It Sent", desc: "Delivery booking updates" },
  { from_app: "whatsapp-hub", label: "This app (manual sends)", desc: "Messages you send from here" },
];
const SENDER_LABEL = Object.fromEntries(SENDERS.map((s) => [s.from_app, s.label]));

await channel.initChannel().catch((e) => console.error(`[whatsapp-hub] channel init: ${e?.message}`));

const app = express();
const core = mountAppCore(app, {
  clientId: process.env.OAUTH_CLIENT_ID, clientSecret: process.env.OAUTH_CLIENT_SECRET,
  apiBaseUrl: process.env.INKRESS_API_BASE, frameAncestors: process.env.FRAME_ANCESTORS,
  staticDir: path.join(__dirname, "dist"),
});

const waState = (mid) => { const st = wa.stateFor(mid); return { state: st.state, qr: st.qr, phone: st.phone, available: st.available, error: st.error || null }; };

app.get("/api/config", core.requireSession, async (req, res) => {
  const mid = req.session.merchantId;
  // Self-grant for manual sends is always on.
  await channel.setGrant({ merchantId: mid, fromApp: VIA_APP, viaApp: VIA_APP, channel: CHANNEL, enabled: true, label: "Manual" }).catch(() => {});
  res.json({ whatsapp: waState(mid), senders: SENDERS, via_app: VIA_APP, channel: CHANNEL });
});

/* ---- WhatsApp pairing ---- */
app.get("/api/whatsapp", core.requireSession, async (req, res) => res.json(waState(req.session.merchantId)));
app.post("/api/whatsapp/connect", core.requireSession, async (req, res) => {
  try { const st = await wa.connect(req.session.merchantId); res.json({ ...st, available: wa.isAvailable() }); }
  catch (err) { res.status(500).json({ state: "error", available: false, error: err?.message || "WhatsApp is unavailable on this server." }); }
});
app.post("/api/whatsapp/logout", core.requireSession, async (req, res) => {
  await wa.disconnect(req.session.merchantId).catch(() => {});
  res.json({ state: "idle", available: wa.isAvailable() });
});

/* ---- Grants (which apps may send) ---- */
app.get("/api/grants", core.requireSession, async (req, res) => {
  const mid = req.session.merchantId;
  const rows = await channel.listGrants(mid, VIA_APP);
  const byApp = Object.fromEntries(rows.map((r) => [r.from_app, r]));
  const grants = SENDERS.map((s) => ({ from_app: s.from_app, label: s.label, desc: s.desc, enabled: byApp[s.from_app] ? byApp[s.from_app].enabled === true : (s.from_app === VIA_APP) }));
  res.json({ grants });
});
app.post("/api/grants", core.requireSession, async (req, res) => {
  const b = req.body || {};
  if (!b.from_app) return res.status(400).json({ error: "no_app" });
  const g = await channel.setGrant({ merchantId: req.session.merchantId, fromApp: String(b.from_app), viaApp: VIA_APP, channel: CHANNEL, enabled: b.enabled !== false, label: SENDER_LABEL[b.from_app] || null });
  res.json({ grant: { from_app: g.from_app, enabled: g.enabled === true } });
});

/* ---- Pending access requests (apps that asked / tried to send, not yet granted) ---- */
app.get("/api/requests", core.requireSession, async (req, res) => {
  const rows = await channel.pendingRequests(req.session.merchantId, VIA_APP);
  res.json({ requests: rows.map((r) => ({ from_app: r.from_app, label: SENDER_LABEL[r.from_app] || r.label || r.from_app, reason: r.reason, attempts: r.attempts, requested_at: r.requested_at })) });
});
app.post("/api/requests/:fromApp/deny", core.requireSession, async (req, res) => {
  await channel.dismissRequest({ merchantId: req.session.merchantId, fromApp: req.params.fromApp, viaApp: VIA_APP, channel: CHANNEL });
  res.json({ ok: true });
});

/* ---- Manual send (also exercises the channel end-to-end) ---- */
app.post("/api/send", core.requireSession, async (req, res) => {
  const b = req.body || {};
  const to = String(b.to || "").trim(); const body = String(b.body || "").trim();
  if (!to || !body) return res.status(400).json({ error: "bad_input", message: "Recipient number and message are required." });
  const r = await channel.enqueue({ merchantId: req.session.merchantId, fromApp: VIA_APP, viaApp: VIA_APP, channel: CHANNEL, to, body, meta: { manual: true } });
  // Try an immediate flush so the merchant sees instant feedback.
  await processOutbox().catch(() => {});
  res.json({ queued: true, id: r.id, status: r.status });
});

/* ---- Message log + stats (attribution) ---- */
app.get("/api/messages", core.requireSession, async (req, res) => {
  const rows = await channel.recentMessages(req.session.merchantId, VIA_APP, 150);
  res.json({ messages: rows.map((m) => ({ id: m.id, from_app: m.from_app, from_label: SENDER_LABEL[m.from_app] || m.from_app, to: m.to_addr, body: m.body, status: m.status, attribution: m.attribution, error: m.error, created_at: m.created_at, sent_at: m.sent_at })) });
});
app.get("/api/stats", core.requireSession, async (req, res) => {
  const s = await channel.channelStats(req.session.merchantId, VIA_APP);
  res.json({ ...s, connected: wa.isConnected(req.session.merchantId) });
});

/* ---- Channel processor: deliver queued WhatsApp messages from granted apps ---- */
let processing = false;
async function processOutbox() {
  if (processing) return; processing = true;
  try {
    await channel.requeueStale({ viaApp: VIA_APP, channel: CHANNEL, staleSeconds: 300 }).catch(() => {});
    const batch = await channel.claim({ viaApp: VIA_APP, channel: CHANNEL, limit: 25 });
    for (const m of batch) {
      try {
        await wa.ensure(m.merchant_id).catch(() => {});
        if (!wa.isConnected(m.merchant_id)) { await channel.markFailed(m.id, "WhatsApp not paired for this merchant"); continue; }
        const sent = await wa.send(m.merchant_id, m.to_addr, m.body);
        await channel.markSent(m.id, SENDER_LABEL[m.from_app] || m.from_app, sent?.messageId || null);
      } catch (err) { await channel.markFailed(m.id, err?.message || "send failed"); }
    }
  } catch (err) { console.error(`[whatsapp-hub] processOutbox: ${err?.message}`); }
  finally { processing = false; }
}
setInterval(() => { processOutbox().catch(() => {}); }, 20 * 1000);
setTimeout(() => { processOutbox().catch(() => {}); }, 8000);

core.mountSpaFallback();
app.listen(PORT, HOST, () => console.log(`[whatsapp-hub] listening on ${HOST}:${PORT}`));
