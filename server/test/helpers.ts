import { randomBytes } from "node:crypto";
import request from "supertest";
import { AccountRepository } from "../src/accounts/AccountRepository.js";
import { createApp } from "../src/api/app.js";
import { FakeCanvasClient } from "../src/canvas/FakeCanvasClient.js";
import { CanvasReaderRepository } from "../src/canvasReader/CanvasReaderRepository.js";
import { CanvasReaderService } from "../src/canvasReader/CanvasReaderService.js";
import { openDb } from "../src/db.js";
import { PLANNER_DEFAULTS } from "../src/planner/config.js";
import { PlannerRepository } from "../src/planner/PlannerRepository.js";
import { PlannerService } from "../src/planner/PlannerService.js";
import { ScheduleRepository } from "../src/schedule/ScheduleRepository.js";
import { ScheduleService } from "../src/schedule/ScheduleService.js";

export const NOW = new Date("2026-11-02T15:00:00.000Z");

export function fakeCanvas() {
  return new FakeCanvasClient({
    courses: [
      { id: "101", name: "Software Engineering", courseCode: "CS 4350" },
      { id: "102", name: "Databases", courseCode: "CS 4420" },
    ],
    assignments: [
      { id: "1", courseId: "101", name: "P2 Architecture", dueAt: "2026-11-05T05:59:00Z", isQuiz: false },
      { id: "2", courseId: "101", name: "Midterm Exam", dueAt: null, isQuiz: false },
      { id: "3", courseId: "102", name: "SQL homework", dueAt: "2026-11-03T22:00:00Z", isQuiz: false },
      { id: "4", courseId: "102", name: "Old homework", dueAt: "2026-09-01T22:00:00Z", isQuiz: false },
      { id: "5", courseId: "102", name: "Reading notes", dueAt: null, isQuiz: false },
    ],
    events: [{ id: "900", courseId: "102", title: "Final exam (Room 210)", startAt: "2026-12-10T15:00:00Z", endAt: "2026-12-10T17:00:00Z", allDay: false }],
  });
}

export function setup() {
  const db = openDb(":memory:");
  const canvas = fakeCanvas();
  const tokensSeen: string[] = [];
  const schedule = new ScheduleService(new ScheduleRepository(db), {
    defaultStudyMinutes: PLANNER_DEFAULTS.studyMinutes,
    blockMinutes: PLANNER_DEFAULTS.blockMinutes,
    now: () => NOW,
  });
  const planner = new PlannerService(new PlannerRepository(db), schedule, { now: () => NOW });
  schedule.onChange((id) => planner.replan(id));
  const canvasReader = new CanvasReaderService(
    new CanvasReaderRepository(db),
    schedule,
    (_url, token) => {
      tokensSeen.push(token);
      return canvas;
    },
    { secretKey: randomBytes(32), now: () => NOW },
  );
  const app = createApp({ accounts: new AccountRepository(db), canvasReader, schedule, planner });

  async function newStudent() {
    const res = await request(app).post("/api/devices").expect(201);
    const auth = { Authorization: `Bearer ${res.body.deviceToken}` };
    return {
      get: (path: string) => request(app).get(path).set(auth),
      post: (path: string, body?: object) => request(app).post(path).set(auth).send(body ?? {}),
      put: (path: string, body: object) => request(app).put(path).set(auth).send(body),
      patch: (path: string, body: object) => request(app).patch(path).set(auth).send(body),
      del: (path: string) => request(app).delete(path).set(auth),
    };
  }

  return { app, db, canvas, tokensSeen, newStudent };
}

export const CANVAS = { baseUrl: "https://school.instructure.com/", token: "canvas-token-1234567890" };
