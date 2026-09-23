import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { migrate } from "./db";
import { seedAuthorities } from "./data/authorities";
import {
  authoritiesRouter,
  reportsRouter,
  routingRouter,
  visionRouter,
} from "./routes/reports";

migrate();
seedAuthorities();

const app = express();
const port = Number(process.env.PORT || 3000);
const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadDir));
app.use("/demo", express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "hazard-reporter" });
});

app.get("/", (_req, res) => {
  res.redirect("/demo/");
});

app.use("/api/reports", reportsRouter);
app.use("/api/vision", visionRouter);
app.use("/api/routing", routingRouter);
app.use("/api/authorities", authoritiesRouter);

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    res.status(400).json({ error: err.message || "Request failed" });
  }
);

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Hazard Reporter API listening on http://localhost:${port}`);
    console.log(`Demo UI: http://localhost:${port}/demo/`);
  });
}

export default app;
