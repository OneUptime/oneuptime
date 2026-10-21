import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import ThreatIntelIndicatorService from "../../../Server/Services/ThreatIntelIndicatorService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";

/*
 * Every read of the ThreatIntelIndicator table, as ClickHouse is sent it.
 *
 * ClickHouse resolves a name to a SELECT alias before a column, so an
 * aggregate aliased with the name of a column another aggregate of the same
 * SELECT reads (`max(confidence) AS confidence` beside
 * `argMax(stixId, confidence)`) nests one aggregate in another, and both
 * analyzers refuse the query (ILLEGAL_AGGREGATION). Three of these reads did
 * exactly that, so no TAXII feed ingested, no event was enriched and no
 * match was found; ThreatIntelSourcesClickhouse (App) runs them against a
 * real server. This suite holds every read to the rule without one, and
 * pins what each returns under its new names.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const FEED_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const NOW: Date = new Date("2026-10-21T12:00:00.000Z");

function stubRows(rows: Array<JSONObject>): Spy {
  getJestSpyOn(
    ThreatIntelIndicatorService.database,
    "getDatasourceOptions",
  ).mockReturnValue({ database: "oneuptime" } as never);

  const result: Results = {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;

  return getJestSpyOn(
    ThreatIntelIndicatorService,
    "executeQuery",
  ).mockResolvedValue(result as never);
}

const AGGREGATE: RegExp =
  /\b(?:max|min|sum|any|argMax|argMin|count|uniq|uniqExact)\(([^()]*)\)\s+AS\s+(\w+)/g;

/*
 * The aggregates of each SELECT list, the text from a SELECT to the FROM at
 * its own depth - so a subquery's list is checked on its own.
 */
function selectLists(query: string): Array<string> {
  const lists: Array<string> = [];
  let index: number = query.indexOf("SELECT");

  while (index !== -1) {
    let depth: number = 0;
    let end: number = index + "SELECT".length;

    for (; end < query.length; end++) {
      const char: string = query.charAt(end);

      if (char === "(") {
        depth++;
      } else if (char === ")") {
        depth--;
      } else if (depth === 0 && query.startsWith("FROM", end)) {
        break;
      }
    }

    lists.push(query.slice(index, end));
    index = query.indexOf("SELECT", index + "SELECT".length);
  }

  return lists;
}

function aliasesReadByAnotherAggregate(query: string): Array<string> {
  const found: Array<string> = [];

  for (const list of selectLists(query)) {
    const aggregates: Array<{ args: Array<string>; alias: string }> = [];

    for (const match of list.matchAll(AGGREGATE)) {
      aggregates.push({
        args: match[1]!.split(",").map((arg: string): string => {
          return arg.trim();
        }),
        alias: match[2]!,
      });
    }

    for (const aggregate of aggregates) {
      for (const other of aggregates) {
        if (other !== aggregate && other.args.includes(aggregate.alias)) {
          found.push(`${aggregate.alias} (read by ${other.alias})`);
        }
      }
    }
  }

  return found;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the rule this suite holds every read to", () => {
  test("finds the shape that broke the reads", () => {
    expect(
      aliasesReadByAnotherAggregate(
        "SELECT argMax(stixId, confidence) AS stixId, max(confidence) AS confidence FROM t",
      ),
    ).toEqual(["confidence (read by stixId)"]);
    expect(
      aliasesReadByAnotherAggregate(
        "SELECT argMax(a, version) AS a, max(version) AS version FROM t",
      ),
    ).toEqual(["version (read by a)"]);
  });

  test("lets an alias repeat its own column, and a subquery keep its own names", () => {
    expect(
      aliasesReadByAnotherAggregate(
        "SELECT argMax(feedName, confidence) AS feedName, max(confidence) AS bestConfidence FROM (SELECT argMax(confidence, version) AS confidence FROM t GROUP BY x)",
      ),
    ).toEqual([]);
  });
});

describe("ThreatIntelIndicatorService's reads", () => {
  test("findActiveIndicatorsByValues: the best confidence under its own name", async () => {
    const spy: Spy = stubRows([
      {
        indicatorValue: "192.0.2.1",
        feedId: FEED_ID.toString(),
        feedName: "Tor",
        stixId: "list",
        indicatorType: "ipv4-addr",
        indicatorName: "",
        bestConfidence: 60,
      },
    ]);

    const found: Array<{ confidence: number }> =
      await ThreatIntelIndicatorService.findActiveIndicatorsByValues({
        projectId: PROJECT_ID,
        values: ["192.0.2.1"],
        now: NOW,
      });

    expect(found).toHaveLength(1);
    expect(found[0]!.confidence).toBe(60);

    const query: string = (spy.mock.calls[0]![0] as Statement).query;

    expect(query).toContain("max(confidence) AS bestConfidence");
    expect(aliasesReadByAnotherAggregate(query)).toEqual([]);
  });

  test("findIndicatorMatches: the join's best confidence under its own name", async () => {
    const spy: Spy = stubRows([
      {
        indicatorValue: "192.0.2.1",
        stixId: "list",
        indicatorType: "ipv4-addr",
        indicatorName: "",
        confidence: 60,
        matchCount: 2,
        sampleMessage: "x",
        sampleObservables: ["192.0.2.1"],
      },
    ]);

    await ThreatIntelIndicatorService.findIndicatorMatches({
      projectId: PROJECT_ID,
      feedId: FEED_ID,
      startTime: NOW,
      endTime: NOW,
      maxGroups: 10,
    });

    const query: string = (spy.mock.calls[0]![0] as Statement).query;

    expect(query).toContain("max(confidence) AS bestConfidence");
    expect(query).toContain("any(i.bestConfidence) AS confidence");
    expect(aliasesReadByAnotherAggregate(query)).toEqual([]);
  });

  test("findLatestVersionsByStixIds: the latest version under its own name", async () => {
    const spy: Spy = stubRows([
      {
        stixId: "indicator--1",
        indicatorValue: "192.0.2.1",
        indicatorType: "ipv4-addr",
        indicatorName: "",
        confidence: 80,
        latestVersion: "1792608774898",
        validFrom: "2026-10-01 00:00:00.000000000",
        validUntil: "2027-10-01 00:00:00.000000000",
        retentionDate: "2027-10-02 00:00:00",
      },
    ]);

    const stored: Array<{ version: number }> =
      await ThreatIntelIndicatorService.findLatestVersionsByStixIds({
        projectId: PROJECT_ID,
        feedId: FEED_ID,
        stixIds: ["indicator--1"],
      });

    expect(stored[0]!.version).toBe(1792608774898);

    const query: string = (spy.mock.calls[0]![0] as Statement).query;

    expect(query).toContain("max(version) AS latestVersion");
    expect(aliasesReadByAnotherAggregate(query)).toEqual([]);
  });

  test("findActiveValuesForFeed: one feed's identity, active now, bounded", async () => {
    const spy: Spy = stubRows([
      { indicatorValue: "192.0.2.1", indicatorType: "ipv4-addr" },
    ]);

    const held: Array<{ indicatorValue: string; indicatorType: string }> =
      await ThreatIntelIndicatorService.findActiveValuesForFeed({
        projectId: PROJECT_ID,
        feedId: FEED_ID,
        stixId: "list",
        now: NOW,
        limit: 100000,
      });

    expect(held).toEqual([
      { indicatorValue: "192.0.2.1", indicatorType: "ipv4-addr" },
    ]);

    const statement: Statement = spy.mock.calls[0]![0] as Statement;

    expect(statement.query).toContain("GROUP BY indicatorValue");
    expect(statement.query).toContain("HAVING revokedLatest = false");
    expect(aliasesReadByAnotherAggregate(statement.query)).toEqual([]);

    // Every value bound as a parameter, never written into the SQL.
    expect(statement.query).not.toContain(PROJECT_ID.toString());
    expect(Object.values(statement.query_params)).toEqual(
      expect.arrayContaining(["list", 100000]),
    );
  });
});
