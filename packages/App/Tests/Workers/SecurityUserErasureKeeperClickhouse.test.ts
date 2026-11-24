import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * Erasing one person from Security Events' user vault (#10908), ON
 * CLUSTER as an install sends it, against a ClickHouse cluster of one
 * shard and two replicas coordinated by Keeper.
 *
 * Boot makes the events' and the vault's tables (the Replicated local
 * table, its projection and skip indexes, and the Distributed table in
 * front of it); the person's events and vault rows are written through
 * the Distributed tables; then the erasure's update of the events and
 * delete of the vault's rows run as mutations on the local tables, ON
 * CLUSTER. Both replicas end up with the token back in the person's
 * events, everything else about those events and everybody else's
 * events as they were, and no vault row of the person - while somebody
 * else's stays.
 *
 * Opt-in: it needs the cluster, which the docker compose file beside the
 * erasure suite starts (Tests/Workers/Fixtures/ClickhouseKeeperCluster):
 *
 *   docker compose -f Tests/Workers/Fixtures/ClickhouseKeeperCluster/docker-compose.yml up -d --wait
 *   TEST_CLICKHOUSE_KEEPER_CLUSTER_URL=http://default:test@localhost:18461 \
 *     npx jest Tests/Workers/SecurityUserErasureKeeperClickhouse.test.ts
 *   docker compose -f Tests/Workers/Fixtures/ClickhouseKeeperCluster/docker-compose.yml down
 *
 * The suite creates and drops only its own database, on both replicas.
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

// Boot's table creation, with the events' and the vault's services alone.
jest.mock("Common/Server/Services/Index", () => {
  const service: (path: string) => unknown = (path: string): unknown => {
    return (jest.requireActual(path) as { default: unknown }).default;
  };

  return {
    __esModule: true,
    AnalyticsServices: [
      service("Common/Server/Services/SecurityEventService"),
      service("Common/Server/Services/SecurityUserVaultService"),
    ],
    default: [],
  };
});

import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import SecurityUserVault from "Common/Models/AnalyticsModels/SecurityUserVault";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import SecurityUserVaultService, {
  SecurityUserVaultService as SecurityUserVaultServiceClass,
} from "Common/Server/Services/SecurityUserVaultService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import SecurityUserErasureEvents from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserErasureEvents";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  ERASED_USER_ATTRIBUTES,
  HASHED_USER_ATTRIBUTES,
  ScrubbedUserRole,
  USER_ERASED_ON_REQUEST,
} from "Common/Utils/SecurityEvent/ScrubbedUser";
import AnalyticsTableManagement from "../../FeatureSet/Workers/Utils/AnalyticsDatabase/TableManegement";

const endpoint: string | undefined =
  process.env["TEST_CLICKHOUSE_KEEPER_CLUSTER_URL"];

jest.setTimeout(300000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const CLUSTER: string = "oneuptime";
const REPLICAS: Array<string> = ["replica-1", "replica-2"];

const database: string = `user_erasure_keeper_test_${process.pid}_${Date.now()}`;

const PROJECT_ID: ObjectID = new ObjectID(
  "10908000-0000-4000-8000-0000000000f2",
);
const SOURCE_ID: ObjectID = new ObjectID(
  "10908000-0000-4000-8000-0000000000f3",
);

const ALICE: string = "alice@example.com";
const BOB: string = "bob@example.com";

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
}

const EVENTS_LOCAL: string = `${new SecurityEvent().tableName}Local`;
const VAULT_LOCAL: string = `${new SecurityUserVault().tableName}Local`;

type Connectable = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
  migrationDatabase: ClickhouseDatabase;
  migrationDatabaseClient: ClickhouseClient | null;
  statementGenerator: unknown;
};

// An event whose user who acted the vault named, as a scan stores it.
function namedEventRow(data: {
  uid: string;
  named: string;
  token: string;
}): JSONObject {
  const time: Date = OneUptimeDate.addRemoveMinutes(new Date(), -10);
  const attributes: Record<string, string> = {
    "oneuptime.log.id": `log-${data.uid}`,
    "enduser.id": data.named,
    [HASHED_USER_ATTRIBUTES[ScrubbedUserRole.Principal]]: data.token,
  };

  return {
    _id: ObjectID.generate().toString(),
    projectId: PROJECT_ID.toString(),
    primaryEntityId: SOURCE_ID.toString(),
    primaryEntityType: ServiceType.OpenTelemetry,
    time: OneUptimeDate.toClickhouseDateTime64(time),
    createdAt: OneUptimeDate.toClickhouseDateTime(time),
    eventUid: data.uid,
    classUid: 3002,
    className: "Authentication",
    statusName: "Failure",
    severityId: 3,
    severityName: "Medium",
    message: `Failed sign-in ${data.uid}`,
    principalUser: data.named,
    principalIp: "203.0.113.7",
    observables: [data.named, "203.0.113.7"],
    attributes,
    attributeKeys: Object.keys(attributes),
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(new Date(), 30),
    ),
  };
}

integration("an erasure on a replicated cluster", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  const originals: Map<Connectable, Partial<Connectable>> = new Map();
  const savedEnvironment: Record<string, string | undefined> = {};

  async function rows(query: string): Promise<Array<JSONObject>> {
    const result: { json: () => Promise<unknown> } = await client.query({
      query: query,
      format: "JSONEachRow",
    });

    return (await result.json()) as Array<JSONObject>;
  }

  async function waitUntil(
    description: string,
    condition: () => Promise<boolean>,
  ): Promise<void> {
    const deadline: number = Date.now() + 120000;

    while (Date.now() < deadline) {
      if (await condition()) {
        return;
      }

      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 500);
      });
    }

    throw new Error(`Timed out waiting until ${description}`);
  }

  function connect(
    service: Connectable,
    modelType: { new (): SecurityEvent | SecurityUserVault },
  ): void {
    originals.set(service, {
      database: service.database,
      databaseClient: service.databaseClient,
      ingestDatabase: service.ingestDatabase,
      ingestDatabaseClient: service.ingestDatabaseClient,
      migrationDatabase: service.migrationDatabase,
      migrationDatabaseClient: service.migrationDatabaseClient,
      statementGenerator: service.statementGenerator,
    });
    service.database = clickhouse;
    service.databaseClient = client;
    service.ingestDatabase = clickhouse;
    service.ingestDatabaseClient = client;
    service.migrationDatabase = clickhouse;
    service.migrationDatabaseClient = client;
    // Boot's statements name the database the service's generator was made with.
    service.statementGenerator = new StatementGenerator({
      modelType: modelType as never,
      database: clickhouse,
    });
  }

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_KEEPER_CLUSTER_URL must point at a local, disposable ClickHouse cluster.",
      );
    }

    for (const [key, value] of [
      ["CLICKHOUSE_CLUSTER_NAME", CLUSTER],
      ["CLICKHOUSE_DATABASE", database],
    ] as Array<[string, string]>) {
      savedEnvironment[key] = process.env[key];
      process.env[key] = value;
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 120000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await client.command({
      query: `CREATE DATABASE IF NOT EXISTS ${database} ON CLUSTER '${CLUSTER}'`,
    });

    connect(SecurityEventService as unknown as Connectable, SecurityEvent);
    connect(
      SecurityUserVaultService as unknown as Connectable,
      SecurityUserVault,
    );

    await AnalyticsTableManagement.createTables();

    await waitUntil("every replica holds the four tables", async () => {
      const tables: Array<JSONObject> = await rows(
        `SELECT hostName() AS replica, name FROM clusterAllReplicas('${CLUSTER}', system.tables) WHERE database = '${database}'`,
      );

      return tables.length === REPLICAS.length * 4;
    });
  });

  afterAll(async (): Promise<void> => {
    for (const [service, original] of originals.entries()) {
      Object.assign(service, original);
    }

    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    if (client) {
      await client.command({
        query: `DROP DATABASE IF EXISTS ${database} ON CLUSTER '${CLUSTER}' SYNC`,
      });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("the token goes back in the person's events and their vault rows go, on both replicas; everybody else stays", async () => {
    const aliceToken: string = tokenOf(ALICE);
    const bobToken: string = tokenOf(BOB);

    await SecurityUserVaultService.insertJsonRows(
      SecurityUserVaultServiceClass.toRows({
        projectId: PROJECT_ID,
        entries: [
          { token: aliceToken, user: ALICE },
          { token: bobToken, user: BOB },
        ],
        seenAt: new Date(),
      }),
      {
        clickhouseSettings: {
          wait_for_async_insert: 1,
          insert_distributed_sync: 1,
        },
      },
    );
    await (
      SecurityEventService as AnalyticsDatabaseService<SecurityEvent>
    ).insertJsonRows(
      [
        namedEventRow({ uid: "alice", named: ALICE, token: aliceToken }),
        namedEventRow({ uid: "bob", named: BOB, token: bobToken }),
      ],
      {
        clickhouseSettings: {
          wait_for_async_insert: 1,
          insert_distributed_sync: 1,
        },
      },
    );

    await waitUntil("both replicas hold the events and the rows", async () => {
      for (const table of [EVENTS_LOCAL, VAULT_LOCAL]) {
        const held: Array<JSONObject> = await rows(
          `SELECT hostName() AS replica, toString(count()) AS c FROM clusterAllReplicas('${CLUSTER}', ${database}.${table}) GROUP BY replica`,
        );

        if (
          held.length !== REPLICAS.length ||
          !held.every((row: JSONObject): boolean => {
            return Number(row["c"]) === 2;
          })
        ) {
          return false;
        }
      }

      return true;
    });

    expect(
      await SecurityUserErasureEvents.countNamedEvents({
        projectId: PROJECT_ID,
        tokens: [aliceToken],
      }),
    ).toBe(1);

    // As an install sends them: mutations on the local tables, ON CLUSTER.
    await SecurityUserErasureEvents.unnameEvents({
      projectId: PROJECT_ID,
      tokens: [aliceToken],
    });
    await SecurityUserVaultService.eraseTokens({
      projectId: PROJECT_ID,
      tokens: [aliceToken],
    });

    await waitUntil("both replicas apply the erasure", async () => {
      const events: Array<JSONObject> = await rows(
        `SELECT hostName() AS replica, eventUid, principalUser FROM clusterAllReplicas('${CLUSTER}', ${database}.${EVENTS_LOCAL}) ORDER BY replica, eventUid`,
      );
      const vault: Array<JSONObject> = await rows(
        `SELECT hostName() AS replica, userValue FROM clusterAllReplicas('${CLUSTER}', ${database}.${VAULT_LOCAL}) ORDER BY replica, userValue`,
      );

      return REPLICAS.every((replica: string): boolean => {
        return (
          JSON.stringify(
            events
              .filter((row: JSONObject): boolean => {
                return row["replica"] === replica;
              })
              .map((row: JSONObject): string => {
                return `${String(row["eventUid"])}=${String(row["principalUser"])}`;
              }),
          ) === JSON.stringify([`alice=${aliceToken}`, `bob=${BOB}`]) &&
          JSON.stringify(
            vault
              .filter((row: JSONObject): boolean => {
                return row["replica"] === replica;
              })
              .map((row: JSONObject): unknown => {
                return row["userValue"];
              }),
          ) === JSON.stringify([BOB])
        );
      });
    });

    const alice: Array<JSONObject> = await rows(
      `SELECT hostName() AS replica, observables, attributes, attributeKeys, message FROM clusterAllReplicas('${CLUSTER}', ${database}.${EVENTS_LOCAL}) WHERE eventUid = 'alice' ORDER BY replica`,
    );

    expect(alice).toHaveLength(REPLICAS.length);

    for (const row of alice) {
      const attributes: Record<string, string> = row["attributes"] as Record<
        string,
        string
      >;

      expect(row["observables"]).toEqual(["203.0.113.7", aliceToken]);
      expect(attributes["enduser.id"]).toBe(aliceToken);
      expect(
        attributes[ERASED_USER_ATTRIBUTES[ScrubbedUserRole.Principal]],
      ).toBe(USER_ERASED_ON_REQUEST);
      expect(
        attributes[HASHED_USER_ATTRIBUTES[ScrubbedUserRole.Principal]],
      ).toBeUndefined();
      expect((row["attributeKeys"] as Array<string>).sort()).toEqual(
        Object.keys(attributes).sort(),
      );
      expect(row["message"]).toBe("Failed sign-in alice");
      expect(JSON.stringify(row)).not.toContain(ALICE);
    }

    expect(
      await SecurityUserErasureEvents.countNamedEvents({
        projectId: PROJECT_ID,
        tokens: [aliceToken],
      }),
    ).toBe(0);
    expect(
      await SecurityUserVaultService.countRowsOfTokens({
        projectId: PROJECT_ID,
        tokens: [aliceToken],
      }),
    ).toBe(0);

    // The events' severity histogram still answers, from the rewritten parts.
    const histogram: Array<JSONObject> = await rows(
      `SELECT severityName, toString(count()) AS c FROM ${database}.${new SecurityEvent().tableName} WHERE projectId = '${PROJECT_ID.toString()}' GROUP BY severityName`,
    );

    expect(histogram).toEqual([{ severityName: "Medium", c: "2" }]);
  });
});
