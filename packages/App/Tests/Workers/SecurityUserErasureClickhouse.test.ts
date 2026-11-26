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
import DetectionRule from "Common/Models/DatabaseModels/DetectionRule";
import SecurityUserErasureRequest from "Common/Models/DatabaseModels/SecurityUserErasureRequest";
import ThreatIntelFeed from "Common/Models/DatabaseModels/ThreatIntelFeed";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import ProjectService from "Common/Server/Services/ProjectService";
import SecurityEventService, {
  DetectionMatchGroup,
} from "Common/Server/Services/SecurityEventService";
import SecurityUserErasureRequestService, {
  SecurityUserErasureCounts,
  getErasureTokens,
  readErasureRequestNames,
  toStoredErasureNames,
} from "Common/Server/Services/SecurityUserErasureRequestService";
import { IndicatorMatchGroup } from "Common/Server/Services/ThreatIntelIndicatorService";
import DetectionRuleEvaluator, {
  getDetectionFiringKey,
} from "Common/Server/Utils/SecurityEvent/DetectionRuleEvaluator";
import DetectionFingerprint, {
  DetectionFingerprintKind,
} from "Common/Server/Utils/SecurityEvent/DetectionFingerprint";
import ThreatIntelMatcher from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelMatcher";
import SecurityUserErasureFindings, {
  ErasureFindingRow,
  FINDING_USER_ERASED_ATTRIBUTE,
  FindingRewrite,
  FindingsCursor,
  FindingsScanStep,
  planFindingRewrite,
} from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserErasureFindings";
import {
  SecurityUserErasureProgress,
  readErasureProgress,
  toStoredErasureProgress,
} from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserErasureProgress";
import {
  DETECTION_FINDING_CLASS_NAME,
  DETECTION_FINDING_CLASS_UID,
  DETECTION_GROUP_VALUE_ATTRIBUTE,
  DETECTION_MATCH_COUNT_ATTRIBUTE,
  DETECTION_RULE_NAME_ATTRIBUTE,
  DETECTION_SUMMARY_ATTRIBUTE,
} from "Common/Types/SecurityEvent/DetectionFindingConstants";
import { SigmaCorrelationType } from "Common/Types/SecurityEvent/SigmaCorrelation";
import SigmaRule, { SigmaLevel } from "Common/Types/SecurityEvent/SigmaRule";
import { THREAT_INDICATOR_VALUE_ATTRIBUTE } from "Common/Types/SecurityEvent/ThreatIntelConstants";
import SecurityUserVaultService, {
  SecurityUserVaultService as SecurityUserVaultServiceClass,
} from "Common/Server/Services/SecurityUserVaultService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import SecurityEventsReadTelemetry from "Common/Server/Utils/SecurityEvent/SecurityEventsReadTelemetry";
import SecurityUserErasedTokens from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserErasedTokens";
import SecurityUserErasure, {
  DETECTION_TURN_SETTLE_MS,
  SUPPRESSION_SETTLE_MS,
} from "Common/Server/Utils/SecurityEvent/UserVault/SecurityUserErasure";
import JobDeadline from "Common/Server/Utils/JobDeadline";
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
import {
  SecurityUserErasureRequestStatus,
  isErasureToken,
} from "Common/Types/SecurityEvent/SecurityUserErasure";
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

// What is left to change in a project's findings, as a read from the first finds it.
interface FindingsScanResult {
  rewrites: Array<FindingRewrite>;
  isCapped: boolean;
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

  /*
   * The Detection Findings a rule or a threat intel feed writes about
   * somebody (#11044), written by the real writers (DetectionRuleEvaluator,
   * ThreatIntelMatcher), so each holds them exactly where OneUptime puts
   * them: the message, the observables and the attributes.
   */
  const CAROL: string = "carol@example.org";
  // Holds the person's address inside it: another person, never touched.
  const MALICE: string = `m${ALICE}`;
  const ADDRESS: string = "203.0.113.7";
  const INDICATOR: string = "198.51.100.9";
  const ALICE_NAMES: Array<ErasedName> = [
    { named: ALICE, hashed: ALICE_TOKEN },
    { named: ALICE_TYPED, hashed: ALICE_TYPED_TOKEN },
    { named: ALICE_IN_AUTH0, hashed: `auth0|${ALICE_TOKEN}` },
  ];

  interface FindingWriters {
    writeDetectionFindings: (data: {
      rule: DetectionRule;
      parsedRule: SigmaRule;
      matchedGroups: Array<DetectionMatchGroup>;
      correlationType?: string | undefined;
    }) => Promise<{ eventUids: Map<string, string>; written: number }>;
    writeThreatIntelFindings: (data: {
      feed: ThreatIntelFeed;
      matchedGroups: Array<IndicatorMatchGroup>;
    }) => Promise<Map<string, string>>;
  }

  const evaluator: FindingWriters =
    DetectionRuleEvaluator as unknown as FindingWriters;
  const matcher: FindingWriters =
    ThreatIntelMatcher as unknown as FindingWriters;

  function parsedRuleOf(title: string): SigmaRule {
    return {
      title,
      id: "8f3c9a4e-0000-4000-8000-000000011044",
      description: "",
      level: SigmaLevel.High,
      status: "stable",
      tags: [],
      mitreTactics: ["TA0006"],
      mitreTechniques: ["T1110"],
      logsource: {},
      selections: [],
      condition: { type: "selection", name: "selection" },
    } as unknown as SigmaRule;
  }

  function ruleOf(
    name: string,
    projectId: ObjectID = PROJECT_ID,
  ): DetectionRule {
    const rule: DetectionRule = new DetectionRule();

    rule.id = ObjectID.generate();
    rule.projectId = projectId;
    rule.name = name;

    return rule;
  }

  function group(data: Partial<DetectionMatchGroup>): DetectionMatchGroup {
    return {
      groupValue: "",
      matchCount: 3,
      distinctCount: 0,
      sampleMessage: "Failed password",
      sampleObservables: [],
      ...data,
    };
  }

  // A rule's findings, as the evaluator writes them, and the rule's id to find them by.
  async function writeRuleFindings(data: {
    name: string;
    groups: Array<DetectionMatchGroup>;
    correlationType?: string | undefined;
    projectId?: ObjectID | undefined;
  }): Promise<string> {
    const rule: DetectionRule = ruleOf(data.name, data.projectId);

    await evaluator.writeDetectionFindings({
      rule,
      parsedRule: parsedRuleOf(data.name),
      matchedGroups: data.groups,
      correlationType: data.correlationType,
    });

    return rule.id!.toString();
  }

  async function writeThreatIntelFinding(): Promise<string> {
    const feed: ThreatIntelFeed = new ThreatIntelFeed();

    feed.id = ObjectID.generate();
    feed.projectId = PROJECT_ID;
    feed.name = "Known bad addresses";

    const stixId: string = `indicator--${ObjectID.generate().toString()}`;

    await matcher.writeThreatIntelFindings({
      feed,
      matchedGroups: [
        {
          indicatorValue: INDICATOR,
          stixId,
          indicatorType: "ipv4-addr",
          indicatorName: "Botnet node",
          confidence: 80,
          matchCount: 2,
          sampleMessage: "Connection",
          sampleObservables: [INDICATOR, ALICE],
        },
      ],
    });

    return stixId;
  }

  // A finding as a connector brings one in: named by its source, never by the vault.
  async function writeConnectorFinding(): Promise<void> {
    const time: Date = OneUptimeDate.addRemoveMinutes(new Date(), -5);
    const attributes: Record<string, string> = {
      "crowdstrike.detection_id": "ldt:1",
    };

    await client.insert({
      table: eventsTable,
      values: [
        {
          _id: ObjectID.generate().toString(),
          projectId: PROJECT_ID.toString(),
          primaryEntityId: SOURCE_ID.toString(),
          primaryEntityType: ServiceType.OpenTelemetry,
          time: OneUptimeDate.toClickhouseDateTime64(time),
          createdAt: OneUptimeDate.toClickhouseDateTime(time),
          eventUid: "connector-finding",
          classUid: DETECTION_FINDING_CLASS_UID,
          className: DETECTION_FINDING_CLASS_NAME,
          vendorName: "CrowdStrike",
          productName: "Falcon",
          ruleId: "connector-rule",
          message: `Suspicious sign-in — ${ALICE}`,
          principalUser: ALICE,
          observables: [ALICE],
          attributes,
          attributeKeys: Object.keys(attributes),
          retentionDate: OneUptimeDate.toClickhouseDateTime(
            OneUptimeDate.addRemoveDays(new Date(), 30),
          ),
        },
      ],
      format: "JSONEachRow",
      clickhouse_settings: { wait_for_async_insert: 1 },
    });
  }

  async function findingsCount(): Promise<number> {
    const rows: Array<JSONObject> = await rowsOf(
      `SELECT toString(count()) AS c FROM ${eventsTable} WHERE className = '${DETECTION_FINDING_CLASS_NAME}'`,
    );

    return Number(rows[0]?.["c"] || 0);
  }

  // The writers insert without waiting: until every finding is in.
  async function findingsWritten(expected: number): Promise<void> {
    await client.command({ query: "SYSTEM FLUSH ASYNC INSERT QUEUE" });

    const deadline: number = Date.now() + 30000;

    while (Date.now() < deadline) {
      if ((await findingsCount()) >= expected) {
        return;
      }

      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, 200);
      });
    }

    throw new Error(`Expected ${expected} findings, found fewer.`);
  }

  async function findingOf(ruleId: string): Promise<JSONObject> {
    const rows: Array<JSONObject> = await rowsOf(
      `SELECT _id, eventUid, toString(time) AS time, ruleName, severityName, mitreTactics, message, observables, attributes, attributeKeys, vendorName FROM ${eventsTable} WHERE ruleId = '${ruleId}'`,
    );

    expect(rows).toHaveLength(1);

    return rows[0]!;
  }

  function attributesOf(finding: JSONObject): Record<string, string> {
    return finding["attributes"] as Record<string, string>;
  }

  // The tokens the names were made of: what a request erases.
  function tokensIn(names: ReadonlyArray<ErasedName>): Array<string> {
    return Array.from(
      new Set<string>(
        names.flatMap((name: ErasedName): Array<string> => {
          return name.hashed.match(/\[HASHED:[0-9a-f]{16}\]/g) || [];
        }),
      ),
    );
  }

  /*
   * What a read of the project's findings would change, read page by page
   * from the first and planned as the erasure plans it - with nothing
   * changed: what is left to change.
   */
  async function findRewrites(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
    pageSize?: number | undefined;
    maxRewrites?: number | undefined;
  }): Promise<FindingsScanResult> {
    const pageSize: number = data.pageSize || 5000;
    const rewrites: Array<FindingRewrite> = [];
    let after: FindingsCursor | null = null;

    for (;;) {
      const rows: Array<ErasureFindingRow> =
        await SecurityUserErasureFindings.readFindingsPage({
          projectId: data.projectId,
          after,
          limit: pageSize,
        });

      for (const row of rows) {
        const rewrite: FindingRewrite | null = row.id
          ? planFindingRewrite(row, data.names, {
              projectId: data.projectId,
              tokens: tokensIn(data.names),
            })
          : null;

        after = { time: row.time, id: row.id };

        if (rewrite) {
          rewrites.push(rewrite);

          if (data.maxRewrites && rewrites.length >= data.maxRewrites) {
            return { rewrites, isCapped: true };
          }
        }
      }

      if (rows.length < pageSize) {
        return { rewrites, isCapped: false };
      }
    }
  }

  async function anyFindingNamingOf(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
  }): Promise<boolean> {
    return (
      (await findRewrites({ ...data, maxRewrites: 1 })).rewrites.length > 0
    );
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

    jest
      .spyOn(OTelIngestService, "telemetryServiceFromName")
      .mockResolvedValue({
        serviceName: "OneUptime Detections",
        primaryEntityId: SOURCE_ID,
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 30,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 30,
      } as TelemetryServiceMetadata);
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

    test("the Detection Findings' read and update name the project, ids and tokens, never the person (#11044)", () => {
      // Every shape of name: the user alone, inside a provider's id, and beside their name.
      const names: Array<ErasedName> = [
        { named: ALICE, hashed: ALICE_TOKEN },
        { named: ALICE_TYPED, hashed: ALICE_TYPED_TOKEN },
        { named: ALICE_IN_AUTH0, hashed: `auth0|${ALICE_TOKEN}` },
        {
          named: `Alice Smith <${ALICE}>`,
          hashed: `Alice Smith <${ALICE_TOKEN}>`,
        },
      ];
      const rewrite: FindingRewrite | null = planFindingRewrite(
        {
          id: ObjectID.generate().toString(),
          time: "1764000000000000000",
          observables: [
            `Alice Smith <${ALICE}>`,
            ALICE,
            ALICE_TYPED,
            ALICE_IN_AUTH0,
            "203.0.113.7",
          ],
          eventUid: `detection:${SOURCE_ID.toString()}:detection-rule:${SOURCE_ID.toString()}:${DetectionFingerprint.legacyOf({ kind: DetectionFingerprintKind.DetectionRule, value: `Alice Smith <${ALICE}>` })}:1764000000000000000`,
          groupValue: `Alice Smith <${ALICE}>`,
        },
        names,
        { projectId: PROJECT_ID, tokens: tokensIn(names) },
      );

      expect(rewrite!.replacements).toHaveLength(4);
      // And the id's new fingerprint: of what the finding holds with the names out.
      expect(rewrite!.uid).toEqual({
        positions: [5],
        fingerprint: DetectionFingerprint.of({
          projectId: PROJECT_ID,
          kind: DetectionFingerprintKind.DetectionRule,
          value: `Alice Smith <${ALICE_TOKEN}>`,
        }),
      });

      const statements: Array<Statement> = [
        SecurityUserErasureFindings.toFindingsPageStatement({
          projectId: PROJECT_ID,
          limit: 10,
        }),
        SecurityUserErasureFindings.toFindingsPageStatement({
          projectId: PROJECT_ID,
          after: { time: rewrite!.time, id: rewrite!.id },
          limit: 10,
        }),
        SecurityUserErasureFindings.toUnnameFindingsStatement({
          projectId: PROJECT_ID,
          mutation: {
            replacements: rewrite!.replacements,
            uid: rewrite!.uid,
            ids: [rewrite!.id],
            fromTime: rewrite!.time,
            toTime: rewrite!.time,
          },
        }),
      ];

      // A fingerprint of any of the names, keyed or not, of either source: none is sent.
      const fingerprintsOfNames: Array<string> = names.flatMap(
        (name: ErasedName): Array<string> => {
          return [
            DetectionFingerprintKind.DetectionRule,
            DetectionFingerprintKind.ThreatIntel,
          ].flatMap((kind: DetectionFingerprintKind): Array<string> => {
            return DetectionFingerprint.allOf({
              projectId: PROJECT_ID,
              kind,
              value: name.named,
            });
          });
        },
      );

      for (const statement of statements) {
        const sent: string =
          `${statement.query} ${JSON.stringify(statement.query_params)}`.toLowerCase();

        for (const fingerprint of fingerprintsOfNames) {
          expect(sent).not.toContain(fingerprint);
        }

        expect(sent).not.toContain("alice");
        expect(sent).not.toContain("smith");
        expect(sent).not.toContain("example.com");
        expect(sent).toContain(PROJECT_ID.toString());
      }

      // What goes in a name's place is the token and two lengths: the rest is the row's own.
      const update: string = JSON.stringify(statements[2]!.query_params);

      expect(update).toContain(ALICE_TOKEN);
      expect(update).not.toContain("auth0|");
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

  /*
   * #11044: the Detection Findings a rule or a threat intel feed wrote
   * about the person, written by the real writers (DetectionRuleEvaluator,
   * ThreatIntelMatcher), so each holds the person exactly where OneUptime
   * puts them: the message, the observables and the attributes.
   */
  describe("the Detection Findings a rule wrote about the person", () => {
    let ids: {
      byUser: string;
      byAddress: string;
      correlation: string;
      newValue: string;
      inAuth0: string;
      bob: string;
      otherProject: string;
      threatIntel: string;
    };

    async function seedFindings(): Promise<void> {
      ids = {
        // Grouped on who acted: the person is the group value, and twice an observable.
        byUser: await writeRuleFindings({
          name: "Brute force",
          groups: [
            group({
              groupValue: ALICE,
              sampleObservables: [ALICE, ADDRESS, ALICE_TYPED],
            }),
          ],
        }),
        // Grouped on the address: the person is only a sample observable.
        byAddress: await writeRuleFindings({
          name: "Password spray",
          groups: [
            group({
              groupValue: ADDRESS,
              matchCount: 9,
              sampleObservables: [ADDRESS, ALICE, CAROL],
            }),
          ],
        }),
        // A correlation grouped on the user and the address.
        correlation: await writeRuleFindings({
          name: "Brute force then success",
          correlationType: SigmaCorrelationType.TemporalOrdered,
          groups: [
            group({
              groupValue: `${ALICE} / ${ADDRESS}`,
              matchCount: 7,
              groupFields: [
                { field: "principalUser", value: ALICE },
                { field: "principalIp", value: ADDRESS },
              ],
              summary:
                "Failed sign-in, then Successful sign-in, 2 minutes apart",
              sampleObservables: [ALICE, ADDRESS],
            }),
          ],
        }),
        // A new value: the person in the sentence, beside somebody whose address holds theirs.
        newValue: await writeRuleFindings({
          name: "First sign-in from an address",
          correlationType: SigmaCorrelationType.NewValue,
          groups: [
            group({
              groupValue: ADDRESS,
              matchCount: 4,
              groupFields: [{ field: "principalIp", value: ADDRESS }],
              summary: `First principalUser in 7 days: ${ALICE}, ${MALICE}, ${ALICE} and 2 more`,
              sampleObservables: [ALICE, MALICE, ADDRESS],
            }),
          ],
        }),
        // The user inside a provider's id, as the events named them.
        inAuth0: await writeRuleFindings({
          name: "Token reuse",
          groups: [
            group({
              groupValue: ALICE_IN_AUTH0,
              sampleObservables: [ALICE_IN_AUTH0],
            }),
          ],
        }),
        bob: await writeRuleFindings({
          name: "Brute force",
          groups: [group({ groupValue: BOB, sampleObservables: [BOB] })],
        }),
        otherProject: await writeRuleFindings({
          name: "Brute force",
          projectId: OTHER_PROJECT_ID,
          groups: [group({ groupValue: ALICE, sampleObservables: [ALICE] })],
        }),
        threatIntel: await writeThreatIntelFinding(),
      };

      await writeConnectorFinding();
      await findingsWritten(9);
    }

    test("the writers name the person where a finding is about them", async () => {
      await seedFindings();

      const byUser: JSONObject = await findingOf(ids.byUser);

      expect(byUser["message"]).toBe(
        `Detection: Brute force — ${ALICE} (3 events)`,
      );
      expect(byUser["observables"]).toEqual([ALICE, ADDRESS, ALICE_TYPED]);
      expect(attributesOf(byUser)[DETECTION_GROUP_VALUE_ATTRIBUTE]).toBe(ALICE);
      expect(byUser["vendorName"]).toBe("OneUptime");
    });

    test("reads only the project's own findings that name the person, and matches them in the worker", async () => {
      await seedFindings();

      const found: FindingsScanResult =
        await findRewrites({
          projectId: PROJECT_ID,
          names: ALICE_NAMES,
        });
      const foundIds: Array<string> = found.rewrites.map(
        (rewrite: FindingRewrite): string => {
          return rewrite.id;
        },
      );
      const idOf: (ruleId: string) => Promise<string> = async (
        ruleId: string,
      ): Promise<string> => {
        return String((await findingOf(ruleId))["_id"]);
      };

      expect(foundIds.sort()).toEqual(
        (
          await Promise.all(
            [
              ids.byUser,
              ids.byAddress,
              ids.correlation,
              ids.newValue,
              ids.inAuth0,
              ids.threatIntel,
            ].map(idOf),
          )
        ).sort(),
      );
      expect(found.isCapped).toBe(false);
      expect(
        await anyFindingNamingOf({
          projectId: PROJECT_ID,
          names: ALICE_NAMES,
        }),
      ).toBe(true);
      // Nobody erased: nothing found, and nothing read for nobody.
      expect(
        (
          await findRewrites({
            projectId: PROJECT_ID,
            names: [
              {
                named: "dave@example.net",
                hashed: tokenOf("dave@example.net"),
              },
            ],
          })
        ).rewrites,
      ).toEqual([]);
    });

    test("takes the person out of each finding's message, observables and attributes, as the rule left them", async () => {
      await seedFindings();

      const found: FindingsScanResult =
        await findRewrites({
          projectId: PROJECT_ID,
          names: ALICE_NAMES,
        });

      expect(
        await SecurityUserErasureFindings.unnameFindings({
          projectId: PROJECT_ID,
          rewrites: found.rewrites,
        }),
      ).toBe(6);
      await mutationsApplied();

      const byUser: JSONObject = await findingOf(ids.byUser);

      expect(byUser["message"]).toBe(
        `Detection: Brute force — ${ALICE_TOKEN} (3 events)`,
      );
      // Each spelling with its own token, in its own place.
      expect(byUser["observables"]).toEqual([
        ALICE_TOKEN,
        ADDRESS,
        ALICE_TYPED_TOKEN,
      ]);
      expect(attributesOf(byUser)[DETECTION_GROUP_VALUE_ATTRIBUTE]).toBe(
        ALICE_TOKEN,
      );
      expect(attributesOf(byUser)[FINDING_USER_ERASED_ATTRIBUTE]).toBe(
        USER_ERASED_ON_REQUEST,
      );
      expect((byUser["attributeKeys"] as Array<string>).sort()).toEqual(
        Object.keys(attributesOf(byUser)).sort(),
      );

      const byAddress: JSONObject = await findingOf(ids.byAddress);

      expect(byAddress["message"]).toBe(
        `Detection: Password spray — ${ADDRESS} (9 events)`,
      );
      expect(byAddress["observables"]).toEqual([ADDRESS, ALICE_TOKEN, CAROL]);
      expect(attributesOf(byAddress)[DETECTION_GROUP_VALUE_ATTRIBUTE]).toBe(
        ADDRESS,
      );

      const correlation: JSONObject = await findingOf(ids.correlation);

      expect(correlation["message"]).toBe(
        `Detection: Brute force then success — ${ALICE_TOKEN} / ${ADDRESS} (7 events; Failed sign-in, then Successful sign-in, 2 minutes apart)`,
      );
      expect(correlation["observables"]).toEqual([ALICE_TOKEN, ADDRESS]);
      expect(attributesOf(correlation)[DETECTION_GROUP_VALUE_ATTRIBUTE]).toBe(
        `${ALICE_TOKEN} / ${ADDRESS}`,
      );

      const newValue: JSONObject = await findingOf(ids.newValue);

      // Every time the sentence names them, and never the person whose address holds theirs.
      expect(newValue["message"]).toBe(
        `Detection: First sign-in from an address — ${ADDRESS} (4 events; First principalUser in 7 days: ${ALICE_TOKEN}, ${MALICE}, ${ALICE_TOKEN} and 2 more)`,
      );
      expect(attributesOf(newValue)[DETECTION_SUMMARY_ATTRIBUTE]).toBe(
        `First principalUser in 7 days: ${ALICE_TOKEN}, ${MALICE}, ${ALICE_TOKEN} and 2 more`,
      );
      expect(newValue["observables"]).toEqual([ADDRESS, ALICE_TOKEN, MALICE]);

      const inAuth0: JSONObject = await findingOf(ids.inAuth0);

      expect(inAuth0["message"]).toBe(
        `Detection: Token reuse — auth0|${ALICE_TOKEN} (3 events)`,
      );
      expect(inAuth0["observables"]).toEqual([`auth0|${ALICE_TOKEN}`]);
      expect(attributesOf(inAuth0)[DETECTION_GROUP_VALUE_ATTRIBUTE]).toBe(
        `auth0|${ALICE_TOKEN}`,
      );

      const threatIntel: JSONObject = await findingOf(ids.threatIntel);

      expect(threatIntel["message"]).toBe(
        `Threat intel: Known bad addresses — ${INDICATOR} (2 events)`,
      );
      expect(threatIntel["observables"]).toEqual([INDICATOR, ALICE_TOKEN]);
      expect(attributesOf(threatIntel)[THREAT_INDICATOR_VALUE_ATTRIBUTE]).toBe(
        INDICATOR,
      );

      for (const finding of [
        byUser,
        byAddress,
        correlation,
        inAuth0,
        threatIntel,
      ]) {
        expect(JSON.stringify(finding)).not.toContain(ALICE);
        expect(JSON.stringify(finding).toLowerCase()).not.toContain(
          ALICE_TYPED.toLowerCase(),
        );
        expect(attributesOf(finding)[FINDING_USER_ERASED_ATTRIBUTE]).toBe(
          USER_ERASED_ON_REQUEST,
        );
      }

      expect(
        await anyFindingNamingOf({
          projectId: PROJECT_ID,
          names: ALICE_NAMES,
        }),
      ).toBe(false);
    });

    test("leaves another person's findings, another project's, and a connector's as they were", async () => {
      await seedFindings();

      const before: Array<JSONObject> = await rowsOf(
        `SELECT ruleId, message, observables, attributes FROM ${eventsTable} WHERE ruleId IN ('${ids.bob}', '${ids.otherProject}', 'connector-rule') ORDER BY ruleId`,
      );

      await SecurityUserErasureFindings.unnameFindings({
        projectId: PROJECT_ID,
        rewrites: (
          await findRewrites({
            projectId: PROJECT_ID,
            names: ALICE_NAMES,
          })
        ).rewrites,
      });
      await mutationsApplied();

      expect(
        await rowsOf(
          `SELECT ruleId, message, observables, attributes FROM ${eventsTable} WHERE ruleId IN ('${ids.bob}', '${ids.otherProject}', 'connector-rule') ORDER BY ruleId`,
        ),
      ).toEqual(before);
      expect(before).toHaveLength(3);
    });

    test("keeps the rest of each finding: when, its rule, its severity and its counts", async () => {
      await seedFindings();

      /*
       * Its id is the same id but for the fingerprint in it, which becomes
       * the token's (#11130): the rule, and when it was written, stay.
       */
      const kept: string = `SELECT _id, arrayStringConcat(arrayFilter((part, position) -> position NOT IN (5, 9), splitByChar(':', eventUid), arrayEnumerate(splitByChar(':', eventUid))), ':') AS eventUidOutsideFingerprint, time, ruleId, ruleName, severityName, mitreTactics, mitreTechniques, classUid, attributes['${DETECTION_RULE_NAME_ATTRIBUTE}'] AS ruleNameAttribute, attributes['${DETECTION_MATCH_COUNT_ATTRIBUTE}'] AS matchCount FROM ${eventsTable} WHERE ruleId = '${ids.correlation}'`;
      const before: Array<JSONObject> = await rowsOf(kept);

      await SecurityUserErasureFindings.unnameFindings({
        projectId: PROJECT_ID,
        rewrites: (
          await findRewrites({
            projectId: PROJECT_ID,
            names: ALICE_NAMES,
          })
        ).rewrites,
      });
      await mutationsApplied();

      expect(await rowsOf(kept)).toEqual(before);
      expect(before).toHaveLength(1);
    });

    test("running it again finds nothing and changes nothing, and a mutation applied twice changes nothing more", async () => {
      await seedFindings();

      const found: FindingsScanResult =
        await findRewrites({
          projectId: PROJECT_ID,
          names: ALICE_NAMES,
        });

      await SecurityUserErasureFindings.unnameFindings({
        projectId: PROJECT_ID,
        rewrites: found.rewrites,
      });
      await mutationsApplied();

      const all: string = `SELECT _id, message, observables, attributes, attributeKeys FROM ${eventsTable} ORDER BY _id`;
      const once: Array<JSONObject> = await rowsOf(all);

      expect(
        (
          await findRewrites({
            projectId: PROJECT_ID,
            names: ALICE_NAMES,
          })
        ).rewrites,
      ).toEqual([]);

      // The same changes, told again (a run that queued them before the first was applied).
      await SecurityUserErasureFindings.unnameFindings({
        projectId: PROJECT_ID,
        rewrites: found.rewrites,
      });
      await mutationsApplied();

      expect(await rowsOf(all)).toEqual(once);
    });

    test("findings that need the same change share one mutation", async () => {
      // Five firings of one rule about the person: the same change each.
      for (let firing: number = 0; firing < 5; firing++) {
        await writeRuleFindings({
          name: `Brute force ${firing}`,
          groups: [group({ groupValue: ALICE, sampleObservables: [ALICE] })],
        });
      }

      // And one whose change differs: the person second.
      await writeRuleFindings({
        name: "Password spray",
        groups: [
          group({ groupValue: ADDRESS, sampleObservables: [ADDRESS, ALICE] }),
        ],
      });
      await findingsWritten(6);

      const mutationsBefore: number = Number(
        (
          await rowsOf(
            `SELECT toString(count()) AS c FROM system.mutations WHERE database = '${database}'`,
          )
        )[0]!["c"],
      );

      expect(
        await SecurityUserErasureFindings.unnameFindings({
          projectId: PROJECT_ID,
          rewrites: (
            await findRewrites({
              projectId: PROJECT_ID,
              names: ALICE_NAMES,
            })
          ).rewrites,
        }),
      ).toBe(6);
      await mutationsApplied();

      expect(
        Number(
          (
            await rowsOf(
              `SELECT toString(count()) AS c FROM system.mutations WHERE database = '${database}'`,
            )
          )[0]!["c"],
        ) - mutationsBefore,
      ).toBe(2);
      expect(
        await anyFindingNamingOf({
          projectId: PROJECT_ID,
          names: ALICE_NAMES,
        }),
      ).toBe(false);
    });

    test("reads page after page, findings written at the same moment included, and keeps at most as many as asked", async () => {
      const time: Date = OneUptimeDate.addRemoveMinutes(new Date(), -3);
      const rows: Array<JSONObject> = [];

      // Seven findings at one moment, every other one about the person.
      for (let index: number = 0; index < 7; index++) {
        const attributes: Record<string, string> = {
          [DETECTION_GROUP_VALUE_ATTRIBUTE]: index % 2 === 0 ? ALICE : BOB,
        };

        rows.push({
          _id: ObjectID.generate().toString(),
          projectId: PROJECT_ID.toString(),
          primaryEntityId: SOURCE_ID.toString(),
          primaryEntityType: ServiceType.OpenTelemetry,
          time: OneUptimeDate.toClickhouseDateTime64(time),
          createdAt: OneUptimeDate.toClickhouseDateTime(time),
          eventUid: `same-moment-${index}`,
          classUid: DETECTION_FINDING_CLASS_UID,
          className: DETECTION_FINDING_CLASS_NAME,
          vendorName: "OneUptime",
          productName: "OneUptime Detections",
          ruleId: `same-moment-${index}`,
          message: `Detection: Same moment — ${index % 2 === 0 ? ALICE : BOB} (1 events)`,
          observables: [index % 2 === 0 ? ALICE : BOB],
          attributes,
          attributeKeys: Object.keys(attributes),
          retentionDate: OneUptimeDate.toClickhouseDateTime(
            OneUptimeDate.addRemoveDays(new Date(), 30),
          ),
        });
      }

      await client.insert({
        table: eventsTable,
        values: rows,
        format: "JSONEachRow",
        clickhouse_settings: { wait_for_async_insert: 1 },
      });

      const paged: FindingsScanResult =
        await findRewrites({
          projectId: PROJECT_ID,
          names: ALICE_NAMES,
          pageSize: 2,
        });

      expect(paged.rewrites).toHaveLength(4);
      expect(
        new Set(
          paged.rewrites.map((rewrite: FindingRewrite): string => {
            return rewrite.id;
          }),
        ).size,
      ).toBe(4);

      const capped: FindingsScanResult =
        await findRewrites({
          projectId: PROJECT_ID,
          names: ALICE_NAMES,
          pageSize: 2,
          maxRewrites: 3,
        });

      expect(capped.rewrites).toHaveLength(3);
      expect(capped.isCapped).toBe(true);
    });

    test("a name beside text of the person's own, or with a pattern's characters in it, comes out with only the token sent", async () => {
      const besideName: ErasedName = {
        named: `Alice Smith <${ALICE}>`,
        hashed: `Alice Smith <${ALICE_TOKEN}>`,
      };
      const patterned: string = "o'neil+(test)|a.b@example.com";
      const patternedName: ErasedName = {
        named: patterned,
        hashed: tokenOf(patterned),
      };
      const withBackslash: ErasedName = {
        named: "CORP\\alice",
        hashed: `CORP\\${tokenOf("alice")}`,
      };

      const besideId: string = await writeRuleFindings({
        name: "Mailbox rule",
        groups: [
          group({
            groupValue: besideName.named,
            sampleObservables: [besideName.named],
          }),
        ],
      });
      const patternedId: string = await writeRuleFindings({
        name: "Odd user",
        groups: [
          group({ groupValue: patterned, sampleObservables: [patterned] }),
        ],
      });
      const backslashId: string = await writeRuleFindings({
        name: "Domain user",
        groups: [
          group({
            groupValue: withBackslash.named,
            sampleObservables: [withBackslash.named],
          }),
        ],
      });

      await findingsWritten(3);

      const found: FindingsScanResult =
        await findRewrites({
          projectId: PROJECT_ID,
          names: [besideName, patternedName, withBackslash],
        });

      expect(found.rewrites).toHaveLength(3);

      await SecurityUserErasureFindings.unnameFindings({
        projectId: PROJECT_ID,
        rewrites: found.rewrites,
      });
      await mutationsApplied();

      expect((await findingOf(besideId))["message"]).toBe(
        `Detection: Mailbox rule — Alice Smith <${ALICE_TOKEN}> (3 events)`,
      );
      expect((await findingOf(besideId))["observables"]).toEqual([
        besideName.hashed,
      ]);
      expect((await findingOf(patternedId))["message"]).toBe(
        `Detection: Odd user — ${patternedName.hashed} (3 events)`,
      );
      expect((await findingOf(backslashId))["message"]).toBe(
        `Detection: Domain user — ${withBackslash.hashed} (3 events)`,
      );
      expect((await findingOf(backslashId))["observables"]).toEqual([
        withBackslash.hashed,
      ]);

      // What ClickHouse keeps of the update: the ids, the tokens and lengths, never the text around them.
      const commands: string = (
        await rowsOf(
          `SELECT command FROM system.mutations WHERE database = '${database}'`,
        )
      )
        .map((row: JSONObject): string => {
          return String(row["command"]);
        })
        .join("\n")
        .toLowerCase();

      expect(commands).toContain(ALICE_TOKEN.toLowerCase());
      expect(commands).not.toContain("alice");
      expect(commands).not.toContain("smith");
      expect(commands).not.toContain("o'neil");
      expect(commands).not.toContain("example.com");
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
    // Each place a run kept, and the correlations' values whose fingerprints it had rewritten.
    let progressKept: Array<SecurityUserErasureProgress>;
    let rewrittenFingerprints: Array<Array<ErasedName>>;

    /*
     * The runs that find it done: one that sees nothing in the vault or the
     * events name the person, and - once a detection that read the name
     * before could no longer be writing - the final read of the findings.
     */
    async function runUntilChecked(at: number): Promise<number> {
      await SecurityUserErasure.processOpenRequests(new Date(at));
      await SecurityUserErasure.processOpenRequests(
        new Date(at + DETECTION_TURN_SETTLE_MS),
      );

      return at + DETECTION_TURN_SETTLE_MS;
    }

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
      // A pasted token needs nothing more: the service keeps none (SecurityUserErasureRequestService).
      if (!isErasureToken(data.user)) {
        request.userToErase = data.user;
      }
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
      progressKept = [];
      rewrittenFingerprints = [];

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
            names?: ReadonlyArray<ErasedName> | undefined;
            progress?: SecurityUserErasureProgress | undefined;
          }): Promise<void> => {
            update(data.requestId, {
              status: SecurityUserErasureRequestStatus.InProgress,
              failureReason: null,
              ...data.counts,
              // As the service keeps them: encrypted text, read back by readErasureRequestNames.
              ...(data.names
                ? {
                    namesToErase:
                      data.names.length > 0
                        ? toStoredErasureNames(data.names)
                        : null,
                  }
                : {}),
              ...(data.progress
                ? { progress: toStoredErasureProgress(data.progress) }
                : {}),
            });
          },
        );
      // Where a run got to (#11160), as the service keeps it.
      jest
        .spyOn(SecurityUserErasureRequestService, "markProgress")
        .mockImplementation(
          async (data: {
            requestId: ObjectID;
            progress: SecurityUserErasureProgress;
            eventsUnnamed?: number | undefined;
          }): Promise<void> => {
            progressKept.push(readErasureProgress(
              JSON.parse(JSON.stringify(data.progress)),
            ));
            update(data.requestId, {
              progress: toStoredErasureProgress(data.progress),
              ...(data.eventsUnnamed !== undefined
                ? { eventsUnnamed: data.eventsUnnamed }
                : {}),
            });
          },
        );
      jest
        .spyOn(SecurityUserErasureRequestService, "markNames")
        .mockImplementation(
          async (data: {
            requestId: ObjectID;
            names: ReadonlyArray<ErasedName>;
          }): Promise<void> => {
            update(data.requestId, {
              namesToErase:
                data.names.length > 0 ? toStoredErasureNames(data.names) : null,
            });
          },
        );
      // Postgres's correlations and fingerprints: SecurityUserErasurePostgres's.
      jest
        .spyOn(SecurityUserErasureRecords, "findCorrelationValues")
        .mockResolvedValue([]);
      jest
        .spyOn(SecurityUserErasureRecords, "rewriteFingerprints")
        .mockImplementation(
          async (data: { groupValues: ReadonlyArray<ErasedName> }) => {
            rewrittenFingerprints.push([...data.groupValues]);
            return { detections: 0, alerts: 0, incidents: 0, entityRisks: 0 };
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
              namesToErase: null,
              ...data.counts,
            });
          },
        );
      /*
       * Postgres's half is SecurityUserErasurePostgres.test.ts: here, who it
       * is handed - on each run, and once more as the request completes. A
       * case named the person the first time only.
       */
      jest
        .spyOn(SecurityUserErasureRecords, "unnameRecords")
        .mockImplementation(
          async (data: {
            projectId: ObjectID;
            names: ReadonlyArray<ErasedName>;
          }) => {
            erasedNames.push([...data.names]);
            return { cases: erasedNames.length === 1 ? 1 : 0, proposals: 0 };
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

      // Nothing names them now, but a detection that read them before may still be writing.
      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.InProgress,
      );
      expect(readErasureProgress(stored(request).progress).cleanSince).toBe(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000).toISOString(),
      );

      // Once none can be: the final read of the findings finds nothing to change.
      await SecurityUserErasure.processOpenRequests(
        new Date(
          filedAt.getTime() +
            SUPPRESSION_SETTLE_MS +
            61000 +
            DETECTION_TURN_SETTLE_MS,
        ),
      );

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );
      expect(stored(request).completedAt).toBeInstanceOf(Date);
      expect(stored(request).userToErase).toBeUndefined();
      // The names it kept while it worked are wiped with what was typed (#11044).
      expect(stored(request).namesToErase).toBeUndefined();
      // The counts it showed when it started are the counts it keeps.
      expect(stored(request).vaultEntriesDeleted).toBe(1);
      expect(stored(request).eventsUnnamed).toBe(2);
      expect(stored(request).casesUnnamed).toBe(1);

      expect(await vaultUsersOf(PROJECT_ID)).toEqual([BOB]);
      expect((await eventOf("alice-1"))["principalUser"]).toBe(ALICE_TOKEN);
      expect((await eventOf("alice-2"))["targetUser"]).toBe(
        `auth0|${ALICE_TOKEN}`,
      );
      expect((await eventOf("bob"))["principalUser"]).toBe(BOB);
      expect(emailed).toBe(0);

      /*
       * Postgres was gone through once more as it completed, with the names
       * the first run kept - though the vault and the events no longer hold
       * them.
       */
      expect(erasedNames).toHaveLength(2);
      expect(
        erasedNames[1]!
          .map((name: ErasedName): string => {
            return `${name.named} -> ${name.hashed}`;
          })
          .sort(),
      ).toEqual(
        erasedNames[0]!
          .map((name: ErasedName): string => {
            return `${name.named} -> ${name.hashed}`;
          })
          .sort(),
      );

      // Over: the next run leaves it be.
      await SecurityUserErasure.processOpenRequests(
        new Date(
          filedAt.getTime() +
            SUPPRESSION_SETTLE_MS +
            121000 +
            DETECTION_TURN_SETTLE_MS,
        ),
      );
      expect(erasedNames).toHaveLength(2);
      // Two passes of the findings: the first, and the final check.
      expect(readErasureProgress(stored(request).progress).findings?.number).toBe(
        2,
      );
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
      await runUntilChecked(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000);

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
      await seedFindingsAboutPerson();

      const first: SecurityUserErasureRequest = fileRequest({
        user: ALICE,
        requestedAt: filedAt,
      });

      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 1000),
      );
      await mutationsApplied();

      const firstDone: number = await runUntilChecked(
        filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000,
      );

      // Everything the events table holds, the findings and their ids among them.
      const everything: string = `SELECT _id, eventUid, principalUser, targetUser, message, observables, attributes, attributeKeys FROM ${eventsTable} ORDER BY _id`;
      const eventsAfterFirst: Array<JSONObject> = await rowsOf(everything);

      const second: SecurityUserErasureRequest = fileRequest({
        user: ALICE,
        requestedAt: new Date(firstDone + 120000),
      });

      await SecurityUserErasure.processOpenRequests(
        new Date(firstDone + 120000 + SUPPRESSION_SETTLE_MS + 1000),
      );
      await mutationsApplied();
      await runUntilChecked(firstDone + 120000 + SUPPRESSION_SETTLE_MS + 61000);

      expect(stored(first).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );
      // Two events and two findings.
      expect(stored(first).eventsUnnamed).toBe(4);
      expect(stored(second).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );
      expect(stored(second).vaultEntriesDeleted).toBe(0);
      expect(stored(second).eventsUnnamed).toBe(0);
      // Not a row changed: the events, the findings, their ids.
      expect(await rowsOf(everything)).toEqual(eventsAfterFirst);
      // Neither of the second's passes found a finding to change.
      expect(
        progressKept
          .filter((progress: SecurityUserErasureProgress): boolean => {
            return progress.toldAt !== null && progress.toldAt >= new Date(firstDone).toISOString();
          })
          .every((progress: SecurityUserErasureProgress): boolean => {
            return (progress.findings?.changed || 0) === 0;
          }),
      ).toBe(true);
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

      await runUntilChecked(
        filedAt.getTime() + SUPPRESSION_SETTLE_MS + 32 * 60 * 1000,
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
              namesToErase: null,
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
      expect(stored(request).namesToErase).toBeUndefined();
      expect(emailed).toBe(1);
      // Failed, but the vault still refuses the person.
      expect(filedTokens.get(PROJECT_ID.toString())?.has(ALICE_TOKEN)).toBe(
        true,
      );
    });

    /*
     * #11044: a person a grouped rule fired on. The rule wrote a Detection
     * Finding about them from the events the vault named them in, and a
     * correlation one, and one about Bob.
     */
    async function seedFindingsAboutPerson(): Promise<{
      byUser: string;
      correlation: string;
      bob: string;
    }> {
      const found: { byUser: string; correlation: string; bob: string } = {
        byUser: await writeRuleFindings({
          name: "Brute force",
          groups: [
            group({
              groupValue: ALICE,
              sampleObservables: [ALICE, ADDRESS],
            }),
          ],
        }),
        correlation: await writeRuleFindings({
          name: "Brute force then success",
          correlationType: SigmaCorrelationType.TemporalOrdered,
          groups: [
            group({
              groupValue: `${ALICE_IN_AUTH0} / ${ADDRESS}`,
              matchCount: 7,
              groupFields: [
                { field: "targetUser", value: ALICE_IN_AUTH0 },
                { field: "principalIp", value: ADDRESS },
              ],
              summary:
                "Failed sign-in, then Successful sign-in, 2 minutes apart",
              sampleObservables: [ALICE_IN_AUTH0, ADDRESS],
            }),
          ],
        }),
        bob: await writeRuleFindings({
          name: "Brute force",
          groups: [group({ groupValue: BOB, sampleObservables: [BOB] })],
        }),
      };

      await findingsWritten(3);

      return found;
    }

    test("a person a grouped rule fired on: their Detection Findings hold the token, counted with the events, and the request reads Erased once none names them", async () => {
      await seedPerson();

      const findings: { byUser: string; correlation: string; bob: string } =
        await seedFindingsAboutPerson();
      const filedAt: Date = new Date();
      const request: SecurityUserErasureRequest = fileRequest({
        user: ALICE_TYPED,
        requestedAt: filedAt,
      });

      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 1000),
      );

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.InProgress,
      );
      // Two events and two findings.
      expect(stored(request).eventsUnnamed).toBe(4);
      expect(stored(request).vaultEntriesDeleted).toBe(1);

      await mutationsApplied();
      await runUntilChecked(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000);

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );
      expect(stored(request).eventsUnnamed).toBe(4);

      const byUser: JSONObject = await findingOf(findings.byUser);

      expect(byUser["message"]).toBe(
        `Detection: Brute force — ${ALICE_TOKEN} (3 events)`,
      );
      expect(byUser["observables"]).toEqual([ALICE_TOKEN, ADDRESS]);
      // Its id carries the fingerprint of the token, as a rule firing on it makes (#11130).
      expect(String(byUser["eventUid"])).toMatch(
        new RegExp(
          `^detection:${findings.byUser}:detection-rule:${findings.byUser}:${DetectionFingerprint.of({ projectId: PROJECT_ID, kind: DetectionFingerprintKind.DetectionRule, value: ALICE_TOKEN })}:[0-9]+$`,
        ),
      );

      const correlation: JSONObject = await findingOf(findings.correlation);

      expect(correlation["message"]).toBe(
        `Detection: Brute force then success — auth0|${ALICE_TOKEN} / ${ADDRESS} (7 events; Failed sign-in, then Successful sign-in, 2 minutes apart)`,
      );
      expect(correlation["observables"]).toEqual([
        `auth0|${ALICE_TOKEN}`,
        ADDRESS,
      ]);
      expect(String(correlation["eventUid"])).toContain(
        `:${DetectionFingerprint.of({
          projectId: PROJECT_ID,
          kind: DetectionFingerprintKind.DetectionRule,
          value: `auth0|${ALICE_TOKEN} / ${ADDRESS}`,
        })}:`,
      );
      // The correlation's value, kept with the names before its finding changed, then handed to Postgres.
      expect(rewrittenFingerprints).toContainEqual([
        {
          named: `${ALICE_IN_AUTH0} / ${ADDRESS}`,
          hashed: `auth0|${ALICE_TOKEN} / ${ADDRESS}`,
        },
      ]);

      for (const finding of [byUser, correlation]) {
        expect(JSON.stringify(finding).toLowerCase()).not.toContain(
          ALICE.toLowerCase(),
        );
      }

      expect((await findingOf(findings.bob))["observables"]).toEqual([BOB]);
    });

    test("a request whose findings ClickHouse has not changed yet stays Erasing, though the vault and the events are done, until it has", async () => {
      await seedPerson();
      await seedFindingsAboutPerson();

      const filedAt: Date = new Date();
      const request: SecurityUserErasureRequest = fileRequest({
        user: ALICE,
        requestedAt: filedAt,
      });

      // The first run's change of the findings is lost on the way.
      const unnameFindings: ReturnType<typeof jest.spyOn> = jest
        .spyOn(SecurityUserErasureFindings, "unnameFindings")
        .mockResolvedValueOnce(0);

      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 1000),
      );
      await mutationsApplied();
      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000),
      );

      // The vault and the events are done; the findings still name the person.
      expect(await vaultUsersOf(PROJECT_ID)).toEqual([BOB]);
      expect((await eventOf("alice-1"))["principalUser"]).toBe(ALICE_TOKEN);
      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.InProgress,
      );

      // The final check, once the settle is over, finds them still naming the person, and changes them.
      const settled: number =
        filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000 + DETECTION_TURN_SETTLE_MS;

      await SecurityUserErasure.processOpenRequests(new Date(settled));
      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.InProgress,
      );
      expect(readErasureProgress(stored(request).progress).findings).toEqual(
        expect.objectContaining({ number: 2, isFinal: true, changed: 2 }),
      );

      // Another, once ClickHouse applied them: it finds nothing, and the request is done.
      await mutationsApplied();
      await SecurityUserErasure.processOpenRequests(
        new Date(settled + 60000),
      );

      expect(unnameFindings).toHaveBeenCalledTimes(2);
      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );
      expect(
        await anyFindingNamingOf({
          projectId: PROJECT_ID,
          names: ALICE_NAMES,
        }),
      ).toBe(false);
    });

    test("a finding a rule wrote after the run read them keeps the request Erasing until a later run takes the person out of it", async () => {
      await seedPerson();
      await seedFindingsAboutPerson();

      const filedAt: Date = new Date();
      const request: SecurityUserErasureRequest = fileRequest({
        user: ALICE,
        requestedAt: filedAt,
      });

      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 1000),
      );
      await mutationsApplied();

      // A rule that read the events before they lost the name writes its finding now.
      const late: string = await writeRuleFindings({
        name: "Impossible travel",
        groups: [group({ groupValue: ALICE, sampleObservables: [ALICE] })],
      });

      await findingsWritten(4);
      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000),
      );

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.InProgress,
      );

      // The final check finds it, and changes it: not done yet.
      const settled: number =
        filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000 + DETECTION_TURN_SETTLE_MS;

      await SecurityUserErasure.processOpenRequests(new Date(settled));
      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.InProgress,
      );

      await mutationsApplied();
      await SecurityUserErasure.processOpenRequests(
        new Date(settled + 60000),
      );

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );
      expect((await findingOf(late))["message"]).toBe(
        `Detection: Impossible travel — ${ALICE_TOKEN} (3 events)`,
      );
    });

    test("a request filed by its token keeps the names it found, so the check still finds a finding about them once the vault and the events are gone", async () => {
      await seedPerson();
      await seedFindingsAboutPerson();

      const filedAt: Date = new Date();
      const request: SecurityUserErasureRequest = fileRequest({
        user: ALICE_TOKEN,
        requestedAt: filedAt,
      });

      expect(request.userToErase).toBeUndefined();

      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 1000),
      );

      /*
       * Who the vault and the events named them as, kept on the request -
       * and the correlation's value its finding held, kept before the
       * finding was changed (#11130).
       */
      expect(
        readErasureRequestNames(stored(request))
          .map((name: ErasedName): string => {
            return `${name.named} -> ${name.hashed}`;
          })
          .sort(),
      ).toEqual(
        [
          `${ALICE} -> ${ALICE_TOKEN}`,
          `${ALICE_IN_AUTH0} -> auth0|${ALICE_TOKEN}`,
          `${ALICE_IN_AUTH0} / ${ADDRESS} -> auth0|${ALICE_TOKEN} / ${ADDRESS}`,
        ].sort(),
      );

      await mutationsApplied();

      // Nothing in ClickHouse holds the names any more but a late finding.
      expect(await vaultUsersOf(PROJECT_ID)).toEqual([BOB]);

      const late: string = await writeRuleFindings({
        name: "Token reuse",
        groups: [
          group({
            groupValue: ALICE_IN_AUTH0,
            sampleObservables: [ALICE_IN_AUTH0],
          }),
        ],
      });

      await findingsWritten(4);
      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000),
      );

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.InProgress,
      );

      const settled: number =
        filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000 + DETECTION_TURN_SETTLE_MS;

      await SecurityUserErasure.processOpenRequests(new Date(settled));
      await mutationsApplied();
      await SecurityUserErasure.processOpenRequests(
        new Date(settled + 60000),
      );

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );
      expect(stored(request).namesToErase).toBeUndefined();
      expect((await findingOf(late))["observables"]).toEqual([
        `auth0|${ALICE_TOKEN}`,
      ]);
    });

    test("nothing the worker sends ClickHouse names the person, and ClickHouse keeps nothing that does", async () => {
      await seedPerson();
      await seedFindingsAboutPerson();

      // Every statement from here on, as the client sends it.
      const sent: Array<string> = [];
      const capture: (params: unknown) => void = (params: unknown): void => {
        const statement: {
          query?: unknown;
          query_params?: unknown;
          table?: unknown;
        } = (params || {}) as {
          query?: unknown;
          query_params?: unknown;
          table?: unknown;
        };

        sent.push(
          `${String(statement.query ?? statement.table ?? "")} ${JSON.stringify(statement.query_params ?? {})}`,
        );
      };

      for (const method of ["query", "command", "exec", "insert"] as const) {
        const original: (params: never) => Promise<unknown> = (
          client[method] as unknown as (params: never) => Promise<unknown>
        ).bind(client);

        jest.spyOn(client, method).mockImplementation(((
          params: never,
        ): Promise<unknown> => {
          capture(params);
          return original(params);
        }) as never);
      }

      const windowStart: Date = new Date();
      const filedAt: Date = new Date();

      const request: SecurityUserErasureRequest = fileRequest({
        user: ALICE_TYPED,
        requestedAt: filedAt,
      });

      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 1000),
      );
      await mutationsApplied();
      await runUntilChecked(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000);

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );

      jest.restoreAllMocks();

      // Nor a fingerprint of them, keyed or not, of either source (#11130).
      const fingerprints: Array<string> = [
        ALICE,
        ALICE_TYPED,
        ALICE_IN_AUTH0,
        `${ALICE_IN_AUTH0} / ${ADDRESS}`,
      ].flatMap((value: string): Array<string> => {
        return [
          DetectionFingerprintKind.DetectionRule,
          DetectionFingerprintKind.ThreatIntel,
        ].flatMap((kind: DetectionFingerprintKind): Array<string> => {
          return DetectionFingerprint.allOf({
            projectId: PROJECT_ID,
            kind,
            value,
          });
        });
      });

      expect(
        sent.some((text: string): boolean => {
          return text.includes("eventUid = arrayStringConcat(");
        }),
      ).toBe(true);

      for (const text of sent) {
        for (const fingerprint of fingerprints) {
          expect(text).not.toContain(fingerprint);
        }
      }

      // The findings were read and changed, the events and the vault too.
      expect(
        sent.some((text: string): boolean => {
          return text.includes("findingTime");
        }),
      ).toBe(true);
      expect(
        sent.some((text: string): boolean => {
          return text.includes("UPDATE observables = arrayMap(");
        }),
      ).toBe(true);
      expect(
        sent.some((text: string): boolean => {
          return text.includes(" DELETE WHERE ");
        }),
      ).toBe(true);

      for (const text of sent) {
        expect(text.toLowerCase()).not.toContain("alice");
        expect(text.toLowerCase()).not.toContain("example.com");
      }

      // And ClickHouse's own record of what it was sent: its query log and its mutations.
      await client.command({ query: "SYSTEM FLUSH LOGS" });

      const logged: Array<JSONObject> = await rowsOf(
        `SELECT query FROM system.query_log WHERE event_time_microseconds >= fromUnixTimestamp64Micro(toInt64(${windowStart.getTime() * 1000})) AND has(databases, '${database}')`,
      );
      const mutations: Array<JSONObject> = await rowsOf(
        `SELECT command FROM system.mutations WHERE database = '${database}'`,
      );

      expect(logged.length).toBeGreaterThan(0);
      expect(mutations.length).toBeGreaterThan(0);

      for (const row of [...logged, ...mutations]) {
        const text: string = String(
          row["query"] ?? row["command"],
        ).toLowerCase();

        expect(text).not.toContain("alice");
        expect(text).not.toContain("example.com");

        for (const fingerprint of fingerprints) {
          expect(text).not.toContain(fingerprint);
        }
      }
    });

    /*
     * #11130 and #11160 end to end, on the real tables: a finding's id, a
     * project too large for one run, and what is left to confirm a guess by.
     */

    // A finding as a rule's scheduled run writes one, named by its firing.
    async function writeScheduledFinding(data: {
      groupValue: string;
      stretchStart: Date;
      groupFields?: Array<{ field: string; value: string }> | undefined;
    }): Promise<{ ruleId: string; eventUid: string }> {
      const rule: DetectionRule = ruleOf("Brute force, every five minutes");
      const firingOf: {
        projectId: ObjectID;
        stretchStart: Date;
        groupValue: string;
      } = {
        projectId: PROJECT_ID,
        stretchStart: data.stretchStart,
        groupValue: data.groupValue,
      };
      const findings: { eventUids: Map<string, string>; written: number } =
        await (
          DetectionRuleEvaluator as unknown as {
            writeDetectionFindings: (input: {
              rule: DetectionRule;
              parsedRule: SigmaRule;
              matchedGroups: Array<DetectionMatchGroup>;
              firing: {
                stretchStart: Date;
                mayRepeat: boolean;
              };
              firingKeys: Map<string, string>;
            }) => Promise<{ eventUids: Map<string, string>; written: number }>;
          }
        ).writeDetectionFindings({
          rule,
          parsedRule: parsedRuleOf("Brute force, every five minutes"),
          matchedGroups: [
            group({
              groupValue: data.groupValue,
              sampleObservables: [ALICE, ADDRESS],
              ...(data.groupFields ? { groupFields: data.groupFields } : {}),
            }),
          ],
          firing: { stretchStart: data.stretchStart, mayRepeat: false },
          firingKeys: new Map([
            [data.groupValue, getDetectionFiringKey(firingOf)],
          ]),
        });

      return {
        ruleId: rule.id!.toString(),
        eventUid: findings.eventUids.get(data.groupValue)!,
      };
    }

    test("a scheduled run's finding gets the id a rule firing on the token makes, and a stretch judged again finds it there (#11130)", async () => {
      await seedPerson();

      const stretchStart: Date = new Date("2026-11-26T10:00:00.000Z");
      const finding: { ruleId: string; eventUid: string } =
        await writeScheduledFinding({ groupValue: ALICE, stretchStart });

      await findingsWritten(1);

      // Written with the keyed fingerprint of the name, in both its places.
      const keyedName: string = DetectionFingerprint.of({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.DetectionRule,
        value: ALICE,
      });

      expect(finding.eventUid.split(":")).toEqual(
        expect.arrayContaining([keyedName]),
      );
      expect(finding.eventUid).not.toContain(
        DetectionFingerprint.legacyOf({
          kind: DetectionFingerprintKind.DetectionRule,
          value: ALICE,
        }),
      );

      const filedAt: Date = new Date();
      const request: SecurityUserErasureRequest = fileRequest({
        user: ALICE,
        requestedAt: filedAt,
      });

      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 1000),
      );
      await mutationsApplied();
      await runUntilChecked(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000);

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );

      // The id the rule makes for the same firing, grouped on the token now.
      const rule: DetectionRule = new DetectionRule();

      rule.id = new ObjectID(finding.ruleId);
      rule.projectId = PROJECT_ID;

      const expected: string = `detection:${finding.ruleId}:${DetectionRuleEvaluator.buildFingerprints(rule, ALICE_TOKEN).fingerprint}:${getDetectionFiringKey({ projectId: PROJECT_ID, stretchStart, groupValue: ALICE_TOKEN })}`;

      expect((await findingOf(finding.ruleId))["eventUid"]).toBe(expected);

      // And a stretch judged again finds it under that id, through the eventUid index.
      const found: Set<string> = await (
        DetectionRuleEvaluator as unknown as {
          readWrittenFindings: (input: {
            projectId: ObjectID;
            eventUids: Array<string>;
            writtenAfter: Date;
          }) => Promise<Set<string>>;
        }
      ).readWrittenFindings({
        projectId: PROJECT_ID,
        eventUids: [expected],
        writtenAfter: OneUptimeDate.addRemoveMinutes(new Date(), -60),
      });

      expect(Array.from(found)).toEqual([expected]);
    });

    test("a finding an earlier erasure un-named with its id as it was gets its id alone, and nothing else of it changes (#11130)", async () => {
      // As #11111 left one: the token everywhere, the unkeyed fingerprint of the name in its id.
      const unkeyed: string = DetectionFingerprint.legacyOf({
        kind: DetectionFingerprintKind.DetectionRule,
        value: ALICE,
      });
      const ruleId: string = ObjectID.generate().toString();
      const time: Date = OneUptimeDate.addRemoveMinutes(new Date(), -5);
      const attributes: Record<string, string> = {
        [DETECTION_GROUP_VALUE_ATTRIBUTE]: ALICE_TOKEN,
        [FINDING_USER_ERASED_ATTRIBUTE]: USER_ERASED_ON_REQUEST,
      };

      await client.insert({
        table: eventsTable,
        values: [
          {
            _id: ObjectID.generate().toString(),
            projectId: PROJECT_ID.toString(),
            primaryEntityId: SOURCE_ID.toString(),
            primaryEntityType: ServiceType.OpenTelemetry,
            time: OneUptimeDate.toClickhouseDateTime64(time),
            createdAt: OneUptimeDate.toClickhouseDateTime(time),
            eventUid: `detection:${ruleId}:detection-rule:${ruleId}:${unkeyed}:run:1764000000000:each:${unkeyed}`,
            classUid: DETECTION_FINDING_CLASS_UID,
            className: DETECTION_FINDING_CLASS_NAME,
            vendorName: "OneUptime",
            productName: "OneUptime Detections",
            ruleId,
            message: `Detection: Brute force — ${ALICE_TOKEN} (3 events)`,
            observables: [ALICE_TOKEN, ADDRESS],
            attributes,
            attributeKeys: Object.keys(attributes),
            retentionDate: OneUptimeDate.toClickhouseDateTime(
              OneUptimeDate.addRemoveDays(new Date(), 30),
            ),
          },
        ],
        format: "JSONEachRow",
        clickhouse_settings: { wait_for_async_insert: 1 },
      });

      const before: JSONObject = await findingOf(ruleId);

      const step: FindingsScanStep =
        await SecurityUserErasureFindings.scanFindings({
          projectId: PROJECT_ID,
          names: ALICE_NAMES,
          tokens: tokensIn(ALICE_NAMES),
          after: null,
          onProgress: async (): Promise<void> => {},
        });

      expect(step.changed).toBe(1);
      expect(step.unnamed).toBe(0);
      await mutationsApplied();

      const after: JSONObject = await findingOf(ruleId);
      const keyedToken: string = DetectionFingerprint.of({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.DetectionRule,
        value: ALICE_TOKEN,
      });

      expect(after["eventUid"]).toBe(
        `detection:${ruleId}:detection-rule:${ruleId}:${keyedToken}:run:1764000000000:each:${keyedToken}`,
      );
      expect({ ...after, eventUid: null }).toEqual({
        ...before,
        eventUid: null,
      });

      // Done: a read again changes nothing.
      expect(
        (
          await SecurityUserErasureFindings.scanFindings({
            projectId: PROJECT_ID,
            names: ALICE_NAMES,
            tokens: tokensIn(ALICE_NAMES),
            after: null,
            onProgress: async (): Promise<void> => {},
          })
        ).changed,
      ).toBe(0);
    });

    test("a project with more findings than one run reads is erased over several runs, each on from the last, and reads Erased only after a final pass (#11160)", async () => {
      await seedPerson();

      // 1,200 findings, a fifth of them about the person, spread over an hour.
      const rows: Array<JSONObject> = [];
      const start: number = Date.now() - 2 * 60 * 60 * 1000;

      for (let index: number = 0; index < 1200; index++) {
        const value: string = index % 5 === 0 ? ALICE : `user-${index}@example.org`;
        const fingerprint: string = DetectionFingerprint.of({
          projectId: PROJECT_ID,
          kind: DetectionFingerprintKind.DetectionRule,
          value,
        });
        const ruleId: string = `11160000-0000-4000-8000-${String(index).padStart(12, "0")}`;
        const time: Date = new Date(start + index * 3000);
        const attributes: Record<string, string> = {
          [DETECTION_GROUP_VALUE_ATTRIBUTE]: value,
          [DETECTION_RULE_NAME_ATTRIBUTE]: "Bulk",
        };

        rows.push({
          _id: ObjectID.generate().toString(),
          projectId: PROJECT_ID.toString(),
          primaryEntityId: SOURCE_ID.toString(),
          primaryEntityType: ServiceType.OpenTelemetry,
          time: OneUptimeDate.toClickhouseDateTime64(time),
          createdAt: OneUptimeDate.toClickhouseDateTime(time),
          eventUid: `detection:${ruleId}:detection-rule:${ruleId}:${fingerprint}:${time.getTime()}000000`,
          classUid: DETECTION_FINDING_CLASS_UID,
          className: DETECTION_FINDING_CLASS_NAME,
          vendorName: "OneUptime",
          productName: "OneUptime Detections",
          ruleId,
          message: `Detection: Bulk — ${value} (1 events)`,
          observables: [value, ADDRESS],
          attributes,
          attributeKeys: Object.keys(attributes),
          retentionDate: OneUptimeDate.toClickhouseDateTime(
            OneUptimeDate.addRemoveDays(new Date(), 30),
          ),
        });
      }

      await client.insert({
        table: eventsTable,
        values: rows,
        format: "JSONEachRow",
        clickhouse_settings: { wait_for_async_insert: 1 },
      });

      // A run reads 100 findings a page and changes at most 70: four runs a pass.
      const scan: typeof SecurityUserErasureFindings.scanFindings =
        SecurityUserErasureFindings.scanFindings.bind(
          SecurityUserErasureFindings,
        );
      const reads: Array<FindingsCursor | null> = [];

      jest
        .spyOn(SecurityUserErasureFindings, "scanFindings")
        .mockImplementation(
          (input: Parameters<typeof scan>[0]): ReturnType<typeof scan> => {
            reads.push(input.after);

            return scan({
              ...input,
              pageSize: 100,
              maxRewrites: 70,
              changesPerFlush: 50,
            });
          },
        );

      const filedAt: Date = new Date();
      const request: SecurityUserErasureRequest = fileRequest({
        user: ALICE,
        requestedAt: filedAt,
      });
      let at: number = filedAt.getTime() + SUPPRESSION_SETTLE_MS + 1000;

      await SecurityUserErasure.processOpenRequests(new Date(at));

      for (let run: number = 0; run < 6; run++) {
        await mutationsApplied();
        at += 60000;
        await SecurityUserErasure.processOpenRequests(new Date(at));
      }

      // 240 findings about the person, at most 70 a run: four runs read the first pass.
      expect(reads.length).toBeGreaterThanOrEqual(4);
      expect(reads[0]).toBeNull();
      // Each run went on from where the last one stopped, never from the first finding.
      for (let index: number = 1; index < 4; index++) {
        expect(reads[index]).not.toBeNull();
        expect(BigInt(reads[index]!.time)).toBeGreaterThan(
          BigInt(reads[index - 1]?.time || "0"),
        );
      }
      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.InProgress,
      );
      expect(stored(request).attempts).toBe(0);

      // The final check, once the settle is over, over as many runs as it takes.
      at += DETECTION_TURN_SETTLE_MS;

      for (
        let run: number = 0;
        run < 30 &&
        stored(request).status !== SecurityUserErasureRequestStatus.Completed;
        run++
      ) {
        await SecurityUserErasure.processOpenRequests(new Date(at));
        await mutationsApplied();
        at += 60000;
      }

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );
      expect(stored(request).attempts).toBe(0);
      // Two events and the 240 findings.
      expect(stored(request).eventsUnnamed).toBe(2 + 240);

      // Every finding about the person holds the token, with the token's fingerprint in its id.
      const keyedToken: string = DetectionFingerprint.of({
        projectId: PROJECT_ID,
        kind: DetectionFingerprintKind.DetectionRule,
        value: ALICE_TOKEN,
      });
      const left: Array<JSONObject> = await rowsOf(
        `SELECT toString(count()) AS c FROM ${eventsTable} WHERE className = '${DETECTION_FINDING_CLASS_NAME}' AND (has(observables, '${ALICE}') OR position(message, '${ALICE}') > 0)`,
      );
      const rekeyed: Array<JSONObject> = await rowsOf(
        `SELECT toString(count()) AS c FROM ${eventsTable} WHERE className = '${DETECTION_FINDING_CLASS_NAME}' AND has(observables, '${ALICE_TOKEN}') AND position(eventUid, ':${keyedToken}:') > 0`,
      );

      expect(Number(left[0]!["c"])).toBe(0);
      expect(Number(rekeyed[0]!["c"])).toBe(240);
      expect(await anyFindingNamingOf({ projectId: PROJECT_ID, names: ALICE_NAMES })).toBe(false);
    });

    test("a run its deadline stops in the middle of the findings keeps where it got to, counts no failure, and the next run goes on (#11160)", async () => {
      await seedPerson();

      for (let index: number = 0; index < 6; index++) {
        await writeRuleFindings({
          name: `Brute force ${index}`,
          groups: [group({ groupValue: ALICE, sampleObservables: [ALICE] })],
        });
      }

      await findingsWritten(6);

      const scan: typeof SecurityUserErasureFindings.scanFindings =
        SecurityUserErasureFindings.scanFindings.bind(
          SecurityUserErasureFindings,
        );
      const deadline: JobDeadline = new JobDeadline();
      const page: typeof SecurityUserErasureFindings.readFindingsPage =
        SecurityUserErasureFindings.readFindingsPage.bind(
          SecurityUserErasureFindings,
        );
      let pages: number = 0;

      jest
        .spyOn(SecurityUserErasureFindings, "scanFindings")
        .mockImplementation(
          (input: Parameters<typeof scan>[0]): ReturnType<typeof scan> => {
            return scan({ ...input, pageSize: 2 });
          },
        );
      jest
        .spyOn(SecurityUserErasureFindings, "readFindingsPage")
        .mockImplementation(
          (
            input: Parameters<typeof page>[0],
          ): ReturnType<typeof page> => {
            pages++;

            // The cron job's time runs out while the second page is read.
            if (pages === 2) {
              deadline.end();
            }

            return page(input);
          },
        );

      const filedAt: Date = new Date();
      const request: SecurityUserErasureRequest = fileRequest({
        user: ALICE,
        requestedAt: filedAt,
      });

      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 1000),
        deadline,
      );

      const stopped: SecurityUserErasureProgress = readErasureProgress(
        stored(request).progress,
      );

      // Four findings read and changed, two pages; the rest left for later.
      expect(stopped.findings?.changed).toBe(4);
      expect(stopped.findings?.endedAt).toBeNull();
      expect(stored(request).attempts).toBe(0);
      expect(stored(request).failureReason).toBeFalsy();

      await mutationsApplied();
      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000),
      );

      const went: SecurityUserErasureProgress = readErasureProgress(
        stored(request).progress,
      );

      expect(went.findings?.number).toBe(1);
      expect(went.findings?.changed).toBe(6);
      expect(went.findings?.endedAt).toBeTruthy();
    });

    test("nothing kept in ClickHouse lets a guessed identity be confirmed: no fingerprint of it, keyed or not, and not the name (#11130)", async () => {
      await seedPerson();
      await seedFindingsAboutPerson();
      await writeScheduledFinding({
        groupValue: ALICE,
        stretchStart: new Date("2026-11-26T10:00:00.000Z"),
      });
      await writeScheduledFinding({
        groupValue: `${ALICE} / ${ADDRESS}`,
        stretchStart: new Date("2026-11-26T10:05:00.000Z"),
        groupFields: [
          { field: "principalUser", value: ALICE },
          { field: "principalIp", value: ADDRESS },
        ],
      });
      await writeThreatIntelFinding();
      await findingsWritten(6);

      const guesses: Array<string> = [
        ALICE,
        ALICE_TYPED,
        ALICE.toUpperCase(),
        ALICE_IN_AUTH0,
        `${ALICE} / ${ADDRESS}`,
        `${ALICE_IN_AUTH0} / ${ADDRESS}`,
      ];
      const guessed: Array<string> = guesses.flatMap(
        (guess: string): Array<string> => {
          return [
            DetectionFingerprintKind.DetectionRule,
            DetectionFingerprintKind.ThreatIntel,
          ].flatMap((kind: DetectionFingerprintKind): Array<string> => {
            return DetectionFingerprint.allOf({
              projectId: PROJECT_ID,
              kind,
              value: guess,
            });
          });
        },
      );
      // Everything the project's events and findings hold, every column of every row.
      const everything: () => Promise<string> = async (): Promise<string> => {
        return JSON.stringify(
          await rowsOf(
            `SELECT * FROM ${eventsTable} WHERE projectId = '${PROJECT_ID.toString()}' ORDER BY _id`,
          ),
        );
      };

      // Before: a guess finds them.
      const before: string = await everything();

      expect(
        guessed.some((fingerprint: string): boolean => {
          return before.includes(fingerprint);
        }),
      ).toBe(true);

      const filedAt: Date = new Date();
      const request: SecurityUserErasureRequest = fileRequest({
        user: ALICE_TYPED,
        requestedAt: filedAt,
      });

      await SecurityUserErasure.processOpenRequests(
        new Date(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 1000),
      );
      await mutationsApplied();
      await runUntilChecked(filedAt.getTime() + SUPPRESSION_SETTLE_MS + 61000);

      expect(stored(request).status).toBe(
        SecurityUserErasureRequestStatus.Completed,
      );

      const after: string = await everything();

      for (const fingerprint of guessed) {
        expect(after).not.toContain(fingerprint);
      }

      expect(after.toLowerCase()).not.toContain(ALICE);

      // Somebody else is still found: only the person was taken out.
      expect(after).toContain(BOB);
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
