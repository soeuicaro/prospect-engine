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
  secondaryKeywords: ["farmácia", "clínica", "oficina", "escola", "hotel", "salão", "advocacia", "contabilidade"],
  synonyms: ["padaria", "academia", "lanchonete", "imobiliária", "consultório", "pet shop", "supermercado", "ótica", "bar", "distribuidora"],
  cnaes: { primary: [], related: [] },
  osmTags: {
    primary: [...t("shop", "*"), ...t("office", "*"), ...t("craft", "*"), ...t("healthcare", "*")],
    related: [
      ...t("amenity", "restaurant", "fast_food", "cafe", "bar", "pub", "biergarten", "food_court", "ice_cream", "pharmacy", "dentist",
        "doctors", "clinic", "hospital", "veterinary", "bank", "bureau_de_change", "money_transfer", "payment_centre", "fuel",
        "charging_station", "car_wash", "car_rental", "vehicle_inspection", "driving_school", "language_school", "music_school",
        "dancing_school", "prep_school", "training", "school", "college", "university", "kindergarten", "childcare", "marketplace",
        "events_venue", "conference_centre", "nightclub", "stripclub", "casino", "gambling", "cinema", "theatre", "arts_centre", "studio",
        "coworking_space", "internet_cafe", "karaoke_box", "bicycle_rental", "boat_rental", "nursing_home", "funeral_hall", "crematorium",
        "animal_boarding", "animal_training", "post_office", "parcel_locker", "laundry", "dojo", "love_hotel"),
      ...t("tourism", "hotel", "guest_house", "hostel", "motel", "apartment", "chalet", "camp_site", "caravan_site", "theme_park", "zoo", "aquarium", "gallery"),
      ...t("leisure", "fitness_centre", "sports_centre", "sports_hall", "dance", "spa", "sauna", "bowling_alley", "escape_game",
        "amusement_arcade", "water_park", "trampoline_park", "horse_riding", "golf_course", "miniature_golf", "tanning_salon", "hackerspace"),
      ...t("man_made", "works"),
      ...t("industrial", "*"),
    ],
    broad: [],
  },
  nameKeywords: [],
};

export const INDUSTRY_CATALOG: IndustryDefinition[] = [
  // ---- Alimentação ------------------------------------------------------
  {
    key: "restaurante",
    label: "Restaurantes",
    primaryKeywords: ["restaurante"],
    secondaryKeywords: ["lanchonete", "pizzaria", "hamburgueria", "churrascaria", "self-service", "comida japonesa", "marmitaria"],
    synonyms: ["restaurant", "comida", "alimentação", "food", "cantina", "espetinho", "açaí", "sushi", "peixaria", "delivery", "bistrô", "tapiocaria"],
    cnaes: { primary: ["5611-2/01"], related: ["5611-2/03", "5611-2/04", "5611-2/05", "5620-1/01", "5620-1/02", "5620-1/03", "5620-1/04"] },
    osmTags: {
      primary: t("amenity", "restaurant"),
      related: t("amenity", "fast_food", "food_court"),
      broad: [...t("amenity", "cafe", "ice_cream", "bar", "pub", "biergarten"), ...t("shop", "bakery", "pastry", "deli")],
    },
    nameKeywords: ["restaurante", "pizzaria", "lanchonete", "churrascaria", "hamburgueria", "espetinho", "marmitaria", "lanches", "grill", "sushi", "burger", "pizza", "bistro", "cantina", "tapioca"],
  },
  {
    key: "cafeteria",
    label: "Cafeterias e padarias",
    primaryKeywords: ["cafeteria"],
    secondaryKeywords: ["padaria", "confeitaria", "casa de chá", "doceria", "panificadora"],
    synonyms: ["café", "coffee", "bakery", "bolos", "salgados", "pães"],
    cnaes: { primary: ["4721-1/02", "1091-1/02"], related: ["5611-2/03", "4721-1/04", "1091-1/01", "1092-9/00"] },
    osmTags: {
      primary: [...t("amenity", "cafe"), ...t("shop", "bakery")],
      related: t("shop", "pastry", "confectionery", "coffee", "tea", "chocolate"),
      broad: t("amenity", "ice_cream"),
    },
    nameKeywords: ["cafe", "cafeteria", "padaria", "confeitaria", "doceria", "panificadora", "coffee", "bolos", "doces"],
  },
  {
    key: "bar",
    label: "Bares, pubs e casas noturnas",
    primaryKeywords: ["bar"],
    secondaryKeywords: ["pub", "choperia", "cervejaria", "boteco", "casa noturna"],
    synonyms: ["balada", "boate", "lounge", "adega", "petiscaria", "happy hour"],
    cnaes: { primary: ["5611-2/04", "5611-2/05"], related: ["9329-8/01", "1113-5/02"] },
    osmTags: {
      primary: t("amenity", "bar", "pub"),
      related: t("amenity", "biergarten", "nightclub"),
      broad: [...t("amenity", "karaoke_box"), ...t("craft", "brewery")],
    },
    nameKeywords: ["pub", "choperia", "cervejaria", "boteco", "adega", "lounge", "petiscaria", "chopp"],
  },
  {
    key: "sorveteria",
    label: "Sorveterias, açaí e doces",
    primaryKeywords: ["sorveteria"],
    secondaryKeywords: ["açaí", "doceria", "casa de sucos"],
    synonyms: ["sorvete", "gelato", "picolé", "milkshake", "chocolates", "brigaderia"],
    cnaes: { primary: ["5611-2/03"], related: ["4721-1/04", "1053-8/00", "1093-7/01"] },
    osmTags: {
      primary: t("amenity", "ice_cream"),
      related: t("shop", "confectionery", "chocolate", "ice_cream"),
      broad: t("shop", "pastry"),
    },
    nameKeywords: ["sorvete", "sorveteria", "acai", "gelato", "doceria", "doces", "chocolate", "brigadeiro", "sucos"],
  },
  {
    key: "supermercado",
    label: "Supermercados, mercearias e hortifrúti",
    primaryKeywords: ["supermercado"],
    secondaryKeywords: ["mercado", "mercearia", "minimercado", "hortifruti", "açougue", "atacarejo"],
    synonyms: ["mercadinho", "empório", "conveniência", "frutaria", "casa de carnes", "distribuidora de bebidas", "frios"],
    cnaes: {
      primary: ["4711-3/01", "4711-3/02", "4712-1/00"],
      related: ["4722-9/01", "4722-9/02", "4723-7/00", "4724-5/00", "4729-6/99", "4639-7/01", "4635-4/02"],
    },
    osmTags: {
      primary: t("shop", "supermarket", "convenience"),
      related: t("shop", "greengrocer", "butcher", "beverages", "alcohol", "wholesale", "general", "seafood", "deli", "dairy", "frozen_food"),
      broad: [...t("amenity", "marketplace"), ...t("shop", "health_food", "spices", "water")],
    },
    nameKeywords: ["supermercado", "mercado", "mercearia", "mercadinho", "hortifruti", "acougue", "atacad", "emporio", "frutaria", "carnes", "bebidas", "conveniencia"],
  },
  // ---- Saúde --------------------------------------------------------------
  {
    key: "clinica",
    label: "Clínicas médicas",
    primaryKeywords: ["clínica"],
    secondaryKeywords: ["consultório", "centro médico", "policlínica", "clínica popular"],
    synonyms: ["médico", "saúde", "clinic", "pediatra", "ginecologista", "cardiologista", "dermatologista", "oftalmologista", "ortopedista"],
    cnaes: { primary: ["8630-5/03", "8630-5/01", "8630-5/02"], related: ["8630-5/06", "8630-5/07", "8630-5/99", "8640-2/02", "8610-1/01"] },
    osmTags: {
      primary: [...t("amenity", "clinic"), ...t("healthcare", "clinic")],
      related: [...t("amenity", "doctors"), ...t("healthcare", "doctor", "centre")],
      broad: [...t("healthcare", "laboratory"), ...t("amenity", "hospital")],
    },
    nameKeywords: ["clinica", "consultorio", "policlinica", "centro medico", "medic", "saude", "dermato", "oftalmo", "cardio", "pediatr", "gineco", "ortoped"],
  },
  {
    key: "hospital",
    label: "Hospitais e prontos-socorros",
    primaryKeywords: ["hospital"],
    secondaryKeywords: ["pronto-socorro", "maternidade", "pronto atendimento"],
    synonyms: ["UPA", "hospital dia", "casa de saúde"],
    cnaes: { primary: ["8610-1/01", "8610-1/02"], related: ["8621-6/02", "8630-5/01"] },
    osmTags: { primary: [...t("amenity", "hospital"), ...t("healthcare", "hospital")], related: t("healthcare", "centre"), broad: [] },
    nameKeywords: ["hospital", "maternidade", "pronto socorro", "casa de saude"],
  },
  {
    key: "laboratorio",
    label: "Laboratórios e diagnóstico por imagem",
    primaryKeywords: ["laboratório de análises clínicas"],
    secondaryKeywords: ["laboratório", "diagnóstico por imagem", "raio-x", "ultrassom"],
    synonyms: ["exames", "tomografia", "ressonância", "radiologia"],
    cnaes: { primary: ["8640-2/02"], related: ["8640-2/01", "8640-2/03", "8640-2/04", "8640-2/05", "8640-2/06", "8640-2/07", "8640-2/99"] },
    osmTags: { primary: t("healthcare", "laboratory"), related: t("healthcare", "sample_collection"), broad: [] },
    nameKeywords: ["laboratorio", "analises", "diagnostic", "imagem", "radiolog", "ultrassom", "exames"],
  },
  {
    key: "odontologia",
    label: "Odontologia",
    primaryKeywords: ["dentista"],
    secondaryKeywords: ["odontologia", "clínica odontológica", "ortodontia", "implante dentário"],
    synonyms: ["dental", "odonto", "sorriso", "prótese dentária", "harmonização facial"],
    cnaes: { primary: ["8630-5/04"], related: ["3250-7/06", "8650-0/99"] },
    osmTags: { primary: [...t("amenity", "dentist"), ...t("healthcare", "dentist")], related: [], broad: [] },
    nameKeywords: ["odonto", "dental", "sorriso", "ortodont", "dentista", "implant"],
  },
  {
    key: "psicologia",
    label: "Psicologia",
    primaryKeywords: ["psicólogo"],
    secondaryKeywords: ["psicologia", "psicoterapia", "psiquiatra"],
    synonyms: ["saúde mental", "terapia", "neuropsicologia", "psicanálise"],
    cnaes: { primary: ["8650-0/03"], related: ["8630-5/03", "8720-4/99"] },
    osmTags: { primary: t("healthcare", "psychotherapist"), related: t("healthcare", "counselling"), broad: [] },
    nameKeywords: ["psicolog", "psicoterap", "psiquiatr", "psicanal", "terapia"],
  },
  {
    key: "fisioterapia",
    label: "Fisioterapia, fonoaudiologia e terapias",
    primaryKeywords: ["fisioterapia"],
    secondaryKeywords: ["reabilitação", "pilates", "fonoaudiologia", "terapia ocupacional"],
    synonyms: ["fisioterapeuta", "physiotherapy", "quiropraxia", "acupuntura", "RPG", "osteopatia"],
    cnaes: { primary: ["8650-0/04", "8650-0/05", "8650-0/06"], related: ["8650-0/99", "8690-9/01", "8690-9/99"] },
    osmTags: {
      primary: t("healthcare", "physiotherapist"),
      related: t("healthcare", "speech_therapist", "occupational_therapist", "alternative", "rehabilitation"),
      broad: [],
    },
    nameKeywords: ["fisio", "pilates", "reabilita", "fono", "quiroprax", "acupunt", "osteopat"],
  },
  {
    key: "nutricao",
    label: "Nutricionistas",
    primaryKeywords: ["nutricionista"],
    secondaryKeywords: ["nutrição", "consultório de nutrição"],
    synonyms: ["dieta", "emagrecimento", "nutrologia"],
    cnaes: { primary: ["8650-0/02"], related: [] },
    osmTags: { primary: t("healthcare", "nutrition_counselling"), related: [], broad: [] },
    nameKeywords: ["nutri", "dieta", "emagrec"],
  },
  {
    key: "farmacia",
    label: "Farmácias e drogarias",
    primaryKeywords: ["farmácia"],
    secondaryKeywords: ["drogaria", "farmácia de manipulação"],
    synonyms: ["remédios", "medicamentos", "perfumaria", "pharmacy"],
    cnaes: { primary: ["4771-7/01", "4771-7/02", "4771-7/03"], related: ["4771-7/04", "4772-5/00", "4773-3/00"] },
    osmTags: {
      primary: [...t("amenity", "pharmacy"), ...t("healthcare", "pharmacy")],
      related: t("shop", "chemist", "medical_supply"),
      broad: t("shop", "cosmetics", "perfumery"),
    },
    nameKeywords: ["farmacia", "drogaria", "manipula", "pharma", "drogas"],
  },
  {
    key: "otica",
    label: "Óticas",
    primaryKeywords: ["ótica"],
    secondaryKeywords: ["óculos", "lentes de contato"],
    synonyms: ["optometrista", "optica", "optician"],
    cnaes: { primary: ["4774-1/00"], related: ["3250-7/07"] },
    osmTags: { primary: t("shop", "optician"), related: t("healthcare", "optometrist"), broad: [] },
    nameKeywords: ["otica", "optica", "oculos", "visao", "lentes"],
  },
  {
    key: "estetica",
    label: "Clínicas de estética e depilação",
    primaryKeywords: ["clínica de estética"],
    secondaryKeywords: ["estética", "depilação", "harmonização facial", "micropigmentação"],
    synonyms: ["spa", "massagem", "limpeza de pele", "sobrancelha", "cílios", "bronzeamento"],
    cnaes: { primary: ["9602-5/02"], related: ["9609-2/99", "8690-9/99", "9602-5/01"] },
    osmTags: {
      primary: t("shop", "beauty"),
      related: [...t("leisure", "spa", "tanning_salon"), ...t("shop", "massage")],
      broad: t("amenity", "spa"),
    },
    nameKeywords: ["estetica", "depila", "spa", "harmoniza", "sobrancelha", "cilios", "laser", "beauty", "massag", "bronze"],
  },
  // ---- Beleza / bem-estar -------------------------------------------------
  {
    key: "salao-beleza",
    label: "Salões de beleza e barbearias",
    primaryKeywords: ["salão de beleza"],
    secondaryKeywords: ["cabeleireiro", "barbearia", "manicure", "esmalteria", "estética"],
    synonyms: ["beauty", "beleza", "spa", "nail", "maquiagem", "tranças", "studio de beleza"],
    cnaes: { primary: ["9602-5/01", "9602-5/02"], related: ["4772-5/00"] },
    osmTags: {
      primary: t("shop", "hairdresser", "beauty"),
      related: t("shop", "cosmetics", "hairdresser_supply", "perfumery"),
      broad: [...t("leisure", "spa"), ...t("shop", "massage", "tattoo")],
    },
    nameKeywords: ["salao", "beleza", "barbearia", "barber", "estetica", "hair", "studio", "cabele", "esmalte", "nail", "manicure", "makeup"],
  },
  {
    key: "tatuagem",
    label: "Estúdios de tatuagem e piercing",
    primaryKeywords: ["tatuagem"],
    secondaryKeywords: ["estúdio de tatuagem", "piercing"],
    synonyms: ["tattoo", "body piercing"],
    cnaes: { primary: ["9609-2/06"], related: [] },
    osmTags: { primary: t("shop", "tattoo"), related: t("shop", "piercing"), broad: [] },
    nameKeywords: ["tattoo", "tatuag", "piercing"],
  },
  {
    key: "academia",
    label: "Academias e estúdios fitness",
    primaryKeywords: ["academia"],
    secondaryKeywords: ["crossfit", "musculação", "studio fitness", "pilates", "artes marciais"],
    synonyms: ["gym", "fitness", "treino", "personal trainer", "jiu-jitsu", "muay thai", "natação", "funcional", "yoga"],
    cnaes: { primary: ["9313-1/00"], related: ["8591-1/00", "9319-1/01", "9311-5/00", "9312-3/00"] },
    osmTags: {
      primary: t("leisure", "fitness_centre"),
      related: [...t("leisure", "sports_centre", "sports_hall"), ...t("sport", "fitness", "crossfit", "yoga", "martial_arts", "swimming")],
      broad: [...t("leisure", "dance"), ...t("amenity", "dojo")],
    },
    nameKeywords: ["academia", "fitness", "crossfit", "gym", "studio", "pilates", "yoga", "jiu", "muay", "natacao", "treino"],
  },
  // ---- Educação ------------------------------------------------------------
  {
    key: "escola",
    label: "Escolas, creches e faculdades",
    primaryKeywords: ["escola"],
    secondaryKeywords: ["colégio", "creche", "curso", "faculdade", "curso preparatório"],
    synonyms: ["school", "ensino", "educação infantil", "berçário", "reforço escolar", "cursinho", "pós-graduação"],
    cnaes: {
      primary: ["8511-2/00", "8512-1/00", "8513-9/00", "8520-1/00"],
      related: ["8531-7/00", "8532-5/00", "8533-3/00", "8541-4/00", "8542-2/00", "8599-6/04", "8599-6/05", "8599-6/99", "8550-3/02"],
    },
    osmTags: {
      primary: t("amenity", "school", "kindergarten"),
      related: t("amenity", "college", "university", "childcare", "prep_school"),
      broad: t("amenity", "training", "library"),
    },
    nameKeywords: ["escola", "colegio", "creche", "curso", "faculdade", "ensino", "educa", "infantil", "bercario", "reforco", "preparatorio"],
  },
  {
    key: "idiomas",
    label: "Escolas de idiomas, música e cursos livres",
    primaryKeywords: ["escola de idiomas"],
    secondaryKeywords: ["curso de inglês", "escola de música", "escola de dança", "curso de informática"],
    synonyms: ["english", "espanhol", "language school", "aula de violão", "ballet", "profissionalizante"],
    cnaes: { primary: ["8593-7/00"], related: ["8592-9/01", "8592-9/02", "8592-9/03", "8592-9/99", "8599-6/03", "8599-6/99"] },
    osmTags: {
      primary: t("amenity", "language_school"),
      related: t("amenity", "music_school", "dancing_school", "training"),
      broad: t("leisure", "dance"),
    },
    nameKeywords: ["idiomas", "english", "ingles", "language", "wizard", "fisk", "ccaa", "musica", "danca", "ballet", "informatica"],
  },
  {
    key: "autoescola",
    label: "Autoescolas (CFC)",
    primaryKeywords: ["autoescola"],
    secondaryKeywords: ["centro de formação de condutores", "CFC"],
    synonyms: ["auto escola", "habilitação", "driving school"],
    cnaes: { primary: ["8599-6/01"], related: ["8599-6/02"] },
    osmTags: { primary: t("amenity", "driving_school"), related: [], broad: [] },
    nameKeywords: ["autoescola", "auto escola", "cfc", "formacao de condutores", "habilita"],
  },
  // ---- Serviços profissionais --------------------------------------------
  {
    key: "advocacia",
    label: "Advocacia e escritórios jurídicos",
    primaryKeywords: ["advogado"],
    secondaryKeywords: ["advocacia", "escritório de advocacia", "advogados associados", "assessoria jurídica"],
    synonyms: ["jurídico", "direito", "law", "advogada", "direito trabalhista", "direito previdenciário", "direito de família", "direito criminal", "sociedade de advogados"],
    cnaes: { primary: ["6911-7/01"], related: ["6911-7/02", "6911-7/03", "6912-5/00"] },
    osmTags: { primary: t("office", "lawyer"), related: t("office", "notary"), broad: t("office", "tax_advisor") },
    nameKeywords: ["advoca", "advogad", "juridic", "direito", "law", "associados"],
  },
  {
    key: "contabilidade",
    label: "Contabilidade",
    primaryKeywords: ["contabilidade"],
    secondaryKeywords: ["escritório de contabilidade", "contador", "assessoria contábil"],
    synonyms: ["contábil", "auditoria", "perícia contábil", "abertura de empresa", "imposto de renda", "BPO financeiro"],
    cnaes: { primary: ["6920-6/01"], related: ["6920-6/02", "8211-3/00"] },
    osmTags: { primary: t("office", "accountant"), related: t("office", "tax_advisor"), broad: [] },
    nameKeywords: ["contab", "contador", "contabil", "auditoria", "fiscal", "tributar"],
  },
  {
    key: "cartorio",
    label: "Cartórios e despachantes",
    primaryKeywords: ["cartório"],
    secondaryKeywords: ["tabelionato", "despachante"],
    synonyms: ["registro civil", "registro de imóveis", "tabelião"],
    cnaes: { primary: ["6912-5/00"], related: ["8299-7/07"] },
    osmTags: { primary: t("office", "notary"), related: [], broad: [] },
    nameKeywords: ["cartorio", "tabelion", "registro", "despachante", "oficio"],
  },
  {
    key: "b2b-servicos",
    label: "Consultorias e serviços B2B",
    primaryKeywords: ["consultoria"],
    secondaryKeywords: ["assessoria", "escritório", "gestão empresarial", "recursos humanos"],
    synonyms: ["consulting", "treinamento empresarial", "recrutamento", "terceirização", "coworking", "business"],
    cnaes: {
      primary: ["7020-4/00"],
      related: ["7490-1/04", "7490-1/99", "7810-8/00", "7820-5/00", "8211-3/00", "8219-9/99", "8299-7/99", "8599-6/04"],
    },
    osmTags: {
      primary: t("office", "consulting", "company"),
      related: t("office", "employment_agency", "coworking", "association", "quango"),
      broad: t("amenity", "coworking_space"),
    },
    nameKeywords: ["consultoria", "assessoria", "gestao", "solucoes", "servicos", "business", "consulting"],
  },
  {
    key: "marketing",
    label: "Agências de marketing e publicidade",
    primaryKeywords: ["agência de marketing"],
    secondaryKeywords: ["agência de publicidade", "marketing digital", "comunicação visual"],
    synonyms: ["publicidade", "propaganda", "social media", "design gráfico", "branding", "produtora"],
    cnaes: { primary: ["7311-4/00"], related: ["7312-2/00", "7319-0/02", "7319-0/03", "7319-0/04", "7319-0/99", "7410-2/02", "5911-1/99"] },
    osmTags: { primary: t("office", "advertising_agency"), related: t("office", "graphic_design"), broad: t("craft", "signmaker") },
    nameKeywords: ["marketing", "publicidade", "propaganda", "agencia", "comunicacao", "digital", "branding", "midia", "design"],
  },
  {
    key: "tecnologia",
    label: "Tecnologia, software e TI",
    primaryKeywords: ["empresa de software"],
    secondaryKeywords: ["tecnologia da informação", "desenvolvimento de sistemas", "provedor de internet"],
    synonyms: ["TI", "software", "sistemas", "informática", "suporte técnico", "telecom", "startup"],
    cnaes: {
      primary: ["6201-5/01", "6202-3/00", "6203-1/00", "6204-0/00", "6209-1/00"],
      related: ["6311-9/00", "6319-4/00", "6110-8/03", "6190-6/01", "9511-8/00"],
    },
    osmTags: { primary: t("office", "it", "telecommunication"), related: t("office", "company"), broad: [] },
    nameKeywords: ["tecnologia", "software", "sistemas", "tech", "informatica", "digital", "telecom", "fibra"],
  },
  {
    key: "seguros",
    label: "Corretoras de seguros",
    primaryKeywords: ["corretora de seguros"],
    secondaryKeywords: ["seguros", "plano de saúde", "consórcio"],
    synonyms: ["seguro auto", "seguradora", "previdência"],
    cnaes: { primary: ["6622-3/00"], related: ["6613-4/00", "6550-2/00", "6511-1/02"] },
    osmTags: { primary: t("office", "insurance"), related: [], broad: [] },
    nameKeywords: ["seguro", "corretora", "consorcio", "previdencia"],
  },
  {
    key: "financeiro",
    label: "Bancos, cooperativas de crédito e financeiras",
    primaryKeywords: ["banco"],
    secondaryKeywords: ["cooperativa de crédito", "financeira", "correspondente bancário"],
    synonyms: ["crédito", "empréstimo", "câmbio", "sicoob", "sicredi"],
    cnaes: { primary: ["6422-1/00", "6424-7/03"], related: ["6424-7/04", "6436-1/00", "6463-8/00", "6619-3/02", "6619-3/99"] },
    osmTags: {
      primary: t("amenity", "bank"),
      related: [...t("office", "financial", "financial_advisor"), ...t("amenity", "bureau_de_change", "money_transfer")],
      broad: [],
    },
    nameKeywords: ["banco", "credito", "cooperativa", "financeira", "sicoob", "sicredi", "emprestimo", "cambio"],
  },
  {
    key: "imobiliaria",
    label: "Imobiliárias e corretores",
    primaryKeywords: ["imobiliária"],
    secondaryKeywords: ["corretor de imóveis", "administradora de imóveis"],
    synonyms: ["imóveis", "real estate", "aluguel", "loteamento", "condomínio"],
    cnaes: { primary: ["6821-8/01", "6821-8/02"], related: ["6822-6/00", "6810-2/01", "6810-2/02", "6810-2/03", "8112-5/00"] },
    osmTags: { primary: t("office", "estate_agent"), related: t("office", "property_management"), broad: [] },
    nameKeywords: ["imobiliaria", "imoveis", "corretor", "empreendimentos", "loteamento", "condominio"],
  },
  // ---- Construção / casa ---------------------------------------------------
  {
    key: "construcao",
    label: "Construtoras e reformas",
    primaryKeywords: ["construtora"],
    secondaryKeywords: ["engenharia", "reformas", "incorporadora", "empreiteira"],
    synonyms: ["construção", "obras", "terraplenagem", "pintura predial", "impermeabilização"],
    cnaes: {
      primary: ["4120-4/00", "4110-7/00"],
      related: ["4211-1/01", "4213-8/00", "4292-8/02", "4299-5/99", "4313-4/00", "4330-4/04", "4330-4/99", "4391-6/00", "4399-1/01", "4399-1/03", "4399-1/99"],
    },
    osmTags: {
      primary: t("office", "construction_company"),
      related: t("craft", "builder", "roofer", "plasterer", "tiler", "painter", "insulation"),
      broad: t("office", "engineer"),
    },
    nameKeywords: ["construtora", "construcoes", "construcao", "engenharia", "reformas", "incorpora", "empreend", "obras"],
  },
  {
    key: "material-construcao",
    label: "Materiais de construção e ferragens",
    primaryKeywords: ["material de construção"],
    secondaryKeywords: ["loja de materiais de construção", "ferragens", "casa de tintas", "madeireira"],
    synonyms: ["home center", "vidraçaria", "material elétrico", "hidráulica", "pisos e revestimentos", "depósito"],
    cnaes: {
      primary: ["4744-0/05", "4744-0/99", "4744-0/01"],
      related: ["4741-5/00", "4742-3/00", "4743-1/00", "4744-0/02", "4744-0/03", "4744-0/04", "4679-6/99"],
    },
    osmTags: {
      primary: t("shop", "doityourself", "hardware", "trade"),
      related: t("shop", "paint", "glaziery", "tiles", "flooring", "bathroom_furnishing", "electrical", "building_materials"),
      broad: t("craft", "glaziery"),
    },
    nameKeywords: ["materiais de construcao", "material de construcao", "ferragens", "ferragista", "tintas", "madeireira", "vidracaria", "home center", "deposito", "revestimentos", "pisos"],
  },
  {
    key: "moveis-decoracao",
    label: "Móveis planejados, marcenaria e decoração",
    primaryKeywords: ["móveis planejados"],
    secondaryKeywords: ["loja de móveis", "marcenaria", "decoração", "colchões"],
    synonyms: ["cozinhas planejadas", "estofados", "persianas", "cortinas", "tapeçaria"],
    cnaes: {
      primary: ["3101-2/00", "4754-7/01"],
      related: ["4754-7/02", "4754-7/03", "4755-5/02", "4759-8/99", "3329-5/01", "3102-1/00", "3104-7/00"],
    },
    osmTags: {
      primary: t("shop", "furniture", "kitchen"),
      related: [...t("shop", "interior_decoration", "curtain", "bed", "houseware", "lighting", "carpet"), ...t("craft", "carpenter", "cabinet_maker", "upholsterer")],
      broad: [],
    },
    nameKeywords: ["moveis", "planejados", "marcenaria", "decora", "colchoes", "estofados", "cortinas", "persianas", "interiores", "design"],
  },
  {
    key: "arquitetura",
    label: "Arquitetura e engenharia",
    primaryKeywords: ["arquitetura"],
    secondaryKeywords: ["escritório de arquitetura", "engenharia", "design de interiores", "topografia"],
    synonyms: ["arquiteto", "architect", "engenheiro", "projetos", "paisagismo"],
    cnaes: { primary: ["7111-1/00", "7112-0/00"], related: ["7119-7/01", "7119-7/03", "7119-7/99", "7410-2/01", "8130-3/00"] },
    osmTags: { primary: t("office", "architect"), related: t("office", "engineer", "surveyor"), broad: [] },
    nameKeywords: ["arquitet", "engenharia", "projetos", "interiores", "topograf", "paisag"],
  },
  {
    key: "manutencao",
    label: "Elétrica, hidráulica, refrigeração e serralheria",
    primaryKeywords: ["eletricista"],
    secondaryKeywords: ["refrigeração", "ar-condicionado", "serralheria", "encanador", "chaveiro"],
    synonyms: ["manutenção predial", "vidraceiro", "gesseiro", "desentupidora", "portões automáticos", "câmeras de segurança"],
    cnaes: {
      primary: ["4321-5/00", "4322-3/01", "4322-3/02"],
      related: ["2512-8/00", "2542-0/00", "3314-7/07", "4329-1/03", "4329-1/04", "9529-1/02", "8020-0/01", "4330-4/02"],
    },
    osmTags: {
      primary: t("craft", "electrician", "plumber", "hvac"),
      related: t("craft", "metal_construction", "locksmith", "key_cutter", "glaziery", "window_construction", "plasterer"),
      broad: t("shop", "locksmith"),
    },
    nameKeywords: ["eletric", "refrigera", "climatiza", "serralheria", "chaveiro", "hidraulic", "desentup", "portoes", "vidracaria", "gesso"],
  },
  {
    key: "energia-solar",
    label: "Energia solar",
    primaryKeywords: ["energia solar"],
    secondaryKeywords: ["placas solares", "fotovoltaico", "integradora solar"],
    synonyms: ["solar", "painéis solares", "energia renovável"],
    cnaes: { primary: ["4321-5/00"], related: ["3511-5/01", "7112-0/00", "4742-3/00"] },
    osmTags: { primary: t("office", "energy_supplier"), related: t("craft", "electrician"), broad: [] },
    nameKeywords: ["solar", "fotovolt", "energia", "renovave"],
  },
  {
    key: "limpeza",
    label: "Limpeza, dedetização e facilities",
    primaryKeywords: ["empresa de limpeza"],
    secondaryKeywords: ["dedetização", "controle de pragas", "limpeza pós-obra", "jardinagem"],
    synonyms: ["facilities", "conservação", "portaria", "segurança privada", "lavagem de estofados"],
    cnaes: { primary: ["8121-4/00", "8122-2/00"], related: ["8129-0/00", "8111-7/00", "8130-3/00", "8011-1/01", "8012-9/00"] },
    osmTags: { primary: t("craft", "cleaning"), related: t("office", "security"), broad: t("craft", "gardener") },
    nameKeywords: ["limpeza", "dedetiza", "pragas", "conserva", "facilities", "jardin", "seguranca", "higieniza"],
  },
  {
    key: "lavanderia",
    label: "Lavanderias",
    primaryKeywords: ["lavanderia"],
    secondaryKeywords: ["lavanderia self-service", "tinturaria"],
    synonyms: ["lava e seca", "passadoria", "laundry"],
    cnaes: { primary: ["9601-7/01"], related: ["9601-7/02", "9601-7/03"] },
    osmTags: { primary: t("shop", "laundry", "dry_cleaning"), related: t("amenity", "laundry"), broad: [] },
    nameKeywords: ["lavanderia", "laundry", "lava", "tinturaria", "passadoria"],
  },
  // ---- Hospedagem / turismo / eventos -------------------------------------
  {
    key: "hotelaria",
    label: "Hotéis e pousadas",
    primaryKeywords: ["hotel"],
    secondaryKeywords: ["pousada", "hostel", "motel", "flat"],
    synonyms: ["hospedagem", "inn", "resort", "chalé", "camping", "casa de temporada"],
    cnaes: { primary: ["5510-8/01", "5510-8/03"], related: ["5510-8/02", "5590-6/01", "5590-6/02", "5590-6/03", "5590-6/99"] },
    osmTags: {
      primary: t("tourism", "hotel"),
      related: t("tourism", "guest_house", "hostel", "motel", "apartment"),
      broad: t("tourism", "chalet", "camp_site"),
    },
    nameKeywords: ["hotel", "pousada", "hostel", "motel", "resort", "flat", "chale", "inn"],
  },
  {
    key: "turismo",
    label: "Agências de viagem e turismo",
    primaryKeywords: ["agência de viagens"],
    secondaryKeywords: ["turismo", "operadora de turismo", "passeios"],
    synonyms: ["viagens", "excursões", "passagens", "travel", "receptivo"],
    cnaes: { primary: ["7911-2/00", "7912-1/00"], related: ["7990-2/00", "4929-9/04"] },
    osmTags: { primary: [...t("shop", "travel_agency"), ...t("office", "travel_agent")], related: t("office", "guide"), broad: [] },
    nameKeywords: ["viagens", "turismo", "travel", "tour", "excurs", "passagens"],
  },
  {
    key: "eventos",
    label: "Eventos, buffets e cerimonial",
    primaryKeywords: ["buffet"],
    secondaryKeywords: ["cerimonial", "espaço de eventos", "casa de festas", "decoração de festas"],
    synonyms: ["eventos", "festas", "casamento", "aluguel de brinquedos", "som e iluminação", "DJ"],
    cnaes: { primary: ["8230-0/01", "8230-0/02"], related: ["5620-1/02", "7739-0/03", "9001-9/06", "9329-8/99"] },
    osmTags: {
      primary: t("amenity", "events_venue"),
      related: t("amenity", "conference_centre"),
      broad: t("shop", "party"),
    },
    nameKeywords: ["buffet", "eventos", "cerimonial", "festas", "recepcoes", "casamento", "espaco"],
  },
  {
    key: "fotografia",
    label: "Fotografia e produtoras de vídeo",
    primaryKeywords: ["fotógrafo"],
    secondaryKeywords: ["estúdio fotográfico", "produtora de vídeo", "filmagem"],
    synonyms: ["fotografia", "photo", "ensaio", "drone", "audiovisual"],
    cnaes: { primary: ["7420-0/01", "7420-0/04"], related: ["7420-0/02", "7420-0/03", "7420-0/05", "5911-1/02", "5911-1/99"] },
    osmTags: { primary: [...t("craft", "photographer"), ...t("shop", "photo")], related: t("craft", "photographic_laboratory"), broad: t("amenity", "studio") },
    nameKeywords: ["foto", "photo", "studio", "filmagem", "produtora", "audiovisual", "imagem"],
  },
  {
    key: "grafica",
    label: "Gráficas e comunicação visual",
    primaryKeywords: ["gráfica"],
    secondaryKeywords: ["comunicação visual", "copiadora", "letreiros"],
    synonyms: ["impressão", "adesivos", "plotagem", "banners", "brindes", "carimbos"],
    cnaes: { primary: ["1813-0/01", "1813-0/99"], related: ["1811-3/02", "8219-9/01", "7319-0/03", "3299-0/03"] },
    osmTags: { primary: [...t("craft", "printer"), ...t("shop", "copyshop")], related: t("craft", "signmaker"), broad: t("shop", "printer_ink") },
    nameKeywords: ["grafica", "comunicacao visual", "copiadora", "xerox", "impress", "plotag", "adesiv", "letreiro", "brindes"],
  },
  // ---- Varejo ------------------------------------------------------------
  {
    key: "varejo",
    label: "Lojas de roupas, calçados e acessórios",
    primaryKeywords: ["loja de roupas"],
    secondaryKeywords: ["loja", "boutique", "loja de calçados", "moda feminina", "moda masculina"],
    synonyms: ["varejo", "store", "moda", "moda infantil", "lingerie", "bolsas", "moda praia", "multimarcas", "brechó"],
    cnaes: { primary: ["4781-4/00", "4782-2/01"], related: ["4782-2/02", "4785-7/99", "1412-6/01", "4789-0/99"] },
    osmTags: {
      primary: t("shop", "clothes", "shoes", "boutique", "fashion"),
      related: t("shop", "bag", "fashion_accessories", "leather", "second_hand", "baby_goods"),
      broad: t("shop", "department_store", "variety_store", "mall"),
    },
    nameKeywords: ["loja", "boutique", "moda", "modas", "calcados", "store", "confec", "multimarca", "fashion", "kids", "brecho"],
  },
  {
    key: "joalheria",
    label: "Joalherias, relojoarias e presentes",
    primaryKeywords: ["joalheria"],
    secondaryKeywords: ["relojoaria", "semijoias", "loja de presentes"],
    synonyms: ["joias", "bijuterias", "acessórios", "ourives"],
    cnaes: { primary: ["4783-1/01"], related: ["4783-1/02", "3211-6/02", "4789-0/01"] },
    osmTags: { primary: t("shop", "jewelry"), related: t("shop", "watches", "gift"), broad: t("craft", "jeweller") },
    nameKeywords: ["joia", "joalheria", "relojoaria", "semijoia", "bijuteria", "presentes", "ourives", "acessorios"],
  },
  {
    key: "eletronicos",
    label: "Celulares, informática e eletrônicos",
    primaryKeywords: ["loja de celulares"],
    secondaryKeywords: ["informática", "assistência técnica", "eletrônicos", "eletrodomésticos"],
    synonyms: ["conserto de celular", "games", "acessórios para celular", "notebook", "computadores"],
    cnaes: { primary: ["4752-1/00", "4751-2/01"], related: ["4753-9/00", "9511-8/00", "9512-6/00", "9521-5/00", "4757-1/00", "4751-2/02"] },
    osmTags: {
      primary: t("shop", "mobile_phone", "computer", "electronics"),
      related: t("shop", "appliance", "video_games", "hifi", "telecommunication"),
      broad: t("craft", "electronics_repair"),
    },
    nameKeywords: ["celular", "cell", "informatica", "eletronic", "eletro", "assistencia", "games", "tech", "notebook", "iphone", "phone"],
  },
  {
    key: "papelaria",
    label: "Papelarias, livrarias e brinquedos",
    primaryKeywords: ["papelaria"],
    secondaryKeywords: ["livraria", "loja de brinquedos", "artigos para festas"],
    synonyms: ["material escolar", "armarinho", "aviamentos", "presentes"],
    cnaes: { primary: ["4761-0/03", "4761-0/01"], related: ["4763-6/01", "4755-5/01", "4755-5/03", "4789-0/07"] },
    osmTags: {
      primary: t("shop", "stationery", "books"),
      related: t("shop", "toys", "party", "craft", "fabric", "sewing"),
      broad: [],
    },
    nameKeywords: ["papelaria", "livraria", "brinquedos", "armarinho", "aviamentos", "festas", "toys"],
  },
  {
    key: "esportes",
    label: "Artigos esportivos e bicicletarias",
    primaryKeywords: ["loja de artigos esportivos"],
    secondaryKeywords: ["bicicletaria", "suplementos", "loja de pesca"],
    synonyms: ["esporte", "bike", "surf", "camping", "suplementos alimentares"],
    cnaes: { primary: ["4763-6/02"], related: ["4763-6/03", "4763-6/04", "4763-6/05", "4729-6/02", "9529-1/04"] },
    osmTags: {
      primary: t("shop", "sports", "bicycle"),
      related: t("shop", "outdoor", "fishing", "nutrition_supplements", "scuba_diving", "hunting"),
      broad: [],
    },
    nameKeywords: ["esporte", "sports", "bike", "bicicleta", "suplement", "pesca", "surf", "camping"],
  },
  {
    key: "floricultura",
    label: "Floriculturas e garden centers",
    primaryKeywords: ["floricultura"],
    secondaryKeywords: ["flores", "garden center", "paisagismo"],
    synonyms: ["plantas", "viveiro", "cestas de presente"],
    cnaes: { primary: ["4789-0/02"], related: ["0122-9/00", "8130-3/00"] },
    osmTags: { primary: t("shop", "florist"), related: t("shop", "garden_centre"), broad: t("craft", "gardener") },
    nameKeywords: ["flor", "floricultura", "garden", "plantas", "viveiro", "paisag"],
  },
  {
    key: "pet",
    label: "Pet shops e veterinárias",
    primaryKeywords: ["pet shop"],
    secondaryKeywords: ["veterinária", "clínica veterinária", "banho e tosa", "hotel para cães"],
    synonyms: ["pet", "animais", "ração", "agropet", "hospital veterinário", "adestramento"],
    cnaes: { primary: ["4789-0/04", "7500-1/00"], related: ["9609-2/08", "4623-1/09"] },
    osmTags: {
      primary: [...t("shop", "pet"), ...t("amenity", "veterinary")],
      related: [...t("shop", "pet_grooming"), ...t("amenity", "animal_boarding", "animal_training")],
      broad: t("shop", "agrarian"),
    },
    nameKeywords: ["pet", "veterinari", "animal", "banho e tosa", "racao", "agropet", "dog", "gato"],
  },
  {
    key: "agro",
    label: "Agropecuárias e agronegócio",
    primaryKeywords: ["agropecuária"],
    secondaryKeywords: ["casa agropecuária", "produtos agrícolas", "máquinas agrícolas"],
    synonyms: ["agro", "ração", "sementes", "fertilizantes", "defensivos", "irrigação", "fazenda"],
    cnaes: {
      primary: ["4789-0/04", "4623-1/09"],
      related: ["4683-4/00", "4661-3/00", "4692-3/00", "4632-0/01", "0161-0/03", "0162-8/01"],
    },
    osmTags: { primary: t("shop", "agrarian"), related: [...t("shop", "farm"), ...t("craft", "agricultural_engines")], broad: t("landuse", "farmyard") },
    nameKeywords: ["agropecuaria", "agro", "agricola", "racao", "rural", "fazenda", "sementes", "irriga"],
  },
  // ---- Automotivo / transporte -------------------------------------------
  {
    key: "automotivo",
    label: "Oficinas, autopeças e concessionárias",
    primaryKeywords: ["oficina mecânica"],
    secondaryKeywords: ["auto center", "concessionária", "autopeças", "borracharia", "funilaria"],
    synonyms: ["mecânica", "car repair", "lava-jato", "estética automotiva", "auto elétrica", "motos", "revenda de veículos", "som automotivo"],
    cnaes: {
      primary: ["4520-0/01", "4520-0/02", "4520-0/03"],
      related: ["4520-0/04", "4520-0/05", "4520-0/06", "4520-0/07", "4511-1/01", "4511-1/02", "4530-7/03", "4530-7/04", "4541-2/03", "4541-2/05", "4543-9/00"],
    },
    osmTags: {
      primary: t("shop", "car_repair"),
      related: t("shop", "car", "car_parts", "tyres", "motorcycle", "motorcycle_repair"),
      broad: [...t("amenity", "car_wash", "vehicle_inspection"), ...t("shop", "truck", "car_accessories")],
    },
    nameKeywords: ["oficina", "auto", "mecanica", "pneus", "borracharia", "funilaria", "motos", "veiculos", "lava jato", "autopecas"],
  },
  {
    key: "posto",
    label: "Postos de combustível e conveniência",
    primaryKeywords: ["posto de combustível"],
    secondaryKeywords: ["posto de gasolina", "loja de conveniência"],
    synonyms: ["combustível", "gás de cozinha", "revenda de gás"],
    cnaes: { primary: ["4731-8/00"], related: ["4732-6/00", "4784-9/00"] },
    osmTags: { primary: t("amenity", "fuel"), related: t("shop", "gas"), broad: t("amenity", "charging_station") },
    nameKeywords: ["posto", "combustive", "auto posto"],
  },
  {
    key: "locadora",
    label: "Locadoras de veículos e equipamentos",
    primaryKeywords: ["locadora de veículos"],
    secondaryKeywords: ["aluguel de carros", "locação de equipamentos", "aluguel de máquinas"],
    synonyms: ["rent a car", "locação", "aluguel de andaimes"],
    cnaes: { primary: ["7711-0/00"], related: ["7719-5/99", "7732-2/01", "7739-0/99", "7729-2/02"] },
    osmTags: { primary: t("amenity", "car_rental"), related: t("shop", "rental"), broad: [] },
    nameKeywords: ["locadora", "locacao", "aluguel"],
  },
  {
    key: "transporte",
    label: "Transportadoras, logística e mudanças",
    primaryKeywords: ["transportadora"],
    secondaryKeywords: ["logística", "mudanças", "entregas", "frete"],
    synonyms: ["cargas", "motoboy", "courier", "armazém", "fretamento", "transporte escolar"],
    cnaes: {
      primary: ["4930-2/01", "4930-2/02"],
      related: ["4930-2/04", "5211-7/99", "5250-8/04", "5320-2/02", "4929-9/01", "4929-9/02", "5229-0/99"],
    },
    osmTags: { primary: t("office", "logistics", "moving_company"), related: t("office", "courier"), broad: [] },
    nameKeywords: ["transport", "logistica", "mudanca", "cargas", "entregas", "express", "fretes"],
  },
  // ---- Indústria / outros --------------------------------------------------
  {
    key: "industria",
    label: "Indústrias e fábricas",
    primaryKeywords: ["indústria"],
    secondaryKeywords: ["fábrica", "confecção", "metalúrgica"],
    synonyms: ["manufatura", "distribuidora", "atacado", "usina", "beneficiamento"],
    cnaes: { primary: [], related: [] },
    osmTags: {
      primary: [...t("man_made", "works"), ...t("industrial", "*")],
      related: t("craft", "metal_construction", "dressmaker", "distillery", "brewery", "winery", "sawmill"),
      broad: t("shop", "wholesale"),
    },
    nameKeywords: ["industria", "fabrica", "confeccoes", "metalurgica", "distribuidora", "atacad", "usina", "ind com"],
  },
  {
    key: "funeraria",
    label: "Funerárias e planos funerários",
    primaryKeywords: ["funerária"],
    secondaryKeywords: ["plano funerário", "cemitério particular"],
    synonyms: ["velório", "assistência funeral"],
    cnaes: { primary: ["9603-3/04"], related: ["9603-3/01", "9603-3/05", "9603-3/99"] },
    osmTags: { primary: t("shop", "funeral_directors"), related: t("amenity", "funeral_hall", "crematorium"), broad: [] },
    nameKeywords: ["funeraria", "funeral", "velorio", "luto"],
  },
  {
    key: "costura",
    label: "Costura, ateliês e confecção sob medida",
    primaryKeywords: ["ateliê de costura"],
    secondaryKeywords: ["costureira", "alfaiataria", "confecção", "sapataria"],
    synonyms: ["ajustes de roupas", "bordados", "uniformes", "tecidos"],
    cnaes: { primary: ["1412-6/02", "1412-6/03"], related: ["1412-6/01", "9529-1/01", "1413-4/01", "4755-5/01"] },
    osmTags: {
      primary: t("craft", "tailor", "dressmaker"),
      related: [...t("shop", "tailor", "fabric", "sewing"), ...t("craft", "shoemaker")],
      broad: t("shop", "shoe_repair"),
    },
    nameKeywords: ["atelie", "costura", "alfaiat", "confec", "uniformes", "bordad", "sapataria", "tecidos"],
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
  /** Explicit Overture categories (composite ICP search); otherwise derived from the industry key. */
  overtureCategories?: string[] | null;
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
  // BROAD = every term we know; text sources cap how many they send (Nominatim 8, Photon 10) and
  // the local DB matches them all by name, so extra synonyms only ever add rows.
  else textTerms = [...industry.primaryKeywords, ...industry.secondaryKeywords, ...(opts.expandKeywords === false ? [] : industry.synonyms)];
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
