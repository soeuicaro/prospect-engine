/**
 * Industry Keyword Expansion Engine.
 *
 * Each catalog entry says, per niche, which OSM tags / text terms / CNAEs
 * identify it — split into PRIMARY (the niche itself), RELATED (adjacent
 * formats a prospector would usually want too: lanchonete for
 * "restaurantes") and BROAD-only (loosely related). Search modes pick how
 * deep into that list to go:
 *
 *   PRECISE  → primary tags/terms/CNAEs only
 *   BALANCED → primary + related
 *   BROAD    → primary + related + broad + name-keyword matching on OSM
 *
 * Keys match the seeded `industries.slug` values (0008_seed_reference.sql),
 * so a workspace industry maps to its catalog entry by slug; custom
 * workspace industries without a catalog entry fall back to their own
 * `keywords` column (see expansionForCustomIndustry).
 */

import type { SearchMode } from "./types";

export interface OsmTag {
  key: string;
  value: string;
}

export interface IndustryDefinition {
  key: string;
  label: string;
  primaryKeywords: string[];
  secondaryKeywords: string[];
  synonyms: string[];
  cnaes: { primary: string[]; related: string[] };
  osmTags: { primary: OsmTag[]; related: OsmTag[]; broad: OsmTag[] };
  /** Name fragments used for OSM name matching in BROAD mode. */
  nameKeywords: string[];
}

const t = (key: string, ...values: string[]): OsmTag[] => values.map((value) => ({ key, value }));

/**
 * "Todas as empresas": every named business in the city. OSM: any named
 * shop/office/craft/healthcare + commercial amenity/tourism/leisure values
 * (not benches, parking, churches…). Local DB: no niche filter at all, so
 * the whole imported CNPJ base for the city comes back.
 */
export const ALL_BUSINESSES_KEY = "todas";

export const ALL_BUSINESSES: IndustryDefinition = {
  key: ALL_BUSINESSES_KEY,
  label: "Todas as empresas (todas as atividades)",
  primaryKeywords: ["loja", "restaurante", "mercado"],
  secondaryKeywords: ["farmácia", "clínica", "oficina", "escola", "hotel", "salão"],
  synonyms: ["padaria", "academia", "lanchonete", "imobiliária", "consultório", "pet shop"],
  cnaes: { primary: [], related: [] },
  osmTags: {
    primary: [...t("shop", "*"), ...t("office", "*"), ...t("craft", "*"), ...t("healthcare", "*")],
    related: [
      ...t("amenity", "restaurant", "fast_food", "cafe", "bar", "pub", "food_court", "ice_cream", "pharmacy", "dentist", "doctors",
        "clinic", "veterinary", "bank", "fuel", "car_wash", "car_rental", "driving_school", "language_school", "school", "college",
        "kindergarten", "marketplace", "events_venue", "nightclub", "cinema", "theatre", "studio", "coworking_space"),
      ...t("tourism", "hotel", "guest_house", "hostel", "motel", "apartment"),
      ...t("leisure", "fitness_centre", "sports_centre", "dance", "spa"),
    ],
    broad: [],
  },
  nameKeywords: [],
};

export const INDUSTRY_CATALOG: IndustryDefinition[] = [
  {
    key: "restaurante",
    label: "Restaurantes",
    primaryKeywords: ["restaurante"],
    secondaryKeywords: ["lanchonete", "pizzaria", "hamburgueria", "churrascaria", "self-service"],
    synonyms: ["restaurant", "comida", "alimentação", "food", "cantina", "marmitaria", "espetinho", "açaí"],
    cnaes: { primary: ["5611-2/01"], related: ["5611-2/04", "5611-2/03", "5611-2/05", "5620-1/04", "5620-1/03"] },
    osmTags: {
      primary: t("amenity", "restaurant"),
      related: t("amenity", "fast_food", "food_court"),
      broad: [...t("amenity", "cafe", "ice_cream", "bar", "pub", "biergarten"), ...t("shop", "bakery", "pastry")],
    },
    nameKeywords: ["restaurante", "pizzaria", "lanchonete", "churrascaria", "hamburgueria", "espetinho", "marmitaria", "lanches", "grill"],
  },
  {
    key: "cafeteria",
    label: "Cafeterias e padarias",
    primaryKeywords: ["cafeteria"],
    secondaryKeywords: ["padaria", "confeitaria", "casa de chá"],
    synonyms: ["café", "coffee", "bakery", "doceria"],
    cnaes: { primary: ["4721-1/02"], related: ["5611-2/04", "1091-1/02"] },
    osmTags: {
      primary: t("amenity", "cafe"),
      related: t("shop", "bakery", "pastry", "confectionery"),
      broad: t("amenity", "ice_cream"),
    },
    nameKeywords: ["cafe", "cafeteria", "padaria", "confeitaria", "doceria"],
  },
  {
    key: "clinica",
    label: "Clínicas médicas",
    primaryKeywords: ["clínica"],
    secondaryKeywords: ["consultório", "centro médico", "policlínica"],
    synonyms: ["médico", "saúde", "clinic", "laboratório"],
    cnaes: { primary: ["8630-5/03"], related: ["8630-5/01", "8630-5/02", "8640-2/02"] },
    osmTags: {
      primary: [...t("amenity", "clinic"), ...t("healthcare", "clinic")],
      related: [...t("amenity", "doctors"), ...t("healthcare", "doctor", "centre")],
      broad: [...t("healthcare", "laboratory"), ...t("amenity", "hospital")],
    },
    nameKeywords: ["clinica", "consultorio", "policlinica", "centro medico"],
  },
  {
    key: "odontologia",
    label: "Odontologia",
    primaryKeywords: ["dentista"],
    secondaryKeywords: ["odontologia", "clínica odontológica", "ortodontia"],
    synonyms: ["dental", "odonto", "sorriso"],
    cnaes: { primary: ["8630-5/04"], related: [] },
    osmTags: { primary: [...t("amenity", "dentist"), ...t("healthcare", "dentist")], related: [], broad: [] },
    nameKeywords: ["odonto", "dental", "sorriso", "ortodont"],
  },
  {
    key: "psicologia",
    label: "Psicologia",
    primaryKeywords: ["psicólogo"],
    secondaryKeywords: ["psicologia", "psicoterapia"],
    synonyms: ["saúde mental", "terapia"],
    cnaes: { primary: ["8650-0/03"], related: [] },
    osmTags: { primary: t("healthcare", "psychotherapist"), related: [], broad: [] },
    nameKeywords: ["psicolog", "psicoterap"],
  },
  {
    key: "fisioterapia",
    label: "Fisioterapia",
    primaryKeywords: ["fisioterapia"],
    secondaryKeywords: ["reabilitação", "pilates"],
    synonyms: ["fisioterapeuta", "physiotherapy"],
    cnaes: { primary: ["8650-0/06"], related: [] },
    osmTags: { primary: t("healthcare", "physiotherapist"), related: [], broad: [] },
    nameKeywords: ["fisio", "pilates", "reabilita"],
  },
  {
    key: "academia",
    label: "Academias",
    primaryKeywords: ["academia"],
    secondaryKeywords: ["crossfit", "musculação", "studio fitness"],
    synonyms: ["gym", "fitness", "treino", "pilates"],
    cnaes: { primary: ["9313-1/00"], related: ["8591-1/00"] },
    osmTags: {
      primary: t("leisure", "fitness_centre"),
      related: [...t("leisure", "sports_centre"), ...t("sport", "fitness", "crossfit")],
      broad: t("leisure", "dance"),
    },
    nameKeywords: ["academia", "fitness", "crossfit", "gym", "studio"],
  },
  {
    key: "escola",
    label: "Escolas e cursos",
    primaryKeywords: ["escola"],
    secondaryKeywords: ["curso", "colégio", "idiomas"],
    synonyms: ["school", "faculdade", "ensino"],
    cnaes: { primary: ["8593-7/00", "8591-1/00"], related: ["8599-6/04", "8513-9/00"] },
    osmTags: {
      primary: [...t("amenity", "school", "language_school")],
      related: t("amenity", "college", "driving_school", "music_school"),
      broad: t("amenity", "university", "kindergarten"),
    },
    nameKeywords: ["escola", "colegio", "curso", "idiomas", "english"],
  },
  {
    key: "hotelaria",
    label: "Hotéis e pousadas",
    primaryKeywords: ["hotel"],
    secondaryKeywords: ["pousada", "hostel"],
    synonyms: ["hospedagem", "motel", "inn"],
    cnaes: { primary: ["5510-8/01", "5510-8/03"], related: ["5510-8/02", "5590-6/99"] },
    osmTags: {
      primary: t("tourism", "hotel"),
      related: t("tourism", "guest_house", "hostel", "motel", "apartment"),
      broad: [],
    },
    nameKeywords: ["hotel", "pousada", "hostel"],
  },
  {
    key: "imobiliaria",
    label: "Imobiliárias",
    primaryKeywords: ["imobiliária"],
    secondaryKeywords: ["corretor de imóveis"],
    synonyms: ["imóveis", "real estate"],
    cnaes: { primary: ["6821-8/01", "6821-8/02"], related: ["6822-6/00"] },
    osmTags: { primary: t("office", "estate_agent"), related: [], broad: [] },
    nameKeywords: ["imobiliaria", "imoveis"],
  },
  {
    key: "construcao",
    label: "Construção civil",
    primaryKeywords: ["construtora"],
    secondaryKeywords: ["engenharia", "materiais de construção"],
    synonyms: ["construção", "obras"],
    cnaes: { primary: ["4120-4/00"], related: ["4744-0/99"] },
    osmTags: {
      primary: t("office", "construction_company"),
      related: t("shop", "doityourself", "hardware"),
      broad: t("craft", "builder"),
    },
    nameKeywords: ["construtora", "construcoes", "engenharia"],
  },
  {
    key: "salao-beleza",
    label: "Salões de beleza e estética",
    primaryKeywords: ["salão de beleza"],
    secondaryKeywords: ["cabeleireiro", "estética", "barbearia", "manicure"],
    synonyms: ["beauty", "beleza", "spa"],
    cnaes: { primary: ["9602-5/01", "9602-5/02"], related: [] },
    osmTags: {
      primary: t("shop", "hairdresser", "beauty"),
      related: t("shop", "cosmetics"),
      broad: t("leisure", "spa"),
    },
    nameKeywords: ["salao", "beleza", "barbearia", "estetica", "hair", "studio"],
  },
  {
    key: "pet",
    label: "Pet shops e veterinárias",
    primaryKeywords: ["pet shop"],
    secondaryKeywords: ["veterinária", "clínica veterinária"],
    synonyms: ["pet", "animais"],
    cnaes: { primary: ["4789-0/05", "7500-1/00"], related: ["9609-2/08"] },
    osmTags: { primary: [...t("shop", "pet"), ...t("amenity", "veterinary")], related: t("shop", "pet_grooming"), broad: [] },
    nameKeywords: ["pet", "veterinari", "vet"],
  },
  {
    key: "varejo",
    label: "Lojas e varejo",
    primaryKeywords: ["loja"],
    secondaryKeywords: ["loja de roupas", "loja de móveis", "boutique"],
    synonyms: ["varejo", "store", "moda"],
    cnaes: { primary: ["4781-4/00", "4754-7/01"], related: ["4782-2/01", "4774-1/00"] },
    osmTags: {
      primary: t("shop", "clothes", "furniture"),
      related: t("shop", "shoes", "boutique", "optician", "jewelry", "gift"),
      broad: t("shop", "department_store", "variety_store"),
    },
    nameKeywords: ["loja", "boutique", "moda", "moveis"],
  },
  {
    key: "automotivo",
    label: "Oficinas e automotivo",
    primaryKeywords: ["oficina mecânica"],
    secondaryKeywords: ["auto center", "concessionária", "autopeças"],
    synonyms: ["mecânica", "car repair"],
    cnaes: { primary: ["4520-0/01"], related: ["4511-1/01", "4530-7/03"] },
    osmTags: {
      primary: t("shop", "car_repair"),
      related: t("shop", "car", "car_parts", "tyres"),
      broad: t("amenity", "car_wash"),
    },
    nameKeywords: ["oficina", "auto", "mecanica", "pneus"],
  },
  {
    key: "arquitetura",
    label: "Arquitetura e engenharia",
    primaryKeywords: ["arquitetura"],
    secondaryKeywords: ["escritório de arquitetura", "engenharia"],
    synonyms: ["arquiteto", "architect"],
    cnaes: { primary: ["7111-1/00", "7112-0/00"], related: [] },
    osmTags: { primary: t("office", "architect"), related: t("office", "engineer"), broad: [] },
    nameKeywords: ["arquitet", "engenharia"],
  },
  {
    key: "eventos",
    label: "Eventos e cerimonial",
    primaryKeywords: ["buffet"],
    secondaryKeywords: ["cerimonial", "espaço de eventos", "casa de festas"],
    synonyms: ["eventos", "festas"],
    cnaes: { primary: ["8230-0/01"], related: ["5620-1/02"] },
    osmTags: { primary: t("amenity", "events_venue"), related: t("amenity", "conference_centre"), broad: [] },
    nameKeywords: ["buffet", "eventos", "cerimonial", "festas"],
  },
];

export function getIndustry(key: string | null | undefined): IndustryDefinition | null {
  if (!key) return null;
  if (key === ALL_BUSINESSES_KEY) return ALL_BUSINESSES;
  return INDUSTRY_CATALOG.find((i) => i.key === key) ?? null;
}

export interface IndustryExpansion {
  osmTags: OsmTag[];
  textTerms: string[];
  cnaes: string[];
  nameKeywords: string[];
  /** Terms the engine did NOT apply at this mode — offered as "Ampliar busca". */
  availableTerms: string[];
  availableCnaes: string[];
  availableOsmTags: OsmTag[];
}

function uniq<T>(items: T[], key: (item: T) => string = String): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const tagKey = (tag: OsmTag) => `${tag.key}=${tag.value}`;

export function expandIndustry(
  industry: IndustryDefinition | null,
  opts: { mode: SearchMode; extraKeywords?: string[]; includeRelatedCnaes?: boolean; expandKeywords?: boolean }
): IndustryExpansion {
  const extra = (opts.extraKeywords ?? []).map((k) => k.trim()).filter(Boolean);
  if (!industry) {
    return {
      osmTags: [],
      textTerms: uniq(extra),
      cnaes: [],
      nameKeywords: uniq(extra),
      availableTerms: [],
      availableCnaes: [],
      availableOsmTags: [],
    };
  }

  const { mode } = opts;
  const allTags = [...industry.osmTags.primary, ...industry.osmTags.related, ...industry.osmTags.broad];
  const osmTags =
    mode === "PRECISE"
      ? industry.osmTags.primary
      : mode === "BALANCED"
        ? [...industry.osmTags.primary, ...industry.osmTags.related]
        : allTags;

  const allTerms = [...industry.primaryKeywords, ...industry.secondaryKeywords, ...industry.synonyms];
  let textTerms: string[];
  if (mode === "PRECISE") textTerms = industry.primaryKeywords;
  else if (mode === "BALANCED")
    textTerms = [...industry.primaryKeywords, ...(opts.expandKeywords === false ? [] : industry.secondaryKeywords.slice(0, 2))];
  else textTerms = [...industry.primaryKeywords, ...industry.secondaryKeywords, ...(opts.expandKeywords === false ? [] : industry.synonyms.slice(0, 3))];
  textTerms = uniq([...textTerms, ...extra]);

  const cnaes =
    mode === "BROAD" || opts.includeRelatedCnaes ? [...industry.cnaes.primary, ...industry.cnaes.related] : industry.cnaes.primary;

  const nameKeywords = mode === "BROAD" ? uniq([...industry.nameKeywords, ...extra]) : uniq(extra);

  return {
    osmTags: uniq(osmTags, tagKey),
    textTerms,
    cnaes: uniq(cnaes),
    nameKeywords,
    availableTerms: allTerms.filter((term) => !textTerms.some((x) => x.toLowerCase() === term.toLowerCase())),
    availableCnaes: [...industry.cnaes.primary, ...industry.cnaes.related].filter((c) => !cnaes.includes(c)),
    availableOsmTags: allTags.filter((tag) => !osmTags.some((x) => tagKey(x) === tagKey(tag))),
  };
}

/** Custom workspace niches (no catalog entry): use the row's own keywords. */
export function expansionForCustomIndustry(keywords: string[], cnaes: string[], mode: SearchMode): IndustryDefinition {
  const clean = keywords.map((k) => k.trim()).filter(Boolean);
  return {
    key: "custom",
    label: clean[0] ?? "Nicho personalizado",
    primaryKeywords: clean.slice(0, 1),
    secondaryKeywords: clean.slice(1, mode === "PRECISE" ? 1 : 4),
    synonyms: clean.slice(4),
    cnaes: { primary: cnaes, related: [] },
    osmTags: { primary: [], related: [], broad: [] },
    nameKeywords: clean.map((k) => k.toLowerCase()),
  };
}

export function formatOsmTag(tag: OsmTag): string {
  return tagKey(tag);
}
