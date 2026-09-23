import fs from "fs";
import path from "path";
import sharp from "sharp";
import type { HazardType } from "../types";

/** Visual Intelligence class labels for public hazards. */
export type VisionLabel =
  | "hanging_wire"
  | "pothole"
  | "road_damage"
  | "debris_obstacle"
  | "safe_scene";

export interface VisionScore {
  label: VisionLabel;
  confidence: number;
}

export interface VisionResult {
  label: VisionLabel;
  hazardType: HazardType | null;
  confidence: number;
  reportable: boolean;
  title: string;
  detail: string;
  scores: VisionScore[];
  source: "heuristic" | "clip" | "client";
  cues: string[];
}

export interface ClassifyOptions {
  /** Optional free-text description from the reporter. */
  description?: string;
  /** Prefer this backend; defaults to VISION_BACKEND env or heuristic. */
  backend?: "heuristic" | "clip";
  /** Client-side Vision/Core ML prediction already computed on device. */
  clientPrediction?: {
    label: VisionLabel;
    confidence: number;
    scores?: VisionScore[];
  };
}

const LABEL_META: Record<
  VisionLabel,
  { title: string; detail: string; hazardType: HazardType | null; reportable: boolean }
> = {
  hanging_wire: {
    title: "Hanging / damaged wire",
    detail: "Sagging, dangling, tangled, or downed aerial plant.",
    hazardType: "wire",
    reportable: true,
  },
  pothole: {
    title: "Pothole",
    detail: "Broken pavement cavity or crater in the roadway.",
    hazardType: "pothole",
    reportable: true,
  },
  road_damage: {
    title: "Road damage",
    detail: "Cracks, upheaval, missing asphalt, or other road surface failure.",
    hazardType: "road_issue",
    reportable: true,
  },
  debris_obstacle: {
    title: "Debris / obstacle",
    detail: "Object blocking or endangering a public area.",
    hazardType: "other",
    reportable: true,
  },
  safe_scene: {
    title: "No reportable hazard",
    detail: "Scene does not appear to show a public safety hazard.",
    hazardType: null,
    reportable: false,
  },
};

const CLIP_PROMPTS: Record<VisionLabel, string[]> = {
  hanging_wire: [
    "a photo of a hanging damaged electrical or telecom wire",
    "a sagging or dangling power line outdoors",
    "downed utility wire on the ground",
  ],
  pothole: [
    "a photo of a pothole in a road",
    "a deep hole in asphalt pavement",
    "broken road surface with a crater",
  ],
  road_damage: [
    "cracked or damaged road pavement",
    "broken asphalt without a deep pothole",
    "road surface upheaval or missing pavement",
  ],
  debris_obstacle: [
    "debris or obstacle blocking a public road or sidewalk",
    "fallen tree branch or trash hazard outdoors",
  ],
  safe_scene: [
    "a normal outdoor street with no hazards",
    "safe sidewalk or road with no damage",
  ],
};

const TEXT_CUES: Array<{ label: VisionLabel; patterns: RegExp[] }> = [
  {
    label: "hanging_wire",
    patterns: [
      /\b(hanging|sagging|dangling|downed|low[- ]hanging)\b.*\b(wire|cable|line|power)\b/i,
      /\b(wire|cable|line)\b.*\b(hanging|sagging|dangling|downed|sparking)\b/i,
      /\b(utility|telecom|aerial)\s+(plant|wire|cable)\b/i,
    ],
  },
  {
    label: "pothole",
    patterns: [/\bpothole(s)?\b/i, /\bcrater\b.*\b(road|street|asphalt)\b/i],
  },
  {
    label: "road_damage",
    patterns: [
      /\b(road|street|pavement|asphalt)\b.*\b(crack|damage|heave|broken|fail)\b/i,
      /\b(cracked|broken)\s+(road|pavement|asphalt)\b/i,
    ],
  },
  {
    label: "debris_obstacle",
    patterns: [
      /\b(debris|obstacle|fallen\s+tree|branch|trash|barricade)\b/i,
      /\bblock(ing|ed)?\b.*\b(road|sidewalk|lane)\b/i,
    ],
  },
];

const CONFIDENCE_THRESHOLD = Number(process.env.VISION_CONFIDENCE_THRESHOLD || 0.42);

let clipPipelinePromise: Promise<any> | null = null;

function preferredBackend(explicit?: "heuristic" | "clip"): "heuristic" | "clip" {
  if (explicit) return explicit;
  const env = (process.env.VISION_BACKEND || "heuristic").toLowerCase();
  return env === "clip" ? "clip" : "heuristic";
}

function resultFromLabel(
  label: VisionLabel,
  confidence: number,
  scores: VisionScore[],
  source: VisionResult["source"],
  cues: string[]
): VisionResult {
  const meta = LABEL_META[label];
  return {
    label,
    hazardType: meta.hazardType,
    confidence,
    reportable: meta.reportable && confidence >= CONFIDENCE_THRESHOLD,
    title: meta.title,
    detail: meta.detail,
    scores: scores.sort((a, b) => b.confidence - a.confidence),
    source,
    cues,
  };
}

function softmax(values: number[]): number[] {
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

function scoreFromDescription(description?: string): Partial<Record<VisionLabel, number>> {
  const scores: Partial<Record<VisionLabel, number>> = {};
  if (!description?.trim()) return scores;
  for (const cue of TEXT_CUES) {
    if (cue.patterns.some((p) => p.test(description))) {
      scores[cue.label] = (scores[cue.label] ?? 0) + 0.55;
    }
  }
  return scores;
}

interface ImageFeatures {
  width: number;
  height: number;
  meanR: number;
  meanG: number;
  meanB: number;
  meanLuma: number;
  darkRatio: number;
  midGrayRatio: number;
  brightRatio: number;
  horizontalEdgeEnergy: number;
  verticalEdgeEnergy: number;
  centerDarkness: number;
  lowerCenterDarkness: number;
  asphaltLikeness: number;
  skyLikeness: number;
  horizontalDarkRuns: number;
}

async function extractFeatures(imagePathOrBuffer: string | Buffer): Promise<ImageFeatures> {
  const size = 64;
  const { data, info } = await sharp(imagePathOrBuffer)
    .rotate()
    .resize(size, size, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const pixels = w * h;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let dark = 0;
  let midGray = 0;
  let bright = 0;
  let asphalt = 0;
  let sky = 0;

  const luma = new Float32Array(pixels);
  for (let i = 0; i < pixels; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    luma[i] = y;
    if (y < 55) dark++;
    else if (y > 200) bright++;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (y > 40 && y < 140 && chroma < 28) asphalt++;
    if (b > r + 15 && b > g + 5 && y > 90) sky++;
  }

  let hEdge = 0;
  let vEdge = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const dx = Math.abs(luma[i] - luma[i - 1]);
      const dy = Math.abs(luma[i] - luma[i - w]);
      hEdge += dx;
      vEdge += dy;
    }
  }
  const edgeCells = (w - 2) * (h - 2) || 1;

  // Count long dark horizontal runs in the upper 60% (aerial plant zone).
  let horizontalDarkRuns = 0;
  const wireZoneMaxY = Math.floor(h * 0.6);
  for (let y = 0; y < wireZoneMaxY; y++) {
    let run = 0;
    for (let x = 0; x < w; x++) {
      if (luma[y * w + x] < 60) {
        run++;
      } else {
        if (run >= Math.floor(w * 0.35)) horizontalDarkRuns++;
        run = 0;
      }
    }
    if (run >= Math.floor(w * 0.35)) horizontalDarkRuns++;
  }

  const sampleRegion = (x0: number, y0: number, x1: number, y1: number) => {
    let sum = 0;
    let count = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        sum += luma[y * w + x];
        count++;
      }
    }
    return count ? sum / count : 128;
  };

  return {
    width: w,
    height: h,
    meanR: sumR / pixels,
    meanG: sumG / pixels,
    meanB: sumB / pixels,
    meanLuma: (sumR * 0.299 + sumG * 0.587 + sumB * 0.114) / pixels,
    darkRatio: dark / pixels,
    midGrayRatio: midGray / pixels,
    brightRatio: bright / pixels,
    horizontalEdgeEnergy: hEdge / edgeCells,
    verticalEdgeEnergy: vEdge / edgeCells,
    centerDarkness: 255 - sampleRegion(22, 22, 42, 42),
    lowerCenterDarkness: 255 - sampleRegion(20, 36, 44, 58),
    asphaltLikeness: asphalt / pixels,
    skyLikeness: sky / pixels,
    horizontalDarkRuns,
  };
}

function heuristicScores(
  features: ImageFeatures,
  description?: string
): Record<VisionLabel, number> {
  const textBoost = scoreFromDescription(description);
  const edgeRatio =
    features.horizontalEdgeEnergy / (features.verticalEdgeEnergy + 1e-3);
  const wireLike =
    (features.horizontalDarkRuns >= 1 && features.skyLikeness > 0.05) ||
    (features.skyLikeness > 0.1 && edgeRatio > 1.08 && features.horizontalEdgeEnergy > 10);

  const raw: Record<VisionLabel, number> = {
    hanging_wire:
      0.1 +
      (features.horizontalDarkRuns >= 2 && features.skyLikeness > 0.05
        ? 1.2
        : features.horizontalDarkRuns >= 1 && features.skyLikeness > 0.05
          ? 0.85
          : 0) +
      (wireLike ? 0.45 : 0) +
      (textBoost.hanging_wire ?? 0),
    pothole:
      0.12 +
      (features.asphaltLikeness > 0.25 ? 0.4 : features.asphaltLikeness > 0.12 ? 0.18 : 0) +
      (features.lowerCenterDarkness > 140 && features.skyLikeness < 0.15 ? 0.5 : 0) +
      (features.centerDarkness > 120 && features.asphaltLikeness > 0.15 ? 0.25 : 0) +
      (features.skyLikeness < 0.1 ? 0.15 : 0) +
      (textBoost.pothole ?? 0),
    road_damage:
      0.1 +
      (features.asphaltLikeness > 0.2 && features.horizontalDarkRuns === 0 ? 0.3 : 0) +
      (features.horizontalEdgeEnergy > 18 && features.verticalEdgeEnergy > 18 ? 0.25 : 0.1) +
      (features.lowerCenterDarkness > 90 &&
      features.lowerCenterDarkness < 140 &&
      features.skyLikeness < 0.12
        ? 0.2
        : 0) +
      (textBoost.road_damage ?? 0),
    debris_obstacle:
      0.08 +
      (features.darkRatio > 0.2 && features.horizontalDarkRuns === 0 ? 0.2 : 0) +
      (Math.abs(features.meanR - features.meanG) > 20 ? 0.15 : 0) +
      (features.asphaltLikeness > 0.1 && features.skyLikeness < 0.2 ? 0.15 : 0) +
      (textBoost.debris_obstacle ?? 0),
    safe_scene:
      0.12 +
      (!wireLike && features.skyLikeness > 0.2 && features.darkRatio < 0.08 ? 0.3 : 0) +
      (!wireLike && features.asphaltLikeness < 0.15 && edgeRatio < 1.02 ? 0.2 : 0) +
      (!wireLike && features.lowerCenterDarkness < 90 ? 0.15 : 0),
  };

  // Softmax keeps scores comparable across backends.
  const labels = Object.keys(raw) as VisionLabel[];
  const probs = softmax(labels.map((l) => raw[l]));
  const out = {} as Record<VisionLabel, number>;
  labels.forEach((l, i) => {
    out[l] = probs[i];
  });
  return out;
}

async function getClipPipeline(): Promise<any> {
  if (!clipPipelinePromise) {
    clipPipelinePromise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      env.allowLocalModels = false;
      env.useBrowserCache = false;
      return pipeline("zero-shot-image-classification", "Xenova/clip-vit-base-patch32");
    })();
  }
  return clipPipelinePromise;
}

async function clipScores(
  imagePathOrBuffer: string | Buffer,
  description?: string
): Promise<Record<VisionLabel, number>> {
  const classifier = await getClipPipeline();
  let tmpPath: string | null = null;
  let imagePath: string;

  if (Buffer.isBuffer(imagePathOrBuffer)) {
    tmpPath = path.join(
      process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads"),
      `vision-tmp-${Date.now()}.jpg`
    );
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    await sharp(imagePathOrBuffer).jpeg().toFile(tmpPath);
    imagePath = tmpPath;
  } else {
    imagePath = imagePathOrBuffer;
  }

  try {
    const candidateLabels = (Object.keys(CLIP_PROMPTS) as VisionLabel[]).flatMap((label) =>
      CLIP_PROMPTS[label].map((text) => ({ label, text }))
    );
    const outputs = await classifier(imagePath, candidateLabels.map((c) => c.text));
    const aggregated: Record<VisionLabel, number> = {
      hanging_wire: 0,
      pothole: 0,
      road_damage: 0,
      debris_obstacle: 0,
      safe_scene: 0,
    };
    for (const row of outputs as Array<{ label: string; score: number }>) {
      const match = candidateLabels.find((c) => c.text === row.label);
      if (match) {
        aggregated[match.label] = Math.max(aggregated[match.label], row.score);
      }
    }
    const textBoost = scoreFromDescription(description);
    for (const [label, boost] of Object.entries(textBoost) as Array<[VisionLabel, number]>) {
      aggregated[label] = Math.min(1, aggregated[label] + boost * 0.25);
    }
    const labels = Object.keys(aggregated) as VisionLabel[];
    const probs = softmax(labels.map((l) => aggregated[l] * 4));
    const out = {} as Record<VisionLabel, number>;
    labels.forEach((l, i) => {
      out[l] = probs[i];
    });
    return out;
  } finally {
    if (tmpPath) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
  }
}

function topResult(
  scores: Record<VisionLabel, number>,
  source: VisionResult["source"],
  cues: string[]
): VisionResult {
  const list: VisionScore[] = (Object.keys(scores) as VisionLabel[]).map((label) => ({
    label,
    confidence: scores[label],
  }));
  list.sort((a, b) => b.confidence - a.confidence);
  const top = list[0];
  return resultFromLabel(top.label, top.confidence, list, source, cues);
}

/**
 * Classify a public-hazard photo with Visual Intelligence.
 * Prefers an on-device client prediction when confident; otherwise runs
 * server heuristic CV or optional CLIP zero-shot classification.
 */
export async function classifyHazardImage(
  imagePathOrBuffer: string | Buffer | null | undefined,
  options: ClassifyOptions = {}
): Promise<VisionResult> {
  const cues: string[] = [];

  if (options.clientPrediction) {
    const { label, confidence, scores } = options.clientPrediction;
    if (confidence >= CONFIDENCE_THRESHOLD && LABEL_META[label]) {
      cues.push("on-device visual intelligence");
      return resultFromLabel(
        label,
        confidence,
        scores ?? [{ label, confidence }],
        "client",
        cues
      );
    }
  }

  if (!imagePathOrBuffer) {
    const textScores = scoreFromDescription(options.description);
    if (Object.keys(textScores).length) {
      const full: Record<VisionLabel, number> = {
        hanging_wire: textScores.hanging_wire ?? 0.05,
        pothole: textScores.pothole ?? 0.05,
        road_damage: textScores.road_damage ?? 0.05,
        debris_obstacle: textScores.debris_obstacle ?? 0.05,
        safe_scene: 0.2,
      };
      cues.push("description text cues");
      return topResult(full, "heuristic", cues);
    }
    return resultFromLabel("safe_scene", 0.35, [{ label: "safe_scene", confidence: 0.35 }], "heuristic", [
      "no image provided",
    ]);
  }

  const backend = preferredBackend(options.backend);
  try {
    if (backend === "clip") {
      cues.push("CLIP zero-shot visual intelligence");
      const scores = await clipScores(imagePathOrBuffer, options.description);
      return topResult(scores, "clip", cues);
    }
  } catch (err) {
    cues.push(`clip unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }

  cues.push("heuristic visual intelligence");
  const features = await extractFeatures(imagePathOrBuffer);
  if (features.skyLikeness > 0.15) cues.push("sky-like colors detected");
  if (features.asphaltLikeness > 0.2) cues.push("asphalt-like texture detected");
  if (features.lowerCenterDarkness > 130) cues.push("dark cavity near lower center");
  if (features.horizontalDarkRuns >= 1) cues.push("horizontal dark runs (wire-like)");
  if (features.horizontalEdgeEnergy > features.verticalEdgeEnergy * 1.1) {
    cues.push("strong horizontal edge energy");
  }
  const scores = heuristicScores(features, options.description);
  return topResult(scores, "heuristic", cues);
}

export function visionLabelFromHazardType(hazardType: HazardType): VisionLabel {
  switch (hazardType) {
    case "wire":
      return "hanging_wire";
    case "pothole":
      return "pothole";
    case "road_issue":
      return "road_damage";
    default:
      return "debris_obstacle";
  }
}

export function isVisionLabel(value: string): value is VisionLabel {
  return value in LABEL_META;
}

export { LABEL_META, CONFIDENCE_THRESHOLD };
