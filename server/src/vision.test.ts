import { describe, it } from "node:test";
import assert from "assert/strict";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { classifyHazardImage } from "./services/vision";

const tmpDir = path.join(process.cwd(), "uploads", "vision-test");
fs.mkdirSync(tmpDir, { recursive: true });

async function makeWireLikeImage(filePath: string): Promise<void> {
  const size = 128;
  const buf = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      // Sky-ish upper half
      if (y < size * 0.55) {
        buf[i] = 140;
        buf[i + 1] = 180;
        buf[i + 2] = 230;
      } else {
        buf[i] = 70;
        buf[i + 1] = 90;
        buf[i + 2] = 60;
      }
      // Thick dark horizontal wire strands (survive 64px downscale)
      for (const baseY of [38, 46, 54]) {
        if (Math.abs(y - baseY) <= 1 && x > 8 && x < 120) {
          buf[i] = 18;
          buf[i + 1] = 18;
          buf[i + 2] = 18;
        }
      }
      // Sagging loop
      const sagY = 62 + Math.floor(14 * Math.sin((x / size) * Math.PI));
      if (Math.abs(y - sagY) <= 1 && x > 16 && x < 112) {
        buf[i] = 12;
        buf[i + 1] = 12;
        buf[i + 2] = 12;
      }
    }
  }
  await sharp(buf, { raw: { width: size, height: size, channels: 3 } })
    .jpeg()
    .toFile(filePath);
}

async function makePotholeLikeImage(filePath: string): Promise<void> {
  const size = 128;
  const buf = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      // Asphalt gray
      const n = ((x * 13 + y * 7) % 17) - 8;
      const g = 95 + n;
      buf[i] = g;
      buf[i + 1] = g;
      buf[i + 2] = g - 2;
      // Dark oval cavity in lower center
      const dx = (x - 64) / 22;
      const dy = (y - 88) / 16;
      if (dx * dx + dy * dy < 1) {
        buf[i] = 25;
        buf[i + 1] = 22;
        buf[i + 2] = 20;
      }
    }
  }
  await sharp(buf, { raw: { width: size, height: size, channels: 3 } })
    .jpeg()
    .toFile(filePath);
}

describe("visual intelligence", () => {
  it("identifies hanging-wire cues from description when no photo", async () => {
    const result = await classifyHazardImage(null, {
      description: "Hanging damaged wire sparking near the pole",
    });
    assert.equal(result.label, "hanging_wire");
    assert.equal(result.hazardType, "wire");
    assert.equal(result.reportable, true);
  });

  it("identifies pothole cues from description", async () => {
    const result = await classifyHazardImage(null, {
      description: "Large pothole in the right lane",
    });
    assert.equal(result.label, "pothole");
    assert.equal(result.hazardType, "pothole");
  });

  it("classifies a synthetic wire-like image as hanging_wire", async () => {
    const file = path.join(tmpDir, "wire.jpg");
    await makeWireLikeImage(file);
    const result = await classifyHazardImage(file, { backend: "heuristic" });
    assert.equal(result.label, "hanging_wire");
    assert.ok(result.confidence > 0.25);
    assert.equal(result.source, "heuristic");
  });

  it("classifies a synthetic pothole-like image as pothole", async () => {
    const file = path.join(tmpDir, "pothole.jpg");
    await makePotholeLikeImage(file);
    const result = await classifyHazardImage(file, { backend: "heuristic" });
    assert.equal(result.label, "pothole");
    assert.equal(result.hazardType, "pothole");
  });

  it("prefers confident on-device client prediction", async () => {
    const result = await classifyHazardImage(null, {
      clientPrediction: {
        label: "road_damage",
        confidence: 0.91,
      },
    });
    assert.equal(result.label, "road_damage");
    assert.equal(result.hazardType, "road_issue");
    assert.equal(result.source, "client");
  });
});
