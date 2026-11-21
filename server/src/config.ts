import { randomBytes } from "node:crypto";
import type { CanvasLoginSettings } from "./canvas/CanvasLogin.js";

export interface Config {
  port: number;
  databaseFile: string;
  /** 32-byte key used to encrypt Canvas tokens at rest. */
  secretKey: Buffer;
  /** Set when the three CUE_CANVAS_* variables are; null turns login off. */
  canvasLogin: CanvasLoginSettings | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  let secretKey: Buffer;
  if (env.CUE_SECRET_KEY) {
    secretKey = Buffer.from(env.CUE_SECRET_KEY, "base64");
    if (secretKey.length !== 32) {
      throw new Error("CUE_SECRET_KEY must be 32 bytes, base64-encoded");
    }
  } else {
    // Development only: a random key means stored Canvas tokens become
    // unreadable after a restart, and students must reconnect.
    console.warn("CUE_SECRET_KEY is not set; using a temporary key for this run.");
    secretKey = randomBytes(32);
  }

  return {
    canvasLogin: loadLoginSettings(env),
    port: Number(env.PORT ?? 3000),
    databaseFile: env.CUE_DB_FILE ?? "cue.db",
    secretKey,
  };
}

const LOGIN_VARIABLES = ["CUE_CANVAS_URL", "CUE_CANVAS_CLIENT_ID", "CUE_CANVAS_CLIENT_SECRET"] as const;

function loadLoginSettings(env: NodeJS.ProcessEnv): CanvasLoginSettings | null {
  const missing = LOGIN_VARIABLES.filter((name) => !env[name]);
  if (missing.length === LOGIN_VARIABLES.length) return null;
  if (missing.length > 0) {
    throw new Error(`Canvas login needs all of ${LOGIN_VARIABLES.join(", ")}; missing ${missing.join(", ")}`);
  }
  return {
    canvasUrl: env.CUE_CANVAS_URL!.trim().replace(/\/+$/, ""),
    clientId: env.CUE_CANVAS_CLIENT_ID!,
    clientSecret: env.CUE_CANVAS_CLIENT_SECRET!,
  };
}
