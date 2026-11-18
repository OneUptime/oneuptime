import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumProductAnalyticsEvent from "Common/Models/AnalyticsModels/RumProductAnalyticsEvent";
import RumProductAnalyticsSession from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import RumProductAnalyticsUser from "Common/Models/AnalyticsModels/RumProductAnalyticsUser";
import RumSessionErasureRequest, {
  RumSessionErasureRequestType,
} from "Common/Models/DatabaseModels/RumSessionErasureRequest";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import RumProductAnalyticsEventService from "Common/Server/Services/RumProductAnalyticsEventService";
import RumProductAnalyticsSessionService from "Common/Server/Services/RumProductAnalyticsSessionService";
import RumProductAnalyticsUserService from "Common/Server/Services/RumProductAnalyticsUserService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { buildProductAnalyticsBatchFilters } from "Common/Server/Utils/RumProductAnalytics/RumProductAnalyticsErasure";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ------------------------------------------------------------------
 * Session replay erasure's product analytics deletes, ON CLUSTER, against a
 * ClickHouse cluster of one shard and two replicas coordinated by Keeper
 * (issue #6627) - the layout of a replicated install, where a legal erasure
 * depends on mutations that only a cluster runs.
 *
 * The three product analytics tables are created with production's own
 * statements (StatementGenerator, cluster mode): a Replicated local table
 * ON CLUSTER behind a Distributed one. Rows for several subjects go in
 * through the Distributed tables, and the job's own code erases one subject
 * of each request type - a list of sessions (a batch's deletes), a user's
 * key, an application, and a date range (the batch's deletes, then the
 * request's last ones) - submitting its ALTER ... ON CLUSTER DELETEs and
 * counting the rows first (#6628). Once every mutation and DDL task has
 * finished, each replica's own table is read: only the subject's rows are
 * gone, on both, and what the job counted is what went.
 *
 * Opt-in: it needs the cluster, which the docker compose file beside it
 * starts (Tests/Workers/Fixtures/ClickhouseKeeperCluster):
 *
 *   docker compose -f Tests/Workers/Fixtures/ClickhouseKeeperCluster/docker-compose.yml up -d --wait
 *   TEST_CLICKHOUSE_KEEPER_CLUSTER_URL=http://default:test@localhost:18461 \
 *     npx jest Tests/Workers/RumProductAnalyticsErasureKeeperClickhouse.test.ts
 *   docker compose -f Tests/Workers/Fixtures/ClickhouseKeeperCluster/docker-compose.yml down
 *
 * CLICKHOUSE_IMAGE=clickhouse/clickhouse-server:24.8 before the first
 * command runs it on the oldest version OneUptime supports. The suite
 * creates and drops only its own database, on both replicas.
 * ------------------------------------------------------------------
 */

/* RunCron registers a repeatable BullMQ job at import time. */
jest.mock("../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

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

/* The tombstones: written and read, never the point here. */
jest.mock("Common/Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (): unknown => {
        return {
          sadd: (): Promise<number> => {
            return Promise.resolve(1);
          },
          expire: (): Promise<number> => {
            return Promise.resolve(1);
          },
          smembers: (): Promise<Array<string>> => {
            return Promise.resolve([]);
          },
        };
      },
      isConnected: (): boolean => {
        return true;
      },
    },
  };
});

import {
  ProductAnalyticsErasureResult,
  eraseProductAnalyticsFilters,
  eraseProductAnalyticsSubject,
} from "../../FeatureSet/Workers/Jobs/Rum/ProcessSessionErasureRequests";

const endpoint: string | undefined =
  process.env["TEST_CLICKHOUSE_KEEPER_CLUSTER_URL"];

jest.setTimeout(300000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const CLUSTER: string = "oneuptime";
const REPLICAS: Array<string> = ["replica-1", "replica-2"];

const database: string = `pa_erasure_keeper_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID("6600000000000000000000f1");
// The same ids in another project, which no request names.
const otherProjectId: ObjectID = new ObjectID("6600000000000000000000f2");

const sessionsApp: ObjectID = new ObjectID("6600000000000000000000f3");
const usersApp: ObjectID = new ObjectID("6600000000000000000000f4");
const erasedApp: ObjectID = new ObjectID("6600000000000000000000f5");
const keptApp: ObjectID = new ObjectID("6600000000000000000000f6");
const datesApp: ObjectID = new ObjectID("6600000000000000000000f7");

const HOUR_MS: number = 60 * 60 * 1000;
const now: number = Math.floor(Date.now() / 1000) * 1000;

function at(hoursAgo: number): Date {
  return new Date(now - hoursAgo * HOUR_MS);
}

// The date range erased: between 30 and 20 hours ago.
const rangeStart: Date = at(30);
const rangeEnd: Date = at(20);

interface SessionFixture {
  project: ObjectID;
  application: ObjectID;
  id: string;
  start: Date;
  userKey: string;
}

interface EventFixture {
  project: ObjectID;
  application: ObjectID;
  sessionId: string;
  time: Date;
  userKey: string;
}

interface PersonFixture {
  project: ObjectID;
  application: ObjectID;
  personKey: string;
  seen: Date;
}

function id(name: string): string {
  return name.padEnd(32, "0");
}

const SESSIONS: Array<SessionFixture> = [
  // A list of sessions: s1 erased, s2 kept.
  {
    project: projectId,
    application: sessionsApp,
    id: id("51"),
    start: at(5),
    userKey: "",
  },
  {
    project: projectId,
    application: sessionsApp,
    id: id("52"),
    start: at(5),
    userKey: "",
  },
  {
    project: otherProjectId,
    application: sessionsApp,
    id: id("51"),
    start: at(5),
    userKey: "",
  },
  // A user: alice's sessions erased, bob's kept.
  {
    project: projectId,
    application: usersApp,
    id: id("u1"),
    start: at(6),
    userKey: "alice-key",
  },
  {
    project: projectId,
    application: usersApp,
    id: id("u2"),
    start: at(7),
    userKey: "alice-key",
  },
  {
    project: projectId,
    application: usersApp,
    id: id("u3"),
    start: at(6),
    userKey: "bob-key",
  },
  {
    project: otherProjectId,
    application: usersApp,
    id: id("u1"),
    start: at(6),
    userKey: "alice-key",
  },
  // An application: all of erasedApp's rows go, keptApp's stay.
  {
    project: projectId,
    application: erasedApp,
    id: id("a1"),
    start: at(8),
    userKey: "",
  },
  {
    project: projectId,
    application: erasedApp,
    id: id("a2"),
    start: at(9),
    userKey: "",
  },
  {
    project: projectId,
    application: keptApp,
    id: id("b1"),
    start: at(8),
    userKey: "",
  },
  // A date range: d1 started in it, d2 before it.
  {
    project: projectId,
    application: datesApp,
    id: id("d1"),
    start: at(25),
    userKey: "",
  },
  {
    project: projectId,
    application: datesApp,
    id: id("d2"),
    start: at(40),
    userKey: "",
  },
];

const EVENTS: Array<EventFixture> = [
  {
    project: projectId,
    application: sessionsApp,
    sessionId: id("51"),
    time: at(5),
    userKey: "",
  },
  {
    project: projectId,
    application: sessionsApp,
    sessionId: id("51"),
    time: at(4),
    userKey: "",
  },
  {
    project: projectId,
    application: sessionsApp,
    sessionId: id("52"),
    time: at(5),
    userKey: "",
  },
  {
    project: otherProjectId,
    application: sessionsApp,
    sessionId: id("51"),
    time: at(5),
    userKey: "",
  },
  {
    project: projectId,
    application: usersApp,
    sessionId: id("u1"),
    time: at(6),
    userKey: "alice-key",
  },
  {
    project: projectId,
    application: usersApp,
    sessionId: id("u2"),
    time: at(7),
    userKey: "alice-key",
  },
  // A session of alice's that was not recorded: only its events name her.
  {
    project: projectId,
    application: usersApp,
    sessionId: id("u9"),
    time: at(3),
    userKey: "alice-key",
  },
  {
    project: projectId,
    application: usersApp,
    sessionId: id("u3"),
    time: at(6),
    userKey: "bob-key",
  },
  {
    project: projectId,
    application: erasedApp,
    sessionId: id("a1"),
    time: at(8),
    userKey: "",
  },
  {
    project: projectId,
    application: erasedApp,
    sessionId: id("a2"),
    time: at(9),
    userKey: "",
  },
  {
    project: projectId,
    application: keptApp,
    sessionId: id("b1"),
    time: at(8),
    userKey: "",
  },
  // d1's events: one in the range, one after it.
  {
    project: projectId,
    application: datesApp,
    sessionId: id("d1"),
    time: at(25),
    userKey: "",
  },
  {
    project: projectId,
    application: datesApp,
    sessionId: id("d1"),
    time: at(10),
    userKey: "",
  },
  {
    project: projectId,
    application: datesApp,
    sessionId: id("d2"),
    time: at(40),
    userKey: "",
  },
];

const PEOPLE: Array<PersonFixture> = [
  {
    project: projectId,
    application: sessionsApp,
    personKey: "v:visitor-51",
    seen: at(5),
  },
  {
    project: projectId,
    application: sessionsApp,
    personKey: "v:visitor-52",
    seen: at(5),
  },
  {
    project: projectId,
    application: usersApp,
    personKey: "u:alice-key",
    seen: at(6),
  },
  {
    project: projectId,
    application: usersApp,
    personKey: "u:bob-key",
    seen: at(6),
  },
  {
    project: otherProjectId,
    application: usersApp,
    personKey: "u:alice-key",
    seen: at(6),
  },
  {
    project: projectId,
    application: erasedApp,
    personKey: "v:visitor-a1",
    seen: at(8),
  },
  {
    project: projectId,
    application: erasedApp,
    personKey: "v:visitor-a2",
    seen: at(9),
  },
  {
    project: projectId,
    application: keptApp,
    personKey: "v:visitor-b1",
    seen: at(8),
  },
  {
    project: projectId,
    application: datesApp,
    personKey: "v:visitor-d1",
    seen: at(25),
  },
  {
    project: projectId,
    application: datesApp,
    personKey: "v:visitor-d2",
    seen: at(40),
  },
];

function request(data: {
  requestType: RumSessionErasureRequestType;
  targetValue?: string;
  rumApplicationId?: ObjectID;
  startDate?: Date;
  endDate?: Date;
}): RumSessionErasureRequest {
  const erasure: RumSessionErasureRequest = new RumSessionErasureRequest();
  erasure.projectId = projectId;
  erasure.requestType = data.requestType;
  erasure.attempts = 0;

  if (data.targetValue) {
    erasure.targetValue = data.targetValue;
  }

  if (data.rumApplicationId) {
    erasure.rumApplicationId = data.rumApplicationId;
  }

  if (data.startDate) {
    erasure.startDate = data.startDate;
  }

  if (data.endDate) {
    erasure.endDate = data.endDate;
  }

  return erasure;
}

integration(
  "Product analytics erasure ON CLUSTER, one shard of two replicas with Keeper",
  () => {
    let clickhouse: ClickhouseDatabase;
    let client: ClickhouseClient;
    const savedEnvironment: Record<string, string | undefined> = {};
    const originals: Array<Record<string, unknown>> = [];

    const services: Array<{
      database: unknown;
      databaseClient: unknown;
      migrationDatabase: unknown;
      migrationDatabaseClient: unknown;
    }> = [
      RumProductAnalyticsSessionService,
      RumProductAnalyticsUserService,
      RumProductAnalyticsEventService,
    ] as never;

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

    /* Every replica's own rows of a local table, as "replica|key" lines. */
    async function onEachReplica(
      table: string,
      key: string,
    ): Promise<Map<string, Array<string>>> {
      const found: Array<JSONObject> = await rows(
        `SELECT hostName() AS replica, ${key} AS paKey FROM clusterAllReplicas('${CLUSTER}', ${database}.${table}Local) GROUP BY replica, paKey ORDER BY replica, paKey`,
      );

      const byReplica: Map<string, Array<string>> = new Map<
        string,
        Array<string>
      >(
        REPLICAS.map((replica: string): [string, Array<string>] => {
          return [replica, []];
        }),
      );

      for (const row of found) {
        byReplica.get(String(row["replica"]))?.push(String(row["paKey"]));
      }

      return byReplica;
    }

    /* What one table holds on each replica: the same on both, returned once. */
    async function heldOnBothReplicas(
      table: string,
      key: string,
    ): Promise<Array<string>> {
      const byReplica: Map<string, Array<string>> = await onEachReplica(
        table,
        key,
      );

      expect(byReplica.get("replica-2")).toEqual(byReplica.get("replica-1"));

      return byReplica.get("replica-1") || [];
    }

    const SESSION_KEY: string =
      "concat(projectId, '/', rumApplicationId, '/', sessionId)";
    const EVENT_KEY: string =
      "concat(projectId, '/', rumApplicationId, '/', sessionId, '@', toString(toUnixTimestamp(time)))";
    const PERSON_KEY: string =
      "concat(projectId, '/', rumApplicationId, '/', personKey)";

    function sessionKeys(sessions: Array<SessionFixture>): Array<string> {
      return sessions
        .map((row: SessionFixture): string => {
          return `${row.project.toString()}/${row.application.toString()}/${row.id}`;
        })
        .sort();
    }

    function eventKeys(events: Array<EventFixture>): Array<string> {
      return events
        .map((row: EventFixture): string => {
          return `${row.project.toString()}/${row.application.toString()}/${row.sessionId}@${Math.floor(row.time.getTime() / 1000)}`;
        })
        .sort();
    }

    function personKeys(people: Array<PersonFixture>): Array<string> {
      return people
        .map((row: PersonFixture): string => {
          return `${row.project.toString()}/${row.application.toString()}/${row.personKey}`;
        })
        .sort();
    }

    /* What is left: every row a request has not erased yet. */
    let sessions: Array<SessionFixture> = [...SESSIONS];
    let events: Array<EventFixture> = [...EVENTS];
    let people: Array<PersonFixture> = [...PEOPLE];

    /*
     * Once every mutation on every replica and every DDL task the deletes
     * queued have finished: each replica holds exactly what is left.
     */
    async function expectEachReplicaToHoldWhatIsLeft(): Promise<void> {
      await waitUntil("the deletes have landed on both replicas", async () => {
        const pending: Array<JSONObject> = await rows(
          `SELECT toString((SELECT count() FROM clusterAllReplicas('${CLUSTER}', system.mutations) WHERE database = '${database}' AND NOT is_done)) AS mutations, toString((SELECT count() FROM system.distributed_ddl_queue WHERE cluster = '${CLUSTER}' AND status != 'Finished' AND query LIKE '%${database}%')) AS tasks`,
        );

        return (
          pending[0]?.["mutations"] === "0" && pending[0]?.["tasks"] === "0"
        );
      });

      expect(
        await heldOnBothReplicas("RumProductAnalyticsSessionV1", SESSION_KEY),
      ).toEqual(sessionKeys(sessions));
      expect(
        await heldOnBothReplicas("RumProductAnalyticsEventV1", EVENT_KEY),
      ).toEqual(eventKeys(events));
      expect(
        await heldOnBothReplicas("RumProductAnalyticsUserV1", PERSON_KEY),
      ).toEqual(personKeys(people));
    }

    async function createTable(modelType: {
      new (): AnalyticsBaseModel;
    }): Promise<void> {
      const generator: StatementGenerator<AnalyticsBaseModel> =
        new StatementGenerator<AnalyticsBaseModel>({
          modelType: modelType,
          database: clickhouse,
        });

      for (const statement of [
        generator.toTableCreateStatement(),
        generator.toDistributedTableCreateStatement(),
      ]) {
        await client.command({
          query: statement.query,
          query_params: statement.query_params,
        });
      }
    }

    async function insert(table: string, values: Array<string>): Promise<void> {
      await client.command({
        query: `INSERT INTO ${database}.${table} SETTINGS insert_distributed_sync = 1 VALUES ${values.join(", ")}`,
      });
    }

    beforeAll(async (): Promise<void> => {
      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "TEST_CLICKHOUSE_KEEPER_CLUSTER_URL must point at a local, disposable ClickHouse cluster.",
        );
      }

      // The cluster and database the job's statements name.
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

      for (const service of services) {
        originals.push({
          database: service.database,
          databaseClient: service.databaseClient,
          migrationDatabase: service.migrationDatabase,
          migrationDatabaseClient: service.migrationDatabaseClient,
        });

        service.database = clickhouse;
        service.databaseClient = client;
        service.migrationDatabase = clickhouse;
        service.migrationDatabaseClient = client;
      }

      for (const modelType of [
        RumProductAnalyticsSession,
        RumProductAnalyticsUser,
        RumProductAnalyticsEvent,
      ]) {
        await createTable(
          modelType as unknown as { new (): AnalyticsBaseModel },
        );
      }

      await insert(
        "RumProductAnalyticsSessionV1 (projectId, rumApplicationId, startTime, sessionId, identifiedUserKey, visitorId, isFinalized)",
        SESSIONS.map((row: SessionFixture): string => {
          return `('${row.project.toString()}', '${row.application.toString()}', '${OneUptimeDate.toClickhouseDateTime64(row.start)}', '${row.id}', '${row.userKey}', 'visitor-${row.id.substring(0, 2)}', 1)`;
        }),
      );

      await insert(
        "RumProductAnalyticsEventV1 (projectId, rumApplicationId, kind, name, time, sessionId, identifiedUserKey)",
        EVENTS.map((row: EventFixture): string => {
          return `('${row.project.toString()}', '${row.application.toString()}', 'page', '/', '${OneUptimeDate.toClickhouseDateTime64(row.time)}', '${row.sessionId}', '${row.userKey}')`;
        }),
      );

      await insert(
        "RumProductAnalyticsUserV1 (projectId, rumApplicationId, personKey, month, firstSeen, lastSeen)",
        PEOPLE.map((row: PersonFixture): string => {
          const seen: string = OneUptimeDate.toClickhouseDateTime64(row.seen);
          return `('${row.project.toString()}', '${row.application.toString()}', '${row.personKey}', toStartOfMonth(toDateTime64('${seen}', 9)), '${seen}', '${seen}')`;
        }),
      );

      // Written through one replica; the other fetches the parts.
      await waitUntil("both replicas hold every row", async () => {
        for (const [table, expected] of [
          ["RumProductAnalyticsSessionV1", SESSIONS.length],
          ["RumProductAnalyticsEventV1", EVENTS.length],
          ["RumProductAnalyticsUserV1", PEOPLE.length],
        ] as Array<[string, number]>) {
          const found: Array<JSONObject> = await rows(
            `SELECT hostName() AS replica, toString(count()) AS c FROM clusterAllReplicas('${CLUSTER}', ${database}.${table}Local) GROUP BY replica`,
          );

          if (
            found.length !== REPLICAS.length ||
            found.some((row: JSONObject): boolean => {
              return Number(row["c"]) !== expected;
            })
          ) {
            return false;
          }
        }

        return true;
      });
    });

    afterAll(async (): Promise<void> => {
      originals.forEach((original: Record<string, unknown>, index: number) => {
        Object.assign(services[index]!, original);
      });

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

    test("the tables are production's: Replicated local tables behind Distributed ones, on both replicas", async () => {
      const engines: Array<JSONObject> = await rows(
        `SELECT hostName() AS replica, name, engine FROM clusterAllReplicas('${CLUSTER}', system.tables) WHERE database = '${database}' ORDER BY replica, name`,
      );

      for (const replica of REPLICAS) {
        expect(
          engines
            .filter((row: JSONObject): boolean => {
              return row["replica"] === replica;
            })
            .map((row: JSONObject): string => {
              return `${row["name"]}: ${row["engine"]}`;
            }),
        ).toEqual([
          "RumProductAnalyticsEventV1: Distributed",
          "RumProductAnalyticsEventV1Local: ReplicatedMergeTree",
          "RumProductAnalyticsSessionV1: Distributed",
          "RumProductAnalyticsSessionV1Local: ReplicatedAggregatingMergeTree",
          "RumProductAnalyticsUserV1: Distributed",
          "RumProductAnalyticsUserV1Local: ReplicatedAggregatingMergeTree",
        ]);
      }

      await expectEachReplicaToHoldWhatIsLeft();
    });

    test("a list of sessions: a batch's deletes take their summaries and events, on both replicas", async () => {
      const counted: number = await eraseProductAnalyticsFilters({
        databaseName: database,
        countFilters: buildProductAnalyticsBatchFilters({
          projectId: projectId,
          requestType: RumSessionErasureRequestType.BySessionId,
          sessionIds: [id("51")],
        }),
        deleteFilters: buildProductAnalyticsBatchFilters({
          projectId: projectId,
          requestType: RumSessionErasureRequestType.BySessionId,
          sessionIds: [id("51")],
        }),
      });

      // Its summary, and its two events.
      expect(counted).toBe(3);

      sessions = sessions.filter((row: SessionFixture): boolean => {
        return !(row.project === projectId && row.id === id("51"));
      });
      events = events.filter((row: EventFixture): boolean => {
        return !(row.project === projectId && row.sessionId === id("51"));
      });

      await expectEachReplicaToHoldWhatIsLeft();
    });

    test("a user: their sessions, their events and their months go, on both replicas", async () => {
      const result: ProductAnalyticsErasureResult =
        await eraseProductAnalyticsSubject({
          databaseName: database,
          request: request({
            requestType: RumSessionErasureRequestType.ByIdentifiedUserKey,
            targetValue: "alice-key",
            rumApplicationId: usersApp,
          }),
        });

      // u1, u2 and the unrecorded u9, found in the summaries and the events.
      expect(result.userSessionsFound).toBe(3);
      expect(result.moreMayRemain).toBe(false);
      // Two summaries, three events, one month.
      expect(result.rowsDeleted).toBe(6);

      sessions = sessions.filter((row: SessionFixture): boolean => {
        return !(row.project === projectId && row.userKey === "alice-key");
      });
      events = events.filter((row: EventFixture): boolean => {
        return !(row.project === projectId && row.userKey === "alice-key");
      });
      people = people.filter((row: PersonFixture): boolean => {
        return !(row.project === projectId && row.personKey === "u:alice-key");
      });

      await expectEachReplicaToHoldWhatIsLeft();
    });

    test("an application: every row of it goes from the three tables, on both replicas", async () => {
      const result: ProductAnalyticsErasureResult =
        await eraseProductAnalyticsSubject({
          databaseName: database,
          request: request({
            requestType: RumSessionErasureRequestType.ByRumApplication,
            targetValue: erasedApp.toString(),
          }),
        });

      expect(result.deletesSubmitted).toBe(3);
      // Two summaries, two months, two events.
      expect(result.rowsDeleted).toBe(6);

      sessions = sessions.filter((row: SessionFixture): boolean => {
        return row.application !== erasedApp;
      });
      events = events.filter((row: EventFixture): boolean => {
        return row.application !== erasedApp;
      });
      people = people.filter((row: PersonFixture): boolean => {
        return row.application !== erasedApp;
      });

      await expectEachReplicaToHoldWhatIsLeft();
    });

    test("a date range: the sessions started in it and all their events go, the months stay, on both replicas", async () => {
      // The batch: d1's events outside the range, by id.
      const batch: number = await eraseProductAnalyticsFilters({
        databaseName: database,
        countFilters: buildProductAnalyticsBatchFilters({
          projectId: projectId,
          requestType: RumSessionErasureRequestType.ByDateRange,
          sessionIds: [id("d1")],
          startDate: rangeStart,
          endDate: rangeEnd,
        }),
        deleteFilters: buildProductAnalyticsBatchFilters({
          projectId: projectId,
          requestType: RumSessionErasureRequestType.ByDateRange,
          sessionIds: [id("d1")],
          startDate: rangeStart,
          endDate: rangeEnd,
        }),
      });

      // The request's last deletes: what started, or happened, in the range.
      const result: ProductAnalyticsErasureResult =
        await eraseProductAnalyticsSubject({
          databaseName: database,
          request: request({
            requestType: RumSessionErasureRequestType.ByDateRange,
            rumApplicationId: datesApp,
            startDate: rangeStart,
            endDate: rangeEnd,
          }),
        });

      expect(batch).toBe(1);
      expect(result.rowsDeleted).toBe(2);

      sessions = sessions.filter((row: SessionFixture): boolean => {
        return row.id !== id("d1");
      });
      events = events.filter((row: EventFixture): boolean => {
        return row.sessionId !== id("d1");
      });

      await expectEachReplicaToHoldWhatIsLeft();
    });
  },
);

describe("Product analytics erasure Keeper suite wiring", () => {
  const fixture: (name: string) => string = (name: string): string => {
    return fs.readFileSync(
      path.resolve(__dirname, "Fixtures", "ClickhouseKeeperCluster", name),
      "utf8",
    );
  };

  test("the compose file starts the two replicas the suite reads, on the port it says", () => {
    const compose: string = fixture("docker-compose.yml");

    expect(compose).toContain('"127.0.0.1:18461:8123"');
    expect(compose).toContain("hostname: replica-1");
    expect(compose).toContain("hostname: replica-2");
    expect(compose).toContain(
      "./replica-1.xml:/etc/clickhouse-server/config.d/keeper-cluster.xml:ro",
    );
    expect(compose).toContain(
      "./replica-2.xml:/etc/clickhouse-server/config.d/keeper-cluster.xml:ro",
    );
  });

  test("both replicas define the cluster the job's statements name: one shard of both, over one Keeper", () => {
    for (const [file, replica] of [
      ["replica-1.xml", "replica-1"],
      ["replica-2.xml", "replica-2"],
    ]) {
      const config: string = fixture(file!);

      expect(config).toContain(`<replica>${replica}</replica>`);
      expect(config).toContain("<shard>01</shard>");
      expect(config).toContain(`<${CLUSTER}>`);
      expect(config).toContain(
        "<internal_replication>true</internal_replication>",
      );
      expect(config).toContain("<host>replica-1</host>");
      expect(config).toContain("<host>replica-2</host>");
      expect(config).toContain("<port>9181</port>");
    }

    expect(fixture("replica-1.xml")).toContain("<keeper_server>");
    expect(fixture("replica-2.xml")).not.toContain("<keeper_server>");
  });
});
