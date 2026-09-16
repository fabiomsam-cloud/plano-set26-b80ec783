// PAINEL DO PLANO SETEMBRO/2026 · edge function dashboard-plano (SOU Data Core)
// Token no ?k= (rotacionar = trocar aqui + no index.html do repo plano-set26-*).
// Fuso: dias SEMPRE em America/Manaus (-04, sem DST). Receita = net_value (líquida).
// Bloco "campanhas": Graph API v21.0 com secret METAADS_TOKEN (NUNCA expor no front),
// cache em memória de 10 min só para a parte Meta; cruzamentos de banco sempre frescos.
// Espelho local: repo plano-set26 /edge/dashboard-plano.index.ts (deploy via MCP).
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN = "plano-sou-758a5e2b";
const SET_INI_ISO = "2026-09-01T04:00:00.000Z"; // 01/09 00:00 em Manaus (-04)
const GRAPH = "https://graph.facebook.com/v21.0";

// Campanhas do plano (id Meta → identidade mínima; o resto vive no front)
// ec = utm_campaign carimbada pelas páginas do Estude Comigo (Fase 3) → cadastros qualificados no banco
const CAMPANHAS_PLANO: { id: string; conta: string; ec?: string }[] = [
  { id: "52664735806028", conta: "SCVP TRIBUNAIS" },      // [PLANO][FASE2][TJAM] consciência
  { id: "120256295402120492", conta: "SCVP ON-LINE" },    // [PLANO][FASE2][SEDUCAM]
  { id: "52664735869628", conta: "SCVP TRIBUNAIS" },      // [PLANO][FASE2][SEDUCPA]
  { id: "120256295405940492", conta: "SCVP ON-LINE" },    // [PLANO][FASE2][POLICIAS] @deltafabiosilva
  { id: "120256295408100492", conta: "SCVP ON-LINE" },    // [PLANO][FASE2][PRF] @deltafabiosilva
  { id: "52665102440428", conta: "SCVP TRIBUNAIS", ec: "fase3_tjam_ec_set26" },       // [PLANO][FASE3][TJAM]
  { id: "120256316109260492", conta: "SCVP ON-LINE", ec: "fase3_seducam_ec_set26" },  // [PLANO][FASE3][SEDUCAM]
  { id: "52665102467028", conta: "SCVP TRIBUNAIS", ec: "fase3_seducpa_ec_set26" },    // [PLANO][FASE3][SEDUCPA]
  { id: "120256389359590492", conta: "SCVP ON-LINE", ec: "fase3_policias_ec_set26" }, // [PLANO][FASE3][POLICIAS] @deltafabiosilva (ativa 16/09 00h20)
  { id: "120249755892890307", conta: "SPOTFABIO" },       // Play Passei · VSL vertical (11/09, CBO R$ 200)
  { id: "52664037551228", conta: "SCVP TRIBUNAIS" },      // [PLANO][BLINDADO][TJAM]
  { id: "120256238530960492", conta: "SCVP ON-LINE" },    // [PLANO][BLINDADO][SEDUCAM]
  { id: "120256238532240492", conta: "SCVP ON-LINE" },    // [PLANO][BLINDADO][SEMSA]
  { id: "52663791462228", conta: "SCVP TRIBUNAIS" },      // [WEB][TJAM][CADASTRO]
  { id: "52663860728228", conta: "SCVP TRIBUNAIS" },      // [WEB][SEDUCPA][CADASTRO]
  { id: "52664345880028", conta: "SCVP TRIBUNAIS" },      // [WEB][SEDUCAM][CADASTRO]
  { id: "120256186603360492", conta: "SCVP ON-LINE" },    // PRF PV07
  { id: "120256234659840492", conta: "SCVP ON-LINE" },    // PRF PV11
  { id: "120248542127820307", conta: "SPOTFABIO" },       // PP rt-venda frio LAL
  { id: "120248254735440307", conta: "SPOTFABIO" },       // PP [PP][LOW] VD01 PRF
  { id: "120241374284320307", conta: "SPOTFABIO" },       // PP VSL 23/03
  { id: "120241274472180307", conta: "SPOTFABIO" },       // PP VSL 21/03
];

// Contest code da plataforma SOU Webinário → chave canônica do painel.
// O seducam foi criado com code "seduc_amazonas"; o front (e o bloco de compras
// por UTM) usam SEDUC_AM — sem este alias o funil do SEDUC-AM não aparece.
const CODE_ALIAS: Record<string, string> = { seduc_amazonas: "SEDUC_AM" };

// Públicos "assistiu 75%" combinados da Fase 2 (só INFORMAR o tamanho — nunca entram sozinhos na Fase 3)
// Rótulo do painel → id do público. Tamanho gravado 1×/dia em meta_audience_sizes (crescimento no painel).
const AUDIENCIAS_75: Record<string, string> = {
  TJAM: "52664992503628", SEDUC_AM: "120256310128410492", SEDUC_PA: "52665092616628",
  POLICIAS: "120256316453610492", PRF: "120256318021350492",
  POLICIAS_ORG: "120256353644610492", // reels orgânicos @deltafabiosilva (criado pelo Fábio 13/09; mídias 18093450371440696, 18114700763048461, 17888368773458032)
};
const AUD_LABEL: Record<string, string> = {
  TJAM: "TJ-AM · Fase 2", SEDUC_AM: "SEDUC-AM · Fase 2", SEDUC_PA: "SEDUC-PA · Fase 2",
  POLICIAS: "Polícias AM · Fase 2", PRF: "PRF · Fase 2", POLICIAS_ORG: "Polícias AM · reels orgânicos",
};

// ---- Sendflow (API REST oficial: https://sendflow.pro/sendapi · Authorization: Bearer <SENDFLOW_API_KEY>)
// Releases do Estude Comigo por frente. Leitura ao vivo com cache de 10 min; cada leitura boa também é gravada
// em sendflow_releases_snapshot / sendflow_grupos_snapshot (fallback quando a API falha ou a chave falta).
const SENDFLOW_API = "https://sendflow.pro/sendapi";
const SF_RELEASES: { id: string; frente: string; nome: string; bloqueada?: boolean }[] = [
  { id: "mXoF03n6WZ2bEehyuNt9", frente: "TJAM", nome: "🎯TJ-AM: GRUPO DE ESTUDOS (grupos de agosto · oficial)" },
  { id: "pHasARlCZ391RSiVkLkr", frente: "TJAM", nome: "ESTUDE COMIGO TJ-AM", bloqueada: true },
  { id: "HChLcxInLc0aWS8ORS98", frente: "SEDUC_AM", nome: "ESTUDE COMIGO SEDUC-AM" },
  { id: "KLE3SEidOXAu1OzY24gi", frente: "SEDUC_PA", nome: "ESTUDE COMIGO SEDUC-PA" },
  { id: "fRiCa8jorZXLuQq20ywu", frente: "POLICIAS", nome: "ESTUDE COMIGO POLÍCIAS AM" },
  { id: "1KA9so23JVS0o7A9AZyR", frente: "PRF", nome: "ESTUDE COMIGO PRF" },
];
type SfGroup = { gid: string; name: string; count: number | null; participantsAmount: number | null; full: boolean | null };
type SfAnalytics = { add?: { total?: number; dates?: Record<string, number> }; remove?: { total?: number }; clicks?: { total?: number; dates?: Record<string, number> } };
let SF_CACHE: { t: number; releases: Record<string, unknown>[]; grupos: Record<string, unknown>[] } | null = null;
let SF_ERRO = "";  // último erro da API (sem segredo), exposto no painel p/ diagnóstico
let SF_BLOQUEADA_ATE = 0;  // ms — a Sendflow devolve 403 api-key-blocked com retryAfterMs; não insistir antes disso
const SF_TTL_MS = 10 * 60_000;
async function sfGet<T>(key: string, path: string): Promise<T | null> {
  const r = await fetch(SENDFLOW_API + path, { headers: { Authorization: "Bearer " + key, Accept: "application/json" } });
  if (r.status === 404) return null;
  if (!r.ok) {
    const body = (await r.text()).slice(0, 160);
    try { const j = JSON.parse(body); if (j?.retryAfterMs) SF_BLOQUEADA_ATE = Date.now() + Number(j.retryAfterMs); } catch { /* corpo não-JSON */ }
    throw new Error(`Sendflow ${path} HTTP ${r.status}: ${body}`);
  }
  return await r.json() as T;
}
async function lerSendflow(key: string) {
  const hoje = hojeManaus();                                // AAAA-MM-DD
  const ddmmaaaa = hoje.slice(8, 10) + hoje.slice(5, 7) + hoje.slice(0, 4); // chave das datas do analytics
  const releases: Record<string, unknown>[] = [], grupos: Record<string, unknown>[] = [];
  const at = new Date().toISOString();
  for (const rel of SF_RELEASES) {
    // em série, com pausa curta — a API bloqueia a chave por 30 min quando recebe rajadas
    const g = await sfGet<{ items?: SfGroup[] } | SfGroup[]>(key, `/releases/${rel.id}/groups`);
    await new Promise((res) => setTimeout(res, 400));
    const a = await sfGet<SfAnalytics>(key, `/releases/${rel.id}/analytics`);
    await new Promise((res) => setTimeout(res, 400));
    if (!g) continue;                                       // release não existe mais
    const items = Array.isArray(g) ? g : (g.items ?? []);
    for (const it of items) grupos.push({ grupo_gid: it.gid, release_id: rel.id, frente: rel.frente, nome: it.name, ordem: it.count ?? null, participantes: it.participantsAmount ?? 0, cheio: !!it.full, captured_at: at });
    releases.push({
      release_id: rel.id, frente: rel.frente, nome: rel.nome, bloqueada: !!rel.bloqueada,
      grupos: items.length, participantes: items.reduce((s, it) => s + (it.participantsAmount ?? 0), 0), grupos_cheios: items.filter((it) => it.full).length,
      entradas_total: a?.add?.total ?? 0, saidas_total: a?.remove?.total ?? 0, cliques_total: a?.clicks?.total ?? 0,
      entradas_hoje: a?.add?.dates?.[ddmmaaaa] ?? 0, cliques_hoje: a?.clicks?.dates?.[ddmmaaaa] ?? 0, captured_at: at,
    });
  }
  return { releases, grupos };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

// Dia calendário de Manaus (offset fixo -04:00; o estado não adota horário de verão)
const diaManaus = (ts: string | null) =>
  ts ? new Date(Date.parse(ts) - 4 * 3600_000).toISOString().slice(0, 10) : null;
const hojeManaus = () => new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);

// PostgREST corta em 1000 linhas POR REQUISIÇÃO — paginar SEMPRE (gotcha da casa)
async function fetchAll(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  cap = 100000,
) {
  const PAGE = 1000;
  const rows: unknown[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/* ================= META GRAPH (bloco campanhas) ================= */
type AdWin = {
  spend: number; imp: number; ctr: number; ilc: number;
  v3s: number; thru: number; p75: number; px_purchase: number; px_lead: number; px_ic: number;
};
type AdRow = { id: string; nome: string; adset_id: string; adset: string; j7: AdWin; mes: AdWin };
type CampMeta = {
  id: string; conta: string; nome: string; status: string; orcamento_dia: number | null;
  adsets: { id: string; nome: string; status: string; orcamento_dia: number | null; goal: string | null }[];
  ads: AdRow[];
};

const INSIGHT_FIELDS =
  "ad_id,ad_name,adset_id,adset_name,spend,impressions,ctr,inline_link_clicks,actions,video_thruplay_watched_actions,video_p75_watched_actions";

function actVal(actions: { action_type: string; value: string }[] | undefined, ...types: string[]) {
  if (!actions) return 0;
  let v = 0;
  for (const a of actions) if (types.includes(a.action_type)) v += Number(a.value || 0);
  return v;
}
function parseInsightRow(r: Record<string, unknown>): AdWin {
  const actions = r.actions as { action_type: string; value: string }[] | undefined;
  const thruArr = r.video_thruplay_watched_actions as { value: string }[] | undefined;
  const p75Arr = r.video_p75_watched_actions as { value: string }[] | undefined;
  return {
    spend: Number(r.spend ?? 0),
    imp: Number(r.impressions ?? 0),
    ctr: Number(r.ctr ?? 0),
    ilc: Number(r.inline_link_clicks ?? 0),
    v3s: actVal(actions, "video_view"),
    thru: thruArr?.length ? Number(thruArr[0].value || 0) : 0,
    p75: p75Arr?.length ? Number(p75Arr[0].value || 0) : 0,
    px_purchase: actVal(actions, "purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"),
    px_lead: actVal(actions, "lead", "offsite_conversion.fb_pixel_lead"),
    px_ic: actVal(actions, "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout", "omni_initiated_checkout"),
  };
}
const zeroWin = (): AdWin => ({ spend: 0, imp: 0, ctr: 0, ilc: 0, v3s: 0, thru: 0, p75: 0, px_purchase: 0, px_lead: 0, px_ic: 0 });

async function graphGet(path: string, params: Record<string, string>, token: string) {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const body = await res.json();
  if (body.error) throw new Error(`Graph ${path}: ${body.error.message}`);
  return body;
}

async function fetchCampanhasMeta(token: string): Promise<CampMeta[]> {
  const hoje = hojeManaus();
  const d7ini = new Date(Date.parse(hoje) - 7 * 86400_000).toISOString().slice(0, 10);
  const d7fim = new Date(Date.parse(hoje) - 1 * 86400_000).toISOString().slice(0, 10);
  // Uma chamada de insights com DOIS intervalos (7 dias fechados + mês): a Graph devolve uma linha por
  // anúncio × intervalo (date_start distingue). Metade das chamadas → menos rate limit (code 4/17).
  const ranges = JSON.stringify([{ since: d7ini, until: d7fim }, { since: "2026-09-01", until: hoje }]);
  const one = async (c: { id: string; conta: string }): Promise<CampMeta> => {
    const [meta, ins] = await Promise.all([
      graphGet(c.id, {
        fields: "name,effective_status,daily_budget,adsets.limit(30){id,name,effective_status,daily_budget,optimization_goal}",
      }, token),
      graphGet(`${c.id}/insights`, { level: "ad", time_ranges: ranges, fields: INSIGHT_FIELDS + ",date_start", limit: "200" }, token),
    ]);
    const rows = (ins.data ?? []) as Record<string, unknown>[];
    const insMes = { data: rows.filter((r) => r.date_start === "2026-09-01") };
    const ins7 = { data: rows.filter((r) => r.date_start === d7ini) };
    const ads: Record<string, AdRow> = {};
    for (const r of (insMes.data ?? []) as Record<string, unknown>[]) {
      ads[r.ad_id as string] = {
        id: r.ad_id as string, nome: r.ad_name as string,
        adset_id: r.adset_id as string, adset: r.adset_name as string,
        j7: zeroWin(), mes: parseInsightRow(r),
      };
    }
    for (const r of (ins7.data ?? []) as Record<string, unknown>[]) {
      const id = r.ad_id as string;
      if (!ads[id]) ads[id] = {
        id, nome: r.ad_name as string, adset_id: r.adset_id as string, adset: r.adset_name as string,
        j7: zeroWin(), mes: zeroWin() as AdWin,
      } as AdRow;
      ads[id].j7 = parseInsightRow(r);
    }
    const adsets = ((meta.adsets?.data ?? []) as Record<string, unknown>[]).map((a) => ({
      id: a.id as string, nome: a.name as string, status: a.effective_status as string,
      orcamento_dia: a.daily_budget ? Number(a.daily_budget) / 100 : null,
      goal: (a.optimization_goal as string) ?? null,
    }));
    const orcCamp = meta.daily_budget ? Number(meta.daily_budget) / 100 : null;
    const orcAdsets = adsets.filter((a) => a.status === "ACTIVE").reduce((s, a) => s + (a.orcamento_dia ?? 0), 0);
    return {
      id: c.id, conta: c.conta, nome: meta.name as string, status: meta.effective_status as string,
      orcamento_dia: orcCamp ?? (orcAdsets > 0 ? orcAdsets : null),
      adsets, ads: Object.values(ads),
    };
  };
  // lotes de 4 campanhas: 20 campanhas × 3 chamadas de uma vez estoura o rate limit da Graph (code 17)
  const out: CampMeta[] = [];
  for (let i = 0; i < CAMPANHAS_PLANO.length; i += 4) {
    const lote = CAMPANHAS_PLANO.slice(i, i + 4);
    out.push(...await Promise.all(lote.map(one)));
  }
  return out;
}

async function fetchPublicos75(token: string) {
  const out: Record<string, { min: number | null; max: number | null; status: string }> = {};
  for (const [k, id] of Object.entries(AUDIENCIAS_75)) {
    try {
      const a = await graphGet(id, { fields: "approximate_count_lower_bound,approximate_count_upper_bound,delivery_status" }, token);
      out[k] = { min: a.approximate_count_lower_bound ?? null, max: a.approximate_count_upper_bound ?? null,
                 status: a.delivery_status?.code === 200 ? "pronto" : String(a.delivery_status?.description ?? "") };
    } catch (e) { out[k] = { min: null, max: null, status: "erro: " + String(e).slice(0, 80) }; }
  }
  return out;
}

// Cache simples em memória da instância (só a parte Meta) — o painel refresha a cada 5 min
let META_CACHE: { t: number; data: CampMeta[]; publicos?: Record<string, unknown> } | null = null;
const META_TTL_MS = 15 * 60_000;
let META_STALE = ""; // último erro da Graph quando o cache antigo foi mantido

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  if ((url.searchParams.get("k") ?? "") !== TOKEN) return json({ error: "unauthorized" }, 401);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---- CHECKLIST (aba Tráfego do painel): GET lista · POST {id, feito} marca/desmarca ----
  // Lista de membros dos grupos (export CSV da Sendflow) → sendflow_membros. Body: { frente, membros: [{ numero, saiu }] }
  // Substitui a lista da frente (fonte csv). Script: PLANO 2026/painel/carregar_membros_sendflow.py
  if (url.searchParams.get("resource") === "membros" && req.method === "POST") {
    try {
      const b = await req.json() as { frente?: string; membros?: { numero: string; saiu?: boolean }[]; urls?: string[] };
      const frente = String(b?.frente ?? "").toUpperCase();
      if (!["TJAM", "SEDUC_AM", "SEDUC_PA", "POLICIAS", "PRF"].includes(frente)) return json({ error: "frente inválida" }, 400);
      // Modo "urls": a própria edge baixa os CSVs do export do conector Sendflow ("Posição;Grupo;Nome;Número[;Saiu]")
      if (Array.isArray(b?.urls) && b.urls.length) {
        b.membros = [];
        for (const u of b.urls) {
          if (!/^https:\/\/firebasestorage\.googleapis\.com\//.test(u)) return json({ error: "url fora do storage do Sendflow" }, 400);
          const r = await fetch(u); if (!r.ok) return json({ error: `csv HTTP ${r.status}` }, 502);
          const txt = (await r.text()).replace(/^\uFEFF/, "");
          for (const ln of txt.split(/\r?\n/).slice(1)) {
            const c = ln.split(";"); if (c.length < 4) continue;
            b.membros.push({ numero: c[3], saiu: (c[4] ?? "").trim().toLowerCase() === "sim" });
          }
        }
      }
      if (!Array.isArray(b?.membros)) return json({ error: "membros/urls ausentes" }, 400);
      const norm = (p: string) => { const d = String(p ?? "").replace(/\D/g, ""); return d.startsWith("55") && d.length >= 12 ? d.slice(2, 4) + d.slice(-8) : d.slice(0, 2) + d.slice(-8); };
      const at = new Date().toISOString();
      const rows = new Map<string, boolean>();
      for (const m of b.membros!) { const n = norm(m.numero); if (n.length === 10) rows.set(n, (rows.get(n) ?? false) || !!m.saiu); }
      await db.from("sendflow_membros").delete().eq("frente", frente).eq("fonte", "csv");
      const arr = [...rows].map(([numero_norm, saiu]) => ({ frente, numero_norm, saiu, fonte: "csv", captured_at: at }));
      for (let i = 0; i < arr.length; i += 500) {
        const { error } = await db.from("sendflow_membros").upsert(arr.slice(i, i + 500), { onConflict: "frente,numero_norm" });
        if (error) return json({ error: error.message }, 500);
      }
      return json({ ok: true, frente, membros: arr.length, saiu: arr.filter((r) => r.saiu).length, captured_at: at });
    } catch (e) { return json({ error: String(e) }, 400); }
  }
  if (url.searchParams.get("resource") === "checklist") {
    try {
      if (req.method === "POST") {
        const b = await req.json().catch(() => ({}));
        const id = String(b?.id ?? "");
        if (!id) return json({ error: "id_obrigatorio" }, 400);
        const feito = !!b?.feito;
        const { error } = await db.from("plano_checklist")
          .update({ feito, feito_at: feito ? new Date().toISOString() : null })
          .eq("id", id);
        if (error) return json({ error: error.message }, 400);
      }
      const { data, error } = await db.from("plano_checklist")
        .select("id, grupo, texto, detalhe, ordem, feito, feito_at")
        .order("grupo").order("ordem");
      if (error) return json({ error: error.message }, 500);
      return json({ itens: data ?? [] });
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }

  try {
    const [vendas, spend, funil, comprasWeb, formsBlindado, vendasUtm, leadsEc, bioLeads, bioMats, disparos, ecCadDisparo, ecGrupo, ecEntradas, camadasDisparo, sendflow, sfMembros, dispResultado, perfilCamadas] = await Promise.all([
      // (1) Termômetro — faturas PAGAS de setembro, receita líquida (net_value), caixa por paid_at.
      // Traz também a flag de parcelamento (consertada no webhook em 08/09, com backfill) para
      // decompor o medido em vendas novas × recorrência — a SOMA continua única (sem contar em dobro).
      fetchAll((a, b) =>
        db.from("hubla_invoices").select("paid_at, net_value, smart_installment_current, invoice_detail")
          .eq("status", "Paga").gte("paid_at", SET_INI_ISO)
          .order("paid_at").range(a, b)
      ),
      // (2) Verba — série diária do Meta (n8n META · Contas Spend)
      fetchAll((a, b) =>
        db.from("meta_ads_insights")
          .select("period_start, ad_account_name, campaign_name, spend")
          .eq("granularity", "daily").gte("period_start", "2026-09-01")
          .order("period_start").range(a, b)
      ),
      // (3) Funil Fase 1 — eventos do SOU Webinário sincronizados pela ponte n8n (5 em 5 min)
      fetchAll((a, b) =>
        db.from("webinar_events")
          .select("created_at, received_link, attended, reached_pitch, clicked_checkout, contests(code)")
          .gte("created_at", SET_INI_ISO)
          .order("created_at").range(a, b)
      ),
      // (3b) Compras atribuídas aos webinários (UTM carimbada no checkout)
      fetchAll((a, b) =>
        db.from("hubla_invoices")
          .select("paid_at, net_value, total_value, utm_source, utm_campaign, product_name")
          .eq("status", "Paga").gte("paid_at", SET_INI_ISO)
          // as duas grafias da casa: "webinario" e "webnario" (08/09: venda SEDUC-AM veio "WEBNARIO")
          .or("utm_campaign.ilike.%webinario%,utm_source.ilike.%webinario%,utm_campaign.ilike.%webnario%,utm_source.ilike.%webnario%")
          .order("paid_at").range(a, b)
      ),
      // (4) Formulários do checkout blindado (UTM = "nome|slug|campaign_id" / "ad|ad_id")
      fetchAll((a, b) =>
        db.from("campaign_events")
          .select("event_time, utm_campaign, utm_content")
          .eq("event_type", "checkout_blindado").gte("event_time", SET_INI_ISO)
          .order("event_time").range(a, b)
      ),
      // (5) Vendas pagas de setembro COM utm — cruzamento por campaign.id/ad.id embutidos na UTM
      fetchAll((a, b) =>
        db.from("hubla_invoices")
          .select("paid_at, net_value, utm_campaign, utm_content")
          .eq("status", "Paga").gte("paid_at", SET_INI_ISO)
          .not("utm_campaign", "is", null)
          .order("paid_at").range(a, b)
      ),
      // (6) Cadastros do Estude Comigo (páginas do gerador v2, Fase 3) — só lead QUALIFICADO gera o evento
      fetchAll((a, b) =>
        db.from("campaign_events")
          // o evento é gravado p/ TODO cadastro; o flag diz quem é qualificado (só esse recebe link do grupo + Lead CAPI)
          .select("lead_id, event_time, utm_campaign, utm_content, utm_term, qualified:raw_payload->>qualified, escolaridade:raw_payload->>escolaridade, leads(phone)")
          .eq("event_type", "estude_comigo_lead").gte("event_time", SET_INI_ISO)
          .order("event_time").range(a, b)
      ),
      // (7) Leads do link da bio @deltafabiosilva (edge bio-lead → bio_leads) — insumo das Fases 2/3 de Polícias/PRF
      fetchAll((a, b) =>
        db.from("bio_leads")
          .select("created_at, phone_norm, produto_code, destino, respostas, utm_medium, utm_content")
          .gte("created_at", SET_INI_ISO)
          .order("created_at").range(a, b)
      ),
      // (7b) Matrículas atribuídas à bio (mesmo telefone, depois do lead, produto recomendado)
      fetchAll((a, b) =>
        db.from("vw_bio_matriculas")
          .select("paid_at, net_value, produto_code, utm_content")
          .gte("paid_at", SET_INI_ISO)
          .order("paid_at").range(a, b)
      ),
      // (8) Disparos da Anne (espelho n8n ANNE · Disparos Sync, 5 min) — só campanhas do Estude Comigo
      fetchAll((a, b) =>
        // TODAS as campanhas de disparo do mês (a aba GASTO classifica: "EC " = captação p/ grupo (Fase 3),
        // "WEBINÁRIO" = captação do webinário, "BLINDADO" = blindado, "PÓS"/"POS" = pós, "PP"/"PLAY" = Play Passei)
        db.from("anne_disparos").select("campaign_id, name, frente, agent_slug, onda, template, status, total, sent, pending, skipped_existing, skipped_optout, failed, optout_novos, started_at, last_sent_at")
          .order("started_at").range(a, b)
      ),
      // (9) Cadastros nas páginas do Estude Comigo vindos de DISPARO (utm_source anne-disparo) desde 14/09
      fetchAll((a, b) =>
        db.from("campaign_events").select("lead_id, event_time, utm_campaign, qualified:raw_payload->>qualified, leads(phone)")
          .eq("event_type", "estude_comigo_lead").ilike("utm_source", "%anne-disparo%")
          .gte("event_time", "2026-09-14T04:00:00.000Z").order("event_time").range(a, b)
      ),
      // (10) Entradas nos grupos do Estude Comigo desde 14/09 (group_events; depende do webhook do Sendflow)
      fetchAll((a, b) =>
        db.from("group_events").select("created_at, event_type, groups!inner(name)")
          .ilike("event_type", "%added%").gte("created_at", "2026-09-14T04:00:00.000Z").order("created_at").range(a, b)
      ),
      // (11) Entradas nos grupos do Estude Comigo LEAD A LEAD (lead_id do webhook do Sendflow) desde 09/09 —
      //      casa o cadastro da página (Fase 3 ou disparo) com a entrada no grupo da MESMA frente.
      //      Cobertura parcial: o webhook não registra toda entrada (14/09: ~2/3 do que o Sendflow contou).
      fetchAll((a, b) =>
        db.from("group_events").select("lead_id, created_at, groups!inner(metadata)")
          .ilike("event_type", "%added%").gte("created_at", "2026-09-09T04:00:00.000Z").order("created_at").range(a, b)
      ),
      // (12) Bases de disparo (tmp_disparo_*): camada × status — o que já foi disparado e o que falta
      (async () => {
        const { data, error } = await db.rpc("fn_plano_disparo_camadas");
        if (error) { console.error("fn_plano_disparo_camadas", error); return []; }
        return data ?? [];
      })(),
      // (13) Snapshot da Sendflow (releases/grupos do Estude Comigo) — gravado pela tarefa agendada "sendflow-snapshot-ec"
      //      (a API da Sendflow só é alcançável pelo conector do app; sem chave no servidor)
      // (13) Sendflow — API REST oficial (secret SENDFLOW_API_KEY), cache 10 min; leitura boa é espelhada nas
      //      tabelas sendflow_*_snapshot, que servem de fallback (API fora / chave ausente).
      (async () => {
        const key = Deno.env.get("SENDFLOW_API_KEY") ?? "";
        // bloqueio persistido no banco (sendflow_api_state) — vale para TODAS as instâncias da edge;
        // sem isso cada cold start "esquecia" o bloqueio, batia na API e a Sendflow escalava a punição
        if (key && Date.now() >= SF_BLOQUEADA_ATE) {
          const { data: st } = await db.from("sendflow_api_state").select("blocked_until, last_error").eq("id", 1).maybeSingle();
          if (st?.blocked_until && Date.parse(st.blocked_until) > Date.now()) { SF_BLOQUEADA_ATE = Date.parse(st.blocked_until); SF_ERRO = st.last_error ?? SF_ERRO; }
        }
        if (key && Date.now() >= SF_BLOQUEADA_ATE && (!SF_CACHE || Date.now() - SF_CACHE.t > SF_TTL_MS)) {
          try {
            const r = await lerSendflow(key);
            SF_CACHE = { t: Date.now(), ...r }; SF_ERRO = "";
            await db.from("sendflow_api_state").upsert({ id: 1, blocked_until: null, last_error: null, last_ok_at: new Date().toISOString(), updated_at: new Date().toISOString() });
            try {
              if (r.releases.length) await db.from("sendflow_releases_snapshot").upsert(r.releases, { onConflict: "release_id" });
              if (r.grupos.length) await db.from("sendflow_grupos_snapshot").upsert(r.grupos, { onConflict: "grupo_gid" });
            } catch (e) { console.error("sendflow snapshot upsert", e); }
          } catch (e) {
            console.error("sendflow api", e); SF_ERRO = String(e).slice(0, 220);
            if (SF_BLOQUEADA_ATE > Date.now()) await db.from("sendflow_api_state").upsert({ id: 1, blocked_until: new Date(SF_BLOQUEADA_ATE).toISOString(), last_error: SF_ERRO, updated_at: new Date().toISOString() });
            if (SF_CACHE) SF_CACHE.t = Date.now() - SF_TTL_MS + 2 * 60_000;   // tenta de novo em 2 min (ou após o bloqueio)
          }
        }
        if (SF_CACHE) return { releases: SF_CACHE.releases, grupos: SF_CACHE.grupos, fonte: "api", erro: null };
        const [{ data: rel }, { data: grp }] = await Promise.all([
          db.from("sendflow_releases_snapshot").select("*").order("frente"),
          db.from("sendflow_grupos_snapshot").select("*").order("release_id").order("ordem"),
        ]);
        return { releases: rel ?? [], grupos: grp ?? [], fonte: "snapshot", erro: key ? ("api indisponível · " + SF_ERRO + (SF_BLOQUEADA_ATE > Date.now() ? ` · chave bloqueada pela Sendflow até ${(() => { const d = new Date(SF_BLOQUEADA_ATE - 4 * 3600_000).toISOString(); return d.slice(8, 10) + "/" + d.slice(5, 7) + " " + d.slice(11, 16); })()} (Manaus)` : "")) : "sem SENDFLOW_API_KEY" };
      })(),
      // (14) Membros dos grupos (lista da Sendflow: export CSV via POST op=membros, ou API) — fonte de verdade da entrada.
      //      O webhook (group_events) perde ~metade das entradas nas SEDUCs; casamos por telefone com esta lista também.
      fetchAll((a, b) => db.from("sendflow_membros").select("frente, numero_norm, saiu, captured_at").order("frente").order("numero_norm").range(a, b)),
      // (15) Resultado POR DISPARO (enviadas × cadastro × entrada no grupo pela lista da Sendflow) — fn_disparos_resultado
      (async () => { const { data, error } = await db.rpc("fn_disparos_resultado"); if (error) console.error("fn_disparos_resultado", error); return data ?? []; })(),
      // (16) Perfil das camadas de disparo (escolaridade/pesquisa/compradores por camada) — fn_plano_disparo_perfil (Polícias 16/09)
      (async () => { const { data, error } = await db.rpc("fn_plano_disparo_perfil"); if (error) console.error("fn_plano_disparo_perfil", error); return data ?? []; })(),
    ]);

    // ---- Entradas nos grupos do Estude Comigo por lead (releases do Sendflow por frente)
    const EC_RELEASES: Record<string, string> = {
      pHasARlCZ391RSiVkLkr: "TJAM", mXoF03n6WZ2bEehyuNt9: "TJAM",   // ESTUDE COMIGO TJ-AM (bloqueada) + grupos de agosto (oficial desde 14/09)
      HChLcxInLc0aWS8ORS98: "SEDUC_AM", KLE3SEidOXAu1OzY24gi: "SEDUC_PA",
      fRiCa8jorZXLuQq20ywu: "POLICIAS", "1KA9so23JVS0o7A9AZyR": "PRF",
    };
    const frenteDe = (s: string | null | undefined) => {
      const c = (s ?? "").toLowerCase();
      return c.includes("tjam") || c.includes("tj-am") ? "TJAM"
        : c.includes("seduc-am") || c.includes("seducam") ? "SEDUC_AM"
        : c.includes("seduc-pa") || c.includes("seducpa") ? "SEDUC_PA"
        : c.includes("polic") ? "POLICIAS" : c.includes("prf") ? "PRF" : "OUTRAS";
    };
    type EntradaRow = { lead_id: string | null; created_at: string; groups: { metadata: Record<string, string> | null } | null };
    const entradas = new Map<string, { f: string; t: number }[]>();
    for (const r of ecEntradas as EntradaRow[]) {
      const f = EC_RELEASES[r.groups?.metadata?.sendflow_campaign_id ?? ""];
      if (!f || !r.lead_id) continue;
      (entradas.get(r.lead_id) ?? entradas.set(r.lead_id, []).get(r.lead_id)!).push({ f, t: Date.parse(r.created_at) });
    }
    // lista de membros por frente (telefone DDD+8) — quem está/esteve no grupo segundo a Sendflow
    const phoneNorm = (p: string | null | undefined) => {
      const d = String(p ?? "").replace(/\D/g, "");
      if (!d) return "";
      return d.startsWith("55") && d.length >= 12 ? d.slice(2, 4) + d.slice(-8) : d.slice(0, 2) + d.slice(-8);
    };
    const membros = new Map<string, Set<string>>();
    let membrosAt = "";
    for (const m of sfMembros as { frente: string; numero_norm: string; saiu: boolean; captured_at: string }[]) {
      (membros.get(m.frente) ?? membros.set(m.frente, new Set()).get(m.frente)!).add(m.numero_norm);
      if (m.captured_at > membrosAt) membrosAt = m.captured_at;
    }
    // entrou no grupo da frente: pelo webhook (depois do cadastro, tolerância 1h) OU pela lista de membros (telefone)
    const entrouGrupo = (leadId: string | null, f: string, cadastroIso: string, phone?: string | null) =>
      (!!leadId && (entradas.get(leadId) ?? []).some((e) => e.f === f && e.t >= Date.parse(cadastroIso) - 3600_000)) ||
      (!!phone && (membros.get(f)?.has(phoneNorm(phone)) ?? false));

    // ---- BIO: leads por dia × frente (PRF = farda PRF/indeciso; POLICIAS = PF/PC/PM)
    type BioRow = { created_at: string; phone_norm: string | null; produto_code: string; destino: string; respostas: Record<string, string> | null; utm_medium: string | null; utm_content: string | null };
    const bioFrente = (r: BioRow) => {
      const f = String(r.respostas?.farda ?? "").toUpperCase();
      return f === "PF" || f === "PC" || f === "PM" ? "POLICIAS" : "PRF";
    };
    const bio = {
      total: (bioLeads as BioRow[]).length,
      unicos: new Set((bioLeads as BioRow[]).map((r) => r.phone_norm).filter(Boolean)).size,
      por_frente: {} as Record<string, number>,
      por_produto: {} as Record<string, number>,
      por_escolaridade: {} as Record<string, number>,
      por_dia: {} as Record<string, Record<string, number>>,
      por_origem: {} as Record<string, number>,
      matriculas: (bioMats as { net_value: number | null }[]).length,
      matriculas_net: (bioMats as { net_value: number | null }[]).reduce((s, m) => s + Number(m.net_value ?? 0), 0),
    };
    for (const r of bioLeads as BioRow[]) {
      const fr = bioFrente(r), d = diaManaus(r.created_at) ?? "?";
      bio.por_frente[fr] = (bio.por_frente[fr] ?? 0) + 1;
      bio.por_produto[r.produto_code] = (bio.por_produto[r.produto_code] ?? 0) + 1;
      const escol = String(r.respostas?.escolaridade ?? "?");
      bio.por_escolaridade[escol] = (bio.por_escolaridade[escol] ?? 0) + 1;
      ((bio.por_dia[d] ??= {}))[fr] = (bio.por_dia[d][fr] ?? 0) + 1;
      const org = (r.utm_medium ?? "?") + (r.utm_content ? " · " + r.utm_content : "");
      bio.por_origem[org] = (bio.por_origem[org] ?? 0) + 1;
    }

    // ---- vendas por dia (Manaus) — total único + recorte da recorrência (parcelas 2ª+)
    // vendas_dia segue sendo o TOTAL (inclui as parcelas); recorrencia_dia é um SUBCONJUNTO dele.
    const vendasDia: Record<string, { net: number; n: number }> = {};
    const recorrenciaDia: Record<string, { net: number; n: number }> = {};
    for (const r of vendas as {
      paid_at: string; net_value: number | null;
      smart_installment_current: number | null; invoice_detail: string | null;
    }[]) {
      const d = diaManaus(r.paid_at);
      if (!d) continue;
      const net = Number(r.net_value ?? 0);
      (vendasDia[d] ??= { net: 0, n: 0 });
      vendasDia[d].net += net;
      vendasDia[d].n += 1;
      const isRecorrencia =
        (r.smart_installment_current != null && Number(r.smart_installment_current) >= 2) ||
        r.invoice_detail === "Pagamento de uma parcela";
      if (isRecorrencia) {
        (recorrenciaDia[d] ??= { net: 0, n: 0 });
        recorrenciaDia[d].net += net;
        recorrenciaDia[d].n += 1;
      }
    }

    // ---- funil por concurso × dia (Manaus) — code normalizado via CODE_ALIAS
    const funilDia: Record<string, Record<string, { inscritos: number; sala: number; pitch: number; checkout: number }>> = {};
    for (const r of funil as {
      created_at: string; received_link: boolean; attended: boolean;
      reached_pitch: boolean; clicked_checkout: boolean; contests: { code: string } | null;
    }[]) {
      const raw = r.contests?.code ?? "?";
      const code = CODE_ALIAS[raw] ?? raw;
      const d = diaManaus(r.created_at)!;
      const bucket = ((funilDia[code] ??= {})[d] ??= { inscritos: 0, sala: 0, pitch: 0, checkout: 0 });
      if (r.received_link) bucket.inscritos++;
      if (r.attended) bucket.sala++;
      if (r.reached_pitch) bucket.pitch++;
      if (r.clicked_checkout) bucket.checkout++;
    }

    // ---- compras do webinário por frente × dia
    const comprasDia: Record<string, Record<string, { n: number; net: number }>> = {};
    for (const r of comprasWeb as { paid_at: string; net_value: number | null; utm_source: string | null; utm_campaign: string | null; product_name: string | null }[]) {
      const c = ((r.utm_campaign ?? "") + " " + (r.utm_source ?? "")).toLowerCase();
      // UTM genérica ("WEBNARIO" sem campanha) não diz a frente — cai no produto
      const p = (r.product_name ?? "").toUpperCase();
      const frente = c.includes("tjam") || c.includes("tj-am") ? "TJAM"
        : c.includes("seducpa") || c.includes("seduc-pa") ? "SEDUC_PA"
        : c.includes("seducam") || c.includes("seduc-am") ? "SEDUC_AM"
        : p.includes("SEDUC AM") || p.includes("SEDUC-AM") ? "SEDUC_AM"
        : p.includes("SEDUC-PA") || p.includes("SEDUC PA") ? "SEDUC_PA"
        : p.includes("TRIBUNAL") || p.includes("TJ") ? "TJAM"
        : "OUTROS";
      const d = diaManaus(r.paid_at)!;
      const bucket = ((comprasDia[frente] ??= {})[d] ??= { n: 0, net: 0 });
      bucket.n += 1;
      bucket.net += Number(r.net_value ?? 0);
    }

    // ---- bloco CAMPANHAS (Graph API + cruzamento UTM) — erro aqui NUNCA derruba o painel
    let campanhas: Record<string, unknown> = { ok: false, error: "sem token METAADS_TOKEN" };
    const metaToken = Deno.env.get("METAADS_TOKEN");
    if (metaToken) {
      try {
        let cached = true;
        if (!META_CACHE || Date.now() - META_CACHE.t > META_TTL_MS) {
          try {
            const publicos = await fetchPublicos75(metaToken);
            META_CACHE = { t: Date.now(), data: await fetchCampanhasMeta(metaToken), publicos };
            // histórico diário (Manaus) — upsert idempotente, erro aqui não derruba o painel
            try {
              const dia = hojeManaus();
              const rows = Object.entries(publicos).filter(([, v]) => v.min != null).map(([k, v]) => ({
                audience_id: AUDIENCIAS_75[k], dia, nome: k, min_size: v.min, max_size: v.max, status: v.status, captured_at: new Date().toISOString(),
              }));
              if (rows.length) await db.from("meta_audience_sizes").upsert(rows, { onConflict: "audience_id,dia" });
            } catch (e) { console.error("meta_audience_sizes", e); }
            cached = false; META_STALE = "";
          } catch (e) {
            if (!META_CACHE) throw e;          // sem cache nenhum: o bloco mostra o erro
            META_STALE = String(e);             // com cache: segura o anterior e avisa
            META_CACHE.t = Date.now() - META_TTL_MS + 3 * 60_000; // tenta de novo em 3 min
          }
        }
        type FormRow = { event_time: string; utm_campaign: string | null; utm_content: string | null };
        type VendaRow = { paid_at: string; net_value: number | null; utm_campaign: string | null; utm_content: string | null };
        const forms = formsBlindado as FormRow[];
        const vUtm = vendasUtm as VendaRow[];

        type EcRow = { lead_id: string | null; event_time: string; utm_campaign: string | null; utm_content: string | null; utm_term: string | null; qualified: string | null; escolaridade?: string | null; leads?: { phone: string | null } | null };
        const ecRows = leadsEc as EcRow[];
        const ecByCamp: Record<string, string | undefined> = {};
        for (const c of CAMPANHAS_PLANO) ecByCamp[c.id] = c.ec;

        const items = META_CACHE.data.map((camp) => {
          const ecTag = ecByCamp[camp.id];
          const ecCamp = ecTag ? ecRows.filter((r) => (r.utm_campaign ?? "").toLowerCase() === ecTag) : [];
          const ecQual = ecCamp.filter((r) => r.qualified === "true");
          const ecFrente = frenteDe(ecTag);
          const ecConj: Record<string, { cad: number; qual: number; grp: number }> = {};
          const ecNoGrupo = new Set<string>();  // leads qualificados que entraram no grupo da frente após o cadastro
          const corte2d = new Date(Date.now() - 2 * 86400_000).toISOString();
          let q2d = 0, g2d = 0;                  // últimos 2 dias (o TJ-AM teve link bloqueado de 10 a 13/09)
          // escolaridade dos cadastros (Fábio 16/09: "leads de ensino médio × superior p/ ter noção";
          // decisão dele: médio se cadastra mas fica fora do grupo por enquanto)
          const ecEscol = { superior: 0, medio: 0, fundamental: 0, outros: 0 };
          for (const r of ecCamp) {
            const e = (r.escolaridade ?? "").toLowerCase();
            if (/superior|p[oó]s/.test(e)) ecEscol.superior++; else if (/m[eé]dio/.test(e)) ecEscol.medio++;
            else if (/fundamental/.test(e)) ecEscol.fundamental++; else ecEscol.outros++;
          }
          for (const r of ecCamp) {
            const k = (r.utm_content ?? "?").split(" (")[0].trim();  // "AQUECIDOS (75% + …)" → AQUECIDOS
            (ecConj[k] ??= { cad: 0, qual: 0, grp: 0 }).cad++;
            if (r.qualified === "true") {
              ecConj[k].qual++;
              const entrou = entrouGrupo(r.lead_id, ecFrente, r.event_time, r.leads?.phone);
              if (entrou && !ecNoGrupo.has(r.lead_id!)) { ecNoGrupo.add(r.lead_id!); ecConj[k].grp++; }
              if (r.event_time >= corte2d) { q2d++; if (entrou) g2d++; }
            }
          }
          const fCamp = forms.filter((f) => (f.utm_campaign ?? "").includes(camp.id));
          const vCamp = vUtm.filter((v) => (v.utm_campaign ?? "").includes(camp.id));
          const ads = camp.ads.map((ad) => {
            const fAd = fCamp.filter((f) => (f.utm_content ?? "").includes(ad.id));
            const vAd = vCamp.filter((v) => (v.utm_content ?? "").includes(ad.id));
            return {
              ...ad,
              // utm_term={{ad.name}} nas páginas do Estude Comigo
              leads_ec_mes: ecTag ? ecQual.filter((r) => (r.utm_term ?? "") === ad.nome).length : null,
              forms_mes: fAd.length,
              vendas_mes: vAd.length,
              vendas_net_mes: vAd.reduce((s, v) => s + Number(v.net_value ?? 0), 0),
            };
          });
          return {
            id: camp.id, conta: camp.conta, nome: camp.nome, status: camp.status,
            orcamento_dia: camp.orcamento_dia, adsets: camp.adsets, ads,
            leads_ec_mes: ecTag ? ecQual.length : null,      // qualificados
            cadastros_ec_mes: ecTag ? ecCamp.length : null,  // todos os cadastros da página
            grupo_ec_mes: ecTag ? ecNoGrupo.size : null,     // qualificados que entraram no grupo (lista Sendflow + webhook)
            leads_ec_2d: ecTag ? q2d : null, grupo_ec_2d: ecTag ? g2d : null,  // últimos 2 dias
            ec_conjuntos: ecTag ? ecConj : null,
            ec_escolaridade: ecTag ? ecEscol : null,   // superior/médio/fundamental dos cadastros
            forms_mes: fCamp.length,
            vendas_mes: vCamp.length,
            vendas_net_mes: vCamp.reduce((s, v) => s + Number(v.net_value ?? 0), 0),
          };
        });
        let hist: Record<string, { dia: string; min: number | null; max: number | null }[]> = {};
        try {
          const { data: h } = await db.from("meta_audience_sizes").select("nome, dia, min_size, max_size")
            .gte("dia", new Date(Date.now() - 21 * 86400_000).toISOString().slice(0, 10)).order("dia");
          for (const r of (h ?? []) as { nome: string; dia: string; min_size: number | null; max_size: number | null }[])
            (hist[r.nome] ??= []).push({ dia: r.dia, min: r.min_size, max: r.max_size });
        } catch (e) { console.error("hist públicos", e); }
        campanhas = { ok: true, cached, stale: META_STALE || null, fetched_at: new Date(META_CACHE.t).toISOString(), items,
          publicos75: META_CACHE.publicos ?? {}, publicos_labels: AUD_LABEL, publicos_hist: hist };
      } catch (e) {
        campanhas = { ok: false, error: String(e) };
      }
    }

    return json({
      generated_at: new Date().toISOString(),
      vendas_dia: vendasDia,          // TOTAL medido (já inclui as parcelas de recorrência)
      recorrencia_dia: recorrenciaDia, // subconjunto de vendas_dia — parcelas 2ª+ (flag 08/09 + backfill)
      // Blocos do plano ainda SEM instrumentação — projeções do Plano-Verba v29 (rótulo ESTIMADO no painel).
      // Recorrência SAIU daqui em 08/09: virou MEDIDA (recorrencia_dia) — recolocá-la seria contar em dobro.
      estimados: [
        { nome: "Comercial humano + Anne", valor: 90000 },
        { nome: "Renovação / CS", valor: 30000 },
        { nome: "Conta Matriz", valor: 25000 },
      ],
      meta_spend: spend,       // linhas cruas diárias; o front classifica por frente
      funil_dia: funilDia,     // por contest code canônico (TJAM, SEDUC_PA, SEDUC_AM)
      compras_web_dia: comprasDia,
      campanhas,               // análise por campanha/anúncio (Graph API, cache ~10 min)
      disparos: {
        campanhas: (disparos as { name: string }[]).filter((c) => /^EC /.test(c.name)),  // bloco Estude Comigo (como antes)
        todas: disparos,                                                                    // aba GASTO
        resultado: dispResultado,                                                           // por disparo: cadastros e entradas (lista Sendflow)
        // cadastros via disparo por frente (utm_campaign das páginas de nutrição: nutricao-<frente>-aula)
        // grupo = qualificados do disparo que entraram no grupo da frente (lead a lead, webhook do Sendflow)
        membros_at: membrosAt || null,   // última leitura da lista de membros da Sendflow
        cadastros: Object.fromEntries(Object.entries((ecCadDisparo as { lead_id: string | null; event_time: string; utm_campaign: string | null; qualified: string | null; leads?: { phone: string | null } | null }[]).reduce((acc, r) => {
          const f = frenteDe(r.utm_campaign);
          const a = (acc[f] ??= { cad: 0, qual: 0, grupo: 0, _ids: new Set<string>() });
          a.cad++;
          if (r.qualified === "true") {
            a.qual++;
            if (entrouGrupo(r.lead_id, f, r.event_time, r.leads?.phone) && !a._ids.has(r.lead_id!)) { a._ids.add(r.lead_id!); a.grupo++; }
          }
          return acc;
        }, {} as Record<string, { cad: number; qual: number; grupo: number; _ids: Set<string> }>)).map(([k, v]) => [k, { cad: v.cad, qual: v.qual, grupo: v.grupo }])),
        // bases de disparo: camada × status (fn_plano_disparo_camadas) — feito × falta
        camadas: camadasDisparo,
        perfil: perfilCamadas,   // perfil por camada (superior/médio/pesquisa/compradores/disparado)
        grupo: (ecGrupo as { groups: { name: string } | null }[]).reduce((acc, r) => {
          const n = (r.groups?.name ?? "").toUpperCase();
          const f = /TJ-AM/.test(n) ? "TJAM" : /SEDUC-AM/.test(n) ? "SEDUC_AM" : /SEDUC-PA/.test(n) ? "SEDUC_PA" : /POL[IÍ]C/.test(n) ? "POLICIAS" : /PRF/.test(n) ? "PRF" : "OUTRAS";
          acc[f] = (acc[f] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>),
      },
      bio,                     // leads do link da bio @deltafabiosilva (insumo Fase 2/3 Polícias/PRF)
      sendflow,                // pessoas nos grupos por projeto — API REST da Sendflow (cache 10 min) c/ fallback snapshot
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
