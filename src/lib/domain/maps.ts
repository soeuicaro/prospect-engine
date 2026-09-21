/**
 * Google Maps is used ONLY as an external validation/consultation link — we
 * generate a search URL from data we already hold, we never scrape or store
 * Maps content. See MAPS_USAGE.md.
 */
export function buildGoogleMapsSearchUrl(input: {
  trade_name?: string | null;
  legal_name?: string | null;
  street?: string | null;
  street_number?: string | null;
  city?: string | null;
  state?: string | null;
}): string {
  const name = input.trade_name || input.legal_name || "";
  const address = [input.street, input.street_number].filter(Boolean).join(", ");
  const parts = [name, address, input.city, input.state].filter(Boolean);
  const query = encodeURIComponent(parts.join(", "));
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}
