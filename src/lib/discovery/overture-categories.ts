/**
 * Industry catalog key → Overture Places categories (taxonomy keys, as seen
 * in `places_pois.categories`, which holds primary + alternate + hierarchy
 * + basic category). PRIMARY is the niche itself; RELATED joins in BALANCED
 * and BROAD modes, mirroring the OSM tag split in industries.ts.
 */

import type { SearchMode } from "./types";

type Split = { primary: string[]; related: string[] };

export const OVERTURE_CATEGORIES: Record<string, Split> = {
  restaurante: {
    primary: ["restaurant", "brazilian_restaurant", "barbecue_restaurant", "steakhouse", "buffet_restaurant", "italian_restaurant", "seafood_restaurant", "sushi_restaurant", "japanese_restaurant", "diner", "bar_and_grill_restaurant"],
    related: ["casual_eatery", "fast_food_restaurant", "pizza_restaurant", "burger_restaurant", "sandwich_shop", "food_delivery_service", "caterer", "food_court"],
  },
  cafeteria: {
    primary: ["cafe", "coffee_shop", "bakery"],
    related: ["desserts", "dessert_shop", "ice_cream_shop", "smoothie_juice_bar", "chocolatier", "candy_store"],
  },
  clinica: {
    primary: ["medical_center", "health_and_medical", "outpatient_care_facility", "doctor", "general_practitioner"],
    related: ["diagnostic_services", "diagnostics_imaging_or_lab_service", "laboratory_testing", "specialized_health_care", "cardiologist", "pediatrician", "pediatric_clinic", "obstetrician_and_gynecologist", "reproductive_perinatal_and_womens_care", "eye_care_clinic", "vision_or_eye_care_clinic", "surgery", "medical_service"],
  },
  odontologia: { primary: ["dentist", "dental_clinic", "general_dentistry", "orthodontist"], related: [] },
  psicologia: { primary: ["psychologist", "psychotherapist", "behavioral_or_mental_health_clinic"], related: ["counseling_and_mental_health"] },
  fisioterapia: { primary: ["physical_therapy", "physical_medicine_and_rehabilitation"], related: ["chiropractor", "massage_therapy"] },
  academia: { primary: ["gym", "fitness_trainer"], related: ["martial_arts_club", "sport_or_fitness_facility", "yoga_studio", "pilates_studio", "dance_school"] },
  escola: {
    primary: ["school", "private_school", "elementary_school", "high_school", "preschool", "specialty_school", "education"],
    related: ["tutoring_center", "tutoring_service", "language_school", "driving_school", "college_university", "place_of_learning"],
  },
  hotelaria: { primary: ["hotel", "accommodation", "lodging"], related: ["motel", "bed_and_breakfast", "guest_house", "hostel"] },
  imobiliaria: { primary: ["real_estate_service", "real_estate_agent"], related: ["home_developer", "property_management"] },
  construcao: {
    primary: ["construction_services", "building_or_construction_service", "contractor", "home_developer"],
    related: ["building_supply_store", "hardware_store", "hardware_home_and_garden_store", "glass_and_mirror_sales_service", "electrician"],
  },
  "salao-beleza": {
    primary: ["beauty_salon", "hair_salon", "barber", "nail_salon", "personal_or_beauty_service"],
    related: ["spas", "makeup_artist", "tanning_salon", "tattoo_and_piercing", "cosmetic_and_beauty_supplies", "hair_supply_stores", "wellness_service"],
  },
  pet: { primary: ["pet_store", "veterinarian", "animal_and_pet_store", "animal_or_pet_service"], related: ["pet_groomer"] },
  varejo: {
    primary: ["clothing_store", "womens_clothing_store", "mens_clothing_store", "childrens_clothing_store", "shoe_store", "fashion_and_apparel_store", "boutique"],
    related: ["jewelry_store", "fashion_accessories_store", "lingerie_store", "eyewear_and_optician", "mobile_phone_store", "electronics", "furniture_store", "department_store", "flowers_and_gifts_shop", "sports_wear", "shopping"],
  },
  automotivo: {
    primary: ["automotive_repair", "automotive_service", "automotive_services_and_repair", "car_wash", "tire_dealer_and_repair", "motorcycle_repair"],
    related: ["auto_parts_and_supply_store", "vehicle_parts_store", "car_dealer", "used_car_dealer", "motorcycle_dealer", "auto_dealer", "vehicle_dealer", "gas_station"],
  },
  arquitetura: { primary: ["architectural_designer", "engineering_services"], related: ["design_service", "interior_design", "graphic_designer"] },
  eventos: {
    primary: ["party_and_event_planning", "event_or_party_service", "event_photography"],
    related: ["event_venue", "party_supply", "caterer", "music_venue", "auditorium", "wedding_planning", "dj_service", "party_equipment_rental"],
  },
  bar: {
    primary: ["bar", "pub", "cocktail_bar", "beer_bar", "sports_bar", "wine_bar", "lounge", "dive_bar"],
    related: ["night_club", "brewery", "beer_garden", "karaoke", "hookah_bar", "bar_and_grill_restaurant"],
  },
  sorveteria: {
    primary: ["ice_cream_shop", "frozen_yoghurt_shop", "acai_bowls"],
    related: ["desserts", "dessert_shop", "candy_store", "chocolatier", "smoothie_juice_bar", "juice_bar"],
  },
  supermercado: {
    primary: ["supermarket", "grocery_store", "convenience_store", "food_and_beverage_store"],
    related: ["butcher_shop", "meat_shop", "fruits_and_vegetables", "produce_store", "liquor_store", "beverage_store", "health_food_store", "farmers_market", "specialty_foods", "wholesale_store", "seafood_market"],
  },
  hospital: { primary: ["hospital", "emergency_room", "maternity_centers"], related: ["urgent_care_clinic", "medical_center"] },
  laboratorio: {
    primary: ["laboratory_testing", "diagnostic_services", "diagnostics_imaging_or_lab_service", "medical_laboratory"],
    related: ["diagnostic_imaging", "radiologist", "blood_and_plasma_donation_center"],
  },
  nutricao: { primary: ["nutritionist", "dietitian"], related: ["weight_loss_center"] },
  farmacia: { primary: ["pharmacy", "drugstore"], related: ["medical_supply", "cosmetic_and_beauty_supplies", "health_and_beauty_store"] },
  otica: { primary: ["eyewear_and_optician", "optometrist", "optician"], related: ["eye_care_clinic", "vision_or_eye_care_clinic"] },
  estetica: {
    primary: ["beauty_salon", "skin_care", "hair_removal", "laser_hair_removal", "medical_spa", "day_spa", "spas"],
    related: ["massage", "massage_therapy", "eyelash_service", "tanning_salon", "permanent_makeup", "wellness_service"],
  },
  tatuagem: { primary: ["tattoo_and_piercing", "tattoo", "piercing"], related: [] },
  idiomas: {
    primary: ["language_school"],
    related: ["music_school", "dance_school", "art_school", "cooking_school", "computer_training", "vocational_and_technical_school", "specialty_school", "tutoring_center"],
  },
  autoescola: { primary: ["driving_school"], related: ["traffic_school"] },
  advocacia: {
    primary: ["lawyer", "law_firm", "attorney", "legal_services"],
    related: ["divorce_and_family_law", "criminal_defense_law", "personal_injury_law", "employment_law", "estate_planning_law", "immigration_law", "tax_law", "bankruptcy_law", "business_law", "real_estate_law", "general_litigation", "labor_law", "notary_public", "paralegal_services"],
  },
  contabilidade: { primary: ["accountant", "accounting", "bookkeeper", "tax_services"], related: ["tax_preparation", "tax_advisor", "payroll_services", "financial_advising"] },
  cartorio: { primary: ["notary_public"], related: ["legal_services", "public_service_and_government"] },
  "b2b-servicos": {
    primary: ["business_consulting", "professional_services", "business_management_services", "consultant"],
    related: ["employment_agencies", "human_resource_services", "coworking_space", "office_space", "business_to_business", "b2b_service", "business_advertising", "translation_services"],
  },
  marketing: {
    primary: ["advertising_agency", "marketing_agency", "marketing_consultant", "social_media_agency"],
    related: ["public_relations", "graphic_designer", "web_designer", "media_agency", "video_film_production", "branding"],
  },
  tecnologia: {
    primary: ["software_development", "information_technology_company", "it_service_and_computer_repair", "it_consultant"],
    related: ["web_designer", "internet_service_provider", "telecommunications_company", "computer_hardware_company", "data_recovery"],
  },
  seguros: { primary: ["insurance_agency", "insurance_broker"], related: ["auto_insurance", "health_insurance_office", "life_insurance"] },
  financeiro: {
    primary: ["bank_credit_union", "banks", "bank", "credit_union"],
    related: ["financial_service", "loan_provider", "currency_exchange", "check_cashing_payday_loans", "financial_advising", "investment_management_company"],
  },
  "material-construcao": {
    primary: ["building_supply_store", "hardware_store", "hardware_home_and_garden_store", "home_improvement_store"],
    related: ["paint_store", "flooring_store", "tile_store", "lumber_store", "glass_and_mirror_sales_service", "electrical_supply_store", "plumbing_supply_store", "kitchen_and_bath"],
  },
  "moveis-decoracao": {
    primary: ["furniture_store", "cabinet_sales_service", "kitchen_and_bath", "home_decor"],
    related: ["mattress_store", "interior_design", "carpenter", "upholstery_shop", "window_treatment_store", "lighting_store", "home_goods_store", "rug_store"],
  },
  manutencao: {
    primary: ["electrician", "plumbing", "plumber", "hvac_services", "air_conditioning_and_heating"],
    related: ["locksmith", "metal_fabricator", "welder", "glass_and_mirror_sales_service", "handyman", "home_service", "security_systems", "garage_door_service"],
  },
  "energia-solar": { primary: ["solar_installation", "solar_panel_installation", "solar_energy_equipment_supplier"], related: ["electrician", "energy_company", "renewable_energy"] },
  limpeza: {
    primary: ["cleaning_services", "janitorial_services", "pest_control", "pest_control_service"],
    related: ["home_cleaning", "carpet_cleaning", "landscaping", "gardener", "security_services", "pressure_washing"],
  },
  lavanderia: { primary: ["laundromat", "dry_cleaning", "laundry_services"], related: ["clothing_alterations"] },
  turismo: { primary: ["travel_agency", "travel_services", "tour_operator"], related: ["tours", "sightseeing_tour_agency", "travel_agents", "bus_tours"] },
  fotografia: {
    primary: ["photographer", "photography_store_and_services", "event_photography"],
    related: ["videographer", "video_film_production", "photo_booth_rental", "portrait_studio", "wedding_photography"],
  },
  grafica: {
    primary: ["printing_services", "print_shop", "printer"],
    related: ["signmaking", "sign_making", "screen_printing_t_shirt_printing", "promotional_products", "copy_shop", "graphic_designer"],
  },
  joalheria: { primary: ["jewelry_store", "watch_store"], related: ["gift_shop", "flowers_and_gifts_shop", "fashion_accessories_store", "jewelry_repair_service", "watch_repair_service"] },
  eletronicos: {
    primary: ["mobile_phone_store", "electronics", "computer_store", "electronics_store"],
    related: ["mobile_phone_repair", "electronics_repair_shop", "computer_repair", "appliance_store", "video_game_store", "it_service_and_computer_repair", "telecommunications"],
  },
  papelaria: { primary: ["office_supply_store", "stationery_store", "bookstore", "books_mags_music_and_video"], related: ["toy_store", "party_supply", "arts_and_crafts", "fabric_store", "hobby_shop", "educational_supply_store"] },
  esportes: { primary: ["sporting_goods", "sports_and_fitness_store", "bicycle_shop"], related: ["outdoor_gear", "fishing_supply_store", "vitamins_and_supplements", "bike_repair_maintenance", "surf_shop"] },
  floricultura: { primary: ["florist", "flowers_and_gifts_shop"], related: ["nursery_and_gardening", "garden_center", "landscaping"] },
  agro: {
    primary: ["agricultural_service", "farm_equipment_and_supply", "feed_store", "farming_equipment_store"],
    related: ["farm", "agriculture", "agricultural_cooperatives", "livestock_breeder", "seed_supplier", "irrigation"],
  },
  posto: { primary: ["gas_station", "fuel_station"], related: ["convenience_store", "ev_charging_station", "propane_supplier"] },
  locadora: { primary: ["car_rental_agency", "car_rental"], related: ["equipment_rental", "truck_rentals", "motorcycle_rentals", "party_equipment_rental"] },
  transporte: {
    primary: ["logistics", "freight_and_cargo_service", "trucking_company", "shipping_center", "courier_service"],
    related: ["moving_company", "movers", "freight_forwarding_agency", "warehouses", "delivery_service", "shipping_and_delivery_service", "bus_service"],
  },
  industria: {
    primary: ["manufacturing", "manufacturers", "industrial_company", "factory"],
    related: ["metal_fabricator", "textile_mill", "food_beverage_service_distribution", "wholesale_store", "wholesaler", "industrial_equipment", "plastic_manufacturer", "furniture_manufacturers", "clothing_company"],
  },
  funeraria: { primary: ["funeral_services_and_cemeteries", "funeral_home"], related: ["cemetery", "cremation_services"] },
  costura: { primary: ["tailor", "sewing_and_alterations", "clothing_alterations"], related: ["fabric_store", "shoe_repair", "embroidery_and_crochet", "uniform_store", "custom_clothing"] },
};

/** Categories for a niche at a mode, or null when the niche has no mapping (fall back to text terms). */
export function overtureCategoriesFor(industryKey: string | null | undefined, mode: SearchMode): string[] | null {
  const split = industryKey ? OVERTURE_CATEGORIES[industryKey] : undefined;
  if (!split) return null;
  return mode === "PRECISE" ? split.primary : [...split.primary, ...split.related];
}
