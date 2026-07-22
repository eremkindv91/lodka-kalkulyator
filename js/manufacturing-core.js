/*
 * Ядро производственного ограничения: максимальная длина одной части коврика.
 * Чистые функции, без DOM. Работает в браузере (window.ManufacturingCore) и Node (module.exports).
 */
(function (root) {
  "use strict";

  var MANUFACTURING_CONFIG = {
    maxSinglePartLengthCm: 210,
    maxAutoSupportedParts: 2
  };

  /**
   * Считает количество частей по производственной длине.
   *  L ≤ 210        → 1 часть
   *  210 < L ≤ 420  → 2 части (место соединения подтверждает менеджер)
   *  L > 420        → автоматическое оформление не поддерживается
   */
  function computeParts(productionLengthCm, cfg) {
    cfg = cfg || MANUFACTURING_CONFIG;
    var max = cfg.maxSinglePartLengthCm;
    if (typeof productionLengthCm !== "number" || !isFinite(productionLengthCm) || productionLengthCm <= 0) {
      return { valid: false, partCount: null, supported: false };
    }
    // эпсилон гасит ошибку плавающей точки на границах (210, 420)
    var partCount = Math.ceil(productionLengthCm / max - 1e-9);
    if (partCount < 1) partCount = 1;
    var supported = partCount <= cfg.maxAutoSupportedParts;
    return {
      valid: true,
      maxSinglePartLengthCm: max,
      partCount: partCount,
      supported: supported,
      requiresManagerSplitConfirmation: partCount > 1,
      splitPositionConfirmed: false
    };
  }

  var api = { MANUFACTURING_CONFIG: MANUFACTURING_CONFIG, computeParts: computeParts };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ManufacturingCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
