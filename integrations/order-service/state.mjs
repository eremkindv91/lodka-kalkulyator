import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const STATE_VERSION = 1;
export const DEFAULT_STATE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

function validChannel(value) {
  return value && typeof value === "object" && typeof value.delivered === "boolean"
    && Number.isSafeInteger(value.attempts) && value.attempts >= 0;
}

function validRecord(value) {
  return value && typeof value === "object"
    && typeof value.key === "string"
    && typeof value.fingerprint === "string"
    && typeof value.orderNumber === "string"
    && validChannel(value.channels?.telegram)
    && validChannel(value.channels?.max)
    && typeof value.createdAt === "string"
    && Number.isFinite(Date.parse(value.createdAt))
    && typeof value.updatedAt === "string"
    && Number.isFinite(Date.parse(value.updatedAt));
}

export class StateCapacityError extends Error {
  constructor() {
    super("state-capacity-reached");
    this.name = "StateCapacityError";
  }
}

export class OrderStateStore {
  constructor({
    file = null,
    maxEntries = 10_000,
    ttlMs = DEFAULT_STATE_TTL_MS,
    now = Date.now,
  } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error("maxEntries должна быть положительным целым числом");
    }
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) {
      throw new Error("ttlMs должна быть положительным целым числом");
    }
    if (typeof now !== "function") throw new Error("now должна быть функцией");
    this.file = file;
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.now = now;
    this.records = new Map();
    this.writeQueue = Promise.resolve();
    if (file) this.#load(file);
  }

  #now() {
    const value = this.now();
    if (!Number.isFinite(value)) throw new Error("now должна возвращать timestamp");
    return value;
  }

  #expired(record, now) {
    return now - Date.parse(record.updatedAt) >= this.ttlMs;
  }

  #deleteExpired(now = this.#now()) {
    for (const [key, record] of this.records) {
      if (this.#expired(record, now)) this.records.delete(key);
    }
  }

  #load(file) {
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STATE_VERSION || !Array.isArray(parsed.records)) {
      throw new Error("Некорректный формат STATE_FILE");
    }
    if (parsed.records.some((record) => !validRecord(record))) {
      throw new Error("Некорректные записи в STATE_FILE");
    }
    const now = this.#now();
    for (const record of parsed.records) {
      if (!this.#expired(record, now)) this.records.set(record.key, record);
    }
    if (this.records.size > this.maxEntries) {
      throw new Error("STATE_FILE содержит слишком много действующих записей");
    }
  }

  get(key) {
    this.#deleteExpired();
    return this.records.get(key) || null;
  }

  create({ key, fingerprint, orderNumber }) {
    this.#deleteExpired();
    if (this.records.size >= this.maxEntries) throw new StateCapacityError();
    const now = new Date(this.#now()).toISOString();
    const record = {
      key,
      fingerprint,
      orderNumber,
      channels: {
        telegram: { delivered: false, attempts: 0, deliveredAt: null },
        max: { delivered: false, attempts: 0, deliveredAt: null },
      },
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    this.records.set(key, record);
    return record;
  }

  async persist() {
    if (!this.file) return;
    const snapshot = JSON.stringify({ version: STATE_VERSION, records: [...this.records.values()] });
    const operation = async () => {
      const directory = dirname(this.file);
      const temporary = join(
        directory,
        `.${basename(this.file)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
      );
      await mkdir(directory, { recursive: true });
      try {
        await writeFile(temporary, snapshot, { encoding: "utf8", mode: 0o600, flag: "wx" });
        await rename(temporary, this.file);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
    };
    this.writeQueue = this.writeQueue.then(operation, operation);
    await this.writeQueue;
  }
}
