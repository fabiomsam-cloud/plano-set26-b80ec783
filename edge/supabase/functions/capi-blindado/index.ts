// CAPI · Checkout Blindado — Meta Conversions API server-side (SOU Data Core)
// Lead:     campaign_events (event_type='checkout_blindado') → pixel do produto da página
// Purchase: hubla_invoices (status='Paga', paid_at >= 05/09/2026) → pixel do produto
// Idempotência: capi_events_sent (unique source_table+source_id+event_name). Nunca reenvia.
// Agendado: pg_cron a cada 5 min via pg_net. Manual: GET ?k=<CAPI_CRON_KEY> (&dry=1 p/ simular, &test=<code> p/ Eventos de Teste)
// Regra permanente 07/09/2026: toda campanha de blindado roda com CAPI.
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const META_TOKEN = Deno.env.get("METACAPI_TOKEN") ?? "";
const CRON_KEY = Deno.env.get("CAPI_CRON_KEY") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

// ============================================================================
// MAPA PRODUTO → PIXEL (v1) — PARA ADICIONAR PRODUTO NOVO, acrescente uma linha:
//  - pixel_id: pixel da conta dona da campanha (o token precisa ter acesso);
//  - product_contains: trechos do product_name da Hubla (comparados em UPPERCASE) → Purchase;
//  - page_contains: trechos do PATHNAME da landing_page_url (lowercase) → Lead.
// ATENÇÃO: o match de página usa SÓ o pathname (nunca a query string — utm_campaign
// de outras campanhas pode conter o slug de outro produto, ex. SEDUC-PA carrega
// "elite-seduc-am-perpetuo" no utm_campaign). Ordem importa: primeiro match vence.
// QUIZ-PRF (08/09/2026): Lead SÓ do lead qualificado — a página do quiz registra o
// caminho virtual /qualificado-superior no origin_url de quem tem superior/cursando;
// ensino médio fica com o pathname puro e nunca casa. Purchase = ingresso PROFISSÃO PRF.
// Aguardando entrada futura: Play Passei.
// ============================================================================
const PRODUCT_MAP: { key: string; pixel_id: string; product_contains: string[]; page_contains: string[] }[] = [
  { key: "TJ-AM",    pixel_id: "639941435037052", product_contains: ["TRIBUNAL DE JUSTI", "TJ"],  page_contains: ["tribunal-de-justica"] },
  { key: "SEDUC-AM", pixel_id: "429553154418122", product_contains: ["SEDUC-AM", "SEDUC AM"],     page_contains: ["elite-seduc-am"] },
  { key: "SEMSA",    pixel_id: "429553154418122", product_contains: ["SEMSA"],                     page_contains: ["elite-semsa-am"] },
  { key: "QUIZ-PRF", pixel_id: "297518201669282", product_contains: ["PROFISSÃO PRF", "PROFISSAO PRF"], page_contains: ["quiz-prf-9f45f5f3/qualificado"] },
];

const PURCHASE_SINCE = "2026-09-05T00:00:00-04:00"; // corte fixo (Manaus) do backlog de Purchases
const LEAD_WINDOW_DAYS = 7;                          // backlog de Leads (primeira carga e janela contínua)
const MAX_AGE_S = Math.floor(6.9 * 86400);           // Meta rejeita eventos com mais de 7 dias

function productByName(name: string | null) {
  const up = (name ?? "").toUpperCase();
  return PRODUCT_MAP.find((p) => p.product_contains.some((s) => up.includes(s))) ?? null;
}

function productByPage(url: string | null) {
  if (!url) return null;
  let path = url;
  try { path = new URL(url).pathname; } catch { /* URL malformada: usa a parte antes do ? */ path = url.split("?")[0]; }
  path = path.toLowerCase();
  return PRODUCT_MAP.find((p) => p.page_contains.some((s) => path.includes(s))) ?? null;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normPhone(raw: string): string {
  let p = (raw || "").replace(/\D/g, "");
  if (p.startsWith("55") && p.length > 11) p = p.slice(2);
  return p;
}

function fbcFromClid(fbclid: string, atMs: number): string {
  return `fb.1.${atMs}.${fbclid}`;
}

function fbclidFromUrl(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).searchParams.get("fbclid"); } catch { return null; }
}

type UserData = Record<string, unknown>;

async function buildUserData(email?: string | null, phone?: string | null, fbp?: string | null, fbc?: string | null): Promise<UserData> {
  const ud: UserData = {};
  const em = (email ?? "").trim().toLowerCase();
  const ph = normPhone(phone ?? "");
  if (em) ud.em = [await sha256(em)];
  if (ph) ud.ph = [await sha256("55" + ph)];
  if (fbp) ud.fbp = fbp;
  if (fbc) ud.fbc = fbc;
  return ud;
}

async function sendToMeta(pixelId: string, event: Record<string, unknown>, testCode: string | null) {
  const res = await fetch(`${GRAPH}/${pixelId}/events?access_token=${META_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [event], ...(testCode ? { test_event_code: testCode } : {}) }),
  });
  const body = await res.json().catch(() => ({ raw: "unparseable" }));
  return { ok: res.ok, status: res.status, body };
}

// Registra na tabela de controle (upsert ignorando duplicata = corrida segura).
async function record(source_table: string, source_id: string, event_name: string, pixel_id: string | null, event_id: string, response: unknown) {
  const { error } = await db.from("capi_events_sent").upsert(
    { source_table, source_id, event_name, pixel_id, event_id, response },
    { onConflict: "source_table,source_id,event_name", ignoreDuplicates: true },
  );
  if (error) console.error("capi_events_sent", source_table, source_id, error.message);
}

async function alreadySent(source_table: string, event_name: string, ids: string[]): Promise<Set<string>> {
  const sent = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await db.from("capi_events_sent")
      .select("source_id").eq("source_table", source_table).eq("event_name", event_name).in("source_id", chunk);
    if (error) throw new Error("alreadySent: " + error.message);
    for (const r of data ?? []) sent.add(r.source_id as string);
  }
  return sent;
}

// ---------------------------------------------------------------------------
// LEAD ← campaign_events (checkout blindado)
// ---------------------------------------------------------------------------
async function processLeads(dry: boolean, testCode: string | null) {
  const sinceIso = new Date(Date.now() - LEAD_WINDOW_DAYS * 86400_000).toISOString();
  const { data: events, error } = await db.from("campaign_events")
    .select("id, lead_id, fbclid, landing_page_url, raw_payload, created_at")
    .eq("event_type", "checkout_blindado")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw new Error("campaign_events: " + error.message);

  const sent = await alreadySent("campaign_events", "Lead", (events ?? []).map((e) => e.id as string));
  const pending = (events ?? []).filter((e) => !sent.has(e.id as string));

  // dados de contato faltantes → busca no leads
  const leadIds = [...new Set(pending.map((e) => e.lead_id).filter(Boolean))] as string[];
  const leadById = new Map<string, { email: string | null; phone: string | null }>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data } = await db.from("leads").select("id, email, phone").in("id", leadIds.slice(i, i + 200));
    for (const l of data ?? []) leadById.set(l.id as string, { email: l.email, phone: l.phone });
  }

  const out = { sent: 0, skipped_unmapped: 0, skipped_no_user_data: 0, skipped_too_old: 0, errors: 0, samples: [] as unknown[] };
  for (const ev of pending) {
    const prod = productByPage(ev.landing_page_url as string | null);
    if (!prod) { out.skipped_unmapped++; continue; } // não registra: produto pode entrar no mapa depois

    const atMs = Date.parse(ev.created_at as string);
    const ageS = Math.floor((Date.now() - atMs) / 1000);
    if (ageS > MAX_AGE_S) { out.skipped_too_old++; continue; }

    const dados = (ev.raw_payload as { dados?: Record<string, string> } | null)?.dados ?? {};
    const fromLead = ev.lead_id ? leadById.get(ev.lead_id as string) : undefined;
    const email = dados.email || fromLead?.email || null;
    const phone = dados.phone || dados.whatsapp || fromLead?.phone || null;
    const fbclid = (ev.fbclid as string | null) || fbclidFromUrl(ev.landing_page_url as string | null);
    const fbc = (dados.fbc as string | undefined) || (fbclid ? fbcFromClid(fbclid, atMs) : null);
    const fbp = (dados.fbp as string | undefined) || (dados._fbp as string | undefined) || null;

    const user_data = await buildUserData(email, phone, fbp, fbc);
    if (!user_data.em && !user_data.ph) {
      out.skipped_no_user_data++;
      await record("campaign_events", ev.id as string, "Lead", prod.pixel_id, "lead-" + ev.id, { skipped: "no_user_data" });
      continue;
    }

    const event = {
      event_name: "Lead",
      event_time: Math.floor(atMs / 1000),
      event_id: "lead-" + ev.id,
      action_source: "website",
      event_source_url: ev.landing_page_url ?? undefined,
      user_data,
    };
    if (dry) { out.samples.push({ pixel: prod.pixel_id, produto: prod.key, event }); continue; }

    try {
      const res = await sendToMeta(prod.pixel_id, event, testCode);
      await record("campaign_events", ev.id as string, "Lead", prod.pixel_id, "lead-" + ev.id, res.body);
      if (res.ok) out.sent++;
      else { out.errors++; out.samples.push({ pixel: prod.pixel_id, produto: prod.key, event_id: "lead-" + ev.id, meta_error: res.body }); }
      if (out.samples.length < 3 && res.ok) out.samples.push({ pixel: prod.pixel_id, produto: prod.key, event_id: "lead-" + ev.id, meta: res.body });
    } catch (e) {
      // exceção de rede: NÃO registra → tenta de novo na próxima execução
      out.errors++;
      console.error("Lead fetch", ev.id, e);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PURCHASE ← hubla_invoices (Paga, produtos do mapa)
// ---------------------------------------------------------------------------
async function processPurchases(dry: boolean, testCode: string | null) {
  const windowIso = new Date(Date.now() - 7 * 86400_000).toISOString();
  const since = PURCHASE_SINCE > windowIso ? PURCHASE_SINCE : windowIso; // janela móvel, nunca antes do corte
  const orFilter = PRODUCT_MAP
    .flatMap((p) => p.product_contains)
    .map((s) => `product_name.ilike."%${s}%"`)
    .join(",");
  const { data: invoices, error } = await db.from("hubla_invoices")
    .select("invoice_id, product_name, paid_at, total_value, customer_email, customer_phone, fbclid, fbc, fbp, purchase_url, lead_id, invoice_detail, smart_installment_current")
    .eq("status", "Paga")
    .gte("paid_at", since)
    .or(orFilter)
    .order("paid_at", { ascending: true })
    .limit(500);
  if (error) throw new Error("hubla_invoices: " + error.message);

  const sent = await alreadySent("hubla_invoices", "Purchase", (invoices ?? []).map((i) => i.invoice_id as string));
  // 11/09 (OK do Fábio): parcela 2ª+ de contrato antigo NÃO é compra — mandar como Purchase fazia a Meta
  // "atribuir" mensalidades de alunos (público morno-quente) aos anúncios e otimizar pelo sinal errado
  // (07–11/09: 39 de 63 Purchases no pixel TJ eram parcelas). Só a 1ª cobrança do contrato conta.
  const isRecorrencia = (i: Record<string, unknown>) =>
    i.invoice_detail === "Pagamento de uma parcela" ||
    (i.smart_installment_current != null && Number(i.smart_installment_current) >= 2);
  const pending = (invoices ?? []).filter((i) => !sent.has(i.invoice_id as string) && !isRecorrencia(i));

  const out = { sent: 0, skipped_unmapped: 0, skipped_no_user_data: 0, skipped_too_old: 0, errors: 0, samples: [] as unknown[] };
  for (const inv of pending) {
    const prod = productByName(inv.product_name as string | null);
    if (!prod) { out.skipped_unmapped++; continue; }

    const atMs = Date.parse(inv.paid_at as string);
    const ageS = Math.floor((Date.now() - atMs) / 1000);
    if (ageS > MAX_AGE_S) {
      out.skipped_too_old++;
      await record("hubla_invoices", inv.invoice_id as string, "Purchase", prod.pixel_id, inv.invoice_id as string, { skipped: "too_old_for_meta" });
      continue;
    }

    // fbc/fbp: da fatura; senão fbclid da fatura; senão o último fbclid do lead casado
    let fbc = (inv.fbc as string | null) || null;
    let fbp = (inv.fbp as string | null) || null;
    if (!fbc) {
      const clid = (inv.fbclid as string | null) || fbclidFromUrl(inv.purchase_url as string | null);
      if (clid) fbc = fbcFromClid(clid, atMs);
    }
    if (!fbc || !fbp) {
      let leadId = inv.lead_id as string | null;
      if (!leadId && inv.customer_email) {
        const { data: l } = await db.from("leads").select("id").ilike("email", (inv.customer_email as string).trim()).limit(1);
        leadId = (l?.[0]?.id as string | undefined) ?? null;
      }
      if (leadId && !fbc) {
        const { data: ce } = await db.from("campaign_events")
          .select("fbclid, created_at").eq("lead_id", leadId).not("fbclid", "is", null)
          .order("created_at", { ascending: false }).limit(1);
        const hit = ce?.[0];
        if (hit?.fbclid) fbc = fbcFromClid(hit.fbclid as string, Date.parse(hit.created_at as string));
      }
    }

    const user_data = await buildUserData(inv.customer_email as string | null, inv.customer_phone as string | null, fbp, fbc);
    if (!user_data.em && !user_data.ph) {
      out.skipped_no_user_data++;
      await record("hubla_invoices", inv.invoice_id as string, "Purchase", prod.pixel_id, inv.invoice_id as string, { skipped: "no_user_data" });
      continue;
    }

    const event = {
      event_name: "Purchase",
      event_time: Math.floor(atMs / 1000),
      event_id: inv.invoice_id, // MESMO event_id do pixel do navegador da Hubla → dedup
      action_source: "website",
      event_source_url: inv.purchase_url ?? undefined,
      user_data,
      custom_data: { currency: "BRL", value: Number(inv.total_value ?? 0) },
    };
    if (dry) { out.samples.push({ pixel: prod.pixel_id, produto: prod.key, event }); continue; }

    try {
      const res = await sendToMeta(prod.pixel_id, event, testCode);
      await record("hubla_invoices", inv.invoice_id as string, "Purchase", prod.pixel_id, inv.invoice_id as string, res.body);
      if (res.ok) out.sent++;
      else { out.errors++; out.samples.push({ pixel: prod.pixel_id, produto: prod.key, event_id: inv.invoice_id, meta_error: res.body }); }
      if (out.samples.length < 3 && res.ok) out.samples.push({ pixel: prod.pixel_id, produto: prod.key, event_id: inv.invoice_id, meta: res.body });
    } catch (e) {
      out.errors++;
      console.error("Purchase fetch", inv.invoice_id, e);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  const url = new URL(req.url);
  const k = url.searchParams.get("k") ?? "";
  if (!CRON_KEY || k !== CRON_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  if (!META_TOKEN) {
    return new Response(JSON.stringify({ error: "METACAPI_TOKEN ausente" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  const dry = url.searchParams.get("dry") === "1";
  const testCode = url.searchParams.get("test");

  try {
    const leads = await processLeads(dry, testCode);
    const purchases = await processPurchases(dry, testCode);
    return new Response(JSON.stringify({ ok: true, dry, leads, purchases }, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("capi-blindado", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
