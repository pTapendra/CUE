import { AccountRepository } from "./accounts/AccountRepository.js";
import { createApp } from "./api/app.js";
import { HttpCanvasClient } from "./canvas/HttpCanvasClient.js";
import { CanvasReaderRepository } from "./canvasReader/CanvasReaderRepository.js";
import { CanvasReaderService } from "./canvasReader/CanvasReaderService.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { PLANNER_DEFAULTS } from "./planner/config.js";
import { ScheduleRepository } from "./schedule/ScheduleRepository.js";
import { ScheduleService } from "./schedule/ScheduleService.js";

// Load server/.env when it exists (Node 22+). Real environment variables win.
try {
  process.loadEnvFile();
} catch {
  // no .env file: use the environment as it is
}

const config = loadConfig();
const db = openDb(config.databaseFile);

const schedule = new ScheduleService(new ScheduleRepository(db), {
  defaultStudyMinutes: PLANNER_DEFAULTS.studyMinutes,
  blockMinutes: PLANNER_DEFAULTS.blockMinutes,
});
const canvasReader = new CanvasReaderService(
  new CanvasReaderRepository(db),
  schedule,
  (baseUrl, token) => new HttpCanvasClient(baseUrl, token),
  { secretKey: config.secretKey, allowInsecureUrls: process.env.CUE_ALLOW_INSECURE_CANVAS === "1" },
);

const app = createApp({ accounts: new AccountRepository(db), canvasReader, schedule });

app.listen(config.port, () => {
  console.log(`Cue server listening on http://localhost:${config.port}`);
});
