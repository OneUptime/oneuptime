import PageMap from "../../Utils/PageMap";

/*
 * A resource's own topology: how the parts of one vCenter, one Kubernetes
 * cluster, one host (and every other resource that holds other things) fit
 * together, how healthy each part is, and where the open incidents and
 * alerts sit.
 *
 * Every product describes its resource the same way — a tree of parts under
 * the resource itself (vCenter > datacenter > cluster > ESXi host > virtual
 * machine), a few relations that cross the tree (a pod runs on a node, a
 * service calls a database), and the open incidents and alerts pinned to the
 * part they are about. This module turns that description into the graph the
 * map and the list draw: children in a stable order (what needs attention
 * first), and everything a collapsed part has to say about what is inside it
 * (how many of each kind, how many need attention, how many incidents).
 *
 * It is free of React and of any data access, so the App suite can build a
 * hundred thousand parts in a plain Node test and check every count.
 */

/*
 * How one part is doing, as its product reads it.
 *
 *   critical  broken or failing: a node that is not ready, a failed pod, a
 *             datastore over 90%, an open incident.
 *   warning   working, but worth a look: a pending pod, a host that stopped
 *             reporting, an open alert.
 *   healthy   running and reporting.
 *   off       stopped on purpose: a powered-off VM, a completed job. Not a
 *             problem, and never counted as one.
 *   unknown   nothing reported yet.
 */
export type ResourceTopologyHealth =
  | "critical"
  | "warning"
  | "healthy"
  | "off"
  | "unknown";

export const RESOURCE_TOPOLOGY_HEALTHS: ReadonlyArray<ResourceTopologyHealth> =
  ["critical", "warning", "healthy", "off", "unknown"];

/* No part of any health yet: the counts a part's rollup starts from. */
export function emptyHealthCounts(): Record<ResourceTopologyHealth, number> {
  return { critical: 0, warning: 0, healthy: 0, off: 0, unknown: 0 };
}

export function isAttentionHealth(health: ResourceTopologyHealth): boolean {
  return health === "critical" || health === "warning";
}

/* The worse of two: critical, then warning; otherwise the first stands. */
export function worseHealth(
  a: ResourceTopologyHealth,
  b: ResourceTopologyHealth,
): ResourceTopologyHealth {
  if (a === "critical" || b === "critical") {
    return "critical";
  }

  if (a === "warning" || b === "warning") {
    return "warning";
  }

  return a;
}

/*
 * Text the page shows in the reader's language. `text` is English, written
 * where it is made inside translationKey() so the extractor files it; values
 * are filled in after it is translated.
 */
export interface ResourceTopologyText {
  text: string;
  values?: Record<string, string> | undefined;
}

/* A small number on a card: "CPU 45%". The value is never translated. */
export interface ResourceTopologyFact {
  label: string;
  value: string;
  tone?: "warning" | "critical" | undefined;
}

/* The part's own page, opened from the map. */
export interface ResourceTopologyLinkTarget {
  page: PageMap;
  modelId: string;
  subModelId?: string | undefined;
}

/*
 * A relation that crosses the tree: a pod runs on a node, a service calls a
 * database. `label` reads from `from` ("Runs on"), `inverseLabel` from `to`
 * ("Runs here").
 */
export interface ResourceTopologyRelation {
  from: string;
  to: string;
  label: string;
  inverseLabel: string;
  /* How the relation itself is doing, when it has a state (a call's errors). */
  health?: ResourceTopologyHealth | undefined;
  /* A short figure the line can carry: "1.1k/min". Not translated. */
  detail?: string | undefined;
}

export type ResourceTopologyIssueType = "incident" | "alert";

/* An open incident or alert, pinned to the part it is about. */
export interface ResourceTopologyIssue {
  type: ResourceTopologyIssueType;
  id: string;
  title: string;
  /* "#12", or the project's own prefix ("INC-12"). */
  number: string;
  severityName: string;
  severityColor: string | null;
  stateName: string;
  createdAt: Date | null;
}

export interface ResourceTopologyNodeInput {
  id: string;
  /* null only for the resource itself, the root of the tree. */
  parentId: string | null;
  /* A key of the kind catalog (ResourceTopologyKinds): "vmware.host". */
  kind: string;
  /* The part's own name, shown as written. */
  name: string;
  /*
   * A part that has no record of its own and only groups others ("Nodes",
   * "Standalone containers"): its name is English, translated when shown,
   * and it never counts as a part of the resource.
   */
  isSection?: boolean | undefined;
  health: ResourceTopologyHealth;
  /* One or two words under the name: "Powered off", "CrashLoopBackOff". */
  status?: ResourceTopologyText | undefined;
  /* Why it needs attention, one sentence each. */
  reasons?: Array<ResourceTopologyText> | undefined;
  facts?: Array<ResourceTopologyFact> | undefined;
  link?: ResourceTopologyLinkTarget | null | undefined;
  /* Where it sits, under its name: "Cluster A". Data, not translated. */
  context?: string | undefined;
  /* More words a search finds it by: a namespace, an image, an address. */
  keywords?: Array<string> | undefined;
}

export interface ResourceTopologyTruncation {
  kind: string;
  shown: number;
  total: number;
}

export interface ResourceTopologyNode extends ResourceTopologyNodeInput {
  /* Steps below the root: the root is 0. */
  depth: number;
  /* What needs attention first, then by name. */
  childIds: Array<string>;
  issues: Array<ResourceTopologyIssue>;
  /*
   * Its own health with its open issues: an open incident makes a part
   * critical, an open alert at least a warning.
   */
  effectiveHealth: ResourceTopologyHealth;
  needsAttention: boolean;
  /* Everything below it, itself left out. */
  descendantCount: number;
  descendantCountsByKind: Map<string, number>;
  attentionBelow: number;
  criticalBelow: number;
  incidentsBelow: number;
  alertsBelow: number;
  /*
   * Everything below it by how it is doing, sections left out: what the
   * bar of a part that holds others splits into red, amber, green and grey.
   */
  healthBelow: Record<ResourceTopologyHealth, number>;
}

export interface ResourceTopologyGraph {
  rootId: string;
  nodes: Map<string, ResourceTopologyNode>;
  relations: Array<ResourceTopologyRelation>;
  /* Every relation a node is at either end of. */
  relationsByNode: Map<string, Array<ResourceTopologyRelation>>;
  /* Parts of each kind, sections and the root left out. */
  countsByKind: Map<string, number>;
  /* Parts that need attention, the root included. */
  attentionCount: number;
  incidentCount: number;
  alertCount: number;
  /* What a product could not read in full (a cap was hit). */
  truncations: Array<ResourceTopologyTruncation>;
}

export interface BuildResourceTopologyGraphInput {
  rootId: string;
  nodes: Array<ResourceTopologyNodeInput>;
  relations?: Array<ResourceTopologyRelation> | undefined;
  /* Node id -> its open incidents and alerts. */
  issues?: Map<string, Array<ResourceTopologyIssue>> | undefined;
  truncations?: Array<ResourceTopologyTruncation> | undefined;
}

/*
 * One collator for every name comparison: numbers inside names sort as
 * numbers ("esx-2" before "esx-10"), case and accents do not split a list.
 */
const NAME_COLLATOR: Intl.Collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function compareTopologyNames(a: string, b: string): number {
  const byName: number = NAME_COLLATOR.compare(a, b);

  if (byName !== 0) {
    return byName;
  }

  // Equal for the collator ("Web" and "web"): code points decide, stably.
  return a < b ? -1 : a > b ? 1 : 0;
}

/* Lower first: critical, then warning, then everything else. */
function attentionRank(node: ResourceTopologyNode): number {
  if (node.effectiveHealth === "critical") {
    return 0;
  }

  if (node.effectiveHealth === "warning") {
    return 1;
  }

  // A healthy part with trouble inside it still comes before a quiet one.
  if (node.criticalBelow > 0) {
    return 2;
  }

  if (node.attentionBelow > 0) {
    return 3;
  }

  return 4;
}

/*
 * The order siblings are shown in: what needs attention first (critical,
 * then warning, then parts with trouble inside), then by name, then by id so
 * the order never depends on the order the rows arrived in.
 */
export function compareTopologyNodes(
  a: ResourceTopologyNode,
  b: ResourceTopologyNode,
): number {
  const byAttention: number = attentionRank(a) - attentionRank(b);

  if (byAttention !== 0) {
    return byAttention;
  }

  const byName: number = compareTopologyNames(a.name, b.name);

  if (byName !== 0) {
    return byName;
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function healthFromIssues(
  issues: Array<ResourceTopologyIssue>,
): ResourceTopologyHealth | null {
  if (
    issues.some((issue: ResourceTopologyIssue): boolean => {
      return issue.type === "incident";
    })
  ) {
    return "critical";
  }

  return issues.length > 0 ? "warning" : null;
}

/*
 * Builds the graph a product described. Forgiving on purpose, because the
 * rows come from inventories that update every few minutes: a part whose
 * parent is not in the inventory (yet, or any more) hangs off the root
 * rather than vanishing, a parent chain that loops is cut at the root, a
 * repeated id keeps its first row, and a relation to a part that is not
 * there is dropped.
 */
export function buildResourceTopologyGraph(
  input: BuildResourceTopologyGraphInput,
): ResourceTopologyGraph {
  const nodes: Map<string, ResourceTopologyNode> = new Map<
    string,
    ResourceTopologyNode
  >();

  for (const nodeInput of input.nodes) {
    if (!nodeInput.id || nodes.has(nodeInput.id)) {
      continue;
    }

    const issues: Array<ResourceTopologyIssue> =
      input.issues?.get(nodeInput.id) || [];
    const issueHealth: ResourceTopologyHealth | null = healthFromIssues(issues);
    const effectiveHealth: ResourceTopologyHealth = issueHealth
      ? worseHealth(nodeInput.health, issueHealth)
      : nodeInput.health;

    nodes.set(nodeInput.id, {
      ...nodeInput,
      parentId: nodeInput.id === input.rootId ? null : nodeInput.parentId,
      depth: 0,
      childIds: [],
      issues: issues,
      effectiveHealth: effectiveHealth,
      needsAttention: isAttentionHealth(effectiveHealth),
      descendantCount: 0,
      descendantCountsByKind: new Map<string, number>(),
      attentionBelow: 0,
      criticalBelow: 0,
      incidentsBelow: 0,
      alertsBelow: 0,
      healthBelow: emptyHealthCounts(),
    });
  }

  if (!nodes.has(input.rootId)) {
    throw new Error(
      `The topology has no root: no part has the id "${input.rootId}".`,
    );
  }

  // Parents that are missing, or that loop back, become the root.
  for (const node of nodes.values()) {
    if (node.id === input.rootId) {
      continue;
    }

    if (!node.parentId || !nodes.has(node.parentId)) {
      node.parentId = input.rootId;
    }
  }

  /*
   * Each chain is walked once: a part already known to reach the root ends
   * the walk, and a part met twice on one walk closes a loop, which is cut
   * there.
   */
  const reachesRoot: Set<string> = new Set<string>([input.rootId]);

  for (const node of nodes.values()) {
    const path: Array<string> = [];
    const onPath: Set<string> = new Set<string>();
    let cursor: string | null = node.id;

    while (cursor && !reachesRoot.has(cursor)) {
      const current: ResourceTopologyNode = nodes.get(cursor)!;

      if (onPath.has(cursor)) {
        current.parentId = input.rootId;
        break;
      }

      onPath.add(cursor);
      path.push(cursor);
      cursor = current.parentId;
    }

    for (const id of path) {
      reachesRoot.add(id);
    }
  }

  // Depth, top down, and the parents' child lists.
  const order: Array<ResourceTopologyNode> = [];
  const childrenOf: Map<string, Array<ResourceTopologyNode>> = new Map<
    string,
    Array<ResourceTopologyNode>
  >();

  for (const node of nodes.values()) {
    if (node.parentId) {
      const siblings: Array<ResourceTopologyNode> =
        childrenOf.get(node.parentId) || [];
      siblings.push(node);
      childrenOf.set(node.parentId, siblings);
    }
  }

  const root: ResourceTopologyNode = nodes.get(input.rootId)!;
  const queue: Array<ResourceTopologyNode> = [root];

  for (let index: number = 0; index < queue.length; index++) {
    const node: ResourceTopologyNode = queue[index]!;
    order.push(node);

    for (const child of childrenOf.get(node.id) || []) {
      child.depth = node.depth + 1;
      queue.push(child);
    }
  }

  // Roll everything up, bottom first.
  for (let index: number = order.length - 1; index >= 0; index--) {
    const node: ResourceTopologyNode = order[index]!;
    const children: Array<ResourceTopologyNode> = childrenOf.get(node.id) || [];

    for (const child of children) {
      node.descendantCount += child.descendantCount;

      for (const [kind, count] of child.descendantCountsByKind) {
        node.descendantCountsByKind.set(
          kind,
          (node.descendantCountsByKind.get(kind) || 0) + count,
        );
      }

      if (!child.isSection) {
        node.descendantCount += 1;
        node.descendantCountsByKind.set(
          child.kind,
          (node.descendantCountsByKind.get(child.kind) || 0) + 1,
        );
      }

      for (const health of RESOURCE_TOPOLOGY_HEALTHS) {
        node.healthBelow[health] += child.healthBelow[health];
      }

      if (!child.isSection) {
        node.healthBelow[child.effectiveHealth] += 1;
      }

      node.attentionBelow +=
        child.attentionBelow + (child.needsAttention ? 1 : 0);
      node.criticalBelow +=
        child.criticalBelow + (child.effectiveHealth === "critical" ? 1 : 0);

      let childIncidents: number = 0;
      let childAlerts: number = 0;

      for (const issue of child.issues) {
        if (issue.type === "incident") {
          childIncidents++;
        } else {
          childAlerts++;
        }
      }

      node.incidentsBelow += child.incidentsBelow + childIncidents;
      node.alertsBelow += child.alertsBelow + childAlerts;
    }

    node.childIds = [...children]
      .sort(compareTopologyNodes)
      .map((child: ResourceTopologyNode): string => {
        return child.id;
      });
  }

  /*
   * Relations between parts that are there, once each — and not between a
   * part and one that holds it: a task inside its service, a pod inside its
   * node, the nesting already says so.
   */
  const relations: Array<ResourceTopologyRelation> = [];
  const relationsByNode: Map<string, Array<ResourceTopologyRelation>> = new Map<
    string,
    Array<ResourceTopologyRelation>
  >();
  const seenRelations: Set<string> = new Set<string>();
  const holds: (outerId: string, innerId: string) => boolean = (
    outerId: string,
    innerId: string,
  ): boolean => {
    let cursor: string | null = nodes.get(innerId)?.parentId || null;

    while (cursor) {
      if (cursor === outerId) {
        return true;
      }

      cursor = nodes.get(cursor)?.parentId || null;
    }

    return false;
  };

  for (const relation of input.relations || []) {
    if (
      relation.from === relation.to ||
      !nodes.has(relation.from) ||
      !nodes.has(relation.to) ||
      holds(relation.from, relation.to) ||
      holds(relation.to, relation.from)
    ) {
      continue;
    }

    const key: string = JSON.stringify([
      relation.from,
      relation.to,
      relation.label,
    ]);

    if (seenRelations.has(key)) {
      continue;
    }

    seenRelations.add(key);
    relations.push(relation);

    for (const end of [relation.from, relation.to]) {
      const list: Array<ResourceTopologyRelation> =
        relationsByNode.get(end) || [];
      list.push(relation);
      relationsByNode.set(end, list);
    }
  }

  const countsByKind: Map<string, number> = new Map<string, number>(
    root.descendantCountsByKind,
  );

  let incidentCount: number = root.incidentsBelow;
  let alertCount: number = root.alertsBelow;

  for (const issue of root.issues) {
    if (issue.type === "incident") {
      incidentCount++;
    } else {
      alertCount++;
    }
  }

  return {
    rootId: input.rootId,
    nodes: nodes,
    relations: relations,
    relationsByNode: relationsByNode,
    countsByKind: countsByKind,
    attentionCount: root.attentionBelow + (root.needsAttention ? 1 : 0),
    incidentCount: incidentCount,
    alertCount: alertCount,
    truncations: input.truncations || [],
  };
}

/* The parts above a node, the root first. Empty for the root. */
export function getTopologyAncestors(
  graph: ResourceTopologyGraph,
  nodeId: string,
): Array<ResourceTopologyNode> {
  const ancestors: Array<ResourceTopologyNode> = [];
  let cursor: string | null = graph.nodes.get(nodeId)?.parentId || null;

  while (cursor) {
    const node: ResourceTopologyNode | undefined = graph.nodes.get(cursor);

    if (!node) {
      break;
    }

    ancestors.unshift(node);
    cursor = node.parentId;
  }

  return ancestors;
}

/* Every part below a node, breadth first; the node itself left out. */
export function getTopologyDescendantIds(
  graph: ResourceTopologyGraph,
  nodeId: string,
): Array<string> {
  const result: Array<string> = [];
  const queue: Array<string> = [...(graph.nodes.get(nodeId)?.childIds || [])];

  for (let index: number = 0; index < queue.length; index++) {
    const id: string = queue[index]!;
    result.push(id);
    queue.push(...(graph.nodes.get(id)?.childIds || []));
  }

  return result;
}

/* The parts a node is related to, with the words that read from it. */
export interface ResourceTopologyNeighbour {
  nodeId: string;
  label: string;
  direction: "out" | "in";
}

export function getTopologyNeighbours(
  graph: ResourceTopologyGraph,
  nodeId: string,
): Array<ResourceTopologyNeighbour> {
  const neighbours: Array<ResourceTopologyNeighbour> = [];

  for (const relation of graph.relationsByNode.get(nodeId) || []) {
    if (relation.from === nodeId) {
      neighbours.push({
        nodeId: relation.to,
        label: relation.label,
        direction: "out",
      });
    } else {
      neighbours.push({
        nodeId: relation.from,
        label: relation.inverseLabel,
        direction: "in",
      });
    }
  }

  return neighbours.sort(
    (a: ResourceTopologyNeighbour, b: ResourceTopologyNeighbour): number => {
      if (a.label !== b.label) {
        return a.label < b.label ? -1 : 1;
      }

      return compareTopologyNodes(
        graph.nodes.get(a.nodeId)!,
        graph.nodes.get(b.nodeId)!,
      );
    },
  );
}

/* A part's relations of one kind: "Called by" mobile-bff and storefront. */
export interface ResourceTopologyNeighbourGroup {
  /* English: "Runs here", "Calls". */
  label: string;
  neighbours: Array<ResourceTopologyNeighbour>;
}

/*
 * A part's relations, one group per kind of relation, in the order the
 * relations come: a label is said once, over the parts it names, rather
 * than on every row of the panel.
 */
export function groupTopologyNeighbours(
  neighbours: Array<ResourceTopologyNeighbour>,
): Array<ResourceTopologyNeighbourGroup> {
  const groups: Map<string, ResourceTopologyNeighbourGroup> = new Map<
    string,
    ResourceTopologyNeighbourGroup
  >();

  for (const neighbour of neighbours) {
    let group: ResourceTopologyNeighbourGroup | undefined = groups.get(
      neighbour.label,
    );

    if (!group) {
      group = { label: neighbour.label, neighbours: [] };
      groups.set(neighbour.label, group);
    }

    group.neighbours.push(neighbour);
  }

  return Array.from(groups.values());
}

/*
 * The words a search reads for a part: its name, what it is (in English and
 * in the reader's language, from `kindLabel`), its status, where it sits and
 * its keywords. Lowercase.
 */
export function getTopologySearchText(
  node: ResourceTopologyNode,
  kindLabel?: ((kind: string) => Array<string>) | undefined,
): string {
  const parts: Array<string> = [node.name];

  if (kindLabel) {
    parts.push(...kindLabel(node.kind));
  }

  if (node.status?.text) {
    parts.push(node.status.text);
  }

  if (node.context) {
    parts.push(node.context);
  }

  parts.push(...(node.keywords || []));

  return parts.join("\n").toLowerCase();
}

const WHITESPACE: RegExp = /\s+/;

/* At most this many words of a search are read. */
export const MAX_TOPOLOGY_SEARCH_TERMS: number = 10;

/* What was typed, as lowercase words; empty when nothing was. */
export function getTopologySearchTerms(search: string): Array<string> {
  return search
    .toLowerCase()
    .split(WHITESPACE)
    .map((term: string): string => {
      return term.trim();
    })
    .filter((term: string): boolean => {
      return term.length > 0;
    })
    .slice(0, MAX_TOPOLOGY_SEARCH_TERMS);
}

/*
 * The parts every word of a search was found in. The root never matches: it
 * is the resource the page is about, so a search is always about its parts.
 */
export function searchTopology(
  graph: ResourceTopologyGraph,
  search: string,
  kindLabel?: ((kind: string) => Array<string>) | undefined,
): Set<string> {
  const terms: Array<string> = getTopologySearchTerms(search);
  const matches: Set<string> = new Set<string>();

  if (terms.length === 0) {
    return matches;
  }

  for (const node of graph.nodes.values()) {
    if (node.id === graph.rootId || node.isSection) {
      continue;
    }

    const text: string = getTopologySearchText(node, kindLabel);

    if (
      terms.every((term: string): boolean => {
        return text.includes(term);
      })
    ) {
      matches.add(node.id);
    }
  }

  return matches;
}

/*
 * Of the parts a search found, the ones it found for themselves: what the
 * search counts and marks. A part found only by where it sits - the host
 * named on a virtual machine's line - is left out when the part it sits in
 * was found too, so a search for a host says "1 part matches" and marks the
 * host, not each of its virtual machines (they are still drawn, inside it).
 * A part found by where it sits whose place was not found - the pods of a
 * namespace, read by node - is a match of its own.
 */
export function getOwnTopologySearchMatches(
  graph: ResourceTopologyGraph,
  found: ReadonlySet<string>,
  search: string,
  kindLabel?: ((kind: string) => Array<string>) | undefined,
): Set<string> {
  const terms: Array<string> = getTopologySearchTerms(search);
  const own: Set<string> = new Set<string>();

  for (const id of found) {
    const node: ResourceTopologyNode | undefined = graph.nodes.get(id);

    if (!node) {
      continue;
    }

    const ownText: string = getTopologySearchText(
      { ...node, context: undefined },
      kindLabel,
    );
    const foundForItself: boolean =
      !node.context ||
      terms.every((term: string): boolean => {
        return ownText.includes(term);
      });

    if (foundForItself) {
      own.add(id);
      continue;
    }

    let cursor: string | null = node.parentId;
    let insideFound: boolean = false;

    while (cursor) {
      if (found.has(cursor)) {
        insideFound = true;
        break;
      }

      cursor = graph.nodes.get(cursor)?.parentId || null;
    }

    if (!insideFound) {
      own.add(id);
    }
  }

  return own;
}
