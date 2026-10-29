import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import ThreatIntelIndicator from "Common/Models/AnalyticsModels/ThreatIntelIndicator";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { buildIndicatorRow } from "Common/Server/Utils/SecurityEvent/ThreatIntel/IndicatorRows";
import { buildSecurityEventDbRow } from "Common/Server/Utils/SecurityEvent/SecurityEventRow";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { SecurityEntityType } from "Common/Types/SecurityCase/SecurityEntity";
import { DetectionRetrohuntResult } from "Common/Types/SecurityEvent/DetectionRetrohunt";
import NormalizedSecurityEvent from "Common/Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import {
  SECURITY_WATCHLIST_VALUES_MAX,
  SigmaWatchlist,
  SigmaWatchlists,
  getSecurityWatchlistFeedIndicatorTypes,
  getSecurityWatchlistNameKey,
  splitSecurityWatchlistValues,
} from "Common/Types/SecurityEvent/SecurityWatchlist";
import { DetectionRuleDefinition } from "Common/Types/SecurityEvent/SigmaCorrelation";
import { ThreatIntelIndicatorType } from "Common/Types/SecurityEvent/ThreatIntelConstants";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import SigmaRuleSetParser from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { bindSigmaWatchlists } from "Common/Utils/SecurityEvent/Sigma/SigmaWatchlists";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * Watchlists against a real ClickHouse server.
 *
 * Common's SecurityWatchlistMatch, SigmaClickhouseCompiler and
 * SecurityWatchlists suites pin the statements a rule that reads a
 * watchlist compiles to; this one shows what ClickHouse makes of them, on
 * events built by the row builder ingest uses and indicators built by the
 * one every threat intel source uses:
 *
 *   - a list kept by hand matches its values whatever the case, its
 *     patterns with *, and - in an IP address list - its ranges, IPv4 and
 *     IPv6, over events whose address is empty without failing the read;
 *   - `not` reads a list as an allow list, and an empty list holds nothing;
 *   - a field that holds several values (observables) matches when any of
 *     them is on the list;
 *   - a list that follows a threat intel feed holds exactly the feed's
 *     active indicators of its kind: not an expired or revoked one, not
 *     another feed's, not another project's;
 *   - a list as long as a list may be is one read ClickHouse takes, its
 *     values sent in parameters ClickHouse accepts;
 *   - Run on Past Events binds the lists a rule names, for a single rule
 *     and a correlation alike;
 *   - another project's events are never read.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/SecurityWatchlistsClickhouse.test.ts
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

import SecurityEventService, {
  DetectionMatchGroup,
} from "Common/Server/Services/SecurityEventService";
import DetectionRuleExceptionService from "Common/Server/Services/DetectionRuleExceptionService";
import ThreatIntelIndicatorService from "Common/Server/Services/ThreatIntelIndicatorService";
import DetectionRuleRetrohunt from "Common/Server/Utils/SecurityEvent/DetectionRuleRetrohunt";
import SigmaClickhouseCompiler from "Common/Server/Utils/SecurityEvent/Sigma/SigmaClickhouseCompiler";
import SecurityWatchlists from "Common/Server/Utils/SecurityEvent/Watchlists/SecurityWatchlists";
import {
  assertDetectionReadFits,
  getStatementParameterUrlBytes,
} from "Common/Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistMatch";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `security_watchlists_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

// One clock for every fixture and read: six whole hours ago, on an hour.
const NOW: Date = new Date(Math.floor(Date.now() / HOUR) * HOUR);
const BASE: Date = new Date(NOW.getTime() - 6 * HOUR);

const projectId: ObjectID = new ObjectID(
  "89000000-0000-4000-8000-00000000000a",
);
const otherProjectId: ObjectID = new ObjectID(
  "89000000-0000-4000-8000-00000000000b",
);
const FEED_ID: ObjectID = new ObjectID("89000000-0000-4000-8000-0000000000f1");
const OTHER_FEED_ID: ObjectID = new ObjectID(
  "89000000-0000-4000-8000-0000000000f2",
);
const RULE_ID: ObjectID = new ObjectID("89000000-0000-4000-8000-00000000000d");

const SERVICE_METADATA: TelemetryServiceMetadata = {
  serviceName: "Watchlist fixtures",
  primaryEntityId: new ObjectID("89000000-0000-4000-8000-00000000000c"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

interface EventFixture {
  // Each event's message names it: what the reads below list.
  name: string;
  // Minutes from BASE.
  at: number;
  user?: string;
  host?: string;
  sourceIp?: string;
  observables?: Array<string>;
  attributes?: JSONObject;
  project?: ObjectID;
}

function event(fixture: EventFixture): JSONObject {
  const normalized: NormalizedSecurityEvent = {
    time: new Date(BASE.getTime() + fixture.at * MINUTE),
    eventUid: `watchlist-fixture-${fixture.name}`,
    categoryUid: 3,
    categoryName: "Identity & Access Management",
    classUid: 3002,
    className: "Authentication",
    activityName: "Logon",
    severityId: 1,
    severityName: OcsfSeverity.Informational,
    statusName: "Success",
    message: fixture.name,
    vendorName: "Fixture",
    productName: "Fixture",
    ruleId: "",
    ruleName: "",
    mitreTactics: [],
    mitreTechniques: [],
    principalUser: fixture.user || "",
    principalHost: fixture.host || "",
    principalIp: fixture.sourceIp || "",
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
    observables: fixture.observables || [],
    attributes: fixture.attributes || {},
  };

  return buildSecurityEventDbRow({
    normalized,
    projectId: fixture.project || projectId,
    serviceMetadata: SERVICE_METADATA,
    retentionDays: 15,
  });
}

const FIXTURES: Array<EventFixture> = [
  {
    name: "alice-office",
    at: 10,
    user: "Alice@Example.com",
    sourceIp: "10.20.5.5",
  },
  {
    name: "alice-outside",
    at: 20,
    user: "alice@example.com",
    sourceIp: "203.0.113.9",
  },
  {
    name: "bob-outside",
    at: 30,
    user: "bob@example.com",
    sourceIp: "203.0.113.10",
  },
  {
    name: "svc-backup",
    at: 40,
    user: "svc-backup",
    host: "db-01.corp.example.com",
    sourceIp: "192.0.2.44",
  },
  { name: "svc-deploy", at: 50, user: "SVC-Deploy", sourceIp: "2001:db8::1" },
  // No user and no address: '' in every typed column.
  {
    name: "no-user",
    at: 60,
    observables: ["EVIL.example.net", "1.2.3.4"],
  },
  {
    name: "good-domain",
    at: 70,
    user: "carol@example.com",
    sourceIp: "198.51.100.1",
    observables: ["good.example.org"],
  },
  {
    name: "hash",
    at: 80,
    user: "dave@example.com",
    observables: ["D41D8CD98F00B204E9800998ECF8427E"],
    attributes: { "file.hash.md5": "D41D8CD98F00B204E9800998ECF8427E" },
  },
  { name: "stale-domain", at: 90, observables: ["stale.example.net"] },
  { name: "revoked-domain", at: 100, observables: ["revoked.example.net"] },
  {
    name: "other-feed-domain",
    at: 110,
    observables: ["other-feed.example.net"],
  },
  // Another project's events, never read.
  {
    name: "other-project",
    at: 10,
    user: "alice@example.com",
    observables: ["evil.example.net"],
    project: otherProjectId,
  },
];

let version: number = Date.now();

function indicator(data: {
  feedId: ObjectID;
  value: string;
  type: ThreatIntelIndicatorType;
  validUntil?: Date;
  revoked?: boolean;
  project?: ObjectID;
}): JSONObject {
  version++;

  return buildIndicatorRow({
    projectId: data.project || projectId,
    feedId: data.feedId,
    feedName: "Fixture feed",
    stixId: `fixture-list:${data.value}`,
    indicatorType: data.type,
    indicatorValue: data.value,
    indicatorName: data.value,
    confidence: 80,
    labels: [],
    validFrom: new Date(NOW.getTime() - DAY),
    validUntil: data.validUntil || new Date(NOW.getTime() + 30 * DAY),
    revoked: Boolean(data.revoked),
    version,
    retentionDate: new Date(NOW.getTime() + 30 * DAY),
    now: NOW,
  });
}

const INDICATORS: Array<JSONObject> = [
  indicator({
    feedId: FEED_ID,
    value: "evil.example.net",
    type: ThreatIntelIndicatorType.DomainName,
  }),
  // The feed's address: not a domain list's value.
  indicator({
    feedId: FEED_ID,
    value: "1.2.3.4",
    type: ThreatIntelIndicatorType.Ipv4Address,
  }),
  indicator({
    feedId: FEED_ID,
    value: "stale.example.net",
    type: ThreatIntelIndicatorType.DomainName,
    validUntil: new Date(NOW.getTime() - HOUR),
  }),
  indicator({
    feedId: FEED_ID,
    value: "revoked.example.net",
    type: ThreatIntelIndicatorType.DomainName,
    revoked: true,
  }),
  indicator({
    feedId: OTHER_FEED_ID,
    value: "other-feed.example.net",
    type: ThreatIntelIndicatorType.DomainName,
  }),
  // The same feed id in another project carries what this project's does not.
  indicator({
    feedId: FEED_ID,
    value: "good.example.org",
    type: ThreatIntelIndicatorType.DomainName,
    project: otherProjectId,
  }),
];

// A list kept by hand, split as a run reads it.
function keptList(
  name: string,
  entityType: SecurityEntityType,
  values: Array<string>,
): SigmaWatchlist {
  return {
    name,
    entityType,
    ...splitSecurityWatchlistValues({ values, entityType }),
  };
}

// A list that follows a feed, as a run reads it.
function feedList(
  name: string,
  entityType: SecurityEntityType,
  feedId: ObjectID,
): SigmaWatchlist {
  return {
    name,
    entityType,
    exactValues: [],
    patterns: [],
    ranges: [],
    threatIntelFeed: {
      projectId: projectId.toString(),
      feedId: feedId.toString(),
      indicatorTypes: [...getSecurityWatchlistFeedIndicatorTypes(entityType)],
    },
  };
}

function byKey(lists: Array<SigmaWatchlist>): SigmaWatchlists {
  const watchlists: SigmaWatchlists = {};

  for (const list of lists) {
    watchlists[getSecurityWatchlistNameKey(list.name)] = list;
  }

  return watchlists;
}

function rule(selection: string, condition: string = "selection"): string {
  return `title: Watchlist fixture
detection:
${selection}
  condition: ${condition}`;
}

// The rule's single where clause, its lists bound.
function whereOf(yaml: string, lists: Array<SigmaWatchlist>): Statement {
  const definition: DetectionRuleDefinition = bindSigmaWatchlists(
    SigmaRuleSetParser.parse(yaml),
    byKey(lists),
  );

  if (definition.kind !== "single") {
    throw new Error("expected a single rule");
  }

  return SigmaClickhouseCompiler.compile(definition.rule);
}

// The events a rule matches in the project, by name.
async function matched(
  yaml: string,
  lists: Array<SigmaWatchlist>,
): Promise<Array<string>> {
  const statement: Statement = SQL`SELECT message FROM ${database}.${new SecurityEvent().tableName} WHERE projectId = ${{
    type: TableColumnType.ObjectID,
    value: projectId,
  }} AND (`;

  statement.append(whereOf(yaml, lists));
  statement.append(") ORDER BY message");

  // What every run asks first: the read fits one request.
  assertDetectionReadFits(statement);

  const response: { data?: Array<JSONObject> } = await (
    await SecurityEventService.executeQuery(statement)
  ).json();

  return (response.data || []).map((row: JSONObject): string => {
    return String(row["message"]);
  });
}

const EVERY_EVENT: Array<string> = FIXTURES.filter(
  (fixture: EventFixture): boolean => {
    return !fixture.project;
  },
)
  .map((fixture: EventFixture): string => {
    return fixture.name;
  })
  .sort();

function allBut(...names: Array<string>): Array<string> {
  return EVERY_EVENT.filter((name: string): boolean => {
    return !names.includes(name);
  });
}

integration("Watchlists against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let originalEvents: Partial<typeof SecurityEventService> | undefined;
  let originalIndicators:
    | Partial<typeof ThreatIntelIndicatorService>
    | undefined;

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

    const eventModel: SecurityEvent = new SecurityEvent();
    const eventColumns: Statement = new StatementGenerator<SecurityEvent>({
      modelType: SecurityEvent,
      database: clickhouse,
    }).toColumnsCreateStatement(eventModel.tableColumns);

    await client.command({
      query: `CREATE TABLE ${database}.${eventModel.tableName} (${eventColumns.query}) ENGINE = MergeTree PARTITION BY (${eventModel.partitionKey}) ORDER BY (${eventModel.sortKeys.join(", ")})`,
      query_params: eventColumns.query_params,
    });

    const indicatorModel: ThreatIntelIndicator = new ThreatIntelIndicator();
    const indicatorColumns: Statement =
      new StatementGenerator<ThreatIntelIndicator>({
        modelType: ThreatIntelIndicator,
        database: clickhouse,
      }).toColumnsCreateStatement(indicatorModel.tableColumns);

    await client.command({
      query: `CREATE TABLE ${database}.${indicatorModel.tableName} (${indicatorColumns.query}) ENGINE = ReplacingMergeTree(version) PARTITION BY (${indicatorModel.partitionKey}) ORDER BY (${indicatorModel.sortKeys.join(", ")})`,
      query_params: indicatorColumns.query_params,
    });

    originalEvents = {
      database: SecurityEventService.database,
      databaseClient: SecurityEventService.databaseClient,
      ingestDatabase: SecurityEventService.ingestDatabase,
      ingestDatabaseClient: SecurityEventService.ingestDatabaseClient,
    };
    originalIndicators = {
      database: ThreatIntelIndicatorService.database,
      databaseClient: ThreatIntelIndicatorService.databaseClient,
      ingestDatabase: ThreatIntelIndicatorService.ingestDatabase,
      ingestDatabaseClient: ThreatIntelIndicatorService.ingestDatabaseClient,
    };

    SecurityEventService.database = clickhouse;
    SecurityEventService.databaseClient = client;
    SecurityEventService.ingestDatabase = clickhouse;
    SecurityEventService.ingestDatabaseClient = client;
    ThreatIntelIndicatorService.database = clickhouse;
    ThreatIntelIndicatorService.databaseClient = client;
    ThreatIntelIndicatorService.ingestDatabase = clickhouse;
    ThreatIntelIndicatorService.ingestDatabaseClient = client;

    await SecurityEventService.insertJsonRows(FIXTURES.map(event), {
      clickhouseSettings: { wait_for_async_insert: 1 },
    });
    await ThreatIntelIndicatorService.insertJsonRows(INDICATORS, {
      clickhouseSettings: { wait_for_async_insert: 1 },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async (): Promise<void> => {
    if (originalEvents) {
      Object.assign(SecurityEventService, originalEvents);
    }

    if (originalIndicators) {
      Object.assign(ThreatIntelIndicatorService, originalIndicators);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  describe("a list kept by hand", () => {
    test("matches its values whatever the case", async () => {
      expect(
        await matched(
          rule("  selection:\n    principalUser|expand: '%vip_users%'"),
          [
            keptList("vip_users", SecurityEntityType.User, [
              "ALICE@example.com",
              "carol@example.com",
            ]),
          ],
        ),
      ).toEqual(["alice-office", "alice-outside", "good-domain"]);
    });

    test("matches a pattern with * as a run of characters, whatever the case", async () => {
      expect(
        await matched(
          rule("  selection:\n    principalUser|expand: '%service_accounts%'"),
          [keptList("service_accounts", SecurityEntityType.User, ["svc-*"])],
        ),
      ).toEqual(["svc-backup", "svc-deploy"]);

      expect(
        await matched(
          rule("  selection:\n    principalHost|expand: '%critical_hosts%'"),
          [
            keptList("critical_hosts", SecurityEntityType.Host, [
              "*.CORP.example.com",
            ]),
          ],
        ),
      ).toEqual(["svc-backup"]);
    });

    test("an IP address list matches its addresses and ranges, IPv4 and IPv6, over empty addresses", async () => {
      expect(
        await matched(
          rule("  selection:\n    principalIp|expand: '%admin_addresses%'"),
          [
            keptList("admin_addresses", SecurityEntityType.IpAddress, [
              "10.20.0.0/16",
              "192.0.2.44",
              "2001:db8::/32",
            ]),
          ],
        ),
      ).toEqual(["alice-office", "svc-backup", "svc-deploy"]);
    });

    test("read with not, it is an allow list", async () => {
      expect(
        await matched(
          rule(
            "  admins:\n    principalUser|expand: '%admins%'\n  allowed:\n    principalIp|expand: '%admin_addresses%'",
            "admins and not allowed",
          ),
          [
            keptList("admins", SecurityEntityType.User, [
              "alice@example.com",
              "svc-*",
            ]),
            keptList("admin_addresses", SecurityEntityType.IpAddress, [
              "10.20.0.0/16",
              "192.0.2.44",
            ]),
          ],
        ),
      ).toEqual(["alice-outside", "svc-deploy"]);
    });

    test("an empty list holds nothing, and not an empty list everything", async () => {
      const empty: SigmaWatchlist = keptList(
        "nobody",
        SecurityEntityType.User,
        [],
      );

      expect(
        await matched(
          rule("  selection:\n    principalUser|expand: '%nobody%'"),
          [empty],
        ),
      ).toEqual([]);
      expect(
        await matched(
          rule(
            "  selection:\n    principalUser|expand: '%nobody%'",
            "not selection",
          ),
          [empty],
        ),
      ).toEqual(EVERY_EVENT);
    });

    test("a field that holds several values matches when any of them is on the list", async () => {
      expect(
        await matched(
          rule("  selection:\n    observables|expand: '%bad_domains%'"),
          [
            keptList("bad_domains", SecurityEntityType.Domain, [
              "evil.example.net",
              "*.example.org",
            ]),
          ],
        ),
      ).toEqual(["good-domain", "no-user"]);
    });

    test("an attribute is matched as text, a hash whatever its case", async () => {
      expect(
        await matched(
          rule("  selection:\n    file.hash.md5|expand: '%known_bad_hashes%'"),
          [
            keptList("known_bad_hashes", SecurityEntityType.FileHash, [
              "d41d8cd98f00b204e9800998ecf8427e",
            ]),
          ],
        ),
      ).toEqual(["hash"]);
    });
  });

  describe("a list that follows a threat intel feed", () => {
    test("holds exactly the feed's active indicators of its kind", async () => {
      expect(
        await matched(
          rule("  selection:\n    observables|expand: '%bad_domains%'"),
          [feedList("bad_domains", SecurityEntityType.Domain, FEED_ID)],
        ),
      ).toEqual(["no-user"]);
    });

    test("an address list reads the feed's addresses, not its domains", async () => {
      expect(
        await matched(
          rule("  selection:\n    observables|expand: '%bad_addresses%'"),
          [feedList("bad_addresses", SecurityEntityType.IpAddress, FEED_ID)],
        ),
      ).toEqual(["no-user"]);

      expect(
        await matched(
          rule("  selection:\n    observables|expand: '%other_feed%'"),
          [feedList("other_feed", SecurityEntityType.Domain, OTHER_FEED_ID)],
        ),
      ).toEqual(["other-feed-domain"]);
    });

    test("read with not, it leaves the events the feed names", async () => {
      expect(
        await matched(
          rule(
            "  selection:\n    observables|expand: '%bad_domains%'",
            "not selection",
          ),
          [feedList("bad_domains", SecurityEntityType.Domain, FEED_ID)],
        ),
      ).toEqual(allBut("no-user"));
    });
  });

  describe("a long list", () => {
    test("as long as a list may be is one read ClickHouse takes, in parameters it accepts", async () => {
      const values: Array<string> = [];

      for (
        let index: number = 0;
        index < SECURITY_WATCHLIST_VALUES_MAX - 1;
        index++
      ) {
        values.push(`user-${index}-${"x".repeat(40)}@example.com`);
      }

      values.push("bob@example.com");

      const list: SigmaWatchlist = keptList(
        "everyone",
        SecurityEntityType.User,
        values,
      );
      const where: Statement = whereOf(
        rule("  selection:\n    principalUser|expand: '%everyone%'"),
        [list],
      );

      // More than one parameter, each under ClickHouse's 128 KiB a field.
      expect(Object.keys(where.query_params).length).toBeGreaterThan(1);
      expect(getStatementParameterUrlBytes(where)).toBeGreaterThan(128 * 1024);

      expect(
        await matched(
          rule("  selection:\n    principalUser|expand: '%everyone%'"),
          [list],
        ),
      ).toEqual(["bob-outside"]);

      // As a run reads it: grouped, in the run's window.
      const groups: Array<DetectionMatchGroup> =
        await SecurityEventService.findDetectionMatches({
          projectId,
          startTime: BASE,
          endTime: NOW,
          whereFragment: where,
          groupByExpression: SQL`principalUser`,
          distinctCountExpression: null,
          minMatchCount: 1,
          maxGroups: 10,
        });

      expect(
        groups.map((group: DetectionMatchGroup): string => {
          return `${group.groupValue}:${group.matchCount}`;
        }),
      ).toEqual(["bob@example.com:1"]);
    });

    test("too long for one read is refused before it reaches ClickHouse", async () => {
      const values: Array<string> = [];

      for (
        let index: number = 0;
        index < SECURITY_WATCHLIST_VALUES_MAX;
        index++
      ) {
        values.push(`${index}-${"y".repeat(240)}`);
      }

      const where: Statement = whereOf(
        rule("  selection:\n    principalUser|expand: '%too_long%'"),
        [keptList("too_long", SecurityEntityType.User, values)],
      );

      await expect(
        SecurityEventService.findDetectionMatches({
          projectId,
          startTime: BASE,
          endTime: NOW,
          whereFragment: where,
          groupByExpression: null,
          distinctCountExpression: null,
          minMatchCount: 1,
          maxGroups: 10,
        }),
      ).rejects.toThrow(
        /This rule reads more watchlist values than one read can send to the database/,
      );
    });
  });

  describe("Run on Past Events", () => {
    function stubLists(lists: Array<SigmaWatchlist>): void {
      jest
        .spyOn(DetectionRuleExceptionService, "findAllBy")
        .mockResolvedValue([] as never);
      jest.spyOn(SecurityWatchlists, "load").mockImplementation((async (data: {
        names: Array<string>;
      }) => {
        const found: Map<string, SigmaWatchlist> = new Map();

        for (const list of lists) {
          if (
            data.names
              .map((name: string): string => {
                return getSecurityWatchlistNameKey(name);
              })
              .includes(getSecurityWatchlistNameKey(list.name))
          ) {
            found.set(getSecurityWatchlistNameKey(list.name), list);
          }
        }

        return found;
      }) as never);
    }

    async function retrohunt(yaml: string): Promise<DetectionRetrohuntResult> {
      return DetectionRuleRetrohunt.run({
        projectId,
        rule: {
          id: RULE_ID,
          sigmaRuleYaml: yaml,
          groupByField: "principalUser",
          matchCountThreshold: 1,
          evaluationIntervalInMinutes: 60,
        },
        periodInHours: 24,
        serviceFilter: {},
        now: NOW,
      });
    }

    test("binds the lists a rule names, as its runs do", async () => {
      stubLists([
        keptList("admins", SecurityEntityType.User, ["alice@example.com"]),
        keptList("admin_addresses", SecurityEntityType.IpAddress, [
          "10.20.0.0/16",
        ]),
      ]);

      const result: DetectionRetrohuntResult = await retrohunt(
        rule(
          "  admins:\n    principalUser|expand: '%admins%'\n  allowed:\n    principalIp|expand: '%admin_addresses%'",
          "admins and not allowed",
        ),
      );

      expect(result.matchedEventCount).toBe(1);
      expect(
        result.groups.map((group: { value: string }): string => {
          return group.value;
        }),
      ).toEqual(["alice@example.com"]);
    });

    test("a correlation reads the lists of the rules it counts", async () => {
      stubLists([
        keptList("people", SecurityEntityType.User, ["*@example.com"]),
      ]);

      const result: DetectionRetrohuntResult =
        await retrohunt(`title: People signing in
correlation:
  type: event_count
  rules: [person_sign_in]
  group-by: [principalUser]
  timespan: 1h
  condition:
    gte: 1
---
title: Person sign-in
name: person_sign_in
detection:
  selection:
    principalUser|expand: '%people%'
  condition: selection`);

      expect(result.isCorrelation).toBe(true);
      // Every account on the list that signed in; no service account, no empty user.
      expect(
        result.groups
          .map((group: { value: string }): string => {
            return group.value;
          })
          .sort(),
      ).toEqual([
        "Alice@Example.com",
        "alice@example.com",
        "bob@example.com",
        "carol@example.com",
        "dave@example.com",
      ]);
    });

    test("a rule naming a list the project does not have says so", async () => {
      stubLists([]);

      await expect(
        retrohunt(rule("  selection:\n    principalUser|expand: '%admins%'")),
      ).rejects.toThrow(
        "There is no watchlist named admins in this project. Create it under Security Events > Detections > Watchlists, or fix its name in the rule.",
      );
    });
  });
});

describe("Watchlists ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
