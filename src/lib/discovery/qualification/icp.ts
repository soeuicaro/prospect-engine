/**
 * Ideal Customer Profile (ICP) for lead qualification — WHO is a plausible
 * buyer of audiovisual production, and how much each signal is worth.
 *
 * Nothing here is hard-wired into the scoring code: the scorer only reads
 * an `IcpConfig`. The default below is a starting point for a filmmaker;
 * the workspace overrides it in Settings → ICP (stored in `settings` under
 * `discovery.icp`, deep-merged over this default by `resolveIcp`).
 *
 * Segments are keyed by the industry catalog keys (industries.ts), so the
 * same taxonomy drives both "what to search" and "how good is this lead".
 */

import { z } from "zod";

export const ICP_SETTING_KEY = "discovery.icp";
/** Pseudo-niche: search every `searchSegments` entry at once ("potenciais compradores de vídeo"). */
export const ICP_INDUSTRY_KEY = "icp";

export type Ticket = "LOW" | "MEDIUM" | "HIGH";

export interface SubsegmentRule {
  /** Shown as `subcategory`. */
  label: string;
  /** Folded-text regex fragments tested against name + category + description. */
  patterns: string[];
  fit?: number;
  visualNeed?: number;
  ticket?: Ticket;
  tags?: string[];
}

export interface SegmentRule {
  label?: string;
  /** 0..100 — how well the segment matches the ideal client. */
  fit: number;
  /** 0..100 — how much the business depends on visual content. */
  visualNeed: number;
  ticket: Ticket;
  /** Recurring content need (monthly Reels/posts) rather than one-off jobs. */
  recurring: boolean;
  tags: string[];
  /** One line for why_this_lead: what a filmmaker would film there. */
  pitch: string;
  subsegments?: SubsegmentRule[];
}

export type ScoreWeights = Record<"fit" | "visual_need" | "digital_presence" | "opportunity" | "contactability" | "data_quality" | "recency", number>;

export interface IcpConfig {
  version: 1;
  name: string;
  /** Segments searched by the composite "ICP" niche, highest priority first. */
  searchSegments: string[];
  segments: Record<string, SegmentRule>;
  /** Applied when no segment could be determined (honest middle-low default). */
  unknownSegment: Omit<SegmentRule, "subsegments">;
  excluded: {
    /** Segment keys that are never leads. */
    segments: string[];
    /** OSM "key=value" (value may be *). */
    osmTags: string[];
    overtureCategories: string[];
    /** CNAE code prefixes, e.g. "84" (public administration). */
    cnaePrefixes: string[];
    /** Folded-text regex fragments tested against the business name. */
    namePatterns: string[];
  };
  /** Words in name/category/description that raise opportunity (folded, partial match). */
  opportunityKeywords: string[];
  /** Registry size classes (MEI/ME/EPP/DEMAIS or MICRO_LOCAL/PEQUENA/MEDIA/GRANDE_REGIONAL) → fit adjustment in points. */
  sizeAdjustments: Record<string, number>;
  /** Months since opening that count as "new business". */
  newBusinessMonths: number;
  /** Max points per score dimension. Their sum is the score's ceiling (normalized to 100). */
  weights: ScoreWeights;
  thresholds: {
    /** lead_score at or above which a lead is "qualified". */
    qualifiedMinScore: number;
    minConfidence: "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  };
  validation: {
    /** Drop records with no contact channel AND no street address. */
    requireMinimumData: boolean;
    /** Drop names that are only a generic word ("Restaurante", "Bar"). */
    dropGenericNames: boolean;
    /** Drop records a source marks closed or whose CNPJ is BAIXADA/INAPTA/NULA. */
    dropClosed: boolean;
    /** Drop excluded segments/categories/names (excluded.*). */
    dropExcluded: boolean;
  };
}

const seg = (fit: number, visualNeed: number, ticket: Ticket, recurring: boolean, tags: string[], pitch: string, subsegments?: SubsegmentRule[]): SegmentRule => ({
  fit,
  visualNeed,
  ticket,
  recurring,
  tags,
  pitch,
  ...(subsegments ? { subsegments } : {}),
});

export const DEFAULT_ICP: IcpConfig = {
  version: 1,
  name: "Filmmaker — produção audiovisual",
  searchSegments: [
    "eventos",
    "hotelaria",
    "imobiliaria",
    "construcao",
    "restaurante",
    "turismo",
    "estetica",
    "academia",
    "bar",
    "arquitetura",
    "moveis-decoracao",
    "varejo",
    "joalheria",
    "automotivo",
    "cafeteria",
    "odontologia",
    "escola",
    "tecnologia",
  ],
  segments: {
    eventos: seg(95, 95, "HIGH", true, ["events", "high_visual_potential"], "cobertura de eventos, teasers e vídeos de portfólio do espaço", [
      { label: "Espaço / casa de eventos", patterns: ["espaco", "casa de (festas|eventos)", "salao de festas", "recepcoes"], fit: 95 },
      { label: "Buffet / cerimonial", patterns: ["buffet", "cerimonial", "assessoria"], fit: 90 },
    ]),
    hotelaria: seg(95, 95, "HIGH", true, ["hotel", "tourism", "high_visual_potential"], "tour do hotel/pousada, Reels de experiência e vídeo institucional para reservas", [
      { label: "Pousada", patterns: ["pousada"], fit: 95, ticket: "MEDIUM" },
      { label: "Resort", patterns: ["resort"], fit: 100, ticket: "HIGH" },
    ]),
    imobiliaria: seg(95, 95, "HIGH", true, ["real_estate", "high_visual_potential"], "tour de imóveis, vídeos de lançamento e Reels de corretores", [
      { label: "Incorporadora / lançamentos", patterns: ["incorpor", "empreendimento", "lancamento", "residencial"], fit: 100, tags: ["launches"] },
    ]),
    construcao: seg(80, 85, "HIGH", false, ["real_estate", "construction"], "acompanhamento de obra, vídeos de lançamento e institucional", [
      { label: "Construtora / incorporadora", patterns: ["construtora", "incorpor", "empreendimento", "engenharia"], fit: 95, visualNeed: 90, tags: ["launches"] },
      { label: "Serviços de obra", patterns: ["reforma", "pedreiro", "eletric", "encanad", "pintura"], fit: 35, visualNeed: 40, ticket: "LOW" },
    ]),
    restaurante: seg(90, 95, "MEDIUM", true, ["restaurant", "food", "high_visual_potential"], "Reels de pratos, ambiente e bastidores da cozinha", [
      { label: "Lanchonete / fast food", patterns: ["lanche", "lanchonete", "pastel", "espetinho", "marmit"], fit: 65, visualNeed: 80, ticket: "LOW" },
      { label: "Hamburgueria / pizzaria", patterns: ["burger", "hamburg", "pizz"], fit: 85 },
      { label: "Restaurante temático / alta gastronomia", patterns: ["bistro", "gastronom", "trattoria", "steak", "sushi", "japones", "rodizio", "churrascaria"], fit: 95, ticket: "HIGH" },
    ]),
    turismo: seg(90, 95, "HIGH", true, ["tourism", "high_visual_potential"], "vídeos de destinos, passeios e experiências para venda de pacotes"),
    estetica: seg(85, 90, "MEDIUM", true, ["beauty", "clinic", "high_visual_potential"], "antes/depois (com autorização), procedimentos e autoridade da profissional"),
    academia: seg(85, 90, "MEDIUM", true, ["fitness", "high_visual_potential"], "Reels de treino, transformação de alunos e estrutura da academia", [
      { label: "Box / estúdio", patterns: ["crossfit", "box", "pilates", "studio", "estudio", "funcional"], fit: 90 },
    ]),
    bar: seg(85, 90, "MEDIUM", true, ["bar", "nightlife", "events", "high_visual_potential"], "Reels de drinks, ambiente, shows e eventos da casa"),
    arquitetura: seg(80, 90, "HIGH", false, ["architecture", "real_estate", "high_visual_potential"], "vídeos de projetos entregues e portfólio do escritório"),
    "moveis-decoracao": seg(75, 85, "MEDIUM", true, ["home_decor", "retail", "high_visual_potential"], "vídeos de showroom, ambientes decorados e lançamentos de coleção", [
      { label: "Planejados / marcenaria", patterns: ["planejad", "marcenaria", "moveis sob medida"], fit: 85, ticket: "HIGH" },
    ]),
    varejo: seg(70, 80, "MEDIUM", true, ["fashion", "retail"], "vídeos de coleção, provador e Reels de produto", [
      { label: "Moda / boutique", patterns: ["moda", "boutique", "fashion", "store", "multimarcas"], fit: 80, visualNeed: 90, tags: ["fashion", "high_visual_potential"] },
    ]),
    joalheria: seg(75, 85, "MEDIUM", true, ["fashion", "retail", "high_visual_potential"], "vídeos de produto (macro), campanhas de datas comemorativas"),
    automotivo: seg(45, 50, "MEDIUM", false, ["automotive"], "vídeos de veículos e de serviço", [
      { label: "Concessionária / revenda de veículos", patterns: ["concessionaria", "veiculos", "seminovos", "motors", "automoveis", "multimarcas"], fit: 85, visualNeed: 85, ticket: "HIGH", tags: ["high_visual_potential"] },
      { label: "Estética automotiva", patterns: ["estetica automotiva", "detail", "lava jato", "envelopamento"], fit: 65, visualNeed: 80 },
    ]),
    cafeteria: seg(80, 90, "LOW", true, ["food", "cafe", "high_visual_potential"], "Reels de cafés, doces e ambiente"),
    sorveteria: seg(60, 80, "LOW", true, ["food"], "Reels de produto e lançamentos de sabores"),
    odontologia: seg(70, 65, "MEDIUM", true, ["clinic", "health"], "vídeos de autoridade, depoimentos e estrutura da clínica"),
    clinica: seg(65, 60, "MEDIUM", true, ["clinic", "health"], "vídeos institucionais e de autoridade médica"),
    hospital: seg(55, 50, "HIGH", false, ["health"], "vídeo institucional e campanhas de saúde"),
    fisioterapia: seg(50, 50, "LOW", true, ["clinic", "health"], "vídeos educativos e de estrutura"),
    nutricao: seg(55, 55, "LOW", true, ["health", "personal_brand"], "conteúdo educativo de marca pessoal"),
    psicologia: seg(45, 40, "LOW", true, ["health", "personal_brand"], "vídeos de marca pessoal e educativos"),
    "salao-beleza": seg(70, 85, "LOW", true, ["beauty", "high_visual_potential"], "Reels de transformação e bastidores"),
    tatuagem: seg(65, 85, "LOW", true, ["beauty", "high_visual_potential"], "Reels de processo e portfólio"),
    escola: seg(70, 70, "HIGH", false, ["education", "events"], "vídeo institucional, campanha de matrículas e eventos escolares"),
    idiomas: seg(60, 60, "MEDIUM", true, ["education"], "campanhas de matrícula e depoimentos"),
    tecnologia: seg(65, 60, "HIGH", false, ["tech", "b2b"], "vídeo de produto/explicativo, institucional e eventos"),
    "b2b-servicos": seg(55, 45, "HIGH", false, ["b2b"], "vídeo institucional e cases de clientes"),
    industria: seg(60, 55, "HIGH", false, ["b2b", "industry"], "vídeo institucional de fábrica e processos"),
    "energia-solar": seg(60, 55, "HIGH", false, ["b2b"], "cases de instalação e depoimentos"),
    advocacia: seg(50, 40, "MEDIUM", true, ["personal_brand"], "vídeos de autoridade e marca pessoal"),
    agro: seg(45, 45, "HIGH", false, ["b2b", "industry"], "vídeo institucional de propriedade/produção"),
    pet: seg(55, 65, "LOW", true, ["pet"], "Reels de banho/tosa e produtos"),
    floricultura: seg(50, 70, "LOW", false, ["retail"], "vídeos de arranjos e datas comemorativas"),
    esportes: seg(55, 60, "MEDIUM", false, ["retail", "fitness"], "vídeos de produto e eventos esportivos"),
    otica: seg(50, 55, "LOW", false, ["retail"], "vídeos de coleção"),
    supermercado: seg(40, 45, "MEDIUM", false, ["retail", "food"], "campanhas de ofertas"),
    seguros: seg(35, 30, "MEDIUM", false, ["b2b"], "vídeo institucional"),
    financeiro: seg(35, 30, "MEDIUM", false, ["b2b"], "vídeo institucional"),
    "material-construcao": seg(40, 40, "MEDIUM", false, ["retail", "construction"], "vídeos de produto e ofertas"),
    eletronicos: seg(40, 40, "MEDIUM", false, ["retail"], "vídeos de produto"),
    laboratorio: seg(35, 30, "MEDIUM", false, ["health"], "vídeo institucional"),
    farmacia: seg(30, 30, "MEDIUM", false, ["retail", "health"], "campanhas de ofertas"),
    // Partners/competitors of a filmmaker rather than buyers — kept, but low.
    fotografia: seg(25, 30, "LOW", false, ["creative_partner"], "possível parceria (fotógrafo/estúdio), não cliente direto"),
    marketing: seg(40, 40, "MEDIUM", false, ["creative_partner", "b2b"], "possível parceria/terceirização para agência"),
    grafica: seg(25, 25, "LOW", false, ["creative_partner"], "possível parceria"),
    contabilidade: seg(25, 20, "LOW", false, ["b2b"], "vídeo institucional simples"),
    autoescola: seg(35, 35, "LOW", false, ["education"], "campanhas de matrícula"),
    locadora: seg(35, 35, "MEDIUM", false, ["b2b"], "vídeos de frota"),
    papelaria: seg(20, 25, "LOW", false, ["retail"], "conteúdo de produto"),
    costura: seg(20, 25, "LOW", false, ["retail"], "conteúdo de produto"),
    manutencao: seg(15, 15, "LOW", false, [], "baixo potencial audiovisual"),
    limpeza: seg(15, 15, "LOW", false, [], "baixo potencial audiovisual"),
    lavanderia: seg(15, 15, "LOW", false, [], "baixo potencial audiovisual"),
    transporte: seg(20, 20, "LOW", false, [], "baixo potencial audiovisual"),
    posto: seg(10, 10, "LOW", false, [], "baixo potencial audiovisual"),
    cartorio: seg(5, 5, "LOW", false, [], "baixo potencial audiovisual"),
    funeraria: seg(5, 5, "LOW", false, [], "baixo potencial audiovisual"),
  },
  unknownSegment: { label: "Segmento não identificado", fit: 30, visualNeed: 30, ticket: "LOW", recurring: false, tags: [], pitch: "segmento não identificado — avaliar manualmente" },
  excluded: {
    segments: [],
    osmTags: [
      "amenity=atm", "amenity=post_office", "amenity=parcel_locker", "amenity=post_box", "amenity=payment_centre",
      "amenity=money_transfer", "amenity=bureau_de_change", "amenity=townhall", "amenity=police", "amenity=fire_station",
      "amenity=courthouse", "amenity=prison", "amenity=social_facility", "amenity=grave_yard", "amenity=toilets",
      "amenity=parking", "amenity=vending_machine", "amenity=stripclub", "amenity=brothel", "amenity=crematorium",
      "office=government", "shop=vacant",
    ],
    overtureCategories: ["atms", "post_office", "public_service_and_government", "government_services", "town_hall", "police_department", "fire_department", "courthouse", "public_toilet", "parking", "adult_entertainment", "strip_club"],
    cnaePrefixes: ["84"],
    namePatterns: [
      "^prefeitura", "^secretaria (municipal|estadual|de)", "^camara municipal", "^ubs\\b", "unidade basica de saude", "^posto de saude",
      "^escola (municipal|estadual)", "^e e\\b", "^emeif?\\b", "^delegacia", "^tribunal", "^forum\\b", "^receita federal", "^inss\\b",
      "^detran", "caixa eletronico", "banco 24 ?horas", "^correios\\b", "^agencia dos correios",
    ],
  },
  opportunityKeywords: ["lancamento", "inauguracao", "inaugura", "nova unidade", "em breve", "grand opening", "evento", "eventos", "festival", "reserva", "reservas", "agende", "franquia", "unidades", "filial"],
  sizeAdjustments: { MEI: -10, ME: 0, EPP: 5, DEMAIS: 10, MICRO_LOCAL: -5, PEQUENA: 0, MEDIA: 5, GRANDE_REGIONAL: 10 },
  newBusinessMonths: 18,
  weights: { fit: 25, visual_need: 20, digital_presence: 15, opportunity: 10, contactability: 10, data_quality: 10, recency: 10 },
  thresholds: { qualifiedMinScore: 60, minConfidence: "MEDIUM" },
  validation: { requireMinimumData: true, dropGenericNames: true, dropClosed: true, dropExcluded: true },
};

// ---------------------------------------------------------------------------
// Validation / merge of workspace overrides
// ---------------------------------------------------------------------------

const ticket = z.enum(["LOW", "MEDIUM", "HIGH"]);
const pct = z.number().min(0).max(100);
const subsegmentSchema = z.object({
  label: z.string().min(1).max(80),
  patterns: z.array(z.string().min(1).max(120)).max(30),
  fit: pct.optional(),
  visualNeed: pct.optional(),
  ticket: ticket.optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});
const segmentSchema = z.object({
  label: z.string().max(80).optional(),
  fit: pct,
  visualNeed: pct,
  ticket,
  recurring: z.boolean(),
  tags: z.array(z.string().max(40)).max(20),
  pitch: z.string().max(200),
  subsegments: z.array(subsegmentSchema).max(20).optional(),
});

const confidenceLevel = z.enum(["VERY_LOW", "LOW", "MEDIUM", "HIGH", "VERY_HIGH"]);

/** Partial override as stored in settings — every key optional. */
export const icpOverrideSchema = z
  .object({
    name: z.string().max(80),
    searchSegments: z.array(z.string().max(60)).max(40),
    segments: z.record(z.string().max(60), segmentSchema),
    unknownSegment: segmentSchema.omit({ subsegments: true }),
    excluded: z
      .object({
        segments: z.array(z.string().max(60)).max(60),
        osmTags: z.array(z.string().max(80)).max(200),
        overtureCategories: z.array(z.string().max(80)).max(200),
        cnaePrefixes: z.array(z.string().regex(/^\d{1,7}$/)).max(100),
        namePatterns: z.array(z.string().max(120)).max(200),
      })
      .partial(),
    opportunityKeywords: z.array(z.string().max(60)).max(100),
    sizeAdjustments: z.record(z.string().max(30), z.number().min(-50).max(50)),
    newBusinessMonths: z.number().int().min(1).max(120),
    weights: z
      .object({
        fit: z.number().min(0).max(100),
        visual_need: z.number().min(0).max(100),
        digital_presence: z.number().min(0).max(100),
        opportunity: z.number().min(0).max(100),
        contactability: z.number().min(0).max(100),
        data_quality: z.number().min(0).max(100),
        recency: z.number().min(0).max(100),
      })
      .partial(),
    thresholds: z.object({ qualifiedMinScore: z.number().min(0).max(100), minConfidence: confidenceLevel }).partial(),
    validation: z
      .object({ requireMinimumData: z.boolean(), dropGenericNames: z.boolean(), dropClosed: z.boolean(), dropExcluded: z.boolean() })
      .partial(),
  })
  .partial();

export type IcpOverride = z.infer<typeof icpOverrideSchema>;

/** Validates a regex fragment the user typed; invalid ones are reported, never silently used. */
export function invalidPatterns(patterns: string[]): string[] {
  return patterns.filter((p) => {
    try {
      new RegExp(p);
      return false;
    } catch {
      return true;
    }
  });
}

/**
 * Default ICP + workspace override. Segments merge per key (an override
 * replaces that segment's rule); lists replace wholesale (so a user can
 * remove a default exclusion). Invalid overrides fall back to the default.
 */
export function resolveIcp(raw: unknown): { icp: IcpConfig; errors: string[] } {
  if (raw == null) return { icp: DEFAULT_ICP, errors: [] };
  const parsed = icpOverrideSchema.safeParse(raw);
  if (!parsed.success) {
    return { icp: DEFAULT_ICP, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const o = parsed.data;
  const icp: IcpConfig = {
    ...DEFAULT_ICP,
    ...(o.name ? { name: o.name } : {}),
    ...(o.searchSegments ? { searchSegments: o.searchSegments } : {}),
    segments: { ...DEFAULT_ICP.segments, ...(o.segments ?? {}) },
    unknownSegment: o.unknownSegment ?? DEFAULT_ICP.unknownSegment,
    excluded: { ...DEFAULT_ICP.excluded, ...(o.excluded ?? {}) },
    opportunityKeywords: o.opportunityKeywords ?? DEFAULT_ICP.opportunityKeywords,
    sizeAdjustments: o.sizeAdjustments ?? DEFAULT_ICP.sizeAdjustments,
    newBusinessMonths: o.newBusinessMonths ?? DEFAULT_ICP.newBusinessMonths,
    weights: { ...DEFAULT_ICP.weights, ...(o.weights ?? {}) },
    thresholds: { ...DEFAULT_ICP.thresholds, ...(o.thresholds ?? {}) },
    validation: { ...DEFAULT_ICP.validation, ...(o.validation ?? {}) },
  };
  const errors: string[] = [];
  const patterns = [
    ...icp.excluded.namePatterns,
    ...Object.values(icp.segments).flatMap((s) => (s.subsegments ?? []).flatMap((x) => x.patterns)),
  ];
  const bad = invalidPatterns(patterns);
  if (bad.length) errors.push(`Padrões inválidos ignorados: ${bad.join(", ")}`);
  return { icp, errors };
}

/** Compiled regexes, cached per config object. */
const compiled = new WeakMap<IcpConfig, { names: RegExp[]; sub: Map<SubsegmentRule, RegExp[]> }>();

function safeRegex(p: string): RegExp | null {
  try {
    return new RegExp(p);
  } catch {
    return null;
  }
}

export function compiledIcp(icp: IcpConfig) {
  let c = compiled.get(icp);
  if (!c) {
    const sub = new Map<SubsegmentRule, RegExp[]>();
    for (const s of Object.values(icp.segments)) {
      for (const x of s.subsegments ?? []) sub.set(x, x.patterns.map(safeRegex).filter((r): r is RegExp => Boolean(r)));
    }
    c = { names: icp.excluded.namePatterns.map(safeRegex).filter((r): r is RegExp => Boolean(r)), sub };
    compiled.set(icp, c);
  }
  return c;
}
