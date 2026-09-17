/*
 * Deterministic nested ("boxes in boxes") layout for containment graphs,
 * used by the Infrastructure topology view: each node may have one parent;
 * children are shelf-packed inside their parent, parents are sized
 * bottom-up to fit, and the roots are shelf-packed on the canvas.
 *
 * Pure and side-effect free, like its siblings LayeredGraphLayout (layered
 * DAGs) and the network view's force layout — the project deliberately
 * bundles no layout library, and determinism matters: the same graph must
 * always lay out identically.
 *
 * Output coordinates follow React Flow's convention for nested nodes:
 * children are positioned RELATIVE to their parent; roots are absolute.
 */

export interface NestedLayoutOptions {
  /** Size of a childless node. */
  leafWidth: number;
  leafHeight: number;
  /** Inner padding of a container, on all sides. */
  padding: number;
  /** Extra top inset inside a container for its name header. */
  headerHeight: number;
  /** Gaps between siblings inside a container. */
  gapX: number;
  gapY: number;
  /** Gaps between root boxes on the canvas. */
  rootGapX: number;
  rootGapY: number;
  /** Target canvas row width used when shelf-packing the roots. */
  maxRowWidth: number;
}

export interface NestedLayoutBox {
  /** Relative to the parent box (React Flow child coords); roots absolute. */
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
}

interface Shelf {
  ids: Array<string>;
  width: number;
  height: number;
}

/*
 * Shelf-pack variable-size boxes into rows: fill a row until adding the
 * next box would exceed the target width (always place at least one box
 * per row). Returns per-box offsets within the block plus the block size.
 */
function shelfPack(
  ids: Array<string>,
  sizeOf: (id: string) => { width: number; height: number },
  targetRowWidth: number,
  gapX: number,
  gapY: number,
): {
  offsets: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
} {
  const offsets: Map<string, { x: number; y: number }> = new Map<
    string,
    { x: number; y: number }
  >();

  const shelves: Array<Shelf> = [];
  let current: Shelf = { ids: [], width: 0, height: 0 };
  for (const id of ids) {
    const size: { width: number; height: number } = sizeOf(id);
    const nextWidth: number =
      current.ids.length === 0 ? size.width : current.width + gapX + size.width;
    if (current.ids.length > 0 && nextWidth > targetRowWidth) {
      shelves.push(current);
      current = { ids: [], width: 0, height: 0 };
    }
    current.ids.push(id);
    current.width =
      current.ids.length === 1 ? size.width : current.width + gapX + size.width;
    current.height = Math.max(current.height, size.height);
  }
  if (current.ids.length > 0) {
    shelves.push(current);
  }

  let y: number = 0;
  let blockWidth: number = 0;
  for (const shelf of shelves) {
    let x: number = 0;
    for (const id of shelf.ids) {
      offsets.set(id, { x, y });
      x += sizeOf(id).width + gapX;
    }
    blockWidth = Math.max(blockWidth, shelf.width);
    y += shelf.height + gapY;
  }
  const blockHeight: number = shelves.length > 0 ? y - gapY : 0;

  return { offsets, width: blockWidth, height: blockHeight };
}

/**
 * Compute the nested layout.
 *
 * `parentOf` links are sanitized: unknown parents, self-links, and links
 * that would form a cycle are dropped (the child becomes a root), so any
 * input terminates with every node placed exactly once.
 */
export default function computeNestedLayout(
  nodeIds: Array<string>,
  parentOf: Map<string, string>,
  options: NestedLayoutOptions,
): Map<string, NestedLayoutBox> {
  const result: Map<string, NestedLayoutBox> = new Map<
    string,
    NestedLayoutBox
  >();

  // Deterministic order regardless of input order.
  const ids: Array<string> = Array.from(new Set<string>(nodeIds)).sort();
  const idSet: Set<string> = new Set<string>(ids);
  if (ids.length === 0) {
    return result;
  }

  // Sanitize parent links: drop unknown/self, then break cycles.
  const parent: Map<string, string> = new Map<string, string>();
  for (const id of ids) {
    const p: string | undefined = parentOf.get(id);
    if (p && p !== id && idSet.has(p)) {
      parent.set(id, p);
    }
  }
  for (const id of ids) {
    const seen: Set<string> = new Set<string>([id]);
    let cursor: string | undefined = parent.get(id);
    while (cursor) {
      if (seen.has(cursor)) {
        // Following this chain returns to itself — cut at the entry point.
        parent.delete(id);
        break;
      }
      seen.add(cursor);
      cursor = parent.get(cursor);
    }
  }

  const childrenOf: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();
  const roots: Array<string> = [];
  for (const id of ids) {
    const p: string | undefined = parent.get(id);
    if (p) {
      childrenOf.set(p, [...(childrenOf.get(p) || []), id]);
    } else {
      roots.push(id);
    }
  }

  /*
   * Bottom-up sizing. Iterative post-order (explicit stack) so deep
   * chains cannot overflow the call stack.
   */
  const size: Map<string, { width: number; height: number }> = new Map<
    string,
    { width: number; height: number }
  >();
  const childOffsets: Map<
    string,
    Map<string, { x: number; y: number }>
  > = new Map<string, Map<string, { x: number; y: number }>>();

  const stack: Array<{ id: string; expanded: boolean }> = roots.map(
    (id: string) => {
      return { id, expanded: false };
    },
  );
  while (stack.length > 0) {
    const frame: { id: string; expanded: boolean } = stack.pop()!;
    const children: Array<string> = childrenOf.get(frame.id) || [];
    if (!frame.expanded && children.length > 0) {
      stack.push({ id: frame.id, expanded: true });
      for (const child of children) {
        stack.push({ id: child, expanded: false });
      }
      continue;
    }

    if (children.length === 0) {
      size.set(frame.id, {
        width: options.leafWidth,
        height: options.leafHeight,
      });
      continue;
    }

    /*
     * Square-ish target width for the child block: total child area
     * suggests a side length; clamp so a single wide child still fits.
     */
    let areaSum: number = 0;
    let widest: number = 0;
    for (const child of children) {
      const s: { width: number; height: number } = size.get(child)!;
      areaSum += (s.width + options.gapX) * (s.height + options.gapY);
      widest = Math.max(widest, s.width);
    }
    const targetWidth: number = Math.max(widest, Math.sqrt(areaSum) * 1.2);

    const packed: {
      offsets: Map<string, { x: number; y: number }>;
      width: number;
      height: number;
    } = shelfPack(
      children,
      (id: string) => {
        return size.get(id)!;
      },
      targetWidth,
      options.gapX,
      options.gapY,
    );

    childOffsets.set(frame.id, packed.offsets);
    size.set(frame.id, {
      width: packed.width + options.padding * 2,
      height: packed.height + options.padding * 2 + options.headerHeight,
    });
  }

  // Place roots on the canvas.
  const rootPack: {
    offsets: Map<string, { x: number; y: number }>;
    width: number;
    height: number;
  } = shelfPack(
    roots,
    (id: string) => {
      return size.get(id)!;
    },
    options.maxRowWidth,
    options.rootGapX,
    options.rootGapY,
  );

  for (const id of roots) {
    const offset: { x: number; y: number } = rootPack.offsets.get(id)!;
    const s: { width: number; height: number } = size.get(id)!;
    result.set(id, {
      x: offset.x,
      y: offset.y,
      width: s.width,
      height: s.height,
      parentId: null,
    });
  }

  // Place children relative to their parents (top-down).
  const queue: Array<string> = [...roots];
  while (queue.length > 0) {
    const parentId: string = queue.shift()!;
    const offsets: Map<string, { x: number; y: number }> | undefined =
      childOffsets.get(parentId);
    if (!offsets) {
      continue;
    }
    for (const [childId, offset] of offsets) {
      const s: { width: number; height: number } = size.get(childId)!;
      result.set(childId, {
        x: offset.x + options.padding,
        y: offset.y + options.padding + options.headerHeight,
        width: s.width,
        height: s.height,
        parentId,
      });
      queue.push(childId);
    }
  }

  return result;
}
