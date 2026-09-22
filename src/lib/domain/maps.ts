/**
 * Google Maps is used ONLY through public Maps URLs opened by the user — we
 * generate search/location URLs from data we already hold and never call a
 * Maps API, scrape, or store Maps content. See MAPS.md.
 *
 * Maps URLs reference: https://developers.google.com/maps/documentation/urls/get-started
 */

export interface MapsInput {
  trade_name?: string | null;
  legal_name?: string | null;
  street?: string | null;
  street_number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export type MapsStrategy = "name_address" | "name_city" | "name_only" | "address_only" | "coordinates" | "city_only";

export interface MapsLinks {
  /** Text search for the business — works without any official Maps URL. */
  searchUrl: string;
  /** Pin at the stored coordinates, when we have them. */
  pinUrl: string | null;
  query: string;
  strategy: MapsStrategy;
}

function validCoords(lat: number | null | undefined, lon: number | null | undefined): lat is number {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

/**
 * Smart query (§106):
 * - name + address → "Nome, Rua X 123, Bairro, Cidade - UF"
 * - name only      → "Nome, Cidade - UF"
 * - no name, coords → coordinates
 */
export function buildGoogleMapsLinks(input: MapsInput): MapsLinks {
  const name = (input.trade_name || input.legal_name || "").trim();
  const street = [input.street, input.street_number].filter(Boolean).join(" ").trim();
  const cityUf = [input.city, input.state].filter(Boolean).join(" - ");
  const hasCoords = validCoords(input.latitude, input.longitude);
  const coords = hasCoords ? `${input.latitude},${input.longitude}` : null;

  let strategy: MapsStrategy;
  let parts: string[];
  if (name && street) {
    strategy = "name_address";
    parts = [name, street, input.neighborhood ?? "", cityUf];
  } else if (name && cityUf) {
    strategy = "name_city";
    parts = [name, cityUf];
  } else if (name) {
    strategy = "name_only";
    parts = [name];
  } else if (street) {
    strategy = "address_only";
    parts = [street, cityUf];
  } else if (coords) {
    strategy = "coordinates";
    parts = [coords];
  } else {
    strategy = "city_only";
    parts = [cityUf];
  }

  const query = parts.map((p) => p.trim()).filter(Boolean).join(", ");
  return {
    searchUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
    pinUrl: coords ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coords)}` : null,
    query,
    strategy,
  };
}

/** Back-compat helper (older call sites). */
export function buildGoogleMapsSearchUrl(input: MapsInput): string {
  return buildGoogleMapsLinks(input).searchUrl;
}

export const MAPS_VALIDATION_STATUSES = ["NOT_VALIDATED", "FOUND", "NOT_FOUND", "WRONG_RESULT", "DUPLICATE", "NEEDS_REVIEW"] as const;
export type MapsValidationStatus = (typeof MAPS_VALIDATION_STATUSES)[number];

export const MAPS_VALIDATION_LABELS: Record<MapsValidationStatus, string> = {
  NOT_VALIDATED: "Não validado",
  FOUND: "Encontrado no Maps",
  NOT_FOUND: "Não encontrado",
  WRONG_RESULT: "Resultado errado",
  DUPLICATE: "Duplicado",
  NEEDS_REVIEW: "Precisa revisão",
};
