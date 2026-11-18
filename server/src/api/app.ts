import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AccountRepository } from "../accounts/AccountRepository.js";
import { CanvasAuthError, CanvasUnavailableError } from "../canvas/CanvasClient.js";
import {
  CanvasNotConnectedError,
  InvalidCanvasUrlError,
  SyncExpiredError,
  type CanvasReaderService,
} from "../canvasReader/CanvasReaderService.js";
import { isValidTimeZone } from "../planner/time.js";
import type { PlannerService } from "../planner/PlannerService.js";
import { BlockMoveError, InvalidItemError, NotFoundError, type ScheduleService } from "../schedule/ScheduleService.js";

export interface Services {
  accounts: AccountRepository;
  canvasReader: CanvasReaderService;
  schedule: ScheduleService;
  planner: PlannerService;
}

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO date");
const studyMinutes = z.number().int().min(0).max(2400).multipleOf(60);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

function rangeMinutes(start: string, end: string): number {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const diff = m(end) - m(start);
  return diff <= 0 ? diff + 1440 : diff;
}

const studyWindow = z
  .object({ weekday: z.number().int().min(0).max(6), enabled: z.boolean(), start: clock, end: clock })
  .refine((w) => w.end !== w.start, { message: "end must differ from start" })
  .refine((w) => w.end === w.start || (rangeMinutes(w.start, w.end) >= 60 && rangeMinutes(w.start, w.end) <= 720), {
    message: "a study range must be 1 to 12 hours long",
  });

const kind = z.enum(["assignment", "exam", "event"]);

const schemas = {
  connect: z.object({ baseUrl: z.string().min(1).max(200), token: z.string().min(10).max(500) }),
  confirm: z.object({
    syncId: z.string().uuid(),
    accept: z.array(z.string().max(100)).max(2000),
    dates: z.record(z.string(), isoDate).optional(),
  }),
  week: z.object({ from: isoDate, days: z.coerce.number().int().min(1).max(14).default(7) }),
  settings: z.object({
    timeZone: z.string().refine(isValidTimeZone, "must be an IANA time zone"),
    dailyLimitMinutes: z.number().int().min(60).max(720).multipleOf(60),
    windows: z
      .array(studyWindow)
      .length(7)
      .refine((ws) => new Set(ws.map((w) => w.weekday)).size === 7, "each weekday must appear exactly once"),
  }),
  range: z.object({ from: isoDate, to: isoDate }),
  move: z.object({ startsAt: isoDate }),
  course: z.object({ name: z.string().trim().min(1).max(120), code: z.string().trim().max(40).nullable().optional() }),
  newItem: z.object({
    title: z.string().trim().min(1).max(200),
    kind,
    dueAt: isoDate.nullable(),
    courseId: z.string().uuid().nullable().optional(),
    endsAt: isoDate.nullable().optional(),
    studyMinutes: studyMinutes.optional(),
  }),
  editItem: z
    .object({
      title: z.string().trim().min(1).max(200),
      kind,
      dueAt: isoDate.nullable(),
      courseId: z.string().uuid().nullable(),
      endsAt: isoDate.nullable(),
      studyMinutes,
    })
    .partial(),
  status: z.object({ status: z.enum(["not_started", "in_progress", "done", "postponed"]) }),
};

type Authed = Request & { studentId: string };

export function createApp(s: Services) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "200kb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Creates an anonymous account for a newly installed app. No name or email.
  app.post("/api/devices", (_req, res) => {
    const { deviceToken } = s.accounts.create();
    res.status(201).json({ deviceToken });
  });

  const api = express.Router();
  api.use((req, res, next) => {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const studentId = token ? s.accounts.findByToken(token) : null;
    if (!studentId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    (req as Authed).studentId = studentId;
    next();
  });

  const sid = (req: Request) => (req as Authed).studentId;

  api.delete("/account", (req, res) => {
    s.accounts.delete(sid(req));
    res.status(204).end();
  });

  // --- Canvas Reader (UC1) ---
  api.get("/canvas/connection", (req, res) => {
    res.json(s.canvasReader.status(sid(req)));
  });

  api.put("/canvas/connection", async (req, res) => {
    const body = schemas.connect.parse(req.body);
    await s.canvasReader.connect(sid(req), body.baseUrl, body.token);
    res.json(s.canvasReader.status(sid(req)));
  });

  api.delete("/canvas/connection", (req, res) => {
    s.canvasReader.disconnect(sid(req));
    res.status(204).end();
  });

  api.post("/canvas/sync", async (req, res) => {
    res.json(await s.canvasReader.preview(sid(req)));
  });

  api.post("/canvas/sync/confirm", (req, res) => {
    const body = schemas.confirm.parse(req.body);
    const imported = s.canvasReader.confirm(sid(req), body.syncId, body.accept, body.dates);
    res.json({ imported });
  });

  // --- Schedule Manager (UC2) ---
  api.get("/courses", (req, res) => {
    res.json({ courses: s.schedule.listCourses(sid(req)) });
  });

  api.post("/courses", (req, res) => {
    const body = schemas.course.parse(req.body);
    res.status(201).json(s.schedule.addCourse(sid(req), body.name, body.code ?? null));
  });

  api.get("/schedule/week", (req, res) => {
    const { from, days } = schemas.week.parse(req.query);
    s.planner.replanIfNewDay(sid(req));
    res.json({ ...s.schedule.getWeek(sid(req), new Date(from), days), shortfalls: s.planner.shortfalls(sid(req)) });
  });

  // --- Planner (UC2) ---
  api.get("/planner/settings", (req, res) => {
    res.json(s.planner.getSettings(sid(req)));
  });

  api.put("/planner/settings", (req, res) => {
    s.planner.saveSettings(sid(req), schemas.settings.parse(req.body));
    res.json(s.planner.getSettings(sid(req)));
  });

  api.post("/blocks/accept", (req, res) => {
    const { from, to } = schemas.range.parse(req.body);
    res.json({ accepted: s.schedule.acceptBlocks(sid(req), new Date(from), new Date(to)) });
  });

  api.post("/blocks/:id/accept", (req, res) => {
    s.schedule.acceptBlock(sid(req), String(req.params.id));
    res.status(204).end();
  });

  api.post("/blocks/:id/reject", (req, res) => {
    s.schedule.rejectBlock(sid(req), String(req.params.id));
    res.status(204).end();
  });

  api.post("/blocks/:id/move", (req, res) => {
    const { startsAt } = schemas.move.parse(req.body);
    s.schedule.moveBlock(sid(req), String(req.params.id), startsAt);
    res.status(204).end();
  });

  api.post("/items", (req, res) => {
    const body = schemas.newItem.parse(req.body);
    res.status(201).json(s.schedule.addItem(sid(req), { ...body, courseId: body.courseId ?? null }));
  });

  api.patch("/items/:id", (req, res) => {
    const body = schemas.editItem.parse(req.body);
    res.json(s.schedule.updateItem(sid(req), String(req.params.id), body));
  });

  api.put("/items/:id/status", (req, res) => {
    const { status } = schemas.status.parse(req.body);
    res.json(s.schedule.setStatus(sid(req), String(req.params.id), status));
  });

  api.delete("/items/:id", (req, res) => {
    s.schedule.deleteItem(sid(req), String(req.params.id));
    res.status(204).end();
  });

  app.use("/api", api);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const [status, error, message] = describe(err);
    if (status >= 500) console.error(err);
    res.status(status).json({ error, message });
  });

  return app;
}

function describe(err: unknown): [number, string, string] {
  if (err instanceof z.ZodError) return [400, "invalid_request", err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")];
  if (err instanceof SyntaxError) return [400, "invalid_json", "Request body is not valid JSON"];
  if (err instanceof InvalidItemError) return [400, "invalid_request", err.message];
  if (err instanceof NotFoundError) return [404, "not_found", err.message];
  if (err instanceof BlockMoveError) return [409, "block_move_invalid", err.message];
  if (err instanceof InvalidCanvasUrlError) return [400, "invalid_canvas_url", err.message];
  if (err instanceof CanvasNotConnectedError) return [409, "canvas_not_connected", err.message];
  if (err instanceof CanvasAuthError) return [409, "canvas_token_rejected", "Canvas rejected the token. Please reconnect."];
  if (err instanceof SyncExpiredError) return [409, "sync_expired", err.message];
  if (err instanceof CanvasUnavailableError) return [502, "canvas_unavailable", err.message];
  return [500, "server_error", "Something went wrong"];
}
