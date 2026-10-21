import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import ThreatIntelIndicator from "Common/Models/AnalyticsModels/ThreatIntelIndicator";
import ThreatIntelFeed from "Common/Models/DatabaseModels/ThreatIntelFeed";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "Common/Server/Utils/DataSource/HttpFetch";
import { GoogleSecOpsIocMatchesResult } from "Common/Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import { buildSecurityEventDbRow } from "Common/Server/Utils/SecurityEvent/SecurityEventRow";
import TaxiiClient, {
  TaxiiObjectsPage,
} from "Common/Server/Utils/SecurityEvent/ThreatIntel/TaxiiClient";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import ThreatIntelFeedType, {
  THREAT_INTEL_LIST_INDICATOR_ID,
} from "Common/Types/SecurityEvent/ThreatIntelFeedType";
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
 * Threat-intel list and Google SecOps feeds against a real ClickHouse.
 *
 * The Common suites pin the rows each source writes. This one shows what
 * the ThreatIntelIndicator table (ReplacingMergeTree on version, the
 * version-aware reads) makes of them: a list's values become active
 * indicators, a value dropped from the list stops being one at the next
 * write while another feed's claim on the same value stands, an unchanged
 * list keeps its indicators, and a Google SecOps indicator an analyst
 * mutes stops matching.
 *
 * It also runs the reads every feed shares, which aliased an aggregate
 * with the name of a column another aggregate read - refused by ClickHouse
 * as an aggregate inside an aggregate - so no TAXII feed ingested, nothing
 * was enriched and nothing matched: a TAXII update that drops a value
 * retracts it, and the matcher's join finds the events that carry an
 * active indicator.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/ThreatIntelSourcesClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
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

import ThreatIntelIndicatorService, {
  ActiveIndicator,
  IndicatorMatchGroup,
} from "Common/Server/Services/ThreatIntelIndicatorService";
import SecurityEventConnectionService from "Common/Server/Services/SecurityEventConnectionService";
import ThreatIntelListSource, {
  ListFeedPollResult,
} from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelListSource";
import GoogleSecOpsIndicatorSource, {
  GoogleSecOpsIocReader,
} from "Common/Server/Utils/SecurityEvent/ThreatIntel/GoogleSecOpsIndicatorSource";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import ThreatIntelFeedService from "Common/Server/Services/ThreatIntelFeedService";
import ThreatIntelFeedPoller from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelFeedPoller";
import ThreatIntelEnricher from "Common/Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `threat_intel_sources_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID(
  "78000000-0000-4000-8000-00000000000a",
);
const torFeedId: ObjectID = new ObjectID(
  "78000000-0000-4000-8000-0000000000f1",
);
const etFeedId: ObjectID = new ObjectID("78000000-0000-4000-8000-0000000000f2");
const secOpsFeedId: ObjectID = new ObjectID(
  "78000000-0000-4000-8000-0000000000f3",
);
const connectionId: ObjectID = new ObjectID(
  "78000000-0000-4000-8000-0000000000c1",
);
const taxiiFeedId: ObjectID = new ObjectID(
  "78000000-0000-4000-8000-0000000000f4",
);

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "Threat intel fixtures",
  primaryEntityId: new ObjectID("78000000-0000-4000-8000-0000000000e1"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

function securityEvent(data: {
  at: Date;
  observables: Array<string>;
  classUid?: number;
}): JSONObject {
  const normalized: NormalizedSecurityEvent = {
    time: data.at,
    eventUid: `fixture-${data.observables.join("-")}-${data.classUid || 4001}`,
    categoryUid: 4,
    categoryName: "Network Activity",
    classUid: data.classUid || 4001,
    className: "Network Activity",
    activityName: "Traffic",
    severityId: 1,
    severityName: "Informational",
    statusName: "Success",
    message: `connection to ${data.observables.join(", ")}`,
    vendorName: "Fixture",
    productName: "Fixture",
    ruleId: "",
    ruleName: "",
    mitreTactics: [],
    mitreTechniques: [],
    principalUser: "",
    principalHost: "",
    principalIp: "",
    principalProcess: "",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: 0,
    targetResource: "",
    observables: data.observables,
    attributes: {},
  };

  return buildSecurityEventDbRow({
    normalized,
    projectId,
    serviceMetadata: SERVICE_METADATA,
    retentionDays: 15,
  });
}

// Whole minutes, so every version is distinct and ordered.
const T0: Date = new Date(Math.floor(Date.now() / 60000) * 60000 - 3 * 3600000);

function listFeed(
  id: ObjectID,
  name: string,
  cursor?: string,
): ThreatIntelFeed {
  const feed: ThreatIntelFeed = new ThreatIntelFeed();
  feed._id = id.toString();
  feed.projectId = projectId;
  feed.name = name;
  feed.feedType = ThreatIntelFeedType.List;
  feed.listUrl = "https://lists.example.com/list.txt";
  feed.indicatorConfidence = 60;
  if (cursor) {
    feed.cursor = cursor;
  }
  return feed;
}

function serving(
  text: string,
): (request: DataSourceHttpRequest) => Promise<DataSourceHttpResponse> {
  return async (): Promise<DataSourceHttpResponse> => {
    return { statusCode: 200, bodyText: text, bodyJson: undefined };
  };
}

async function active(
  values: Array<string>,
  now: Date,
): Promise<Array<string>> {
  const found: Array<ActiveIndicator> =
    await ThreatIntelIndicatorService.findActiveIndicatorsByValues({
      projectId,
      values,
      now,
    });

  return found
    .map((indicator: ActiveIndicator): string => {
      const feed: string =
        indicator.feedId === torFeedId.toString()
          ? "tor"
          : indicator.feedId === etFeedId.toString()
            ? "et"
            : indicator.feedId === taxiiFeedId.toString()
              ? "taxii"
              : "secops";
      return `${feed}:${indicator.indicatorValue}`;
    })
    .sort();
}

integration("threat-intel sources against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase | undefined;
  let client: ClickhouseClient | undefined;
  let original: Partial<typeof ThreatIntelIndicatorService> | undefined;
  let originalEvents: Partial<typeof SecurityEventService> | undefined;
  const waitForAsyncInsert: string | undefined =
    process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"];

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

    const model: ThreatIntelIndicator = new ThreatIntelIndicator();
    const generator: StatementGenerator<ThreatIntelIndicator> =
      new StatementGenerator<ThreatIntelIndicator>({
        modelType: ThreatIntelIndicator,
        database: clickhouse,
      });
    const columns: Statement = generator.toColumnsCreateStatement(
      model.tableColumns,
    );

    await client.command({
      query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ReplacingMergeTree(version) PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
      query_params: columns.query_params,
    });

    // The matcher joins the project's security events: their table, in the same database.
    const eventModel: SecurityEvent = new SecurityEvent();
    const eventColumns: Statement = new StatementGenerator<SecurityEvent>({
      modelType: SecurityEvent,
      database: clickhouse,
    }).toColumnsCreateStatement(eventModel.tableColumns);

    await client.command({
      query: `CREATE TABLE ${database}.${eventModel.tableName} (${eventColumns.query}) ENGINE = MergeTree PARTITION BY (${eventModel.partitionKey}) ORDER BY (${eventModel.sortKeys.join(", ")})`,
      query_params: eventColumns.query_params,
    });

    originalEvents = {
      database: SecurityEventService.database,
      databaseClient: SecurityEventService.databaseClient,
      ingestDatabase: SecurityEventService.ingestDatabase,
      ingestDatabaseClient: SecurityEventService.ingestDatabaseClient,
    };

    SecurityEventService.database = clickhouse;
    SecurityEventService.databaseClient = client;
    SecurityEventService.ingestDatabase = clickhouse;
    SecurityEventService.ingestDatabaseClient = client;

    original = {
      database: ThreatIntelIndicatorService.database,
      databaseClient: ThreatIntelIndicatorService.databaseClient,
      ingestDatabase: ThreatIntelIndicatorService.ingestDatabase,
      ingestDatabaseClient: ThreatIntelIndicatorService.ingestDatabaseClient,
    };

    ThreatIntelIndicatorService.database = clickhouse;
    ThreatIntelIndicatorService.databaseClient = client;
    ThreatIntelIndicatorService.ingestDatabase = clickhouse;
    ThreatIntelIndicatorService.ingestDatabaseClient = client;

    // Each write is read straight after it: wait for ClickHouse to flush it.
    process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"] = "true";
  });

  afterAll(async (): Promise<void> => {
    if (waitForAsyncInsert === undefined) {
      delete process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"];
    } else {
      process.env["TELEMETRY_WAIT_FOR_ASYNC_INSERT"] = waitForAsyncInsert;
    }

    if (original) {
      Object.assign(ThreatIntelIndicatorService, original);
    }

    if (originalEvents) {
      Object.assign(SecurityEventService, originalEvents);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  let torCursor: string | undefined;

  test("a list's values become active indicators", async () => {
    const result: ListFeedPollResult = await ThreatIntelListSource.poll(
      listFeed(torFeedId, "Tor exit nodes"),
      {
        fetchImplementation: serving("192.0.2.1\n192.0.2.2\n"),
        now: T0,
      },
    );

    torCursor = result.cursor;

    await ThreatIntelListSource.poll(listFeed(etFeedId, "ET compromised"), {
      fetchImplementation: serving("192.0.2.1\n"),
      now: T0,
    });

    expect(await active(["192.0.2.1", "192.0.2.2", "192.0.2.3"], T0)).toEqual([
      "et:192.0.2.1",
      "tor:192.0.2.1",
      "tor:192.0.2.2",
    ]);
  });

  test("an unchanged list keeps its indicators without a write", async () => {
    const later: Date = OneUptimeDate.addRemoveHours(T0, 1);

    const result: ListFeedPollResult = await ThreatIntelListSource.poll(
      listFeed(torFeedId, "Tor exit nodes", torCursor),
      {
        fetchImplementation: serving("192.0.2.2\n192.0.2.1\n"),
        now: later,
      },
    );

    expect(result.unchanged).toBe(true);
    expect(await active(["192.0.2.1", "192.0.2.2"], later)).toEqual([
      "et:192.0.2.1",
      "tor:192.0.2.1",
      "tor:192.0.2.2",
    ]);
  });

  test("a value dropped from the list stops being one at once; another feed's claim on it stands", async () => {
    const later: Date = OneUptimeDate.addRemoveHours(T0, 2);

    const result: ListFeedPollResult = await ThreatIntelListSource.poll(
      listFeed(torFeedId, "Tor exit nodes", torCursor),
      {
        fetchImplementation: serving("192.0.2.2\n192.0.2.3\n"),
        now: later,
      },
    );

    expect(result).toMatchObject({ indicators: 2, letGo: 1 });
    expect(
      await active(["192.0.2.1", "192.0.2.2", "192.0.2.3"], later),
    ).toEqual(["et:192.0.2.1", "tor:192.0.2.2", "tor:192.0.2.3"]);

    const held: Array<{ indicatorValue: string }> =
      await ThreatIntelIndicatorService.findActiveValuesForFeed({
        projectId,
        feedId: torFeedId,
        stixId: THREAT_INTEL_LIST_INDICATOR_ID,
        now: later,
        limit: 100,
      });

    expect(
      held
        .map((value: { indicatorValue: string }): string => {
          return value.indicatorValue;
        })
        .sort(),
    ).toEqual(["192.0.2.2", "192.0.2.3"]);
  });

  test("a list's indicators lapse two days after the write that last saw them", async () => {
    const threeDaysOn: Date = OneUptimeDate.addRemoveDays(T0, 3);

    expect(await active(["192.0.2.2", "192.0.2.3"], threeDaysOn)).toEqual([]);
  });

  test("a Google SecOps indicator is active until an analyst mutes it", async () => {
    const connection: SecurityEventConnection = new SecurityEventConnection();
    connection._id = connectionId.toString();
    connection.projectId = projectId;
    connection.provider = SecurityEventConnectorProvider.GoogleSecOps;

    jest
      .spyOn(SecurityEventConnectionService, "findOneById")
      .mockResolvedValue(connection as never);
    jest
      .spyOn(SecurityEventConnectionService, "getConnectorSettings")
      .mockResolvedValue({
        provider: SecurityEventConnectorProvider.GoogleSecOps,
        config: {},
        secrets: {},
        alertingOnly: true,
      } as never);

    const feed: ThreatIntelFeed = new ThreatIntelFeed();
    feed._id = secOpsFeedId.toString();
    feed.projectId = projectId;
    feed.name = "Google SecOps IOCs";
    feed.feedType = ThreatIntelFeedType.GoogleSecOps;
    feed.securityEventConnectionId = connectionId;

    const reading: (match: JSONObject) => () => GoogleSecOpsIocReader = (
      match: JSONObject,
    ): (() => GoogleSecOpsIocReader) => {
      return (): GoogleSecOpsIocReader => {
        return {
          searchEnterpriseIocMatches:
            async (): Promise<GoogleSecOpsIocMatchesResult> => {
              return { matches: [match], moreDataAvailable: false };
            },
        };
      };
    };

    const match: JSONObject = {
      artifactIndicator: { domain: "C2.Evil.Example" },
      confidenceScore: 95,
      lastSeenTimestamp: T0.toISOString(),
    };

    await GoogleSecOpsIndicatorSource.poll(feed, {
      readerFactory: reading(match),
      now: T0,
    });

    expect(await active(["c2.evil.example"], T0)).toEqual([
      "secops:c2.evil.example",
    ]);

    const later: Date = OneUptimeDate.addRemoveHours(T0, 1);

    await GoogleSecOpsIndicatorSource.poll(feed, {
      readerFactory: reading({ ...match, iocState: "STATUS_MUTED" }),
      now: later,
    });

    expect(await active(["c2.evil.example"], later)).toEqual([]);

    jest.restoreAllMocks();
  });

  test("a TAXII update that drops a value retracts it, and the value it keeps stays active", async () => {
    jest
      .spyOn(ThreatIntelFeedService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ThreatIntelEnricher, "invalidateProjectCache")
      .mockImplementation((() => {
        return undefined;
      }) as never);

    const feed: ThreatIntelFeed = new ThreatIntelFeed();
    feed._id = taxiiFeedId.toString();
    feed.projectId = projectId;
    feed.name = "OpenCTI";
    feed.apiRootUrl = "https://taxii.example.com/api1/";
    feed.collectionId = "col-1";

    const serve: (objects: Array<JSONObject>) => TaxiiClient = (
      objects: Array<JSONObject>,
    ): TaxiiClient => {
      return {
        fetchIndicatorObjects: async (): Promise<TaxiiObjectsPage> => {
          return { objects, more: false, next: null, dateAddedLast: null };
        },
      } as unknown as TaxiiClient;
    };

    const indicator: JSONObject = {
      type: "indicator",
      id: "indicator--8e2e2d2b-17d4-4cbf-938f-98ee46b3cd3f",
      pattern:
        "[ipv4-addr:value = '198.51.100.7' OR ipv4-addr:value = '198.51.100.8']",
      pattern_type: "stix",
      created: OneUptimeDate.addRemoveDays(T0, -2).toISOString(),
      modified: OneUptimeDate.addRemoveDays(T0, -2).toISOString(),
      valid_from: OneUptimeDate.addRemoveDays(T0, -2).toISOString(),
      confidence: 80,
    };

    await ThreatIntelFeedPoller.pollFeed(feed, serve([indicator]));

    const now: Date = OneUptimeDate.getCurrentDate();

    expect(await active(["198.51.100.7", "198.51.100.8"], now)).toEqual([
      "taxii:198.51.100.7",
      "taxii:198.51.100.8",
    ]);

    await ThreatIntelFeedPoller.pollFeed(
      feed,
      serve([
        {
          ...indicator,
          pattern: "[ipv4-addr:value = '198.51.100.7']",
          modified: OneUptimeDate.addRemoveDays(T0, -1).toISOString(),
        },
      ]),
    );

    expect(await active(["198.51.100.7", "198.51.100.8"], now)).toEqual([
      "taxii:198.51.100.7",
    ]);

    jest.restoreAllMocks();
  });

  test("the matcher's join finds the events that carry an active indicator, and only those", async () => {
    const windowStart: Date = OneUptimeDate.addRemoveMinutes(T0, 125);
    const windowEnd: Date = OneUptimeDate.addRemoveMinutes(T0, 175);

    await SecurityEventService.insertJsonRows(
      [
        // Tor's 192.0.2.2 (active since the 2-hour write), twice.
        securityEvent({
          at: OneUptimeDate.addRemoveMinutes(T0, 130),
          observables: ["alice", "192.0.2.2"],
        }),
        securityEvent({
          at: OneUptimeDate.addRemoveMinutes(T0, 140),
          observables: ["bob", "192.0.2.2"],
        }),
        // 192.0.2.1 left the Tor list: not a Tor match any more.
        securityEvent({
          at: OneUptimeDate.addRemoveMinutes(T0, 135),
          observables: ["carol", "192.0.2.1"],
        }),
        // A finding is never matched, whatever it names.
        securityEvent({
          at: OneUptimeDate.addRemoveMinutes(T0, 150),
          observables: ["192.0.2.3"],
          classUid: 2004,
        }),
        // Outside the window.
        securityEvent({
          at: OneUptimeDate.addRemoveMinutes(T0, 100),
          observables: ["192.0.2.3"],
        }),
      ],
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );

    const groups: Array<IndicatorMatchGroup> =
      await ThreatIntelIndicatorService.findIndicatorMatches({
        projectId,
        feedId: torFeedId,
        startTime: windowStart,
        endTime: windowEnd,
        maxGroups: 10,
      });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      indicatorValue: "192.0.2.2",
      indicatorType: "ipv4-addr",
      stixId: THREAT_INTEL_LIST_INDICATOR_ID,
      confidence: 60,
      matchCount: 2,
    });
    expect(groups[0]!.sampleObservables).toEqual(
      expect.arrayContaining(["alice", "bob", "192.0.2.2"]),
    );

    const etGroups: Array<IndicatorMatchGroup> =
      await ThreatIntelIndicatorService.findIndicatorMatches({
        projectId,
        feedId: etFeedId,
        startTime: windowStart,
        endTime: windowEnd,
        maxGroups: 10,
      });

    // ET still lists 192.0.2.1.
    expect(
      etGroups.map((group: IndicatorMatchGroup): string => {
        return `${group.indicatorValue} x${group.matchCount}`;
      }),
    ).toEqual(["192.0.2.1 x1"]);
  });
});

describe("threat-intel sources ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
