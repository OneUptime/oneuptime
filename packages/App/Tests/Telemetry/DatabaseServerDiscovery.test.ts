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
import {
  DatabaseEndpoint,
  buildKubernetesDatabaseAliases,
} from "Common/Types/DatabaseServer/DatabaseEndpoint";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  keyForDatabaseEndpoint,
  keyForDatabaseServerRow,
  keyForHost,
} from "Common/Utils/Telemetry/EntityKey";
import { getDatabaseServerSignalEntityKeys } from "Common/Utils/Telemetry/DatabaseServerEntityKeys";
import { ResourceEntityRef } from "Common/Server/Utils/Telemetry/TelemetryEntity";
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

/*
 * The linked-id cache key: per (id, observed endpoint), so a changed or
 * second agent address is claimed on its own first batch ("-" = none).
 */
function linkedCacheKey(endpoint: string = FORMATTED_ENDPOINT): string {
  return `${PROJECT_ID.toString()}:id:${LINKED_ID}:${endpoint}`;
}

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
      // A generic collector's receiver: no agent stamp, no versions.
      collector: {
        agentVersion: undefined,
        dbVersion: undefined,
        reportedByDatabaseAgent: false,
      },
    });
    // Never by id: this batch carries no link.
    expect(findByIdInProject).not.toHaveBeenCalled();
  });

  /*
   * e2e: "MySQL mariamysql.rcv-e2e.example.net:3306" was created at
   * 22:45:47.695 and its agentVersion / dbVersion read "-" until 22:51:47:
   * the heartbeat below the create lost the row lock to the create's own
   * feed item, and the fence it runs behind held every retry off.
   */
  test("the batch that may create the row hands it the agent and engine versions, so no heartbeat has to", async () => {
    await discover({
      ...AGENT_ATTRIBUTES,
      "db.system.name": "mysql",
      "server.address": "mariamysql.rcv-e2e.example.net",
      "server.port": "3306",
      "db.system.version": "11.4.13-MariaDB-ubu2404",
    });

    expect(findOrCreateByEndpoint).toHaveBeenCalledTimes(1);
    expect(findOrCreateByEndpoint.mock.calls[0]![0].collector).toEqual({
      agentVersion: "0.161.0",
      dbVersion: "11.4.13-MariaDB-ubu2404",
      reportedByDatabaseAgent: true,
    });
    // The heartbeat still carries the same versions for rows that already existed.
    expect(recordCollectorHeartbeat).toHaveBeenCalledWith(
      expect.any(ObjectID),
      expect.objectContaining({
        agentVersion: "0.161.0",
        dbVersion: "11.4.13-MariaDB-ubu2404",
      }),
    );
  });

  test("a batch whose fence is held still hands a row it creates its versions", async () => {
    heldFences.add(`database-server:${DATABASE_ID}`);

    await discover({ ...AGENT_ATTRIBUTES, "db.system.version": "16.2" });

    expect(recordCollectorHeartbeat).not.toHaveBeenCalled();
    expect(findOrCreateByEndpoint.mock.calls[0]![0].collector).toEqual({
      agentVersion: "0.161.0",
      dbVersion: "16.2",
      reportedByDatabaseAgent: true,
    });
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
    expect(extra).toEqual({
      agentVersion: "0.161.0",
      dbVersion: "16.2",
      dbSystem: "postgresql",
    });
  });

  test("absent versions are passed as undefined, never as empty strings", async () => {
    await discover(RECEIVER_ATTRIBUTES, "postgresql");

    expect(recordCollectorHeartbeat).toHaveBeenCalledWith(
      expect.any(ObjectID),
      { agentVersion: undefined, dbVersion: undefined, dbSystem: "postgresql" },
    );
  });

  test("a legacy db.system + server.address stamp needs no hint either", async () => {
    await discover({
      "db.system": "mysql",
      "server.address": "billing-db.example.com",
    });

    expect(findOrCreateByEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        dbSystem: "mysql",
        endpoint: { host: "billing-db.example.com", port: 3306 },
        displayName: "MySQL billing-db.example.com:3306",
      }),
    );
  });

  test("a SAP HANA receiver batch (db.system + saphana.host) registers on the engine's default port", async () => {
    const result: ObjectID | null = await discover(
      {
        "db.system": "saphana",
        "saphana.host": "hana.example.com",
      },
      "sap.hana",
    );

    expect(result?.toString()).toBe(DATABASE_ID);
    expect(findOrCreateByEndpoint).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      dbSystem: "sap.hana",
      endpoint: { host: "hana.example.com", port: 30015 },
      discoverySource: DatabaseServerDiscoverySource.Collector,
      displayName: "SAP HANA hana.example.com:30015",
      allowCreate: true,
      collector: {
        agentVersion: undefined,
        dbVersion: undefined,
        reportedByDatabaseAgent: false,
      },
    });
    expect(recordCollectorHeartbeat).toHaveBeenCalledWith(
      expect.any(ObjectID),
      expect.objectContaining({ dbSystem: "sap.hana" }),
    );
  });

  test("a MariaDB version string refines the mysql receiver's engine everywhere it is used", async () => {
    await discover(
      {
        "mysql.instance.endpoint": "billing-db.example.com:3306",
        "db.system.version": "10.11.7-MariaDB-1:10.11.7+maria~ubu2204",
      },
      "mysql",
    );

    expect(findOrCreateByEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        dbSystem: "mariadb",
        endpoint: { host: "billing-db.example.com", port: 3306 },
        displayName: "MariaDB billing-db.example.com:3306",
      }),
    );
    expect(recordCollectorHeartbeat).toHaveBeenCalledWith(
      expect.any(ObjectID),
      expect.objectContaining({ dbSystem: "mariadb" }),
    );
  });
});

describe("autoDiscoverDatabaseServer resolveDatabaseServerResource pre-check", () => {
  function resolve(
    values: Record<string, string>,
    receiverSystemHint?: string | null,
  ): unknown {
    return baseService["resolveDatabaseServerResource"]({
      attributes: attributes(values),
      receiverSystemHint: receiverSystemHint,
    });
  }

  test("an application batch is refused without flattening its attributes", () => {
    const flatten: jest.SpiedFunction<typeof TelemetryUtil.getAttributes> =
      jest.spyOn(TelemetryUtil, "getAttributes");

    expect(
      resolve({
        "service.name": "checkout",
        "server.address": ENDPOINT_HOST,
        "host.name": "app-vm-1",
      }),
    ).toBeNull();
    expect(flatten).not.toHaveBeenCalled();
  });

  test.each<[string, Record<string, string>]>([
    [
      "db.system.name",
      { "db.system.name": "mysql", "server.address": "billing-db.example.com" },
    ],
    [
      "the legacy db.system",
      { "db.system": "mysql", "server.address": "billing-db.example.com" },
    ],
    [
      "oneuptime.database.server.id",
      {
        "oneuptime.database.server.id": LINKED_ID,
        "server.address": "billing-db.example.com",
      },
    ],
  ])(
    "an engine or link stamp (%s) passes the pre-check with no receiver hint",
    (_label: string, values: Record<string, string>) => {
      const flatten: jest.SpiedFunction<typeof TelemetryUtil.getAttributes> =
        jest.spyOn(TelemetryUtil, "getAttributes");

      expect(resolve(values)).toMatchObject({
        endpoint: { host: "billing-db.example.com" },
      });
      expect(flatten).toHaveBeenCalledTimes(1);
    },
  );
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
      linkedCacheKey(),
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
      linkedCacheKey(),
    );
  });

  test("the linked batch's engine rides the heartbeat as collector evidence for THAT row", async () => {
    await discover({
      ...AGENT_ATTRIBUTES,
      "db.system.name": "mariadb",
      "oneuptime.database.server.id": LINKED_ID,
    });

    // The endpoint path (which weighs the engine itself) is never taken…
    expect(findOrCreateByEndpoint).not.toHaveBeenCalled();
    // …so the heartbeat is where the linked row learns the engine.
    expect(recordCollectorHeartbeat).toHaveBeenCalledTimes(1);
    const [id, extra]: [ObjectID, unknown] = recordCollectorHeartbeat.mock
      .calls[0]! as [ObjectID, unknown];
    expect(id.toString()).toBe(LINKED_ID);
    expect(extra).toEqual({
      agentVersion: "0.161.0",
      dbVersion: undefined,
      dbSystem: "mariadb",
    });
  });

  test("a linked batch that names no engine reports none — never an empty string", async () => {
    await discover({ "oneuptime.database.server.id": LINKED_ID });

    expect(recordCollectorHeartbeat).toHaveBeenCalledTimes(1);
    const [, extra]: [ObjectID, { dbSystem?: string | undefined }] =
      recordCollectorHeartbeat.mock.calls[0]! as [
        ObjectID,
        { dbSystem?: string | undefined },
      ];
    expect(extra.dbSystem).toBeUndefined();
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
    expect(cachedEntityIds.get(linkedCacheKey())).toBe(LINKED_ID);
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
    expect(cachedEntityIds.get(linkedCacheKey())).toBe(LINKED_ID);
  });

  test("a cached linked id short-circuits the lookup and the claim", async () => {
    cachedEntityIds.set(linkedCacheKey(), LINKED_ID);

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
    expect(cachedEntityIds.has(linkedCacheKey())).toBe(false);
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
    // A LOCAL endpoint may only join a row that already owns it.
    expect(findOrCreateByEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: { host: "pg-primary", port: 5432 },
        allowCreate: false,
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

  const ROW_KEY: string = keyForDatabaseServerRow(
    PROJECT_ID.toString(),
    DATABASE_ID,
  );
  const COLLECTOR_HOST_KEY: string = keyForHost(
    PROJECT_ID.toString(),
    "collector-vm-1",
  );

  async function resolve(data: {
    values: Record<string, string>;
    endpoint?: DatabaseEndpoint | null;
    databaseServerId?: ObjectID | null;
    stampedDatabaseServerId?: ObjectID | null;
    entityRefs?: Array<ResourceEntityRef> | undefined;
  }): Promise<TelemetryServiceMetadata> {
    return (await baseService["resolveTelemetryResource"]({
      req: { headers: {} } as ExpressRequest,
      attributes: attributes(data.values),
      projectId: PROJECT_ID,
      hostId: new ObjectID(HOST_ID),
      databaseServerId:
        data.databaseServerId === undefined
          ? new ObjectID(DATABASE_ID)
          : data.databaseServerId,
      databaseServerName: DISPLAY_NAME,
      stampedDatabaseServerId: data.stampedDatabaseServerId ?? null,
      databaseServerEndpoint: data.endpoint ?? null,
      entityRefs: data.entityRefs,
    })) as TelemetryServiceMetadata;
  }

  test("appends keyForDatabaseEndpoint after the (sorted) extracted keys, then the row key", async () => {
    const withoutEndpoint: TelemetryServiceMetadata = await resolve({
      values: { ...RECEIVER_ATTRIBUTES, "k8s.pod.name": "collector-0" },
    });
    const withEndpoint: TelemetryServiceMetadata = await resolve({
      values: { ...RECEIVER_ATTRIBUTES, "k8s.pod.name": "collector-0" },
      endpoint: ENDPOINT,
    });

    const endpointKey: string = keyForDatabaseEndpoint(
      PROJECT_ID.toString(),
      ENDPOINT,
    );

    expect(withoutEndpoint.entityKeys).not.toContain(endpointKey);
    const extracted: Array<string> = (withoutEndpoint.entityKeys || []).filter(
      (key: string): boolean => {
        return key !== ROW_KEY;
      },
    );
    // The rest of the membership set (here the pod) is untouched.
    expect(extracted.length).toBeGreaterThan(0);
    expect(withoutEndpoint.entityKeys).toEqual([...extracted, ROW_KEY]);
    expect(withEndpoint.entityKeys).toEqual([
      ...extracted,
      endpointKey,
      ROW_KEY,
    ]);
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

    const endpointKey: string = keyForDatabaseEndpoint(
      PROJECT_ID.toString(),
      ENDPOINT,
    );
    expect(first.entityKeys).toContain(endpointKey);
    expect(second.entityKeys).toContain(endpointKey);
    expect(first.entityKeys).toEqual(second.entityKeys);
  });

  test("a database-primary block carries the row key even with no endpoint at all", async () => {
    const metadata: TelemetryServiceMetadata = await resolve({
      values: { "oneuptime.database.server.id": DATABASE_ID },
    });

    expect(metadata.entityKeys).toEqual([ROW_KEY]);
  });

  test("a host agent's block (Host primary) that only STAMPS the database still carries its row key", async () => {
    const metadata: TelemetryServiceMetadata = await resolve({
      values: RECEIVER_ATTRIBUTES,
      databaseServerId: null,
      stampedDatabaseServerId: new ObjectID(DATABASE_ID),
      endpoint: ENDPOINT,
    });

    expect(metadata.primaryEntityType).toBe(ServiceType.Host);
    expect(metadata.entityKeys).toContain(ROW_KEY);
    // The Host is this block's subject, so its heuristic entity stays.
    expect(metadata.entityKeys).toContain(COLLECTOR_HOST_KEY);
  });

  test("the same row as primary and stamp is keyed once", async () => {
    const metadata: TelemetryServiceMetadata = await resolve({
      values: RECEIVER_ATTRIBUTES,
      stampedDatabaseServerId: new ObjectID(DATABASE_ID),
    });

    expect(
      (metadata.entityKeys || []).filter((key: string): boolean => {
        return key === ROW_KEY;
      }),
    ).toHaveLength(1);
  });

  test("no database at all: no row key, no endpoint key", async () => {
    const metadata: TelemetryServiceMetadata = await resolve({
      values: RECEIVER_ATTRIBUTES,
      databaseServerId: null,
    });

    expect(metadata.entityKeys).toEqual([COLLECTOR_HOST_KEY]);
  });

  test("a database-primary block drops the collector machine's heuristic Host entity", async () => {
    const reconcile: jest.SpyInstance =
      EntityRegistry.reconcileEntityRegistryThrottled as unknown as jest.SpyInstance;

    const metadata: TelemetryServiceMetadata = await resolve({
      values: RECEIVER_ATTRIBUTES,
      endpoint: ENDPOINT,
    });

    // Not a membership key: the DB's rows never land on the collector VM's Host pages…
    expect(metadata.entityKeys).not.toContain(COLLECTOR_HOST_KEY);
    expect(metadata.scalarEntityKeys?.hostEntityKey || "").toBe("");
    // …and not minted into the Inventory either.
    const reconciled: Array<{ entityType: string }> = (
      reconcile.mock.calls[0]![0] as { entities: Array<{ entityType: string }> }
    ).entities;
    expect(
      reconciled.some((entity: { entityType: string }): boolean => {
        return entity.entityType === "host";
      }),
    ).toBe(false);
  });

  test("the sqlserver receiver's own host.name mints no phantom Host either", async () => {
    const metadata: TelemetryServiceMetadata = await resolve({
      values: { "host.name": "SQLPROD01", "server.address": "sqlprod01" },
    });

    expect(metadata.entityKeys).not.toContain(
      keyForHost(PROJECT_ID.toString(), "sqlprod01"),
    );
  });

  test("a Host the producer declared through entity_refs still wins", async () => {
    const metadata: TelemetryServiceMetadata = await resolve({
      values: RECEIVER_ATTRIBUTES,
      entityRefs: [{ type: "host", idKeys: ["host.name"] }],
    });

    expect(metadata.entityKeys).toContain(COLLECTOR_HOST_KEY);
  });

  test("withDatabaseServerRowEntityKeys returns a NEW array, skips nulls and never duplicates", () => {
    const shared: Array<string> = ["aaaaaaaaaaaaaaaa"];

    const appended: Array<string> = baseService[
      "withDatabaseServerRowEntityKeys"
    ]({
      entityKeys: shared,
      projectId: PROJECT_ID,
      databaseServerIds: [
        new ObjectID(DATABASE_ID),
        null,
        undefined,
        new ObjectID(DATABASE_ID),
      ],
    }) as Array<string>;

    expect(appended).toEqual(["aaaaaaaaaaaaaaaa", ROW_KEY]);
    expect(appended).not.toBe(shared);
    expect(shared).toEqual(["aaaaaaaaaaaaaaaa"]);

    expect(
      baseService["withDatabaseServerRowEntityKeys"]({
        entityKeys: appended,
        projectId: PROJECT_ID,
        databaseServerIds: [new ObjectID(DATABASE_ID)],
      }),
    ).toBe(appended);
    expect(
      baseService["withDatabaseServerRowEntityKeys"]({
        entityKeys: shared,
        projectId: PROJECT_ID,
        databaseServerIds: [null],
      }),
    ).toBe(shared);
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

  test("a SAP HANA receiver block (db.system + saphana.host only) reaches its database", async () => {
    const spies: PillarSpies = setup(new ObjectID(DATABASE_ID));

    await OtelMetricsIngestService.processMetricsFromQueue(
      request({
        resourceAttributes: {
          "db.system": "saphana",
          "saphana.host": "hana.example.com",
        },
        scopes: [
          {
            name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/saphanareceiver",
            metrics: ["saphana.connection.count"],
          },
        ],
      }),
    );

    expect(spies.discoverDatabase).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      attributes: expect.any(Array),
      receiverSystemHint: "sap.hana",
    });
    expect(spies.resolveResource).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseServerId: new ObjectID(DATABASE_ID),
        databaseServerName: "SAP HANA hana.example.com:30015",
        databaseServerEndpoint: { host: "hana.example.com", port: 30015 },
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

/*
 * ---- Linked ids: cached per (id, observed endpoint) -------------------------
 *
 * The claim of a linked batch's address runs only on a cache miss. Keyed on
 * the id alone, one address per id per hour was claimed: a changed
 * DATABASE_SERVER_ADDRESS, or replicas sharing one DATABASE_SERVER_ID, waited
 * out the TTL.
 */
describe("autoDiscoverDatabaseServer linked id — cached per observed endpoint", () => {
  function linked(address?: string): Record<string, string> {
    const values: Record<string, string> = {
      ...AGENT_ATTRIBUTES,
      "oneuptime.database.server.id": LINKED_ID,
    };
    if (address === undefined) {
      return values;
    }
    values["server.address"] = address;
    return values;
  }

  test("a changed agent address under the same id is claimed on its first batch — not starved by the cached id", async () => {
    await discover(linked());
    expect(claimEndpoint).toHaveBeenCalledTimes(1);

    await discover(linked("orders-db-new.example.com"));

    expect(claimEndpoint).toHaveBeenCalledTimes(2);
    expect(
      (claimEndpoint.mock.calls[1]![0] as { endpoint: string }).endpoint,
    ).toBe("orders-db-new.example.com:5432");
    expect(cachedEntityIds.get(linkedCacheKey())).toBe(LINKED_ID);
    expect(
      cachedEntityIds.get(linkedCacheKey("orders-db-new.example.com:5432")),
    ).toBe(LINKED_ID);
  });

  test("replicas sharing one id each get their own address claimed once, then serve from the cache", async () => {
    const addresses: Array<string> = [
      "pg-primary.example.com",
      "pg-replica-1.example.com",
      "pg-replica-2.example.com",
    ];

    for (let round: number = 0; round < 3; round++) {
      for (const address of addresses) {
        await expect(discover(linked(address))).resolves.toEqual(
          new ObjectID(LINKED_ID),
        );
      }
    }

    expect(claimEndpoint).toHaveBeenCalledTimes(3);
    expect(findByIdInProject).toHaveBeenCalledTimes(3);
    expect(
      claimEndpoint.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as { endpoint: string }).endpoint;
      }),
    ).toEqual(
      addresses.map((address: string): string => {
        return `${address}:5432`;
      }),
    );
  });

  test("an id linked without an address is cached under '-'", async () => {
    await discover({
      "oneuptime.database.server.id": LINKED_ID,
      "db.system.name": "memcached",
    });

    expect(cachedEntityIds.get(linkedCacheKey("-"))).toBe(LINKED_ID);
    expect(claimEndpoint).not.toHaveBeenCalled();
  });

  test("a cached entry for one address never answers for another", async () => {
    cachedEntityIds.set(linkedCacheKey(), LINKED_ID);

    await discover(linked("other-db.example.com"));

    expect(findByIdInProject).toHaveBeenCalledTimes(1);
    expect(claimEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "other-db.example.com:5432" }),
    );
  });

  test("a missing linked row is memoed per address too", async () => {
    findByIdInProject.mockResolvedValue(null);

    await discover(linked());
    await discover(linked());
    await discover(linked("other-db.example.com"));

    expect(findByIdInProject).toHaveBeenCalledTimes(2);
  });

  test("a pod IP linked by id joins the row but is never claimed as its alias", async () => {
    const result: ObjectID | null = await discover(
      {
        "server.address": "10.42.1.17",
        "server.port": "5432",
        "k8s.pod.name": "postgres-0",
        "k8s.namespace.name": "prod",
        "k8s.cluster.name": "prod-eu",
        "oneuptime.database.server.id": LINKED_ID,
      },
      "postgresql",
    );

    expect(result?.toString()).toBe(LINKED_ID);
    expect(claimEndpoint).not.toHaveBeenCalled();
  });

  test("a single label expanded with the collector's own namespace is never claimed", async () => {
    await discover(
      {
        "server.address": "orders-api-7c9d8f6b5-x2k4q",
        "k8s.namespace.name": "prod",
        "k8s.cluster.name": "c1",
        "oneuptime.database.server.id": LINKED_ID,
      },
      "postgresql",
    );

    expect(claimEndpoint).not.toHaveBeenCalled();
  });

  test("a Service FQDN qualified with its cluster is claimed", async () => {
    await discover(
      {
        "server.address": "postgres.prod.svc.cluster.local",
        "k8s.cluster.name": "c1",
        "oneuptime.database.server.id": LINKED_ID,
      },
      "postgresql",
    );

    expect(claimEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "postgres.prod.svc.cluster.local:5432@c1",
      }),
    );
  });
});

/*
 * ---- The collector path creates rows only for stable identities -----------
 */
describe("autoDiscoverDatabaseServer endpoint path — who may create a row", () => {
  // receiver_creator + k8s_observer: the scraped pod's IP, name and cluster.
  const POD_IP_BATCH: Record<string, string> = {
    "server.address": "10.42.1.17",
    "server.port": "5432",
    "k8s.pod.name": "postgres-0",
    "k8s.namespace.name": "prod",
    "k8s.cluster.name": "prod-eu",
  };

  function allowCreateOfCall(index: number): unknown {
    return (
      findOrCreateByEndpoint.mock.calls[index]![0] as { allowCreate: unknown }
    ).allowCreate;
  }

  test("a stable FQDN of a known engine may create its row", async () => {
    await discover(AGENT_ATTRIBUTES);

    expect(findOrCreateByEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: { host: ENDPOINT_HOST, port: 5432 },
        discoverySource: DatabaseServerDiscoverySource.Collector,
        allowCreate: true,
      }),
    );
  });

  test("a pod IP only joins the row that already owns it — every restart would otherwise add a database", async () => {
    findOrCreateByEndpoint.mockResolvedValue(null);

    for (const address of ["10.42.1.17", "10.42.3.88", "10.42.9.4"]) {
      await expect(
        discover({ ...POD_IP_BATCH, "server.address": address }, "postgresql"),
      ).resolves.toBeNull();
    }

    expect(findOrCreateByEndpoint).toHaveBeenCalledTimes(3);
    for (let index: number = 0; index < 3; index++) {
      expect(allowCreateOfCall(index)).toBe(false);
    }
    expect(recordCollectorHeartbeat).not.toHaveBeenCalled();
  });

  test("a pod IP a person added as an alias (or linked) is still found", async () => {
    findOrCreateByEndpoint.mockResolvedValue(databaseServerRow(DATABASE_ID));

    await expect(discover(POD_IP_BATCH, "postgresql")).resolves.toEqual(
      new ObjectID(DATABASE_ID),
    );
    expect(allowCreateOfCall(0)).toBe(false);
  });

  test("a sidecar's namespace-expanded pod hostname only joins", async () => {
    findOrCreateByEndpoint.mockResolvedValue(null);

    await discover(
      {
        "server.address": "orders-api-7c9d8f6b5-x2k4q",
        "k8s.namespace.name": "prod",
        "k8s.cluster.name": "c1",
      },
      "postgresql",
    );

    expect(allowCreateOfCall(0)).toBe(false);
  });

  test("an unknown engine only joins", async () => {
    findOrCreateByEndpoint.mockResolvedValue(null);

    await discover({
      "db.system.name": "acme-db",
      "server.address": "acme.prod.example.com",
      "oneuptime.database.agent": "true",
    });

    expect(allowCreateOfCall(0)).toBe(false);
  });

  test("the unresolved memo is per permission: a join-only miss never turns away a batch that may create", async () => {
    findOrCreateByEndpoint.mockResolvedValue(null);

    // A single label expanded with the collector's namespace: join only.
    await discover(
      {
        "server.address": "postgres",
        "k8s.namespace.name": "prod",
        "k8s.cluster.name": "c1",
      },
      "postgresql",
    );
    // The same endpoint written out explicitly: may create.
    findOrCreateByEndpoint.mockResolvedValue(databaseServerRow(DATABASE_ID));
    const result: ObjectID | null = await discover(
      {
        "server.address": "postgres.prod.svc.cluster.local",
        "k8s.cluster.name": "c1",
      },
      "postgresql",
    );

    expect(result?.toString()).toBe(DATABASE_ID);
    expect(findOrCreateByEndpoint).toHaveBeenCalledTimes(2);
    expect(allowCreateOfCall(0)).toBe(false);
    expect(allowCreateOfCall(1)).toBe(true);
  });

  test("a project over its auto-create budget (find-or-create declines) resolves to no row, quietly, and is memoed", async () => {
    findOrCreateByEndpoint.mockResolvedValue(null);

    await expect(discover(AGENT_ATTRIBUTES)).resolves.toBeNull();
    await expect(discover(AGENT_ATTRIBUTES)).resolves.toBeNull();

    expect(findOrCreateByEndpoint).toHaveBeenCalledTimes(1);
    expect(allowCreateOfCall(0)).toBe(true);
    expect(setString).not.toHaveBeenCalled();
    expect(recordCollectorHeartbeat).not.toHaveBeenCalled();
  });

  test("find-or-create returning a row without an id is treated as no row", async () => {
    findOrCreateByEndpoint.mockResolvedValue(new DatabaseServer());

    await expect(discover(AGENT_ATTRIBUTES)).resolves.toBeNull();
    expect(recordCollectorHeartbeat).not.toHaveBeenCalled();
  });
});

/*
 * ---- Which endpoint keys a database batch's rows ---------------------------
 */
describe("getDatabaseEndpointForEntityKey", () => {
  const ENDPOINT: DatabaseEndpoint = { host: ENDPOINT_HOST, port: 5432 };

  function resolution(
    linkedDatabaseServerId: string | null,
    endpoint: DatabaseEndpoint | null = ENDPOINT,
  ): Record<string, unknown> {
    return {
      system: "postgresql",
      endpoint,
      linkedDatabaseServerId,
      displayName: DISPLAY_NAME,
      version: null,
      endpointIsStable: true,
      allowCreate: true,
    };
  }

  function keyedEndpoint(
    resolved: Record<string, unknown> | null,
    databaseServerId: string | null,
  ): DatabaseEndpoint | null {
    return baseService["getDatabaseEndpointForEntityKey"]({
      resolution: resolved,
      databaseServerId: databaseServerId
        ? new ObjectID(databaseServerId)
        : null,
    }) as DatabaseEndpoint | null;
  }

  test("not a database batch, or no endpoint: nothing", () => {
    expect(keyedEndpoint(null, DATABASE_ID)).toBeNull();
    expect(keyedEndpoint(resolution(null, null), DATABASE_ID)).toBeNull();
  });

  test("resolved by its endpoint: the endpoint (its owner's key)", () => {
    expect(keyedEndpoint(resolution(null), DATABASE_ID)).toEqual(ENDPOINT);
  });

  test("resolved to no row: the endpoint, so a row that owns it later finds the data", () => {
    expect(keyedEndpoint(resolution(null), null)).toEqual(ENDPOINT);
  });

  test("resolved by the link: no endpoint key — the row key places the rows", () => {
    expect(keyedEndpoint(resolution(LINKED_ID), LINKED_ID)).toBeNull();
    // Case never matters.
    expect(
      keyedEndpoint(resolution(LINKED_ID.toUpperCase()), LINKED_ID),
    ).toBeNull();
  });

  test("the link was not in the project and the endpoint's owner answered: the endpoint", () => {
    expect(keyedEndpoint(resolution(LINKED_ID), DATABASE_ID)).toEqual(ENDPOINT);
  });

  test("a batch that names a row but resolved to nothing is not provably anyone else's: nothing", () => {
    expect(keyedEndpoint(resolution(LINKED_ID), null)).toBeNull();
  });
});

/*
 * ---- End to end: ingest keys vs. the page's key set ------------------------
 *
 * The real metrics pillar and the real resolveTelemetryResource (only the
 * row lookups and writes mocked), checked against the key set the
 * database's pages query (getDatabaseServerSignalEntityKeys).
 */
describe("linked telemetry reaches the linked database's pages — and no other", () => {
  const OTHER_ID: string = "88888888-8888-4888-8888-888888888888";

  function setupRealResolver(databaseServerId: ObjectID | null): {
    rows: Array<JSONObject>;
  } {
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
    jest
      .spyOn(metricsService, "autoDiscoverDatabaseServer")
      .mockResolvedValue(databaseServerId);
    jest.spyOn(metricsService, "autoDiscoverHost").mockResolvedValue(null);
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
    jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue({
      projectRules: [],
      rulesByServiceId: new Map(),
    });
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(undefined as any);

    return { rows };
  }

  async function ingest(
    resourceAttributes: Record<string, string>,
  ): Promise<void> {
    await OtelMetricsIngestService.processMetricsFromQueue({
      projectId: PROJECT_ID,
      body: {
        resourceMetrics: [
          {
            resource: { attributes: attributes(resourceAttributes) },
            scopeMetrics: [
              {
                scope: { name: POSTGRES_RECEIVER_SCOPE, version: "0.120.0" },
                metrics: [
                  {
                    name: "postgresql.backends",
                    gauge: {
                      dataPoints: [{ timeUnixNano: TIME_NANO, asInt: 7 }],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      headers: {},
    } as unknown as TelemetryRequest);
  }

  function engineRow(rows: Array<JSONObject>): JSONObject {
    const row: JSONObject | undefined = rows.find((r: JSONObject) => {
      return r["name"] === "postgresql.backends";
    });
    expect(row).toBeDefined();
    return row!;
  }

  function pageKeys(data: {
    id: string;
    endpoints: Array<string>;
  }): Array<string> {
    return getDatabaseServerSignalEntityKeys({
      projectId: PROJECT_ID.toString(),
      databaseServerId: data.id,
      endpoints: data.endpoints,
      dbSystem: "postgresql",
      memberEntityKeys: null,
    });
  }

  function overlaps(a: Array<string>, b: Array<string>): boolean {
    return a.some((key: string): boolean => {
      return b.includes(key);
    });
  }

  test("the Documentation tab's agent config in a two-cluster project: its cluster-local address is LOCAL, the rows still match the row's page", async () => {
    const { rows } = setupRealResolver(new ObjectID(LINKED_ID));

    await ingest({
      "db.system.name": "postgresql",
      "server.address": "postgres.prod.svc.cluster.local",
      "server.port": "5432",
      "oneuptime.database.agent": "true",
      "oneuptime.database.server.id": LINKED_ID,
    });

    const entityKeys: Array<string> = engineRow(rows)[
      "entityKeys"
    ] as Array<string>;
    // The row the worker made: only cluster-qualified aliases.
    const linkedPage: Array<string> = pageKeys({
      id: LINKED_ID,
      endpoints: buildKubernetesDatabaseAliases({
        system: "postgresql",
        namespace: "prod",
        clusterName: "cluster-a",
        serviceNames: ["postgres"],
        ports: [],
        includeUnqualified: false,
      }),
    });

    expect(overlaps(entityKeys, linkedPage)).toBe(true);
    expect(entityKeys).toContain(
      keyForDatabaseServerRow(PROJECT_ID.toString(), LINKED_ID),
    );
    expect(engineRow(rows)["primaryEntityId"]).toBe(LINKED_ID);
  });

  test("a private IP linked to a Docker-detected row (no endpoints at all) matches its page", async () => {
    const { rows } = setupRealResolver(new ObjectID(LINKED_ID));

    await ingest({
      "db.system.name": "postgresql",
      "server.address": "10.0.3.7",
      "oneuptime.database.agent": "true",
      "oneuptime.database.server.id": LINKED_ID,
    });

    expect(
      overlaps(
        engineRow(rows)["entityKeys"] as Array<string>,
        pageKeys({ id: LINKED_ID, endpoints: [] }),
      ),
    ).toBe(true);
  });

  test("memcached linked by id alone (no address) matches its page", async () => {
    const { rows } = setupRealResolver(new ObjectID(LINKED_ID));

    await ingest({ "oneuptime.database.server.id": LINKED_ID });

    expect(
      overlaps(
        engineRow(rows)["entityKeys"] as Array<string>,
        pageKeys({ id: LINKED_ID, endpoints: [] }),
      ),
    ).toBe(true);
  });

  test("an address ANOTHER database owns: the rows land on the linked row's page, never on the owner's", async () => {
    claimEndpoint.mockResolvedValue("owned-by-other");
    const { rows } = setupRealResolver(new ObjectID(LINKED_ID));

    await ingest({
      ...AGENT_ATTRIBUTES,
      "oneuptime.database.server.id": LINKED_ID,
    });

    const entityKeys: Array<string> = engineRow(rows)[
      "entityKeys"
    ] as Array<string>;
    expect(
      overlaps(entityKeys, pageKeys({ id: LINKED_ID, endpoints: [] })),
    ).toBe(true);
    // The owner's page is its row key plus the endpoint it owns.
    expect(
      overlaps(
        entityKeys,
        pageKeys({ id: OTHER_ID, endpoints: [FORMATTED_ENDPOINT] }),
      ),
    ).toBe(false);
  });

  test("a batch resolved by its endpoint keeps the endpoint key AND gets its owner's row key", async () => {
    const { rows } = setupRealResolver(new ObjectID(DATABASE_ID));

    await ingest(RECEIVER_ATTRIBUTES);

    const entityKeys: Array<string> = engineRow(rows)[
      "entityKeys"
    ] as Array<string>;
    expect(entityKeys).toContain(
      keyForDatabaseEndpoint(PROJECT_ID.toString(), {
        host: ENDPOINT_HOST,
        port: 5432,
      }),
    );
    expect(entityKeys).toContain(
      keyForDatabaseServerRow(PROJECT_ID.toString(), DATABASE_ID),
    );
    // The collector VM's host.name is not a Host of this batch.
    expect(entityKeys).not.toContain(
      keyForHost(PROJECT_ID.toString(), "collector-vm-1"),
    );
  });

  test("an unresolved LOCAL endpoint keeps only its endpoint key, for a row created later", async () => {
    const { rows } = setupRealResolver(null);

    await ingest({ ...AGENT_ATTRIBUTES, "server.address": "pg-primary" });

    const entityKeys: Array<string> = engineRow(rows)[
      "entityKeys"
    ] as Array<string>;
    expect(entityKeys).toContain(
      keyForDatabaseEndpoint(PROJECT_ID.toString(), {
        host: "pg-primary",
        port: 5432,
      }),
    );
    expect(
      (engineRow(rows)["attributes"] as JSONObject)[
        "oneuptime.database.server.id"
      ],
    ).toBeUndefined();
  });

  test("a linked id that resolved to nothing keys no endpoint (it is not provably that address's)", async () => {
    const { rows } = setupRealResolver(null);

    await ingest({
      ...AGENT_ATTRIBUTES,
      "oneuptime.database.server.id": LINKED_ID,
    });

    expect(engineRow(rows)["entityKeys"]).not.toContain(
      keyForDatabaseEndpoint(PROJECT_ID.toString(), {
        host: ENDPOINT_HOST,
        port: 5432,
      }),
    );
  });
});

/*
 * ---- The synthetic host heartbeat is a Host's, never a database's ----------
 */
describe("oneuptime.host.heartbeat and database blocks", () => {
  const HEARTBEAT: string = "oneuptime.host.heartbeat";

  function hostMetadata(): TelemetryServiceMetadata {
    return {
      serviceName: "host/collector-vm-1",
      primaryEntityId: new ObjectID(HOST_ID),
      primaryEntityType: ServiceType.Host,
      entityKeys: [],
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    };
  }

  function setupHeartbeat(databaseServerId: ObjectID | null): {
    rows: Array<JSONObject>;
    resolveResource: jest.SpyInstance;
  } {
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
    jest
      .spyOn(metricsService, "autoDiscoverDatabaseServer")
      .mockImplementation(async (...args: Array<unknown>) => {
        const data: { receiverSystemHint?: string | null } = args[0] as {
          receiverSystemHint?: string | null;
        };
        return data.receiverSystemHint ? databaseServerId : null;
      });
    jest
      .spyOn(metricsService, "autoDiscoverHost")
      .mockResolvedValue(new ObjectID(HOST_ID));
    const resolveResource: jest.SpyInstance = jest
      .spyOn(metricsService, "resolveTelemetryResource")
      .mockImplementation(async (...args: Array<unknown>) => {
        const data: { databaseServerId?: ObjectID | null } = args[0] as {
          databaseServerId?: ObjectID | null;
        };
        return data.databaseServerId ? databaseMetadata() : hostMetadata();
      });
    jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue({
      projectRules: [],
      rulesByServiceId: new Map(),
    });
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(undefined as any);

    return { rows, resolveResource };
  }

  function block(
    resourceAttributes: Record<string, string>,
    scopes: Array<{ name: string; metric: string }>,
  ): JSONObject {
    return {
      resource: { attributes: attributes(resourceAttributes) },
      scopeMetrics: scopes.map(
        (scope: { name: string; metric: string }): JSONObject => {
          return {
            scope: { name: scope.name, version: "0.120.0" },
            metrics: [
              {
                name: scope.metric,
                gauge: { dataPoints: [{ timeUnixNano: TIME_NANO, asInt: 7 }] },
              },
            ],
          };
        },
      ),
    };
  }

  async function ingestBlocks(blocks: Array<JSONObject>): Promise<void> {
    await OtelMetricsIngestService.processMetricsFromQueue({
      projectId: PROJECT_ID,
      body: { resourceMetrics: blocks },
      headers: {},
    } as unknown as TelemetryRequest);
  }

  function heartbeats(rows: Array<JSONObject>): Array<JSONObject> {
    return rows.filter((row: JSONObject): boolean => {
      return row["name"] === HEARTBEAT;
    });
  }

  const POSTGRES_SCOPE: { name: string; metric: string } = {
    name: POSTGRES_RECEIVER_SCOPE,
    metric: "postgresql.backends",
  };
  const HOSTMETRICS_SCOPE: { name: string; metric: string } = {
    name: "otelcol/hostmetricsreceiver/cpu",
    metric: "system.cpu.time",
  };

  test("a database's engine block emits no heartbeat for the collector machine's host.name", async () => {
    const { rows } = setupHeartbeat(new ObjectID(DATABASE_ID));

    await ingestBlocks([block(RECEIVER_ATTRIBUTES, [POSTGRES_SCOPE])]);

    expect(heartbeats(rows)).toEqual([]);
    expect(
      rows.some((row: JSONObject): boolean => {
        return row["name"] === "postgresql.backends";
      }),
    ).toBe(true);
  });

  test("the sqlserver receiver's own host.name gets no heartbeat either", async () => {
    const { rows } = setupHeartbeat(new ObjectID(DATABASE_ID));

    await ingestBlocks([
      block({ "host.name": "SQLPROD01", "server.address": "sqlprod01" }, [
        {
          name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/sqlserverreceiver",
          metric: "sqlserver.user.connection.count",
        },
      ]),
    ]);

    expect(heartbeats(rows)).toEqual([]);
  });

  test("a database block before the Host's hostmetrics block in one payload does not use up the Host's heartbeat", async () => {
    const { rows } = setupHeartbeat(new ObjectID(DATABASE_ID));

    await ingestBlocks([
      block(RECEIVER_ATTRIBUTES, [POSTGRES_SCOPE]),
      block({ "host.name": "collector-vm-1", "os.type": "linux" }, [
        HOSTMETRICS_SCOPE,
      ]),
    ]);

    const beats: Array<JSONObject> = heartbeats(rows);
    expect(beats).toHaveLength(1);
    expect(beats[0]!["primaryEntityType"]).toBe(ServiceType.Host);
    expect(
      (beats[0]!["attributes"] as JSONObject)["oneuptime.database.server.id"],
    ).toBeUndefined();
  });

  test("a host agent's block that also carries host metrics keeps its heartbeat", async () => {
    const { rows } = setupHeartbeat(new ObjectID(DATABASE_ID));

    await ingestBlocks([
      block(RECEIVER_ATTRIBUTES, [POSTGRES_SCOPE, HOSTMETRICS_SCOPE]),
    ]);

    const beats: Array<JSONObject> = heartbeats(rows);
    expect(beats).toHaveLength(1);
    expect(beats[0]!["primaryEntityType"]).toBe(ServiceType.Host);
  });

  test("a database block that resolved to NO row routes as before, heartbeat included", async () => {
    const { rows, resolveResource } = setupHeartbeat(null);

    await ingestBlocks([
      block({ ...RECEIVER_ATTRIBUTES, "server.address": "pg-primary" }, [
        POSTGRES_SCOPE,
      ]),
    ]);

    expect(resolveResource).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseServerId: null,
        stampedDatabaseServerId: null,
        databaseServerEndpoint: { host: "pg-primary", port: 5432 },
      }),
    );
    expect(heartbeats(rows)).toHaveLength(1);
  });

  test("pillar wiring: a linked batch passes its row as the stamp and NO endpoint", async () => {
    const { resolveResource } = setupHeartbeat(new ObjectID(LINKED_ID));

    await ingestBlocks([
      block(
        { ...RECEIVER_ATTRIBUTES, "oneuptime.database.server.id": LINKED_ID },
        [POSTGRES_SCOPE],
      ),
    ]);

    expect(resolveResource).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseServerId: new ObjectID(LINKED_ID),
        stampedDatabaseServerId: new ObjectID(LINKED_ID),
        databaseServerEndpoint: null,
      }),
    );
  });

  test("pillar wiring: a host agent's block passes the database as a stamp only", async () => {
    const { resolveResource } = setupHeartbeat(new ObjectID(DATABASE_ID));

    await ingestBlocks([
      block(RECEIVER_ATTRIBUTES, [POSTGRES_SCOPE, HOSTMETRICS_SCOPE]),
    ]);

    expect(resolveResource).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseServerId: null,
        stampedDatabaseServerId: new ObjectID(DATABASE_ID),
        databaseServerEndpoint: { host: ENDPOINT_HOST, port: 5432 },
      }),
    );
  });
});

describe("logs pillar: the row key and the endpoint key", () => {
  function setupLogs(databaseServerId: ObjectID | null): jest.SpyInstance {
    jest
      .spyOn(logsService, "submitLogsBuffer")
      .mockImplementation((...args: Array<unknown>): Promise<void> => {
        const buffer: Array<JSONObject> = args[0] as Array<JSONObject>;
        buffer.splice(0, buffer.length);
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
    jest
      .spyOn(logsService, "autoDiscoverDatabaseServer")
      .mockResolvedValue(databaseServerId);
    jest.spyOn(logsService, "autoDiscoverHost").mockResolvedValue(null);
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
    return jest
      .spyOn(logsService, "resolveTelemetryResource")
      .mockResolvedValue(databaseMetadata());
  }

  async function ingestLog(
    resourceAttributes: Record<string, string>,
  ): Promise<void> {
    await OtelLogsIngestService.processLogsFromQueue({
      projectId: PROJECT_ID,
      body: {
        resourceLogs: [
          {
            resource: { attributes: attributes(resourceAttributes) },
            scopeLogs: [
              {
                scope: { name: POSTGRES_RECEIVER_SCOPE },
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
    } as unknown as TelemetryRequest);
  }

  test("a linked log batch (query samples from the agent) is stamped with its row and keys no endpoint", async () => {
    const resolveResource: jest.SpyInstance = setupLogs(
      new ObjectID(LINKED_ID),
    );

    await ingestLog({
      ...AGENT_ATTRIBUTES,
      "server.address": "postgres.prod.svc.cluster.local",
      "oneuptime.database.server.id": LINKED_ID,
    });

    expect(resolveResource).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseServerId: new ObjectID(LINKED_ID),
        stampedDatabaseServerId: new ObjectID(LINKED_ID),
        databaseServerEndpoint: null,
      }),
    );
  });

  test("a log batch resolved by its endpoint keys the endpoint too", async () => {
    const resolveResource: jest.SpyInstance = setupLogs(
      new ObjectID(DATABASE_ID),
    );

    await ingestLog(RECEIVER_ATTRIBUTES);

    expect(resolveResource).toHaveBeenCalledWith(
      expect.objectContaining({
        stampedDatabaseServerId: new ObjectID(DATABASE_ID),
        databaseServerEndpoint: { host: ENDPOINT_HOST, port: 5432 },
      }),
    );
  });
});
