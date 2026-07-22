/*
 * Ядро расчёта стоимости EVA-коврика. Чистые функции, без DOM.
 * Работает и в браузере (window.PricingCore), и в Node (module.exports) — для тестов.
 *
 * Формула (единственная, без наценок/минималок/округления до сотен/доставки в цене):
 *   base = area(м²) × 1000 + 45 (фурнитура) + 800 (чистая прибыль)
 *   netCoefficient = 1 − (0.08 налог + 0.05 реклама + 0.025 эквайринг) = 0.845
 *   price = round(base / netCoefficient)   // Math.round до целого рубля
 */
(function (root) {
  "use strict";

  // ЕДИНСТВЕННЫЙ источник числовых параметров. Не дублировать эти числа в другом коде.
  var PRICING = {
    version: "v3-2026-07",
    currency: "RUB",
    pricingMode: "polygon-area",

    materialCostPerM2Rub: 1000,
    hardwareCostRub: 45,
    targetProfitRub: 800,

    taxRate: 0.08,
    advertisingRate: 0.05,
    acquiringRate: 0.025,

    // Ориентир по доставке (в цену НЕ входит, только информационная подпись).
    deliveryMinRub: 800,
    deliveryMaxRub: 1000
  };

  /**
   * Чистая функция цены по площади (м²). Возвращает целые рубли или 0 при некорректном входе.
   * price = round( (area×1000 + 45 + 800) / 0.845 )
   */
  function calculateMatPrice(areaM2, cfg) {
    cfg = cfg || PRICING;
    if (!Number.isFinite(areaM2) || areaM2 <= 0) return 0;
    var totalRate = cfg.taxRate + cfg.advertisingRate + cfg.acquiringRate;
    var netRevenueCoefficient = 1 - totalRate;
    if (!(netRevenueCoefficient > 0)) return 0;
    var baseAmount = areaM2 * cfg.materialCostPerM2Rub + cfg.hardwareCostRub + cfg.targetProfitRub;
    return Math.round(baseAmount / netRevenueCoefficient);
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

    var finalPriceRub = calculateMatPrice(areaM2, cfg);
    if (!isFinite(finalPriceRub) || finalPriceRub <= 0) return fail("Некорректная расчётная цена");

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
      finalPriceRub: finalPriceRub,
      deliveryMinRub: cfg.deliveryMinRub,
      deliveryMaxRub: cfg.deliveryMaxRub
    };
  }

  var api = { PRICING: PRICING, calculateMatPrice: calculateMatPrice, computePricing: computePricing };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PricingCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
