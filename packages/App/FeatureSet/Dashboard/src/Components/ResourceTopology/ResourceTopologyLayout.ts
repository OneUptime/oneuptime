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
 * heading, and inside it its parts sit in one band per kind ("ESXi Hosts ·
 * 12", "Virtual Machines · 38"), flowing left to right and wrapping. A closed
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
  aspect: number;
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
  minContainerWidth: 320,
  maxContentWidth: 1720,
  aspect: 1.7,
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

interface GroupPlan {
  group: ResourceTopologyGroupItem;
  rows: Array<Row>;
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

export function layoutResourceTopology(
  visible: ResourceTopologyVisible,
): ResourceTopologyLayout {
  const plans: Map<string, BoxPlan> = new Map<string, BoxPlan>();

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
   * hold its groups, as close to SIZES.aspect as its widest part allows.
   */
  function measure(card: ResourceTopologyCardItem): Size {
    if (!card.isOpen || card.groups.length === 0) {
      return CARD_SIZE;
    }

    const groupBlocks: Array<{
      group: ResourceTopologyGroupItem;
      blocks: Array<Block>;
    }> = card.groups.map((group: ResourceTopologyGroupItem) => {
      return { group: group, blocks: blocksOf(group) };
    });

    let area: number = 0;
    let widest: number = 0;

    for (const entry of groupBlocks) {
      area += SIZES.captionHeight * SIZES.maxContentWidth * 0.25;

      for (const block of entry.blocks) {
        area +=
          (block.size.width + SIZES.itemGap) *
          (block.size.height + SIZES.itemGap);
        widest = Math.max(widest, block.size.width);
      }
    }

    const minimumContent: number =
      SIZES.minContainerWidth - 2 * SIZES.padding;
    const contentWidth: number = Math.max(
      widest,
      minimumContent,
      Math.min(SIZES.maxContentWidth, Math.sqrt(area * SIZES.aspect)),
    );

    const groups: Array<GroupPlan> = [];
    let usedWidth: number = minimumContent;
    let y: number = SIZES.headerHeight;

    for (const entry of groupBlocks) {
      const rows: Array<Row> = flowRows(entry.blocks, contentWidth);
      const height: number = SIZES.captionHeight + rowsHeight(rows);

      for (const row of rows) {
        usedWidth = Math.max(usedWidth, row.width);
      }

      groups.push({ group: entry.group, rows: rows, height: height });
      y += height + SIZES.groupGap;
    }

    const size: Size = {
      width: Math.ceil(usedWidth + 2 * SIZES.padding),
      height: Math.ceil(y - SIZES.groupGap + SIZES.padding),
    };

    plans.set(card.id, {
      size: size,
      contentWidth: usedWidth,
      groups: groups,
    });

    return size;
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

    let groupY: number = SIZES.headerHeight;

    for (const groupPlan of plan.groups) {
      captions.push({
        group: groupPlan.group,
        x: SIZES.padding,
        y: groupY,
        width: plan.contentWidth,
      });

      let rowY: number = groupY + SIZES.captionHeight;

      for (const row of groupPlan.rows) {
        for (const entry of row.blocks) {
          const blockX: number = x + SIZES.padding + entry.x;
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

      groupY += groupPlan.height + SIZES.groupGap;
    }
  };

  const topSize: Size = measure(visible.top);
  place(visible.top, 0, 0, 0);

  let width: number = topSize.width;
  let height: number = topSize.height;

  // What a focused part is related to: a column beside the drawing.
  if (visible.related.length > 0) {
    const focus: ResourceTopologyPlaced | undefined = placed.find(
      (item: ResourceTopologyPlaced): boolean => {
        return item.id === visible.focusId;
      },
    );
    const columnX: number = topSize.width + SIZES.relatedGap;
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
