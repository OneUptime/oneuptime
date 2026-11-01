import DataSecurityFlows, {
  COPY_OVERLAP_THRESHOLD,
  FLOW_RETENTION_IN_DAYS,
} from "../../../../Server/Utils/DataSecurity/DataSecurityFlows";
import {
  buildFingerprint,
  estimateOverlap,
  FINGERPRINT_SLOTS,
} from "../../../../Server/Utils/DataSecurity/Fingerprint";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DatabaseServerService from "../../../../Server/Services/DatabaseServerService";
import DataSecurityFlowService from "../../../../Server/Services/DataSecurityFlowService";
import InventoryItemRelationshipService from "../../../../Server/Services/InventoryItemRelationshipService";
import InventoryItemService from "../../../../Server/Services/InventoryItemService";
import SpanService from "../../../../Server/Services/SpanService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import logger from "../../../../Server/Utils/Logger";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import DatabaseServer from "../../../../Models/DatabaseModels/DatabaseServer";
import DataSecurityFlow from "../../../../Models/DatabaseModels/DataSecurityFlow";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "../../../../Models/DatabaseModels/InventoryItemRelationship";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import EntityType from "../../../../Types/Telemetry/EntityType";
import DataSensitivity from "../../../../Types/DataSecurity/DataSensitivity";
import DataStoreEnvironment from "../../../../Types/DataSecurity/DataStoreEnvironment";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import {
  telemetryDataStoreKey,
  tracedDatabaseDataStoreKey,
} from "../../../../Types/DataSecurity/DataStoreKey";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Where a project's sensitive data goes (DataSecurityFlows): copies found
 * by comparing stores' fingerprints, the databases services use from the
 * service map, hosts they call, and the AI providers their LLM spans name.
 * The service map, the span store and the flow table are stood in for;
 * the fingerprints are the real sketches of the values written here.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const KEY: string = "fingerprint-key-of-the-test-project";

type FlowDraft = ReturnType<typeof DataSecurityFlows.copyFlows>[number];

let edges: Array<InventoryItemRelationship>;
let items: Array<InventoryItem>;
let servers: Array<DatabaseServer>;
let resources: Array<CloudResource>;
let spanRows: Array<JSONObject>;
let flowTable: Array<DataSecurityFlow>;
let createSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;
let deleteSpy: jest.SpyInstance;
let spanSpy: jest.SpyInstance;
let serversSpy: jest.SpyInstance;
let resourcesSpy: jest.SpyInstance;
let edgesSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  edges = [];
  items = [];
  servers = [];
  resources = [];
  spanRows = [];
  flowTable = [];

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });
  edgesSpy = jest
    .spyOn(InventoryItemRelationshipService, "findBy")
    .mockImplementation((async () => {
      return edges;
    }) as never);
  jest
    .spyOn(InventoryItemService, "findBy")
    .mockImplementation((async (findBy: { query: JSONObject }) => {
      const keys: Array<string> = (findBy.query["entityKey"] as Includes)
        .values as Array<string>;

      return items.filter((item: InventoryItem) => {
        return keys.includes(item.entityKey || "");
      });
    }) as never);
  serversSpy = jest
    .spyOn(DatabaseServerService, "findBy")
    .mockImplementation((async () => {
      return servers;
    }) as never);
  resourcesSpy = jest
    .spyOn(CloudResourceService, "findBy")
    .mockImplementation((async () => {
      return resources;
    }) as never);
  spanSpy = jest
    .spyOn(SpanService, "executeQuery")
    .mockImplementation((async () => {
      return {
        json: async (): Promise<JSONObject> => {
          return { data: spanRows };
        },
      };
    }) as never);

  // Rows as Postgres returns them: detached copies of the selected columns.
  jest
    .spyOn(DataSecurityFlowService, "findBy")
    .mockImplementation((async () => {
      return flowTable.map((row: DataSecurityFlow): DataSecurityFlow => {
        const copy: DataSecurityFlow = new DataSecurityFlow(row.id!);
        copy.flowKey = row.flowKey!;

        if (row.lastSeenAt) {
          copy.lastSeenAt = new Date(row.lastSeenAt.getTime());
        }

        return copy;
      });
    }) as never);
  createSpy = jest
    .spyOn(DataSecurityFlowService, "create")
    .mockImplementation((async (
      createBy: CreateBy<DataSecurityFlow>,
    ): Promise<DataSecurityFlow> => {
      createBy.data.id = ObjectID.generate();
      flowTable.push(createBy.data);
      return createBy.data;
    }) as never);
  updateSpy = jest
    .spyOn(DataSecurityFlowService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      const row: DataSecurityFlow | undefined = flowTable.find(
        (flow: DataSecurityFlow) => {
          return flow.id?.toString() === data.id.toString();
        },
      );

      for (const [column, value] of Object.entries(data.data)) {
        row?.setColumnValue(column, value);
      }
    }) as never);
  deleteSpy = jest
    .spyOn(DataSecurityFlowService, "deleteOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      flowTable = flowTable.filter((flow: DataSecurityFlow) => {
        return flow.id?.toString() !== data.id.toString();
      });
    }) as never);
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function valuesOf(prefix: string, from: number, to: number): Array<string> {
  const values: Array<string> = [];

  for (let index: number = from; index < to; index++) {
    values.push(`${prefix}${index}@acme.io`);
  }

  return values;
}

function storeOf(data: {
  name: string;
  environment?: DataStoreEnvironment | undefined;
  firstSeenAt?: Date | undefined;
  sensitivity?: DataSensitivity | undefined;
  sensitivityOverride?: DataSensitivity | undefined;
  fingerprints?: JSONObject | undefined;
  storeKey?: string | undefined;
  dataTypeIds?: Array<string> | undefined;
  databaseServerId?: ObjectID | undefined;
  cloudResourceId?: ObjectID | undefined;
}): DataStore {
  const store: DataStore = new DataStore(ObjectID.generate());
  store.projectId = PROJECT_ID;
  store.name = data.name;
  store.environment = data.environment || DataStoreEnvironment.Unknown;
  store.firstSeenAt = data.firstSeenAt || new Date("2026-01-01T00:00:00.000Z");

  if (data.sensitivity) {
    store.sensitivity = data.sensitivity;
  }

  if (data.sensitivityOverride) {
    store.sensitivityOverride = data.sensitivityOverride;
  }

  if (data.fingerprints) {
    store.fingerprints = data.fingerprints;
  }

  if (data.storeKey) {
    store.storeKey = data.storeKey;
  }

  if (data.dataTypeIds) {
    store.dataTypeIds = data.dataTypeIds;
  }

  if (data.databaseServerId) {
    store.databaseServerId = data.databaseServerId;
  }

  if (data.cloudResourceId) {
    store.cloudResourceId = data.cloudResourceId;
  }

  return store;
}

function itemOf(data: {
  entityKey: string;
  entityType: EntityType;
  displayName?: string | undefined;
  attributes?: JSONObject | undefined;
  serviceId?: ObjectID | undefined;
}): InventoryItem {
  const item: InventoryItem = new InventoryItem();
  item.entityKey = data.entityKey;
  item.entityType = data.entityType;

  if (data.displayName) {
    item.displayName = data.displayName;
  }

  if (data.attributes) {
    item.identifyingAttributes = data.attributes;
  }

  if (data.serviceId) {
    item.resourceType = "Service";
    item.resourceId = data.serviceId;
  }

  items.push(item);
  return item;
}

function edgeOf(from: string, to: string, callCount?: number): void {
  const edge: InventoryItemRelationship = new InventoryItemRelationship();
  edge.fromEntityKey = from;
  edge.toEntityKey = to;

  if (callCount !== undefined) {
    edge.callCount = callCount;
  }

  edges.push(edge);
}

function checkoutService(): InventoryItem {
  return itemOf({
    entityKey: "service:checkout",
    entityType: EntityType.Service,
    displayName: "checkout",
    serviceId: SERVICE_ID,
  });
}

function flowWithKey(flowKey: string): DataSecurityFlow {
  const flow: DataSecurityFlow | undefined = flowTable.find(
    (row: DataSecurityFlow) => {
      return row.flowKey === flowKey;
    },
  );

  if (!flow) {
    throw new Error(`No flow ${flowKey}.`);
  }

  return flow;
}

function existingFlow(flowKey: string, daysAgo: number): DataSecurityFlow {
  const flow: DataSecurityFlow = new DataSecurityFlow(ObjectID.generate());
  flow.projectId = PROJECT_ID;
  flow.flowKey = flowKey;
  flow.firstSeenAt = new Date(NOW.getTime() - 90 * DAY_IN_MS);
  flow.lastSeenAt = new Date(NOW.getTime() - daysAgo * DAY_IN_MS);
  flowTable.push(flow);
  return flow;
}

function compute(stores: Array<DataStore>): Promise<void> {
  return DataSecurityFlows.computeProjectFlows(PROJECT_ID, stores);
}

describe("the flow kinds and limits", () => {
  test("are what the evaluator and the pages read", () => {
    expect(DataSecurityFlows.USES).toBe("Uses");
    expect(DataSecurityFlows.AI_PROVIDER).toBe("AI Provider");
    expect(DataSecurityFlows.EXTERNAL_HOST).toBe("External Host");
    expect(DataSecurityFlows.COPY).toBe("Copy");
    expect(FLOW_RETENTION_IN_DAYS).toBe(30);
    expect(COPY_OVERLAP_THRESHOLD).toBe(0.5);
  });
});

describe("copyFlows: copies found by fingerprint", () => {
  const customers: Array<string> = valuesOf("customer", 0, 400);

  test("two stores holding the same values are a copy, from production to the store that is not", () => {
    const dev: DataStore = storeOf({
      name: "orders-dev",
      environment: DataStoreEnvironment.Development,
      firstSeenAt: new Date("2025-01-01T00:00:00.000Z"),
      sensitivity: DataSensitivity.Confidential,
      fingerprints: { "email-address": buildFingerprint(customers, KEY) },
    });
    const prod: DataStore = storeOf({
      name: "orders-prod",
      environment: DataStoreEnvironment.Production,
      sensitivity: DataSensitivity.Confidential,
      fingerprints: { "email-address": buildFingerprint(customers, KEY) },
    });

    const drafts: Array<FlowDraft> = DataSecurityFlows.copyFlows([dev, prod]);

    expect(drafts).toEqual([
      {
        flowKey: `copy:${prod.id!.toString()}:${dev.id!.toString()}`,
        kind: "Copy",
        sourceDataStoreId: prod.id,
        destinationDataStoreId: dev.id,
        dataTypeIds: ["email-address"],
        sensitivity: DataSensitivity.Confidential,
        isConfirmed: true,
        overlapPercent: 100,
        callCount: 0,
      },
    ]);
  });

  test("between stores of one environment, the copy runs from the store known first", () => {
    const fingerprints: JSONObject = {
      "email-address": buildFingerprint(customers, KEY),
    };
    const older: DataStore = storeOf({
      name: "warehouse",
      firstSeenAt: new Date("2025-03-01T00:00:00.000Z"),
      fingerprints,
    });
    const newer: DataStore = storeOf({
      name: "analytics-exports",
      firstSeenAt: new Date("2026-03-01T00:00:00.000Z"),
      fingerprints,
    });

    const [draft] = DataSecurityFlows.copyFlows([newer, older]);

    expect(draft!.sourceDataStoreId?.toString()).toBe(older.id!.toString());
    expect(draft!.destinationDataStoreId?.toString()).toBe(
      newer.id!.toString(),
    );

    const twin: DataStore = storeOf({
      name: "warehouse-twin",
      firstSeenAt: new Date("2025-03-01T00:00:00.000Z"),
      fingerprints,
    });
    const [tie] = DataSecurityFlows.copyFlows([twin, older]);

    expect(tie!.sourceDataStoreId?.toString()).toBe(twin.id!.toString());
  });

  test("the flow is as sensitive as the more sensitive store, a person's override counting", () => {
    const fingerprints: JSONObject = {
      "email-address": buildFingerprint(customers, KEY),
    };
    const internal: DataStore = storeOf({
      name: "a",
      sensitivity: DataSensitivity.Internal,
      fingerprints,
    });
    const overridden: DataStore = storeOf({
      name: "b",
      sensitivity: DataSensitivity.Internal,
      sensitivityOverride: DataSensitivity.Restricted,
      fingerprints,
    });
    const unknown: DataStore = storeOf({ name: "c", fingerprints });

    expect(
      DataSecurityFlows.copyFlows([internal, overridden])[0]!.sensitivity,
    ).toBe(DataSensitivity.Restricted);
    expect(
      DataSecurityFlows.copyFlows([unknown, internal])[0]!.sensitivity,
    ).toBe(DataSensitivity.Internal);
    expect(
      DataSecurityFlows.copyFlows([
        unknown,
        storeOf({ name: "d", fingerprints }),
      ])[0]!.sensitivity,
    ).toBe(DataSensitivity.Public);
  });

  test("only the data types both stores hold enough of are shared; the best overlap is the flow's", () => {
    const phonesA: Array<string> = valuesOf("phone-a", 0, 300);
    const phonesB: Array<string> = valuesOf("phone-b", 0, 300);
    // 300 of 340 values in common: a Jaccard similarity of about 0.88.
    const idsA: Array<string> = valuesOf("ssn", 0, 320);
    const idsB: Array<string> = valuesOf("ssn", 20, 340);

    const a: DataStore = storeOf({
      name: "crm",
      fingerprints: {
        "us-ssn": buildFingerprint(idsA, KEY),
        "phone-number": buildFingerprint(phonesA, KEY),
        "email-address": buildFingerprint(customers, KEY),
      },
    });
    const b: DataStore = storeOf({
      name: "crm-export",
      fingerprints: {
        "email-address": buildFingerprint(customers, KEY),
        "phone-number": buildFingerprint(phonesB, KEY),
        "us-ssn": buildFingerprint(idsB, KEY),
      },
    });

    const overlap: number = estimateOverlap(
      buildFingerprint(idsA, KEY),
      buildFingerprint(idsB, KEY),
    );

    expect(overlap).toBeGreaterThanOrEqual(COPY_OVERLAP_THRESHOLD);
    expect(overlap).toBeLessThan(1);
    expect(
      estimateOverlap(
        buildFingerprint(phonesA, KEY),
        buildFingerprint(phonesB, KEY),
      ),
    ).toBeLessThan(COPY_OVERLAP_THRESHOLD);

    const [draft] = DataSecurityFlows.copyFlows([a, b]);

    expect(draft!.dataTypeIds).toEqual(["email-address", "us-ssn"]);
    expect(draft!.overlapPercent).toBe(100);
  });

  test("half the slots agreeing is just short of a copy; one slot more is one", () => {
    function sketch(agreeing: number, offset: number): Array<number> {
      const slots: Array<number> = [];

      for (let slot: number = 0; slot < FINGERPRINT_SLOTS; slot++) {
        slots.push(slot < agreeing ? slot : offset + slot);
      }

      return slots;
    }

    const at64: Array<FlowDraft> = DataSecurityFlows.copyFlows([
      storeOf({ name: "a", fingerprints: { "email-address": sketch(128, 0) } }),
      storeOf({
        name: "b",
        fingerprints: { "email-address": sketch(64, 1000) },
      }),
    ]);
    const at65: Array<FlowDraft> = DataSecurityFlows.copyFlows([
      storeOf({ name: "a", fingerprints: { "email-address": sketch(128, 0) } }),
      storeOf({
        name: "b",
        fingerprints: { "email-address": sketch(65, 1000) },
      }),
    ]);

    expect(estimateOverlap(sketch(128, 0), sketch(64, 1000))).toBeLessThan(0.5);
    expect(at64).toEqual([]);
    expect(at65).toHaveLength(1);
    expect(at65[0]!.overlapPercent).toBe(51);
  });

  test("stores with no fingerprints, or sketches that are not lists, are never compared", () => {
    const same: Array<number> = buildFingerprint(customers, KEY);

    expect(
      DataSecurityFlows.copyFlows([
        storeOf({ name: "a" }),
        storeOf({ name: "b", fingerprints: {} }),
        storeOf({
          name: "c",
          fingerprints: { "email-address": "not a sketch" },
        }),
        storeOf({ name: "d", fingerprints: { "email-address": same } }),
        storeOf({ name: "e", fingerprints: { "phone-number": same } }),
      ]),
    ).toEqual([]);
  });

  test("every pair is compared once", () => {
    const fingerprints: JSONObject = {
      "email-address": buildFingerprint(customers, KEY),
    };
    const drafts: Array<FlowDraft> = DataSecurityFlows.copyFlows([
      storeOf({ name: "a", fingerprints }),
      storeOf({ name: "b", fingerprints }),
      storeOf({ name: "c", fingerprints }),
    ]);

    expect(drafts).toHaveLength(3);
    expect(
      new Set(
        drafts.map((draft: FlowDraft): string => {
          return draft.flowKey;
        }),
      ).size,
    ).toBe(3);
  });

  test("only the first 400 fingerprinted stores are compared", () => {
    const shared: Array<number> = buildFingerprint(customers, KEY);
    const stores: Array<DataStore> = [
      storeOf({ name: "first", fingerprints: { "email-address": shared } }),
    ];

    for (let index: number = 1; index < 400; index++) {
      stores.push(
        storeOf({
          name: `filler-${index}`,
          fingerprints: { [`custom:type-${index}`]: [index] },
        }),
      );
    }

    stores.push(
      storeOf({ name: "beyond", fingerprints: { "email-address": shared } }),
    );

    expect(DataSecurityFlows.copyFlows(stores)).toEqual([]);

    stores[399] = storeOf({
      name: "last-compared",
      fingerprints: { "email-address": shared },
    });

    expect(DataSecurityFlows.copyFlows(stores)).toHaveLength(1);
  });
});

describe("computeProjectFlows: the service map", () => {
  test("a service that talks to a database store uses it", async () => {
    const tracedKey: string = tracedDatabaseDataStoreKey({
      system: "postgresql",
      address: "db.internal",
      namespace: "orders",
    });
    const store: DataStore = storeOf({
      name: "orders on db.internal",
      storeKey: tracedKey,
      sensitivity: DataSensitivity.Confidential,
      dataTypeIds: ["email-address", "phone-number"],
    });
    checkoutService();
    itemOf({
      entityKey: "database:orders",
      entityType: EntityType.Database,
      attributes: {
        "db.system.name": "postgresql",
        "server.address": " DB.Internal ",
        "db.namespace": "orders",
      },
    });
    edgeOf("service:checkout", "database:orders", 4200);

    await compute([store]);

    const flow: DataSecurityFlow = flowWithKey(
      `uses:${store.id!.toString()}:service:checkout`,
    );

    expect(flow.kind).toBe("Uses");
    expect(flow.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(flow.sourceDataStoreId?.toString()).toBe(store.id!.toString());
    expect(flow.serviceId?.toString()).toBe(SERVICE_ID.toString());
    expect(flow.destination).toBe("checkout");
    expect(flow.dataTypeIds).toEqual(["email-address", "phone-number"]);
    expect(flow.sensitivity).toBe(DataSensitivity.Confidential);
    expect(flow.isConfirmed).toBe(false);
    expect(flow.overlapPercent).toBe(0);
    expect(flow.callCount).toBe(4200);
    expect(flow.firstSeenAt).toEqual(NOW);
    expect(flow.lastSeenAt).toEqual(NOW);
    expect((edgesSpy.mock.calls[0]![0] as { query: JSONObject }).query).toEqual(
      {
        projectId: PROJECT_ID,
      },
    );
  });

  test("a database is found at the address a monitored server or a cloud endpoint gives it", async () => {
    const server: DatabaseServer = new DatabaseServer(ObjectID.generate());
    server.serverAddress = " PG.acme.internal ";
    servers = [server];
    const resource: CloudResource = new CloudResource(ObjectID.generate());
    resource.cloudEndpoints = [
      "Orders.abc123.us-east-1.rds.amazonaws.com:5432",
    ];
    resources = [resource];

    const monitored: DataStore = storeOf({
      name: "billing",
      storeKey: `database:${server.id!.toString()}`,
      databaseServerId: server.id!,
    });
    const cloud: DataStore = storeOf({
      name: "orders-db",
      storeKey:
        "cloud:aws:AWS RDS Instance:arn:aws:rds:us-east-1:123456789012:db:orders-db",
      cloudResourceId: resource.id!,
    });

    checkoutService();
    itemOf({
      entityKey: "database:billing",
      entityType: EntityType.Database,
      attributes: {
        "db.system.name": "postgresql",
        "server.address": "pg.acme.internal",
      },
    });
    itemOf({
      entityKey: "database:orders",
      entityType: EntityType.Database,
      attributes: {
        "db.system.name": "mysql",
        "server.address": "orders.abc123.us-east-1.rds.amazonaws.com",
      },
    });
    edgeOf("service:checkout", "database:billing");
    edgeOf("service:checkout", "database:orders");

    await compute([monitored, cloud]);

    expect(
      flowWithKey(`uses:${monitored.id!.toString()}:service:checkout`)
        .callCount,
    ).toBe(0);
    expect(
      flowWithKey(
        `uses:${cloud.id!.toString()}:service:checkout`,
      ).sourceDataStoreId?.toString(),
    ).toBe(cloud.id!.toString());

    const serverQuery: JSONObject = (
      serversSpy.mock.calls[0]![0] as {
        query: JSONObject;
        limit: number;
      }
    ).query;

    expect(
      ((serverQuery["_id"] as Includes).values as Array<ObjectID>).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([server.id!.toString()]);
    expect((serversSpy.mock.calls[0]![0] as { limit: number }).limit).toBe(1);
    expect(
      (
        (resourcesSpy.mock.calls[0]![0] as { query: JSONObject }).query[
          "_id"
        ] as Includes
      ).values,
    ).toHaveLength(1);
  });

  test("without database or cloud stores, nothing more is read", async () => {
    checkoutService();
    edgeOf("service:checkout", "database:orders");

    await compute([storeOf({ name: "logs", storeKey: "telemetry:x:Logs" })]);

    expect(serversSpy).not.toHaveBeenCalled();
    expect(resourcesSpy).not.toHaveBeenCalled();
  });

  test("a call to a remote host is a flow out to that host", async () => {
    checkoutService();
    itemOf({
      entityKey: "remote:payments",
      entityType: EntityType.RemoteService,
      attributes: { "server.address": "API.Stripe.com" },
    });
    itemOf({
      entityKey: "remote:nameless",
      entityType: EntityType.RemoteService,
      attributes: {},
    });
    edgeOf("service:checkout", "remote:payments", 77);
    edgeOf("service:checkout", "remote:nameless", 3);

    await compute([]);

    expect(flowTable).toHaveLength(1);

    const flow: DataSecurityFlow = flowWithKey(
      "external:service:checkout:api.stripe.com",
    );

    expect(flow.kind).toBe("External Host");
    expect(flow.destination).toBe("api.stripe.com");
    expect(flow.serviceId?.toString()).toBe(SERVICE_ID.toString());
    expect(flow.sourceDataStoreId).toBeUndefined();
    expect(flow.sensitivity).toBe(DataSensitivity.Public);
    expect(flow.dataTypeIds).toEqual([]);
    expect(flow.callCount).toBe(77);
  });

  test("edges from what is not a service, to nodes nobody knows, or to a database with no store, are skipped", async () => {
    const store: DataStore = storeOf({
      name: "orders on db.internal",
      storeKey: "traced:postgresql:db.internal:orders",
    });
    checkoutService();
    itemOf({
      entityKey: "database:orders",
      entityType: EntityType.Database,
      attributes: {
        "db.system.name": "postgresql",
        "server.address": "db.internal",
        "db.namespace": "orders",
      },
    });
    itemOf({
      entityKey: "database:unknown",
      entityType: EntityType.Database,
      attributes: {
        "db.system.name": "postgresql",
        "server.address": "other.internal",
      },
    });
    itemOf({ entityKey: "host:web-1", entityType: EntityType.Host });
    edgeOf("host:web-1", "database:orders");
    edgeOf("service:checkout", "database:missing");
    edgeOf("service:checkout", "database:unknown");

    await compute([store]);

    expect(flowTable).toEqual([]);
  });

  test("a service on the map that is not a Service record has no service id", async () => {
    const store: DataStore = storeOf({
      name: "cache",
      storeKey: "traced:redis:cache.internal:",
    });
    itemOf({
      entityKey: "service:legacy",
      entityType: EntityType.Service,
      displayName: "legacy",
    });
    itemOf({
      entityKey: "database:cache",
      entityType: EntityType.Database,
      attributes: {
        "db.system.name": "redis",
        "server.address": "cache.internal",
      },
    });
    edgeOf("service:legacy", "database:cache");

    await compute([store]);

    expect(flowTable[0]!.serviceId).toBeUndefined();
    expect(flowTable[0]!.destination).toBe("legacy");
  });

  test("a map without edges reads nothing more", async () => {
    await compute([]);

    expect(InventoryItemService.findBy).not.toHaveBeenCalled();
  });
});

describe("computeProjectFlows: AI providers", () => {
  test("a service's LLM calls are a flow from its AI conversations to the provider", async () => {
    const conversations: DataStore = storeOf({
      name: "support-bot · AI Conversations",
      storeKey: telemetryDataStoreKey({
        serviceId: SERVICE_ID.toString(),
        kind: DataStoreKind.TelemetryAiConversations,
      }),
      sensitivity: DataSensitivity.Confidential,
      dataTypeIds: ["email-address"],
    });
    const otherService: ObjectID = ObjectID.generate();
    spanRows = [
      {
        primaryEntityId: SERVICE_ID.toString(),
        llmSystem: " OpenAI ",
        calls: "12",
      },
      {
        primaryEntityId: otherService.toString(),
        llmSystem: "anthropic",
        calls: 3,
      },
      { primaryEntityId: "not-a-service", llmSystem: "openai", calls: 1 },
      { primaryEntityId: SERVICE_ID.toString(), llmSystem: "  ", calls: 1 },
    ];

    await compute([conversations]);

    expect(flowTable).toHaveLength(2);

    const confirmed: DataSecurityFlow = flowWithKey(
      `ai:${SERVICE_ID.toString()}:openai`,
    );

    expect(confirmed.kind).toBe("AI Provider");
    expect(confirmed.destination).toBe("OpenAI");
    expect(confirmed.serviceId?.toString()).toBe(SERVICE_ID.toString());
    expect(confirmed.sourceDataStoreId?.toString()).toBe(
      conversations.id!.toString(),
    );
    expect(confirmed.sensitivity).toBe(DataSensitivity.Confidential);
    expect(confirmed.isConfirmed).toBe(true);
    expect(confirmed.dataTypeIds).toEqual(["email-address"]);
    expect(confirmed.callCount).toBe(12);

    const unconfirmed: DataSecurityFlow = flowWithKey(
      `ai:${otherService.toString()}:anthropic`,
    );

    expect(unconfirmed.sourceDataStoreId).toBeUndefined();
    expect(unconfirmed.sensitivity).toBe(DataSensitivity.Public);
    expect(unconfirmed.isConfirmed).toBe(false);
  });

  test("reads only the project's LLM spans of the last week, grouped by service and provider", async () => {
    await compute([]);

    const statement: Statement = spanSpy.mock.calls[0]![0] as Statement;

    expect(statement.query).toContain(
      "SELECT primaryEntityId, llmSystem, count() AS calls FROM",
    );
    expect(statement.query).toContain("isLlmSpan = 1");
    expect(statement.query).toContain(
      "GROUP BY primaryEntityId, llmSystem LIMIT 1000",
    );
    expect(Object.values(statement.query_params)).toContain(
      PROJECT_ID.toString(),
    );
  });
});

describe("computeProjectFlows: writing the flows", () => {
  function copyPair(): [DataStore, DataStore] {
    const fingerprints: JSONObject = {
      "email-address": buildFingerprint(valuesOf("customer", 0, 200), KEY),
    };

    return [
      storeOf({
        name: "orders-prod",
        environment: DataStoreEnvironment.Production,
        fingerprints,
      }),
      storeOf({
        name: "orders-dev",
        environment: DataStoreEnvironment.Development,
        fingerprints,
      }),
    ];
  }

  test("a new flow is made with its first sighting; a known one is brought up to date", async () => {
    const [prod, dev] = copyPair();
    const known: DataSecurityFlow = existingFlow(
      `copy:${prod.id!.toString()}:${dev.id!.toString()}`,
      2,
    );
    checkoutService();
    itemOf({
      entityKey: "remote:payments",
      entityType: EntityType.RemoteService,
      attributes: { "server.address": "api.stripe.com" },
    });
    edgeOf("service:checkout", "remote:payments", 5);

    await compute([prod, dev]);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(
      (updateSpy.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(known.id!.toString());
    expect((updateSpy.mock.calls[0]![0] as { data: JSONObject }).data).toEqual({
      kind: "Copy",
      dataTypeIds: ["email-address"],
      sensitivity: DataSensitivity.Public,
      isConfirmed: true,
      overlapPercent: 100,
      callCount: 0,
      lastSeenAt: NOW,
    });
    expect(known.firstSeenAt).toEqual(new Date(NOW.getTime() - 90 * DAY_IN_MS));
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(
      (createSpy.mock.calls[0]![0] as CreateBy<DataSecurityFlow>).data.flowKey,
    ).toBe("external:service:checkout:api.stripe.com");
    expect(
      (createSpy.mock.calls[0]![0] as CreateBy<DataSecurityFlow>).props,
    ).toEqual({
      isRoot: true,
    });
  });

  test("flows nobody has seen for 30 days are dropped; recent ones stay", async () => {
    const stale: DataSecurityFlow = existingFlow(
      "external:service:gone:old.example.com",
      31,
    );
    const recent: DataSecurityFlow = existingFlow(
      "external:service:quiet:new.example.com",
      5,
    );

    await compute([]);

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(
      (deleteSpy.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(stale.id!.toString());
    expect(flowTable).toEqual([recent]);
  });

  test("a flow seen again after a month away is kept, and brought up to date", async () => {
    const [prod, dev] = copyPair();
    const returning: DataSecurityFlow = existingFlow(
      `copy:${prod.id!.toString()}:${dev.id!.toString()}`,
      45,
    );

    await compute([prod, dev]);

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(flowTable).toEqual([returning]);
    expect(returning.lastSeenAt).toEqual(NOW);
  });

  test("call counts are held to two billion, and long destinations cut to 500", async () => {
    checkoutService();
    itemOf({
      entityKey: "remote:long",
      entityType: EntityType.RemoteService,
      attributes: { "server.address": `${"h".repeat(600)}.example.com` },
    });
    edgeOf("service:checkout", "remote:long", 3_000_000_000);

    await compute([]);

    expect(flowTable[0]!.callCount).toBe(2_000_000_000);
    expect(flowTable[0]!.destination).toHaveLength(500);
    expect(flowTable[0]!.flowKey).toHaveLength(500);
  });

  test("a flow that cannot be written is logged, and the others are written", async () => {
    checkoutService();
    itemOf({
      entityKey: "remote:a",
      entityType: EntityType.RemoteService,
      attributes: { "server.address": "a.example.com" },
    });
    itemOf({
      entityKey: "remote:b",
      entityType: EntityType.RemoteService,
      attributes: { "server.address": "b.example.com" },
    });
    edgeOf("service:checkout", "remote:a");
    edgeOf("service:checkout", "remote:b");
    createSpy.mockImplementation((async (
      createBy: CreateBy<DataSecurityFlow>,
    ): Promise<DataSecurityFlow> => {
      if (createBy.data.destination === "a.example.com") {
        throw new Error("Postgres went away");
      }

      createBy.data.id = ObjectID.generate();
      flowTable.push(createBy.data);
      return createBy.data;
    }) as never);

    await compute([]);

    expect(
      flowTable.map((flow: DataSecurityFlow) => {
        return flow.destination;
      }),
    ).toEqual(["b.example.com"]);
    expect(errorSpy).toHaveBeenCalledWith(
      "DataSecurity: could not write flow external:service:checkout:a.example.com:",
    );
  });

  test("a service map or span store that cannot be read is logged; the other flows are still written", async () => {
    const [prod, dev] = copyPair();
    edgesSpy.mockRejectedValue(new Error("Postgres went away"));
    spanSpy.mockRejectedValue(new Error("ClickHouse went away"));

    await compute([prod, dev]);

    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not read the service map of project ${PROJECT_ID.toString()}:`,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not read AI provider calls of project ${PROJECT_ID.toString()}:`,
    );
    expect(flowTable).toHaveLength(1);
    expect(flowTable[0]!.kind).toBe("Copy");
  });

  test("every column a flow writes is a column of DataSecurityFlow", async () => {
    const columns: Set<string> = new Set(
      Object.keys(getTableColumns(new DataSecurityFlow())),
    );
    const [prod, dev] = copyPair();
    existingFlow(`copy:${prod.id!.toString()}:${dev.id!.toString()}`, 1);
    checkoutService();
    itemOf({
      entityKey: "remote:payments",
      entityType: EntityType.RemoteService,
      attributes: { "server.address": "api.stripe.com" },
    });
    existingFlow("external:service:checkout:api.stripe.com", 1);
    edgeOf("service:checkout", "remote:payments");

    await compute([prod, dev]);

    expect(updateSpy).toHaveBeenCalledTimes(2);

    for (const call of updateSpy.mock.calls) {
      for (const column of Object.keys(
        (call[0] as { data: JSONObject }).data,
      )) {
        expect({ column, isAColumn: columns.has(column) }).toEqual({
          column,
          isAColumn: true,
        });
      }
    }
  });
});
