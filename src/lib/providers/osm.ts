import "server-only";

/**
 * OpenStreetMap discovery provider: Nominatim (geocoding) + Overpass API
 * (place search). Both are free public services with usage policies we must
 * respect — see DATA_SOURCES.md.
 *
 * Rate limiting: Nominatim's usage policy caps at ~1 request/second and
 * requires a descriptive User-Agent. Because this runs on serverless
 * functions with no shared in-memory state between invocations, we cannot
 * enforce a true cross-request limiter here — each user action is already
 * a single manual, human-triggered request (not a bulk crawl), which keeps
 * volume naturally low. If usage grows, move this behind a persistent queue
 * (see FREE_PLAN.md).
 */

const USER_AGENT = "ProspectEngine/1.0 (local prospecting tool; contact: workspace admin)";

export interface OsmBoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface OsmPlace {
  osmId: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  street: string | null;
  houseNumber: string | null;
  city: string | null;
  postcode: string | null;
  phone: string | null;
  website: string | null;
}

export const OSM_CATEGORIES: { value: string; label: string; query: string }[] = [
  { value: "restaurant", label: "Restaurantes", query: 'amenity=restaurant' },
  { value: "cafe", label: "Cafeterias", query: 'amenity=cafe' },
  { value: "fast_food", label: "Lanchonetes", query: 'amenity=fast_food' },
  { value: "bar", label: "Bares", query: 'amenity=bar' },
  { value: "dentist", label: "Odontologia", query: 'amenity=dentist' },
  { value: "clinic", label: "Clínicas", query: 'amenity=clinic' },
  { value: "doctors", label: "Consultórios médicos", query: 'amenity=doctors' },
  { value: "gym", label: "Academias", query: 'leisure=fitness_centre' },
  { value: "hairdresser", label: "Salões de beleza", query: 'shop=hairdresser' },
  { value: "beauty", label: "Estética", query: 'shop=beauty' },
  { value: "pet", label: "Pet shops", query: 'shop=pet' },
  { value: "veterinary", label: "Veterinárias", query: 'amenity=veterinary' },
  { value: "real_estate_agent", label: "Imobiliárias", query: 'office=estate_agent' },
  { value: "hotel", label: "Hotéis", query: 'tourism=hotel' },
  { value: "guest_house", label: "Pousadas", query: 'tourism=guest_house' },
  { value: "car_repair", label: "Oficinas mecânicas", query: 'shop=car_repair' },
  { value: "furniture", label: "Lojas de móveis", query: 'shop=furniture' },
  { value: "clothes", label: "Lojas de roupas", query: 'shop=clothes' },
];

export async function geocodeCity(city: string, state: string): Promise<OsmBoundingBox | null> {
  const query = encodeURIComponent(`${city}, ${state}, Brasil`);
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=br`;

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;

  const data = (await res.json()) as { boundingbox: string[] }[];
  if (!data.length) return null;

  const [south, north, west, east] = data[0].boundingbox.map(Number);
  return { south, north, west, east };
}

export async function searchPlaces(bbox: OsmBoundingBox, categoryTag: string, limit = 60): Promise<OsmPlace[]> {
  const [key, value] = categoryTag.split("=");
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;

  const overpassQuery = `
    [out:json][timeout:25];
    (
      node["${key}"="${value}"](${bboxStr});
      way["${key}"="${value}"](${bboxStr});
    );
    out center ${limit};
  `;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "text/plain", "User-Agent": USER_AGENT },
    body: overpassQuery,
  });

  if (!res.ok) {
    throw new Error(`Overpass API respondeu ${res.status}`);
  }

  const data = (await res.json()) as {
    elements: {
      id: number;
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }[];
  };

  return data.elements
    .filter((el): el is typeof el & { tags: Record<string, string> & { name: string } } => Boolean(el.tags?.name))
    .map((el) => {
      const lat = el.lat ?? el.center?.lat ?? 0;
      const lon = el.lon ?? el.center?.lon ?? 0;
      const tags = el.tags;
      return {
        osmId: String(el.id),
        name: tags.name,
        category: categoryTag,
        lat,
        lon,
        street: tags["addr:street"] ?? null,
        houseNumber: tags["addr:housenumber"] ?? null,
        city: tags["addr:city"] ?? null,
        postcode: tags["addr:postcode"] ?? null,
        phone: tags.phone ?? tags["contact:phone"] ?? null,
        website: tags.website ?? tags["contact:website"] ?? null,
      };
    })
    .slice(0, limit);
}
