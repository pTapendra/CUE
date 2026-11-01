import { randomBytes } from "node:crypto";

export interface Config {
  port: number;
  databaseFile: string;
  /** 32-byte key used to encrypt Canvas tokens at rest. */
  secretKey: Buffer;
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
    port: Number(env.PORT ?? 3000),
    databaseFile: env.CUE_DB_FILE ?? "cue.db",
    secretKey,
  };
}
