import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import ThreatIntelIndicator from "Common/Models/AnalyticsModels/ThreatIntelIndicator";
import ThreatIntelFeed from "Common/Models/DatabaseModels/ThreatIntelFeed";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { ClickHouseSettings } from "Common/Server/Services/AnalyticsDatabaseService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsTableEngine from "Common/Types/AnalyticsDatabase/AnalyticsTableEngine";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import { DETECTION_FINDING_CLASS_UID } from "Common/Types/SecurityEvent/DetectionFindingConstants";
import {
  ENRICHMENT_INDICATOR_ID_ATTRIBUTE,
  ENRICHMENT_MATCHED_ATTRIBUTE,
  THREAT_INDICATOR_VALUE_ATTRIBUTE,
} from "Common/Types/SecurityEvent/ThreatIntelConstants";
import ServiceType from "Common/Types/Telemetry/ServiceType";
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
 * Threat intel against a real ClickHouse server, under its current
 * analyzer and the older one (issue #5157).
 *
 * Every threat intel read failed on every ClickHouse with
 * ILLEGAL_AGGREGATION: "Aggregate function max(confidence) AS confidence is
 * found inside another aggregate function" from the matcher and the
 * ingest-time enricher, "max(version) AS version ..." from the poller's
 * read of what a feed already stores. ClickHouse reads a name as the
 * SELECT's alias before the column of the same name, so each argMax read
 * the max() beside it. The poller failed before its first insert, so no
 * feed ever held an indicator, and the matcher logged the error every
 * minute. Every suite stubbed the database at the service boundary
 * (ThreatIntelIndicatorService.test.ts pins the statements as text), so
 * nothing went red.
 *
 * This suite runs the feature through its production paths against tables
 * built from the real models: the poller ingests a TAXII collection (a
 * fake TAXII server, the real parser, reconciliation and inserts) and then
 * an update that drops one of an indicator's values and revokes another
 * indicator; the matcher's join counts the events each still-active value
 * was seen in, skips findings, other projects and events outside the
 * window; the enricher stamps an event with its best active indicator; and
 * a whole matcher check writes its findings and then does not match them.
 * All of it twice: through a connection with the current analyzer, and
 * through one that sets enable_analyzer = 0 (or its older name). First,
 * the statements issue #5157 quotes are run as they were, to show this
 * server fails them under both analyzers - the suite would have caught it.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server,
 * credentials in the URL:
 *
 *   docker run -d --rm --name threat-intel-ch -p 18124:8123 \
 *     -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/ThreatIntel/ThreatIntelClickhouse.test.ts
 *
 * The suite creates and drops only its own uniquely named database. The
 * App Test workflow provides the server, and the guard at the bottom fails
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

import logger from "Common/Server/Utils/Logger";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import ThreatIntelFeedService from "Common/Server/Services/ThreatIntelFeedService";
import ThreatIntelIndicatorService, {
  ActiveIndicator,
  IndicatorMatchGroup,
  StoredIndicatorVersion,
} from "Common/Server/Services/ThreatIntelIndicatorService";
import ThreatIntelEnricher, {
  EnrichmentResult,
} from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import ThreatIntelFeedPoller, {
  FeedPollResult,
} from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelFeedPoller";
import ThreatIntelMatcher, {
  ThreatIntelMatchResult,
} from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelMatcher";
import TaxiiClient, {
  TaxiiObjectsPage,
} from "Common/Server/Utils/SecurityEvent/ThreatIntel/TaxiiClient";
import SecurityEntityRiskRecorder from "Common/Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import { SecurityRiskFinding } from "Common/Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskFindings";
import {
  SecurityEntity,
  SecurityEntityType,
} from "Common/Types/SecurityCase/SecurityEntity";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `threat_intel_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;

// The STIX objects' modified times: the poll's versions.
const FIRST_VERSION: string = "2026-09-01T00:00:00.000Z";
const SECOND_VERSION: string = "2026-09-02T00:00:00.000Z";

const STIX_IDS: {
  twoAddresses: string;
  domain: string;
  oneAddress: string;
  command: string;
} = {
  // Two addresses, until an update drops the first.
  twoAddresses: "indicator--8e2e2d2b-17d4-4cbf-938f-98ee46b3cd3f",
  // A domain, revoked by the update.
  domain: "indicator--1f8e7ab1-2e8b-4a0b-a3c2-4d5e6f708192",
  // The first of the two addresses again, from another STIX object.
  oneAddress: "indicator--c3d4e5f6-0718-4293-a4b5-c6d7e8f90a1b",
  // A command-and-control host, written in mixed case by the events.
  command: "indicator--d4e5f607-1829-43a4-b5c6-d7e8f90a1b2c",
};

const FIRST_ADDRESS: string = "198.51.100.7";
const SECOND_ADDRESS: string = "198.51.100.8";
const DOMAIN: string = "evil.example";
const COMMAND_HOST: string = "c2.example.net";

function stixIndicator(data: {
  id: string;
  pattern: string;
  modified: string;
  confidence: number;
  name: string;
  revoked?: boolean | undefined;
}): JSONObject {
  return {
    type: "indicator",
    spec_version: "2.1",
    id: data.id,
    pattern: data.pattern,
    pattern_type: "stix",
    created: FIRST_VERSION,
    modified: data.modified,
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: "2099-01-01T00:00:00.000Z",
    confidence: data.confidence,
    labels: ["malicious-activity"],
    name: data.name,
    revoked: data.revoked === true,
  };
}

const FIRST_PAGE: Array<JSONObject> = [
  stixIndicator({
    id: STIX_IDS.twoAddresses,
    pattern: `[ipv4-addr:value = '${FIRST_ADDRESS}'] OR [ipv4-addr:value = '${SECOND_ADDRESS}']`,
    modified: FIRST_VERSION,
    confidence: 60,
    name: "Scanner pair",
  }),
  stixIndicator({
    id: STIX_IDS.domain,
    pattern: `[domain-name:value = '${DOMAIN}']`,
    modified: FIRST_VERSION,
    confidence: 90,
    name: "Phishing domain",
  }),
  stixIndicator({
    id: STIX_IDS.oneAddress,
    pattern: `[ipv4-addr:value = '${FIRST_ADDRESS}']`,
    modified: FIRST_VERSION,
    confidence: 80,
    name: "Known C2 address",
  }),
  stixIndicator({
    id: STIX_IDS.command,
    pattern: `[domain-name:value = '${COMMAND_HOST}']`,
    modified: FIRST_VERSION,
    confidence: 70,
    name: "C2 host",
  }),
];

const SECOND_PAGE: Array<JSONObject> = [
  // The pair loses its first address: that value's identity is retracted.
  stixIndicator({
    id: STIX_IDS.twoAddresses,
    pattern: `[ipv4-addr:value = '${SECOND_ADDRESS}']`,
    modified: SECOND_VERSION,
    confidence: 65,
    name: "Scanner",
  }),
  stixIndicator({
    id: STIX_IDS.domain,
    pattern: `[domain-name:value = '${DOMAIN}']`,
    modified: SECOND_VERSION,
    confidence: 90,
    name: "Phishing domain",
    revoked: true,
  }),
];

// A TAXII server that serves one page.
function taxiiServing(objects: Array<JSONObject>): TaxiiClient {
  const page: TaxiiObjectsPage = {
    objects: objects,
    more: false,
    next: undefined,
    dateAddedLast: undefined,
  } as unknown as TaxiiObjectsPage;

  return {
    fetchIndicatorObjects: (): Promise<TaxiiObjectsPage> => {
      return Promise.resolve(page);
    },
  } as unknown as TaxiiClient;
}

function feedOf(projectId: ObjectID, feedId: ObjectID): ThreatIntelFeed {
  const feed: ThreatIntelFeed = new ThreatIntelFeed();
  feed._id = feedId.toString();
  feed.projectId = projectId;
  feed.name = "Corporate MISP";
  feed.apiRootUrl = "https://taxii.example.com/api1/";
  feed.collectionId = "91a7b528-80eb-42ed-a74d-c6fbd5a26116";
  feed.minimumConfidence = 0;
  feed.pollIntervalInMinutes = 60;
  return feed;
}

/*
 * The model's own columns, skip indexes and projections, under a plain
 * engine: production's Replicated* tables need a Keeper and a cluster a
 * disposable server does not have, and neither changes how a SELECT is
 * analysed. The indicator table keeps its ReplacingMergeTree(version).
 */
async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
      database: clickhouse,
    });
  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );
  const engine: string =
    model.tableEngine === AnalyticsTableEngine.ReplacingMergeTree
      ? "ReplacingMergeTree(version)"
      : "MergeTree";

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${engine} PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

interface Connection {
  name: string;
  database: ClickhouseDatabase;
  client: ClickhouseClient;
  // The analyzer setting this connection sends, when it sends one.
  olderAnalyzerSetting: string | null;
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

type ConnectableService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
};

const services: Array<ConnectableService> = [
  ThreatIntelIndicatorService as unknown as ConnectableService,
  SecurityEventService as unknown as ConnectableService,
];

function useConnection(connection: Connection): void {
  for (const service of services) {
    service.database = connection.database;
    service.databaseClient = connection.client;
    service.ingestDatabase = connection.database;
    service.ingestDatabaseClient = connection.client;
  }
}

async function readJson<T>(
  client: ClickhouseClient,
  query: string,
): Promise<Array<T>> {
  const result: { json: () => Promise<unknown> } = await client.query({
    query: query,
    format: "JSONEachRow",
  });

  return (await result.json()) as Array<T>;
}

// One raw security event row, as ingest stores it (the columns the queries read).
function eventRow(data: {
  projectId: ObjectID;
  time: Date;
  observables: Array<string>;
  message: string;
  classUid?: number | undefined;
}): JSONObject {
  return {
    _id: ObjectID.generate().toString(),
    projectId: data.projectId.toString(),
    primaryEntityId: ObjectID.generate().toString(),
    primaryEntityType: ServiceType.OpenTelemetry,
    time: OneUptimeDate.toClickhouseDateTime64(data.time),
    createdAt: OneUptimeDate.toClickhouseDateTime(data.time),
    eventUid: ObjectID.generate().toString(),
    classUid: data.classUid ?? 4001,
    className: "Network Activity",
    message: data.message,
    observables: data.observables,
    retentionDate: OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(OneUptimeDate.getCurrentDate(), 30),
    ),
  };
}

function serviceMetadata(): TelemetryServiceMetadata {
  return {
    serviceName: "OneUptime Threat Intel",
    primaryEntityId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  } as unknown as TelemetryServiceMetadata;
}

integration("threat intel against ClickHouse (issue #5157)", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let options: ClickHouseClientConfigOptions;
  const connections: Array<Connection> = [];
  const originals: Array<ServiceConnection> = [];
  const waitForAsyncInsert: string | undefined =
    process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"];

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    options = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 120000,
    };

    clickhouse = new ClickhouseDatabase(options);
    // connect() creates the database before opening the pool on it.
    client = await clickhouse.connect(options);

    await createTable(client, clickhouse, ThreatIntelIndicator);
    await createTable(client, clickhouse, SecurityEvent);

    connections.push({
      name: "the current analyzer",
      database: clickhouse,
      client: client,
      olderAnalyzerSetting: null,
    });

    // The analyzer setting this server knows, under either of its names.
    const [setting] = await readJson<{ name: string }>(
      client,
      "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
    );

    if (setting) {
      const olderOptions: ClickHouseClientConfigOptions = {
        ...options,
        clickhouse_settings: { [setting.name]: 0 } as ClickHouseSettings,
      };
      const olderDatabase: ClickhouseDatabase = new ClickhouseDatabase(
        olderOptions,
      );
      const olderClient: ClickhouseClient =
        await olderDatabase.connect(olderOptions);

      connections.push({
        name: "the older analyzer",
        database: olderDatabase,
        client: olderClient,
        olderAnalyzerSetting: setting.name,
      });
    }

    for (const service of services) {
      originals.push({
        database: service.database,
        databaseClient: service.databaseClient,
        ingestDatabase: service.ingestDatabase,
        ingestDatabaseClient: service.ingestDatabaseClient,
      });
    }

    // Inserts are acknowledged once they are readable, as the reads expect.
    process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"] = "true";

    // Postgres: the feed row's bookkeeping and the findings' service.
    jest
      .spyOn(ThreatIntelFeedService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OTelIngestService, "telemetryServiceFromName")
      .mockResolvedValue(serviceMetadata() as never);
    /*
     * Postgres and Redis: entity risk, which locks the project in Redis
     * before it writes the risk rows. What a check hands it is pinned by
     * the matcher check below.
     */
    jest
      .spyOn(SecurityEntityRiskRecorder, "record")
      .mockResolvedValue({ entitiesUpdated: 0, riskCasesRaised: 0 } as never);
  });

  afterAll(async (): Promise<void> => {
    jest.restoreAllMocks();

    services.forEach((service: ConnectableService, index: number): void => {
      if (originals[index]) {
        Object.assign(service, originals[index]);
      }
    });

    if (waitForAsyncInsert === undefined) {
      delete process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"];
    } else {
      process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"] = waitForAsyncInsert;
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    for (const connection of connections) {
      await connection.database.disconnect();
    }
  });

  test("the server knows the older analyzer, so both are run", () => {
    expect(
      connections.map((connection: Connection): string => {
        return connection.name;
      }),
    ).toEqual(["the current analyzer", "the older analyzer"]);
  });

  test("the connections read with the analyzer they are named for", async () => {
    for (const connection of connections) {
      if (!connection.olderAnalyzerSetting) {
        continue;
      }

      const [row] = await readJson<{ analyzer: string | number }>(
        connection.client,
        `SELECT toUInt8(getSetting('${connection.olderAnalyzerSetting}')) AS analyzer`,
      );

      expect(Number(row!.analyzer)).toBe(0);
    }
  });

  test("the statements issue #5157 quotes fail on this server under both analyzers", async () => {
    const versionsAsTheyWere: string = `SELECT stixId, indicatorValue, argMax(indicatorType, version) AS indicatorType, argMax(indicatorName, version) AS indicatorName, argMax(confidence, version) AS confidence, max(version) AS version, argMax(validFrom, version) AS validFrom, argMax(validUntil, version) AS validUntil, max(retentionDate) AS retentionDate FROM ${database}.ThreatIntelIndicatorItemV1 GROUP BY stixId, indicatorValue`;
    const collapseAsItWas: string = `SELECT indicatorValue, argMax(stixId, confidence) AS stixId, argMax(indicatorType, confidence) AS indicatorType, argMax(indicatorName, confidence) AS indicatorName, max(confidence) AS confidence FROM (SELECT indicatorValue, stixId, argMax(feedName, version) AS feedName, argMax(indicatorType, version) AS indicatorType, argMax(indicatorName, version) AS indicatorName, argMax(confidence, version) AS confidence, argMax(revoked, version) AS revokedLatest FROM ${database}.ThreatIntelIndicatorItemV1 GROUP BY indicatorValue, stixId HAVING revokedLatest = false) GROUP BY indicatorValue`;

    for (const connection of connections) {
      for (const query of [versionsAsTheyWere, collapseAsItWas]) {
        await expect(
          readJson<JSONObject>(connection.client, query),
        ).rejects.toThrow("is found inside another aggregate function");
      }
    }
  });

  describe.each([
    ["the current analyzer", 0],
    ["the older analyzer (enable_analyzer = 0)", 1],
  ])("through %s", (_name: string, position: number) => {
    // A project and a feed of its own, so the two runs never read each other's rows.
    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const feedId: ObjectID = ObjectID.generate();
    let connection: Connection;

    beforeAll(() => {
      connection = connections[position]!;
      useConnection(connection);
      ThreatIntelEnricher.clearCaches();
      jest.mocked(logger.error).mockClear();
    });

    test("the poller stores a collection, then retracts the value an update drops", async () => {
      const first: FeedPollResult = await ThreatIntelFeedPoller.pollFeed(
        feedOf(projectId, feedId),
        taxiiServing(FIRST_PAGE),
      );

      // Five values from four objects: the pair holds two.
      expect(first.indicatorRowsIngested).toBe(5);
      expect(first.valuesRetracted).toBe(0);

      const second: FeedPollResult = await ThreatIntelFeedPoller.pollFeed(
        feedOf(projectId, feedId),
        taxiiServing(SECOND_PAGE),
      );

      /*
       * Reading what the feed stores is the statement that failed first:
       * the pair's dropped address is found and a tombstone written for
       * it, beside the pair's new version and the domain's revocation.
       */
      expect(second.valuesRetracted).toBe(1);
      expect(second.indicatorRowsIngested).toBe(2);
      expect(logger.error).not.toHaveBeenCalled();
    });

    test("the latest stored version of each identity reads back", async () => {
      const stored: Array<StoredIndicatorVersion> =
        await ThreatIntelIndicatorService.findLatestVersionsByStixIds({
          projectId: projectId,
          feedId: feedId,
          stixIds: [
            STIX_IDS.twoAddresses,
            STIX_IDS.domain,
            STIX_IDS.oneAddress,
          ],
        });

      const byIdentity: Map<string, StoredIndicatorVersion> = new Map(
        stored.map(
          (
            version: StoredIndicatorVersion,
          ): [string, StoredIndicatorVersion] => {
            return [`${version.stixId} ${version.indicatorValue}`, version];
          },
        ),
      );

      expect(byIdentity.size).toBe(4);

      const dropped: StoredIndicatorVersion = byIdentity.get(
        `${STIX_IDS.twoAddresses} ${FIRST_ADDRESS}`,
      )!;
      const kept: StoredIndicatorVersion = byIdentity.get(
        `${STIX_IDS.twoAddresses} ${SECOND_ADDRESS}`,
      )!;
      const other: StoredIndicatorVersion = byIdentity.get(
        `${STIX_IDS.oneAddress} ${FIRST_ADDRESS}`,
      )!;

      // The tombstone carries the update's version; the kept value its new name and confidence.
      expect(dropped.version).toBe(new Date(SECOND_VERSION).getTime());
      expect(kept.version).toBe(new Date(SECOND_VERSION).getTime());
      expect(kept.confidence).toBe(65);
      expect(kept.indicatorName).toBe("Scanner");
      expect(kept.indicatorType).toBe("ipv4-addr");
      expect(other.version).toBe(new Date(FIRST_VERSION).getTime());
      expect(other.confidence).toBe(80);
      expect(other.validFrom.startsWith("2026-01-01 00:00:00")).toBe(true);
      expect(other.validUntil.startsWith("2099-01-01 00:00:00")).toBe(true);
      expect(other.retentionDate.startsWith("2099-01-02")).toBe(true);
    });

    test("the matcher counts the events each active value was seen in", async () => {
      const now: Date = OneUptimeDate.getCurrentDate();
      const inWindow: Date = new Date(now.getTime() - 5 * MINUTE);

      await connection.client.insert({
        table: `${database}.${new SecurityEvent().tableName}`,
        format: "JSONEachRow",
        values: [
          // The first address: only the other object still claims it.
          eventRow({
            projectId,
            time: inWindow,
            observables: [FIRST_ADDRESS, "web-01"],
            message: "outbound to the first address",
          }),
          // The second address, twice: the pair's new version.
          eventRow({
            projectId,
            time: inWindow,
            observables: [SECOND_ADDRESS],
            message: "scan from the second address",
          }),
          eventRow({
            projectId,
            time: inWindow,
            observables: [SECOND_ADDRESS, "db-01"],
            message: "scan from the second address again",
          }),
          // Written in capitals: matched all the same.
          eventRow({
            projectId,
            time: inWindow,
            observables: ["C2.Example.NET"],
            message: "beacon to the C2 host",
          }),
          // The revoked domain: no match.
          eventRow({
            projectId,
            time: inWindow,
            observables: [DOMAIN],
            message: "visit to the phishing domain",
          }),
          // A finding is never matched.
          eventRow({
            projectId,
            time: inWindow,
            observables: [SECOND_ADDRESS],
            message: "a finding about the second address",
            classUid: DETECTION_FINDING_CLASS_UID,
          }),
          // Another project's event, and one before the window.
          eventRow({
            projectId: otherProjectId,
            time: inWindow,
            observables: [SECOND_ADDRESS],
            message: "another project",
          }),
          eventRow({
            projectId,
            time: new Date(now.getTime() - 120 * MINUTE),
            observables: [SECOND_ADDRESS],
            message: "before the window",
          }),
        ],
        clickhouse_settings: { wait_for_async_insert: 1 },
      });

      const matches: Array<IndicatorMatchGroup> =
        await ThreatIntelIndicatorService.findIndicatorMatches({
          projectId,
          feedId,
          startTime: new Date(now.getTime() - 30 * MINUTE),
          endTime: now,
          maxGroups: 100,
        });

      // The busiest value first; values seen as often come back in either order.
      expect(matches[0]?.indicatorValue).toBe(SECOND_ADDRESS);
      expect(
        matches
          .map((match: IndicatorMatchGroup): string => {
            return `${match.indicatorValue} seen ${match.matchCount} times: ${match.stixId} (${match.indicatorType}, ${match.confidence})`;
          })
          .sort(),
      ).toEqual(
        [
          `${SECOND_ADDRESS} seen 2 times: ${STIX_IDS.twoAddresses} (ipv4-addr, 65)`,
          `${FIRST_ADDRESS} seen 1 times: ${STIX_IDS.oneAddress} (ipv4-addr, 80)`,
          `${COMMAND_HOST} seen 1 times: ${STIX_IDS.command} (domain-name, 70)`,
        ].sort(),
      );

      const firstAddress: IndicatorMatchGroup = matches.find(
        (match: IndicatorMatchGroup): boolean => {
          return match.indicatorValue === FIRST_ADDRESS;
        },
      )!;

      expect(firstAddress.indicatorName).toBe("Known C2 address");
      expect(firstAddress.sampleMessage).toBe("outbound to the first address");
      expect(firstAddress.sampleObservables.sort()).toEqual(
        [FIRST_ADDRESS, "web-01"].sort(),
      );
    });

    test("the enricher stamps an event with its best active indicator", async () => {
      const active: Array<ActiveIndicator> =
        await ThreatIntelIndicatorService.findActiveIndicatorsByValues({
          projectId,
          values: [
            FIRST_ADDRESS,
            SECOND_ADDRESS,
            DOMAIN,
            COMMAND_HOST,
            "203.0.113.200",
          ],
          now: OneUptimeDate.getCurrentDate(),
        });

      expect(
        active
          .map((indicator: ActiveIndicator): string => {
            return `${indicator.indicatorValue} ${indicator.stixId} ${indicator.confidence} ${indicator.feedName} ${indicator.indicatorName}`;
          })
          .sort(),
      ).toEqual(
        [
          `${FIRST_ADDRESS} ${STIX_IDS.oneAddress} 80 Corporate MISP Known C2 address`,
          `${SECOND_ADDRESS} ${STIX_IDS.twoAddresses} 65 Corporate MISP Scanner`,
          `${COMMAND_HOST} ${STIX_IDS.command} 70 Corporate MISP C2 host`,
        ].sort(),
      );
      expect(
        active.every((indicator: ActiveIndicator): boolean => {
          return indicator.feedId === feedId.toString();
        }),
      ).toBe(true);

      const events: Array<NormalizedSecurityEvent> = [
        { observables: ["web-01", FIRST_ADDRESS], attributes: {} },
        { observables: [DOMAIN], attributes: {} },
      ] as unknown as Array<NormalizedSecurityEvent>;

      const enriched: EnrichmentResult =
        await ThreatIntelEnricher.enrichNormalizedEvents({
          projectId,
          events,
        });

      expect(enriched.eventsMatched).toBe(1);
      expect(events[0]!.attributes[ENRICHMENT_MATCHED_ATTRIBUTE]).toBe("true");
      expect(events[0]!.attributes[ENRICHMENT_INDICATOR_ID_ATTRIBUTE]).toBe(
        STIX_IDS.oneAddress,
      );
      expect(
        events[1]!.attributes[ENRICHMENT_MATCHED_ATTRIBUTE],
      ).toBeUndefined();
      expect(logger.error).not.toHaveBeenCalled();
    });

    test("a matcher check records its findings, and the next check does not match them", async () => {
      const feed: ThreatIntelFeed = feedOf(projectId, feedId);
      feed.shouldCreateAlert = false;
      feed.shouldCreateIncident = false;
      feed.shouldCreateCase = false;
      feed.shouldWriteDetectionFinding = true;
      feed.lastEvaluatedAt = new Date(
        OneUptimeDate.getCurrentDate().getTime() - 30 * MINUTE,
      );

      const updates: Array<JSONObject> = [];
      jest
        .spyOn(ThreatIntelFeedService, "updateOneById")
        .mockImplementation(((update: { data: JSONObject }) => {
          updates.push(update.data);
          return Promise.resolve(undefined);
        }) as never);

      const risks: Array<Array<SecurityRiskFinding>> = [];
      jest.spyOn(SecurityEntityRiskRecorder, "record").mockImplementation(((
        findings: Array<SecurityRiskFinding>,
      ) => {
        risks.push(findings);
        return Promise.resolve({
          entitiesUpdated: findings.length,
          riskCasesRaised: 0,
        });
      }) as never);

      const checked: ThreatIntelMatchResult =
        await ThreatIntelMatcher.evaluateFeed(feed);

      expect(checked.matchedIndicators).toBe(3);
      expect(checked.totalMatches).toBe(4);
      expect(checked.findingsWritten).toBe(3);
      // The feed's row says the check ran and found something, with no error.
      expect(updates).toHaveLength(1);
      expect(updates[0]!["lastMatchError"]).toBeNull();
      expect(updates[0]!["lastMatchAt"]).toBeInstanceOf(Date);

      const findings: Array<{ value: string }> = await readJson<{
        value: string;
      }>(
        connection.client,
        `SELECT attributes['${THREAT_INDICATOR_VALUE_ATTRIBUTE}'] AS value FROM ${database}.${new SecurityEvent().tableName} WHERE projectId = '${projectId.toString()}' AND classUid = ${DETECTION_FINDING_CLASS_UID} AND productName = 'OneUptime Threat Intel' ORDER BY value`,
      );

      expect(
        findings.map((finding: { value: string }): string => {
          return finding.value;
        }),
      ).toEqual([FIRST_ADDRESS, SECOND_ADDRESS, COMMAND_HOST].sort());

      // Each address the check matched adds to its own risk; the domain adds none.
      expect(risks).toHaveLength(1);
      expect(
        risks[0]!
          .map(
            (
              finding: SecurityRiskFinding,
            ): {
              projectId: string;
              feedId: string | undefined;
              entities: Array<SecurityEntity>;
            } => {
              return {
                projectId: finding.projectId.toString(),
                feedId: finding.threatIntelFeedId?.toString(),
                entities: finding.entities,
              };
            },
          )
          .sort(
            (
              a: { entities: Array<SecurityEntity> },
              b: { entities: Array<SecurityEntity> },
            ): number => {
              return a.entities[0]!.value.localeCompare(b.entities[0]!.value);
            },
          ),
      ).toEqual(
        [FIRST_ADDRESS, SECOND_ADDRESS].sort().map((address: string) => {
          return {
            projectId: projectId.toString(),
            feedId: feedId.toString(),
            entities: [{ type: SecurityEntityType.IpAddress, value: address }],
          };
        }),
      );

      // The next window holds only the findings: nothing is matched again.
      feed.lastEvaluatedAt = updates[0]!["lastEvaluatedAt"] as Date;
      updates.length = 0;

      const next: ThreatIntelMatchResult =
        await ThreatIntelMatcher.evaluateFeed(feed);

      expect(next.matchedIndicators).toBe(0);
      expect(next.findingsWritten).toBe(0);
      expect(updates[0]!["lastMatchError"]).toBeNull();
      // Nor is any risk added again.
      expect(risks).toHaveLength(1);
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});

describe("threat intel ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
