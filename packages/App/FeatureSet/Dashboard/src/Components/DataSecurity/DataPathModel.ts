import {
  FLOW_KIND_AI_PROVIDER,
  FLOW_KIND_COPY,
  FLOW_KIND_EXTERNAL_HOST,
  FLOW_KIND_USES,
  getFlowRisk,
} from "./FlowKinds";
import DataSecurityFlow from "Common/Models/DatabaseModels/DataSecurityFlow";
import DataStoreAccess from "Common/Models/DatabaseModels/DataStoreAccess";
import {
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "Common/Types/DataSecurity/DataStoreAccess";
import DataSensitivity, {
  DATA_SENSITIVITY_RANK,
} from "Common/Types/DataSecurity/DataSensitivity";
import ObjectID from "Common/Types/ObjectID";

/*
 * ONE STORE'S DATA PATHS: WHO CAN REACH IT, WHAT USES IT, AND WHERE ITS
 * DATA CAN GO FROM THERE.
 *
 * A store's pages answer one step at a time - Who Can Reach It, Data Flows
 * - while the risk sits in the steps together: an account outside yours
 * that can change a Restricted store, which a service reads and sends on to
 * an AI provider. This lays the steps out in four columns, left to right:
 *
 *   who can reach it -> the store -> services that use it -> where its data can go
 *
 * - Who can reach it: one card per identity of the store's access entries
 *   (DataStoreAccess), at the most any of its grants allows, the riskiest
 *   first. Every public grant is one card, anyone on the internet. A
 *   service seen in traces is drawn with the services, not here.
 * - Services that use it: its Uses flows, the service whose AI
 *   conversations it is, and any service its access entries saw in traces.
 * - Where its data can go: the AI providers and outside hosts each of those
 *   services sends data to, and the stores holding copies of this one. A
 *   service's AI and outside calls are flows of the service, not of this
 *   store: they say where the store's data can go, not that it went, and
 *   their arrows are confirmed only when a scan found the data there.
 *
 * Each column keeps its riskiest cards and folds the rest into one "+N
 * more" card, which opens the page that lists them all, so the drawing
 * stays readable for a store a thousand roles can read.
 */

export enum DataPathNodeKind {
  Identity = "Identity",
  Store = "Store",
  Service = "Service",
  AiProvider = "AiProvider",
  ExternalHost = "ExternalHost",
  Copy = "Copy",
  More = "More",
}

export enum DataPathEdgeKind {
  Access = "Access",
  Uses = "Uses",
  AiProvider = "AiProvider",
  ExternalHost = "ExternalHost",
  Copy = "Copy",
}

// Where an identity reaches the store from, the worst first.
export enum DataPathReach {
  Public = "Public",
  Outside = "Outside",
  Yours = "Yours",
}

// The page a "+N more" card opens: the store's Who Can Reach It, or Data Flows.
export enum DataPathMoreTarget {
  Access = "Access",
  Flows = "Flows",
}

export const DATA_PATH_COLUMN_REACH: number = 0;
export const DATA_PATH_COLUMN_STORE: number = 1;
export const DATA_PATH_COLUMN_SERVICES: number = 2;
export const DATA_PATH_COLUMN_DESTINATIONS: number = 3;

// The cards a column shows before the rest fold into "+N more".
export const DATA_PATH_MAX_IDENTITIES: number = 6;
export const DATA_PATH_MAX_SERVICES: number = 6;
export const DATA_PATH_MAX_DESTINATIONS: number = 8;

export const DATA_PATH_STORE_NODE_ID: string = "store";

export interface DataPathNode {
  id: string;
  kind: DataPathNodeKind;
  column: number;
  // As its source names it; empty when it has no name (the card words one).
  name: string;
  // An identity's: who or what it is, as its cloud says.
  principalType?: string | undefined;
  reach?: DataPathReach | undefined;
  // An identity's: the most any of its grants allows.
  accessLevel?: string | undefined;
  grantCount?: number | undefined;
  isUnused?: boolean | undefined;
  // An identity's first grant, which opens the identity's own page.
  access?: DataStoreAccess | undefined;
  // A service's page, when OneUptime holds a record of it.
  serviceId?: string | undefined;
  // The store's, or a copy's page.
  storeId?: string | undefined;
  storeKind?: string | undefined;
  sensitivity?: DataSensitivity | undefined;
  exposure?: string | undefined;
  // A "+N more" card's.
  moreCount?: number | undefined;
  moreTarget?: DataPathMoreTarget | undefined;
}

export interface DataPathEdge {
  id: string;
  source: string;
  target: string;
  kind: DataPathEdgeKind;
  // An access arrow's.
  accessLevel?: string | undefined;
  reach?: DataPathReach | undefined;
  // A flow's: what can travel along it.
  sensitivity?: DataSensitivity | undefined;
  /*
   * Access is read from the store's settings, and a copy is found by its
   * values, so both are always confirmed; a flow is once a scan proved it.
   */
  isConfirmed: boolean;
  callCount?: number | undefined;
  overlapPercent?: number | undefined;
}

export interface DataPathGraph {
  nodes: Array<DataPathNode>;
  edges: Array<DataPathEdge>;
  // Nothing but the store: nobody reaches it, and nothing uses it.
  isEmpty: boolean;
}

export interface DataPathStore {
  id: string;
  name: string;
  kind?: string | undefined;
  sensitivity?: DataSensitivity | undefined;
  exposure?: string | undefined;
}

export interface DataPathInput {
  store: DataPathStore;
  // The store's access entries as read, and how many it has in all.
  access: Array<DataStoreAccess>;
  accessTotal: number;
  // Flows out of the store: Uses, AI Provider (its AI conversations), Copy.
  outgoing: Array<DataSecurityFlow>;
  // The AI Provider and External Host flows of the services that use it.
  onward: Array<DataSecurityFlow>;
}

const ACCESS_LEVEL_RANK: Readonly<Record<string, number>> = {
  [DataStoreAccessLevel.Admin]: 3,
  [DataStoreAccessLevel.Write]: 2,
  [DataStoreAccessLevel.Read]: 1,
};

const REACH_RANK: Readonly<Record<DataPathReach, number>> = {
  [DataPathReach.Public]: 2,
  [DataPathReach.Outside]: 1,
  [DataPathReach.Yours]: 0,
};

// The key every public grant shares: anyone on the internet is one card.
const PUBLIC_IDENTITY_KEY: string = "public";

// The prefix a service the service map named, with no record, goes by.
const NAMED_SERVICE_PREFIX: string = "service:";

function sensitivityRank(sensitivity: DataSensitivity | undefined): number {
  return sensitivity ? DATA_SENSITIVITY_RANK[sensitivity] : -1;
}

function moreSensitive(
  a: DataSensitivity | undefined,
  b: DataSensitivity | undefined,
): DataSensitivity | undefined {
  return sensitivityRank(b) > sensitivityRank(a) ? b : a;
}

function compareNames(a: DataPathNode, b: DataPathNode): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

// Which pages a reader sees as one service: its record, or its name.
function serviceKeyOf(
  serviceId: string | undefined,
  name: string | undefined,
): string {
  if (serviceId) {
    return `service:${serviceId}`;
  }

  return `service-name:${(name || "").trim().toLowerCase()}`;
}

/*
 * The services whose own flows say where the store's data can go next:
 * the ones its Uses and AI Provider flows name, and the ones its access
 * entries saw in traces, by their records' ids.
 */
export function getDataPathServiceIds(
  access: Array<DataStoreAccess>,
  outgoing: Array<DataSecurityFlow>,
): Array<string> {
  const ids: Set<string> = new Set();

  for (const flow of outgoing) {
    const serviceId: string = flow.serviceId?.toString() || "";

    if (
      serviceId &&
      (flow.kind === FLOW_KIND_USES || flow.kind === FLOW_KIND_AI_PROVIDER)
    ) {
      ids.add(serviceId);
    }
  }

  for (const entry of access) {
    if (
      entry.principalType === DataStorePrincipalType.Service &&
      ObjectID.isValidUUID(entry.principal || "")
    ) {
      ids.add(entry.principal || "");
    }
  }

  return Array.from(ids).sort();
}

// How risky an identity's reach into the store is, to rank the cards by.
export function getIdentityPathRisk(node: DataPathNode): number {
  return (
    REACH_RANK[node.reach || DataPathReach.Yours] * 100 +
    (ACCESS_LEVEL_RANK[node.accessLevel || ""] || 0) * 10 +
    (node.isUnused ? 5 : 0)
  );
}

function getReach(entry: DataStoreAccess): DataPathReach {
  if (entry.isPublic || entry.principalType === DataStorePrincipalType.Public) {
    return DataPathReach.Public;
  }

  return entry.isExternal ? DataPathReach.Outside : DataPathReach.Yours;
}

/*
 * One card per identity, however many grants it holds: at the most any of
 * them allows, from the worst place any of them reaches from. It is unused
 * only when every grant is.
 */
function getIdentityNodes(access: Array<DataStoreAccess>): Array<DataPathNode> {
  const byKey: Map<string, DataPathNode> = new Map();

  for (const entry of access) {
    if (entry.principalType === DataStorePrincipalType.Service) {
      continue;
    }

    const reach: DataPathReach = getReach(entry);
    const key: string =
      reach === DataPathReach.Public
        ? PUBLIC_IDENTITY_KEY
        : entry.principal || entry.principalName || "";

    if (!key) {
      continue;
    }

    const level: string = entry.accessLevel || "";
    const existing: DataPathNode | undefined = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        id: `identity:${key}`,
        kind: DataPathNodeKind.Identity,
        column: DATA_PATH_COLUMN_REACH,
        name:
          reach === DataPathReach.Public
            ? ""
            : entry.principalName || entry.principal || "",
        principalType:
          reach === DataPathReach.Public
            ? DataStorePrincipalType.Public
            : entry.principalType,
        reach: reach,
        accessLevel: level,
        grantCount: 1,
        isUnused: Boolean(entry.isUnused),
        access: entry,
      });
      continue;
    }

    existing.grantCount = (existing.grantCount || 0) + 1;
    existing.isUnused = Boolean(existing.isUnused && entry.isUnused);

    if (REACH_RANK[reach] > REACH_RANK[existing.reach || DataPathReach.Yours]) {
      existing.reach = reach;
    }

    if (
      (ACCESS_LEVEL_RANK[level] || 0) >
      (ACCESS_LEVEL_RANK[existing.accessLevel || ""] || 0)
    ) {
      existing.accessLevel = level;
    }
  }

  return Array.from(byKey.values()).sort(
    (a: DataPathNode, b: DataPathNode): number => {
      return (
        getIdentityPathRisk(b) - getIdentityPathRisk(a) || compareNames(a, b)
      );
    },
  );
}

interface ServiceDraft {
  node: DataPathNode;
  callCount: number;
  // The riskiest flow onward from it, to rank the services by.
  risk: number;
}

interface DestinationDraft {
  node: DataPathNode;
  risk: number;
  // The services it is reached from, or the store itself for a copy.
  sources: Set<string>;
}

interface EdgeDraft {
  edge: DataPathEdge;
  risk: number;
}

// A "+N more" card at the foot of a column.
function moreNode(
  column: number,
  count: number,
  target: DataPathMoreTarget,
): DataPathNode {
  return {
    id: `more:${column}`,
    kind: DataPathNodeKind.More,
    column: column,
    name: "",
    moreCount: count,
    moreTarget: target,
  };
}

/*
 * Two flows along one arrow - a service's AI calls read twice, say - draw
 * one arrow: the more sensitive data, confirmed if either is, their calls
 * added.
 */
function mergeEdge(
  edges: Map<string, EdgeDraft>,
  edge: DataPathEdge,
  risk: number,
): void {
  const existing: EdgeDraft | undefined = edges.get(edge.id);

  if (!existing) {
    edges.set(edge.id, { edge: edge, risk: risk });
    return;
  }

  existing.edge.sensitivity = moreSensitive(
    existing.edge.sensitivity,
    edge.sensitivity,
  );
  existing.edge.isConfirmed = existing.edge.isConfirmed || edge.isConfirmed;
  existing.edge.callCount =
    (existing.edge.callCount || 0) + (edge.callCount || 0);
  existing.edge.overlapPercent = Math.max(
    existing.edge.overlapPercent || 0,
    edge.overlapPercent || 0,
  );
  existing.risk = Math.max(existing.risk, risk);
}

export function buildDataPathGraph(input: DataPathInput): DataPathGraph {
  const storeNode: DataPathNode = {
    id: DATA_PATH_STORE_NODE_ID,
    kind: DataPathNodeKind.Store,
    column: DATA_PATH_COLUMN_STORE,
    name: input.store.name,
    storeId: input.store.id,
    storeKind: input.store.kind,
    sensitivity: input.store.sensitivity,
    exposure: input.store.exposure,
  };

  // WHO CAN REACH IT.
  const identities: Array<DataPathNode> = getIdentityNodes(input.access);
  const shownIdentities: Array<DataPathNode> = identities.slice(
    0,
    DATA_PATH_MAX_IDENTITIES,
  );
  /*
   * The entries not read - a store with more than the page reads - count
   * one identity each: at most that many more, never fewer.
   */
  const unreadEntries: number = Math.max(
    0,
    input.accessTotal - input.access.length,
  );
  const hiddenIdentities: number =
    identities.length - shownIdentities.length + unreadEntries;

  // SERVICES THAT USE IT.
  const services: Map<string, ServiceDraft> = new Map();

  const addService: (
    serviceId: string | undefined,
    name: string | undefined,
    callCount: number,
  ) => ServiceDraft = (
    serviceId: string | undefined,
    name: string | undefined,
    callCount: number,
  ): ServiceDraft => {
    const key: string = serviceKeyOf(serviceId, name);
    const existing: ServiceDraft | undefined = services.get(key);

    if (existing) {
      existing.callCount += callCount;
      existing.node.name = existing.node.name || name || "";
      return existing;
    }

    const draft: ServiceDraft = {
      node: {
        id: key,
        kind: DataPathNodeKind.Service,
        column: DATA_PATH_COLUMN_SERVICES,
        name: name || "",
        serviceId: serviceId,
      },
      callCount: callCount,
      risk: 0,
    };
    services.set(key, draft);
    return draft;
  };

  const destinations: Map<string, DestinationDraft> = new Map();
  const flowEdges: Map<string, EdgeDraft> = new Map();

  // An AI provider or outside host a service sends data to.
  const addOnward: (flow: DataSecurityFlow) => void = (
    flow: DataSecurityFlow,
  ): void => {
    const service: ServiceDraft | undefined = services.get(
      serviceKeyOf(flow.serviceId?.toString(), flow.service?.name?.toString()),
    );
    const destination: string = (flow.destination || "").trim();

    if (!service || !destination) {
      return;
    }

    const isAi: boolean = flow.kind === FLOW_KIND_AI_PROVIDER;
    const key: string = `${isAi ? "provider" : "host"}:${destination.toLowerCase()}`;
    const risk: number = getFlowRisk(flow);
    const draft: DestinationDraft = destinations.get(key) || {
      node: {
        id: key,
        kind: isAi
          ? DataPathNodeKind.AiProvider
          : DataPathNodeKind.ExternalHost,
        column: DATA_PATH_COLUMN_DESTINATIONS,
        name: destination,
      },
      risk: risk,
      sources: new Set<string>(),
    };

    draft.risk = Math.max(draft.risk, risk);
    draft.node.sensitivity = moreSensitive(
      draft.node.sensitivity,
      flow.sensitivity,
    );
    draft.sources.add(service.node.id);
    destinations.set(key, draft);
    service.risk = Math.max(service.risk, risk);

    mergeEdge(
      flowEdges,
      {
        id: `${service.node.id}->${key}`,
        source: service.node.id,
        target: key,
        kind: isAi
          ? DataPathEdgeKind.AiProvider
          : DataPathEdgeKind.ExternalHost,
        sensitivity: flow.sensitivity,
        isConfirmed: Boolean(flow.isConfirmed),
        callCount: flow.callCount || 0,
      },
      risk,
    );
  };

  for (const flow of input.outgoing) {
    if (flow.kind === FLOW_KIND_USES || flow.kind === FLOW_KIND_AI_PROVIDER) {
      // A Uses flow names the service it saw in its destination.
      addService(
        flow.serviceId?.toString(),
        flow.service?.name?.toString() ||
          (flow.kind === FLOW_KIND_USES ? flow.destination : undefined),
        flow.kind === FLOW_KIND_USES ? flow.callCount || 0 : 0,
      );
    }
  }

  // A service the access entries saw in traces, whose flow is not read.
  for (const entry of input.access) {
    if (entry.principalType !== DataStorePrincipalType.Service) {
      continue;
    }

    const principal: string = entry.principal || "";
    const serviceId: string | undefined = ObjectID.isValidUUID(principal)
      ? principal
      : undefined;
    const name: string =
      entry.principalName ||
      (principal.startsWith(NAMED_SERVICE_PREFIX)
        ? principal.slice(NAMED_SERVICE_PREFIX.length)
        : serviceId
          ? ""
          : principal);

    if (!serviceId && !name) {
      continue;
    }

    addService(serviceId, name, 0);
  }

  // WHERE ITS DATA CAN GO.
  const onwardIds: Set<string> = new Set();

  for (const flow of [...input.outgoing, ...input.onward]) {
    const id: string = flow._id?.toString() || "";

    if (id && onwardIds.has(id)) {
      continue;
    }

    if (id) {
      onwardIds.add(id);
    }

    if (
      flow.kind === FLOW_KIND_AI_PROVIDER ||
      flow.kind === FLOW_KIND_EXTERNAL_HOST
    ) {
      addOnward(flow);
    } else if (
      flow.kind === FLOW_KIND_COPY &&
      flow.sourceDataStoreId?.toString() === input.store.id &&
      flow.destinationDataStoreId
    ) {
      const storeId: string = flow.destinationDataStoreId.toString();
      const key: string = `copy:${storeId}`;
      const risk: number = getFlowRisk(flow);
      const draft: DestinationDraft = destinations.get(key) || {
        node: {
          id: key,
          kind: DataPathNodeKind.Copy,
          column: DATA_PATH_COLUMN_DESTINATIONS,
          name: flow.destinationDataStore?.name || "",
          storeId: storeId,
          storeKind: flow.destinationDataStore?.kind || undefined,
        },
        risk: risk,
        sources: new Set<string>(),
      };

      draft.risk = Math.max(draft.risk, risk);
      draft.node.sensitivity = moreSensitive(
        draft.node.sensitivity,
        flow.sensitivity,
      );
      draft.sources.add(DATA_PATH_STORE_NODE_ID);
      destinations.set(key, draft);

      mergeEdge(
        flowEdges,
        {
          id: `${DATA_PATH_STORE_NODE_ID}->${key}`,
          source: DATA_PATH_STORE_NODE_ID,
          target: key,
          kind: DataPathEdgeKind.Copy,
          sensitivity: flow.sensitivity,
          // A copy is found by its values: it is always there.
          isConfirmed: true,
          overlapPercent: flow.overlapPercent || 0,
        },
        risk,
      );
    }
  }

  // The services, the ones with the riskiest flows onward first.
  const rankedServices: Array<ServiceDraft> = Array.from(
    services.values(),
  ).sort((a: ServiceDraft, b: ServiceDraft): number => {
    return (
      b.risk - a.risk ||
      b.callCount - a.callCount ||
      compareNames(a.node, b.node)
    );
  });
  const shownServices: Array<ServiceDraft> = rankedServices.slice(
    0,
    DATA_PATH_MAX_SERVICES,
  );
  const shownServiceIds: Set<string> = new Set(
    shownServices.map((service: ServiceDraft): string => {
      return service.node.id;
    }),
  );

  /*
   * The places reached from a service on the map, or from the store. One
   * reached only through services folded into "+N more" goes with them.
   */
  const reachable: Array<DestinationDraft> = Array.from(
    destinations.values(),
  ).filter((destination: DestinationDraft): boolean => {
    return Array.from(destination.sources).some((source: string): boolean => {
      return source === DATA_PATH_STORE_NODE_ID || shownServiceIds.has(source);
    });
  });
  const shownDestinations: Array<DestinationDraft> = [...reachable]
    .sort((a: DestinationDraft, b: DestinationDraft): number => {
      return b.risk - a.risk || compareNames(a.node, b.node);
    })
    .slice(0, DATA_PATH_MAX_DESTINATIONS);

  /*
   * Top to bottom by the services they are reached from, so arrows cross
   * as little as they can; the store's copies under them.
   */
  const serviceRow: Map<string, number> = new Map(
    shownServices.map((service: ServiceDraft, index: number) => {
      return [service.node.id, index];
    }),
  );
  const destinationRow: (destination: DestinationDraft) => number = (
    destination: DestinationDraft,
  ): number => {
    const rows: Array<number> = Array.from(destination.sources)
      .map((source: string): number | undefined => {
        return serviceRow.get(source);
      })
      .filter((row: number | undefined): row is number => {
        return row !== undefined;
      });

    return rows.length > 0
      ? rows.reduce((sum: number, row: number): number => {
          return sum + row;
        }, 0) / rows.length
      : Number.MAX_SAFE_INTEGER;
  };
  shownDestinations.sort((a: DestinationDraft, b: DestinationDraft): number => {
    return (
      destinationRow(a) - destinationRow(b) ||
      b.risk - a.risk ||
      compareNames(a.node, b.node)
    );
  });

  const nodes: Array<DataPathNode> = [
    ...shownIdentities,
    ...(hiddenIdentities > 0
      ? [
          moreNode(
            DATA_PATH_COLUMN_REACH,
            hiddenIdentities,
            DataPathMoreTarget.Access,
          ),
        ]
      : []),
    storeNode,
    ...shownServices.map((service: ServiceDraft): DataPathNode => {
      return service.node;
    }),
    ...(rankedServices.length > shownServices.length
      ? [
          moreNode(
            DATA_PATH_COLUMN_SERVICES,
            rankedServices.length - shownServices.length,
            DataPathMoreTarget.Flows,
          ),
        ]
      : []),
    ...shownDestinations.map((destination: DestinationDraft): DataPathNode => {
      return destination.node;
    }),
    ...(reachable.length > shownDestinations.length
      ? [
          moreNode(
            DATA_PATH_COLUMN_DESTINATIONS,
            reachable.length - shownDestinations.length,
            DataPathMoreTarget.Flows,
          ),
        ]
      : []),
  ];
  const nodeIds: Set<string> = new Set(
    nodes.map((node: DataPathNode): string => {
      return node.id;
    }),
  );

  const edges: Array<DataPathEdge> = [
    ...shownIdentities.map((identity: DataPathNode): DataPathEdge => {
      return {
        id: `${identity.id}->${DATA_PATH_STORE_NODE_ID}`,
        source: identity.id,
        target: DATA_PATH_STORE_NODE_ID,
        kind: DataPathEdgeKind.Access,
        accessLevel: identity.accessLevel,
        reach: identity.reach,
        isConfirmed: true,
      };
    }),
    ...shownServices.map((service: ServiceDraft): DataPathEdge => {
      return {
        id: `${DATA_PATH_STORE_NODE_ID}->${service.node.id}`,
        source: DATA_PATH_STORE_NODE_ID,
        target: service.node.id,
        kind: DataPathEdgeKind.Uses,
        sensitivity: input.store.sensitivity,
        isConfirmed: true,
        callCount: service.callCount,
      };
    }),
    ...Array.from(flowEdges.values())
      .filter((draft: EdgeDraft): boolean => {
        return nodeIds.has(draft.edge.source) && nodeIds.has(draft.edge.target);
      })
      .sort((a: EdgeDraft, b: EdgeDraft): number => {
        return b.risk - a.risk || a.edge.id.localeCompare(b.edge.id);
      })
      .map((draft: EdgeDraft): DataPathEdge => {
        return draft.edge;
      }),
  ];

  return {
    nodes: nodes,
    edges: edges,
    isEmpty: nodes.length === 1,
  };
}

// WHERE EACH CARD SITS.

export const DATA_PATH_CARD_WIDTH: number = 220;
// A card with a line of chips under its name, the tallest a card gets.
export const DATA_PATH_CARD_TALLEST: number = 84;
export const DATA_PATH_COLUMN_GAP: number = 300;
export const DATA_PATH_ROW_GAP: number = 104;
// How far above the highest card the column headings sit.
export const DATA_PATH_HEADING_OFFSET: number = 64;

export interface DataPathPoint {
  x: number;
  y: number;
}

export interface DataPathHeading {
  column: number;
  x: number;
  y: number;
}

export interface DataPathLayout {
  positions: Map<string, DataPathPoint>;
  // One heading over each column with a card, all on one line.
  headings: Array<DataPathHeading>;
  // The most cards any column holds.
  rows: number;
}

/*
 * Columns left to right, each column's cards stacked in the order the
 * graph gives them and centred on the store's line, so its arrows fan out
 * evenly above and below it. The same graph always lands the same way.
 */
export function layoutDataPaths(graph: DataPathGraph): DataPathLayout {
  const columns: Map<number, Array<DataPathNode>> = new Map();

  for (const node of graph.nodes) {
    const column: Array<DataPathNode> = columns.get(node.column) || [];
    column.push(node);
    columns.set(node.column, column);
  }

  const positions: Map<string, DataPathPoint> = new Map();
  let rows: number = 0;
  let top: number = 0;

  for (const [column, nodes] of columns) {
    rows = Math.max(rows, nodes.length);

    for (let index: number = 0; index < nodes.length; index++) {
      const y: number = (index - (nodes.length - 1) / 2) * DATA_PATH_ROW_GAP;
      top = Math.min(top, y);
      positions.set(nodes[index]!.id, {
        x: column * DATA_PATH_COLUMN_GAP,
        y: y,
      });
    }
  }

  const headings: Array<DataPathHeading> = Array.from(columns.keys())
    .sort((a: number, b: number): number => {
      return a - b;
    })
    .map((column: number): DataPathHeading => {
      return {
        column: column,
        x: column * DATA_PATH_COLUMN_GAP,
        y: top - DATA_PATH_HEADING_OFFSET,
      };
    });

  return { positions: positions, headings: headings, rows: rows };
}

/*
 * How wide and tall the drawing is, headings included, before it is fitted
 * to its canvas: the canvas takes its shape, so a wide, short map is not
 * drawn in a tall, mostly empty box on a narrow screen.
 */
export function getDataPathDrawingSize(layout: DataPathLayout): {
  width: number;
  height: number;
} {
  const columns: Array<number> = layout.headings.map(
    (heading: DataPathHeading): number => {
      return heading.column;
    },
  );
  const span: number =
    columns.length > 0 ? Math.max(...columns) - Math.min(...columns) : 0;

  return {
    width: span * DATA_PATH_COLUMN_GAP + DATA_PATH_CARD_WIDTH,
    height:
      Math.max(0, layout.rows - 1) * DATA_PATH_ROW_GAP +
      DATA_PATH_CARD_TALLEST +
      DATA_PATH_HEADING_OFFSET,
  };
}
