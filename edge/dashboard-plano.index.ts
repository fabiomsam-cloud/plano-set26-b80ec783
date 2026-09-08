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
const CAMPANHAS_PLANO: { id: string; conta: string }[] = [
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
  v3s: number; thru: number; px_purchase: number; px_lead: number; px_ic: number;
};
type AdRow = { id: string; nome: string; adset_id: string; adset: string; j7: AdWin; mes: AdWin };
type CampMeta = {
  id: string; conta: string; nome: string; status: string; orcamento_dia: number | null;
  adsets: { id: string; nome: string; status: string; orcamento_dia: number | null; goal: string | null }[];
  ads: AdRow[];
};

const INSIGHT_FIELDS =
  "ad_id,ad_name,adset_id,adset_name,spend,impressions,ctr,inline_link_clicks,actions,video_thruplay_watched_actions";

function actVal(actions: { action_type: string; value: string }[] | undefined, ...types: string[]) {
  if (!actions) return 0;
  let v = 0;
  for (const a of actions) if (types.includes(a.action_type)) v += Number(a.value || 0);
  return v;
}
function parseInsightRow(r: Record<string, unknown>): AdWin {
  const actions = r.actions as { action_type: string; value: string }[] | undefined;
  const thruArr = r.video_thruplay_watched_actions as { value: string }[] | undefined;
  return {
    spend: Number(r.spend ?? 0),
    imp: Number(r.impressions ?? 0),
    ctr: Number(r.ctr ?? 0),
    ilc: Number(r.inline_link_clicks ?? 0),
    v3s: actVal(actions, "video_view"),
    thru: thruArr?.length ? Number(thruArr[0].value || 0) : 0,
    px_purchase: actVal(actions, "purchase", "offsite_conversion.fb_pixel_purchase", "omni_purchase"),
    px_lead: actVal(actions, "lead", "offsite_conversion.fb_pixel_lead"),
    px_ic: actVal(actions, "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout", "omni_initiated_checkout"),
  };
}
const zeroWin = (): AdWin => ({ spend: 0, imp: 0, ctr: 0, ilc: 0, v3s: 0, thru: 0, px_purchase: 0, px_lead: 0, px_ic: 0 });

async function graphGet(path: string, params: Record<string, string>, token: string) {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const body = await res.json();
  if (body.error) throw new Error(`Graph ${path}: ${body.error.message}`);
  return body;
}

async function fetchCampanhasMeta(token: string): Promise<CampMeta[]> {
  const hoje = hojeManaus();
  const mesRange = JSON.stringify({ since: "2026-09-01", until: hoje });
  const out = await Promise.all(CAMPANHAS_PLANO.map(async (c) => {
    const [meta, ins7, insMes] = await Promise.all([
      graphGet(c.id, {
        fields: "name,effective_status,daily_budget,adsets.limit(30){id,name,effective_status,daily_budget,optimization_goal}",
      }, token),
      graphGet(`${c.id}/insights`, { level: "ad", date_preset: "last_7d", fields: INSIGHT_FIELDS, limit: "100" }, token),
      graphGet(`${c.id}/insights`, { level: "ad", time_range: mesRange, fields: INSIGHT_FIELDS, limit: "100" }, token),
    ]);
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
  }));
  return out;
}

// Cache simples em memória da instância (só a parte Meta) — o painel refresha a cada 5 min
let META_CACHE: { t: number; data: CampMeta[] } | null = null;
const META_TTL_MS = 10 * 60_000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  if ((url.searchParams.get("k") ?? "") !== TOKEN) return json({ error: "unauthorized" }, 401);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---- CHECKLIST (aba Tráfego do painel): GET lista · POST {id, feito} marca/desmarca ----
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
    const [vendas, spend, funil, comprasWeb, formsBlindado, vendasUtm] = await Promise.all([
      // (1) Termômetro — faturas PAGAS de setembro, receita líquida (net_value), caixa por paid_at
      fetchAll((a, b) =>
        db.from("hubla_invoices").select("paid_at, net_value")
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
          .select("paid_at, net_value, total_value, utm_source, utm_campaign")
          .eq("status", "Paga").gte("paid_at", SET_INI_ISO)
          .or("utm_campaign.ilike.%webinario%,utm_source.ilike.%webinario%")
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
    ]);

    // ---- vendas por dia (Manaus)
    const vendasDia: Record<string, { net: number; n: number }> = {};
    for (const r of vendas as { paid_at: string; net_value: number | null }[]) {
      const d = diaManaus(r.paid_at);
      if (!d) continue;
      (vendasDia[d] ??= { net: 0, n: 0 });
      vendasDia[d].net += Number(r.net_value ?? 0);
      vendasDia[d].n += 1;
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
    for (const r of comprasWeb as { paid_at: string; net_value: number | null; utm_source: string | null; utm_campaign: string | null }[]) {
      const c = ((r.utm_campaign ?? "") + " " + (r.utm_source ?? "")).toLowerCase();
      const frente = c.includes("tjam") || c.includes("tj-am") ? "TJAM"
        : c.includes("seducpa") || c.includes("seduc-pa") ? "SEDUC_PA"
        : c.includes("seducam") || c.includes("seduc-am") ? "SEDUC_AM"
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
          META_CACHE = { t: Date.now(), data: await fetchCampanhasMeta(metaToken) };
          cached = false;
        }
        type FormRow = { event_time: string; utm_campaign: string | null; utm_content: string | null };
        type VendaRow = { paid_at: string; net_value: number | null; utm_campaign: string | null; utm_content: string | null };
        const forms = formsBlindado as FormRow[];
        const vUtm = vendasUtm as VendaRow[];

        const items = META_CACHE.data.map((camp) => {
          const fCamp = forms.filter((f) => (f.utm_campaign ?? "").includes(camp.id));
          const vCamp = vUtm.filter((v) => (v.utm_campaign ?? "").includes(camp.id));
          const ads = camp.ads.map((ad) => {
            const fAd = fCamp.filter((f) => (f.utm_content ?? "").includes(ad.id));
            const vAd = vCamp.filter((v) => (v.utm_content ?? "").includes(ad.id));
            return {
              ...ad,
              forms_mes: fAd.length,
              vendas_mes: vAd.length,
              vendas_net_mes: vAd.reduce((s, v) => s + Number(v.net_value ?? 0), 0),
            };
          });
          return {
            id: camp.id, conta: camp.conta, nome: camp.nome, status: camp.status,
            orcamento_dia: camp.orcamento_dia, adsets: camp.adsets, ads,
            forms_mes: fCamp.length,
            vendas_mes: vCamp.length,
            vendas_net_mes: vCamp.reduce((s, v) => s + Number(v.net_value ?? 0), 0),
          };
        });
        campanhas = { ok: true, cached, fetched_at: new Date(META_CACHE.t).toISOString(), items };
      } catch (e) {
        campanhas = { ok: false, error: String(e) };
      }
    }

    return json({
      generated_at: new Date().toISOString(),
      vendas_dia: vendasDia,
      // Blocos do plano ainda SEM instrumentação — projeções do Plano-Verba v29 (rótulo ESTIMADO no painel)
      estimados: [
        { nome: "Recorrência", valor: 94000 },
        { nome: "Comercial humano + Anne", valor: 90000 },
        { nome: "Renovação / CS", valor: 30000 },
        { nome: "Conta Matriz", valor: 25000 },
      ],
      meta_spend: spend,       // linhas cruas diárias; o front classifica por frente
      funil_dia: funilDia,     // por contest code canônico (TJAM, SEDUC_PA, SEDUC_AM)
      compras_web_dia: comprasDia,
      campanhas,               // análise por campanha/anúncio (Graph API, cache ~10 min)
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
