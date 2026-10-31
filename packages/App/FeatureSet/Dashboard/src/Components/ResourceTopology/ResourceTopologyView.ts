import {
  ResourceTopologyGraph,
  ResourceTopologyNeighbour,
  ResourceTopologyNode,
  getOwnTopologySearchMatches,
  getTopologyAncestors,
  getTopologyNeighbours,
  searchTopology,
} from "./ResourceTopologyModel";
import { getResourceTopologyKind } from "./ResourceTopologyKinds";

/*
 * What a resource topology shows right now: which parts are open, which are
 * folded into "+ 32 more", and what a filter, a search or a focus leaves in.
 *
 * A real estate is far too large to draw at once — a vCenter with 4,000
 * virtual machines, a cluster with 6,000 pods — and a drawing of all of it
 * is unreadable long before it is slow. So the view follows four rules:
 *
 *   1. Open the way to what needs attention, only as deep as fits. The
 *      resource opens level by level until the next level would put more on
 *      screen than a person can read (VIEW_BUDGET), and below it only the
 *      parts with something that needs attention inside open by themselves
 *      (and a part that is the only one where it sits): a healthy branch
 *      stays one closed card that says what it holds, "14 virtual machines",
 *      and a troubled one opens down to the trouble.
 *   2. Show a few of each kind, troubled ones first. An open part shows its
 *      parts grouped by kind, and each group shows the first few
 *      (CARD_PREVIEW cards, or CHIP_PREVIEW small chips for parts that hold
 *      nothing) and folds the rest into one "+ N more" that says how many of
 *      those need attention. Siblings are ordered with what needs attention
 *      first, so a problem is never the thing that is folded away.
 *   3. Filter, search and focus narrow the drawing to a path. "Needs
 *      attention" keeps the troubled parts and the path to them, a search
 *      keeps what matches and the path to it, and a focus keeps one part's
 *      lineage, everything inside it and what it is related to.
 *   4. A part someone went to (a search result opened, a link followed, a
 *      related part clicked) is pinned: it is shown even when its group is
 *      folded, and every part above it is opened.
 *
 * Pure and free of React, like the model, so the App suite can check every
 * rule against an estate of any size.
 */

export type ResourceTopologyFilter = "all" | "attention";

export interface ResourceTopologyViewState {
  /* Parts the person opened; they stay open whatever the automatic depth. */
  opened: ReadonlySet<string>;
  /* Parts the person closed; they stay closed. */
  closed: ReadonlySet<string>;
  /* Groups shown in full rather than as a preview: groupKey(parent, kind). */
  shownInFull: ReadonlySet<string>;
  /* Parts someone went to: always shown, with every part above them open. */
  pinned: ReadonlySet<string>;
  filter: ResourceTopologyFilter;
  search: string;
  /* The part the drawing is narrowed to, or null for the whole resource. */
  focusId: string | null;
}

export function createResourceTopologyViewState(
  overrides?: Partial<ResourceTopologyViewState> | undefined,
): ResourceTopologyViewState {
  return {
    opened: new Set<string>(),
    closed: new Set<string>(),
    shownInFull: new Set<string>(),
    pinned: new Set<string>(),
    filter: "all",
    search: "",
    focusId: null,
    ...(overrides || {}),
  };
}

/* How much the automatic depth may put on screen, in cards (a chip is half). */
export const VIEW_BUDGET: number = 28;
/*
 * What may open along with a part someone opens: less than the whole first
 * view, so the part fills the screen readably — a namespace opens with its
 * workloads' pods, a cluster of hosts with its hosts closed.
 */
export const OPEN_BUDGET: number = 14;
/* Cards of one kind shown before the rest fold into "+ N more". */
export const CARD_PREVIEW: number = 8;
/* Chips of one kind shown before the rest fold into "+ N more". */
export const CHIP_PREVIEW: number = 12;
/* The same two while a filter or a search narrows the drawing. */
export const CARD_PREVIEW_NARROWED: number = 16;
export const CHIP_PREVIEW_NARROWED: number = 24;
/* Most of one kind ever drawn at once, even shown in full. */
export const CARD_FULL_LIMIT: number = 200;
export const CHIP_FULL_LIMIT: number = 400;
/* Parts that hold nothing are chips once there are at least this many. */
export const CHIP_MINIMUM: number = 3;
/* Related parts drawn beside a focused part. */
export const RELATED_LIMIT: number = 12;

export function groupKey(parentId: string, kind: string): string {
  return `${parentId}|${kind}`;
}

export interface ResourceTopologyCardItem {
  type: "card";
  /* The part's id: one card per part. */
  id: string;
  nodeId: string;
  /* Its parts are drawn inside it. */
  isOpen: boolean;
  /* It holds parts this view could show. */
  canOpen: boolean;
  isMatch: boolean;
  isFocus: boolean;
  /* A part with no record of its own, that only groups others ("Hardware"). */
  isSection: boolean;
  /* When open: its parts, one group per kind. */
  groups: Array<ResourceTopologyGroupItem>;
}

export interface ResourceTopologyChipItem {
  type: "chip";
  id: string;
  nodeId: string;
  isMatch: boolean;
}

export interface ResourceTopologyMoreItem {
  type: "more";
  id: string;
  parentId: string;
  kind: string;
  groupKey: string;
  /* Sized as a chip (in a group of chips) or as a card. */
  asChip: boolean;
  hiddenCount: number;
  hiddenAttention: number;
  /* False when the group is past the most ever drawn at once. */
  canShowAll: boolean;
}

/* The parts of one kind inside an open part. */
export interface ResourceTopologyGroupItem {
  type: "group";
  id: string;
  parentId: string;
  kind: string;
  groupKey: string;
  /* Parts of this kind in this view. */
  total: number;
  attention: number;
  isShownInFull: boolean;
  /* Parts that hold nothing, many of them: drawn small. */
  asChips: boolean;
  items: Array<ResourceTopologyCardItem | ResourceTopologyChipItem>;
  more: ResourceTopologyMoreItem | null;
  /* Every part of the group in this view, drawn or folded away. */
  memberIds: Array<string>;
}

export interface ResourceTopologyRelatedItem {
  nodeId: string;
  label: string;
  direction: "out" | "in";
}

export interface ResourceTopologyVisible {
  top: ResourceTopologyCardItem;
  focusId: string | null;
  /* What the focused part is related to, drawn beside it. */
  related: Array<ResourceTopologyRelatedItem>;
  relatedHidden: number;
  /* Every part drawn, as a card or a chip (related parts included). */
  visibleNodeIds: Set<string>;
  cardCount: number;
  chipCount: number;
  /* Parts a search matched, drawn or not. */
  matchCount: number;
  /* Parts that need attention and are drawn. */
  attentionShown: number;
  /* A filter or a search narrows the drawing. */
  isNarrowed: boolean;
  /* Levels the automatic depth opened, from the top of the drawing. */
  automaticDepth: number;
}

export interface ResourceTopologyViewOptions {
  /* Words a kind is found by (English and the reader's language). */
  kindLabel?: ((kind: string) => Array<string>) | undefined;
  budget?: number | undefined;
  /*
   * Fewer levels than the budget allows, when the canvas cannot show those
   * readably (see ResourceTopologyFit).
   */
  maxAutomaticDepth?: number | undefined;
  /*
   * Parts that are always open: what a lane holds (a host's callers and
   * what it calls) is the lane, never one closed card.
   */
  alwaysOpen?: ReadonlySet<string> | undefined;
  /*
   * Parts always shown, with every part above them open, as if someone had
   * gone to each: the services a host's lanes call or are called by, so
   * every call is drawn. A person can still close a part above one.
   */
  reveal?: ReadonlyArray<string> | undefined;
}

/*
 * Whether a part opens by itself, within the depth that fits: when
 * something inside it needs attention, or when it is the only part where it
 * sits (one datacenter, one Compose project), which would otherwise leave
 * the map a single closed card.
 */
export function opensByItself(
  graph: ResourceTopologyGraph,
  node: ResourceTopologyNode,
): boolean {
  if (node.childIds.length === 0) {
    return false;
  }

  if (node.attentionBelow > 0) {
    return true;
  }

  const parent: ResourceTopologyNode | undefined = node.parentId
    ? graph.nodes.get(node.parentId)
    : undefined;

  return Boolean(parent && parent.childIds.length === 1);
}

interface KindGroup {
  kind: string;
  members: Array<ResourceTopologyNode>;
}

/*
 * Children of one kind together, kinds in the catalog's order, each group
 * keeping the graph's order (what needs attention first, then by name).
 */
function groupByKind(nodes: Array<ResourceTopologyNode>): Array<KindGroup> {
  const groups: Map<string, KindGroup> = new Map<string, KindGroup>();

  for (const node of nodes) {
    const group: KindGroup = groups.get(node.kind) || {
      kind: node.kind,
      members: [],
    };
    group.members.push(node);
    groups.set(node.kind, group);
  }

  return Array.from(groups.values()).sort((a: KindGroup, b: KindGroup) => {
    const byOrder: number =
      getResourceTopologyKind(a.kind).order -
      getResourceTopologyKind(b.kind).order;

    if (byOrder !== 0) {
      return byOrder;
    }

    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });
}

/*
 * Parts that hold nothing are drawn small, as chips, when there are many of
 * them — or when they have no numbers a card would show (a network, a
 * resource pool): a card would only repeat a chip's name and status, larger.
 */
export function drawnAsChips(
  members: Array<ResourceTopologyNode>,
  holdsNothing: (member: ResourceTopologyNode) => boolean,
): boolean {
  if (!members.every(holdsNothing)) {
    return false;
  }

  if (members.length >= CHIP_MINIMUM) {
    return true;
  }

  return members.every((member: ResourceTopologyNode): boolean => {
    return (member.facts || []).length === 0;
  });
}

function childrenOf(
  graph: ResourceTopologyGraph,
  node: ResourceTopologyNode,
): Array<ResourceTopologyNode> {
  const children: Array<ResourceTopologyNode> = [];

  for (const id of node.childIds) {
    const child: ResourceTopologyNode | undefined = graph.nodes.get(id);

    if (child) {
      children.push(child);
    }
  }

  return children;
}

/*
 * What opening `node` puts on screen with nothing narrowed: how much (in
 * cards, a chip counting half and a group's heading half) and which of the
 * cards it shows open by themselves after it (opensByItself).
 */
function previewOf(
  graph: ResourceTopologyGraph,
  node: ResourceTopologyNode,
): { weight: number; openable: Array<ResourceTopologyNode> } {
  let weight: number = 0;
  const openable: Array<ResourceTopologyNode> = [];

  for (const group of groupByKind(childrenOf(graph, node))) {
    const holdsNothing: boolean = group.members.every(
      (member: ResourceTopologyNode): boolean => {
        return member.childIds.length === 0;
      },
    );

    weight += 0.5;

    if (
      holdsNothing &&
      drawnAsChips(group.members, (): boolean => {
        return true;
      })
    ) {
      const chips: number = Math.min(group.members.length, CHIP_PREVIEW);
      const more: number = group.members.length > chips ? 1 : 0;
      weight += (chips + more) / 2;
      continue;
    }

    const cards: Array<ResourceTopologyNode> = group.members.slice(
      0,
      CARD_PREVIEW,
    );
    weight += cards.length + (group.members.length > cards.length ? 1 : 0);

    for (const card of cards) {
      if (opensByItself(graph, card)) {
        openable.push(card);
      }
    }
  }

  return { weight: weight, openable: openable };
}

/*
 * How many levels below `topId` open by themselves: level by level, until
 * opening the next level would put more than `budget` on screen. The top is
 * always open — its groups' previews keep even a huge first level readable.
 */
export function getAutomaticDepth(
  graph: ResourceTopologyGraph,
  topId: string,
  budget: number = VIEW_BUDGET,
): number {
  const top: ResourceTopologyNode | undefined = graph.nodes.get(topId);

  if (!top || top.childIds.length === 0) {
    return 0;
  }

  let level: Array<ResourceTopologyNode> = [top];
  let shown: number = 1;
  let depth: number = 0;

  while (level.length > 0) {
    let added: number = 0;
    const next: Array<ResourceTopologyNode> = [];

    for (const node of level) {
      const preview: { weight: number; openable: Array<ResourceTopologyNode> } =
        previewOf(graph, node);
      added += preview.weight;
      next.push(...preview.openable);
    }

    if (depth > 0 && shown + added > budget) {
      break;
    }

    shown += added;
    depth++;
    level = next;
  }

  return depth;
}

/*
 * The parts that open by themselves when someone opens `nodeId`: the same
 * level-by-level rule as the resource itself, inside that part, and only for
 * the parts its previews show.
 */
export function getPartsOpenedWith(
  graph: ResourceTopologyGraph,
  nodeId: string,
  budget: number = VIEW_BUDGET,
): Array<string> {
  const node: ResourceTopologyNode | undefined = graph.nodes.get(nodeId);

  if (!node) {
    return [];
  }

  const depth: number = Math.max(1, getAutomaticDepth(graph, nodeId, budget));
  const opened: Array<string> = [nodeId];
  let level: Array<ResourceTopologyNode> = [node];

  for (let step: number = 1; step < depth; step++) {
    const next: Array<ResourceTopologyNode> = [];

    for (const parent of level) {
      for (const child of previewOf(graph, parent).openable) {
        opened.push(child.id);
        next.push(child);
      }
    }

    level = next;
  }

  return opened;
}

/* The state after someone opens a part: it, and what opens with it. */
export function openTopologyPart(
  graph: ResourceTopologyGraph,
  state: ResourceTopologyViewState,
  nodeId: string,
): ResourceTopologyViewState {
  const opened: Set<string> = new Set<string>(state.opened);
  const closed: Set<string> = new Set<string>(state.closed);

  for (const id of getPartsOpenedWith(graph, nodeId, OPEN_BUDGET)) {
    opened.add(id);
    closed.delete(id);
  }

  return { ...state, opened: opened, closed: closed };
}

export function closeTopologyPart(
  state: ResourceTopologyViewState,
  nodeId: string,
): ResourceTopologyViewState {
  const opened: Set<string> = new Set<string>(state.opened);
  const closed: Set<string> = new Set<string>(state.closed);
  opened.delete(nodeId);
  closed.add(nodeId);

  return { ...state, opened: opened, closed: closed };
}

/*
 * The state after someone goes to a part: it is pinned (shown even inside a
 * folded group) and every part above it is opened.
 */
export function revealTopologyPart(
  graph: ResourceTopologyGraph,
  state: ResourceTopologyViewState,
  nodeId: string,
): ResourceTopologyViewState {
  if (!graph.nodes.has(nodeId)) {
    return state;
  }

  const opened: Set<string> = new Set<string>(state.opened);
  const closed: Set<string> = new Set<string>(state.closed);
  const pinned: Set<string> = new Set<string>(state.pinned);

  for (const ancestor of getTopologyAncestors(graph, nodeId)) {
    opened.add(ancestor.id);
    closed.delete(ancestor.id);
  }

  pinned.add(nodeId);

  return { ...state, opened: opened, closed: closed, pinned: pinned };
}

export function toggleTopologyGroup(
  state: ResourceTopologyViewState,
  key: string,
): ResourceTopologyViewState {
  const shownInFull: Set<string> = new Set<string>(state.shownInFull);

  if (shownInFull.has(key)) {
    shownInFull.delete(key);
  } else {
    shownInFull.add(key);
  }

  return { ...state, shownInFull: shownInFull };
}

/*
 * Which parts a filter and a search keep: the parts they are about, and the
 * path to each. A search also keeps what is inside a match, so opening a
 * matched host shows its virtual machines; "Needs attention" keeps only
 * troubled parts, all the way down.
 */
interface Narrowing {
  /* The parts the filter and the search are about. */
  targets: Set<string>;
  /* Parts drawn at all. */
  kept: Set<string>;
  /* Parts with a target below them: open, so the targets show. */
  forcedOpen: Set<string>;
  matches: Set<string>;
}

function narrow(
  graph: ResourceTopologyGraph,
  state: ResourceTopologyViewState,
  scope: Set<string> | null,
  options: ResourceTopologyViewOptions,
): Narrowing | null {
  const searching: boolean = state.search.trim().length > 0;
  const attentionOnly: boolean = state.filter === "attention";

  if (!searching && !attentionOnly) {
    return null;
  }

  // Everything the search found is drawn, with the path to it ...
  const found: Set<string> = searching
    ? searchTopology(graph, state.search, options.kindLabel)
    : new Set<string>();
  // ... and what it found for itself is what it counts and marks.
  const matches: Set<string> = searching
    ? getOwnTopologySearchMatches(graph, found, state.search, options.kindLabel)
    : new Set<string>();

  const targets: Set<string> = new Set<string>();

  for (const node of graph.nodes.values()) {
    if (scope && !scope.has(node.id)) {
      continue;
    }

    if (searching && !found.has(node.id)) {
      continue;
    }

    if (attentionOnly && !node.needsAttention) {
      continue;
    }

    targets.add(node.id);
  }

  const kept: Set<string> = new Set<string>();
  const forcedOpen: Set<string> = new Set<string>();

  for (const id of targets) {
    kept.add(id);
    let cursor: string | null = graph.nodes.get(id)?.parentId || null;

    while (cursor && !forcedOpen.has(cursor)) {
      forcedOpen.add(cursor);
      kept.add(cursor);
      cursor = graph.nodes.get(cursor)?.parentId || null;
    }
  }

  if (searching && !attentionOnly) {
    const queue: Array<string> = Array.from(targets);

    for (let index: number = 0; index < queue.length; index++) {
      for (const childId of graph.nodes.get(queue[index]!)?.childIds || []) {
        if (!kept.has(childId)) {
          kept.add(childId);
          queue.push(childId);
        }
      }
    }
  }

  return {
    targets: targets,
    kept: kept,
    forcedOpen: forcedOpen,
    matches: matches,
  };
}

export function computeResourceTopologyView(
  graph: ResourceTopologyGraph,
  state: ResourceTopologyViewState,
  options: ResourceTopologyViewOptions = {},
): ResourceTopologyVisible {
  const budget: number = options.budget ?? VIEW_BUDGET;

  // A focus on the root, or on a part that is gone, is no focus.
  const focus: ResourceTopologyNode | null =
    state.focusId &&
    state.focusId !== graph.rootId &&
    graph.nodes.has(state.focusId)
      ? graph.nodes.get(state.focusId)!
      : null;

  /*
   * With a focus, the drawing is the focused part's lineage (one part per
   * level: the path only) and everything inside the focused part.
   */
  let scope: Set<string> | null = null;
  const lineageNext: Map<string, string> = new Map<string, string>();

  if (focus) {
    const focusScope: Set<string> = new Set<string>([focus.id]);
    const ancestors: Array<ResourceTopologyNode> = getTopologyAncestors(
      graph,
      focus.id,
    );

    ancestors.forEach((ancestor: ResourceTopologyNode, index: number) => {
      focusScope.add(ancestor.id);
      lineageNext.set(ancestor.id, ancestors[index + 1]?.id || focus.id);
    });

    const queue: Array<string> = [...focus.childIds];

    for (let index: number = 0; index < queue.length; index++) {
      focusScope.add(queue[index]!);
      queue.push(...(graph.nodes.get(queue[index]!)?.childIds || []));
    }

    scope = focusScope;
  }

  const narrowing: Narrowing | null = narrow(graph, state, scope, options);

  /*
   * Every part above a pinned part is open, and above a part the map
   * reveals by itself.
   */
  const pins: Set<string> = new Set<string>([
    ...state.pinned,
    ...(options.reveal || []),
  ]);
  const pinnedOpen: Set<string> = new Set<string>();

  for (const id of pins) {
    if (!graph.nodes.has(id) || (scope && !scope.has(id))) {
      continue;
    }

    if (narrowing && !narrowing.kept.has(id)) {
      continue;
    }

    for (const ancestor of getTopologyAncestors(graph, id)) {
      pinnedOpen.add(ancestor.id);
    }
  }

  const automaticTop: ResourceTopologyNode =
    focus || graph.nodes.get(graph.rootId)!;
  const automaticDepth: number = narrowing
    ? 0
    : Math.min(
        getAutomaticDepth(graph, automaticTop.id, budget),
        Math.max(1, options.maxAutomaticDepth ?? Number.POSITIVE_INFINITY),
      );

  const isKept: (id: string) => boolean = (id: string): boolean => {
    if (scope && !scope.has(id)) {
      return false;
    }

    return narrowing ? narrowing.kept.has(id) : true;
  };

  /*
   * `automatic` is false for a card that is only drawn because someone
   * showed its group in full: the automatic depth was worked out for the
   * previews, so such a card waits to be opened.
   */
  const isOpen: (node: ResourceTopologyNode, automatic: boolean) => boolean = (
    node: ResourceTopologyNode,
    automatic: boolean,
  ): boolean => {
    if (lineageNext.has(node.id) || options.alwaysOpen?.has(node.id)) {
      return true;
    }

    if (state.closed.has(node.id)) {
      return false;
    }

    if (state.opened.has(node.id) || pinnedOpen.has(node.id)) {
      return true;
    }

    if (narrowing) {
      return narrowing.forcedOpen.has(node.id);
    }

    return (
      automatic &&
      node.depth - automaticTop.depth < automaticDepth &&
      (node.id === automaticTop.id || opensByItself(graph, node))
    );
  };

  const cardPreview: number = narrowing ? CARD_PREVIEW_NARROWED : CARD_PREVIEW;
  const chipPreview: number = narrowing ? CHIP_PREVIEW_NARROWED : CHIP_PREVIEW;

  const visibleNodeIds: Set<string> = new Set<string>();
  let cardCount: number = 0;
  let chipCount: number = 0;
  let attentionShown: number = 0;

  const keptChildren: (
    node: ResourceTopologyNode,
  ) => Array<ResourceTopologyNode> = (
    node: ResourceTopologyNode,
  ): Array<ResourceTopologyNode> => {
    const next: string | undefined = lineageNext.get(node.id);

    if (next) {
      return [graph.nodes.get(next)!];
    }

    return childrenOf(graph, node).filter(
      (child: ResourceTopologyNode): boolean => {
        return isKept(child.id);
      },
    );
  };

  /*
   * The members a group shows: the first `limit` of them, and every pinned
   * part (or part on the way down to one) on top — a pin never pushes
   * another part out of the preview, so nothing else moves. In the group's
   * own order.
   */
  const pickShown: (
    members: Array<ResourceTopologyNode>,
    limit: number,
  ) => Array<ResourceTopologyNode> = (
    members: Array<ResourceTopologyNode>,
    limit: number,
  ): Array<ResourceTopologyNode> => {
    if (members.length <= limit) {
      return members;
    }

    return members.filter(
      (member: ResourceTopologyNode, index: number): boolean => {
        return (
          index < limit ||
          pins.has(member.id) ||
          pinnedOpen.has(member.id)
        );
      },
    );
  };

  const markShown: (node: ResourceTopologyNode) => void = (
    node: ResourceTopologyNode,
  ): void => {
    visibleNodeIds.add(node.id);

    if (node.needsAttention) {
      attentionShown++;
    }
  };

  const countAttention: (members: Array<ResourceTopologyNode>) => number = (
    members: Array<ResourceTopologyNode>,
  ): number => {
    return members.filter((member: ResourceTopologyNode): boolean => {
      return member.needsAttention;
    }).length;
  };

  const buildCard: (
    node: ResourceTopologyNode,
    automatic: boolean,
  ) => ResourceTopologyCardItem = (
    node: ResourceTopologyNode,
    automatic: boolean,
  ): ResourceTopologyCardItem => {
    markShown(node);
    cardCount++;

    const children: Array<ResourceTopologyNode> = keptChildren(node);
    const canOpen: boolean = children.length > 0;
    const open: boolean = canOpen && isOpen(node, automatic);

    const card: ResourceTopologyCardItem = {
      type: "card",
      id: node.id,
      nodeId: node.id,
      isOpen: open,
      canOpen: canOpen,
      isMatch: Boolean(narrowing?.matches.has(node.id)),
      isFocus: focus?.id === node.id,
      isSection: Boolean(node.isSection),
      groups: [],
    };

    if (!open) {
      return card;
    }

    for (const group of groupByKind(children)) {
      const key: string = groupKey(node.id, group.kind);
      const inFull: boolean = state.shownInFull.has(key);
      const asChips: boolean = drawnAsChips(
        group.members,
        (member: ResourceTopologyNode): boolean => {
          return keptChildren(member).length === 0;
        },
      );
      const limit: number = asChips
        ? inFull
          ? CHIP_FULL_LIMIT
          : chipPreview
        : inFull
          ? CARD_FULL_LIMIT
          : cardPreview;
      const shown: Array<ResourceTopologyNode> = pickShown(
        group.members,
        limit,
      );
      const shownIds: Set<string> = new Set<string>();
      const items: Array<ResourceTopologyCardItem | ResourceTopologyChipItem> =
        [];

      for (let index: number = 0; index < shown.length; index++) {
        const member: ResourceTopologyNode = shown[index]!;
        shownIds.add(member.id);

        if (asChips) {
          markShown(member);
          chipCount++;
          items.push({
            type: "chip",
            id: member.id,
            nodeId: member.id,
            isMatch: Boolean(narrowing?.matches.has(member.id)),
          });
          continue;
        }

        items.push(buildCard(member, automatic && index < cardPreview));
      }

      const hidden: Array<ResourceTopologyNode> = group.members.filter(
        (member: ResourceTopologyNode): boolean => {
          return !shownIds.has(member.id);
        },
      );

      card.groups.push({
        type: "group",
        id: `group:${key}`,
        parentId: node.id,
        kind: group.kind,
        groupKey: key,
        total: group.members.length,
        attention: countAttention(group.members),
        isShownInFull: inFull,
        asChips: asChips,
        items: items,
        more:
          hidden.length > 0
            ? {
                type: "more",
                id: `more:${key}`,
                parentId: node.id,
                kind: group.kind,
                groupKey: key,
                asChip: asChips,
                hiddenCount: hidden.length,
                hiddenAttention: countAttention(hidden),
                canShowAll: !inFull,
              }
            : null,
        memberIds: group.members.map((member: ResourceTopologyNode): string => {
          return member.id;
        }),
      });
    }

    return card;
  };

  const top: ResourceTopologyCardItem = buildCard(
    graph.nodes.get(graph.rootId)!,
    true,
  );

  // What the focused part is related to, beside it.
  const related: Array<ResourceTopologyRelatedItem> = [];
  let relatedHidden: number = 0;

  if (focus) {
    const neighbours: Array<ResourceTopologyNeighbour> = getTopologyNeighbours(
      graph,
      focus.id,
    );

    for (const neighbour of neighbours) {
      if (visibleNodeIds.has(neighbour.nodeId)) {
        continue;
      }

      if (related.length >= RELATED_LIMIT) {
        relatedHidden++;
        continue;
      }

      related.push({
        nodeId: neighbour.nodeId,
        label: neighbour.label,
        direction: neighbour.direction,
      });
    }

    for (const item of related) {
      markShown(graph.nodes.get(item.nodeId)!);
    }
  }

  return {
    top: top,
    focusId: focus?.id || null,
    related: related,
    relatedHidden: relatedHidden,
    visibleNodeIds: visibleNodeIds,
    cardCount: cardCount,
    chipCount: chipCount,
    matchCount: narrowing ? narrowing.matches.size : 0,
    attentionShown: attentionShown,
    isNarrowed: narrowing !== null,
    automaticDepth: automaticDepth,
  };
}

/*
 * Every part of a view, top down, the way the list draws it: each card,
 * group heading, chip and "+ N more" with how deep it sits.
 */
export interface ResourceTopologyOutlineRow {
  item:
    | ResourceTopologyCardItem
    | ResourceTopologyChipItem
    | ResourceTopologyMoreItem
    | ResourceTopologyGroupItem;
  level: number;
}

export function flattenResourceTopologyView(
  visible: ResourceTopologyVisible,
): Array<ResourceTopologyOutlineRow> {
  const rows: Array<ResourceTopologyOutlineRow> = [];

  const walk: (card: ResourceTopologyCardItem, level: number) => void = (
    card: ResourceTopologyCardItem,
    level: number,
  ): void => {
    rows.push({ item: card, level: level });

    for (const group of card.groups) {
      rows.push({ item: group, level: level + 1 });

      for (const item of group.items) {
        if (item.type === "card") {
          walk(item, level + 2);
        } else {
          rows.push({ item: item, level: level + 2 });
        }
      }

      if (group.more) {
        rows.push({ item: group.more, level: level + 2 });
      }
    }
  };

  walk(visible.top, 0);

  return rows;
}

/*
 * Moving through the map from the keyboard, the way a tree is read: down and
 * up between the parts side by side (in the order they are drawn, one group
 * after another), forward into a part - opening it first when it is closed -
 * and back out to the part that holds it, closing an open part first. Home
 * and End go to the first and the last part beside it. Forward and back are
 * the arrows that point along the line: right and left on a page read from
 * left to right, the other way round on one read from right to left.
 */
export type ResourceTopologyKeyMove =
  | "next"
  | "previous"
  | "forward"
  | "back"
  | "first"
  | "last";

export type ResourceTopologyKeyAction =
  // Move the keyboard to this item of the map: a part, or a "+ N more".
  | { type: "move"; itemId: string }
  | { type: "open"; nodeId: string }
  | { type: "close"; nodeId: string };

interface KeyEntry {
  card: ResourceTopologyCardItem | null;
  parentId: string | null;
  /* The items beside it, itself included, in the order they are drawn. */
  siblings: Array<string>;
  /* Its own items, when it is an open card. */
  children: Array<string>;
}

/* Every item of a view, with what is beside it, above it and in it. */
function indexForKeys(visible: ResourceTopologyVisible): Map<string, KeyEntry> {
  const entries: Map<string, KeyEntry> = new Map<string, KeyEntry>();

  const walk: (
    card: ResourceTopologyCardItem,
    parentId: string | null,
    siblings: Array<string>,
  ) => void = (
    card: ResourceTopologyCardItem,
    parentId: string | null,
    siblings: Array<string>,
  ): void => {
    const children: Array<string> = [];

    for (const group of card.groups) {
      for (const item of group.items) {
        children.push(item.id);
      }

      if (group.more) {
        children.push(group.more.id);
      }
    }

    entries.set(card.id, {
      card: card,
      parentId: parentId,
      siblings: siblings,
      children: card.isOpen ? children : [],
    });

    for (const group of card.groups) {
      for (const item of group.items) {
        if (item.type === "card") {
          walk(item, card.id, children);
        } else {
          entries.set(item.id, {
            card: null,
            parentId: card.id,
            siblings: children,
            children: [],
          });
        }
      }

      if (group.more) {
        entries.set(group.more.id, {
          card: null,
          parentId: card.id,
          siblings: children,
          children: [],
        });
      }
    }
  };

  walk(visible.top, null, [visible.top.id]);

  return entries;
}

export function getTopologyKeyAction(
  visible: ResourceTopologyVisible,
  itemId: string,
  move: ResourceTopologyKeyMove,
): ResourceTopologyKeyAction | null {
  const entry: KeyEntry | undefined = indexForKeys(visible).get(itemId);

  if (!entry) {
    return null;
  }

  const position: number = entry.siblings.indexOf(itemId);
  const moveTo: (id: string | undefined) => ResourceTopologyKeyAction | null = (
    id: string | undefined,
  ): ResourceTopologyKeyAction | null => {
    return id && id !== itemId ? { type: "move", itemId: id } : null;
  };

  switch (move) {
    case "next":
      return moveTo(entry.siblings[position + 1]);
    case "previous":
      return position > 0 ? moveTo(entry.siblings[position - 1]) : null;
    case "first":
      return moveTo(entry.siblings[0]);
    case "last":
      return moveTo(entry.siblings[entry.siblings.length - 1]);
    case "forward":
      if (entry.card && entry.card.canOpen && !entry.card.isOpen) {
        return { type: "open", nodeId: entry.card.nodeId };
      }

      return moveTo(entry.children[0]);
    case "back":
      // The resource itself is always open: back from it goes nowhere.
      if (entry.card && entry.card.isOpen && entry.parentId !== null) {
        return { type: "close", nodeId: entry.card.nodeId };
      }

      return moveTo(entry.parentId || undefined);
    default:
      return null;
  }
}
