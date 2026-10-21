import { SECTION_KIND } from "./ResourceTopologyKinds";
import {
  ResourceTopologyCardItem,
  ResourceTopologyChipItem,
  ResourceTopologyGroupItem,
  ResourceTopologyMoreItem,
  ResourceTopologyRelatedItem,
  ResourceTopologyVisible,
} from "./ResourceTopologyView";

/*
 * Where everything of a resource topology goes on the map.
 *
 * Containment is drawn as nesting: an open part is a box with its own
 * heading, and inside it its parts sit in one group per kind ("ESXi Hosts ·
 * 12", "Virtual Machines · 38"), flowing left to right and wrapping. Small
 * groups sit side by side — a namespace's one deployment, one StatefulSet
 * and one CronJob make a row, not a tower — and a large group takes the
 * box's whole width. A closed
 * part is a card that says what it holds, and parts that hold nothing are
 * small chips. Nesting reads at a glance — the virtual machines are inside
 * their host, the host inside its cluster — and it stays compact where a
 * tree of lines does not: a level of 40 hosts wraps into rows instead of
 * running ten thousand pixels to the side. Lines are kept for what crosses
 * the tree: a pod running on a node, a service calling a database.
 *
 * Each box is sized from the inside out, aiming for a wider-than-tall shape
 * so a whole resource fits a laptop screen at a readable zoom. Positions are
 * absolute, so every card and chip is a node of its own on the map.
 *
 * A map about calls (a host's) reads left to right: what calls the
 * resource in a column on its left, the resource in the middle, what it
 * calls in a column on its right (`lanes`), so every line runs one way.
 */

export const RESOURCE_TOPOLOGY_SIZES: {
  cardWidth: number;
  cardHeight: number;
  chipWidth: number;
  chipHeight: number;
  headerHeight: number;
  padding: number;
  groupGap: number;
  captionHeight: number;
  itemGap: number;
  minContainerWidth: number;
  maxContentWidth: number;
  relatedGap: number;
} = {
  cardWidth: 248,
  cardHeight: 100,
  chipWidth: 200,
  chipHeight: 48,
  headerHeight: 64,
  padding: 14,
  groupGap: 14,
  captionHeight: 28,
  itemGap: 10,
  minContainerWidth: 276,
  maxContentWidth: 3200,
  relatedGap: 120,
};

const SIZES: typeof RESOURCE_TOPOLOGY_SIZES = RESOURCE_TOPOLOGY_SIZES;

export type ResourceTopologyPlacedKind =
  | "container"
  | "card"
  | "chip"
  | "more"
  | "related";

/* A group's heading inside its box, relative to the box. */
export interface ResourceTopologyCaption {
  group: ResourceTopologyGroupItem;
  x: number;
  y: number;
  width: number;
}

export interface ResourceTopologyPlaced {
  /* The map node's id: the part's id, or the "+ N more" item's. */
  id: string;
  kind: ResourceTopologyPlacedKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /* How many boxes it sits inside: draws boxes under what they hold. */
  depth: number;
  card?: ResourceTopologyCardItem | undefined;
  chip?: ResourceTopologyChipItem | undefined;
  more?: ResourceTopologyMoreItem | undefined;
  related?: ResourceTopologyRelatedItem | undefined;
  /* A box's group headings. */
  captions?: Array<ResourceTopologyCaption> | undefined;
}

export interface ResourceTopologyLayout {
  placed: Array<ResourceTopologyPlaced>;
  byId: Map<string, ResourceTopologyPlaced>;
  width: number;
  height: number;
}

export type ResourceTopologySide = "top" | "right" | "bottom" | "left";

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
 * on whatever the line passes over (a line from a service up to the one it
 * calls crosses its own box's heading); nearer the end it points at, it
 * sits in the gap before that part.
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

interface Size {
  width: number;
  height: number;
}

type Block =
  | { type: "card"; card: ResourceTopologyCardItem; size: Size }
  | { type: "chip"; chip: ResourceTopologyChipItem; size: Size }
  | { type: "more"; more: ResourceTopologyMoreItem; size: Size };

interface Row {
  blocks: Array<{ block: Block; x: number }>;
  width: number;
  height: number;
}

/* A group inside a box: its heading and its rows, as one tile. */
interface GroupPlan {
  group: ResourceTopologyGroupItem;
  rows: Array<Row>;
  /* Relative to the box's content (x) and the box's top (y). */
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BoxPlan {
  size: Size;
  contentWidth: number;
  groups: Array<GroupPlan>;
}

const CARD_SIZE: Size = {
  width: SIZES.cardWidth,
  height: SIZES.cardHeight,
};

const CHIP_SIZE: Size = {
  width: SIZES.chipWidth,
  height: SIZES.chipHeight,
};

/* Fills rows left to right, starting a new row when the next block won't fit. */
function flowRows(blocks: Array<Block>, contentWidth: number): Array<Row> {
  const rows: Array<Row> = [];
  let row: Row = { blocks: [], width: 0, height: 0 };

  for (const block of blocks) {
    const x: number = row.blocks.length === 0 ? 0 : row.width + SIZES.itemGap;

    if (row.blocks.length > 0 && x + block.size.width > contentWidth) {
      rows.push(row);
      row = { blocks: [], width: 0, height: 0 };
    }

    const placedX: number =
      row.blocks.length === 0 ? 0 : row.width + SIZES.itemGap;
    row.blocks.push({ block: block, x: placedX });
    row.width = placedX + block.size.width;
    row.height = Math.max(row.height, block.size.height);
  }

  if (row.blocks.length > 0) {
    rows.push(row);
  }

  return rows;
}

function rowsHeight(rows: Array<Row>): number {
  if (rows.length === 0) {
    return 0;
  }

  return (
    rows.reduce((total: number, row: Row): number => {
      return total + row.height;
    }, 0) +
    (rows.length - 1) * SIZES.itemGap
  );
}

/*
 * A group's heading: "ESXi Hosts 4 · 2 need attention". Sections ("Talks
 * to", "Hardware") are titled by their own box, so their group has none.
 */
export function captionHeightOf(group: ResourceTopologyGroupItem): number {
  return group.kind === SECTION_KIND ? SECTION_GAP : SIZES.captionHeight;
}

const SECTION_GAP: number = 6;

/* The shape (width over height) the boxes inside the drawing aim for. */
export const INNER_ASPECT: number = 2.2;

/* Widths tried per group, at most: enough to find the shape, never slow. */
const MAX_WIDTH_CANDIDATES_PER_GROUP: number = 48;

type GroupBlocks = Array<{
  group: ResourceTopologyGroupItem;
  blocks: Array<Block>;
}>;

/* Between two groups side by side: wider than between two parts of one. */
export const GROUP_SIDE_GAP: number = 28;

/*
 * A box's groups packed at one content width. Each group is a tile — its
 * heading over its rows — and the tiles flow left to right like the parts
 * inside them, wrapping when the next one won't fit.
 */
function packBox(groupBlocks: GroupBlocks, contentWidth: number): BoxPlan {
  const minimumContent: number = SIZES.minContainerWidth - 2 * SIZES.padding;
  const groups: Array<GroupPlan> = [];
  let usedWidth: number = minimumContent;
  let lineY: number = SIZES.headerHeight;
  let lineWidth: number = 0;
  let lineHeight: number = 0;

  for (const entry of groupBlocks) {
    const rows: Array<Row> = flowRows(entry.blocks, contentWidth);
    let width: number = 0;

    for (const row of rows) {
      width = Math.max(width, row.width);
    }

    const height: number = captionHeightOf(entry.group) + rowsHeight(rows);
    let x: number = lineWidth === 0 ? 0 : lineWidth + GROUP_SIDE_GAP;

    if (lineWidth > 0 && x + width > contentWidth) {
      lineY += lineHeight + SIZES.groupGap;
      lineWidth = 0;
      lineHeight = 0;
      x = 0;
    }

    groups.push({
      group: entry.group,
      rows: rows,
      x: x,
      y: lineY,
      width: width,
      height: height,
    });
    lineWidth = x + width;
    lineHeight = Math.max(lineHeight, height);
    usedWidth = Math.max(usedWidth, lineWidth);
  }

  return {
    size: {
      width: Math.ceil(usedWidth + 2 * SIZES.padding),
      height: Math.ceil(lineY + lineHeight + SIZES.padding),
    },
    contentWidth: usedWidth,
    groups: groups,
  };
}

/*
 * What else shares the drawing's shape with a box: the lanes beside the
 * top box add their width, and the drawing is at least as tall as they are.
 */
interface BoxSurroundings {
  extraWidth: number;
  minHeight: number;
}

/*
 * The content width whose packing comes closest to `aspect`. The widths
 * worth trying are where a row would break: each part on its own, the width
 * of each group's first one, two, three ... parts side by side, and the
 * width of the first one, two, three ... whole groups side by side.
 */
function planBox(
  groupBlocks: GroupBlocks,
  aspect: number,
  surroundings: BoxSurroundings = { extraWidth: 0, minHeight: 0 },
): BoxPlan {
  const minimumContent: number = SIZES.minContainerWidth - 2 * SIZES.padding;
  const candidates: Set<number> = new Set<number>([minimumContent]);
  let groupsWidth: number = 0;

  groupBlocks.forEach((entry: GroupBlocks[number], groupIndex: number) => {
    let width: number = 0;

    entry.blocks
      .slice(0, MAX_WIDTH_CANDIDATES_PER_GROUP)
      .forEach((block: Block, index: number) => {
        width += (index > 0 ? SIZES.itemGap : 0) + block.size.width;
        candidates.add(width);
      });

    for (const block of entry.blocks) {
      candidates.add(block.size.width);
    }

    groupsWidth += (groupIndex > 0 ? GROUP_SIDE_GAP : 0) + width;
    candidates.add(groupsWidth);
  });

  let best: BoxPlan | null = null;
  let bestScore: number = Number.POSITIVE_INFINITY;
  const widths: Array<number> = Array.from(candidates).sort(
    (a: number, b: number): number => {
      return a - b;
    },
  );

  for (const width of widths) {
    if (width < minimumContent || width > SIZES.maxContentWidth) {
      continue;
    }

    const plan: BoxPlan = packBox(groupBlocks, width);
    const drawnWidth: number = plan.size.width + surroundings.extraWidth;
    const drawnHeight: number = Math.max(
      plan.size.height,
      surroundings.minHeight,
    );
    const score: number = Math.abs(Math.log(drawnWidth / drawnHeight / aspect));

    if (score < bestScore - 1e-9) {
      best = plan;
      bestScore = score;
    }
  }

  return best || packBox(groupBlocks, SIZES.maxContentWidth);
}

/* Parts of the top drawn beside it rather than inside it. */
export interface ResourceTopologyLanes {
  /* What calls the resource: a column on its left. */
  left: Array<string>;
  /* What the resource calls: a column on its right. */
  right: Array<string>;
}

export interface ResourceTopologyLayoutOptions {
  /* The shape the whole drawing aims for: the canvas's. */
  aspect: number;
  lanes?: ResourceTopologyLanes | undefined;
}

/* Between a lane and the top box: room for the lines' labels. */
export const LANE_GAP: number = 88;
/* A lane is a column: its boxes aim tall rather than wide. */
export const LANE_ASPECT: number = 0.75;

/*
 * The top without the parts that go in its lanes, and those parts, in the
 * lanes' order. Only cards in the top's own groups can go in a lane.
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
    return ids
      .map((id: string): ResourceTopologyCardItem | undefined => {
        return found.get(id);
      })
      .filter((item: ResourceTopologyCardItem | undefined): boolean => {
        return item !== undefined;
      }) as Array<ResourceTopologyCardItem>;
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

export function layoutResourceTopology(
  visible: ResourceTopologyVisible,
  options: ResourceTopologyLayoutOptions = { aspect: 1.8 },
): ResourceTopologyLayout {
  const plans: Map<string, BoxPlan> = new Map<string, BoxPlan>();
  const split: {
    top: ResourceTopologyCardItem;
    left: Array<ResourceTopologyCardItem>;
    right: Array<ResourceTopologyCardItem>;
  } = splitLanes(visible.top, options.lanes);
  const top: ResourceTopologyCardItem = split.top;
  const laneItems: Set<ResourceTopologyCardItem> =
    new Set<ResourceTopologyCardItem>([...split.left, ...split.right]);
  let surroundings: BoxSurroundings = { extraWidth: 0, minHeight: 0 };

  const blocksOf: (group: ResourceTopologyGroupItem) => Array<Block> = (
    group: ResourceTopologyGroupItem,
  ): Array<Block> => {
    const blocks: Array<Block> = [];

    for (const item of group.items) {
      if (item.type === "chip") {
        blocks.push({ type: "chip", chip: item, size: CHIP_SIZE });
      } else {
        blocks.push({ type: "card", card: item, size: measure(item) });
      }
    }

    if (group.more) {
      blocks.push({
        type: "more",
        more: group.more,
        size: group.more.asChip ? CHIP_SIZE : CARD_SIZE,
      });
    }

    return blocks;
  };

  /*
   * A card's size: a closed card is fixed; an open one is a box sized to
   * hold its groups, shaped as close to the target as its parts allow — the
   * canvas's shape for the whole drawing, INNER_ASPECT for the boxes in it.
   */
  function measure(card: ResourceTopologyCardItem): Size {
    // The top stays a box when all it holds went to its lanes.
    if (!card.isOpen || (card.groups.length === 0 && card !== top)) {
      return CARD_SIZE;
    }

    const groupBlocks: Array<{
      group: ResourceTopologyGroupItem;
      blocks: Array<Block>;
    }> = card.groups.map((group: ResourceTopologyGroupItem) => {
      return { group: group, blocks: blocksOf(group) };
    });

    const plan: BoxPlan =
      card === top
        ? planBox(groupBlocks, options.aspect, surroundings)
        : planBox(
            groupBlocks,
            laneItems.has(card) ? LANE_ASPECT : INNER_ASPECT,
          );

    plans.set(card.id, plan);

    return plan.size;
  }

  const placed: Array<ResourceTopologyPlaced> = [];

  const place: (
    card: ResourceTopologyCardItem,
    x: number,
    y: number,
    depth: number,
  ) => void = (
    card: ResourceTopologyCardItem,
    x: number,
    y: number,
    depth: number,
  ): void => {
    const plan: BoxPlan | undefined = plans.get(card.id);

    if (!plan) {
      placed.push({
        id: card.id,
        kind: "card",
        x: x,
        y: y,
        width: CARD_SIZE.width,
        height: CARD_SIZE.height,
        depth: depth,
        card: card,
      });
      return;
    }

    const captions: Array<ResourceTopologyCaption> = [];
    placed.push({
      id: card.id,
      kind: "container",
      x: x,
      y: y,
      width: plan.size.width,
      height: plan.size.height,
      depth: depth,
      card: card,
      captions: captions,
    });

    for (const groupPlan of plan.groups) {
      /*
       * A group alone on its line is headed across the box; one beside
       * others, across its own parts.
       */
      const alone: boolean = !plan.groups.some((other: GroupPlan): boolean => {
        return other !== groupPlan && other.y === groupPlan.y;
      });

      captions.push({
        group: groupPlan.group,
        x: SIZES.padding + groupPlan.x,
        y: groupPlan.y,
        width: alone ? plan.contentWidth : groupPlan.width,
      });

      let rowY: number = groupPlan.y + captionHeightOf(groupPlan.group);

      for (const row of groupPlan.rows) {
        for (const entry of row.blocks) {
          const blockX: number = x + SIZES.padding + groupPlan.x + entry.x;
          const blockY: number = y + rowY;

          if (entry.block.type === "card") {
            place(entry.block.card, blockX, blockY, depth + 1);
          } else if (entry.block.type === "chip") {
            placed.push({
              id: entry.block.chip.id,
              kind: "chip",
              x: blockX,
              y: blockY,
              width: CHIP_SIZE.width,
              height: CHIP_SIZE.height,
              depth: depth + 1,
              chip: entry.block.chip,
            });
          } else {
            placed.push({
              id: entry.block.more.id,
              kind: "more",
              x: blockX,
              y: blockY,
              width: entry.block.size.width,
              height: entry.block.size.height,
              depth: depth + 1,
              more: entry.block.more,
            });
          }
        }

        rowY += row.height + SIZES.itemGap;
      }
    }
  };

  // The lanes first: the top box is shaped around them.
  const measureLane: (lane: Array<ResourceTopologyCardItem>) => {
    sizes: Array<Size>;
    width: number;
    height: number;
  } = (
    lane: Array<ResourceTopologyCardItem>,
  ): { sizes: Array<Size>; width: number; height: number } => {
    const sizes: Array<Size> = lane.map(
      (card: ResourceTopologyCardItem): Size => {
        return measure(card);
      },
    );

    return {
      sizes: sizes,
      width: sizes.reduce((widest: number, size: Size): number => {
        return Math.max(widest, size.width);
      }, 0),
      height:
        sizes.reduce((total: number, size: Size): number => {
          return total + size.height;
        }, 0) +
        Math.max(0, sizes.length - 1) * SIZES.groupGap,
    };
  };

  const leftLane: { sizes: Array<Size>; width: number; height: number } =
    measureLane(split.left);
  const rightLane: { sizes: Array<Size>; width: number; height: number } =
    measureLane(split.right);
  const leftSpace: number =
    split.left.length > 0 ? leftLane.width + LANE_GAP : 0;
  const rightSpace: number =
    split.right.length > 0 ? rightLane.width + LANE_GAP : 0;

  surroundings = {
    extraWidth: leftSpace + rightSpace,
    minHeight: Math.max(leftLane.height, rightLane.height),
  };

  const topSize: Size = measure(top);
  const drawingHeight: number = Math.max(
    topSize.height,
    leftLane.height,
    rightLane.height,
  );

  place(top, leftSpace, (drawingHeight - topSize.height) / 2, 0);

  const placeLane: (
    lane: Array<ResourceTopologyCardItem>,
    sizes: { sizes: Array<Size>; height: number },
    x: number,
  ) => void = (
    lane: Array<ResourceTopologyCardItem>,
    sizes: { sizes: Array<Size>; height: number },
    x: number,
  ): void => {
    let laneY: number = (drawingHeight - sizes.height) / 2;

    lane.forEach((card: ResourceTopologyCardItem, index: number) => {
      place(card, x, laneY, 0);
      laneY += sizes.sizes[index]!.height + SIZES.groupGap;
    });
  };

  placeLane(split.left, leftLane, 0);
  placeLane(split.right, rightLane, leftSpace + topSize.width + LANE_GAP);

  let width: number = leftSpace + topSize.width + rightSpace;
  let height: number = drawingHeight;

  // What a focused part is related to: a column beside the drawing.
  if (visible.related.length > 0) {
    const focus: ResourceTopologyPlaced | undefined = placed.find(
      (item: ResourceTopologyPlaced): boolean => {
        return item.id === visible.focusId;
      },
    );
    const columnX: number = width + SIZES.relatedGap;
    let rowY: number = focus ? focus.y : 0;

    for (const related of visible.related) {
      placed.push({
        id: related.nodeId,
        kind: "related",
        x: columnX,
        y: rowY,
        width: CARD_SIZE.width,
        height: CARD_SIZE.height,
        depth: 0,
        related: related,
      });
      rowY += CARD_SIZE.height + SIZES.itemGap;
    }

    width = columnX + CARD_SIZE.width;
    height = Math.max(height, rowY - SIZES.itemGap);
  }

  const byId: Map<string, ResourceTopologyPlaced> = new Map<
    string,
    ResourceTopologyPlaced
  >();

  for (const item of placed) {
    byId.set(item.id, item);
  }

  return { placed: placed, byId: byId, width: width, height: height };
}
