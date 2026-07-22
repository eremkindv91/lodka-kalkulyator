/*
 * Ядро расчёта стоимости EVA-коврика. Чистые функции, без DOM.
 * Работает и в браузере (window.PricingCore), и в Node (module.exports) — для тестов.
 *
 * Формула:
 *   cost = area(м²) × materialCostPerM2Rub + hardwareCostRub
 *   deductionRate = taxRate + advertisingRate + acquiringRate
 *   netCoefficient = 1 − deductionRate
 *   rawPrice = (cost + targetProfitRub) / netCoefficient
 *   finalPrice = округление вверх до значения, оканчивающегося на 90
 */
(function (root) {
  "use strict";

  // ЕДИНСТВЕННЫЙ источник числовых параметров. Не дублировать эти числа в другом коде.
  var PRICING = {
    version: "v2-2026-07",
    currency: "RUB",
    pricingMode: "polygon-area",

    materialCostPerM2Rub: 1000,
    hardwareCostRub: 45,
    targetProfitRub: 1200,

    taxRate: 0.08,
    advertisingRate: 0.10,
    acquiringRate: 0.025,

    deliveryMinRub: 800,
    deliveryMaxRub: 1000
  };

  /** Округление цены вверх до ближайшего числа, оканчивающегося на 90 (целые рубли). */
  function roundPriceUpTo90(value) {
    if (typeof value !== "number" || !isFinite(value) || value <= 0) {
      throw new Error("roundPriceUpTo90: ожидается положительное конечное число");
    }
    // эпсилон гасит ошибку плавающей точки, чтобы уже корректное X..90 не подскочило на сотню
    var steps = Math.ceil((value - 90) / 100 - 1e-9);
    if (steps < 0) steps = 0;
    return steps * 100 + 90;
  }

  function isRate(x) {
    return typeof x === "number" && isFinite(x) && x >= 0 && x < 1;
  }
  function isMoney(x) {
    return typeof x === "number" && isFinite(x) && x >= 0;
  }

  /**
   * Расчёт цены по площади производственного полигона (geo.areaM2 — источник истины).
   * Возвращает { valid, error, ...breakdown, finalPriceRub }.
   */
  function computePricing(cfg, geo) {
    var fail = function (msg) {
      return { valid: false, error: msg, finalPriceRub: null };
    };

    if (!cfg) return fail("Не задана конфигурация тарифа");
    if (cfg.currency !== "RUB") return fail("Поддерживается только валюта RUB");
    if (!geo || typeof geo.areaM2 !== "number" || !isFinite(geo.areaM2) || geo.areaM2 <= 0) {
      return fail("Некорректная площадь");
    }
    if (!isMoney(cfg.materialCostPerM2Rub) || !isMoney(cfg.hardwareCostRub) || !isMoney(cfg.targetProfitRub)) {
      return fail("Некорректные денежные параметры тарифа");
    }
    if (!isRate(cfg.taxRate) || !isRate(cfg.advertisingRate) || !isRate(cfg.acquiringRate)) {
      return fail("Ставки удержаний должны быть в диапазоне [0, 1)");
    }
    if (!isMoney(cfg.deliveryMinRub) || !isMoney(cfg.deliveryMaxRub) || cfg.deliveryMinRub > cfg.deliveryMaxRub) {
      return fail("Некорректные параметры доставки");
    }

    var deductionRate = cfg.taxRate + cfg.advertisingRate + cfg.acquiringRate;
    var netCoefficient = 1 - deductionRate;
    if (netCoefficient <= 0) return fail("Сумма удержаний должна быть меньше 1");

    var areaM2 = geo.areaM2;
    var materialCostRub = areaM2 * cfg.materialCostPerM2Rub;
    var costRub = materialCostRub + cfg.hardwareCostRub;
    if (costRub < 0) return fail("Отрицательная себестоимость");

    var rawPriceRub = (costRub + cfg.targetProfitRub) / netCoefficient;
    if (!isFinite(rawPriceRub) || rawPriceRub <= 0) return fail("Некорректная расчётная цена");

    var finalPriceRub = roundPriceUpTo90(rawPriceRub);

    return {
      valid: true,
      error: null,
      pricingVersion: cfg.version,
      currency: cfg.currency,
      areaM2: areaM2,
      materialCostRub: materialCostRub,
      hardwareCostRub: cfg.hardwareCostRub,
      costRub: costRub,
      targetProfitRub: cfg.targetProfitRub,
      taxRate: cfg.taxRate,
      advertisingRate: cfg.advertisingRate,
      acquiringRate: cfg.acquiringRate,
      deductionRate: deductionRate,
      netCoefficient: netCoefficient,
      rawPriceRub: rawPriceRub,
      finalPriceRub: finalPriceRub,
      deliveryMinRub: cfg.deliveryMinRub,
      deliveryMaxRub: cfg.deliveryMaxRub
    };
  }

  var api = { PRICING: PRICING, roundPriceUpTo90: roundPriceUpTo90, computePricing: computePricing };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PricingCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
