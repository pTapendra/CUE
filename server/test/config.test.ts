import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const KEY = Buffer.alloc(32, 1).toString("base64");

describe("login settings", () => {
  it("no CUE_CANVAS_* settings: login is off", () => {
    expect(loadConfig({ CUE_SECRET_KEY: KEY }).canvasLogin).toBeNull();
  });

  it("all three: login settings, trailing slash removed", () => {
    const config = loadConfig({
      CUE_SECRET_KEY: KEY,
      CUE_CANVAS_URL: "https://canvas.example.ngrok-free.dev/",
      CUE_CANVAS_CLIENT_ID: "10000000000001",
      CUE_CANVAS_CLIENT_SECRET: "s3cret/+=&",
    });
    expect(config.canvasLogin).toEqual({
      canvasUrl: "https://canvas.example.ngrok-free.dev",
      clientId: "10000000000001",
      clientSecret: "s3cret/+=&",
    });
  });

  it("some but not all: refuses to start and names what is missing", () => {
    expect(() =>
      loadConfig({ CUE_SECRET_KEY: KEY, CUE_CANVAS_URL: "https://canvas.example", CUE_CANVAS_CLIENT_ID: "1" }),
    ).toThrow(/CUE_CANVAS_CLIENT_SECRET/);
  });
});
