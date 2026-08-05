import { compareNodeIds } from "./TopologyGraphUtil";

/*
 * Shelf packing for connected components.
 *
 * A real network map is rarely one connected graph. Devices that report
 * no LLDP or CDP neighbours, a satellite office whose uplink has not been
 * discovered, a pair of switches cabled only to each other — each is its
 * own island. The old layout had no concept of this: one global pull
 * toward the frame centre dragged every island onto the same spot, where
 * they interpenetrated and read as a single meaningless tangle.
 *
 * So each component is laid out on its own and the resulting boxes are
 * packed here. The algorithm is Next-Fit-Decreasing-Height: sort boxes
 * tallest first, fill a shelf left to right, start a new shelf when the
 * next box would not fit.
 *
 * NFDH is chosen over the tighter MaxRects and guillotine packers for one
 * reason: those place each box against a free-rectangle list built from
 * the placement history, so one component gaining a single node relocates
 * every component placed after it. On a map that re-polls every sixty
 * seconds that is disqualifying. NFDH's shelves depend only on the sorted
 * box list, so a new island lands at the end and everything earlier stays
 * put. It also produces rows, which read as "here are your islands", and
 * puts the largest component alone on the top shelf where the eye lands.
 *
 * "Stays put" is a claim about the SORTED list, though, not about the
 * caller's identities: a component whose box grows past its neighbour's
 * still trades places with it. Callers whose box size steps with the
 * graph — see {@link PackOrder} — ask for the identity order instead.
 */

// Clearance between two packed component boxes.
export const COMPONENT_GAP: number = 56;

export interface PackedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PackInput {
  width: number;
  height: number;
  /** Stable identity, used as the final tie-break so sorting is total. */
  key: string;
}

export interface PackResult {
  /** Placements, index-aligned with the input array. */
  placements: Array<PackedBox>;
  width: number;
  height: number;
}

/**
 * Which order the boxes are laid onto the shelves in.
 *
 * "decreasingHeight" is the NFDH default described above and is right
 * whenever a box's size is stable: it wastes the least vertical space.
 *
 * "key" orders by identity instead, and exists for callers whose box
 * HEIGHT is a quantized function of the graph — a tidy tree is exactly
 * that, its pixel height stepping by one level gap the moment a single
 * new leaf is discovered. Sorted by height, two side-by-side trees swap
 * ends of the map when one of them grows a row, which reads as the whole
 * network having been rearranged when all that happened was that a till
 * came online. Ordering by root id costs some shelf space and buys a map
 * whose left-to-right order a reader can rely on between polls.
 */
export type PackOrder = "decreasingHeight" | "key";

interface SortableBox {
  index: number;
  width: number;
  height: number;
  key: string;
}

/*
 * Tallest first so a shelf's wasted vertical space is bounded by the
 * height of its own first box. Width then key so the order is total —
 * two same-sized components must not be able to swap places between
 * renders.
 */
const compareByDecreasingHeight: (a: SortableBox, b: SortableBox) => number = (
  a: SortableBox,
  b: SortableBox,
): number => {
  if (a.height !== b.height) {
    return b.height - a.height;
  }
  if (a.width !== b.width) {
    return b.width - a.width;
  }
  return compareNodeIds(a.key, b.key);
};

/** Identity alone, so no measurement of the box can reorder the shelves. */
const compareByKey: (a: SortableBox, b: SortableBox) => number = (
  a: SortableBox,
  b: SortableBox,
): number => {
  return compareNodeIds(a.key, b.key);
};

/**
 * Pack boxes into shelves no wider than `maxRowWidth`.
 *
 * A box wider than `maxRowWidth` is placed on a shelf of its own rather
 * than clipped — the caller's frame is a preference, not a hard limit,
 * because the viewport zooms to fit whatever comes back.
 */
export const packComponentBoxes: (
  boxes: Array<PackInput>,
  maxRowWidth: number,
  gap: number,
  order?: PackOrder | undefined,
) => PackResult = (
  boxes: Array<PackInput>,
  maxRowWidth: number,
  gap: number,
  order?: PackOrder | undefined,
): PackResult => {
  const placements: Array<PackedBox> = boxes.map((): PackedBox => {
    return { x: 0, y: 0, width: 0, height: 0 };
  });

  if (boxes.length === 0) {
    return { placements: placements, width: 0, height: 0 };
  }

  const safeGap: number = Number.isFinite(gap) && gap > 0 ? gap : 0;
  const rowLimit: number =
    Number.isFinite(maxRowWidth) && maxRowWidth > 0 ? maxRowWidth : Infinity;

  const sortable: Array<SortableBox> = boxes.map(
    (box: PackInput, index: number): SortableBox => {
      return {
        index: index,
        width: Number.isFinite(box.width) ? Math.max(0, box.width) : 0,
        height: Number.isFinite(box.height) ? Math.max(0, box.height) : 0,
        key: box.key,
      };
    },
  );

  sortable.sort(order === "key" ? compareByKey : compareByDecreasingHeight);

  let shelfTop: number = 0;
  let shelfHeight: number = 0;
  let cursorX: number = 0;
  let widest: number = 0;
  let shelfMembers: Array<SortableBox> = [];

  const closeShelf: () => void = (): void => {
    for (const member of shelfMembers) {
      /*
       * Centre each box vertically in its shelf. Left-aligning to the top
       * makes a short component look tacked onto the tall one beside it.
       */
      const placement: PackedBox = placements[member.index]!;
      placement.y = shelfTop + (shelfHeight - member.height) / 2;
    }
    shelfTop += shelfHeight + safeGap;
    shelfHeight = 0;
    cursorX = 0;
    shelfMembers = [];
  };

  for (const box of sortable) {
    const needsNewShelf: boolean =
      shelfMembers.length > 0 && cursorX + box.width > rowLimit;
    if (needsNewShelf) {
      closeShelf();
    }

    const placement: PackedBox = placements[box.index]!;
    placement.x = cursorX;
    placement.y = shelfTop;
    placement.width = box.width;
    placement.height = box.height;

    shelfMembers.push(box);
    shelfHeight = Math.max(shelfHeight, box.height);
    cursorX += box.width + safeGap;
    widest = Math.max(widest, cursorX - safeGap);
  }

  if (shelfMembers.length > 0) {
    closeShelf();
  }

  return {
    placements: placements,
    width: widest,
    // The last closeShelf added a trailing gap that is not content.
    height: Math.max(0, shelfTop - safeGap),
  };
};
