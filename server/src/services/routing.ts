import type { Authority, GeoContext, HazardType, RoutedAuthority } from "../types";
import { db } from "../db";

/** Approximate Nassau + Suffolk (excludes NYC boroughs on western LI). */
const LONG_ISLAND = {
  minLat: 40.55,
  maxLat: 41.2,
  minLng: -73.78,
  maxLng: -71.85,
};

const STATE_BY_CODE: Record<string, string> = {
  NY: "New York",
  NJ: "New Jersey",
  CT: "Connecticut",
  PA: "Pennsylvania",
  CA: "California",
  TX: "Texas",
  FL: "Florida",
};

export function isInLongIsland(lat: number, lng: number): boolean {
  return (
    lat >= LONG_ISLAND.minLat &&
    lat <= LONG_ISLAND.maxLat &&
    lng >= LONG_ISLAND.minLng &&
    lng <= LONG_ISLAND.maxLng
  );
}

function pointInBox(
  lat: number,
  lng: number,
  a: Pick<Authority, "min_lat" | "max_lat" | "min_lng" | "max_lng">
): boolean {
  if (
    a.min_lat == null ||
    a.max_lat == null ||
    a.min_lng == null ||
    a.max_lng == null
  ) {
    return false;
  }
  return lat >= a.min_lat && lat <= a.max_lat && lng >= a.min_lng && lng <= a.max_lng;
}

function boxArea(a: Authority): number {
  if (
    a.min_lat == null ||
    a.max_lat == null ||
    a.min_lng == null ||
    a.max_lng == null
  ) {
    return Number.POSITIVE_INFINITY;
  }
  return (a.max_lat - a.min_lat) * (a.max_lng - a.min_lng);
}

function listAuthorities(type?: string): Authority[] {
  if (type) {
    return db
      .prepare("SELECT * FROM authorities WHERE authority_type = ?")
      .all(type) as Authority[];
  }
  return db.prepare("SELECT * FROM authorities").all() as Authority[];
}

function pickTightest(candidates: Authority[]): Authority | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => boxArea(a) - boxArea(b))[0];
}

/**
 * Lightweight offline reverse-geocode for MVP.
 * Prefers seeded town/county boxes; falls back to coarse US region labels.
 */
export function resolveGeoContext(lat: number, lng: number): GeoContext {
  const towns = listAuthorities("town").filter((a) => pointInBox(lat, lng, a));
  const town = pickTightest(towns);

  const counties = listAuthorities("county").filter((a) => pointInBox(lat, lng, a));
  const county = pickTightest(counties);

  let stateCode: string | null = town?.state ?? county?.state ?? null;
  if (!stateCode) {
    // Coarse continental US guess — NY/LI first for seeded demos
    if (isInLongIsland(lat, lng) || (lat >= 40.45 && lat <= 45.05 && lng >= -79.8 && lng <= -71.8)) {
      stateCode = "NY";
    } else if (lat >= 24 && lat <= 49.5 && lng >= -125 && lng <= -66) {
      stateCode = "US";
    }
  }

  return {
    locality: town?.jurisdiction ?? null,
    county: county?.jurisdiction ?? null,
    state: stateCode ? STATE_BY_CODE[stateCode] ?? stateCode : null,
    stateCode,
    inLongIsland: isInLongIsland(lat, lng),
  };
}

function addUnique(
  results: RoutedAuthority[],
  authority: Authority | null | undefined,
  role: string,
  reason: string
): void {
  if (!authority) return;
  if (results.some((r) => r.authority.id === authority.id && r.role === role)) return;
  results.push({ authority, role, reason });
}

/**
 * Route a hazard report to the correct authorities.
 *
 * Rules:
 * - Hanging wires on Long Island → Verizon, Altice, Cablevision + state OSP
 * - Wires elsewhere → state OSP (or US OSP placeholder) + regional utility placeholder
 * - Potholes / road issues → town (tightest match), else county, else US town placeholder
 * - Other hazards → town/county when available, else US placeholders
 */
export function routeAuthorities(
  hazardType: HazardType,
  lat: number,
  lng: number,
  geo: GeoContext
): RoutedAuthority[] {
  const results: RoutedAuthority[] = [];
  const all = listAuthorities();

  const matching = (type: string, requireNonPlaceholder = true) =>
    all.filter(
      (a) =>
        a.authority_type === type &&
        pointInBox(lat, lng, a) &&
        (!requireNonPlaceholder || !a.is_placeholder)
    );

  if (hazardType === "wire") {
    if (geo.inLongIsland) {
      for (const id of ["li-verizon", "li-altice", "li-cablevision"]) {
        const utility = all.find((a) => a.id === id);
        addUnique(
          results,
          utility,
          "telecom_utility",
          "Hanging wire on Long Island — notify telecom outside-plant desks"
        );
      }
    } else {
      const utilities = matching("telecom_utility");
      addUnique(
        results,
        pickTightest(utilities) ?? all.find((a) => a.id === "us-placeholder-utility"),
        "telecom_utility",
        "Hanging wire — notify regional telecom outside-plant desk"
      );
    }

    const stateOsp = matching("state_outside_plant").filter(
      (a) => !geo.stateCode || a.state === geo.stateCode || a.state === "US"
    );
    addUnique(
      results,
      pickTightest(stateOsp) ?? all.find((a) => a.id === "us-placeholder-osp"),
      "state_outside_plant",
      "Wires must also be reported to the designated state outside-plant authority"
    );
  }

  if (hazardType === "pothole" || hazardType === "road_issue") {
    const towns = matching("town");
    const town = pickTightest(towns);
    if (town) {
      addUnique(
        results,
        town,
        "town",
        `Road issue reported to the town of ${town.jurisdiction}`
      );
    } else {
      const counties = matching("county");
      const county = pickTightest(counties);
      if (county) {
        addUnique(
          results,
          county,
          "county",
          `No town match — escalate to ${county.jurisdiction}`
        );
      } else {
        addUnique(
          results,
          all.find((a) => a.id === "us-placeholder-town"),
          "town",
          "No seeded town for this location — using US local public-works placeholder"
        );
      }
    }
  }

  if (hazardType === "other") {
    const town = pickTightest(matching("town"));
    const county = pickTightest(matching("county"));
    addUnique(
      results,
      town ?? county ?? all.find((a) => a.id === "us-placeholder-town"),
      town ? "town" : county ? "county" : "town",
      "General public hazard — notify local public-works authority"
    );
  }

  return results;
}
