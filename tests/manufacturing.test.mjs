import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MANUFACTURING_CONFIG, computeParts } = require("../js/manufacturing-core.js");

test("computeParts: границы 210 см", () => {
  assert.equal(computeParts(200).partCount, 1);
  assert.equal(computeParts(210).partCount, 1);
  assert.equal(computeParts(210.1).partCount, 2);
  assert.equal(computeParts(217).partCount, 2);
  assert.equal(computeParts(420).partCount, 2);
  assert.equal(computeParts(420.1).partCount, 3);
});

test("computeParts: до 420 см поддерживается автоматически", () => {
  assert.equal(computeParts(217).supported, true);
  assert.equal(computeParts(420).supported, true);
});

test("computeParts: свыше 420 см требует ручного согласования", () => {
  const r = computeParts(420.1);
  assert.equal(r.supported, false);
  assert.equal(r.partCount, 3);
});

test("computeParts: одна часть не требует подтверждения соединения", () => {
  assert.equal(computeParts(200).requiresManagerSplitConfirmation, false);
  assert.equal(computeParts(217).requiresManagerSplitConfirmation, true);
});

test("computeParts: некорректная длина", () => {
  for (const l of [0, -1, NaN, Infinity]) {
    assert.equal(computeParts(l).valid, false);
  }
});

test("MANUFACTURING_CONFIG: значения по умолчанию", () => {
  assert.equal(MANUFACTURING_CONFIG.maxSinglePartLengthCm, 210);
  assert.equal(MANUFACTURING_CONFIG.maxAutoSupportedParts, 2);
});
