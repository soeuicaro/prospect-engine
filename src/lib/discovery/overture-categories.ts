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
    related: ["event_venue", "party_supply", "caterer", "music_venue", "auditorium"],
  },
};

/** Categories for a niche at a mode, or null when the niche has no mapping (fall back to text terms). */
export function overtureCategoriesFor(industryKey: string | null | undefined, mode: SearchMode): string[] | null {
  const split = industryKey ? OVERTURE_CATEGORIES[industryKey] : undefined;
  if (!split) return null;
  return mode === "PRECISE" ? split.primary : [...split.primary, ...split.related];
}
