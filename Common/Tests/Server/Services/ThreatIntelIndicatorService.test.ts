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
 * and the database handle only supplies the schema name. No ClickHouse.
 */

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
    expect(query).toContain("argMax(confidence, version)");
    expect(query).toContain("argMax(revoked, version) AS revokedLatest");
    expect(query).toContain("argMax(validUntil, version) AS validUntilLatest");

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
    expect(query).toContain("argMax(stixId, confidence)");
    expect(query).toContain("max(confidence) AS confidence");

    // The value list rides as a bound array parameter.
    expect(query).toContain("indicatorValue IN");
    expect(query).not.toContain("evil.example");
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
    expect(query).toContain("argMax(stixId, confidence)");

    /*
     * Findings never feed the matcher — Sigma's and our own class-2004
     * rows are excluded, which is also what keeps the write-back
     * loop-free.
     */
    expect(query).toContain("e.classUid !=");

    expect(query).toContain("GROUP BY i.indicatorValue");
    expect(query).toContain("ORDER BY matchCount DESC");
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
    expect(query).toContain("max(version) AS version");
    /*
     * max, not argMax: the poller's monotonic-retention clamp needs the
     * highest retention any version ever carried, not the latest
     * version's own.
     */
    expect(query).toContain("max(retentionDate) AS retentionDate");
    expect(query).toContain("argMax(validUntil, version) AS validUntil");
    // Deliberately NO active predicate — retraction must see dead rows too.
    expect(query).not.toContain("HAVING");
    expect(query).toContain("stixId IN");
    expect(query).not.toContain("indicator--0001");
  });

  test("maps rows with numeric version and confidence", async () => {
    stubExecuteQuery([
      {
        stixId: "indicator--0001",
        indicatorValue: "evil.example",
        indicatorType: "domain-name",
        indicatorName: "C2",
        confidence: "85",
        version: "1756000000000",
        validFrom: "2026-08-01 00:00:00",
        validUntil: "2026-12-31 00:00:00",
        retentionDate: "2027-01-01",
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
