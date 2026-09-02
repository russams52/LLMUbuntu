import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migrate } from "./db";
import { seedAuthorities } from "./data/authorities";
import { isInLongIsland, resolveGeoContext, routeAuthorities } from "./services/routing";

migrate();
seedAuthorities();

describe("Long Island detection", () => {
  it("detects Hempstead coordinates as Long Island", () => {
    assert.equal(isInLongIsland(40.7062, -73.6187), true);
  });

  it("rejects Manhattan", () => {
    assert.equal(isInLongIsland(40.758, -73.9855), false);
  });
});

describe("wire routing on Long Island", () => {
  it("routes to Verizon, Altice, Cablevision, and NY OSP", () => {
    const lat = 40.7062;
    const lng = -73.6187;
    const geo = resolveGeoContext(lat, lng);
    const routed = routeAuthorities("wire", lat, lng, geo);
    const ids = routed.map((r) => r.authority.id).sort();

    assert.ok(geo.inLongIsland);
    assert.deepEqual(ids, ["li-altice", "li-cablevision", "li-verizon", "ny-osp"].sort());
  });
});

describe("pothole routing to town", () => {
  it("routes Brookhaven coordinates to Town of Brookhaven", () => {
    const lat = 40.92;
    const lng = -72.85;
    const geo = resolveGeoContext(lat, lng);
    const routed = routeAuthorities("pothole", lat, lng, geo);

    assert.equal(routed.length, 1);
    assert.equal(routed[0].authority.id, "town-brookhaven");
    assert.equal(routed[0].role, "town");
  });
});

describe("US placeholder fallback", () => {
  it("uses placeholders for wires outside seeded footprints", () => {
    const lat = 34.0522;
    const lng = -118.2437; // Los Angeles
    const geo = resolveGeoContext(lat, lng);
    const routed = routeAuthorities("wire", lat, lng, geo);
    const ids = routed.map((r) => r.authority.id);

    assert.equal(geo.inLongIsland, false);
    assert.ok(ids.includes("us-placeholder-utility"));
    assert.ok(ids.includes("us-placeholder-osp"));
  });

  it("uses town placeholder for potholes outside seeded towns", () => {
    const lat = 41.8781;
    const lng = -87.6298; // Chicago
    const geo = resolveGeoContext(lat, lng);
    const routed = routeAuthorities("pothole", lat, lng, geo);

    assert.equal(routed[0].authority.id, "us-placeholder-town");
  });
});
