import { isAbsolute, resolve } from "node:path";
import { DEFAULT_STATE_TTL_MS } from "./state.mjs";

const INT64_RE = /^-?\d{1,19}$/;

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Не задана переменная окружения ${name}`);
  return value;
}

function integer(env, name, fallback, { min, max }) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} должна быть целым числом`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} должна быть в диапазоне ${min}–${max}`);
  }
  return value;
}

function boolean(env, name, fallback = false) {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} должна быть true или false`);
}

function allowedOrigin(env) {
  const raw = required(env, "ALLOWED_ORIGIN");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("ALLOWED_ORIGIN должна быть полным HTTP(S)-origin");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("ALLOWED_ORIGIN должна быть полным HTTP(S)-origin");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("ALLOWED_ORIGIN не должна содержать путь, query или fragment");
  }
  return url.origin;
}

function recipient(env) {
  const userId = env.MAX_USER_ID?.trim();
  const chatId = env.MAX_CHAT_ID?.trim();
  if (Boolean(userId) === Boolean(chatId)) {
    throw new Error("Задайте ровно одну переменную: MAX_USER_ID или MAX_CHAT_ID");
  }
  const value = userId || chatId;
  if (!INT64_RE.test(value)) {
    throw new Error(`${userId ? "MAX_USER_ID" : "MAX_CHAT_ID"} должна содержать int64 ID из MAX`);
  }
  return { type: userId ? "user_id" : "chat_id", value };
}

function normalizePem(raw) {
  const trimmed = raw.trim();
  const pem = trimmed.includes("\\n") && !trimmed.includes("\n")
    ? trimmed.replaceAll("\\n", "\n")
    : trimmed;
  if (!pem.includes("-----BEGIN CERTIFICATE-----") || !pem.includes("-----END CERTIFICATE-----")) {
    throw new Error("MAX_CA_PEM должна содержать PEM-сертификат Минцифры");
  }
  return `${pem}\n`;
}

export function loadConfig(env = process.env) {
  const stateFileRaw = env.STATE_FILE?.trim();
  return Object.freeze({
    host: env.HOST?.trim() || "0.0.0.0",
    port: integer(env, "PORT", 8787, { min: 1, max: 65535 }),
    allowedOrigin: allowedOrigin(env),
    telegramToken: required(env, "TELEGRAM_BOT_TOKEN"),
    telegramChatId: required(env, "TELEGRAM_CHAT_ID"),
    maxToken: required(env, "MAX_BOT_TOKEN"),
    maxRecipient: recipient(env),
    maxCaPem: normalizePem(required(env, "MAX_CA_PEM")),
    upstreamTimeoutMs: integer(env, "UPSTREAM_TIMEOUT_MS", 8_000, { min: 1_000, max: 30_000 }),
    rateLimitMax: integer(env, "RATE_LIMIT_MAX", 20, { min: 1, max: 10_000 }),
    rateLimitWindowMs: integer(env, "RATE_LIMIT_WINDOW_MS", 60_000, { min: 1_000, max: 3_600_000 }),
    stateMaxEntries: integer(env, "STATE_MAX_ENTRIES", 10_000, { min: 100, max: 1_000_000 }),
    stateTtlMs: integer(env, "STATE_TTL_MS", DEFAULT_STATE_TTL_MS, {
      min: 60_000,
      max: 365 * 24 * 60 * 60 * 1_000,
    }),
    stateFile: stateFileRaw ? (isAbsolute(stateFileRaw) ? stateFileRaw : resolve(stateFileRaw)) : null,
    trustProxy: boolean(env, "TRUST_PROXY", false),
  });
}
