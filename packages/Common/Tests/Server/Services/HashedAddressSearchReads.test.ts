import LogService from "../../../Server/Services/LogService";
import SpanService from "../../../Server/Services/SpanService";
import ExceptionInstanceService from "../../../Server/Services/ExceptionInstanceService";
import LogAggregationService from "../../../Server/Services/LogAggregationService";
import TraceAggregationService from "../../../Server/Services/TraceAggregationService";
import ExceptionAggregationService from "../../../Server/Services/ExceptionAggregationService";
import LogScrubRuleService from "../../../Server/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../../Server/Services/TraceScrubRuleService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import HashedAddressSearch, {
  HashedAddressTokens,
} from "../../../Server/Utils/Telemetry/HashedAddressSearch";
import ScrubAction from "../../../Server/Utils/Telemetry/ScrubAction";
import Log from "../../../Models/AnalyticsModels/Log";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Search from "../../../Types/BaseDatabase/Search";
import Query from "../../../Types/BaseDatabase/Query";
import { JSONObject } from "../../../Types/JSON";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * EVERY READ OF LOGS, SPANS AND EXCEPTIONS MATCHES AN ADDRESS'S HASH TOKEN
 * (#10418).
 *
 * In a project with an IP Address scrub rule set to Hash, a search for an
 * address finds the records whose address was hashed. That has to hold for
 * every read the explorers, monitors and dashboards make, not only the
 * list: each read below runs as the service runs it, its read permission
 * included, and only the statement it sends to ClickHouse is caught. The
 * token a read compares is the one ingest stored for that address in that
 * project (ScrubAction under an IP Address Hash rule) - so the hashed
 * record is found - and never another project's.
 * ---------------------------------------------------------------------------
 */

const PROJECT: ObjectID = new ObjectID("0193b0a1-0000-7000-8000-0000000a1041");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-0000000b1041",
);
const PROJECT_WITHOUT_RULE: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-0000000c1041",
);

const ADDRESS: string = "203.0.113.7";

// What ingest stored in place of the address, in a project with an IP Address Hash rule.
const storedAs: (address: string, projectId: ObjectID) => string = (
  address: string,
  projectId: ObjectID,
): string => {
  return ScrubAction.apply({
    match: address,
    action: LogScrubAction.Hash,
    patternType: LogScrubPatternType.IPAddress,
    projectId,
  });
};

const TOKEN: string = storedAs(ADDRESS, PROJECT);
const OTHER_TOKEN: string = storedAs(ADDRESS, OTHER_PROJECT);

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

const NOW: Date = new Date("2026-11-20T12:00:00.000Z");
const HOUR_AGO: Date = new Date("2026-11-20T11:00:00.000Z");

const statements: Array<Statement> = [];

const emptyResult: () => Results = (): Results => {
  return {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: [] });
    },
  } as unknown as Results;
};

const capture: (service: unknown) => void = (service: unknown): void => {
  jest
    .spyOn(service as typeof LogService, "executeQuery")
    .mockImplementation((async (statement: Statement) => {
      statements.push(statement);
      return emptyResult();
    }) as never);
};

// Every value a statement binds, lists spread: what ClickHouse compares.
const boundValues: (statement: Statement) => Array<string> = (
  statement: Statement,
): Array<string> => {
  return Object.values(statement.query_params).flatMap(
    (value: unknown): Array<string> => {
      return Array.isArray(value)
        ? value.map((entry: unknown): string => {
            return String(entry);
          })
        : [String(value)];
    },
  );
};

const lastStatement: () => Statement = (): Statement => {
  const statement: Statement | undefined = statements[statements.length - 1];

  if (!statement) {
    throw new Error("No statement was sent");
  }

  return statement;
};

// Whether the last read compares the token: as a value, or as text the column contains.
const comparesToken: (token: string) => boolean = (token: string): boolean => {
  const values: Array<string> = boundValues(lastStatement());

  return values.includes(token) || values.includes(`%${token}%`);
};

beforeEach(() => {
  statements.length = 0;
  HashedAddressSearch.clearCache();

  // PROJECT and OTHER_PROJECT hash IP addresses out of their logs and spans; the third does not.
  for (const service of [LogScrubRuleService, TraceScrubRuleService]) {
    jest.spyOn(service, "countBy").mockImplementation((async (countBy: {
      query: JSONObject;
    }) => {
      const projectId: string = String(countBy.query["projectId"]);

      return new PositiveNumber(
        projectId === PROJECT.toString() ||
        projectId === OTHER_PROJECT.toString()
          ? 1
          : 0,
      );
    }) as never);
  }

  capture(LogService);
  capture(SpanService);
  capture(ExceptionInstanceService);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const logSearch: (projectId?: ObjectID) => Query<Log> = (
  projectId: ObjectID = PROJECT,
): Query<Log> => {
  return {
    projectId,
    body: new Search(ADDRESS),
    attributes: { "client.address": ADDRESS },
  } as Query<Log>;
};

describe("every read of logs compares the address and its token", () => {
  const READS: Array<[string, () => Promise<unknown>]> = [
    [
      "a list",
      () => {
        return LogService.findBy({
          query: logSearch(),
          select: { body: true },
          limit: new PositiveNumber(10),
          skip: new PositiveNumber(0),
          props: ROOT,
        });
      },
    ],
    [
      "a count",
      () => {
        return LogService.countBy({ query: logSearch(), props: ROOT });
      },
    ],
    [
      "a count per window, a rule's preview",
      () => {
        return LogService.countPerWindow({
          query: logSearch(),
          timeColumnName: "time",
          windowInSeconds: 60,
          props: ROOT,
        });
      },
    ],
    [
      "a count per value in windows",
      () => {
        return LogService.countPerValueInWindows({
          query: logSearch(),
          valueColumnName: "severityText",
          timeColumnName: "time",
          windows: [{ startsAt: HOUR_AGO, endsAt: NOW }],
          props: ROOT,
        });
      },
    ],
    [
      "an existence check",
      () => {
        return LogService.existsBy({ query: logSearch(), props: ROOT });
      },
    ],
    [
      "an aggregate, a dashboard's chart",
      () => {
        return LogService.aggregateBy({
          query: logSearch(),
          aggregationType: AggregationType.Count,
          aggregateColumnName: "time",
          aggregationTimestampColumnName: "time",
          startTimestamp: HOUR_AGO,
          endTimestamp: NOW,
          limit: 10,
          skip: 0,
          props: ROOT,
        });
      },
    ],
    [
      "a grouped count, a grouped monitor's",
      () => {
        return LogService.countByAttributeGroups({
          query: logSearch(),
          groupByAttributes: ["client.address"],
          limit: 10,
          props: ROOT,
        });
      },
    ],
    [
      "a count of distinct values",
      () => {
        return LogService.countDistinctNonEmpty({
          query: logSearch(),
          expression: "attributes['service.instance.id']",
          props: ROOT,
        });
      },
    ],
  ];

  test.each(READS)(
    "%s",
    async (_read: string, read: () => Promise<unknown>) => {
      await read();

      expect(comparesToken(TOKEN)).toBe(true);
      expect(boundValues(lastStatement())).toContain(ADDRESS);
      expect(boundValues(lastStatement())).toContain(`%${ADDRESS}%`);
      expect(comparesToken(OTHER_TOKEN)).toBe(false);
    },
  );

  test("the hashed record's body and attribute read as the read compares them", async () => {
    await LogService.countBy({ query: logSearch(), props: ROOT });

    const statement: Statement = lastStatement();

    // The body (a column bound by name) contains the text or its hashed form, in one bracket.
    expect(statement.query).toMatch(
      /\(\{p\d+:Identifier\} ILIKE \{p\d+:String\} OR \{p\d+:Identifier\} ILIKE \{p\d+:String\}\)/,
    );
    expect(boundValues(statement)).toEqual(
      expect.arrayContaining([`%${ADDRESS}%`, `%${TOKEN}%`, ADDRESS, TOKEN]),
    );
  });
});

describe("a log monitor that filters on the address counts the hashed logs", () => {
  const MONITOR: MonitorStepLogMonitor = {
    attributes: { "client.address": ADDRESS },
    body: ADDRESS,
    severityTexts: [],
    telemetryServiceIds: [],
    lastXSecondsOfLogs: 60,
  };

  test("its count, as the worker runs it: OneUptime's own read of the monitor's project", async () => {
    const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery(MONITOR, NOW);
    query.projectId = PROJECT;

    await LogService.countBy({ query, skip: 0, limit: 1000, props: ROOT });

    expect(comparesToken(TOKEN)).toBe(true);
    // The monitor's own query, which its log keeps, is left as it was.
    expect(query.attributes).toEqual({ "client.address": ADDRESS });
    expect(query.body).toEqual(new Search(ADDRESS));
  });

  test("a grouped monitor's count too", async () => {
    const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery(MONITOR, NOW);
    query.projectId = PROJECT;

    await LogService.countByAttributeGroups({
      query,
      groupByAttributes: ["host.name"],
      limit: 10,
      props: ROOT,
    });

    expect(comparesToken(TOKEN)).toBe(true);
  });

  test("its rule's preview counts what it counts", async () => {
    const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery(MONITOR, NOW);
    query.projectId = PROJECT;

    await LogService.countPerWindow({
      query,
      timeColumnName: "time",
      windowInSeconds: 60,
      props: ROOT,
    });

    expect(comparesToken(TOKEN)).toBe(true);
  });
});

describe("spans and exception occurrences too", () => {
  test("a span list compares the name, the attributes, and the token", async () => {
    await SpanService.findBy({
      query: {
        projectId: PROJECT,
        name: new Search(`connect ${ADDRESS}`),
        attributes: { "client.address": ADDRESS },
      },
      select: { name: true },
      limit: new PositiveNumber(10),
      skip: new PositiveNumber(0),
      props: ROOT,
    });

    expect(boundValues(lastStatement())).toEqual(
      expect.arrayContaining([
        `%connect ${ADDRESS}%`,
        `%connect ${TOKEN}%`,
        ADDRESS,
        TOKEN,
      ]),
    );
  });

  test("a span count, a traces monitor's", async () => {
    await SpanService.countBy({
      query: {
        projectId: PROJECT,
        attributes: { "client.address": ADDRESS },
      },
      props: ROOT,
    });

    expect(comparesToken(TOKEN)).toBe(true);
  });

  test("an exception count, an exceptions monitor's: the message and the attributes", async () => {
    await ExceptionInstanceService.countBy({
      query: {
        projectId: PROJECT,
        message: new Search(`connect ${ADDRESS} refused`),
        attributes: { "client.address": ADDRESS },
      },
      props: ROOT,
    });

    expect(boundValues(lastStatement())).toEqual(
      expect.arrayContaining([`%connect ${TOKEN} refused%`, TOKEN]),
    );
  });
});

describe("what is not bound", () => {
  test("a project with no Hash rule runs the query it ran before, byte for byte", async () => {
    await LogService.countBy({
      query: logSearch(PROJECT_WITHOUT_RULE),
      props: ROOT,
    });
    const now: Statement = lastStatement();

    // The same read with no binding at all, as before #10418.
    jest
      .spyOn(HashedAddressSearch, "bindQuery")
      .mockImplementation((async (data: { query: unknown }) => {
        return data.query;
      }) as never);

    await LogService.countBy({
      query: logSearch(PROJECT_WITHOUT_RULE),
      props: ROOT,
    });
    const before: Statement = lastStatement();

    expect(now.query).toBe(before.query);
    expect(now.query_params).toEqual(before.query_params);
    expect(boundValues(now).join(" ")).not.toContain("[HASHED:");
  });

  test("an address searched in another project compares that project's token only", async () => {
    await LogService.countBy({
      query: logSearch(OTHER_PROJECT),
      props: ROOT,
    });

    expect(comparesToken(OTHER_TOKEN)).toBe(true);
    expect(comparesToken(TOKEN)).toBe(false);
  });

  test("a read across projects compares no token", async () => {
    await LogService.countBy({
      query: { ...logSearch(), projectId: undefined },
      props: ROOT,
    });

    expect(boundValues(lastStatement()).join(" ")).not.toContain("[HASHED:");
  });

  test("a read that asks for no hooks is not bound", async () => {
    await LogService.countBy({
      query: logSearch(),
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(comparesToken(TOKEN)).toBe(false);
  });

  test("a private address is compared as it is: no rule hashes it", async () => {
    await LogService.countBy({
      query: {
        projectId: PROJECT,
        attributes: { "server.address": "10.0.0.12" },
      },
      props: ROOT,
    });

    expect(boundValues(lastStatement()).join(" ")).not.toContain("[HASHED:");
  });
});

describe("the charts, facets and exports compare the token as the list does", () => {
  const tokens: HashedAddressTokens = new HashedAddressTokens(PROJECT);

  test("a log histogram: the body and the attributes", async () => {
    await LogAggregationService.getHistogram({
      projectId: PROJECT,
      startTime: HOUR_AGO,
      endTime: NOW,
      bucketSizeInMinutes: 5,
      bodySearchText: ADDRESS,
      attributes: { "client.address": ADDRESS },
      hashedAddresses: tokens,
    });

    expect(lastStatement().query).toMatch(
      /\(body ILIKE \{p\d+:String\} OR body ILIKE \{p\d+:String\}\)/,
    );
    expect(boundValues(lastStatement())).toEqual(
      expect.arrayContaining([`%${ADDRESS}%`, `%${TOKEN}%`, ADDRESS, TOKEN]),
    );
  });

  test("a log histogram with no tokens reads as it always did", async () => {
    await LogAggregationService.getHistogram({
      projectId: PROJECT,
      startTime: HOUR_AGO,
      endTime: NOW,
      bucketSizeInMinutes: 5,
      bodySearchText: ADDRESS,
      attributes: { "client.address": ADDRESS },
    });

    expect(lastStatement().query).toMatch(/AND body ILIKE \{p\d+:String\}/);
    expect(lastStatement().query).not.toMatch(/OR body ILIKE/);
    expect(boundValues(lastStatement()).join(" ")).not.toContain("[HASHED:");
  });

  test("a log export holds the hashed records the search shows", async () => {
    await LogAggregationService.getExportLogs({
      projectId: PROJECT,
      startTime: HOUR_AGO,
      endTime: NOW,
      limit: 100,
      bodySearchText: ADDRESS,
      hashedAddresses: tokens,
    });

    expect(boundValues(lastStatement())).toContain(`%${TOKEN}%`);
  });

  test("a trace histogram: every name, status message and attribute filter", async () => {
    await TraceAggregationService.getHistogram({
      projectId: PROJECT,
      startTime: HOUR_AGO,
      endTime: NOW,
      bucketSizeInMinutes: 5,
      nameSearchText: `GET ${ADDRESS}`,
      spanNameSearches: [`connect ${ADDRESS}`],
      spanNames: [`dial ${ADDRESS}`],
      excludedSpanNames: [`health ${ADDRESS}`],
      statusMessageSearchText: `refused by ${ADDRESS}`,
      statusMessages: [`reset by ${ADDRESS}`],
      attributes: { "client.address": ADDRESS },
      attributeSearches: { "http.url": `//${ADDRESS}/` },
      hashedAddresses: tokens,
    });

    expect(boundValues(lastStatement())).toEqual(
      expect.arrayContaining([
        `%GET ${TOKEN}%`,
        `%connect ${TOKEN}%`,
        `dial ${TOKEN}`,
        `health ${TOKEN}`,
        `%refused by ${TOKEN}%`,
        `reset by ${TOKEN}`,
        TOKEN,
        `%//${TOKEN}/%`,
      ]),
    );
  });

  test("an exceptions histogram: the message", async () => {
    await ExceptionAggregationService.getHistogram({
      projectId: PROJECT,
      startTime: HOUR_AGO,
      endTime: NOW,
      bucketSizeInMinutes: 5,
      messageSearchText: `connect ${ADDRESS} refused`,
      hashedAddresses: tokens,
    });

    expect(boundValues(lastStatement())).toEqual(
      expect.arrayContaining([
        `%connect ${ADDRESS} refused%`,
        `%connect ${TOKEN} refused%`,
      ]),
    );
  });
});
