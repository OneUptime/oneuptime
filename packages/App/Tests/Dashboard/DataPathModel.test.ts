import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DataSecurityFlow from "Common/Models/DatabaseModels/DataSecurityFlow";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import DataStoreAccess from "Common/Models/DatabaseModels/DataStoreAccess";
import Service from "Common/Models/DatabaseModels/Service";
import {
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "Common/Types/DataSecurity/DataStoreAccess";
import DataSensitivity from "Common/Types/DataSecurity/DataSensitivity";
import ObjectID from "Common/Types/ObjectID";
import {
  DATA_PATH_CARD_TALLEST,
  DATA_PATH_CARD_WIDTH,
  DATA_PATH_COLUMN_DESTINATIONS,
  DATA_PATH_COLUMN_GAP,
  DATA_PATH_COLUMN_REACH,
  DATA_PATH_COLUMN_SERVICES,
  DATA_PATH_COLUMN_STORE,
  DATA_PATH_HEADING_OFFSET,
  DATA_PATH_MAX_DESTINATIONS,
  DATA_PATH_MAX_IDENTITIES,
  DATA_PATH_MAX_SERVICES,
  DATA_PATH_ROW_GAP,
  DATA_PATH_STORE_NODE_ID,
  DataPathEdge,
  DataPathEdgeKind,
  DataPathGraph,
  DataPathInput,
  DataPathLayout,
  DataPathMoreTarget,
  DataPathNode,
  DataPathNodeKind,
  DataPathReach,
  buildDataPathGraph,
  getDataPathDrawingSize,
  getDataPathServiceIds,
  layoutDataPaths,
} from "../../FeatureSet/Dashboard/src/Components/DataSecurity/DataPathModel";
import {
  FLOW_KIND_AI_PROVIDER,
  FLOW_KIND_COPY,
  FLOW_KIND_EXTERNAL_HOST,
  FLOW_KIND_USES,
} from "../../FeatureSet/Dashboard/src/Components/DataSecurity/FlowKinds";

/*
 * A store's data paths (DataPathModel) decide what its Overview draws:
 * one card per identity that can reach the store, the services that use
 * it, where its data can go from them, and a "+N more" card wherever a
 * column holds more than it shows. These pin what is drawn, where each
 * card sits, and that the Overview draws it.
 */

const STORE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_STORE_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let idCount: number = 0;

// A uuid of its own for each service and flow a test makes.
function uuid(): string {
  idCount += 1;
  return `00000000-0000-4000-8000-${idCount.toString().padStart(12, "0")}`;
}

function grant(fields: {
  principal: string;
  principalName?: string;
  principalType?: DataStorePrincipalType;
  accessLevel?: DataStoreAccessLevel;
  isExternal?: boolean;
  isPublic?: boolean;
  isUnused?: boolean;
}): DataStoreAccess {
  const entry: DataStoreAccess = new DataStoreAccess();
  Object.assign(entry, {
    principalType: DataStorePrincipalType.Role,
    accessLevel: DataStoreAccessLevel.Read,
    isExternal: false,
    isPublic: false,
    isUnused: false,
    ...fields,
  });
  return entry;
}

function service(id: string, name: string): Service {
  const record: Service = new Service();
  record.name = name;
  record._id = id;
  return record;
}

function flow(fields: {
  kind: string;
  sourceDataStoreId?: string;
  serviceId?: string;
  serviceName?: string;
  destinationDataStoreId?: string;
  destinationStoreName?: string;
  destination?: string;
  sensitivity?: DataSensitivity;
  isConfirmed?: boolean;
  overlapPercent?: number;
  callCount?: number;
}): DataSecurityFlow {
  const row: DataSecurityFlow = new DataSecurityFlow();
  row._id = uuid();
  row.kind = fields.kind;

  if (fields.sourceDataStoreId) {
    row.sourceDataStoreId = new ObjectID(fields.sourceDataStoreId);
  }

  if (fields.serviceId) {
    row.serviceId = new ObjectID(fields.serviceId);
    row.service = service(fields.serviceId, fields.serviceName || "");
  }

  if (fields.destinationDataStoreId) {
    row.destinationDataStoreId = new ObjectID(fields.destinationDataStoreId);
    const destination: DataStore = new DataStore();
    destination.name = fields.destinationStoreName || "";
    row.destinationDataStore = destination;
  }

  Object.assign(row, {
    destination: fields.destination,
    sensitivity: fields.sensitivity,
    isConfirmed: fields.isConfirmed || false,
    overlapPercent: fields.overlapPercent || 0,
    callCount: fields.callCount || 0,
  });

  return row;
}

function uses(
  serviceId: string,
  name: string,
  calls: number,
): DataSecurityFlow {
  return flow({
    kind: FLOW_KIND_USES,
    sourceDataStoreId: STORE_ID,
    serviceId: serviceId,
    serviceName: name,
    destination: name,
    callCount: calls,
  });
}

function input(fields: Partial<DataPathInput>): DataPathInput {
  return {
    store: {
      id: STORE_ID,
      name: "payments-exports",
      kind: "AWS S3 Bucket",
      sensitivity: DataSensitivity.Restricted,
      exposure: "Public",
    },
    access: [],
    accessTotal: (fields.access || []).length,
    outgoing: [],
    onward: [],
    ...fields,
  };
}

function inColumn(graph: DataPathGraph, column: number): Array<DataPathNode> {
  return graph.nodes.filter((node: DataPathNode): boolean => {
    return node.column === column;
  });
}

function nodeById(graph: DataPathGraph, id: string): DataPathNode {
  const node: DataPathNode | undefined = graph.nodes.find(
    (candidate: DataPathNode): boolean => {
      return candidate.id === id;
    },
  );

  if (!node) {
    throw new Error(`No card ${id}`);
  }

  return node;
}

function edgeById(graph: DataPathGraph, id: string): DataPathEdge {
  const edge: DataPathEdge | undefined = graph.edges.find(
    (candidate: DataPathEdge): boolean => {
      return candidate.id === id;
    },
  );

  if (!edge) {
    throw new Error(`No arrow ${id}`);
  }

  return edge;
}

describe("A store's data paths: who can reach it", () => {
  test("an identity is one card, at the most any of its grants allows", () => {
    const graph: DataPathGraph = buildDataPathGraph(
      input({
        access: [
          grant({ principal: "arn:aws:iam::1:role/etl", principalName: "etl" }),
          grant({
            principal: "arn:aws:iam::1:role/etl",
            principalName: "etl",
            accessLevel: DataStoreAccessLevel.Admin,
          }),
        ],
      }),
    );

    const identities: Array<DataPathNode> = inColumn(
      graph,
      DATA_PATH_COLUMN_REACH,
    );

    expect(identities).toHaveLength(1);
    expect(identities[0]!.name).toBe("etl");
    expect(identities[0]!.accessLevel).toBe(DataStoreAccessLevel.Admin);
    expect(identities[0]!.grantCount).toBe(2);
    expect(
      edgeById(graph, `${identities[0]!.id}->${DATA_PATH_STORE_NODE_ID}`),
    ).toMatchObject({
      kind: DataPathEdgeKind.Access,
      accessLevel: DataStoreAccessLevel.Admin,
      reach: DataPathReach.Yours,
      isConfirmed: true,
    });
  });

  test("every public grant is one card, anyone on the internet, and the riskiest come first", () => {
    const graph: DataPathGraph = buildDataPathGraph(
      input({
        access: [
          grant({
            principal: "arn:aws:iam::1:user/admin",
            principalName: "admin",
            principalType: DataStorePrincipalType.User,
            accessLevel: DataStoreAccessLevel.Admin,
          }),
          grant({
            principal: "arn:aws:iam::999:role/vendor",
            principalName: "vendor",
            accessLevel: DataStoreAccessLevel.Write,
            isExternal: true,
          }),
          grant({ principal: "*", isPublic: true, isExternal: true }),
          grant({
            principal: "AllUsers",
            principalType: DataStorePrincipalType.Public,
          }),
        ],
      }),
    );

    const identities: Array<DataPathNode> = inColumn(
      graph,
      DATA_PATH_COLUMN_REACH,
    );

    expect(
      identities.map((node: DataPathNode): string => {
        return node.name;
      }),
    ).toEqual(["", "vendor", "admin"]);
    expect(identities[0]).toMatchObject({
      reach: DataPathReach.Public,
      principalType: DataStorePrincipalType.Public,
      grantCount: 2,
    });
    expect(identities[1]!.reach).toBe(DataPathReach.Outside);
    expect(identities[2]!.reach).toBe(DataPathReach.Yours);
  });

  test("an identity is unused only when every one of its grants is", () => {
    const graph: DataPathGraph = buildDataPathGraph(
      input({
        access: [
          grant({ principal: "role/a", isUnused: true }),
          grant({
            principal: "role/a",
            isUnused: false,
            accessLevel: DataStoreAccessLevel.Write,
          }),
          grant({ principal: "role/b", isUnused: true }),
        ],
      }),
    );

    expect(nodeById(graph, "identity:role/a").isUnused).toBe(false);
    expect(nodeById(graph, "identity:role/b").isUnused).toBe(true);
  });

  test("a service seen in traces is drawn with the services, not with who can reach it", () => {
    const billingId: string = uuid();
    const graph: DataPathGraph = buildDataPathGraph(
      input({
        access: [
          grant({
            principal: billingId,
            principalName: "billing-api",
            principalType: DataStorePrincipalType.Service,
          }),
          grant({
            principal: "service:checkout",
            principalType: DataStorePrincipalType.Service,
          }),
        ],
      }),
    );

    expect(inColumn(graph, DATA_PATH_COLUMN_REACH)).toHaveLength(0);
    expect(nodeById(graph, `service:${billingId}`)).toMatchObject({
      kind: DataPathNodeKind.Service,
      name: "billing-api",
      serviceId: billingId,
    });
    expect(nodeById(graph, "service-name:checkout")).toMatchObject({
      name: "checkout",
      serviceId: undefined,
    });
  });

  test("a column holding more identities than it shows folds the rest into +N more, counting the entries not read", () => {
    const access: Array<DataStoreAccess> = [];

    for (let index: number = 0; index < DATA_PATH_MAX_IDENTITIES + 3; index++) {
      access.push(grant({ principal: `role/${index}` }));
    }

    const graph: DataPathGraph = buildDataPathGraph(
      input({ access: access, accessTotal: access.length + 3 }),
    );
    const column: Array<DataPathNode> = inColumn(graph, DATA_PATH_COLUMN_REACH);

    expect(column).toHaveLength(DATA_PATH_MAX_IDENTITIES + 1);
    expect(column[column.length - 1]).toMatchObject({
      kind: DataPathNodeKind.More,
      moreCount: 6,
      moreTarget: DataPathMoreTarget.Access,
    });
    // "+N more" opens the list; it has no arrow of its own.
    expect(
      graph.edges.filter((edge: DataPathEdge): boolean => {
        return edge.source === column[column.length - 1]!.id;
      }),
    ).toHaveLength(0);
  });
});

describe("A store's data paths: what uses it and where its data can go", () => {
  test("the services that use it come from its Uses flows, named by the service or by the flow", () => {
    const billingId: string = uuid();
    const graph: DataPathGraph = buildDataPathGraph(
      input({
        outgoing: [
          uses(billingId, "billing-api", 120),
          flow({
            kind: FLOW_KIND_USES,
            sourceDataStoreId: STORE_ID,
            destination: "legacy-cron",
            callCount: 4,
          }),
        ],
      }),
    );

    expect(
      inColumn(graph, DATA_PATH_COLUMN_SERVICES).map(
        (node: DataPathNode): string => {
          return node.name;
        },
      ),
    ).toEqual(["billing-api", "legacy-cron"]);
    expect(
      edgeById(graph, `${DATA_PATH_STORE_NODE_ID}->service:${billingId}`),
    ).toMatchObject({ kind: DataPathEdgeKind.Uses, callCount: 120 });
    expect(
      edgeById(graph, `${DATA_PATH_STORE_NODE_ID}->service-name:legacy-cron`)
        .callCount,
    ).toBe(4);
  });

  test("a service's AI and outside calls are where the store's data can go, confirmed only when a scan proved it", () => {
    const billingId: string = uuid();
    const graph: DataPathGraph = buildDataPathGraph(
      input({
        outgoing: [uses(billingId, "billing-api", 10)],
        onward: [
          flow({
            kind: FLOW_KIND_AI_PROVIDER,
            serviceId: billingId,
            destination: "OpenAI",
            sensitivity: DataSensitivity.Restricted,
            isConfirmed: true,
            callCount: 30,
          }),
          flow({
            kind: FLOW_KIND_EXTERNAL_HOST,
            serviceId: billingId,
            destination: "api.stripe.com",
            sensitivity: DataSensitivity.Public,
            callCount: 7,
          }),
        ],
      }),
    );

    expect(nodeById(graph, "provider:openai")).toMatchObject({
      kind: DataPathNodeKind.AiProvider,
      column: DATA_PATH_COLUMN_DESTINATIONS,
      name: "OpenAI",
      sensitivity: DataSensitivity.Restricted,
    });
    expect(nodeById(graph, "host:api.stripe.com").kind).toBe(
      DataPathNodeKind.ExternalHost,
    );
    expect(
      edgeById(graph, `service:${billingId}->provider:openai`),
    ).toMatchObject({
      kind: DataPathEdgeKind.AiProvider,
      sensitivity: DataSensitivity.Restricted,
      isConfirmed: true,
      callCount: 30,
    });
    expect(
      edgeById(graph, `service:${billingId}->host:api.stripe.com`).isConfirmed,
    ).toBe(false);
  });

  test("a provider two services reach is one card with an arrow from each", () => {
    const aId: string = uuid();
    const bId: string = uuid();
    const graph: DataPathGraph = buildDataPathGraph(
      input({
        outgoing: [uses(aId, "a", 1), uses(bId, "b", 1)],
        onward: [
          flow({
            kind: FLOW_KIND_AI_PROVIDER,
            serviceId: aId,
            destination: "anthropic",
          }),
          flow({
            kind: FLOW_KIND_AI_PROVIDER,
            serviceId: bId,
            destination: "Anthropic",
          }),
        ],
      }),
    );

    expect(inColumn(graph, DATA_PATH_COLUMN_DESTINATIONS)).toHaveLength(1);
    expect(
      graph.edges.filter((edge: DataPathEdge): boolean => {
        return edge.target === "provider:anthropic";
      }),
    ).toHaveLength(2);
  });

  test("a flow onward from a service that does not use the store is not drawn", () => {
    const graph: DataPathGraph = buildDataPathGraph(
      input({
        onward: [
          flow({
            kind: FLOW_KIND_AI_PROVIDER,
            serviceId: uuid(),
            destination: "openai",
          }),
        ],
      }),
    );

    expect(graph.isEmpty).toBe(true);
    expect(graph.nodes).toHaveLength(1);
  });

  test("a copy of the store goes straight from the store, and is always confirmed", () => {
    const graph: DataPathGraph = buildDataPathGraph(
      input({
        outgoing: [
          flow({
            kind: FLOW_KIND_COPY,
            sourceDataStoreId: STORE_ID,
            destinationDataStoreId: OTHER_STORE_ID,
            destinationStoreName: "staging-dump",
            sensitivity: DataSensitivity.Restricted,
            overlapPercent: 72,
          }),
          // A copy into another store from somewhere else is not this store's.
          flow({
            kind: FLOW_KIND_COPY,
            sourceDataStoreId: OTHER_STORE_ID,
            destinationDataStoreId: STORE_ID,
          }),
        ],
      }),
    );

    expect(inColumn(graph, DATA_PATH_COLUMN_DESTINATIONS)).toEqual([
      expect.objectContaining({
        id: `copy:${OTHER_STORE_ID}`,
        kind: DataPathNodeKind.Copy,
        name: "staging-dump",
        storeId: OTHER_STORE_ID,
        sensitivity: DataSensitivity.Restricted,
      }),
    ]);
    expect(
      edgeById(graph, `${DATA_PATH_STORE_NODE_ID}->copy:${OTHER_STORE_ID}`),
    ).toMatchObject({
      kind: DataPathEdgeKind.Copy,
      isConfirmed: true,
      overlapPercent: 72,
    });
  });

  test("a service's AI conversations draw the service, then the providers they are sent to", () => {
    const assistantId: string = uuid();
    const graph: DataPathGraph = buildDataPathGraph(
      input({
        store: { id: STORE_ID, name: "AI Conversations of assistant" },
        outgoing: [
          flow({
            kind: FLOW_KIND_AI_PROVIDER,
            sourceDataStoreId: STORE_ID,
            serviceId: assistantId,
            serviceName: "assistant",
            destination: "anthropic",
            sensitivity: DataSensitivity.Confidential,
            isConfirmed: true,
          }),
        ],
      }),
    );

    expect(inColumn(graph, DATA_PATH_COLUMN_SERVICES)).toEqual([
      expect.objectContaining({ name: "assistant", serviceId: assistantId }),
    ]);
    expect(
      edgeById(graph, `service:${assistantId}->provider:anthropic`),
    ).toMatchObject({
      sensitivity: DataSensitivity.Confidential,
      isConfirmed: true,
    });
  });

  test("the riskiest service comes first: the one sending Restricted data out", () => {
    const busyId: string = uuid();
    const leakyId: string = uuid();
    const graph: DataPathGraph = buildDataPathGraph(
      input({
        outgoing: [uses(busyId, "busy", 5000), uses(leakyId, "leaky", 3)],
        onward: [
          flow({
            kind: FLOW_KIND_AI_PROVIDER,
            serviceId: leakyId,
            destination: "openai",
            sensitivity: DataSensitivity.Restricted,
            isConfirmed: true,
          }),
        ],
      }),
    );

    expect(
      inColumn(graph, DATA_PATH_COLUMN_SERVICES).map(
        (node: DataPathNode): string => {
          return node.name;
        },
      ),
    ).toEqual(["leaky", "busy"]);
  });

  test("services and places beyond what a column shows fold into +N more, and places behind a folded service go with it", () => {
    const outgoing: Array<DataSecurityFlow> = [];
    const onward: Array<DataSecurityFlow> = [];
    const serviceIds: Array<string> = [];

    for (let index: number = 0; index < DATA_PATH_MAX_SERVICES + 2; index++) {
      const id: string = uuid();
      serviceIds.push(id);
      outgoing.push(uses(id, `service-${index}`, 1000 - index));
    }

    // Ten hosts from the first service; the next five call the first host too.
    for (
      let index: number = 0;
      index < DATA_PATH_MAX_DESTINATIONS + 2;
      index++
    ) {
      onward.push(
        flow({
          kind: FLOW_KIND_EXTERNAL_HOST,
          serviceId: serviceIds[0]!,
          destination: `host-${index}.example.com`,
          callCount: 100,
        }),
      );
    }

    for (let index: number = 1; index < DATA_PATH_MAX_SERVICES; index++) {
      onward.push(
        flow({
          kind: FLOW_KIND_EXTERNAL_HOST,
          serviceId: serviceIds[index]!,
          destination: "host-0.example.com",
          callCount: 100,
        }),
      );
    }

    /*
     * The last service calls out too, less than the six above it, so it is
     * folded into "+N more" - and the host only it calls goes with it.
     */
    onward.push(
      flow({
        kind: FLOW_KIND_EXTERNAL_HOST,
        serviceId: serviceIds[serviceIds.length - 1]!,
        destination: "hidden.example.com",
      }),
    );

    const graph: DataPathGraph = buildDataPathGraph(
      input({ outgoing: outgoing, onward: onward }),
    );
    const services: Array<DataPathNode> = inColumn(
      graph,
      DATA_PATH_COLUMN_SERVICES,
    );
    const places: Array<DataPathNode> = inColumn(
      graph,
      DATA_PATH_COLUMN_DESTINATIONS,
    );

    expect(services).toHaveLength(DATA_PATH_MAX_SERVICES + 1);
    expect(services[services.length - 1]).toMatchObject({
      kind: DataPathNodeKind.More,
      moreCount: 2,
      moreTarget: DataPathMoreTarget.Flows,
    });
    expect(places).toHaveLength(DATA_PATH_MAX_DESTINATIONS + 1);
    expect(places[places.length - 1]).toMatchObject({
      kind: DataPathNodeKind.More,
      moreCount: 2,
      moreTarget: DataPathMoreTarget.Flows,
    });
    expect(
      graph.nodes.some((node: DataPathNode): boolean => {
        return node.id === "host:hidden.example.com";
      }),
    ).toBe(false);
    // Every arrow joins two cards on the map.
    const ids: Set<string> = new Set(
      graph.nodes.map((node: DataPathNode): string => {
        return node.id;
      }),
    );
    for (const edge of graph.edges) {
      expect(ids.has(edge.source) && ids.has(edge.target)).toBe(true);
    }
  });

  test("a store nobody reaches and nothing uses is empty", () => {
    const graph: DataPathGraph = buildDataPathGraph(input({}));

    expect(graph.isEmpty).toBe(true);
    expect(graph.nodes).toEqual([
      expect.objectContaining({
        id: DATA_PATH_STORE_NODE_ID,
        kind: DataPathNodeKind.Store,
        column: DATA_PATH_COLUMN_STORE,
        storeId: STORE_ID,
        sensitivity: DataSensitivity.Restricted,
        exposure: "Public",
      }),
    ]);
    expect(graph.edges).toEqual([]);
  });
});

describe("A store's data paths: the services whose flows are read", () => {
  test("are the ones its Uses and AI flows name and the ones seen in traces, each once", () => {
    const aId: string = uuid();
    const bId: string = uuid();
    const cId: string = uuid();

    expect(
      getDataPathServiceIds(
        [
          grant({
            principal: cId,
            principalType: DataStorePrincipalType.Service,
          }),
          grant({
            principal: "service:no-record",
            principalType: DataStorePrincipalType.Service,
          }),
          grant({ principal: aId }),
        ],
        [
          uses(aId, "a", 1),
          uses(aId, "a", 2),
          flow({
            kind: FLOW_KIND_AI_PROVIDER,
            sourceDataStoreId: STORE_ID,
            serviceId: bId,
          }),
          flow({
            kind: FLOW_KIND_EXTERNAL_HOST,
            serviceId: uuid(),
            destination: "x.example.com",
          }),
        ],
      ),
    ).toEqual([aId, bId, cId].sort());
  });
});

describe("A store's data paths: where each card sits", () => {
  const billingId: string = "11111111-1111-4111-8111-111111111111";
  const searchId: string = "22222222-2222-4222-8222-222222222222";

  const graph: DataPathGraph = buildDataPathGraph(
    input({
      access: [
        grant({ principal: "role/a" }),
        grant({ principal: "role/b" }),
        grant({ principal: "role/c" }),
      ],
      outgoing: [
        uses(billingId, "billing-api", 10),
        uses(searchId, "search", 5),
        flow({
          kind: FLOW_KIND_COPY,
          sourceDataStoreId: STORE_ID,
          destinationDataStoreId: OTHER_STORE_ID,
          destinationStoreName: "staging-dump",
          sensitivity: DataSensitivity.Restricted,
          overlapPercent: 60,
        }),
      ],
      onward: [
        flow({
          kind: FLOW_KIND_EXTERNAL_HOST,
          serviceId: searchId,
          destination: "search.example.com",
        }),
        flow({
          kind: FLOW_KIND_EXTERNAL_HOST,
          serviceId: billingId,
          destination: "billing.example.com",
        }),
      ],
    }),
  );
  const layout: DataPathLayout = layoutDataPaths(graph);

  test("columns run left to right, and each is centred on the store's line", () => {
    for (const node of graph.nodes) {
      expect(layout.positions.get(node.id)!.x).toBe(
        node.column * DATA_PATH_COLUMN_GAP,
      );
    }

    expect(layout.positions.get(DATA_PATH_STORE_NODE_ID)).toEqual({
      x: DATA_PATH_COLUMN_STORE * DATA_PATH_COLUMN_GAP,
      y: 0,
    });

    for (const column of [
      DATA_PATH_COLUMN_REACH,
      DATA_PATH_COLUMN_SERVICES,
      DATA_PATH_COLUMN_DESTINATIONS,
    ]) {
      const ys: Array<number> = inColumn(graph, column).map(
        (node: DataPathNode): number => {
          return layout.positions.get(node.id)!.y;
        },
      );

      expect(
        ys.reduce((sum: number, y: number): number => {
          return sum + y;
        }, 0),
      ).toBeCloseTo(0);

      for (let index: number = 1; index < ys.length; index++) {
        expect(ys[index]! - ys[index - 1]!).toBe(DATA_PATH_ROW_GAP);
      }
    }

    expect(layout.rows).toBe(3);
  });

  test("places sit beside the services they are reached from, the store's copies under them", () => {
    expect(
      inColumn(graph, DATA_PATH_COLUMN_SERVICES).map(
        (node: DataPathNode): string => {
          return node.name;
        },
      ),
    ).toEqual(["billing-api", "search"]);
    expect(
      inColumn(graph, DATA_PATH_COLUMN_DESTINATIONS).map(
        (node: DataPathNode): string => {
          return node.name;
        },
      ),
    ).toEqual(["billing.example.com", "search.example.com", "staging-dump"]);
  });

  test("one heading over each column, all on one line above the highest card", () => {
    const top: number = Math.min(
      ...Array.from(layout.positions.values()).map(
        (point: { x: number; y: number }): number => {
          return point.y;
        },
      ),
    );

    expect(layout.headings).toEqual(
      [0, 1, 2, 3].map((column: number) => {
        return {
          column: column,
          x: column * DATA_PATH_COLUMN_GAP,
          y: top - DATA_PATH_HEADING_OFFSET,
        };
      }),
    );
  });

  test("the same paths always land the same way", () => {
    const again: DataPathLayout = layoutDataPaths(graph);

    expect(Array.from(again.positions.entries())).toEqual(
      Array.from(layout.positions.entries()),
    );
  });

  test("the drawing is as wide as its columns and as tall as its tallest column, headings included", () => {
    expect(getDataPathDrawingSize(layout)).toEqual({
      width: 3 * DATA_PATH_COLUMN_GAP + DATA_PATH_CARD_WIDTH,
      height:
        2 * DATA_PATH_ROW_GAP +
        DATA_PATH_CARD_TALLEST +
        DATA_PATH_HEADING_OFFSET,
    });

    // The store and its copy alone: two columns wide, one card tall.
    const copyOnly: DataPathLayout = layoutDataPaths(
      buildDataPathGraph(
        input({
          outgoing: [
            flow({
              kind: FLOW_KIND_COPY,
              sourceDataStoreId: STORE_ID,
              destinationDataStoreId: OTHER_STORE_ID,
            }),
          ],
        }),
      ),
    );

    expect(getDataPathDrawingSize(copyOnly)).toEqual({
      width:
        (DATA_PATH_COLUMN_DESTINATIONS - DATA_PATH_COLUMN_STORE) *
          DATA_PATH_COLUMN_GAP +
        DATA_PATH_CARD_WIDTH,
      height: DATA_PATH_CARD_TALLEST + DATA_PATH_HEADING_OFFSET,
    });
  });
});

describe("A store's data paths on its Overview", () => {
  test("are drawn between what is inside it and what to fix first", () => {
    const overview: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../FeatureSet/Dashboard/src/Pages/DataSecurity/StoreView/Overview.tsx",
      ),
      "utf8",
    );
    const paths: number = overview.indexOf("<StoreDataPaths");

    expect(paths).toBeGreaterThan(overview.indexOf('title="Configuration"'));
    expect(paths).toBeLessThan(overview.indexOf('title="Fix These First"'));
    // Read again whenever the Overview reads the store again.
    expect(overview).toMatch(/<StoreDataPaths[^>]*refreshToken=\{readCount\}/);
  });
});
