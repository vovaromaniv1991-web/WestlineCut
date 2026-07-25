/**
 * WestlineCut — модуль оптимізації розкрою.
 *
 * Використовується алгоритм вільних прямокутників:
 * після розміщення деталі вільна зона ділиться на нові зони.
 */

const WestlineOptimizer = (() => {
  const EPSILON = 0.001;

  /**
   * Основна функція оптимізації.
   *
   * @param {Object} settings
   * @param {number} settings.sheetWidth ширина плити, мм
   * @param {number} settings.sheetHeight висота плити, мм
   * @param {number} settings.kerf ширина пропилу, мм
   * @param {number} settings.edgeMargin відступ від країв, мм
   * @param {boolean} settings.allowRotation дозволити поворот деталей
   * @param {Array} parts список деталей
   *
   * Формат деталі:
   * {
   *   id: "1",
   *   name: "Фасад",
   *   width: 500,
   *   height: 700,
   *   quantity: 2,
   *   canRotate: true
   * }
   */
  function optimize(settings, parts) {
    const config = normalizeSettings(settings);
    const expandedParts = expandParts(parts);

    validateParts(expandedParts, config);

    const sortedParts = expandedParts.sort(compareParts);
    const sheets = [];

    sortedParts.forEach((part) => {
      let bestPlacement = null;

      for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
        const candidate = findBestPlacement(
          sheets[sheetIndex],
          part,
          config
        );

        if (
          candidate &&
          (!bestPlacement || candidate.score < bestPlacement.score)
        ) {
          bestPlacement = {
            ...candidate,
            sheetIndex
          };
        }
      }

      if (!bestPlacement) {
        const newSheet = createSheet(sheets.length + 1, config);
        sheets.push(newSheet);

        const candidate = findBestPlacement(newSheet, part, config);

        if (!candidate) {
          throw new Error(
            `Деталь "${part.name}" ${part.width}×${part.height} мм ` +
            `не поміщається на плиту ${config.sheetWidth}×${config.sheetHeight} мм.`
          );
        }

        bestPlacement = {
          ...candidate,
          sheetIndex: sheets.length - 1
        };
      }

      placePart(
        sheets[bestPlacement.sheetIndex],
        part,
        bestPlacement,
        config
      );
    });

    return buildResult(sheets, config, expandedParts);
  }

  function normalizeSettings(settings = {}) {
    const sheetWidth = positiveNumber(settings.sheetWidth, 2800);
    const sheetHeight = positiveNumber(settings.sheetHeight, 2070);
    const kerf = nonNegativeNumber(settings.kerf, 4);
    const edgeMargin = nonNegativeNumber(settings.edgeMargin, 10);

    if (sheetWidth <= edgeMargin * 2 || sheetHeight <= edgeMargin * 2) {
      throw new Error("Відступи від країв завеликі для вибраної плити.");
    }

    return {
      sheetWidth,
      sheetHeight,
      kerf,
      edgeMargin,
      allowRotation: settings.allowRotation !== false
    };
  }

  function expandParts(parts = []) {
    const result = [];

    parts.forEach((item, index) => {
      const width = positiveNumber(item.width);
      const height = positiveNumber(item.height);
      const quantity = Math.max(
        1,
        Math.floor(positiveNumber(item.quantity, 1))
      );

      for (let copy = 1; copy <= quantity; copy += 1) {
        result.push({
          id: item.id ?? `${index + 1}`,
          instanceId: `${item.id ?? index + 1}-${copy}`,
          name: String(item.name || `Деталь ${index + 1}`),
          width,
          height,
          canRotate: item.canRotate !== false,
          sourceIndex: index,
          copyNumber: copy
        });
      }
    });

    return result;
  }

  function validateParts(parts, config) {
    if (!parts.length) {
      throw new Error("Не додано жодної деталі для розкрою.");
    }

    const usableWidth = config.sheetWidth - config.edgeMargin * 2;
    const usableHeight = config.sheetHeight - config.edgeMargin * 2;

    parts.forEach((part) => {
      const normalFits =
        part.width <= usableWidth + EPSILON &&
        part.height <= usableHeight + EPSILON;

      const rotatedFits =
        config.allowRotation &&
        part.canRotate &&
        part.height <= usableWidth + EPSILON &&
        part.width <= usableHeight + EPSILON;

      if (!normalFits && !rotatedFits) {
        throw new Error(
          `Деталь "${part.name}" ${part.width}×${part.height} мм ` +
          `завелика для робочої зони плити ${usableWidth}×${usableHeight} мм.`
        );
      }
    });
  }

  function compareParts(a, b) {
    const areaDifference =
      b.width * b.height - a.width * a.height;

    if (Math.abs(areaDifference) > EPSILON) {
      return areaDifference;
    }

    const maxSideDifference =
      Math.max(b.width, b.height) - Math.max(a.width, a.height);

    if (Math.abs(maxSideDifference) > EPSILON) {
      return maxSideDifference;
    }

    return Math.min(b.width, b.height) - Math.min(a.width, a.height);
  }

  function createSheet(number, config) {
    return {
      number,
      width: config.sheetWidth,
      height: config.sheetHeight,
      placements: [],
      freeRectangles: [
        {
          x: config.edgeMargin,
          y: config.edgeMargin,
          width: config.sheetWidth - config.edgeMargin * 2,
          height: config.sheetHeight - config.edgeMargin * 2
        }
      ]
    };
  }

  function findBestPlacement(sheet, part, config) {
    const variants = [
      {
        width: part.width,
        height: part.height,
        rotated: false
      }
    ];

    if (
      config.allowRotation &&
      part.canRotate &&
      Math.abs(part.width - part.height) > EPSILON
    ) {
      variants.push({
        width: part.height,
        height: part.width,
        rotated: true
      });
    }

    let best = null;

    sheet.freeRectangles.forEach((space, freeIndex) => {
      variants.forEach((variant) => {
        if (
          variant.width <= space.width + EPSILON &&
          variant.height <= space.height + EPSILON
        ) {
          const horizontalWaste = space.width - variant.width;
          const verticalWaste = space.height - variant.height;

          const shortSideFit = Math.min(
            horizontalWaste,
            verticalWaste
          );

          const longSideFit = Math.max(
            horizontalWaste,
            verticalWaste
          );

          const areaWaste =
            space.width * space.height -
            variant.width * variant.height;

          const score =
            shortSideFit * 100000000 +
            longSideFit * 10000 +
            areaWaste;

          if (!best || score < best.score) {
            best = {
              x: space.x,
              y: space.y,
              width: variant.width,
              height: variant.height,
              rotated: variant.rotated,
              freeIndex,
              score
            };
          }
        }
      });
    });

    return best;
  }

  function placePart(sheet, part, placement, config) {
    const placedRectangle = {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height
    };

    const updatedFreeRectangles = [];

    sheet.freeRectangles.forEach((freeRectangle) => {
      if (!rectanglesIntersect(freeRectangle, placedRectangle)) {
        updatedFreeRectangles.push(freeRectangle);
        return;
      }

      const splitRectangles = splitFreeRectangle(
        freeRectangle,
        placedRectangle,
        config.kerf
      );

      splitRectangles.forEach((rectangle) => {
        if (
          rectangle.width > EPSILON &&
          rectangle.height > EPSILON
        ) {
          updatedFreeRectangles.push(rectangle);
        }
      });
    });

    sheet.freeRectangles = pruneFreeRectangles(updatedFreeRectangles);

    sheet.placements.push({
      ...part,
      x: placement.x,
      y: placement.y,
      placedWidth: placement.width,
      placedHeight: placement.height,
      rotated: placement.rotated
    });
  }

  function rectanglesIntersect(a, b) {
    return !(
      b.x >= a.x + a.width - EPSILON ||
      b.x + b.width <= a.x + EPSILON ||
      b.y >= a.y + a.height - EPSILON ||
      b.y + b.height <= a.y + EPSILON
    );
  }

  function splitFreeRectangle(free, used, kerf) {
    const rectangles = [];

    const freeRight = free.x + free.width;
    const freeBottom = free.y + free.height;
    const usedRight = used.x + used.width;
    const usedBottom = used.y + used.height;

    if (used.x > free.x + EPSILON) {
      rectangles.push({
        x: free.x,
        y: free.y,
        width: used.x - free.x - kerf,
        height: free.height
      });
    }

    if (usedRight < freeRight - EPSILON) {
      rectangles.push({
        x: usedRight + kerf,
        y: free.y,
        width: freeRight - usedRight - kerf,
        height: free.height
      });
    }

    if (used.y > free.y + EPSILON) {
      rectangles.push({
        x: free.x,
        y: free.y,
        width: free.width,
        height: used.y - free.y - kerf
      });
    }

    if (usedBottom < freeBottom - EPSILON) {
      rectangles.push({
        x: free.x,
        y: usedBottom + kerf,
        width: free.width,
        height: freeBottom - usedBottom - kerf
      });
    }

    return rectangles;
  }

  function pruneFreeRectangles(rectangles) {
    const filtered = rectangles.filter((rectangle, index) => {
      if (
        rectangle.width <= EPSILON ||
        rectangle.height <= EPSILON
      ) {
        return false;
      }

      return !rectangles.some((other, otherIndex) => {
        if (index === otherIndex) {
          return false;
        }

        return containsRectangle(other, rectangle);
      });
    });

    return removeDuplicateRectangles(filtered);
  }

  function containsRectangle(outer, inner) {
    return (
      inner.x >= outer.x - EPSILON &&
      inner.y >= outer.y - EPSILON &&
      inner.x + inner.width <= outer.x + outer.width + EPSILON &&
      inner.y + inner.height <= outer.y + outer.height + EPSILON
    );
  }

  function removeDuplicateRectangles(rectangles) {
    return rectangles.filter((rectangle, index) => {
      return !rectangles.some((other, otherIndex) => {
        if (otherIndex >= index) {
          return false;
        }

        return (
          Math.abs(rectangle.x - other.x) < EPSILON &&
          Math.abs(rectangle.y - other.y) < EPSILON &&
          Math.abs(rectangle.width - other.width) < EPSILON &&
          Math.abs(rectangle.height - other.height) < EPSILON
        );
      });
    });
  }

  function buildResult(sheets, config, parts) {
    const totalPartArea = parts.reduce(
      (sum, part) => sum + part.width * part.height,
      0
    );

    const totalSheetArea =
      sheets.length * config.sheetWidth * config.sheetHeight;

    const usefulAreaPerSheet =
      (config.sheetWidth - config.edgeMargin * 2) *
      (config.sheetHeight - config.edgeMargin * 2);

    const totalUsefulArea = sheets.length * usefulAreaPerSheet;

    const utilization =
      totalUsefulArea > 0
        ? (totalPartArea / totalUsefulArea) * 100
        : 0;

    return {
      sheets,
      sheetCount: sheets.length,
      partCount: parts.length,
      totalPartArea,
      totalSheetArea,
      utilization: round(utilization, 2),
      wastePercent: round(100 - utilization, 2),
      settings: { ...config }
    };
  }

  function positiveNumber(value, fallback) {
    const number = Number(value);

    if (Number.isFinite(number) && number > 0) {
      return number;
    }

    if (fallback !== undefined) {
      return fallback;
    }

    throw new Error(`Некоректне числове значення: ${value}`);
  }

  function nonNegativeNumber(value, fallback = 0) {
    const number = Number(value);

    if (Number.isFinite(number) && number >= 0) {
      return number;
    }

    return fallback;
  }

  function round(value, decimals = 2) {
    const multiplier = 10 ** decimals;
    return Math.round(value * multiplier) / multiplier;
  }

  return {
    optimize
  };
})();

window.WestlineOptimizer = WestlineOptimizer;
