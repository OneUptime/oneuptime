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
 * else's stays. The Detection Findings a rule wrote about the person
 * (#11044) are read through the Distributed table and changed ON CLUSTER
 * the same way: the token in the person's place on both replicas, and
 * nothing either replica keeps of the mutation naming them.
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
import SecurityUserErasureFindings, {
  FINDING_USER_ERASED_ATTRIBUTE,
  FindingsCursor,
  FindingsScanStep,
} from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserErasureFindings";
import DetectionFingerprint, {
  DetectionFingerprintKind,
} from "Common/Server/Utils/SecurityEvent/DetectionFingerprint";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_FINDING_CLASS_UID,
  DETECTION_GROUP_VALUE_ATTRIBUTE,
  DETECTION_MATCH_COUNT_ATTRIBUTE,
  DETECTION_RULE_NAME_ATTRIBUTE,
  DETECTION_SUMMARY_ATTRIBUTE,
} from "Common/Types/SecurityEvent/DetectionFindingConstants";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  ERASED_USER_ATTRIBUTES,
  HASHED_USER_ATTRIBUTES,
  ScrubbedUserRole,
  USER_ERASED_ON_REQUEST,
} from "Common/Utils/SecurityEvent/ScrubbedUser";
import { ErasedName } from "Common/Utils/SecurityEvent/SecurityUserErasureUnnaming";
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

  /*
   * #11044: the Detection Findings a rule wrote about the person, read
   * through the Distributed table and changed by a mutation on the local
   * tables, ON CLUSTER - both replicas end up with the token where the
   * person was, and nothing ClickHouse keeps of the mutation, on either
   * replica, names them.
   */
  test("the person comes out of the Detection Findings a rule wrote about them, on both replicas, their ids too, read on from where each read stopped; somebody else's stay", async () => {
    const aliceToken: string = tokenOf(ALICE);
    const authZeroAlice: string = `auth0|${ALICE}`;

    function keyed(value: string): string {
      return DetectionFingerprint.of({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.DetectionRule,
        value,
      });
    }

    // A scheduled run's finding's id: the rule, and the group's fingerprint in both places.
    function findingUidOf(uid: string, fingerprint: string): string {
      return `detection:${uid}:detection-rule:${uid}:${fingerprint}:run:1764000000000:each:${fingerprint}`;
    }

    function findingRow(data: {
      uid: string;
      ruleName: string;
      groupValue: string;
      observables: Array<string>;
      summary?: string | undefined;
    }): JSONObject {
      const time: Date = OneUptimeDate.addRemoveMinutes(new Date(), -2);
      const attributes: Record<string, string> = {
        [DETECTION_RULE_NAME_ATTRIBUTE]: data.ruleName,
        [DETECTION_MATCH_COUNT_ATTRIBUTE]: "5",
        [DETECTION_GROUP_VALUE_ATTRIBUTE]: data.groupValue,
        ...(data.summary
          ? { [DETECTION_SUMMARY_ATTRIBUTE]: data.summary }
          : {}),
      };

      return {
        _id: ObjectID.generate().toString(),
        projectId: PROJECT_ID.toString(),
        primaryEntityId: SOURCE_ID.toString(),
        primaryEntityType: ServiceType.OpenTelemetry,
        time: OneUptimeDate.toClickhouseDateTime64(time),
        createdAt: OneUptimeDate.toClickhouseDateTime(time),
        eventUid: findingUidOf(data.uid, keyed(data.groupValue)),
        classUid: DETECTION_FINDING_CLASS_UID,
        className: DETECTION_FINDING_CLASS_NAME,
        severityId: 4,
        severityName: "High",
        statusName: "New",
        vendorName: "OneUptime",
        productName: "OneUptime Detections",
        ruleId: data.uid,
        ruleName: data.ruleName,
        message: `Detection: ${data.ruleName} — ${data.groupValue} (5 events${data.summary ? `; ${data.summary}` : ""})`,
        observables: data.observables,
        attributes,
        attributeKeys: Object.keys(attributes),
        retentionDate: OneUptimeDate.toClickhouseDateTime(
          OneUptimeDate.addRemoveDays(new Date(), 30),
        ),
      };
    }

    await (
      SecurityEventService as AnalyticsDatabaseService<SecurityEvent>
    ).insertJsonRows(
      [
        findingRow({
          uid: "finding-alice",
          ruleName: "Brute force",
          groupValue: ALICE,
          observables: [ALICE, "203.0.113.7"],
        }),
        findingRow({
          uid: "finding-new-user",
          ruleName: "First sign-in",
          groupValue: "203.0.113.7",
          observables: ["203.0.113.7", authZeroAlice, BOB],
          summary: `First principalUser in 7 days: ${authZeroAlice}, ${BOB}`,
        }),
        findingRow({
          uid: "finding-bob",
          ruleName: "Brute force",
          groupValue: BOB,
          observables: [BOB],
        }),
      ],
      {
        clickhouseSettings: {
          wait_for_async_insert: 1,
          insert_distributed_sync: 1,
        },
      },
    );

    await waitUntil("both replicas hold the findings", async () => {
      const held: Array<JSONObject> = await rows(
        `SELECT hostName() AS replica, toString(count()) AS c FROM clusterAllReplicas('${CLUSTER}', ${database}.${EVENTS_LOCAL}) WHERE className = '${DETECTION_FINDING_CLASS_NAME}' GROUP BY replica`,
      );

      return (
        held.length === REPLICAS.length &&
        held.every((row: JSONObject): boolean => {
          return Number(row["c"]) === 3;
        })
      );
    });

    const names: Array<ErasedName> = [
      { named: ALICE, hashed: aliceToken },
      { named: authZeroAlice, hashed: `auth0|${aliceToken}` },
    ];

    /*
     * Read through the Distributed table a finding at a time, each read on
     * from where the last stopped (#11160), and changed as an install sends
     * it: a mutation on the local table, ON CLUSTER.
     */
    const reads: Array<FindingsCursor | null> = [];
    let after: FindingsCursor | null = null;
    let changed: number = 0;

    for (let step: number = 0; step < 10; step++) {
      reads.push(after);

      const read: FindingsScanStep =
        await SecurityUserErasureFindings.scanFindings({
          projectId: PROJECT_ID,
          names,
          tokens: [aliceToken],
          after,
          onProgress: async (): Promise<void> => {},
          pageSize: 1,
          maxRewrites: 1,
        });

      changed += read.changed;
      after = read.after;

      if (read.isAtEnd) {
        break;
      }
    }

    expect(changed).toBe(2);
    // Each read went on from where the one before stopped.
    expect(reads.length).toBeGreaterThan(2);
    expect(
      new Set(
        reads.map((cursor: FindingsCursor | null): string => {
          return JSON.stringify(cursor);
        }),
      ).size,
    ).toBe(reads.length);

    const findingsQuery: string = `SELECT hostName() AS replica, ruleId, eventUid, message, observables, attributes, attributeKeys FROM clusterAllReplicas('${CLUSTER}', ${database}.${EVENTS_LOCAL}) WHERE className = '${DETECTION_FINDING_CLASS_NAME}' ORDER BY replica, ruleId`;

    await waitUntil("both replicas apply the findings' change", async () => {
      const findings: Array<JSONObject> = await rows(findingsQuery);

      return (
        findings.length === REPLICAS.length * 3 &&
        findings
          .filter((row: JSONObject): boolean => {
            return row["ruleId"] !== "finding-bob";
          })
          .every((row: JSONObject): boolean => {
            return (
              !JSON.stringify(row).includes(ALICE) &&
              !String(row["eventUid"]).includes(keyed(ALICE))
            );
          })
      );
    });

    // Not a fingerprint of the person, keyed or not, left on either replica.
    const fingerprintsOfNames: Array<string> = names.flatMap(
      (name: ErasedName): Array<string> => {
        return DetectionFingerprint.allOf({
          projectId: PROJECT_ID,
          kind: DetectionFingerprintKind.DetectionRule,
          value: name.named,
        });
      },
    );

    for (const row of await rows(findingsQuery)) {
      const attributes: Record<string, string> = row["attributes"] as Record<
        string,
        string
      >;

      for (const fingerprint of fingerprintsOfNames) {
        expect(JSON.stringify(row)).not.toContain(fingerprint);
      }

      if (row["ruleId"] === "finding-alice") {
        expect(row["message"]).toBe(
          `Detection: Brute force — ${aliceToken} (5 events)`,
        );
        expect(row["observables"]).toEqual([aliceToken, "203.0.113.7"]);
        expect(attributes[DETECTION_GROUP_VALUE_ATTRIBUTE]).toBe(aliceToken);
        // The id a rule firing on the token makes.
        expect(row["eventUid"]).toBe(
          findingUidOf("finding-alice", keyed(aliceToken)),
        );
      }

      if (row["ruleId"] === "finding-new-user") {
        // Grouped on the address, which named nobody: its id stays.
        expect(row["eventUid"]).toBe(
          findingUidOf("finding-new-user", keyed("203.0.113.7")),
        );
        expect(row["message"]).toBe(
          `Detection: First sign-in — 203.0.113.7 (5 events; First principalUser in 7 days: auth0|${aliceToken}, ${BOB})`,
        );
        expect(row["observables"]).toEqual([
          "203.0.113.7",
          `auth0|${aliceToken}`,
          BOB,
        ]);
        expect(attributes[DETECTION_SUMMARY_ATTRIBUTE]).toBe(
          `First principalUser in 7 days: auth0|${aliceToken}, ${BOB}`,
        );
      }

      if (row["ruleId"] === "finding-bob") {
        expect(row["message"]).toBe(
          `Detection: Brute force — ${BOB} (5 events)`,
        );
        expect(row["observables"]).toEqual([BOB]);
        expect(row["eventUid"]).toBe(findingUidOf("finding-bob", keyed(BOB)));
        expect(attributes[FINDING_USER_ERASED_ATTRIBUTE]).toBeUndefined();
        continue;
      }

      expect(attributes[FINDING_USER_ERASED_ATTRIBUTE]).toBe(
        USER_ERASED_ON_REQUEST,
      );
      expect((row["attributeKeys"] as Array<string>).sort()).toEqual(
        Object.keys(attributes).sort(),
      );
    }

    // A read from the first again finds nothing left to change, on either replica.
    expect(
      (
        await SecurityUserErasureFindings.scanFindings({
          projectId: PROJECT_ID,
          names,
          tokens: [aliceToken],
          after: null,
          onProgress: async (): Promise<void> => {},
        })
      ).changed,
    ).toBe(0);

    // What both replicas keep of the mutations: ids, tokens, lengths and keyed fingerprints of the token, never the person.
    const commands: Array<JSONObject> = await rows(
      `SELECT hostName() AS replica, command FROM clusterAllReplicas('${CLUSTER}', system.mutations) WHERE database = '${database}'`,
    );

    expect(
      new Set(
        commands.map((row: JSONObject): unknown => {
          return row["replica"];
        }),
      ).size,
    ).toBe(REPLICAS.length);
    expect(
      commands.some((row: JSONObject): boolean => {
        return String(row["command"]).includes(keyed(aliceToken));
      }),
    ).toBe(true);

    for (const row of commands) {
      const command: string = String(row["command"]);

      expect(command.toLowerCase()).not.toContain("alice");

      for (const fingerprint of fingerprintsOfNames) {
        expect(command).not.toContain(fingerprint);
      }
    }
  });
});
