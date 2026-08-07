import DefaultDashboardSize from "../../Types/Dashboard/DashboardSize";
import DashboardBaseComponent from "../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";

/**
 * A widget's footprint on the dashboard grid, in dashboard units.
 *
 * This is the currency of the layout engine: every operation takes an array
 * of GridRects and returns a NEW array (inputs are never mutated), so callers
 * can freely diff previous/next layouts and React can rely on reference
 * equality for unchanged items.
 */
export interface GridRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export interface GridPosition {
  left: number;
  top: number;
}

/**
 * Pure grid-layout engine for dashboard widgets.
 *
 * Model: an infinite-height board that is `columns` units wide. Widgets are
 * free-floating (no gravity — deliberate gaps are preserved), but they may
 * never overlap. When an operation makes two widgets overlap, the lower-
 * priority widget is pushed straight down, cascading as needed.
 *
 * Every function is deterministic and side-effect free, which is what makes
 * live drag previews cheap: the preview is always recomputed from the
 * committed layout plus the candidate position, so transient pushes never
 * accumulate.
 */
export default class GridLayoutUtil {
  public static readonly DefaultColumns: number =
    DefaultDashboardSize.widthInDashboardUnits;

  /** Do two rects occupy at least one common cell? */
  public static rectsOverlap(a: GridRect, b: GridRect): boolean {
    return (
      a.left < b.left + b.width &&
      b.left < a.left + a.width &&
      a.top < b.top + b.height &&
      b.top < a.top + a.height
    );
  }

  /**
   * Round to an integer, falling back when the input is missing, NaN or
   * infinite — saved configs from older builds can hold anything.
   */
  private static toFiniteInt(value: number, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallback;
    }
    return Math.round(value);
  }

  /**
   * Force a rect into a valid state: finite integer coordinates, at least
   * its minimum size, no wider than the board, fully inside the columns
   * and below the top edge.
   */
  public static clampRect(rect: GridRect, columns?: number): GridRect {
    const cols: number = GridLayoutUtil.getColumns(columns);

    const minWidth: number = Math.min(
      Math.max(1, GridLayoutUtil.toFiniteInt(rect.minWidth, 1)),
      cols,
    );
    const minHeight: number = Math.max(
      1,
      GridLayoutUtil.toFiniteInt(rect.minHeight, 1),
    );

    const width: number = Math.min(
      Math.max(GridLayoutUtil.toFiniteInt(rect.width, minWidth), minWidth),
      cols,
    );
    const height: number = Math.max(
      GridLayoutUtil.toFiniteInt(rect.height, minHeight),
      minHeight,
    );

    const left: number = Math.min(
      Math.max(GridLayoutUtil.toFiniteInt(rect.left, 0), 0),
      cols - width,
    );
    const top: number = Math.max(GridLayoutUtil.toFiniteInt(rect.top, 0), 0);

    return {
      ...rect,
      left,
      top,
      width,
      height,
      minWidth,
      minHeight,
    };
  }

  /**
   * Resolve every overlap by pushing lower-priority rects straight down.
   *
   * Priority: ids listed in `priorityIds` (in order) are immovable anchors —
   * they keep exactly the position they were given. Everything else is
   * processed top-to-bottom, left-to-right, and pushed below whatever it
   * overlaps. The returned array preserves the input order.
   */
  public static resolveCollisions(
    rects: Array<GridRect>,
    priorityIds: Array<string>,
  ): Array<GridRect> {
    interface IndexedRect {
      rect: GridRect;
      index: number;
    }

    /*
     * Everything below is keyed by ARRAY INDEX, not id — corrupt configs
     * can contain duplicate ids, and keying by id would collapse the
     * duplicates onto one resolved position (leaving overlaps behind).
     */
    const entries: Array<IndexedRect> = rects.map(
      (rect: GridRect, index: number) => {
        return { rect, index };
      },
    );

    const priorityIndexes: Set<number> = new Set<number>();
    const priorityEntries: Array<IndexedRect> = [];

    for (const id of priorityIds) {
      const entry: IndexedRect | undefined = entries.find(
        (candidate: IndexedRect) => {
          return (
            candidate.rect.id === id && !priorityIndexes.has(candidate.index)
          );
        },
      );
      if (entry) {
        priorityIndexes.add(entry.index);
        priorityEntries.push(entry);
      }
    }

    const otherEntries: Array<IndexedRect> = entries
      .filter((entry: IndexedRect) => {
        return !priorityIndexes.has(entry.index);
      })
      .sort((a: IndexedRect, b: IndexedRect) => {
        if (a.rect.top !== b.rect.top) {
          return a.rect.top - b.rect.top;
        }
        if (a.rect.left !== b.rect.left) {
          return a.rect.left - b.rect.left;
        }
        return a.index - b.index;
      });

    const placed: Array<GridRect> = [];
    const resultByIndex: Map<number, GridRect> = new Map<number, GridRect>();

    for (const entry of [...priorityEntries, ...otherEntries]) {
      let rect: GridRect = entry.rect;
      const isPriority: boolean = priorityIndexes.has(entry.index);

      if (!isPriority) {
        /*
         * Push down until this rect overlaps nothing that is already
         * placed. Each iteration strictly increases `top`, so this
         * terminates; the guard is belt-and-braces.
         */
        let guard: number = 0;
        const maxIterations: number = rects.length * rects.length + 100;

        while (guard < maxIterations) {
          guard++;

          let pushedTop: number | null = null;

          for (const p of placed) {
            if (GridLayoutUtil.rectsOverlap(p, rect)) {
              const bottom: number = p.top + p.height;
              pushedTop =
                pushedTop === null ? bottom : Math.max(pushedTop, bottom);
            }
          }

          if (pushedTop === null) {
            break;
          }

          rect = { ...rect, top: pushedTop };
        }
      }

      placed.push(rect);
      resultByIndex.set(entry.index, rect);
    }

    return rects.map((rect: GridRect, index: number) => {
      const resolved: GridRect | undefined = resultByIndex.get(index);
      if (!resolved) {
        return rect;
      }
      // Preserve the caller's object when nothing about it changed.
      return GridLayoutUtil.areRectsAtSamePlace(resolved, rect)
        ? rect
        : resolved;
    });
  }

  /**
   * Move one widget to a new position. The moved widget wins its spot;
   * anything it lands on is pushed down (cascading). Returns the input
   * array unchanged (same reference) when the move is a no-op.
   */
  public static moveRect(data: {
    rects: Array<GridRect>;
    id: string;
    left: number;
    top: number;
    columns?: number | undefined;
  }): Array<GridRect> {
    const current: GridRect | undefined = data.rects.find((r: GridRect) => {
      return r.id === data.id;
    });

    if (!current) {
      return data.rects;
    }

    const candidate: GridRect = GridLayoutUtil.clampRect(
      { ...current, left: data.left, top: data.top },
      data.columns,
    );

    if (candidate.left === current.left && candidate.top === current.top) {
      return data.rects;
    }

    const moved: Array<GridRect> = data.rects.map((r: GridRect) => {
      return r.id === data.id ? candidate : r;
    });

    return GridLayoutUtil.resolveCollisions(moved, [data.id]);
  }

  /**
   * Resize (and possibly reposition, for north/west resizes) one widget.
   * The resized widget keeps the requested rect; overlapped widgets are
   * pushed down. Returns the input array unchanged when nothing changes.
   */
  public static resizeRect(data: {
    rects: Array<GridRect>;
    id: string;
    left: number;
    top: number;
    width: number;
    height: number;
    columns?: number | undefined;
  }): Array<GridRect> {
    const current: GridRect | undefined = data.rects.find((r: GridRect) => {
      return r.id === data.id;
    });

    if (!current) {
      return data.rects;
    }

    const candidate: GridRect = GridLayoutUtil.clampRect(
      {
        ...current,
        left: data.left,
        top: data.top,
        width: data.width,
        height: data.height,
      },
      data.columns,
    );

    if (GridLayoutUtil.areRectsAtSamePlace(candidate, current)) {
      return data.rects;
    }

    const resized: Array<GridRect> = data.rects.map((r: GridRect) => {
      return r.id === data.id ? candidate : r;
    });

    return GridLayoutUtil.resolveCollisions(resized, [data.id]);
  }

  /**
   * Heal a layout: clamp every rect into bounds and resolve any overlaps
   * deterministically (top-left rects win, later/lower ones get pushed
   * down). Safe to run on every load — a valid layout passes through
   * untouched, with every object reference preserved.
   */
  public static normalize(
    rects: Array<GridRect>,
    columns?: number,
  ): Array<GridRect> {
    const clamped: Array<GridRect> = rects.map((rect: GridRect) => {
      const c: GridRect = GridLayoutUtil.clampRect(rect, columns);
      return GridLayoutUtil.areRectsAtSamePlace(c, rect) &&
        c.minWidth === rect.minWidth &&
        c.minHeight === rect.minHeight
        ? rect
        : c;
    });

    return GridLayoutUtil.resolveCollisions(clamped, []);
  }

  /** Number of rows needed to contain every rect. */
  public static requiredRows(rects: Array<GridRect>): number {
    let rows: number = 0;
    for (const rect of rects) {
      const bottom: number = rect.top + rect.height;
      // Non-finite geometry (corrupt configs) must not poison the total.
      if (Number.isFinite(bottom)) {
        rows = Math.max(rows, bottom);
      }
    }
    return rows;
  }

  /**
   * First free position (scanning top-to-bottom, left-to-right) where a
   * widget of the given size fits without touching anything. Falls back to
   * a fresh row at the bottom.
   */
  public static findFirstFit(data: {
    rects: Array<GridRect>;
    width: number;
    height: number;
    columns?: number | undefined;
  }): GridPosition {
    const cols: number = GridLayoutUtil.getColumns(data.columns);
    const width: number = Math.min(Math.max(1, Math.round(data.width)), cols);
    const height: number = Math.max(1, Math.round(data.height));

    const bottom: number = GridLayoutUtil.requiredRows(data.rects);

    for (let top: number = 0; top <= bottom; top++) {
      for (let left: number = 0; left <= cols - width; left++) {
        const candidate: GridRect = {
          id: "__candidate__",
          left,
          top,
          width,
          height,
          minWidth: 1,
          minHeight: 1,
        };

        const collides: boolean = data.rects.some((rect: GridRect) => {
          return GridLayoutUtil.rectsOverlap(rect, candidate);
        });

        if (!collides) {
          return { left, top };
        }
      }
    }

    return { left: 0, top: bottom };
  }

  /** True when both layouts place every widget at the same rect. */
  public static areLayoutsEqual(
    a: Array<GridRect>,
    b: Array<GridRect>,
  ): boolean {
    if (a.length !== b.length) {
      return false;
    }

    const byId: Map<string, GridRect> = new Map<string, GridRect>(
      b.map((rect: GridRect) => {
        return [rect.id, rect];
      }),
    );

    return a.every((rect: GridRect, index: number) => {
      /*
       * Positional match first — engine operations preserve array order,
       * and position keeps duplicate-id rects (corrupt configs) distinct
       * where an id map would collapse them.
       */
      const positional: GridRect | undefined = b[index];
      const other: GridRect | undefined =
        positional && positional.id === rect.id
          ? positional
          : byId.get(rect.id);
      return Boolean(other) && GridLayoutUtil.areRectsAtSamePlace(rect, other!);
    });
  }

  /** True when the layout contains no overlapping pair. */
  public static hasNoOverlaps(rects: Array<GridRect>): boolean {
    for (let i: number = 0; i < rects.length; i++) {
      for (let j: number = i + 1; j < rects.length; j++) {
        if (GridLayoutUtil.rectsOverlap(rects[i]!, rects[j]!)) {
          return false;
        }
      }
    }
    return true;
  }

  /** Same position and size (ignores min sizes). */
  public static areRectsAtSamePlace(a: GridRect, b: GridRect): boolean {
    return (
      a.left === b.left &&
      a.top === b.top &&
      a.width === b.width &&
      a.height === b.height
    );
  }

  // ── DashboardBaseComponent bridge ─────────────────────────────────────

  public static fromDashboardComponents(
    components: Array<DashboardBaseComponent>,
  ): Array<GridRect> {
    return components.map((component: DashboardBaseComponent) => {
      /*
       * Sanitize on the way in: a single missing/NaN field in a saved
       * config must not poison every downstream computation (requiredRows,
       * findFirstFit, canvas px maths) with NaN.
       */
      return {
        id: component.componentId.toString(),
        left: GridLayoutUtil.toFiniteInt(component.leftInDashboardUnits, 0),
        top: GridLayoutUtil.toFiniteInt(component.topInDashboardUnits, 0),
        width: Math.max(
          GridLayoutUtil.toFiniteInt(component.widthInDashboardUnits, 1),
          1,
        ),
        height: Math.max(
          GridLayoutUtil.toFiniteInt(component.heightInDashboardUnits, 1),
          1,
        ),
        minWidth: Math.max(
          GridLayoutUtil.toFiniteInt(component.minWidthInDashboardUnits, 1),
          1,
        ),
        minHeight: Math.max(
          GridLayoutUtil.toFiniteInt(component.minHeightInDashboardUnits, 1),
          1,
        ),
      };
    });
  }

  /**
   * Write rect positions back onto components. Components whose rect did
   * not change are returned by reference, so React.memo children skip
   * re-rendering untouched widgets.
   */
  public static applyRectsToComponents(
    components: Array<DashboardBaseComponent>,
    rects: Array<GridRect>,
  ): Array<DashboardBaseComponent> {
    const rectById: Map<string, GridRect> = new Map<string, GridRect>(
      rects.map((rect: GridRect) => {
        return [rect.id, rect];
      }),
    );

    return components.map(
      (component: DashboardBaseComponent, index: number) => {
        /*
         * Prefer positional matching: rects normally come straight from
         * fromDashboardComponents on this very array, and position keeps
         * duplicate-id components (corrupt configs) distinct. Fall back to
         * id lookup for callers passing reordered subsets.
         */
        const positional: GridRect | undefined = rects[index];
        const rect: GridRect | undefined =
          positional && positional.id === component.componentId.toString()
            ? positional
            : rectById.get(component.componentId.toString());

        if (!rect) {
          return component;
        }

        if (
          component.leftInDashboardUnits === rect.left &&
          component.topInDashboardUnits === rect.top &&
          component.widthInDashboardUnits === rect.width &&
          component.heightInDashboardUnits === rect.height
        ) {
          return component;
        }

        return {
          ...component,
          leftInDashboardUnits: rect.left,
          topInDashboardUnits: rect.top,
          widthInDashboardUnits: rect.width,
          heightInDashboardUnits: rect.height,
        };
      },
    );
  }

  private static getColumns(columns?: number): number {
    if (!columns || columns < 1) {
      return GridLayoutUtil.DefaultColumns;
    }
    return Math.round(columns);
  }
}
