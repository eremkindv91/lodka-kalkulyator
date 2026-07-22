import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PRICING, calculateMatPrice, computePricing } = require("../js/pricing-core.js");

test("calculateMatPrice: контрольные значения из ТЗ", () => {
  assert.equal(calculateMatPrice(0.5), 1592);
  assert.equal(calculateMatPrice(1), 2183);
  assert.equal(calculateMatPrice(1.5), 2775);
  assert.equal(calculateMatPrice(2), 3367);
});

test("calculateMatPrice: некорректный вход → 0", () => {
  assert.equal(calculateMatPrice(0), 0);
  assert.equal(calculateMatPrice(-1), 0);
  assert.equal(calculateMatPrice(NaN), 0);
  assert.equal(calculateMatPrice(Infinity), 0);
});

test("computePricing: площадь 2 м² → 3367 ₽", () => {
  const r = computePricing(PRICING, { areaM2: 2 });
  assert.equal(r.valid, true);
  assert.equal(r.finalPriceRub, 3367);
});

test("computePricing: коэффициент 0.845 вычисляется из ставок", () => {
  const r = computePricing(PRICING, { areaM2: 1 });
  assert.equal(Math.round(r.netCoefficient * 1000) / 1000, 0.845);
  assert.equal(r.deductionRate, 0.155);
  assert.equal(r.finalPriceRub, 2183);
});

test("computePricing: цена = округление до целого рубля (без округления до …90)", () => {
  // 1 м²: 2183.43 -> 2183 (а не 2190)
  assert.equal(computePricing(PRICING, { areaM2: 1 }).finalPriceRub, 2183);
});

test("computePricing: изменение taxRate меняет цену", () => {
  const base = computePricing(PRICING, { areaM2: 2 });
  const higher = computePricing({ ...PRICING, taxRate: 0.18 }, { areaM2: 2 });
  assert.ok(higher.finalPriceRub > base.finalPriceRub);
});

test("computePricing: ошибочные площади → valid:false", () => {
  for (const area of [0, -1, NaN, Infinity]) {
    const r = computePricing(PRICING, { areaM2: area });
    assert.equal(r.valid, false);
    assert.equal(r.finalPriceRub, null);
  }
});

test("computePricing: отсутствие конфига", () => {
  assert.equal(computePricing(null, { areaM2: 2 }).valid, false);
});

test("computePricing: сумма ставок ≥ 1 отклоняется", () => {
  assert.equal(computePricing({ ...PRICING, taxRate: 0.6, advertisingRate: 0.6, acquiringRate: 0 }, { areaM2: 2 }).valid, false);
});

test("PRICING: параметры формулы", () => {
  assert.equal(PRICING.materialCostPerM2Rub, 1000);
  assert.equal(PRICING.hardwareCostRub, 45);
  assert.equal(PRICING.targetProfitRub, 800);
  assert.equal(PRICING.advertisingRate, 0.05);
});

test("в pricing-core нет старого коэффициента 0.795", () => {
  const src = require("node:fs").readFileSync(require.resolve("../js/pricing-core.js"), "utf8");
  assert.ok(!src.includes("0.795"), "старый коэффициент 0.795 не должен встречаться");
});

test("коэффициент реагирует на ставки (не захардкожен)", () => {
  // если бы делили на константу 0.845, изменение acquiringRate не влияло бы на цену
  const a = computePricing(PRICING, { areaM2: 2 }).finalPriceRub;
  const b = computePricing({ ...PRICING, acquiringRate: 0.10 }, { areaM2: 2 }).finalPriceRub;
  assert.notEqual(a, b);
});
