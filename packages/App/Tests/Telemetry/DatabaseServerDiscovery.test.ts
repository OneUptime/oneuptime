/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced — same idiom as
 * OtelIngestMaintenanceFenceRelease.test.ts in this directory.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class
 * of every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import DatabaseServerService from "Common/Server/Services/DatabaseServerService";
import DatabaseServerEndpointService from "Common/Server/Services/DatabaseServerEndpointService";
import HostService from "Common/Server/Services/HostService";
import LabelService from "Common/Server/Services/LabelService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import * as EntityRegistry from "Common/Server/Utils/Telemetry/EntityRegistry";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { ExpressRequest } from "Common/Server/Utils/Express";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import Host from "Common/Models/DatabaseModels/Host";
import DatabaseServerDiscoverySource from "Common/Types/DatabaseServer/DatabaseServerDiscoverySource";
import { DatabaseEndpoint } from "Common/Types/DatabaseServer/DatabaseEndpoint";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { keyForDatabaseEndpoint } from "Common/Utils/Telemetry/EntityKey";
/*
 * `jest` is deliberately taken from the ambient global rather than from
 * "@jest/globals" — see OtelIngestMaintenanceFenceRelease.test.ts for why
 * the two spell a spy type differently.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * autoDiscoverDatabaseServer turns a database's OWN telemetry — a
 * collector-contrib DB receiver batch, or the OneUptime Database Agent's —
 * into a DatabaseServer row, and the metrics / logs pillars route that
 * batch to it. This suite pins:
 *
 *   - the GATE: an application batch is never a database, whatever its
 *     attributes; a receiver batch is recognised by its scope name (the
 *     receiver hint) or by an explicit `db.system.name` + address stamp;
 *     hosts that name nothing are refused — all before any cache or
 *     database call;
 *   - IDENTITY: `oneuptime.database.server.id` joins that row (and claims
 *     the observed endpoint for it when free); otherwise the endpoint finds
 *     or creates the row with discovery source "collector";
 *   - the caches, the "database-server" maintenance fence, the collector
 *     heartbeat and label promotion, and that nothing ever throws;
 *   - ROUTING: the Host gate refuses database batches, the database is the
 *     primary entity above Host (but below service.name), a block that also
 *     carries host metrics stays a Host, and the endpoint's key is added to
 *     the batch's entity keys.
 *
 * All Postgres / Redis access is mocked; the attribute walk and the shared
 * identity helpers run for real.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const DATABASE_ID: string = "55555555-5555-4555-8555-555555555555";
const LINKED_ID: string = "66666666-6666-4666-8666-666666666666";
const HOST_ID: string = "77777777-7777-4777-8777-777777777777";

const ENTITY_ID_NAMESPACE: string = "database-server-id";
const FENCE_NAMESPACE: string = "otel-maintenance-fence";

const POSTGRES_RECEIVER_SCOPE: string =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/postgresqlreceiver";

const ENDPOINT_HOST: string = "orders-db.example.com";
const FORMATTED_ENDPOINT: string = `${ENDPOINT_HOST}:5432`;
const DISPLAY_NAME: string = `PostgreSQL ${FORMATTED_ENDPOINT}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
const metricsService: Record<string, any> =
  OtelMetricsIngestService as unknown as Record<string, any>;
const logsService: Record<string, any> =
  OtelLogsIngestService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

function attributes(values: Record<string, string>): JSONArray {
  return Object.entries(values).map(
    ([key, value]: [string, string]): JSONObject => {
      return stringAttribute(key, value);
    },
  );
}

// The Database Agent's resource: engine + address stamped, service.name deleted.
const AGENT_ATTRIBUTES: Record<string, string> = {
  "db.system.name": "postgresql",
  "server.address": ENDPOINT_HOST,
  "server.port": "5432",
  "oneuptime.database.agent": "true",
  "oneuptime.agent.version": "0.161.0",
};

// A generic collector's postgresql receiver: no stamp, just its address.
const RECEIVER_ATTRIBUTES: Record<string, string> = {
  "server.address": ENDPOINT_HOST,
  "server.port": "5432",
  "host.name": "collector-vm-1",
  "os.type": "linux",
};

let cachedEntityIds: Map<string, string>;
let heldFences: Set<string>;
let getString: jest.SpiedFunction<typeof GlobalCache.getString>;
let setString: jest.SpiedFunction<typeof GlobalCache.setString>;
let setStringIfNotExists: jest.SpiedFunction<
  typeof GlobalCache.setStringIfNotExists
>;
let deleteKey: jest.SpiedFunction<typeof GlobalCache.deleteKey>;
let findOrCreateByEndpoint: jest.SpiedFunction<
  typeof DatabaseServerService.findOrCreateByEndpoint
>;
let findByIdInProject: jest.SpiedFunction<
  typeof DatabaseServerService.findByIdInProject
>;
let recordCollectorHeartbeat: jest.SpiedFunction<
  typeof DatabaseServerService.recordCollectorHeartbeat
>;
let attachLabels: jest.SpiedFunction<typeof DatabaseServerService.attachLabels>;
let claimEndpoint: jest.SpiedFunction<
  typeof DatabaseServerEndpointService.claimEndpoint
>;
let findOrCreateLabelsByNames: jest.SpiedFunction<
  typeof LabelService.findOrCreateLabelsByNames
>;

function databaseServerRow(id: string): DatabaseServer {
  const row: DatabaseServer = new DatabaseServer();
  row._id = id;
  return row;
}

async function discover(
  values: Record<string, string>,
  receiverSystemHint?: string | null,
): Promise<ObjectID | null> {
  return (await baseService["autoDiscoverDatabaseServer"]({
    projectId: PROJECT_ID,
    attributes: attributes(values),
    receiverSystemHint: receiverSystemHint,
  })) as ObjectID | null;
}

function expectNoCacheOrDatabaseCall(): void {
  expect(getString).not.toHaveBeenCalled();
  expect(setString).not.toHaveBeenCalled();
  expect(setStringIfNotExists).not.toHaveBeenCalled();
  expect(findOrCreateByEndpoint).not.toHaveBeenCalled();
  expect(findByIdInProject).not.toHaveBeenCalled();
  expect(claimEndpoint).not.toHaveBeenCalled();
  expect(recordCollectorHeartbeat).not.toHaveBeenCalled();
}

beforeEach(() => {
  cachedEntityIds = new Map<string, string>();
  heldFences = new Set<string>();

  /*
   * The base service memoizes resolved ids, fence refusals and unresolved
   * endpoints in-process; simulate their TTLs expiring between cases exactly
   * as the fake Redis maps are reset.
   */
  OtelIngestBaseService.clearInProcessMemos();

  getString = jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      if (namespace === ENTITY_ID_NAMESPACE) {
        return cachedEntityIds.get(key) || null;
      }
      return null;
    });
  setString = jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        if (namespace === ENTITY_ID_NAMESPACE) {
          cachedEntityIds.set(key, value);
        }
      },
    );
  // Fences are a single atomic SET NX: the claim succeeds only when absent.
  setStringIfNotExists = jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(async (namespace: string, key: string) => {
      if (namespace !== FENCE_NAMESPACE) {
        return true;
      }
      if (heldFences.has(key)) {
        return false;
      }
      heldFences.add(key);
      return true;
    });
  deleteKey = jest
    .spyOn(GlobalCache, "deleteKey")
    .mockImplementation(async (namespace: string, key: string) => {
      if (namespace === FENCE_NAMESPACE) {
        heldFences.delete(key);
      }
    });

  findOrCreateByEndpoint = jest
    .spyOn(DatabaseServerService, "findOrCreateByEndpoint")
    .mockResolvedValue(databaseServerRow(DATABASE_ID));
  findByIdInProject = jest
    .spyOn(DatabaseServerService, "findByIdInProject")
    .mockResolvedValue(databaseServerRow(LINKED_ID));
  recordCollectorHeartbeat = jest
    .spyOn(DatabaseServerService, "recordCollectorHeartbeat")
    .mockResolvedValue(undefined);
  attachLabels = jest
    .spyOn(DatabaseServerService, "attachLabels")
    .mockResolvedValue(undefined);
  claimEndpoint = jest
    .spyOn(DatabaseServerEndpointService, "claimEndpoint")
    .mockResolvedValue("claimed");
  findOrCreateLabelsByNames = jest
    .spyOn(LabelService, "findOrCreateLabelsByNames")
    .mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
  OtelIngestBaseService.clearInProcessMemos();
});

describe("autoDiscoverDatabaseServer gate", () => {
  test.each<[string, Record<string, string>, string | null]>([
    ["no attributes at all", {}, null],
    [
      "an application resource (service.name, host.name, os.type)",
      {
        "service.name": "checkout",
        "host.name": "app-vm-1",
        "os.type": "linux",
        "server.address": ENDPOINT_HOST,
      },
      null,
    ],
    [
      "a server.address with no engine and no receiver hint",
      { "server.address": ENDPOINT_HOST, "server.port": "5432" },
      null,
    ],
    [
      "a db.system.name stamp with no address and no linked id",
      { "db.system.name": "postgresql" },
      null,
    ],
    [
      "a receiver hint that is not a database engine",
      { "server.address": ENDPOINT_HOST },
      "hostmetrics",
    ],
    [
      "a DB receiver batch that names no server at all",
      { "host.name": "collector-vm-1", "os.type": "linux" },
      "postgresql",
    ],
    [
      "a linked id that is not a UUID, with no endpoint",
      {
        "oneuptime.database.server.id": "orders-db",
        "db.system.name": "mysql",
      },
      null,
    ],
  ])(
    "refuses %s and calls nothing",
    async (
      _label: string,
      values: Record<string, string>,
      hint: string | null,
    ) => {
      await expect(discover(values, hint)).resolves.toBeNull();
      expectNoCacheOrDatabaseCall();
    },
  );

  test.each<[string, string]>([
    ["an 'unknown' placeholder", "unknown"],
    ["an unknown_service placeholder", "unknown_service:java"],
    ["localhost.localdomain", "localhost.localdomain"],
    ["a short container id", "0123456789ab"],
    [
      "a full container id",
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ],
  ])(
    "refuses a receiver batch whose only address is %s",
    async (_label: string, address: string) => {
      await expect(
        discover({ "server.address": address }, "postgresql"),
      ).resolves.toBeNull();
      expectNoCacheOrDatabaseCall();
    },
  );

  test("refuses a receiver batch whose address is the collector pod's own name", async () => {
    await expect(
      discover(
        {
          "server.address": "otel-collector-5f7c9",
          "k8s.pod.name": "otel-collector-5f7c9",
          "k8s.namespace.name": "monitoring",
        },
        "postgresql",
      ),
    ).resolves.toBeNull();
    expectNoCacheOrDatabaseCall();
  });

  test("the Database Agent's own stamp trusts a container-id-shaped address", async () => {
    const result: ObjectID | null = await discover({
      ...AGENT_ATTRIBUTES,
      "server.address": "0123456789ab",
    });

    expect(result?.toString()).toBe(DATABASE_ID);
    expect(findOrCreateByEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: expect.objectContaining({ host: "0123456789ab" }),
      }),
    );
  });
});

describe("autoDiscoverDatabaseServer receiver hint and explicit stamp", () => {
  test("a DB receiver batch is recognised by its hint alone and registered from its address", async () => {
    const result: ObjectID | null = await discover(
      RECEIVER_ATTRIBUTES,
      "postgresql",
    );

    expect(result).toBeInstanceOf(ObjectID);
    expect(result?.toString()).toBe(DATABASE_ID);
    expect(findOrCreateByEndpoint).toHaveBeenCalledTimes(1);
    expect(findOrCreateByEndpoint).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      dbSystem: "postgresql",
      endpoint: { host: ENDPOINT_HOST, port: 5432 },
      discoverySource: DatabaseServerDiscoverySource.Collector,
      displayName: DISPLAY_NAME,
      allowCreate: true,
    });
    // Never by id: this batch carries no link.
    expect(findByIdInProject).not.toHaveBeenCalled();
  });

  test("an explicit db.system.name + server.address stamp needs no hint", async () => {
    await discover({
      "db.system.name": "mysql",
      "server.address": "billing-db.example.com",
    });

    expect(findOrCreateByEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        dbSystem: "mysql",
        // The engine's default port applies when none is reported.
        endpoint: { host: "billing-db.example.com", port: 3306 },
        displayName: "MySQL billing-db.example.com:3306",
      }),
    );
  });

  test("the address is canonicalized (case, trailing whitespace) before it keys anything", async () => {
    await discover({
      ...AGENT_ATTRIBUTES,
      "server.address": "  Orders-DB.Example.COM ",
    });

    expect(findOrCreateByEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: { host: ENDPOINT_HOST, port: 5432 },
      }),
    );
    expect(setString).toHaveBeenCalledWith(
      ENTITY_ID_NAMESPACE,
      `${PROJECT_ID.toString()}:${FORMATTED_ENDPOINT}`,
      DATABASE_ID,
      { expiresInSeconds: 60 * 60 },
    );
  });

  test("a receiver hint accepts service.instance.id as the endpoint (host:port form)", async () => {
    await discover(
      { "service.instance.id": "cache.example.com:6380" },
      "redis",
    );

    expect(findOrCreateByEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        dbSystem: "redis",
        endpoint: { host: "cache.example.com", port: 6380 },
      }),
    );
  });

  test("a UUID-shaped service.instance.id is an SDK instance id, never an endpoint", async () => {
    await expect(
      discover(
        { "service.instance.id": "0b7d5c0e-6c1a-4c55-9d4c-6b0c2f5c1a11" },
        "postgresql",
      ),
    ).resolves.toBeNull();
    expectNoCacheOrDatabaseCall();
  });

  test("the engine and agent versions ride the collector heartbeat", async () => {
    await discover({ ...AGENT_ATTRIBUTES, "db.system.version": "16.2" });

    expect(recordCollectorHeartbeat).toHaveBeenCalledTimes(1);
    const [id, extra]: [ObjectID, unknown] = recordCollectorHeartbeat.mock
      .calls[0]! as [ObjectID, unknown];
    expect(id.toString()).toBe(DATABASE_ID);
    expect(extra).toEqual({ agentVersion: "0.161.0", dbVersion: "16.2" });
  });

  test("absent versions are passed as undefined, never as empty strings", async () => {
    await discover(RECEIVER_ATTRIBUTES, "postgresql");

    expect(recordCollectorHeartbeat).toHaveBeenCalledWith(
      expect.any(ObjectID),
      { agentVersion: undefined, dbVersion: undefined },
    );
  });
});

describe("autoDiscoverDatabaseServer linked id (oneuptime.database.server.id)", () => {
  test("joins the linked row and claims the observed global-scope endpoint for it", async () => {
    const result: ObjectID | null = await discover({
      ...AGENT_ATTRIBUTES,
      "oneuptime.database.server.id": LINKED_ID,
    });

    expect(result?.toString()).toBe(LINKED_ID);
    expect(findByIdInProject).toHaveBeenCalledTimes(1);
    const [projectId, id]: [ObjectID, ObjectID] = findByIdInProject.mock
      .calls[0]! as [ObjectID, ObjectID];
    expect(projectId).toBe(PROJECT_ID);
    expect(id.toString()).toBe(LINKED_ID);

    expect(claimEndpoint).toHaveBeenCalledTimes(1);
    expect(claimEndpoint).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      databaseServerId: expect.any(ObjectID),
      endpoint: FORMATTED_ENDPOINT,
      isPrimary: false,
      source: "auto",
    });
    expect(
      (
        claimEndpoint.mock.calls[0]![0] as { databaseServerId: ObjectID }
      ).databaseServerId.toString(),
    ).toBe(LINKED_ID);

    // The endpoint path is never taken for a linked batch.
    expect(findOrCreateByEndpoint).not.toHaveBeenCalled();
    expect(setString).toHaveBeenCalledWith(
      ENTITY_ID_NAMESPACE,
      `${PROJECT_ID.toString()}:id:${LINKED_ID}`,
      LINKED_ID,
      { expiresInSeconds: 60 * 60 },
    );
    expect(recordCollectorHeartbeat).toHaveBeenCalledTimes(1);
  });

  test("an upper-case linked id is normalized before it keys the cache", async () => {
    await discover({
      ...AGENT_ATTRIBUTES,
      "oneuptime.database.server.id": LINKED_ID.toUpperCase(),
    });

    expect(getString).toHaveBeenCalledWith(
      ENTITY_ID_NAMESPACE,
      `${PROJECT_ID.toString()}:id:${LINKED_ID}`,
    );
  });

  test("a linked id alone (no address) joins the row and claims nothing", async () => {
    const result: ObjectID | null = await discover({
      "oneuptime.database.server.id": LINKED_ID,
      "db.system.name": "postgresql",
    });

    expect(result?.toString()).toBe(LINKED_ID);
    expect(claimEndpoint).not.toHaveBeenCalled();
    expect(findOrCreateByEndpoint).not.toHaveBeenCalled();
  });

  test("a LOCAL-scope endpoint (single-label name) is never claimed as an alias", async () => {
    const result: ObjectID | null = await discover({
      ...AGENT_ATTRIBUTES,
      "server.address": "postgres",
      "oneuptime.database.server.id": LINKED_ID,
    });

    expect(result?.toString()).toBe(LINKED_ID);
    expect(claimEndpoint).not.toHaveBeenCalled();
  });

  test("an unqualified private IP is never claimed as an alias", async () => {
    await discover({
      ...AGENT_ATTRIBUTES,
      "server.address": "10.0.4.17",
      "oneuptime.database.server.id": LINKED_ID,
    });

    expect(claimEndpoint).not.toHaveBeenCalled();
  });

  test("an endpoint another database owns is left alone, and the link still wins", async () => {
    claimEndpoint.mockResolvedValue("owned-by-other");

    const result: ObjectID | null = await discover({
      ...AGENT_ATTRIBUTES,
      "oneuptime.database.server.id": LINKED_ID,
    });

    expect(result?.toString()).toBe(LINKED_ID);
    expect(findOrCreateByEndpoint).not.toHaveBeenCalled();
    // A final answer: the id is cached, the claim is not retried every batch.
    expect(
      cachedEntityIds.get(`${PROJECT_ID.toString()}:id:${LINKED_ID}`),
    ).toBe(LINKED_ID);
  });

  test("a failing claim still returns the row but leaves the id uncached, so the next batch retries", async () => {
    claimEndpoint.mockRejectedValueOnce(new Error("Postgres said no"));

    const first: ObjectID | null = await discover({
      ...AGENT_ATTRIBUTES,
      "oneuptime.database.server.id": LINKED_ID,
    });

    expect(first?.toString()).toBe(LINKED_ID);
    expect(cachedEntityIds.size).toBe(0);

    const second: ObjectID | null = await discover({
      ...AGENT_ATTRIBUTES,
      "oneuptime.database.server.id": LINKED_ID,
    });

    expect(second?.toString()).toBe(LINKED_ID);
    expect(findByIdInProject).toHaveBeenCalledTimes(2);
    expect(claimEndpoint).toHaveBeenCalledTimes(2);
    expect(
      cachedEntityIds.get(`${PROJECT_ID.toString()}:id:${LINKED_ID}`),
    ).toBe(LINKED_ID);
  });

  test("a cached linked id short-circuits the lookup and the claim", async () => {
    cachedEntityIds.set(`${PROJECT_ID.toString()}:id:${LINKED_ID}`, LINKED_ID);

    const result: ObjectID | null = await discover({
      ...AGENT_ATTRIBUTES,
      "oneuptime.database.server.id": LINKED_ID,
    });

    expect(result?.toString()).toBe(LINKED_ID);
    expect(findByIdInProject).not.toHaveBeenCalled();
    expect(claimEndpoint).not.toHaveBeenCalled();
    expect(setString).not.toHaveBeenCalled();
    // Maintenance is gated by its own fence, not by the id cache.
    expect(recordCollectorHeartbeat).toHaveBeenCalledTimes(1);
  });

  test("a linked id that is not in the project falls back to the endpoint", async () => {
    findByIdInProject.mockResolvedValue(null);

    const result: ObjectID | null = await discover({
      ...AGENT_ATTRIBUTES,
      "oneuptime.database.server.id": LINKED_ID,
    });

    expect(result?.toString()).toBe(DATABASE_ID);
    expect(claimEndpoint).not.toHaveBeenCalled();
    expect(findOrCreateByEndpoint).toHaveBeenCalledTimes(1);
    // The missing link is not cached as an id…
    expect(
      cachedEntityIds.has(`${PROJECT_ID.toString()}:id:${LINKED_ID}`),
    ).toBe(false);
  });

  test("a missing linked row is memoed briefly, not looked up on every batch", async () => {
    findByIdInProject.mockResolvedValue(null);

    await discover({
      ...AGENT_ATTRIBUTES,
      "oneuptime.database.server.id": LINKED_ID,
    });
    await discover({
      ...AGENT_ATTRIBUTES,
      "oneuptime.database.server.id": LINKED_ID,
    });

    expect(findByIdInProject).toHaveBeenCalledTimes(1);

    // The memo's TTL expiring lets the next batch look again.
    OtelIngestBaseService.clearInProcessMemos();
    await discover({
      ...AGENT_ATTRIBUTES,
      "oneuptime.database.server.id": LINKED_ID,
    });
    expect(findByIdInProject).toHaveBeenCalledTimes(2);
  });

  test("a missing linked row with no endpoint discovers nothing", async () => {
    findByIdInProject.mockResolvedValue(null);

    await expect(
      discover({
        "oneuptime.database.server.id": LINKED_ID,
        "db.system.name": "postgresql",
      }),
    ).resolves.toBeNull();
    expect(findOrCreateByEndpoint).not.toHaveBeenCalled();
    expect(recordCollectorHeartbeat).not.toHaveBeenCalled();
  });
});

describe("autoDiscoverDatabaseServer endpoint path and caches", () => {
  test("a cache miss runs find-or-create exactly once and then serves from the cache", async () => {
    await discover(AGENT_ATTRIBUTES);
    await discover(AGENT_ATTRIBUTES);
    await discover(AGENT_ATTRIBUTES);

    expect(findOrCreateByEndpoint).toHaveBeenCalledTimes(1);
  });

  test("a cached id short-circuits find-or-create", async () => {
    cachedEntityIds.set(
      `${PROJECT_ID.toString()}:${FORMATTED_ENDPOINT}`,
      DATABASE_ID,
    );

    const result: ObjectID | null = await discover(AGENT_ATTRIBUTES);

    expect(result?.toString()).toBe(DATABASE_ID);
    expect(findOrCreateByEndpoint).not.toHaveBeenCalled();
    expect(setString).not.toHaveBeenCalled();
    expect(recordCollectorHeartbeat).toHaveBeenCalledTimes(1);
  });

  test("two receivers reporting one endpoint resolve to one row, whatever engine they claim", async () => {
    // CockroachDB speaks the postgresql wire protocol; the key is the endpoint.
    await discover({ ...AGENT_ATTRIBUTES, "db.system.name": "postgresql" });
    await discover({ ...AGENT_ATTRIBUTES, "db.system.name": "cockroachdb" });

    expect(findOrCreateByEndpoint).toHaveBeenCalledTimes(1);
  });

  test("an unowned LOCAL-scope endpoint discovers nothing, and is memoed rather than re-read every batch", async () => {
    findOrCreateByEndpoint.mockResolvedValue(null);

    const values: Record<string, string> = {
      ...AGENT_ATTRIBUTES,
      "server.address": "pg-primary",
    };

    await expect(discover(values)).resolves.toBeNull();
    await expect(discover(values)).resolves.toBeNull();

    expect(findOrCreateByEndpoint).toHaveBeenCalledTimes(1);
    expect(findOrCreateByEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: { host: "pg-primary", port: 5432 },
        allowCreate: true,
      }),
    );
    // Nothing was cached as an id, and no heartbeat went anywhere.
    expect(setString).not.toHaveBeenCalled();
    expect(recordCollectorHeartbeat).not.toHaveBeenCalled();

    // Once the memo expires, a row created by hand in the meantime is found.
    OtelIngestBaseService.clearInProcessMemos();
    findOrCreateByEndpoint.mockResolvedValue(databaseServerRow(DATABASE_ID));
    await expect(discover(values)).resolves.toEqual(new ObjectID(DATABASE_ID));
  });
});

describe("autoDiscoverDatabaseServer maintenance fence, heartbeat and labels", () => {
  test("arms the database-server fence and keeps it on success", async () => {
    await discover(AGENT_ATTRIBUTES);

    expect([...heldFences]).toEqual([`database-server:${DATABASE_ID}`]);
    expect(deleteKey).not.toHaveBeenCalled();
  });

  test("a held fence skips the heartbeat and labels but still returns the id", async () => {
    heldFences.add(`database-server:${DATABASE_ID}`);

    const result: ObjectID | null = await discover({
      ...AGENT_ATTRIBUTES,
      "oneuptime.label.team": "payments",
    });

    expect(result?.toString()).toBe(DATABASE_ID);
    expect(recordCollectorHeartbeat).not.toHaveBeenCalled();
    expect(findOrCreateLabelsByNames).not.toHaveBeenCalled();
  });

  test("promotes oneuptime.label.* attributes onto the database", async () => {
    const labelId: ObjectID = ObjectID.generate();
    findOrCreateLabelsByNames.mockResolvedValue([labelId]);

    await discover({ ...AGENT_ATTRIBUTES, "oneuptime.label.team": "payments" });

    expect(findOrCreateLabelsByNames).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      labelNames: expect.any(Array),
    });
    expect(attachLabels).toHaveBeenCalledTimes(1);
    const [call]: [unknown] = attachLabels.mock.calls[0]! as [unknown];
    expect(
      (call as { databaseServerId: ObjectID }).databaseServerId.toString(),
    ).toBe(DATABASE_ID);
    expect((call as { labelIds: Array<ObjectID> }).labelIds).toEqual([labelId]);
  });

  test("no label attributes means no label work at all", async () => {
    await discover(AGENT_ATTRIBUTES);

    expect(findOrCreateLabelsByNames).not.toHaveBeenCalled();
    expect(attachLabels).not.toHaveBeenCalled();
  });

  test("a failing label promotion is swallowed and does not release the fence", async () => {
    findOrCreateLabelsByNames.mockResolvedValue([ObjectID.generate()]);
    attachLabels.mockRejectedValue(new Error("join table said no"));

    const result: ObjectID | null = await discover({
      ...AGENT_ATTRIBUTES,
      "oneuptime.label.team": "payments",
    });

    expect(result?.toString()).toBe(DATABASE_ID);
    expect(deleteKey).not.toHaveBeenCalled();
  });

  test("a failing heartbeat returns null and releases the fence it armed", async () => {
    recordCollectorHeartbeat.mockRejectedValue(new Error("Postgres said no"));

    await expect(discover(AGENT_ATTRIBUTES)).resolves.toBeNull();
    expect(deleteKey).toHaveBeenCalledWith(
      FENCE_NAMESPACE,
      `database-server:${DATABASE_ID}`,
    );
  });
});

describe("autoDiscoverDatabaseServer never throws", () => {
  test("a failing find-or-create is swallowed", async () => {
    findOrCreateByEndpoint.mockRejectedValue(new Error("Postgres said no"));

    await expect(discover(AGENT_ATTRIBUTES)).resolves.toBeNull();
    expect(recordCollectorHeartbeat).not.toHaveBeenCalled();
  });

  test("a failing linked lookup is swallowed", async () => {
    findByIdInProject.mockRejectedValue(new Error("Postgres said no"));

    await expect(
      discover({
        ...AGENT_ATTRIBUTES,
        "oneuptime.database.server.id": LINKED_ID,
      }),
    ).resolves.toBeNull();
  });

  test("a Redis outage on the id cache is swallowed", async () => {
    getString.mockRejectedValue(new Error("redis down"));

    await expect(discover(AGENT_ATTRIBUTES)).resolves.toBeNull();
  });
});

describe("getDatabaseReceiverSystemHintFromScopes", () => {
  function hint(scopeNames: Array<unknown>): string | null {
    return baseService["getDatabaseReceiverSystemHintFromScopes"](
      scopeNames.map((name: unknown): JSONObject => {
        return { scope: { name: name } } as JSONObject;
      }),
    ) as string | null;
  }

  test("reads the Go-module receiver scope name", () => {
    expect(hint([POSTGRES_RECEIVER_SCOPE])).toBe("postgresql");
  });

  test("reads the legacy otelcol/<type>receiver scope name", () => {
    expect(hint(["otelcol/mysqlreceiver"])).toBe("mysql");
  });

  test("the first DB receiver among several scopes wins; others are ignored", () => {
    expect(
      hint([
        "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/hostmetricsreceiver/internal/scraper/cpuscraper",
        "otelcol/redisreceiver",
      ]),
    ).toBe("redis");
  });

  test("application SDK scopes and missing names are no hint", () => {
    expect(hint(["io.opentelemetry.jdbc", "", undefined, 42])).toBeNull();
    expect(
      baseService["getDatabaseReceiverSystemHintFromScopes"](undefined),
    ).toBeNull();
    expect(
      baseService["getDatabaseReceiverSystemHintFromScopes"]([]),
    ).toBeNull();
  });
});

describe("autoDiscoverHost refuses a database's batch", () => {
  const HOST_ATTRIBUTES: Record<string, string> = {
    "host.name": "collector-vm-1",
    "os.type": "linux",
  };

  test("returns null without touching the Host cache or table when a database was resolved", async () => {
    const findOrCreateHost: jest.SpiedFunction<
      typeof HostService.findOrCreateByHostIdentifier
    > = jest
      .spyOn(HostService, "findOrCreateByHostIdentifier")
      .mockRejectedValue(new Error("must not be reached"));

    await expect(
      baseService["autoDiscoverHost"]({
        projectId: PROJECT_ID,
        attributes: attributes(HOST_ATTRIBUTES),
        hasInfraSignal: false,
        databaseServerId: new ObjectID(DATABASE_ID),
      }),
    ).resolves.toBeNull();

    expect(findOrCreateHost).not.toHaveBeenCalled();
    expect(getString).not.toHaveBeenCalled();
  });

  test("the same attributes without a database still become a Host", async () => {
    getString.mockImplementation(async (namespace: string) => {
      return namespace === "host-id" ? HOST_ID : null;
    });
    jest.spyOn(HostService, "updateLastSeen").mockResolvedValue(undefined);
    jest
      .spyOn(baseService, "tryLinkHostToProxmoxGuest")
      .mockResolvedValue(undefined);

    const result: ObjectID | null = (await baseService["autoDiscoverHost"]({
      projectId: PROJECT_ID,
      attributes: attributes(HOST_ATTRIBUTES),
      hasInfraSignal: false,
      databaseServerId: null,
    })) as ObjectID | null;

    expect(result?.toString()).toBe(HOST_ID);
  });
});

describe("isDatabaseEngineResourceWithoutHostMetrics", () => {
  function scopeMetrics(
    scopeName: string,
    metricNames: Array<string>,
  ): JSONArray {
    return [
      {
        scope: { name: scopeName },
        metrics: metricNames.map((name: string): JSONObject => {
          return { name: name };
        }),
      },
    ] as JSONArray;
  }

  test("a DB receiver block is a database block", () => {
    expect(
      baseService["isDatabaseEngineResourceWithoutHostMetrics"](
        attributes(RECEIVER_ATTRIBUTES),
        scopeMetrics(POSTGRES_RECEIVER_SCOPE, ["postgresql.backends"]),
      ),
    ).toBe(true);
  });

  test("a DB block that also carries host metrics is a host agent's", () => {
    expect(
      baseService["isDatabaseEngineResourceWithoutHostMetrics"](
        attributes(RECEIVER_ATTRIBUTES),
        [
          ...scopeMetrics(POSTGRES_RECEIVER_SCOPE, ["postgresql.backends"]),
          ...scopeMetrics("otelcol/hostmetricsreceiver/cpu", [
            "system.cpu.time",
          ]),
        ],
      ),
    ).toBe(false);
  });

  test("a hostmetrics block is not a database block", () => {
    expect(
      baseService["isDatabaseEngineResourceWithoutHostMetrics"](
        attributes(RECEIVER_ATTRIBUTES),
        scopeMetrics("otelcol/hostmetricsreceiver/memory", [
          "system.memory.usage",
        ]),
      ),
    ).toBe(false);
  });
});

describe("runBatchHostEnrichment skips database blocks", () => {
  let findOrCreateHost: jest.SpiedFunction<
    typeof HostService.findOrCreateByHostIdentifier
  >;

  beforeEach(() => {
    const host: Host = new Host();
    host._id = HOST_ID;
    findOrCreateHost = jest
      .spyOn(HostService, "findOrCreateByHostIdentifier")
      .mockResolvedValue(host);
    jest.spyOn(HostService, "updateLastSeen").mockResolvedValue(undefined);
  });

  function resourceMetric(
    resourceAttributes: Record<string, string>,
    scopes: Array<{ name: string; metrics: Array<string> }>,
  ): JSONObject {
    return {
      resource: { attributes: attributes(resourceAttributes) },
      scopeMetrics: scopes.map(
        (scope: { name: string; metrics: Array<string> }): JSONObject => {
          return {
            scope: { name: scope.name },
            metrics: scope.metrics.map((name: string): JSONObject => {
              return { name: name, gauge: { dataPoints: [{ asInt: 1 }] } };
            }),
          };
        },
      ),
    } as JSONObject;
  }

  async function enrich(resourceMetrics: Array<JSONObject>): Promise<void> {
    await metricsService["runBatchHostEnrichment"]({
      projectId: PROJECT_ID,
      resourceMetrics: resourceMetrics,
    });
  }

  test("a DB receiver block carrying the collector's host.name / os.type creates no Host", async () => {
    await enrich([
      resourceMetric(RECEIVER_ATTRIBUTES, [
        { name: POSTGRES_RECEIVER_SCOPE, metrics: ["postgresql.backends"] },
      ]),
    ]);

    expect(findOrCreateHost).not.toHaveBeenCalled();
  });

  test("the Database Agent's stamped block creates no Host either", async () => {
    await enrich([
      resourceMetric(
        { ...AGENT_ATTRIBUTES, "host.name": "db-vm-1", "os.type": "linux" },
        [
          {
            name: "otelcol/postgresqlreceiver",
            metrics: ["postgresql.commits"],
          },
        ],
      ),
    ]);

    expect(findOrCreateHost).not.toHaveBeenCalled();
  });

  test("a DB block that also carries host metrics is enriched as a Host", async () => {
    await enrich([
      resourceMetric(RECEIVER_ATTRIBUTES, [
        { name: POSTGRES_RECEIVER_SCOPE, metrics: ["postgresql.backends"] },
        {
          name: "otelcol/hostmetricsreceiver/cpu",
          metrics: ["system.cpu.time"],
        },
      ]),
    ]);

    expect(findOrCreateHost).toHaveBeenCalledTimes(1);
  });

  test("an ordinary hostmetrics block is still enriched", async () => {
    await enrich([
      resourceMetric({ "host.name": "app-vm-1", "os.type": "linux" }, [
        {
          name: "otelcol/hostmetricsreceiver/cpu",
          metrics: ["system.cpu.time"],
        },
      ]),
    ]);

    expect(findOrCreateHost).toHaveBeenCalledTimes(1);
  });
});

describe("selectPrimaryEntity with a database", () => {
  let buildNonService: jest.SpiedFunction<
    typeof OTelIngestService.buildResourceMetadataForNonService
  >;
  let fromName: jest.SpiedFunction<
    typeof OTelIngestService.telemetryServiceFromName
  >;

  function metadataFor(data: {
    serviceName: string;
    resourceId: ObjectID;
    primaryEntityType: ServiceType;
  }): TelemetryServiceMetadata {
    return {
      serviceName: data.serviceName,
      primaryEntityId: data.resourceId,
      primaryEntityType: data.primaryEntityType,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    };
  }

  beforeEach(() => {
    buildNonService = jest
      .spyOn(OTelIngestService, "buildResourceMetadataForNonService")
      .mockImplementation(
        async (data: {
          serviceName: string;
          resourceId: ObjectID;
          primaryEntityType: ServiceType;
          projectId: ObjectID;
        }): Promise<TelemetryServiceMetadata> => {
          return metadataFor(data);
        },
      );
    fromName = jest
      .spyOn(OTelIngestService, "telemetryServiceFromName")
      .mockImplementation(
        async (data: {
          serviceName: string;
          projectId: ObjectID;
        }): Promise<TelemetryServiceMetadata> => {
          return metadataFor({
            serviceName: data.serviceName,
            resourceId: ObjectID.generate(),
            primaryEntityType: ServiceType.OpenTelemetry,
          });
        },
      );
  });

  async function select(data: {
    values: Record<string, string>;
    databaseServerId?: ObjectID | null;
    databaseServerName?: string | null;
    hostId?: ObjectID | null;
    kubernetesClusterId?: ObjectID | null;
  }): Promise<TelemetryServiceMetadata> {
    return (await baseService["selectPrimaryEntity"]({
      req: { headers: {} } as ExpressRequest,
      attributes: attributes(data.values),
      projectId: PROJECT_ID,
      hostId: data.hostId ?? null,
      kubernetesClusterId: data.kubernetesClusterId ?? null,
      databaseServerId: data.databaseServerId ?? null,
      databaseServerName: data.databaseServerName ?? null,
    })) as TelemetryServiceMetadata;
  }

  test("the database is primary — above a Host and a Kubernetes cluster", async () => {
    const metadata: TelemetryServiceMetadata = await select({
      values: RECEIVER_ATTRIBUTES,
      databaseServerId: new ObjectID(DATABASE_ID),
      databaseServerName: DISPLAY_NAME,
      hostId: new ObjectID(HOST_ID),
      kubernetesClusterId: ObjectID.generate(),
    });

    expect(metadata.primaryEntityType).toBe(ServiceType.DatabaseServer);
    expect(metadata.primaryEntityId.toString()).toBe(DATABASE_ID);
    expect(metadata.serviceName).toBe(`database/${DISPLAY_NAME}`);
    expect(buildNonService).toHaveBeenCalledTimes(1);
    expect(buildNonService).toHaveBeenCalledWith({
      serviceName: `database/${DISPLAY_NAME}`,
      resourceId: new ObjectID(DATABASE_ID),
      primaryEntityType: ServiceType.DatabaseServer,
      projectId: PROJECT_ID,
    });
  });

  test("a database with no name is labelled 'Database'", async () => {
    const metadata: TelemetryServiceMetadata = await select({
      values: {},
      databaseServerId: new ObjectID(DATABASE_ID),
    });

    expect(metadata.serviceName).toBe("Database");
  });

  test("an explicit service.name still wins over the database", async () => {
    const metadata: TelemetryServiceMetadata = await select({
      values: { ...RECEIVER_ATTRIBUTES, "service.name": "orders-api" },
      databaseServerId: new ObjectID(DATABASE_ID),
      databaseServerName: DISPLAY_NAME,
    });

    expect(fromName).toHaveBeenCalledTimes(1);
    expect(metadata.serviceName).toBe("orders-api");
    expect(metadata.primaryEntityType).toBe(ServiceType.OpenTelemetry);
    expect(buildNonService).not.toHaveBeenCalled();
  });

  test("without a database the Host branch is unchanged", async () => {
    const metadata: TelemetryServiceMetadata = await select({
      values: RECEIVER_ATTRIBUTES,
      hostId: new ObjectID(HOST_ID),
    });

    expect(metadata.primaryEntityType).toBe(ServiceType.Host);
    expect(metadata.serviceName).toBe("host/collector-vm-1");
  });
});

describe("resolveTelemetryResource adds the database endpoint key", () => {
  const ENDPOINT: DatabaseEndpoint = { host: ENDPOINT_HOST, port: 5432 };

  beforeEach(() => {
    jest
      .spyOn(EntityRegistry, "reconcileEntityRegistryThrottled")
      .mockResolvedValue(undefined);
    jest
      .spyOn(OTelIngestService, "buildResourceMetadataForNonService")
      .mockImplementation(
        async (data: {
          serviceName: string;
          resourceId: ObjectID;
          primaryEntityType: ServiceType;
          projectId: ObjectID;
        }): Promise<TelemetryServiceMetadata> => {
          return {
            serviceName: data.serviceName,
            primaryEntityId: data.resourceId,
            primaryEntityType: data.primaryEntityType,
            dataRententionInDays: 15,
            serviceRetentionConfig: null,
            serviceRetentionInDays: null,
            projectRetentionConfig: null,
            projectRetentionInDays: 15,
          };
        },
      );
  });

  async function resolve(data: {
    values: Record<string, string>;
    endpoint?: DatabaseEndpoint | null;
  }): Promise<TelemetryServiceMetadata> {
    return (await baseService["resolveTelemetryResource"]({
      req: { headers: {} } as ExpressRequest,
      attributes: attributes(data.values),
      projectId: PROJECT_ID,
      hostId: new ObjectID(HOST_ID),
      databaseServerId: new ObjectID(DATABASE_ID),
      databaseServerName: DISPLAY_NAME,
      databaseServerEndpoint: data.endpoint ?? null,
    })) as TelemetryServiceMetadata;
  }

  test("appends keyForDatabaseEndpoint after the (sorted) extracted keys", async () => {
    const withoutEndpoint: TelemetryServiceMetadata = await resolve({
      values: RECEIVER_ATTRIBUTES,
    });
    const withEndpoint: TelemetryServiceMetadata = await resolve({
      values: RECEIVER_ATTRIBUTES,
      endpoint: ENDPOINT,
    });

    const endpointKey: string = keyForDatabaseEndpoint(
      PROJECT_ID.toString(),
      ENDPOINT,
    );

    expect(withoutEndpoint.entityKeys).not.toContain(endpointKey);
    expect(withEndpoint.entityKeys).toEqual([
      ...(withoutEndpoint.entityKeys || []),
      endpointKey,
    ]);
    // The rest of the membership set (the collector's host) is untouched.
    expect((withoutEndpoint.entityKeys || []).length).toBeGreaterThan(0);
    expect(withEndpoint.primaryEntityType).toBe(ServiceType.DatabaseServer);
  });

  test("the key is engine-agnostic: the same endpoint, the same key", async () => {
    const first: TelemetryServiceMetadata = await resolve({
      values: { ...RECEIVER_ATTRIBUTES, "db.system.name": "postgresql" },
      endpoint: ENDPOINT,
    });
    const second: TelemetryServiceMetadata = await resolve({
      values: { ...RECEIVER_ATTRIBUTES, "db.system.name": "cockroachdb" },
      endpoint: ENDPOINT,
    });

    expect(first.entityKeys![first.entityKeys!.length - 1]).toBe(
      second.entityKeys![second.entityKeys!.length - 1],
    );
  });

  test("withDatabaseEndpointEntityKey returns a NEW array and never duplicates", () => {
    const endpointKey: string = keyForDatabaseEndpoint(
      PROJECT_ID.toString(),
      ENDPOINT,
    );
    const shared: Array<string> = ["aaaaaaaaaaaaaaaa"];

    const appended: Array<string> = baseService[
      "withDatabaseEndpointEntityKey"
    ]({
      entityKeys: shared,
      projectId: PROJECT_ID,
      endpoint: ENDPOINT,
    }) as Array<string>;

    expect(appended).toEqual(["aaaaaaaaaaaaaaaa", endpointKey]);
    expect(appended).not.toBe(shared);
    expect(shared).toEqual(["aaaaaaaaaaaaaaaa"]);

    expect(
      baseService["withDatabaseEndpointEntityKey"]({
        entityKeys: appended,
        projectId: PROJECT_ID,
        endpoint: ENDPOINT,
      }),
    ).toBe(appended);
    expect(
      baseService["withDatabaseEndpointEntityKey"]({
        entityKeys: shared,
        projectId: PROJECT_ID,
        endpoint: null,
      }),
    ).toBe(shared);
  });
});

/*
 * ---- Pillar wiring --------------------------------------------------------
 *
 * The real OTLP walks, with every discovery and write seam mocked, to pin
 * what the metrics and logs pillars hand discovery, the Host gate and the
 * resource resolver — and what they stamp on the rows.
 */

const OTHER_AUTO_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
];

const TIME_NANO: string = `${Date.UTC(2026, 7, 10, 10, 0, 0, 0)}000000`;

function databaseMetadata(): TelemetryServiceMetadata {
  return {
    serviceName: `database/${DISPLAY_NAME}`,
    primaryEntityId: new ObjectID(DATABASE_ID),
    primaryEntityType: ServiceType.DatabaseServer,
    entityKeys: [],
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  };
}

type PillarSpies = {
  rows: Array<JSONObject>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  discoverDatabase: jest.SpyInstance<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  discoverHost: jest.SpyInstance<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolveResource: jest.SpyInstance<any>;
};

describe("metrics pillar wiring", () => {
  function setup(databaseServerId: ObjectID | null): PillarSpies {
    const rows: Array<JSONObject> = [];

    jest
      .spyOn(metricsService, "runBatchHostEnrichment")
      .mockResolvedValue(undefined);
    jest
      .spyOn(metricsService, "submitMetricsBuffer")
      .mockImplementation((...args: Array<unknown>): Promise<void> => {
        const buffer: Array<JSONObject> = args[0] as Array<JSONObject>;
        rows.push(...buffer.splice(0, buffer.length));
        return Promise.resolve();
      });
    for (const method of OTHER_AUTO_DISCOVERY_METHODS) {
      jest.spyOn(metricsService, method).mockResolvedValue(null);
    }
    const discoverDatabase: jest.SpyInstance = jest
      .spyOn(metricsService, "autoDiscoverDatabaseServer")
      .mockResolvedValue(databaseServerId);
    const discoverHost: jest.SpyInstance = jest
      .spyOn(metricsService, "autoDiscoverHost")
      .mockResolvedValue(null);
    const resolveResource: jest.SpyInstance = jest
      .spyOn(metricsService, "resolveTelemetryResource")
      .mockResolvedValue(databaseMetadata());

    jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue({
      projectRules: [],
      rulesByServiceId: new Map(),
    });
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(undefined as any);

    return { rows, discoverDatabase, discoverHost, resolveResource };
  }

  function request(data: {
    resourceAttributes: Record<string, string>;
    scopes: Array<{ name: string; metrics: Array<string> }>;
  }): TelemetryRequest {
    return {
      projectId: PROJECT_ID,
      body: {
        resourceMetrics: [
          {
            resource: { attributes: attributes(data.resourceAttributes) },
            scopeMetrics: data.scopes.map(
              (scope: { name: string; metrics: Array<string> }): JSONObject => {
                return {
                  scope: { name: scope.name, version: "0.120.0" },
                  metrics: scope.metrics.map((name: string): JSONObject => {
                    return {
                      name: name,
                      gauge: {
                        dataPoints: [{ timeUnixNano: TIME_NANO, asInt: 7 }],
                      },
                    };
                  }),
                };
              },
            ),
          },
        ],
      },
      headers: {},
    } as unknown as TelemetryRequest;
  }

  test("a DB receiver block: the hint reaches discovery, the Host gate is told, the resolver gets id + name + endpoint", async () => {
    const spies: PillarSpies = setup(new ObjectID(DATABASE_ID));

    await OtelMetricsIngestService.processMetricsFromQueue(
      request({
        resourceAttributes: RECEIVER_ATTRIBUTES,
        scopes: [
          { name: POSTGRES_RECEIVER_SCOPE, metrics: ["postgresql.backends"] },
        ],
      }),
    );

    expect(spies.discoverDatabase).toHaveBeenCalledTimes(1);
    expect(spies.discoverDatabase).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      attributes: expect.any(Array),
      receiverSystemHint: "postgresql",
    });
    expect(spies.discoverHost).toHaveBeenCalledWith(
      expect.objectContaining({
        hasInfraSignal: false,
        databaseServerId: new ObjectID(DATABASE_ID),
      }),
    );
    expect(spies.resolveResource).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseServerId: new ObjectID(DATABASE_ID),
        databaseServerName: DISPLAY_NAME,
        databaseServerEndpoint: { host: ENDPOINT_HOST, port: 5432 },
      }),
    );
  });

  test("the rows carry the oneuptime.database.server.id / name stamp", async () => {
    const spies: PillarSpies = setup(new ObjectID(DATABASE_ID));

    await OtelMetricsIngestService.processMetricsFromQueue(
      request({
        resourceAttributes: RECEIVER_ATTRIBUTES,
        scopes: [
          { name: POSTGRES_RECEIVER_SCOPE, metrics: ["postgresql.backends"] },
        ],
      }),
    );

    const row: JSONObject | undefined = spies.rows.find((r: JSONObject) => {
      return r["name"] === "postgresql.backends";
    });
    expect(row).toBeDefined();
    const rowAttributes: JSONObject = row!["attributes"] as JSONObject;
    expect(rowAttributes["oneuptime.database.server.id"]).toBe(DATABASE_ID);
    expect(rowAttributes["oneuptime.database.server.name"]).toBe(DISPLAY_NAME);
    expect(row!["primaryEntityType"]).toBe(ServiceType.DatabaseServer);
  });

  test("a block that also carries host metrics keeps the Host: no database for the gate or the primary entity, but the key and stamp remain", async () => {
    const spies: PillarSpies = setup(new ObjectID(DATABASE_ID));

    await OtelMetricsIngestService.processMetricsFromQueue(
      request({
        resourceAttributes: RECEIVER_ATTRIBUTES,
        scopes: [
          { name: POSTGRES_RECEIVER_SCOPE, metrics: ["postgresql.backends"] },
          {
            name: "otelcol/hostmetricsreceiver/cpu",
            metrics: ["system.cpu.time"],
          },
        ],
      }),
    );

    expect(spies.discoverHost).toHaveBeenCalledWith(
      expect.objectContaining({
        hasInfraSignal: true,
        databaseServerId: null,
      }),
    );
    expect(spies.resolveResource).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseServerId: null,
        databaseServerEndpoint: { host: ENDPOINT_HOST, port: 5432 },
      }),
    );
    const row: JSONObject | undefined = spies.rows.find((r: JSONObject) => {
      return r["name"] === "postgresql.backends";
    });
    expect(
      (row!["attributes"] as JSONObject)["oneuptime.database.server.id"],
    ).toBe(DATABASE_ID);
  });

  test("a bare linked id (no engine, no address) still stamps the id, under the fallback name", async () => {
    const spies: PillarSpies = setup(new ObjectID(LINKED_ID));

    await OtelMetricsIngestService.processMetricsFromQueue(
      request({
        resourceAttributes: { "oneuptime.database.server.id": LINKED_ID },
        scopes: [{ name: "otelcol/prometheusreceiver", metrics: ["pg_up"] }],
      }),
    );

    expect(spies.discoverDatabase).toHaveBeenCalledWith(
      expect.objectContaining({ receiverSystemHint: null }),
    );
    expect(spies.resolveResource).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseServerId: new ObjectID(LINKED_ID),
        databaseServerName: null,
        databaseServerEndpoint: null,
      }),
    );

    const row: JSONObject | undefined = spies.rows.find((r: JSONObject) => {
      return r["name"] === "pg_up";
    });
    expect(row).toBeDefined();
    const rowAttributes: JSONObject = row!["attributes"] as JSONObject;
    // Monitors link by the id stamp; it is never skipped for want of a name.
    expect(rowAttributes["oneuptime.database.server.id"]).toBe(LINKED_ID);
    expect(rowAttributes["oneuptime.database.server.name"]).toBe("Database");
  });

  test("an application block: no hint, no database, nothing stamped", async () => {
    const spies: PillarSpies = setup(null);

    await OtelMetricsIngestService.processMetricsFromQueue(
      request({
        resourceAttributes: { "service.name": "orders-api" },
        scopes: [{ name: "io.opentelemetry.jdbc", metrics: ["jvm.threads"] }],
      }),
    );

    expect(spies.discoverDatabase).toHaveBeenCalledWith(
      expect.objectContaining({ receiverSystemHint: null }),
    );
    expect(spies.resolveResource).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseServerId: null,
        databaseServerName: null,
        databaseServerEndpoint: null,
      }),
    );
    for (const row of spies.rows) {
      expect(
        (row["attributes"] as JSONObject)["oneuptime.database.server.id"],
      ).toBeUndefined();
    }
  });

  test("a LOCAL-scope endpoint with no row still passes its endpoint for the key", async () => {
    const spies: PillarSpies = setup(null);

    await OtelMetricsIngestService.processMetricsFromQueue(
      request({
        resourceAttributes: {
          ...AGENT_ATTRIBUTES,
          "server.address": "pg-primary",
        },
        scopes: [
          { name: POSTGRES_RECEIVER_SCOPE, metrics: ["postgresql.backends"] },
        ],
      }),
    );

    expect(spies.resolveResource).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseServerId: null,
        databaseServerName: "PostgreSQL pg-primary:5432",
        databaseServerEndpoint: { host: "pg-primary", port: 5432 },
      }),
    );
  });
});

describe("logs pillar wiring", () => {
  function setup(databaseServerId: ObjectID | null): PillarSpies {
    const rows: Array<JSONObject> = [];

    jest
      .spyOn(logsService, "submitLogsBuffer")
      .mockImplementation((...args: Array<unknown>): Promise<void> => {
        const buffer: Array<JSONObject> = args[0] as Array<JSONObject>;
        rows.push(...buffer.splice(0, buffer.length));
        return Promise.resolve();
      });
    jest
      .spyOn(logsService, "submitExceptionsBuffer")
      .mockImplementation((...args: Array<unknown>): Promise<void> => {
        const buffer: Array<JSONObject> = args[0] as Array<JSONObject>;
        buffer.splice(0, buffer.length);
        return Promise.resolve();
      });
    for (const method of OTHER_AUTO_DISCOVERY_METHODS) {
      jest.spyOn(logsService, method).mockResolvedValue(null);
    }
    const discoverDatabase: jest.SpyInstance = jest
      .spyOn(logsService, "autoDiscoverDatabaseServer")
      .mockResolvedValue(databaseServerId);
    const discoverHost: jest.SpyInstance = jest
      .spyOn(logsService, "autoDiscoverHost")
      .mockResolvedValue(null);
    const resolveResource: jest.SpyInstance = jest
      .spyOn(logsService, "resolveTelemetryResource")
      .mockResolvedValue(databaseMetadata());

    jest
      .spyOn(LogDropFilterService, "loadDropFilters")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([] as any);
    jest
      .spyOn(LogScrubRuleService, "loadScrubRules")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([] as any);
    jest
      .spyOn(LogPipelineService, "loadPipelines")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([] as any);

    return { rows, discoverDatabase, discoverHost, resolveResource };
  }

  function request(data: {
    resourceAttributes: Record<string, string>;
    scopeName: string;
  }): TelemetryRequest {
    return {
      projectId: PROJECT_ID,
      body: {
        resourceLogs: [
          {
            resource: { attributes: attributes(data.resourceAttributes) },
            scopeLogs: [
              {
                scope: { name: data.scopeName },
                logRecords: [
                  {
                    timeUnixNano: TIME_NANO,
                    severityNumber: 9,
                    body: { stringValue: "checkpoint complete" },
                    attributes: [],
                  },
                ],
              },
            ],
          },
        ],
      },
      headers: {},
    } as unknown as TelemetryRequest;
  }

  test("a DB receiver log block routes to the database and stamps it", async () => {
    const spies: PillarSpies = setup(new ObjectID(DATABASE_ID));

    await OtelLogsIngestService.processLogsFromQueue(
      request({
        resourceAttributes: RECEIVER_ATTRIBUTES,
        scopeName: POSTGRES_RECEIVER_SCOPE,
      }),
    );

    expect(spies.discoverDatabase).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      attributes: expect.any(Array),
      receiverSystemHint: "postgresql",
    });
    // Logs carry no host metrics: a database batch is always the database's.
    expect(spies.discoverHost).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseServerId: new ObjectID(DATABASE_ID),
      }),
    );
    expect(spies.resolveResource).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseServerId: new ObjectID(DATABASE_ID),
        databaseServerName: DISPLAY_NAME,
        databaseServerEndpoint: { host: ENDPOINT_HOST, port: 5432 },
      }),
    );

    expect(spies.rows).toHaveLength(1);
    const rowAttributes: JSONObject = spies.rows[0]![
      "attributes"
    ] as JSONObject;
    expect(rowAttributes["oneuptime.database.server.id"]).toBe(DATABASE_ID);
    expect(rowAttributes["oneuptime.database.server.name"]).toBe(DISPLAY_NAME);
  });

  test("the Database Agent's server log file (filelog scope) is recognised by its stamp", async () => {
    const spies: PillarSpies = setup(new ObjectID(DATABASE_ID));

    await OtelLogsIngestService.processLogsFromQueue(
      request({
        resourceAttributes: AGENT_ATTRIBUTES,
        scopeName:
          "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/filelogreceiver",
      }),
    );

    expect(spies.discoverDatabase).toHaveBeenCalledWith(
      expect.objectContaining({ receiverSystemHint: null }),
    );
    expect(spies.resolveResource).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseServerName: DISPLAY_NAME,
        databaseServerEndpoint: { host: ENDPOINT_HOST, port: 5432 },
      }),
    );
  });

  test("a bare linked id still stamps the id on log rows, under the fallback name", async () => {
    const spies: PillarSpies = setup(new ObjectID(LINKED_ID));

    await OtelLogsIngestService.processLogsFromQueue(
      request({
        resourceAttributes: { "oneuptime.database.server.id": LINKED_ID },
        scopeName:
          "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/filelogreceiver",
      }),
    );

    expect(spies.resolveResource).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseServerId: new ObjectID(LINKED_ID),
        databaseServerName: null,
        databaseServerEndpoint: null,
      }),
    );
    expect(spies.rows).toHaveLength(1);
    const rowAttributes: JSONObject = spies.rows[0]![
      "attributes"
    ] as JSONObject;
    expect(rowAttributes["oneuptime.database.server.id"]).toBe(LINKED_ID);
    expect(rowAttributes["oneuptime.database.server.name"]).toBe("Database");
  });

  test("an application log block passes no database anywhere", async () => {
    const spies: PillarSpies = setup(null);

    await OtelLogsIngestService.processLogsFromQueue(
      request({
        resourceAttributes: { "service.name": "orders-api" },
        scopeName: "io.opentelemetry.logback",
      }),
    );

    expect(spies.discoverHost).toHaveBeenCalledWith(
      expect.objectContaining({ databaseServerId: null }),
    );
    expect(spies.resolveResource).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseServerId: null,
        databaseServerName: null,
        databaseServerEndpoint: null,
      }),
    );
  });
});
