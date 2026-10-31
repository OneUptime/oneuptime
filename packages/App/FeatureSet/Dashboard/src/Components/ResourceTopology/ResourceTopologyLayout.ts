import { SECTION_KIND } from "./ResourceTopologyKinds";
import {
  ResourceTopologyCardItem,
  ResourceTopologyChipItem,
  ResourceTopologyGroupItem,
  ResourceTopologyKeyMove,
  ResourceTopologyMoreItem,
  ResourceTopologyRelatedItem,
  ResourceTopologyVisible,
} from "./ResourceTopologyView";

/*
 * Where everything of a resource topology goes on the map: a tree read from
 * the resource down and outwards, never a box inside a box.
 *
 * The resource sits at the top, and its own parts under it, a little in
 * from its edge. Every other part's parts stand in the column after it. Every
 * part is a card of its own (a chip when it holds nothing and has many
 * siblings), and no part is ever drawn inside another. What a part holds is
 * grouped by kind under a small heading ("ESXi Hosts 4 · 1 needs
 * attention"), and one line joins the part to each of its groups:
 * containment reads along the line - a cluster, then its nodes, then their
 * pods; a host, then its virtual machines - and the column a part stands in
 * says how deep it sits. A group is a heading over its parts, never a frame,
 * and it never holds another group: a part's own parts hang off that part,
 * in the next column. Sections - parts with no record of their own, such as
 * "Hardware" or "Not on a node" - stand in their column like any part, with
 * no heading of their own.
 *
 * A part's parts start below its middle, so a straight line across the
 * map at the height of any part runs past every part above it: a host's
 * callers, in a lane before the tree, and what its services call, in a lane
 * after it, reach the services they talk to without crossing a card.
 * Parts that are closed, or hold nothing, flow into rows, so a host's forty
 * virtual machines make a block rather than a tower; a part that is open
 * stands alone in its column, with room after it for its own parts.
 *
 * The drawing tries a few row lengths and keeps the one that fits the canvas
 * at the largest zoom - or the one it is handed, so that opening a part
 * never re-flows the rest. A page read from right to left gets the same tree
 * mirrored: the resource at the top right, its parts to its left.
 *
 * Pure and free of React, so the App suite can check every rule.
 */

export const RESOURCE_TOPOLOGY_SIZES: {
  cardWidth: number;
  cardHeight: number;
  holderHeight: number;
  rootWidth: number;
  rootHeight: number;
  sectionHeight: number;
  chipWidth: number;
  chipHeight: number;
  headingHeight: number;
  headingMinWidth: number;
  headingGap: number;
  itemGap: number;
  toggleGap: number;
  groupGap: number;
  columnGap: number;
  spineOffset: number;
  rootIndent: number;
  rootSpineX: number;
  rootGap: number;
  drop: number;
  laneGap: number;
  relatedGap: number;
  relatedWidth: number;
  relatedHeight: number;
  captionHeight: number;
} = {
  // A part that holds nothing: its name, and how it is doing.
  cardWidth: 248,
  cardHeight: 62,
  // A part that holds others says what, on a line of its own.
  holderHeight: 80,
  // The resource itself.
  rootWidth: 264,
  rootHeight: 80,
  // "Hardware", "Not on a node": a name and what it holds.
  sectionHeight: 62,
  chipWidth: 200,
  chipHeight: 44,
  // "ESXi Hosts 4 · 1 needs attention": over a group's parts.
  headingHeight: 26,
  headingMinWidth: 360,
  headingGap: 4,
  itemGap: 10,
  // Side by side, after a part that opens: room for its round toggle.
  toggleGap: 26,
  groupGap: 22,
  // Between a column of parts and the next: the lines run here.
  columnGap: 60,
  // Where a part's line turns down to its groups, from the part's edge.
  spineOffset: 24,
  // The resource's parts start under it, this far in from its edge ...
  rootIndent: 40,
  // ... joined to it by a line this far in, that leaves from its bottom.
  rootSpineX: 18,
  // Between the resource and the first of its parts.
  rootGap: 18,
  // A part's parts start this far below its middle.
  drop: 10,
  // Between a lane and the tree: room for a call's rate on its line.
  laneGap: 96,
  relatedGap: 120,
  relatedWidth: 232,
  relatedHeight: 52,
  captionHeight: 28,
};

const SIZES: typeof RESOURCE_TOPOLOGY_SIZES = RESOURCE_TOPOLOGY_SIZES;

export type ResourceTopologyPlacedKind =
  | "card"
  | "chip"
  | "more"
  | "heading"
  | "related"
  | "relatedCaption";

/* The heading over a focused part's related parts of one kind. */
export interface ResourceTopologyRelatedCaption {
  /* English: "Runs here". */
  label: string;
  count: number;
}

/* A heading: over a group's parts, or over a lane (its section's name). */
export interface ResourceTopologyHeading {
  group?: ResourceTopologyGroupItem | undefined;
  /* The section a lane holds: "Called by", "Talks to". */
  laneSectionId?: string | undefined;
  /* How many parts the lane holds. */
  laneCount?: number | undefined;
}

export type ResourceTopologyLaneSide = "start" | "end";

export interface ResourceTopologyPlaced {
  /* The map node's id: the part's id, a group's or a "+ N more" item's. */
  id: string;
  kind: ResourceTopologyPlacedKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /* The column it stands in: 0 for the resource, 1 for its parts... */
  depth: number;
  /* The part it hangs from (the part whose groups hold it). */
  parentId: string | null;
  /* Set for what stands in a lane. */
  lane?: ResourceTopologyLaneSide | undefined;
  card?: ResourceTopologyCardItem | undefined;
  chip?: ResourceTopologyChipItem | undefined;
  more?: ResourceTopologyMoreItem | undefined;
  heading?: ResourceTopologyHeading | undefined;
  related?: ResourceTopologyRelatedItem | undefined;
  relatedCaption?: ResourceTopologyRelatedCaption | undefined;
}

/*
 * A line from a part to one of its groups (or to a section it holds): from
 * the part's edge, along to the spine, down it and into the group's
 * heading. `nodeIds` are the parts it leads to, so the map can colour it by
 * how they are doing and light it up on the way to the part someone picked.
 */
export interface ResourceTopologyBranch {
  id: string;
  /* The map node it leaves: the part. */
  from: string;
  /* The map node it enters: a heading or a section. */
  to: string;
  /* The part it leaves. */
  fromNodeId: string;
  nodeIds: Array<string>;
  points: Array<[number, number]>;
}

export interface ResourceTopologyLayout {
  placed: Array<ResourceTopologyPlaced>;
  byId: Map<string, ResourceTopologyPlaced>;
  branches: Array<ResourceTopologyBranch>;
  width: number;
  height: number;
  /* The page's reading direction the tree was laid out for. */
  direction: ResourceTopologyDirection;
  /* The most parts a row of closed parts holds in this drawing. */
  rowLength: number;
}

export type ResourceTopologyDirection = "ltr" | "rtl";

export type ResourceTopologySide = "top" | "right" | "bottom" | "left";

/* The part a placed item stands for, when it stands for one. */
export function placedNodeId(placed: ResourceTopologyPlaced): string | null {
  return (
    placed.card?.nodeId ||
    placed.chip?.nodeId ||
    placed.related?.nodeId ||
    placed.heading?.laneSectionId ||
    null
  );
}

/*
 * The map's keys: the arrows that point along the line move forward into a
 * part and back out of it, so on a page read from right to left, where the
 * drawing is mirrored, left is forward.
 */
export function getTopologyKeyMove(
  key: string,
  direction: ResourceTopologyDirection,
): ResourceTopologyKeyMove | null {
  switch (key) {
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "previous";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "ArrowRight":
      return direction === "rtl" ? "back" : "forward";
    case "ArrowLeft":
      return direction === "rtl" ? "forward" : "back";
    default:
      return null;
  }
}

/*
 * The sides a line between a focused part and a part of its related column
 * leaves and enters by: the column is after the drawing (at its right, or
 * at its left on a page read from right to left), so the line leaves the
 * focused part by the side facing it and enters the related part by its
 * near side, whichever way the relation points - never down the column
 * across the parts in it.
 */
export function getRelatedColumnSides(
  outward: boolean,
  direction: ResourceTopologyDirection,
): { source: ResourceTopologySide; target: ResourceTopologySide } {
  const towardsColumn: ResourceTopologySide =
    direction === "rtl" ? "left" : "right";
  const awayFromColumn: ResourceTopologySide =
    direction === "rtl" ? "right" : "left";

  return outward
    ? { source: towardsColumn, target: awayFromColumn }
    : { source: awayFromColumn, target: towardsColumn };
}

type Rect = Pick<ResourceTopologyPlaced, "x" | "y" | "width" | "height">;

/*
 * The sides a line between two parts leaves and enters by: the sides that
 * face each other across the wider gap between them — side by side, the
 * line runs across; one above the other, it runs down — so it never
 * crosses either part.
 */
export function getRelationSides(
  from: Rect,
  to: Rect,
): { source: ResourceTopologySide; target: ResourceTopologySide } {
  const gapX: number = Math.max(
    to.x - (from.x + from.width),
    from.x - (to.x + to.width),
  );
  const gapY: number = Math.max(
    to.y - (from.y + from.height),
    from.y - (to.y + to.height),
  );

  if (gapX >= gapY) {
    return to.x + to.width / 2 >= from.x + from.width / 2
      ? { source: "right", target: "left" }
      : { source: "left", target: "right" };
  }

  return to.y + to.height / 2 >= from.y + from.height / 2
    ? { source: "bottom", target: "top" }
    : { source: "top", target: "bottom" };
}

export interface ResourceTopologyCurveEnd {
  x: number;
  y: number;
  side: ResourceTopologySide;
}

/* Where along a line its label sits: nearer the end it points at. */
export const RELATION_LABEL_AT: number = 0.68;

/*
 * A line's curve — React Flow's own bezier, the same control points — and
 * the point `at` of the way along it for the label. Midway, a label lands
 * on whatever the line passes over; nearer the end it points at, it sits in
 * the gap before that part.
 */
export function getRelationCurve(
  source: ResourceTopologyCurveEnd,
  target: ResourceTopologyCurveEnd,
  at: number = RELATION_LABEL_AT,
): { path: string; labelX: number; labelY: number } {
  const offset: (distance: number) => number = (distance: number): number => {
    return distance >= 0 ? 0.5 * distance : 0.25 * 25 * Math.sqrt(-distance);
  };
  const control: (
    end: ResourceTopologyCurveEnd,
    other: ResourceTopologyCurveEnd,
  ) => [number, number] = (
    end: ResourceTopologyCurveEnd,
    other: ResourceTopologyCurveEnd,
  ): [number, number] => {
    switch (end.side) {
      case "left":
        return [end.x - offset(end.x - other.x), end.y];
      case "right":
        return [end.x + offset(other.x - end.x), end.y];
      case "top":
        return [end.x, end.y - offset(end.y - other.y)];
      default:
        return [end.x, end.y + offset(other.y - end.y)];
    }
  };
  const [c1x, c1y] = control(source, target);
  const [c2x, c2y] = control(target, source);
  const u: number = 1 - at;
  const point: (a: number, b: number, c: number, d: number) => number = (
    a: number,
    b: number,
    c: number,
    d: number,
  ): number => {
    return (
      u * u * u * a +
      3 * u * u * at * b +
      3 * u * at * at * c +
      at * at * at * d
    );
  };

  return {
    path: `M${source.x},${source.y} C${c1x},${c1y} ${c2x},${c2y} ${target.x},${target.y}`,
    labelX: point(source.x, c1x, c2x, target.x),
    labelY: point(source.y, c1y, c2y, target.y),
  };
}

/* How round a line's turns are, at most. */
export const BRANCH_CORNER_RADIUS: number = 10;

/*
 * A branch's path through its points, its turns rounded: a quarter circle
 * of BRANCH_CORNER_RADIUS, or less where a leg is too short for one.
 */
export function getBranchPath(points: Array<[number, number]>): string {
  if (points.length === 0) {
    return "";
  }

  const round: (value: number) => string = (value: number): string => {
    return String(Math.round(value * 100) / 100);
  };
  const first: [number, number] = points[0]!;
  let path: string = `M${round(first[0])},${round(first[1])}`;

  for (let index: number = 1; index < points.length; index++) {
    const current: [number, number] = points[index]!;
    const next: [number, number] | undefined = points[index + 1];

    if (!next) {
      path += ` L${round(current[0])},${round(current[1])}`;
      break;
    }

    const previous: [number, number] = points[index - 1]!;
    const inLength: number = Math.hypot(
      current[0] - previous[0],
      current[1] - previous[1],
    );
    const outLength: number = Math.hypot(
      next[0] - current[0],
      next[1] - current[1],
    );
    const radius: number = Math.min(
      BRANCH_CORNER_RADIUS,
      inLength / 2,
      outLength / 2,
    );

    if (radius <= 0.5) {
      path += ` L${round(current[0])},${round(current[1])}`;
      continue;
    }

    const before: [number, number] = [
      current[0] - ((current[0] - previous[0]) / inLength) * radius,
      current[1] - ((current[1] - previous[1]) / inLength) * radius,
    ];
    const after: [number, number] = [
      current[0] + ((next[0] - current[0]) / outLength) * radius,
      current[1] + ((next[1] - current[1]) / outLength) * radius,
    ];

    path += ` L${round(before[0])},${round(before[1])} Q${round(current[0])},${round(current[1])} ${round(after[0])},${round(after[1])}`;
  }

  return path;
}

interface Size {
  width: number;
  height: number;
}

/* How big a card is: the resource, a section, a part that holds others. */
export function getCardSize(
  card: ResourceTopologyCardItem,
  options: { isRoot: boolean },
): Size {
  if (options.isRoot) {
    return { width: SIZES.rootWidth, height: SIZES.rootHeight };
  }

  if (card.isSection) {
    return { width: SIZES.cardWidth, height: SIZES.sectionHeight };
  }

  return {
    width: SIZES.cardWidth,
    height: card.canOpen ? SIZES.holderHeight : SIZES.cardHeight,
  };
}

const CHIP_SIZE: Size = { width: SIZES.chipWidth, height: SIZES.chipHeight };

function moreSize(more: ResourceTopologyMoreItem): Size {
  return more.asChip
    ? CHIP_SIZE
    : { width: SIZES.cardWidth, height: SIZES.cardHeight };
}

/* Parts of the resource drawn beside the tree rather than in it. */
export interface ResourceTopologyLanes {
  /* What calls the resource: a lane before it. */
  left: Array<string>;
  /* What the resource calls: a lane after everything. */
  right: Array<string>;
}

/* A relation, as far as where things go is concerned. */
export interface ResourceTopologyLayoutRelation {
  from: string;
  to: string;
}

export interface ResourceTopologyLayoutOptions {
  /* The shape of the canvas, width over height. */
  aspect: number;
  lanes?: ResourceTopologyLanes | undefined;
  /*
   * The resource's relations: a lane's parts line up with the parts they
   * are related to, so their lines run straight across.
   */
  relations?: ReadonlyArray<ResourceTopologyLayoutRelation> | undefined;
  /* Which way the page reads: a right-to-left page gets the tree mirrored. */
  direction?: ResourceTopologyDirection | undefined;
  /*
   * The most parts a row holds. Left out, the layout tries
   * ROW_LENGTHS_TRIED and keeps the one that fits the canvas best; the map
   * passes the first view's, so opening a part never re-flows the rest.
   */
  rowLength?: number | undefined;
}

/* The widest rows tried, in parts: the drawing keeps what fits best. */
export const ROW_LENGTHS_TRIED: ReadonlyArray<number> = [1, 2, 3, 4, 5, 6];

/*
 * How many parts a row of `count` holds when rows hold `longest` at most:
 * as even as can be - six chips in rows of up to four make two rows of
 * three, not a row of four and one of two.
 */
export function getRowLength(count: number, longest: number): number {
  if (count <= 0) {
    return 1;
  }

  const rows: number = Math.ceil(count / Math.max(1, longest));

  return Math.max(1, Math.ceil(count / rows));
}

type Cell =
  | { type: "card"; card: ResourceTopologyCardItem }
  | { type: "chip"; chip: ResourceTopologyChipItem }
  | { type: "more"; more: ResourceTopologyMoreItem };

interface Draft {
  placed: Array<ResourceTopologyPlaced>;
  branches: Array<ResourceTopologyBranch>;
}

/*
 * The top without the sections that go in its lanes, and those sections,
 * in the lanes' order. Only cards in the top's own groups can go in a lane.
 */
function splitLanes(
  top: ResourceTopologyCardItem,
  lanes: ResourceTopologyLanes | undefined,
): {
  top: ResourceTopologyCardItem;
  left: Array<ResourceTopologyCardItem>;
  right: Array<ResourceTopologyCardItem>;
} {
  const wanted: Set<string> = new Set<string>([
    ...(lanes?.left || []),
    ...(lanes?.right || []),
  ]);
  const found: Map<string, ResourceTopologyCardItem> = new Map<
    string,
    ResourceTopologyCardItem
  >();

  if (wanted.size > 0 && top.isOpen) {
    for (const group of top.groups) {
      for (const item of group.items) {
        if (item.type === "card" && wanted.has(item.id)) {
          found.set(item.id, item);
        }
      }
    }
  }

  if (found.size === 0) {
    return { top: top, left: [], right: [] };
  }

  const pick: (ids: Array<string>) => Array<ResourceTopologyCardItem> = (
    ids: Array<string>,
  ): Array<ResourceTopologyCardItem> => {
    const picked: Array<ResourceTopologyCardItem> = [];

    for (const id of ids) {
      const item: ResourceTopologyCardItem | undefined = found.get(id);

      if (item) {
        picked.push(item);
      }
    }

    return picked;
  };

  return {
    top: {
      ...top,
      groups: top.groups
        .map((group: ResourceTopologyGroupItem): ResourceTopologyGroupItem => {
          return {
            ...group,
            items: group.items.filter(
              (
                item: ResourceTopologyCardItem | ResourceTopologyChipItem,
              ): boolean => {
                return !found.has(item.id);
              },
            ),
          };
        })
        .filter((group: ResourceTopologyGroupItem): boolean => {
          return group.items.length > 0 || group.more !== null;
        }),
    },
    left: pick(lanes?.left || []),
    right: pick(lanes?.right || []),
  };
}

function cellsOf(group: ResourceTopologyGroupItem): Array<Cell> {
  const cells: Array<Cell> = [];

  for (const item of group.items) {
    if (item.type === "card") {
      cells.push({ type: "card", card: item });
    } else {
      cells.push({ type: "chip", chip: item });
    }
  }

  if (group.more) {
    cells.push({ type: "more", more: group.more });
  }

  return cells;
}

function nodeIdsOfCell(cell: Cell): Array<string> {
  if (cell.type === "card") {
    return [cell.card.nodeId];
  }

  if (cell.type === "chip") {
    return [cell.chip.nodeId];
  }

  return [];
}

/*
 * Where a column starts: the resource's own parts just in from its edge,
 * under it, and every further level a card and a gap to the side.
 */
export function getTopologyColumnX(depth: number): number {
  if (depth <= 0) {
    return 0;
  }

  return SIZES.rootIndent + (depth - 1) * (SIZES.cardWidth + SIZES.columnGap);
}

/*
 * Lays the tree out once, for rows of at most `rowLength` parts, from the
 * resource at the top. Returns what it placed and the lines between.
 */
function layoutTree(top: ResourceTopologyCardItem, rowLength: number): Draft {
  const placed: Array<ResourceTopologyPlaced> = [];
  const branches: Array<ResourceTopologyBranch> = [];
  const columnX: (depth: number) => number = getTopologyColumnX;

  const placeCell: (
    cell: Cell,
    x: number,
    y: number,
    depth: number,
    parentId: string,
  ) => number = (
    cell: Cell,
    x: number,
    y: number,
    depth: number,
    parentId: string,
  ): number => {
    if (cell.type === "card") {
      return placeCard(cell.card, depth, y, parentId, x);
    }

    if (cell.type === "chip") {
      placed.push({
        id: cell.chip.id,
        kind: "chip",
        x: x,
        y: y,
        width: CHIP_SIZE.width,
        height: CHIP_SIZE.height,
        depth: depth,
        parentId: parentId,
        chip: cell.chip,
      });

      return y + CHIP_SIZE.height;
    }

    const size: Size = moreSize(cell.more);
    placed.push({
      id: cell.more.id,
      kind: "more",
      x: x,
      y: y,
      width: size.width,
      height: size.height,
      depth: depth,
      parentId: parentId,
      more: cell.more,
    });

    return y + size.height;
  };

  const cellSize: (cell: Cell) => Size = (cell: Cell): Size => {
    if (cell.type === "card") {
      return getCardSize(cell.card, { isRoot: false });
    }

    if (cell.type === "chip") {
      return CHIP_SIZE;
    }

    return moreSize(cell.more);
  };

  /*
   * A card, and when it is open everything it holds, from `y` down. Returns
   * where its part of the drawing ends.
   */
  function placeCard(
    card: ResourceTopologyCardItem,
    depth: number,
    y: number,
    parentId: string | null,
    x: number = columnX(depth),
  ): number {
    const size: Size = getCardSize(card, { isRoot: depth === 0 });

    placed.push({
      id: card.id,
      kind: "card",
      x: x,
      y: y,
      width: size.width,
      height: size.height,
      depth: depth,
      parentId: parentId,
      card: card,
    });

    if (!card.isOpen || card.groups.length === 0) {
      return y + size.height;
    }

    /*
     * A line from the part to each of its groups: out of its edge at its
     * middle, along to the spine, down it and into the group. The resource
     * is the exception: its parts are under it, and its line drops from its
     * bottom.
     */
    const isTop: boolean = depth === 0;
    const middle: number = y + size.height / 2;
    const edge: number = x + size.width;
    const spineX: number = isTop
      ? x + SIZES.rootSpineX
      : edge + SIZES.spineOffset;
    const childX: number = columnX(depth + 1);
    let cursor: number = isTop
      ? y + size.height + SIZES.rootGap
      : middle + SIZES.drop;
    const lineTo: (targetY: number) => Array<[number, number]> = (
      targetY: number,
    ): Array<[number, number]> => {
      if (isTop) {
        return [
          [spineX, y + size.height],
          [spineX, targetY],
          [childX, targetY],
        ];
      }

      return [
        [edge, middle],
        [spineX, middle],
        [spineX, targetY],
        [childX, targetY],
      ];
    };

    card.groups.forEach((group: ResourceTopologyGroupItem, index: number) => {
      if (index > 0) {
        cursor += SIZES.groupGap;
      }

      const cells: Array<Cell> = cellsOf(group);
      const isSectionGroup: boolean = group.kind === SECTION_KIND;

      /*
       * A group of sections has no heading: each section is its own, and
       * the line runs to each one.
       */
      if (isSectionGroup) {
        cells.forEach((cell: Cell, cellIndex: number) => {
          if (cellIndex > 0) {
            cursor += SIZES.itemGap;
          }

          const cellTop: number = cursor;
          const size: Size = cellSize(cell);
          const bottom: number = placeCell(
            cell,
            childX,
            cellTop,
            depth + 1,
            card.nodeId,
          );
          const target: string =
            cell.type === "card"
              ? cell.card.id
              : cell.type === "chip"
                ? cell.chip.id
                : cell.more.id;

          branches.push({
            id: `branch:${card.id}->${target}`,
            from: card.id,
            to: target,
            fromNodeId: card.nodeId,
            nodeIds: nodeIdsOfCell(cell),
            points: lineTo(cellTop + size.height / 2),
          });
          cursor = bottom;
        });

        return;
      }

      const headingTop: number = cursor;
      const heading: ResourceTopologyPlaced = {
        id: group.id,
        kind: "heading",
        x: childX,
        y: headingTop,
        width: SIZES.headingMinWidth,
        height: SIZES.headingHeight,
        depth: depth + 1,
        parentId: card.nodeId,
        heading: { group: group },
      };
      placed.push(heading);
      cursor += SIZES.headingHeight + SIZES.headingGap;

      /*
       * Closed parts flow into rows; an open part stands alone, with its
       * own parts after it, and the rows go on below what it holds.
       */
      let blockWidth: number = 0;
      let row: Array<Cell> = [];

      const flushRow: () => void = (): void => {
        if (row.length === 0) {
          return;
        }

        let rowHeight: number = 0;
        let cellX: number = childX;
        // A part that opens has its toggle on its edge: keep the next clear of it.
        const gap: number = row.some((cell: Cell): boolean => {
          return cell.type === "card" && cell.card.canOpen;
        })
          ? SIZES.toggleGap
          : SIZES.itemGap;

        for (const cell of row) {
          const size: Size = cellSize(cell);
          placeCell(cell, cellX, cursor, depth + 1, card.nodeId);
          cellX += size.width + gap;
          rowHeight = Math.max(rowHeight, size.height);
        }

        blockWidth = Math.max(blockWidth, cellX - gap - childX);
        cursor += rowHeight + SIZES.itemGap;
        row = [];
      };

      const closedRun: Array<Cell> = [];
      const flushRun: () => void = (): void => {
        if (closedRun.length === 0) {
          return;
        }

        const perRow: number = getRowLength(closedRun.length, rowLength);

        for (const cell of closedRun) {
          row.push(cell);

          if (row.length >= perRow) {
            flushRow();
          }
        }

        flushRow();
        closedRun.length = 0;
      };

      for (const cell of cells) {
        if (cell.type === "card" && cell.card.isOpen) {
          flushRun();
          const bottom: number = placeCard(
            cell.card,
            depth + 1,
            cursor,
            card.nodeId,
          );
          blockWidth = Math.max(blockWidth, SIZES.cardWidth);
          cursor = bottom + SIZES.itemGap;
          continue;
        }

        closedRun.push(cell);
      }

      flushRun();
      cursor -= SIZES.itemGap;
      heading.width = Math.max(SIZES.headingMinWidth, blockWidth);

      branches.push({
        id: `branch:${card.id}->${group.id}`,
        from: card.id,
        to: group.id,
        fromNodeId: card.nodeId,
        nodeIds: [...group.memberIds],
        points: lineTo(headingTop + SIZES.headingHeight / 2),
      });
    });

    return Math.max(y + size.height, cursor);
  }

  placeCard(top, 0, 0, null);

  return { placed: placed, branches: branches };
}

/*
 * What to frame when a part opens: the part and everything placed straight
 * under it - its groups' headings, its parts and its "+ N more" - so the
 * parts that just appeared are on screen with it, not cut off at the edge.
 */
export function getTopologyFrameIds(
  layout: Pick<ResourceTopologyLayout, "placed">,
  nodeIds: ReadonlyArray<string>,
): Array<string> {
  const wanted: Set<string> = new Set<string>(nodeIds);
  const ids: Array<string> = [];

  for (const item of layout.placed) {
    const nodeId: string | null =
      item.card?.nodeId || item.chip?.nodeId || null;

    if (
      (nodeId !== null && wanted.has(nodeId) && item.kind !== "related") ||
      (item.parentId !== null && wanted.has(item.parentId) && !item.lane)
    ) {
      ids.push(item.id);
    }
  }

  return ids;
}

/* The right edge of what is placed, and the bottom. */
function extentOf(placed: Array<ResourceTopologyPlaced>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX: number = Number.POSITIVE_INFINITY;
  let minY: number = Number.POSITIVE_INFINITY;
  let maxX: number = Number.NEGATIVE_INFINITY;
  let maxY: number = Number.NEGATIVE_INFINITY;

  for (const item of placed) {
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + item.width);
    maxY = Math.max(maxY, item.y + item.height);
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
}

/*
 * A lane: its section's name over its parts, each part lined up with the
 * parts it is related to where it can be, the rest in order after them.
 */
function placeLane(
  section: ResourceTopologyCardItem,
  side: ResourceTopologyLaneSide,
  x: number,
  draft: Draft,
  relations: ReadonlyArray<ResourceTopologyLayoutRelation>,
): void {
  const centreOf: Map<string, number> = new Map<string, number>();

  for (const item of draft.placed) {
    const nodeId: string | undefined =
      item.card?.nodeId || item.chip?.nodeId || undefined;

    if (nodeId && !item.lane) {
      centreOf.set(nodeId, item.y + item.height / 2);
    }
  }

  const cells: Array<Cell> = section.isOpen
    ? section.groups.flatMap(cellsOf)
    : [{ type: "card", card: section }];

  // Where each part would like to stand: level with what it is related to.
  const wanted: Array<{ cell: Cell; centre: number | null; order: number }> =
    cells.map((cell: Cell, order: number) => {
      const ids: Array<string> = nodeIdsOfCell(cell);
      const centres: Array<number> = [];

      for (const relation of relations) {
        const other: string | null = ids.includes(relation.from)
          ? relation.to
          : ids.includes(relation.to)
            ? relation.from
            : null;
        const centre: number | undefined = other
          ? centreOf.get(other)
          : undefined;

        if (centre !== undefined) {
          centres.push(centre);
        }
      }

      return {
        cell: cell,
        centre:
          centres.length > 0
            ? centres.reduce((sum: number, value: number): number => {
                return sum + value;
              }, 0) / centres.length
            : null,
        order: order,
      };
    });

  wanted.sort(
    (
      a: { centre: number | null; order: number },
      b: { centre: number | null; order: number },
    ): number => {
      if (a.centre !== null && b.centre !== null && a.centre !== b.centre) {
        return a.centre - b.centre;
      }

      if (a.centre === null && b.centre !== null) {
        return 1;
      }

      if (a.centre !== null && b.centre === null) {
        return -1;
      }

      return a.order - b.order;
    },
  );

  const sizeOf: (cell: Cell) => Size = (cell: Cell): Size => {
    if (cell.type === "card") {
      return getCardSize(cell.card, { isRoot: false });
    }

    return cell.type === "chip" ? CHIP_SIZE : moreSize(cell.more);
  };

  const firstCentre: number | null = wanted[0]?.centre ?? null;
  const firstHeight: number = wanted[0] ? sizeOf(wanted[0].cell).height : 0;
  const headingTop: number =
    firstCentre !== null
      ? firstCentre - firstHeight / 2 - SIZES.headingGap - SIZES.headingHeight
      : 0;

  if (section.isOpen) {
    draft.placed.push({
      id: section.id,
      kind: "heading",
      x: x,
      y: headingTop,
      width: SIZES.cardWidth,
      height: SIZES.headingHeight,
      depth: 1,
      parentId: null,
      lane: side,
      heading: {
        laneSectionId: section.nodeId,
        laneCount: section.groups.reduce(
          (sum: number, group: ResourceTopologyGroupItem): number => {
            return sum + group.total;
          },
          0,
        ),
      },
    });
  }

  let floor: number = section.isOpen
    ? headingTop + SIZES.headingHeight + SIZES.headingGap
    : headingTop;

  for (const entry of wanted) {
    const size: Size = sizeOf(entry.cell);
    const y: number = Math.max(
      floor,
      entry.centre !== null ? entry.centre - size.height / 2 : floor,
    );
    const cell: Cell = entry.cell;

    if (cell.type === "card") {
      draft.placed.push({
        id: cell.card.id,
        kind: "card",
        x: x,
        y: y,
        width: size.width,
        height: size.height,
        depth: 1,
        parentId: section.isOpen ? section.nodeId : null,
        lane: side,
        card: cell.card,
      });
    } else if (cell.type === "chip") {
      draft.placed.push({
        id: cell.chip.id,
        kind: "chip",
        x: x,
        y: y,
        width: size.width,
        height: size.height,
        depth: 1,
        parentId: section.nodeId,
        lane: side,
        chip: cell.chip,
      });
    } else {
      draft.placed.push({
        id: cell.more.id,
        kind: "more",
        x: x,
        y: y,
        width: size.width,
        height: size.height,
        depth: 1,
        parentId: section.nodeId,
        lane: side,
        more: cell.more,
      });
    }

    floor = y + size.height + SIZES.itemGap;
  }
}

/*
 * What a focused part is related to: a column after the drawing, one
 * heading per kind of relation ("Runs here · 12") over small cards, level
 * with the focused part, so a node running a dozen pods is drawn at a
 * readable zoom and the lines to them need no words of their own.
 */
function placeRelated(visible: ResourceTopologyVisible, draft: Draft): void {
  if (visible.related.length === 0) {
    return;
  }

  const extent: { maxX: number } = extentOf(draft.placed);
  const focus: ResourceTopologyPlaced | undefined = draft.placed.find(
    (item: ResourceTopologyPlaced): boolean => {
      return item.id === visible.focusId;
    },
  );
  const columnX: number = extent.maxX + SIZES.relatedGap;
  const groups: Map<string, Array<ResourceTopologyRelatedItem>> = new Map<
    string,
    Array<ResourceTopologyRelatedItem>
  >();
  let rowY: number = focus ? focus.y : 0;

  for (const related of visible.related) {
    const group: Array<ResourceTopologyRelatedItem> =
      groups.get(related.label) || [];

    group.push(related);
    groups.set(related.label, group);
  }

  for (const [label, members] of groups) {
    draft.placed.push({
      id: `related-caption:${label}`,
      kind: "relatedCaption",
      x: columnX,
      y: rowY,
      width: SIZES.relatedWidth,
      height: SIZES.captionHeight,
      depth: 0,
      parentId: null,
      relatedCaption: { label: label, count: members.length },
    });
    rowY += SIZES.captionHeight;

    for (const related of members) {
      draft.placed.push({
        id: related.nodeId,
        kind: "related",
        x: columnX,
        y: rowY,
        width: SIZES.relatedWidth,
        height: SIZES.relatedHeight,
        depth: 0,
        parentId: null,
        related: related,
      });
      rowY += SIZES.relatedHeight + SIZES.itemGap;
    }

    rowY += SIZES.groupGap - SIZES.itemGap;
  }
}

/*
 * How well a drawing fits a canvas of this shape: the zoom it is framed at
 * on a canvas one unit tall. Larger is better.
 */
function fitScore(width: number, height: number, aspect: number): number {
  if (width <= 0 || height <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.min(aspect / width, 1 / height);
}

export function layoutResourceTopology(
  visible: ResourceTopologyVisible,
  options: ResourceTopologyLayoutOptions = { aspect: 1.8 },
): ResourceTopologyLayout {
  const split: {
    top: ResourceTopologyCardItem;
    left: Array<ResourceTopologyCardItem>;
    right: Array<ResourceTopologyCardItem>;
  } = splitLanes(visible.top, options.lanes);
  const relations: ReadonlyArray<ResourceTopologyLayoutRelation> =
    options.relations || [];

  const build: (rowLength: number) => Draft = (rowLength: number): Draft => {
    const draft: Draft = layoutTree(split.top, rowLength);
    const tree: { maxX: number } = extentOf(draft.placed);
    let laneX: number = tree.maxX + SIZES.laneGap;

    for (const section of split.right) {
      placeLane(section, "end", laneX, draft, relations);
      laneX += SIZES.cardWidth + SIZES.columnGap;
    }

    let leftX: number = -(SIZES.cardWidth + SIZES.laneGap);

    for (const section of split.left) {
      placeLane(section, "start", leftX, draft, relations);
      leftX -= SIZES.cardWidth + SIZES.columnGap;
    }

    placeRelated(visible, draft);

    return draft;
  };

  // The row length whose drawing fits the canvas at the largest zoom.
  let best: Draft | null = null;
  let bestRowLength: number = 1;
  let bestScore: number = Number.NEGATIVE_INFINITY;
  const tried: ReadonlyArray<number> =
    options.rowLength !== undefined && options.rowLength >= 1
      ? [Math.floor(options.rowLength)]
      : ROW_LENGTHS_TRIED;

  for (const rowLength of tried) {
    const draft: Draft = build(rowLength);
    const extent: { minX: number; minY: number; maxX: number; maxY: number } =
      extentOf(draft.placed);
    const score: number = fitScore(
      extent.maxX - extent.minX,
      extent.maxY - extent.minY,
      options.aspect,
    );

    if (score > bestScore + 1e-9) {
      best = draft;
      bestRowLength = rowLength;
      bestScore = score;
    }
  }

  const draft: Draft = best || build(bestRowLength);
  const extent: { minX: number; minY: number; maxX: number; maxY: number } =
    extentOf(draft.placed);
  const width: number = extent.maxX - extent.minX;
  const height: number = extent.maxY - extent.minY;
  const direction: ResourceTopologyDirection = options.direction || "ltr";
  const moveX: (x: number, itemWidth: number) => number = (
    x: number,
    itemWidth: number,
  ): number => {
    const fromStart: number = x - extent.minX;

    return direction === "rtl" ? width - fromStart - itemWidth : fromStart;
  };

  const placed: Array<ResourceTopologyPlaced> = draft.placed.map(
    (item: ResourceTopologyPlaced): ResourceTopologyPlaced => {
      return {
        ...item,
        x: moveX(item.x, item.width),
        y: item.y - extent.minY,
      };
    },
  );
  const branches: Array<ResourceTopologyBranch> = draft.branches.map(
    (branch: ResourceTopologyBranch): ResourceTopologyBranch => {
      return {
        ...branch,
        points: branch.points.map(
          (point: [number, number]): [number, number] => {
            return [moveX(point[0], 0), point[1] - extent.minY];
          },
        ),
      };
    },
  );

  const byId: Map<string, ResourceTopologyPlaced> = new Map<
    string,
    ResourceTopologyPlaced
  >();

  for (const item of placed) {
    byId.set(item.id, item);
  }

  return {
    placed: placed,
    byId: byId,
    branches: branches,
    width: width,
    height: height,
    direction: direction,
    rowLength: bestRowLength,
  };
}
