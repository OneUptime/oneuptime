import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * Erasing one person from Security Events' user vault (#10908), against
 * a real ClickHouse server: every statement the erasure sends, run on the
 * vault's and the events' tables made from their models.
 *
 *   - the vault: a person's rows are found by their tokens at any age,
 *     counted and deleted - only theirs, only in their project;
 *   - the events the vault named them in get the token back: the user,
 *     the observables, the request's user, the marker that says a scrub
 *     rule hid them, and the erased attribute, with attributeKeys kept in
 *     step - for who acted and for who was acted on, a token inside a
 *     larger user too ("auth0|[HASHED:...]"). An event that named the
 *     person in clear, another person's, and another project's stay;
 *   - running it again changes nothing, and a person the vault never knew
 *     is erased all the same, with nothing to count;
 *   - nothing the erasure sends to ClickHouse holds the person: only
 *     tokens and the project, as ClickHouse keeps both a mutation's
 *     command and a query's parameters;
 *   - once erased, the person is never named again, even by a later event
 *     carrying the same token: ingest refuses to keep the token again, and
 *     the scans' lookup refuses to name it even if a row for it is there;
 *   - the worker, end to end on the real tables: Pending until every
 *     process refuses the tokens, then InProgress with what it counted,
 *     then Completed once ClickHouse has applied the mutations.
 *
 * ClickHouse's ON CLUSTER statements need a Keeper and a cluster a
 * disposable server does not have: here the cluster helpers name the
 * model's own table and add no ON CLUSTER (a cluster of one), and the
 * opt-in Keeper suite (SecurityUserVaultTableKeeperClickhouse) runs the
 * vault's delete ON CLUSTER on two replicas. Postgres (the requests, and
 * what the erasure changes there) is stood in for here; the Postgres half
 * is SecurityUserErasurePostgres.test.ts.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18908:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18908 \
 *     npx jest Tests/Workers/SecurityUserErasureClickhouse.test.ts
 *
 * The suite creates and drops only its own uniquely named database. The
 * App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
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

// A cluster of one: the model's own table, and no ON CLUSTER.
jest.mock("Common/Server/Utils/AnalyticsDatabase/ClusterConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/AnalyticsDatabase/ClusterConfig",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    onClusterClause: (): string => {
      return "";
    },
    getStorageTableName: (tableName: string): string => {
      return tableName;
    },
  };
});

import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import SecurityUserVault from "Common/Models/AnalyticsModels/SecurityUserVault";
import SecurityUserErasureRequest from "Common/Models/DatabaseModels/SecurityUserErasureRequest";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import ProjectService from "Common/Server/Services/ProjectService";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import SecurityUserErasureRequestService, {
  SecurityUserErasureCounts,
  getErasureTokens,
} from "Common/Server/Services/SecurityUserErasureRequestService";
import SecurityUserVaultService, {
  SecurityUserVaultService as SecurityUserVaultServiceClass,
} from "Common/Server/Services/SecurityUserVaultService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import SecurityEventsReadTelemetry from "Common/Server/Utils/SecurityEvent/SecurityEventsReadTelemetry";
import SecurityUserErasedTokens from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserErasedTokens";
import SecurityUserErasure, {
  SUPPRESSION_SETTLE_MS,
} from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserErasure";
import SecurityUserErasureEvents, {
  SecurityUserErasurePair,
} from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserErasureEvents";
import SecurityUserErasureRecords from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserErasureRecords";
import SecurityUserVaultLookup from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserVaultLookup";
import SecurityUserVaultWriter, {
  SecurityUserVaultBatch,
} from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserVaultWriter";
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import ScrubHashToken from "Common/Server/Utils/Telemetry/ScrubHashToken";
import TelemetryFanInWriter, {
  FanInInsertTarget,
  FanInSubmitResult,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ObjectID from "Common/Types/ObjectID";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import { SecurityUserErasureRequestStatus } from "Common/Types/SecurityEvent/SecurityUserErasure";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  ERASED_USER_ATTRIBUTES,
  HASHED_USER_ATTRIBUTES,
  SCRUBBED_USER_ATTRIBUTES,
  ScrubbedUserRole,
  USER_ERASED_ON_REQUEST,
  USER_HIDDEN_BY_SCRUB_RULE,
} from "Common/Utils/SecurityEvent/ScrubbedUser";
import { ErasedName } from "Common/Utils/SecurityEvent/SecurityUserErasureUnnaming";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `user_erasure_test_${process.pid}_${Date.now()}`;

const PROJECT_ID: ObjectID = new ObjectID(
  "10908000-0000-4000-8000-0000000000a1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10908000-0000-4000-8000-0000000000a2",
);
const SOURCE_ID: ObjectID = new ObjectID(
  "10908000-0000-4000-8000-0000000000a3",
);

// The person erased, as a request types them, and as the logs hold them.
const ALICE_TYPED: string = "Alice@Example.com";
const ALICE: string = "alice@example.com";
const ALICE_IN_AUTH0: string = `auth0|${ALICE}`;
// Somebody else, who stays named.
const BOB: string = "bob@example.com";

function tokenOf(value: string, projectId: ObjectID = PROJECT_ID): string {
  return ScrubHashToken.ofValue({ projectId, value });
}

const ALICE_TOKEN: string = tokenOf(ALICE);
const ALICE_TYPED_TOKEN: string = tokenOf(ALICE_TYPED);
const BOB_TOKEN: string = tokenOf(BOB);

type ServiceConnection = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
  migrationDatabase: ClickhouseDatabase;
  migrationDatabaseClient: ClickhouseClient | null;
  statementGenerator: unknown;
};

interface EventSeed {
  projectId?: ObjectID | undefined;
  uid: string;
  principalUser?: string | undefined;
  targetUser?: string | undefined;
  observables?: Array<string> | undefined;
  attributes?: Record<string, string> | undefined;
  message?: string | undefined;
}

function eventRow(seed: EventSeed): JSONObject {
  const time: Date = OneUptimeDate.addRemoveMinutes(new Date(), -10);
  const attributes: Record<string, string> = {
    "oneuptime.log.id": `log-${seed.uid}`,
    ...(seed.attributes || {}),
  };

  return {
    _id: ObjectID.generate().toString(),
    projectId: (seed.projectId || PROJECT_ID).toString(),
    primaryEntityId: SOURCE_ID.toString(),
    primaryEntityType: ServiceType.OpenTelemetry,
    time: OneUptimeDate.toClickhouseDateTime64(time),
    createdAt: OneUptimeDate.toClickhouseDateTime(time),
    eventUid: seed.uid,
    classUid: 3002,
    className: "Authentication",
    statusName: "Failure",
    severityId: 3,
    severityName: "Medium",
    message: seed.message || `Failed sign-in ${seed.uid}`,
    principalUser: seed.principalUser || "",
    targetUser: seed.targetUser || "",
    principalIp: "203.0.113.7",
    observables: seed.observables || [],
    attributes: attributes,
    attributeKeys: Object.keys(attributes),
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(new Date(), 30),
    ),
  };
}

// An event whose user of a role the vault named, as a scan stores it (ScrubbedUser.nameHashedEventUser).
function namedEvent(data: {
  uid: string;
  role: ScrubbedUserRole;
  named: string;
  hashed: string;
  projectId?: ObjectID | undefined;
}): EventSeed {
  const attributes: Record<string, string> = {
    [HASHED_USER_ATTRIBUTES[data.role]]: data.hashed,
  };

  if (data.role === ScrubbedUserRole.Principal) {
    attributes["enduser.id"] = data.named;
  }

  return {
    projectId: data.projectId,
    uid: data.uid,
    ...(data.role === ScrubbedUserRole.Principal
      ? { principalUser: data.named }
      : { targetUser: data.named }),
    observables: [data.named, "203.0.113.7"],
    attributes,
  };
}

integration("erasing a person from the user vault, against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  const originals: Map<
    ServiceConnection,
    Partial<ServiceConnection>
  > = new Map();
  // The tokens each project's filed requests erase: what Postgres would answer.
  let filedTokens: Map<string, Set<string>>;
  let counted: Array<string>;

  const vaultTable: string = `${database}.${new SecurityUserVault().tableName}`;
  const eventsTable: string = `${database}.${new SecurityEvent().tableName}`;

  async function rowsOf(query: string): Promise<Array<JSONObject>> {
    const result: { json: () => Promise<unknown> } = await client.query({
      query,
      format: "JSONEachRow",
    });

    return (await result.json()) as Array<JSONObject>;
  }

  /*
   * A model's table on one node: its columns with their skip indexes and
   * projections (the events' severity histogram among them), keys,
   * partition, TTL and settings.
   */
  async function createTable(data: {
    modelType: { new (): AnalyticsBaseModel };
    engine: string;
  }): Promise<void> {
    const model: AnalyticsBaseModel = new data.modelType();
    const columns: Statement = new StatementGenerator<AnalyticsBaseModel>({
      modelType: data.modelType,
      database: clickhouse,
    }).toColumnsCreateStatement(model.tableColumns);
    const ttl: string = model.ttlExpression
      ? ` TTL ${model.ttlExpression}`
      : "";
    const settings: string = model.tableSettings
      ? ` SETTINGS ${model.tableSettings}`
      : "";

    await client.command({
      query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${data.engine} PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})${ttl}${settings}`,
      query_params: columns.query_params,
    });
  }

  function useTestDatabase(service: ServiceConnection): void {
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
  }

  // Waits for every mutation of the suite's tables to be applied.
  async function mutationsApplied(): Promise<void> {
    const deadline: number = Date.now() + 120000;

    while (Date.now() < deadline) {
      const open: Array<JSONObject> = await rowsOf(
        `SELECT toString(count()) AS open FROM system.mutations WHERE database = '${database}' AND is_done = 0`,
      );

      if (Number(open[0]?.["open"] || 0) === 0) {
        return;
      }

      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 250);
      });
    }

    throw new Error("The erasure's mutations were not applied in time.");
  }

  async function writeVault(
    projectId: ObjectID,
    entries: Array<{ token: string; user: string }>,
    seenAt: Date = new Date(),
  ): Promise<void> {
    await SecurityUserVaultService.insertJsonRows(
      SecurityUserVaultServiceClass.toRows({ projectId, entries, seenAt }),
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );
  }

  async function vaultUsersOf(projectId: ObjectID): Promise<Array<string>> {
    return (
      await rowsOf(
        `SELECT DISTINCT userValue FROM ${vaultTable} WHERE projectId = '${projectId.toString()}' ORDER BY userValue`,
      )
    ).map((row: JSONObject): string => {
      return String(row["userValue"]);
    });
  }

  async function writeEvents(seeds: Array<EventSeed>): Promise<void> {
    await client.insert({
      table: eventsTable,
      values: seeds.map(eventRow),
      format: "JSONEachRow",
      clickhouse_settings: { wait_for_async_insert: 1 },
    });
  }

  async function eventOf(uid: string): Promise<JSONObject> {
    const rows: Array<JSONObject> = await rowsOf(
      `SELECT principalUser, targetUser, observables, attributes, attributeKeys, message FROM ${eventsTable} WHERE eventUid = '${uid}'`,
    );

    expect(rows).toHaveLength(1);

    return rows[0]!;
  }

  function file(projectId: ObjectID, tokens: Array<string>): void {
    const tokensOfProject: Set<string> =
      filedTokens.get(projectId.toString()) || new Set<string>();

    for (const token of tokens) {
      tokensOfProject.add(token);
    }

    filedTokens.set(projectId.toString(), tokensOfProject);
    SecurityUserErasedTokens.clearCache();
  }

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await client.command({
      query: `CREATE DATABASE IF NOT EXISTS ${database}`,
    });

    // Each exactly as its model says: engine, keys, partition, TTL, settings, projections.
    await createTable({
      modelType: SecurityUserVault,
      engine: "AggregatingMergeTree",
    });
    await createTable({ modelType: SecurityEvent, engine: "MergeTree" });

    for (const service of [SecurityUserVaultService, SecurityEventService]) {
      useTestDatabase(service as unknown as ServiceConnection);
    }
  });

  afterAll(async (): Promise<void> => {
    for (const [service, original] of originals.entries()) {
      Object.assign(service, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  beforeEach(async (): Promise<void> => {
    filedTokens = new Map<string, Set<string>>();
    counted = [];
    SecurityUserErasedTokens.clearCache();
    SecurityUserVaultWriter.forgetWrites();
    SecurityEventsReadTelemetry.clearCache();

    for (const table of [vaultTable, eventsTable]) {
      await client.command({ query: `TRUNCATE TABLE ${table}` });
    }

    // What Postgres holds of the project's erasure requests: the tokens they erase.
    jest
      .spyOn(SecurityUserErasureRequestService, "getErasedTokensOfProject")
      .mockImplementation(async (projectId: ObjectID): Promise<Set<string>> => {
        return new Set<string>(filedTokens.get(projectId.toString()) || []);
      });

    jest
      .spyOn(SecurityEventsReadTelemetry, "readsProjectTelemetry")
      .mockResolvedValue(true);

    // Every row ingest's writer hands the fan-in writer goes into ClickHouse.
    jest
      .spyOn(TelemetryFanInWriter, "submit")
      .mockImplementation(
        async (
          target: FanInInsertTarget,
          rows: Array<JSONObject>,
        ): Promise<FanInSubmitResult> => {
          return {
            flushed: target.insertJsonRows(rows, {
              clickhouseSettings: { wait_for_async_insert: 1 },
            }),
          };
        },
      );

    jest.spyOn(AppMetrics, "getUserVaultWriteCounter").mockReturnValue({
      add: (count: number, attributes?: JSONObject): void => {
        counted.push(
          `${String(attributes?.[AppMetrics.USER_VAULT_OUTCOME_ATTRIBUTE])}:${count}`,
        );
      },
    } as never);
  });

  afterEach(async (): Promise<void> => {
    await SecurityUserVaultWriter.whenIdle();
    jest.restoreAllMocks();
  });

  describe("what the erasure sends to ClickHouse", () => {
    test("names the project and the tokens, never the person", () => {
      const tokens: Array<string> = getErasureTokens({
        projectId: PROJECT_ID,
        user: ALICE_TYPED,
      });
      const statements: Array<Statement> = [
        SecurityUserVaultService.toFindEntriesOfTokensStatement({
          projectId: PROJECT_ID,
          tokens,
        }),
        SecurityUserVaultService.toCountRowsOfTokensStatement({
          projectId: PROJECT_ID,
          tokens,
        }),
        SecurityUserVaultService.toEraseTokensStatement({
          projectId: PROJECT_ID,
          tokens,
        }),
        SecurityUserErasureEvents.toCountEventsStatement({
          projectId: PROJECT_ID,
          tokens,
        }),
        ...[ScrubbedUserRole.Principal, ScrubbedUserRole.Target].flatMap(
          (role: ScrubbedUserRole): Array<Statement> => {
            return [
              SecurityUserErasureEvents.toNamedPairsStatement({
                projectId: PROJECT_ID,
                role,
                tokens,
              }),
              SecurityUserErasureEvents.toUnnameEventsStatement({
                projectId: PROJECT_ID,
                role,
                tokens,
              }),
            ];
          },
        ),
      ];

      expect(tokens.sort()).toEqual([ALICE_TOKEN, ALICE_TYPED_TOKEN].sort());

      for (const statement of statements) {
        const sent: string =
          `${statement.query} ${JSON.stringify(statement.query_params)}`.toLowerCase();

        expect(sent).not.toContain("alice");
        expect(sent).not.toContain("example.com");
        expect(sent).toContain(PROJECT_ID.toString());
      }
    });
  });

  describe("the vault", () => {
    test("finds, counts and deletes a person's rows by their tokens - only theirs, only in their project", async () => {
      const old: Date = OneUptimeDate.addRemoveDays(new Date(), -29);

      await writeVault(PROJECT_ID, [
        { token: ALICE_TOKEN, user: ALICE },
        { token: ALICE_TYPED_TOKEN, user: ALICE_TYPED },
        { token: BOB_TOKEN, user: BOB },
      ]);
      // Seen 29 days ago: still the person, whatever its age.
      await writeVault(PROJECT_ID, [{ token: ALICE_TOKEN, user: ALICE }], old);
      await writeVault(OTHER_PROJECT_ID, [
        { token: tokenOf(ALICE, OTHER_PROJECT_ID), user: ALICE },
        // Another project's row under this project's token: never touched.
        { token: ALICE_TOKEN, user: ALICE },
      ]);

      const tokens: Array<string> = [ALICE_TOKEN, ALICE_TYPED_TOKEN];

      expect(
        (
          await SecurityUserVaultService.findEntriesOfTokens({
            projectId: PROJECT_ID,
            tokens,
          })
        )
          .map((entry: { token: string; user: string }): string => {
            return entry.user;
          })
          .sort(),
      ).toEqual([ALICE, ALICE_TYPED].sort());
      expect(
        await SecurityUserVaultService.countRowsOfTokens({
          projectId: PROJECT_ID,
          tokens,
        }),
      ).toBeGreaterThanOrEqual(2);

      await SecurityUserVaultService.eraseTokens({
        projectId: PROJECT_ID,
        tokens,
      });
      await mutationsApplied();

      expect(await vaultUsersOf(PROJECT_ID)).toEqual([BOB]);
      expect(await vaultUsersOf(OTHER_PROJECT_ID)).toEqual([ALICE]);
      expect(
        (
          await rowsOf(
            `SELECT toString(count()) AS c FROM ${vaultTable} WHERE projectId = '${OTHER_PROJECT_ID.toString()}'`,
          )
        )[0]!["c"],
      ).toBe("2");
      expect(
        await SecurityUserVaultService.countRowsOfTokens({
          projectId: PROJECT_ID,
          tokens,
        }),
      ).toBe(0);
    });

    test("deleting again deletes nothing more, and an unknown token deletes nothing", async () => {
      await writeVault(PROJECT_ID, [{ token: BOB_TOKEN, user: BOB }]);

      for (let run: number = 0; run < 2; run++) {
        await SecurityUserVaultService.eraseTokens({
          projectId: PROJECT_ID,
          tokens: [ALICE_TOKEN],
        });
        await mutationsApplied();
      }

      expect(await vaultUsersOf(PROJECT_ID)).toEqual([BOB]);
    });

    test("a value that is no token of today's form is never sent", async () => {
      await writeVault(PROJECT_ID, [{ token: BOB_TOKEN, user: BOB }]);

      expect(
        await SecurityUserVaultService.countRowsOfTokens({
          projectId: PROJECT_ID,
          tokens: ["bob@example.com", "[HASHED:8c87b489]", "' OR 1=1 --"],
        }),
      ).toBe(0);

      await SecurityUserVaultService.eraseTokens({
        projectId: PROJECT_ID,
        tokens: ["bob@example.com", "' OR 1=1 --"],
      });

      expect(
        await rowsOf(
          `SELECT toString(count()) AS c FROM system.mutations WHERE database = '${database}'`,
        ),
      ).toEqual([{ c: expect.any(String) }]);
      expect(await vaultUsersOf(PROJECT_ID)).toEqual([BOB]);
    });
  });

  describe("the events the vault named the person in", () => {
    const tokens: Array<string> = [ALICE_TOKEN, ALICE_TYPED_TOKEN];

    async function seedEvents(): Promise<void> {
      await writeEvents([
        namedEvent({
          uid: "principal",
          role: ScrubbedUserRole.Principal,
          named: ALICE,
          hashed: ALICE_TOKEN,
        }),
        // A token inside a larger user: the rest of it stays.
        namedEvent({
          uid: "target-auth0",
          role: ScrubbedUserRole.Target,
          named: ALICE_IN_AUTH0,
          hashed: `auth0|${ALICE_TOKEN}`,
        }),
        // Named in clear by the logs: not through the vault.
        {
          uid: "in-clear",
          principalUser: ALICE,
          observables: [ALICE],
          attributes: { "enduser.id": ALICE },
        },
        namedEvent({
          uid: "bob",
          role: ScrubbedUserRole.Principal,
          named: BOB,
          hashed: BOB_TOKEN,
        }),
        namedEvent({
          uid: "other-project",
          role: ScrubbedUserRole.Principal,
          named: ALICE,
          hashed: ALICE_TOKEN,
          projectId: OTHER_PROJECT_ID,
        }),
      ]);
    }

    test("finds who the vault named, and what the rule left in each one's place", async () => {
      await seedEvents();

      const pairs: Array<SecurityUserErasurePair> =
        await SecurityUserErasureEvents.findNamedPairs({
          projectId: PROJECT_ID,
          tokens,
        });

      expect(
        pairs.sort((a: SecurityUserErasurePair, b: SecurityUserErasurePair) => {
          return a.named.localeCompare(b.named);
        }),
      ).toEqual([
        { named: ALICE, hashed: ALICE_TOKEN },
        { named: ALICE_IN_AUTH0, hashed: `auth0|${ALICE_TOKEN}` },
      ]);
      expect(
        await SecurityUserErasureEvents.countNamedEvents({
          projectId: PROJECT_ID,
          tokens,
        }),
      ).toBe(2);
    });

    test("puts the token back where the vault named them, for who acted and who was acted on", async () => {
      await seedEvents();

      await SecurityUserErasureEvents.unnameEvents({
        projectId: PROJECT_ID,
        tokens,
      });
      await mutationsApplied();

      const principal: JSONObject = await eventOf("principal");
      const principalAttributes: Record<string, string> = principal[
        "attributes"
      ] as Record<string, string>;
      const principalMarker: { hidden: string; scrubbed: string } =
        SCRUBBED_USER_ATTRIBUTES[ScrubbedUserRole.Principal];

      expect(principal["principalUser"]).toBe(ALICE_TOKEN);
      expect(principal["observables"]).toEqual(["203.0.113.7", ALICE_TOKEN]);
      expect(principalAttributes["enduser.id"]).toBe(ALICE_TOKEN);
      expect(principalAttributes[principalMarker.hidden]).toBe(
        USER_HIDDEN_BY_SCRUB_RULE,
      );
      expect(principalAttributes[principalMarker.scrubbed]).toBe(ALICE_TOKEN);
      expect(
        principalAttributes[ERASED_USER_ATTRIBUTES[ScrubbedUserRole.Principal]],
      ).toBe(USER_ERASED_ON_REQUEST);
      expect(
        principalAttributes[HASHED_USER_ATTRIBUTES[ScrubbedUserRole.Principal]],
      ).toBeUndefined();
      // attributeKeys in step with the attributes, for the explorer's key search.
      expect((principal["attributeKeys"] as Array<string>).sort()).toEqual(
        Object.keys(principalAttributes).sort(),
      );
      expect(JSON.stringify(principal).toLowerCase()).not.toContain("alice");

      const target: JSONObject = await eventOf("target-auth0");
      const targetAttributes: Record<string, string> = target[
        "attributes"
      ] as Record<string, string>;

      expect(target["targetUser"]).toBe(`auth0|${ALICE_TOKEN}`);
      expect(target["observables"]).toEqual([
        "203.0.113.7",
        `auth0|${ALICE_TOKEN}`,
      ]);
      expect(
        targetAttributes[
          SCRUBBED_USER_ATTRIBUTES[ScrubbedUserRole.Target].hidden
        ],
      ).toBe(USER_HIDDEN_BY_SCRUB_RULE);
      expect(
        targetAttributes[ERASED_USER_ATTRIBUTES[ScrubbedUserRole.Target]],
      ).toBe(USER_ERASED_ON_REQUEST);
      expect(
        targetAttributes[HASHED_USER_ATTRIBUTES[ScrubbedUserRole.Target]],
      ).toBeUndefined();
      // Who acted on it is not the request's user: it keeps none it did not have.
      expect(targetAttributes["enduser.id"]).toBeUndefined();
      expect(JSON.stringify(target).toLowerCase()).not.toContain("alice");

      expect(
        await SecurityUserErasureEvents.countNamedEvents({
          projectId: PROJECT_ID,
          tokens,
        }),
      ).toBe(0);
    });

    test("leaves an event that named the person in clear, another person's, and another project's", async () => {
      await seedEvents();

      await SecurityUserErasureEvents.unnameEvents({
        projectId: PROJECT_ID,
        tokens,
      });
      await mutationsApplied();

      expect((await eventOf("in-clear"))["principalUser"]).toBe(ALICE);
      expect((await eventOf("bob"))["principalUser"]).toBe(BOB);

      const other: JSONObject = await eventOf("other-project");

      expect(other["principalUser"]).toBe(ALICE);
      expect(
        (other["attributes"] as Record<string, string>)[
          HASHED_USER_ATTRIBUTES[ScrubbedUserRole.Principal]
        ],
      ).toBe(ALICE_TOKEN);
    });

    test("running it again changes nothing", async () => {
      await seedEvents();

      await SecurityUserErasureEvents.unnameEvents({
        projectId: PROJECT_ID,
        tokens,
      });
      await mutationsApplied();

      const once: Array<JSONObject> = await rowsOf(
        `SELECT eventUid, principalUser, targetUser, observables, attributes FROM ${eventsTable} ORDER BY eventUid`,
      );

      await SecurityUserErasureEvents.unnameEvents({
        projectId: PROJECT_ID,
        tokens,
      });
      await mutationsApplied();

      expect(
        await rowsOf(
          `SELECT eventUid, principalUser, targetUser, observables, attributes FROM ${eventsTable} ORDER BY eventUid`,
        ),
      ).toEqual(once);
    });

    test("keeps the rest of the event: when, what happened and its message", async () => {
      await writeEvents([
        {
          ...namedEvent({
            uid: "kept",
            role: ScrubbedUserRole.Principal,
            named: ALICE,
            hashed: ALICE_TOKEN,
          }),
          message: `Failed password for ${ALICE_TOKEN} from 203.0.113.7`,
        },
      ]);

      const before: Array<JSONObject> = await rowsOf(
        `SELECT time, className, statusName, severityName, principalIp, message FROM ${eventsTable} WHERE eventUid = 'kept'`,
      );

      await SecurityUserErasureEvents.unnameEvents({
        projectId: PROJECT_ID,
        tokens,
      });
      await mutationsApplied();

      expect(
        await rowsOf(
          `SELECT time, className, statusName, severityName, principalIp, message FROM ${eventsTable} WHERE eventUid = 'kept'`,
        ),
      ).toEqual(before);
    });
  });

  describe("once erased, never named again", () => {
    function pendingEvent(principalUser: string): NormalizedSecurityEvent {
      return {
        time: new Date(),
        eventUid: ObjectID.generate().toString(),
        categoryUid: 3,
        categoryName: "Identity & Access Management",
        classUid: 3002,
        className: "Authentication",
        activityName: "Logon",
        severityId: 3,
        severityName: "Medium",
        statusName: "Failure",
        message: "Failed sign-in",
        vendorName: "OpenSSH",
        productName: "sshd",
        ruleId: "",
        ruleName: "",
        mitreTactics: [],
        mitreTechniques: [],
        principalUser,
        principalHost: "",
        principalIp: "203.0.113.7",
        principalProcess: "",
        processName: "",
        processPath: "",
        processCommandLine: "",
        parentProcessName: "",
        parentProcessPath: "",
        parentProcessCommandLine: "",
        targetUser: "",
        targetHost: "",
        targetIp: "",
        targetPort: 0,
        targetResource: "",
        observables: [principalUser],
        attributes: {},
      } as unknown as NormalizedSecurityEvent;
    }

    test("a later event carrying the token is not named, even when a row for it is in the vault", async () => {
      await writeVault(PROJECT_ID, [
        { token: ALICE_TOKEN, user: ALICE },
        { token: BOB_TOKEN, user: BOB },
      ]);

      // Before the request: the vault names both.
      const before: Array<NormalizedSecurityEvent> = [
        pendingEvent(ALICE_TOKEN),
        pendingEvent(BOB_TOKEN),
      ];

      expect(
        await SecurityUserVaultLookup.nameHashedUsers({
          projectId: PROJECT_ID,
          events: before,
        }),
      ).toBe(2);
      expect(before[0]!.principalUser).toBe(ALICE);

      // Filed: the row is still there (the worker has not run), and nobody is named by it.
      file(PROJECT_ID, [ALICE_TOKEN]);

      const after: Array<NormalizedSecurityEvent> = [
        pendingEvent(ALICE_TOKEN),
        pendingEvent(`auth0|${ALICE_TOKEN}`),
        pendingEvent(BOB_TOKEN),
      ];

      expect(
        await SecurityUserVaultLookup.nameHashedUsers({
          projectId: PROJECT_ID,
          events: after,
        }),
      ).toBe(1);
      expect(after[0]!.principalUser).toBe(ALICE_TOKEN);
      expect(after[1]!.principalUser).toBe(`auth0|${ALICE_TOKEN}`);
      expect(after[2]!.principalUser).toBe(BOB);
      expect(JSON.stringify(after.slice(0, 2))).not.toContain(ALICE);
    });

    test("another project's request erases nobody here", async () => {
      await writeVault(PROJECT_ID, [{ token: ALICE_TOKEN, user: ALICE }]);
      file(OTHER_PROJECT_ID, [ALICE_TOKEN]);

      const events: Array<NormalizedSecurityEvent> = [
        pendingEvent(ALICE_TOKEN),
      ];

      expect(
        await SecurityUserVaultLookup.nameHashedUsers({
          projectId: PROJECT_ID,
          events,
        }),
      ).toBe(1);
      expect(events[0]!.principalUser).toBe(ALICE);
    });

    test("ingest refuses to keep an erased token again, and keeps everybody else", async () => {
      file(PROJECT_ID, [ALICE_TOKEN]);

      const batch: SecurityUserVaultBatch | null =
        await SecurityUserVaultWriter.startBatch({
          projectId: PROJECT_ID,
          signal: "log",
          scrubRules: [
            {
              rule: {
                patternType: LogScrubPatternType.Email,
                scrubAction: LogScrubAction.Hash,
              },
            },
          ],
        });

      expect(batch).not.toBeNull();

      batch!.recordHashedUser({ token: ALICE_TOKEN, user: ALICE });
      batch!.recordHashedUser({ token: BOB_TOKEN, user: BOB });
      batch!.write();
      await SecurityUserVaultWriter.whenIdle();

      expect(await vaultUsersOf(PROJECT_ID)).toEqual([BOB]);
      expect(counted.sort()).toEqual(["refused:1", "written:1"]);
    });

    test("when the erased tokens cannot be read, ingest keeps nobody and the scans name nobody", async () => {
      jest
        .spyOn(SecurityUserErasureRequestService, "getErasedTokensOfProject")
        .mockRejectedValue(new Error("Postgres is down"));
      SecurityUserErasedTokens.clearCache();

      await writeVault(PROJECT_ID, [{ token: BOB_TOKEN, user: BOB }]);

      const events: Array<NormalizedSecurityEvent> = [pendingEvent(BOB_TOKEN)];

      expect(
        await SecurityUserVaultLookup.nameHashedUsers({
          projectId: PROJECT_ID,
          events,
        }),
      ).toBe(0);
      expect(events[0]!.principalUser).toBe(BOB_TOKEN);

      const batch: SecurityUserVaultBatch | null =
        await SecurityUserVaultWriter.startBatch({
          projectId: PROJECT_ID,
          signal: "trace",
          scrubRules: [
            {
              rule: {
                patternType: LogScrubPatternType.Email,
                scrubAction: LogScrubAction.Hash,
              },
            },
          ],
        });

      batch!.recordHashedUser({
        token: tokenOf("carol@example.com"),
        user: "carol@example.com",
      });
      batch!.write();
      await SecurityUserVaultWriter.whenIdle();

      expect(await vaultUsersOf(PROJECT_ID)).toEqual([BOB]);
      expect(counted).toEqual(["refused:1"]);
    });
  });

  describe("the worker, end to end", () => {
    // The requests, as Postgres would keep them.
    let requests: Map<string, SecurityUserErasureRequest>;
    let erasedNames: Array<Array<ErasedName>>;
    let emailed: number;

    function fileRequest(data: {
      user: string;
      requestedAt: Date;
      projectId?: ObjectID | undefined;
    }): SecurityUserErasureRequest {
      const projectId: ObjectID = data.projectId || PROJECT_ID;
      const request: SecurityUserErasureRequest =
        new SecurityUserErasureRequest();

      request.id = ObjectID.generate();
      request.projectId = projectId;
      request.userToErase = data.user;
      request.tokens = getErasureTokens({ projectId, user: data.user });
      request.status = SecurityUserErasureRequestStatus.Pending;
      request.requestedAt = data.requestedAt;
      request.updatedAt = data.requestedAt;
      request.attempts = 0;
      request.vaultEntriesDeleted = 0;
      request.eventsUnnamed = 0;
      request.casesUnnamed = 0;
      request.proposalsWithdrawn = 0;

      requests.set(request.id.toString(), request);
      file(projectId, request.tokens);

      return request;
    }

    function stored(
      request: SecurityUserErasureRequest,
    ): SecurityUserErasureRequest {
      return requests.get(request.id!.toString())!;
    }

    function update(requestId: ObjectID, data: Record<string, unknown>): void {
      const request: SecurityUserErasureRequest = requests.get(
        requestId.toString(),
      )!;

      for (const [key, value] of Object.entries(data)) {
        (request as unknown as Record<string, unknown>)[key] =
          value === null ? undefined : value;
      }

      request.updatedAt = new Date();
    }

    beforeEach((): void => {
      requests = new Map<string, SecurityUserErasureRequest>();
      erasedNames = [];
      emailed = 0;

      jest
        .spyOn(SecurityUserErasureRequestService, "getOpenRequests")
        .mockImplementation(
          async (): Promise<Array<SecurityUserErasureRequest>> => {
            return Array.from(requests.values())
              .filter((request: SecurityUserErasureRequest): boolean => {
                return (
                  request.status === SecurityUserErasureRequestStatus.Pending ||
                  request.status === SecurityUserErasureRequestStatus.InProgress
                );
              })
              .map(
                (
                  request: SecurityUserErasureRequest,
                ): SecurityUserErasureRequest => {
                  const copy: SecurityUserErasureRequest =
                    new SecurityUserErasureRequest();
                  Object.assign(copy, request);
                  return copy;
                },
              );
          },
        );
      jest
        .spyOn(
          SecurityUserErasureRequestService,
          "compareAndSetColumnsByIdWithoutHooks",
        )
        .mockImplementation((async (input: {
          id: ObjectID;
          data: Record<string, unknown>;
          expectedData: Record<string, unknown>;
        }): Promise<boolean> => {
          const request: SecurityUserErasureRequest = requests.get(
            input.id.toString(),
          )!;

          if (request.status !== input.expectedData["status"]) {
            return false;
          }

          update(input.id, input.data);
          return true;
        }) as never);
      jest
        .spyOn(SecurityUserErasureRequestService, "markInProgress")
        .mockImplementation(
          async (data: {
            requestId: ObjectID;
            counts: SecurityUserErasureCounts;
          }): Promise<void> => {
            update(data.requestId, {
              status: SecurityUserErasureRequestStatus.InProgress,
              failureReason: null,
              ...data.counts,
            });
          },
        );
      jest
        .spyOn(SecurityUserErasureRequestService, "markCompleted")
        .mockImplementation(
          async (data: {
            requestId: ObjectID;
            counts: SecurityUserErasureCounts;
          }): Promise<void> => {
            update(data.requestId, {
              status: SecurityUserErasureRequestStatus.Completed,
              completedAt: new Date(),
              userToErase: null,
              ...data.counts,
            });
          },
        );
      // Postgres's half is SecurityUserErasurePostgres.test.ts: here, who it is handed.
      jest
        .spyOn(SecurityUserErasureRecords, "unnameRecords")
        .mockImplementation(
          async (data: {
            projectId: ObjectID;
            names: ReadonlyArray<ErasedName>;
          }) => {
            erasedNames.push([...data.names]);
            return { cases: 1, proposals: 0 };
          },
        );
      jest
        .spyOn(ProjectService, "sendEmailToProjectOwners")
        .mockImplementation(async (): Promise<void> => {
          emailed++;
        });
    });

    async function seedPerson(): Promise<void> {
      await writeVault(PROJECT_ID, [
        { token: ALICE_TOKEN, user: ALICE },
        { token: BOB_TOKEN, user: BOB },
      ]);
      await writeEvents([
        namedEvent({
          uid: "alice-1",
          role: ScrubbedUserRole.Principal,
          named: ALICE,
          hashed: ALICE_TOKEN,
        }),
        namedEvent({
          uid: "alice-2",
          role: ScrubbedUserRole.Target,
          named: ALICE_IN_AUTH0,
          hashed: `auth0|${ALICE_TOKEN}`,
        }),
        namedEvent({
          uid: "bob",
          role: ScrubbedUserRole.Principal,
          named: BOB,
          hashed: BOB_TOKEN,
        }),
      ]);
    }

    test("Pending until every process refuses the tokens, InProgress with what it counted, then Completed once ClickHouse applied it", async () => {
      await seedPerson();

      const filedAt: Date = new Date();
      const request: SecurityUserErasureRequest = fileRequest({
        user: ALICE_TYPED,
        requestedAt: filedAt,
      });

      // A minute in: some process may not refuse the tokens yet, so nothing is deleted.
      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS / 2),
      );

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.Pending,
      );
      expect(await vaultUsersOf(PROJECT_ID)).toEqual([ALICE, BOB]);

      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 1000),
      );

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.InProgress,
      );
      expect(stored(request).vaultEntriesDeleted).toBe(1);
      expect(stored(request).eventsUnnamed).toBe(2);
      expect(stored(request).casesUnnamed).toBe(1);
      // Who Postgres was told to take out: as typed, as the vault held them, as the events named them.
      expect(
        erasedNames[0]!
          .map((name: ErasedName): string => {
            return `${name.named} -> ${name.hashed}`;
          })
          .sort(),
      ).toEqual(
        [
          `${ALICE_TYPED} -> ${ALICE_TYPED_TOKEN}`,
          `${ALICE} -> ${ALICE_TOKEN}`,
          `${ALICE_IN_AUTH0} -> auth0|${ALICE_TOKEN}`,
        ].sort(),
      );

      await mutationsApplied();
      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000),
      );

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );
      expect(stored(request).completedAt).toBeInstanceOf(Date);
      expect(stored(request).userToErase).toBeUndefined();
      // The counts it showed when it started are the counts it keeps.
      expect(stored(request).vaultEntriesDeleted).toBe(1);
      expect(stored(request).eventsUnnamed).toBe(2);

      expect(await vaultUsersOf(PROJECT_ID)).toEqual([BOB]);
      expect((await eventOf("alice-1"))["principalUser"]).toBe(ALICE_TOKEN);
      expect((await eventOf("alice-2"))["targetUser"]).toBe(
        `auth0|${ALICE_TOKEN}`,
      );
      expect((await eventOf("bob"))["principalUser"]).toBe(BOB);
      expect(emailed).toBe(0);

      // Over: the next run leaves it be.
      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 121000),
      );
      expect(erasedNames).toHaveLength(1);
    });

    test("a person the vault never knew is erased all the same, with nothing to count", async () => {
      await seedPerson();

      const filedAt: Date = new Date();
      const request: SecurityUserErasureRequest = fileRequest({
        user: "nobody@example.com",
        requestedAt: filedAt,
      });

      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 1000),
      );
      await mutationsApplied();
      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000),
      );

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );
      expect(stored(request).vaultEntriesDeleted).toBe(0);
      expect(stored(request).eventsUnnamed).toBe(0);
      expect(await vaultUsersOf(PROJECT_ID)).toEqual([ALICE, BOB]);
      expect((await eventOf("alice-1"))["principalUser"]).toBe(ALICE);
    });

    test("erasing the same person twice changes nothing more, and counts nothing twice", async () => {
      await seedPerson();

      const filedAt: Date = new Date();
      const first: SecurityUserErasureRequest = fileRequest({
        user: ALICE,
        requestedAt: filedAt,
      });

      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 1000),
      );
      await mutationsApplied();
      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000),
      );

      const eventsAfterFirst: Array<JSONObject> = await rowsOf(
        `SELECT eventUid, principalUser, targetUser, observables, attributes FROM ${eventsTable} ORDER BY eventUid`,
      );

      const second: SecurityUserErasureRequest = fileRequest({
        user: ALICE,
        requestedAt: new Date(filedAt.getTime() + 120000),
      });

      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + 120000 + SUPPRESSION_SETTLE_MS + 1000),
      );
      await mutationsApplied();
      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + 120000 + SUPPRESSION_SETTLE_MS + 61000),
      );

      expect(stored(first).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );
      expect(stored(first).eventsUnnamed).toBe(2);
      expect(stored(second).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );
      expect(stored(second).vaultEntriesDeleted).toBe(0);
      expect(stored(second).eventsUnnamed).toBe(0);
      expect(
        await rowsOf(
          `SELECT eventUid, principalUser, targetUser, observables, attributes FROM ${eventsTable} ORDER BY eventUid`,
        ),
      ).toEqual(eventsAfterFirst);
    });

    test("a request whose rows ClickHouse has not deleted yet stays InProgress until it has", async () => {
      await seedPerson();

      const filedAt: Date = new Date();
      const request: SecurityUserErasureRequest = fileRequest({
        user: ALICE,
        requestedAt: filedAt,
      });

      // The first run's deletes are lost on the way (a ClickHouse that dropped them).
      const erase: ReturnType<typeof jest.spyOn> = jest
        .spyOn(SecurityUserVaultService, "eraseTokens")
        .mockResolvedValueOnce(undefined);
      const unname: ReturnType<typeof jest.spyOn> = jest
        .spyOn(SecurityUserErasureEvents, "unnameEvents")
        .mockResolvedValueOnce(undefined);

      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 1000),
      );
      await mutationsApplied();
      // A minute on: still named, and too soon to tell ClickHouse again.
      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000),
      );

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.InProgress,
      );
      expect(erase).toHaveBeenCalledTimes(1);
      expect(await vaultUsersOf(PROJECT_ID)).toEqual([ALICE, BOB]);

      // Half an hour on, it is told again; once applied, it is done.
      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 31 * 60 * 1000),
      );
      await mutationsApplied();

      expect(erase).toHaveBeenCalledTimes(2);
      expect(unname).toHaveBeenCalledTimes(2);
      expect(await vaultUsersOf(PROJECT_ID)).toEqual([BOB]);

      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 32 * 60 * 1000),
      );

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );
      // Counted once, however many times it was told.
      expect(stored(request).vaultEntriesDeleted).toBe(1);
      expect(stored(request).eventsUnnamed).toBe(2);
    });

    test("a run that fails is retried after its backoff, and after the last attempt the request fails and the owners are told", async () => {
      await seedPerson();

      const filedAt: Date = new Date();
      const request: SecurityUserErasureRequest = fileRequest({
        user: ALICE,
        requestedAt: filedAt,
      });

      jest
        .spyOn(SecurityUserErasureRequestService, "markAttemptFailed")
        .mockImplementation(
          async (data: {
            requestId: ObjectID;
            status: SecurityUserErasureRequestStatus;
            attempts: number;
            failureReason: string;
          }): Promise<void> => {
            update(data.requestId, {
              status: data.status,
              attempts: data.attempts,
              failureReason: data.failureReason,
            });
          },
        );
      jest
        .spyOn(SecurityUserErasureRequestService, "markFailed")
        .mockImplementation(
          async (data: {
            requestId: ObjectID;
            attempts: number;
            failureReason: string;
          }): Promise<void> => {
            update(data.requestId, {
              status: SecurityUserErasureRequestStatus.Failed,
              completedAt: new Date(),
              attempts: data.attempts,
              userToErase: null,
              failureReason: data.failureReason,
            });
          },
        );
      jest
        .spyOn(SecurityUserErasureEvents, "countNamedEvents")
        .mockRejectedValue(new Error("ClickHouse is down"));

      let at: number = filedAt.getTime() + SUPPRESSION_SETTLE_MS + 1000;

      await SecurityUserErasure.processOpenRequests(new Date(at));

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.InProgress,
      );
      expect(stored(request).attempts).toBe(1);
      expect(stored(request).failureReason).toBe("ClickHouse is down");

      // Within its backoff: left alone.
      await SecurityUserErasure.processOpenRequests(new Date(at + 60000));
      expect(stored(request).attempts).toBe(1);

      for (let attempt: number = 2; attempt <= 5; attempt++) {
        at =
          (stored(request).updatedAt as Date).getTime() +
          attempt * 10 * 60 * 1000;
        await SecurityUserErasure.processOpenRequests(new Date(at));
        expect(stored(request).attempts).toBe(attempt);
      }

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.Failed,
      );
      expect(stored(request).userToErase).toBeUndefined();
      expect(emailed).toBe(1);
      // Failed, but the vault still refuses the person.
      expect(filedTokens.get(PROJECT_ID.toString())?.has(ALICE_TOKEN)).toBe(
        true,
      );
    });
  });
});

describe("Security user erasure ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
