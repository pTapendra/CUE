import { AccountRepository } from "./accounts/AccountRepository.js";
import { AccountService } from "./accounts/AccountService.js";
import { createApp } from "./api/app.js";
import { HttpCanvasLogin } from "./canvas/HttpCanvasLogin.js";
import { HttpCanvasClient } from "./canvas/HttpCanvasClient.js";
import { CanvasReaderRepository } from "./canvasReader/CanvasReaderRepository.js";
import { CanvasReaderService } from "./canvasReader/CanvasReaderService.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";
import { PLANNER_DEFAULTS } from "./planner/config.js";
import { PlannerRepository } from "./planner/PlannerRepository.js";
import { PlannerService } from "./planner/PlannerService.js";
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
const planner = new PlannerService(new PlannerRepository(db), schedule);
schedule.onChange((id) => planner.replan(id));
const accounts = new AccountService(new AccountRepository(db), config.secretKey);
const canvasReader = new CanvasReaderService(
  new CanvasReaderRepository(db),
  schedule,
  (baseUrl, token) => new HttpCanvasClient(baseUrl, token),
  {
    secretKey: config.secretKey,
    accounts,
    allowInsecureUrls: process.env.CUE_ALLOW_INSECURE_CANVAS === "1",
    login: config.canvasLogin ? new HttpCanvasLogin(config.canvasLogin) : null,
  },
);

const app = createApp({ accounts, canvasReader, schedule, planner });

app.listen(config.port, () => {
  console.log(`Cue server listening on http://localhost:${config.port}`);
});
