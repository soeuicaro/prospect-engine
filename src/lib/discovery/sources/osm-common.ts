/**
 * Shared OSM tag → normalized record mapping (Overpass elements and
 * Nominatim `extratags` use the same tag vocabulary).
 */

import {
  classifySocialUrl,
  normalizeSocial,
  normalizeWebsite,
  splitPhones,
} from "../normalize";
import type { SocialMap, SourceCompany } from "../types";

export type OsmElementType = "node" | "way" | "relation";

export function osmRecordId(type: string, id: number | string): string {
  const t = type === "N" ? "node" : type === "W" ? "way" : type === "R" ? "relation" : type;
  return `${t}/${id}`;
}

export function osmUrl(recordId: string): string {
  return `https://www.openstreetmap.org/${recordId}`;
}

type Tags = Record<string, string | undefined>;

export function osmName(tags: Tags): string | null {
  return tags.name ?? tags["name:pt"] ?? tags.brand ?? tags.official_name ?? tags.alt_name ?? null;
}

export function osmCategory(tags: Tags): string | null {
  for (const key of ["amenity", "shop", "healthcare", "leisure", "tourism", "office", "craft"]) {
    if (tags[key]) return tags.cuisine ? `${key}=${tags[key]} (${tags.cuisine})` : `${key}=${tags[key]}`;
  }
  return null;
}

export function osmContactFields(tags: Tags): Pick<SourceCompany, "phone" | "phones" | "whatsapp" | "email" | "website" | "socials"> {
  const phones = [
    ...splitPhones(tags.phone),
    ...splitPhones(tags["contact:phone"]),
    ...splitPhones(tags["contact:mobile"]),
    ...splitPhones(tags.mobile),
  ];
  const uniquePhones = [...new Set(phones)];

  const socials: SocialMap = {};
  const setSocial = (key: keyof SocialMap, raw: string | undefined) => {
    const v = normalizeSocial(key, raw);
    if (v && !socials[key]) socials[key] = v;
  };
  setSocial("instagram", tags["contact:instagram"] ?? tags.instagram);
  setSocial("facebook", tags["contact:facebook"] ?? tags.facebook);
  setSocial("tiktok", tags["contact:tiktok"]);
  setSocial("linkedin", tags["contact:linkedin"]);
  setSocial("youtube", tags["contact:youtube"]);

  // A "website" tag that is actually a social profile is a social, not a site.
  let website: string | null = null;
  for (const raw of [tags.website, tags["contact:website"], tags.url]) {
    if (!raw) continue;
    const social = classifySocialUrl(raw);
    if (social) setSocial(social, raw);
    else if (!website) website = normalizeWebsite(raw);
  }

  const whatsapp = splitPhones(tags["contact:whatsapp"] ?? tags.whatsapp)[0] ?? null;
  const email = (tags.email ?? tags["contact:email"])?.split(";")[0]?.trim() || null;

  return { phone: uniquePhones[0] ?? null, phones: uniquePhones, whatsapp, email, website, socials };
}

export function osmAddressFields(tags: Tags): Pick<SourceCompany, "street" | "houseNumber" | "neighborhood" | "city" | "state" | "postcode"> {
  return {
    street: tags["addr:street"] ?? null,
    houseNumber: tags["addr:housenumber"] ?? null,
    neighborhood: tags["addr:suburb"] ?? tags["addr:neighbourhood"] ?? null,
    city: tags["addr:city"] ?? null,
    state: tags["addr:state"] ?? null,
    postcode: tags["addr:postcode"] ?? null,
  };
}
