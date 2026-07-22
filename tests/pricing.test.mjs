import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PRICING, roundPriceUpTo90, computePricing } = require("../js/pricing-core.js");

test("roundPriceUpTo90: округление до …90", () => {
  assert.equal(roundPriceUpTo90(4621), 4690);
  assert.equal(roundPriceUpTo90(5104), 5190);
  assert.equal(roundPriceUpTo90(6438), 6490);
  assert.equal(roundPriceUpTo90(7812), 7890);
  assert.equal(roundPriceUpTo90(4690), 4690); // уже корректное не меняется
  assert.equal(roundPriceUpTo90(4691), 4790);
});

test("roundPriceUpTo90: отклоняет некорректный вход", () => {
  assert.throws(() => roundPriceUpTo90(0));
  assert.throws(() => roundPriceUpTo90(-5));
  assert.throws(() => roundPriceUpTo90(NaN));
  assert.throws(() => roundPriceUpTo90(Infinity));
});

test("computePricing: площадь 2 м² → 4090 ₽", () => {
  const r = computePricing(PRICING, { areaM2: 2 });
  assert.equal(r.valid, true);
  assert.equal(r.costRub, 2045);
  assert.equal(r.finalPriceRub, 4090);
});

test("computePricing: площадь 3 м² → 5390 ₽", () => {
  const r = computePricing(PRICING, { areaM2: 3 });
  assert.equal(r.costRub, 3045);
  assert.equal(r.finalPriceRub, 5390);
});

test("computePricing: площадь 4,5 м² → 7290 ₽", () => {
  const r = computePricing(PRICING, { areaM2: 4.5 });
  assert.equal(r.costRub, 4545);
  assert.equal(r.finalPriceRub, 7290);
});

test("computePricing: netCoefficient вычисляется из ставок (0.795)", () => {
  const r = computePricing(PRICING, { areaM2: 2 });
  assert.equal(Math.round(r.netCoefficient * 1000) / 1000, 0.795);
  assert.equal(r.deductionRate, 0.205);
});

test("computePricing: изменение taxRate меняет цену", () => {
  const base = computePricing(PRICING, { areaM2: 2 });
  const higher = computePricing({ ...PRICING, taxRate: 0.18 }, { areaM2: 2 });
  assert.notEqual(base.finalPriceRub, higher.finalPriceRub);
  assert.ok(higher.finalPriceRub > base.finalPriceRub);
});

test("computePricing: ошибочные площади", () => {
  for (const area of [0, -1, NaN, Infinity]) {
    const r = computePricing(PRICING, { areaM2: area });
    assert.equal(r.valid, false);
    assert.equal(r.finalPriceRub, null);
  }
});

test("computePricing: отсутствие конфига", () => {
  const r = computePricing(null, { areaM2: 2 });
  assert.equal(r.valid, false);
});

test("computePricing: сумма ставок = 1 и > 1 отклоняются", () => {
  const eq = computePricing({ ...PRICING, taxRate: 0.5, advertisingRate: 0.5, acquiringRate: 0 }, { areaM2: 2 });
  assert.equal(eq.valid, false);
  const gt = computePricing({ ...PRICING, taxRate: 0.6, advertisingRate: 0.6, acquiringRate: 0 }, { areaM2: 2 });
  assert.equal(gt.valid, false);
});

test("computePricing: delivery min > max отклоняется", () => {
  const r = computePricing({ ...PRICING, deliveryMinRub: 2000, deliveryMaxRub: 1000 }, { areaM2: 2 });
  assert.equal(r.valid, false);
});

test("в исходнике pricing-core нет захардкоженного 0.795", () => {
  const src = require("node:fs").readFileSync(require.resolve("../js/pricing-core.js"), "utf8");
  assert.ok(!src.includes("0.795"), "0.795 не должен быть в формуле");
});
