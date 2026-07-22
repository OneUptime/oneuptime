/*
 * Pure, react-free grid layout for the SiteContainerGraph: the children of
 * one site are fixed-size cards placed row-major on a square-ish grid
 * (columns = ceil(sqrt(n))), so 9 markets read as a 3x3 block instead of
 * one endless row.
 *
 * Kept out of the component so it can be imported (and unit-tested) in a
 * plain Node/TypeScript environment — see Geo/GeoProjection.ts for why.
 *
 * Deterministic by construction: input order is preserved (the server
 * sorts children by name), duplicates collapse to their first occurrence,
 * and there is no randomness — the same ids always produce the same grid.
 * Its sibling NestedGraphLayout solves the variable-size nested case; a
 * flat set of identical cards only needs this much simpler grid.
 */

export interface SiteGridOptions {
  /** Fixed card size — every node renders at exactly this box. */
  cardWidth: number;
  cardHeight: number;
  /** Gaps between grid cells. */
  gapX: number;
  gapY: number;
}

export interface SiteGridPosition {
  x: number;
  y: number;
}

/**
 * Columns for `count` cards: ceil(sqrt(count)), and 0 for an empty set.
 */
export const gridColumnCount: (count: number) => number = (
  count: number,
): number => {
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  return Math.ceil(Math.sqrt(count));
};

/**
 * Rows for `count` cards on that same grid: ceil(count / columns), and 0
 * for an empty set. The graph sizes its canvas from this, so a two-row
 * level gets a short canvas instead of a fixed viewport-height box with a
 * dead region under the cards.
 */
export const gridRowCount: (count: number) => number = (
  count: number,
): number => {
  const columns: number = gridColumnCount(count);
  if (columns <= 0) {
    return 0;
  }
  return Math.ceil(count / columns);
};

/**
 * Place every id on the grid, row-major in input order. Every unique id
 * gets exactly one position (so edges between any two placed ids always
 * have both endpoints); malformed options fall back to sane values
 * instead of producing NaN coordinates.
 */
export const computeSiteGridLayout: (
  ids: Array<string>,
  options: SiteGridOptions,
) => Map<string, SiteGridPosition> = (
  ids: Array<string>,
  options: SiteGridOptions,
): Map<string, SiteGridPosition> => {
  const result: Map<string, SiteGridPosition> = new Map<
    string,
    SiteGridPosition
  >();

  // Dedupe while preserving first-occurrence order.
  const uniqueIds: Array<string> = [];
  const seen: Set<string> = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    uniqueIds.push(id);
  }

  if (uniqueIds.length === 0) {
    return result;
  }

  const cardWidth: number =
    Number.isFinite(options.cardWidth) && options.cardWidth > 0
      ? options.cardWidth
      : 1;
  const cardHeight: number =
    Number.isFinite(options.cardHeight) && options.cardHeight > 0
      ? options.cardHeight
      : 1;
  const gapX: number =
    Number.isFinite(options.gapX) && options.gapX > 0 ? options.gapX : 0;
  const gapY: number =
    Number.isFinite(options.gapY) && options.gapY > 0 ? options.gapY : 0;

  const columns: number = gridColumnCount(uniqueIds.length);

  for (let index: number = 0; index < uniqueIds.length; index++) {
    const column: number = index % columns;
    const row: number = Math.floor(index / columns);
    result.set(uniqueIds[index]!, {
      x: column * (cardWidth + gapX),
      y: row * (cardHeight + gapY),
    });
  }

  return result;
};
