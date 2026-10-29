import ThreatIntelIndicatorService, {
  ActiveIndicator,
  IndicatorMatchGroup,
  StoredIndicatorVersion,
} from "../../../Server/Services/ThreatIntelIndicatorService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
import {
  findAliasShadows,
  findAliasesSpellingColumns,
} from "../../Helpers/ClickhouseAliasScan";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The SQL contract of the threat-intel indicator queries. The table is
 * ReplacingMergeTree with asynchronous merges, so every "current state"
 * read here MUST be version-aware — argMax(column, version) GROUP BY the
 * identity — and "active" MUST be a query predicate on the resolved
 * latest version (validity window + not revoked), never an assumption
 * that TTL already removed expired rows. None of that is visible from a
 * TypeScript call site, so this file pins the rendered statements.
 *
 * Every service boundary is stubbed: executeQuery captures the Statement,
 * and the database handle only supplies the schema name. No ClickHouse:
 * App/Tests/Workers/Jobs/ThreatIntel/ThreatIntelClickhouse runs the same
 * statements on a real server, under both of its analyzers.
 *
 * Issue #5157: every one of these statements failed on every ClickHouse
 * with ILLEGAL_AGGREGATION, because an alias spelled a column another
 * aggregate of its SELECT read (`max(confidence) AS confidence` beside
 * `argMax(stixId, confidence)`, `max(version) AS version` beside
 * `argMax(validFrom, version)`). Each statement is held to the strict rule
 * below: no alias is a name its SELECT reads, its own expression included.
 */

// No alias of the statement spells a name its SELECT reads (issue #5157).
function expectNoAliasSpellingAColumn(query: string): void {
  expect(findAliasesSpellingColumns(query)).toEqual([]);
  expect(findAliasShadows(query)).toEqual([]);
}

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const FEED_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const NOW: Date = new Date("2026-08-27T12:00:00.000Z");
const DATABASE_NAME: string = "oneuptime";

function stubExecuteQuery(rows?: Array<JSONObject>): Spy {
  getJestSpyOn(
    ThreatIntelIndicatorService.database,
    "getDatasourceOptions",
  ).mockReturnValue({ database: DATABASE_NAME } as never);

  const fakeResult: Results = {
    json: (): Promise<unknown> => {
      return Promise.resolve(rows === undefined ? {} : { data: rows });
    },
  } as unknown as Results;

  return getJestSpyOn(
    ThreatIntelIndicatorService,
    "executeQuery",
  ).mockResolvedValue(fakeResult as never);
}

function capturedQueryText(spy: Spy): string {
  expect(spy).toHaveBeenCalledTimes(1);
  return (spy.mock.calls[0]![0] as Statement).query;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ThreatIntelIndicatorService.hasIndicatorsForProject", () => {
  test("is a bounded existence probe with a bound projectId", async () => {
    const spy: Spy = stubExecuteQuery([{ "1": 1 }]);

    const result: boolean =
      await ThreatIntelIndicatorService.hasIndicatorsForProject(PROJECT_ID);

    expect(result).toBe(true);

    const query: string = capturedQueryText(spy);
    expect(query).toContain("SELECT 1 FROM");
    expect(query).toContain(
      `${DATABASE_NAME}.${AnalyticsTableName.ThreatIntelIndicator}`,
    );
    expect(query).toContain("LIMIT 1");
    // The tenant id is a bound parameter, never inlined.
    expect(query).not.toContain(PROJECT_ID.toString());
  });

  test("no rows means false, including a body with no data key", async () => {
    stubExecuteQuery([]);
    expect(
      await ThreatIntelIndicatorService.hasIndicatorsForProject(PROJECT_ID),
    ).toBe(false);

    jest.restoreAllMocks();

    stubExecuteQuery(undefined);
    expect(
      await ThreatIntelIndicatorService.hasIndicatorsForProject(PROJECT_ID),
    ).toBe(false);
  });
});

describe("ThreatIntelIndicatorService.findActiveIndicatorsByValues", () => {
  test("returns [] for an empty value list without touching the database", async () => {
    const spy: Spy = stubExecuteQuery([]);

    const result: Array<ActiveIndicator> =
      await ThreatIntelIndicatorService.findActiveIndicatorsByValues({
        projectId: PROJECT_ID,
        values: [],
        now: NOW,
      });

    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  test("resolves versions per FULL identity, then collapses per (feed, value) keeping any active identity", async () => {
    const spy: Spy = stubExecuteQuery([]);

    await ThreatIntelIndicatorService.findActiveIndicatorsByValues({
      projectId: PROJECT_ID,
      values: ["evil.example", "198.51.100.7"],
      now: NOW,
    });

    const query: string = capturedQueryText(spy);

    // Version-aware current state: argMax over every read column.
    expect(query).toContain("argMax(confidence, version) AS confidenceLatest");
    expect(query).toContain("argMax(feedName, version) AS feedNameLatest");
    expect(query).toContain("argMax(revoked, version) AS revokedLatest");
    expect(query).toContain("argMax(validUntil, version) AS validUntilLatest");
    expect(query).toContain("stixId AS identityStixId");

    /*
     * THE regression pin for the revoked-duplicate masking bug: version
     * resolution must group by the full ReplacingMergeTree identity —
     * stixId INCLUDED — or the latest-modified STIX object sharing a
     * value (a revocation of a superseded duplicate, say) masks another
     * object's still-active claim.
     */
    expect(query).toContain("GROUP BY feedId, indicatorValue, stixId");

    // Active is a predicate over each RESOLVED identity...
    expect(query).toContain("HAVING revokedLatest = false");
    expect(query).toContain("validFromLatest <=");
    expect(query).toContain("validUntilLatest >");

    /*
     * ...and only the surviving (active) identities collapse to one row
     * per (feed, value), the highest-confidence one representing it.
     */
    expect(query).toContain(") GROUP BY feedId, indicatorValue");
    expect(query).toContain(
      "argMax(identityStixId, confidenceLatest) AS stixId",
    );
    expect(query).toContain(
      "argMax(feedNameLatest, confidenceLatest) AS feedName",
    );
    expect(query).toContain("max(confidenceLatest) AS confidence");

    // The value list rides as a bound array parameter.
    expect(query).toContain("indicatorValue IN");
    expect(query).not.toContain("evil.example");
  });

  test("no alias spells a name its SELECT reads, at either level (issue #5157)", async () => {
    const spy: Spy = stubExecuteQuery([]);

    await ThreatIntelIndicatorService.findActiveIndicatorsByValues({
      projectId: PROJECT_ID,
      values: ["evil.example"],
      now: NOW,
    });

    const query: string = capturedQueryText(spy);

    expectNoAliasSpellingAColumn(query);
    // What issue #5157's statement wrote: an aggregate inside an aggregate.
    expect(query).not.toContain("max(confidence) AS confidence");
    expect(query).not.toContain("argMax(stixId, confidence)");
  });

  test("maps result rows onto ActiveIndicator with numeric confidence", async () => {
    stubExecuteQuery([
      {
        indicatorValue: "evil.example",
        feedId: FEED_ID.toString(),
        feedName: "Test Feed",
        stixId: "indicator--0001",
        indicatorType: "domain-name",
        indicatorName: "C2",
        confidence: "85",
      },
    ]);

    const result: Array<ActiveIndicator> =
      await ThreatIntelIndicatorService.findActiveIndicatorsByValues({
        projectId: PROJECT_ID,
        values: ["evil.example"],
        now: NOW,
      });

    expect(result).toEqual([
      {
        indicatorValue: "evil.example",
        feedId: FEED_ID.toString(),
        feedName: "Test Feed",
        stixId: "indicator--0001",
        indicatorType: "domain-name",
        indicatorName: "C2",
        confidence: 85,
      },
    ]);
  });
});

describe("ThreatIntelIndicatorService.findIndicatorMatches", () => {
  async function callFindIndicatorMatches(): Promise<
    Array<IndicatorMatchGroup>
  > {
    return ThreatIntelIndicatorService.findIndicatorMatches({
      projectId: PROJECT_ID,
      feedId: FEED_ID,
      startTime: new Date("2026-08-27T11:00:00.000Z"),
      endTime: new Date("2026-08-27T12:00:00.000Z"),
      maxGroups: 100,
    });
  }

  test("joins the events window against this feed's active indicators, case-insensitively", async () => {
    const spy: Spy = stubExecuteQuery([]);

    await callFindIndicatorMatches();

    const query: string = capturedQueryText(spy);

    // Events side: the SecurityEvent table, per-value via ARRAY JOIN.
    expect(query).toContain(
      `${DATABASE_NAME}.${AnalyticsTableName.SecurityEvent} AS e`,
    );
    expect(query).toContain("ARRAY JOIN e.observables AS matchedObservable");

    /*
     * GLOBAL join: events and indicators shard differently, so a local
     * per-shard join would silently miss cross-shard matches on a
     * cluster.
     */
    expect(query).toContain("GLOBAL INNER JOIN");

    /*
     * Case-insensitive equality: observables preserve source casing,
     * indicator values are stored lowercased.
     */
    expect(query).toContain(
      "ON lowerUTF8(matchedObservable) = i.indicatorValue",
    );

    /*
     * The indicator side is version-aware PER FULL IDENTITY (stixId in
     * the GROUP BY — the revoked-duplicate masking regression pin),
     * active-filtered per identity, and only then collapsed to one row
     * per value so matchCount counts events, never events x identities.
     */
    expect(query).toContain("argMax(revoked, version) AS revokedLatest");
    expect(query).toContain("GROUP BY indicatorValue, stixId");
    expect(query).toContain("HAVING revokedLatest = false");
    expect(query).toContain(") GROUP BY indicatorValue");
    expect(query).toContain(
      "argMax(identityStixId, confidenceLatest) AS stixId",
    );
    expect(query).toContain("max(confidenceLatest) AS confidence");

    /*
     * Findings never feed the matcher — Sigma's and our own class-2004
     * rows are excluded, which is also what keeps the write-back
     * loop-free.
     */
    expect(query).toContain("e.classUid !=");

    expect(query).toContain("GROUP BY i.indicatorValue");
    expect(query).toContain("ORDER BY matchCount DESC");
  });

  test("no alias spells a name its SELECT reads, at any of its three levels (issue #5157)", async () => {
    const spy: Spy = stubExecuteQuery([]);

    await callFindIndicatorMatches();

    const query: string = capturedQueryText(spy);

    expectNoAliasSpellingAColumn(query);
    expect(query).not.toContain("max(confidence) AS confidence");
    // The outer level reads the joined columns by their table's name.
    expect(query).toContain("any(i.confidence) AS confidence");
    expect(query).toContain("any(i.stixId) AS stixId");
  });

  test("maps grouped rows onto IndicatorMatchGroup", async () => {
    stubExecuteQuery([
      {
        indicatorValue: "evil.example",
        stixId: "indicator--0001",
        indicatorType: "domain-name",
        indicatorName: "C2",
        confidence: 85,
        matchCount: "4",
        sampleMessage: "outbound to evil.example",
        sampleObservables: ["evil.example", "web-01"],
      },
    ]);

    const result: Array<IndicatorMatchGroup> = await callFindIndicatorMatches();

    expect(result).toEqual([
      {
        indicatorValue: "evil.example",
        stixId: "indicator--0001",
        indicatorType: "domain-name",
        indicatorName: "C2",
        confidence: 85,
        matchCount: 4,
        sampleMessage: "outbound to evil.example",
        sampleObservables: ["evil.example", "web-01"],
      },
    ]);
  });

  test("a body with no data key maps to an empty result, not a crash", async () => {
    stubExecuteQuery(undefined);

    expect(await callFindIndicatorMatches()).toEqual([]);
  });
});

describe("ThreatIntelIndicatorService.findLatestVersionsByStixIds", () => {
  test("returns [] for an empty id list without touching the database", async () => {
    const spy: Spy = stubExecuteQuery([]);

    expect(
      await ThreatIntelIndicatorService.findLatestVersionsByStixIds({
        projectId: PROJECT_ID,
        feedId: FEED_ID,
        stixIds: [],
      }),
    ).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  test("reads the latest version and the retention high-water mark per (stixId, value) identity", async () => {
    const spy: Spy = stubExecuteQuery([]);

    await ThreatIntelIndicatorService.findLatestVersionsByStixIds({
      projectId: PROJECT_ID,
      feedId: FEED_ID,
      stixIds: ["indicator--0001"],
    });

    const query: string = capturedQueryText(spy);

    expect(query).toContain("GROUP BY stixId, indicatorValue");
    expect(query).toContain("max(version) AS versionLatest");
    /*
     * max, not argMax: the poller's monotonic-retention clamp needs the
     * highest retention any version ever carried, not the latest
     * version's own.
     */
    expect(query).toContain("max(retentionDate) AS retentionDateHighest");
    expect(query).toContain("argMax(validUntil, version) AS validUntilLatest");
    expect(query).toContain("argMax(validFrom, version) AS validFromLatest");
    expect(query).toContain("argMax(confidence, version) AS confidenceLatest");
    // Deliberately NO active predicate — retraction must see dead rows too.
    expect(query).not.toContain("HAVING");
    expect(query).toContain("stixId IN");
    expect(query).not.toContain("indicator--0001");
  });

  test("no alias spells a name its SELECT reads: every aggregate reads version (issue #5157)", async () => {
    const spy: Spy = stubExecuteQuery([]);

    await ThreatIntelIndicatorService.findLatestVersionsByStixIds({
      projectId: PROJECT_ID,
      feedId: FEED_ID,
      stixIds: ["indicator--0001"],
    });

    const query: string = capturedQueryText(spy);

    expectNoAliasSpellingAColumn(query);
    // What issue #5157's first line quotes: max(version) inside every argMax.
    expect(query).not.toContain("max(version) AS version,");
  });

  test("maps rows with numeric version and confidence", async () => {
    stubExecuteQuery([
      {
        stixId: "indicator--0001",
        indicatorValue: "evil.example",
        indicatorTypeLatest: "domain-name",
        indicatorNameLatest: "C2",
        confidenceLatest: "85",
        versionLatest: "1756000000000",
        validFromLatest: "2026-08-01 00:00:00",
        validUntilLatest: "2026-12-31 00:00:00",
        retentionDateHighest: "2027-01-01",
      },
    ]);

    const result: Array<StoredIndicatorVersion> =
      await ThreatIntelIndicatorService.findLatestVersionsByStixIds({
        projectId: PROJECT_ID,
        feedId: FEED_ID,
        stixIds: ["indicator--0001"],
      });

    expect(result).toEqual([
      {
        stixId: "indicator--0001",
        indicatorValue: "evil.example",
        indicatorType: "domain-name",
        indicatorName: "C2",
        confidence: 85,
        version: 1756000000000,
        validFrom: "2026-08-01 00:00:00",
        validUntil: "2026-12-31 00:00:00",
        retentionDate: "2027-01-01",
      },
    ]);
  });
});

describe("ThreatIntelIndicatorService.findActiveValuesForFeed", () => {
  /*
   * The list poller's read: the values one feed's identity (a list's
   * single stixId) holds active now, so a new copy of the list can let go
   * of the values it no longer has.
   */
  test("reads one feed's identity, resolved version-aware, active now and bounded", async () => {
    const spy: Spy = stubExecuteQuery([
      { indicatorValue: "192.0.2.1", indicatorTypeLatest: "ipv4-addr" },
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

    expect(spy).toHaveBeenCalledTimes(1);
    const statement: Statement = spy.mock.calls[0]![0] as Statement;

    expect(statement.query).toContain("GROUP BY indicatorValue");
    expect(statement.query).toContain(
      "argMax(indicatorType, version) AS indicatorTypeLatest",
    );
    expect(statement.query).toContain("HAVING revokedLatest = false");
    expect(statement.query).toContain("LIMIT");
    expectNoAliasSpellingAColumn(statement.query);

    // Every value is bound as a parameter, never written into the SQL.
    expect(statement.query).not.toContain(PROJECT_ID.toString());
    expect(statement.query).not.toContain(FEED_ID.toString());
    expect(Object.values(statement.query_params)).toEqual(
      expect.arrayContaining(["list", 100000]),
    );
  });

  test("a body with no data key holds nothing", async () => {
    stubExecuteQuery(undefined);

    expect(
      await ThreatIntelIndicatorService.findActiveValuesForFeed({
        projectId: PROJECT_ID,
        feedId: FEED_ID,
        stixId: "list",
        now: NOW,
        limit: 10,
      }),
    ).toEqual([]);
  });
});

/*
 * A watchlist that follows a feed matches an event's field against the
 * feed's active indicators of the list's kind, read where the rule runs:
 * the same version-aware resolution as every read here, as a subquery.
 */
describe("ThreatIntelIndicatorService.buildActiveValuesSubquery", () => {
  function subquery(): Statement {
    getJestSpyOn(
      ThreatIntelIndicatorService.database,
      "getDatasourceOptions",
    ).mockReturnValue({ database: DATABASE_NAME } as never);

    return ThreatIntelIndicatorService.buildActiveValuesSubquery({
      projectId: PROJECT_ID,
      feedId: FEED_ID,
      indicatorTypes: ["ipv4-addr", "ipv6-addr"],
      now: NOW,
    });
  }

  test("the feed's values, lowercased, resolved per identity and active now", () => {
    const query: string = subquery().query;

    expect(query.startsWith("SELECT lowerUTF8(indicatorValue) FROM (")).toBe(
      true,
    );
    expect(query).toContain(
      `FROM ${DATABASE_NAME}.${AnalyticsTableName.ThreatIntelIndicator}`,
    );
    expect(query).toContain("argMax(revoked, version) AS revokedLatest");
    expect(query).toContain("GROUP BY indicatorValue, stixId");
    expect(query).toContain("HAVING revokedLatest = false");
    expect(query).toContain("validFromLatest <=");
    expect(query).toContain("validUntilLatest >");
    expect(query).toContain(") WHERE indicatorTypeLatest IN {");
    expectNoAliasSpellingAColumn(query);
  });

  test("the project, the feed, the time and the kinds are bound, never written into the text", () => {
    const statement: Statement = subquery();
    const values: Array<unknown> = Object.values(statement.query_params);

    expect(statement.query).not.toContain(PROJECT_ID.toString());
    expect(statement.query).not.toContain(FEED_ID.toString());
    expect(statement.query).not.toContain("ipv4-addr");
    expect(values).toContain(PROJECT_ID.toString());
    expect(values).toContain(FEED_ID.toString());
    expect(values).toContainEqual(["ipv4-addr", "ipv6-addr"]);
  });

  test("building it reads nothing", () => {
    const spy: Spy = getJestSpyOn(ThreatIntelIndicatorService, "executeQuery");

    subquery();

    expect(spy).not.toHaveBeenCalled();
  });
});
