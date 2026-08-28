import ThreatIntelFeedPoller, {
  FeedPollResult,
  MAX_INDICATOR_DATE_MILLIS,
  MAX_PAGES_PER_POLL,
  StixIndicatorParseResult,
  StixParseContext,
} from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelFeedPoller";
import TaxiiClient, {
  TaxiiObjectsPage,
} from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/TaxiiClient";
import ThreatIntelEnricher from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import ThreatIntelFeed from "../../../../../Models/DatabaseModels/ThreatIntelFeed";
import ThreatIntelFeedService from "../../../../../Server/Services/ThreatIntelFeedService";
import ThreatIntelIndicatorService from "../../../../../Server/Services/ThreatIntelIndicatorService";
import { MAX_CONNECTOR_ERROR_MESSAGE_LENGTH } from "../../../../../Server/Utils/SecurityEvent/ConnectorErrorMessage";
import logger from "../../../../../Server/Utils/Logger";
import { ThreatIntelIndicatorType } from "../../../../../Types/SecurityEvent/ThreatIntelConstants";
import ObjectID from "../../../../../Types/ObjectID";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The TAXII feed poller's contract: STIX indicator objects become
 * normalized IOC rows (or counted skips), page loops respect caps and
 * cursors, bookkeeping lands on the feed row, and one broken feed can
 * never take the polling loop down. Every service boundary is stubbed.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const FEED_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const NOW: Date = new Date("2026-08-27T12:00:00.000Z");

const CONTEXT: StixParseContext = {
  projectId: PROJECT_ID,
  feedId: FEED_ID,
  feedName: "Test Feed",
  minimumConfidence: 0,
};

function buildStixIndicator(overrides: JSONObject = {}): JSONObject {
  return {
    type: "indicator",
    id: "indicator--0001",
    pattern: "[ipv4-addr:value = '198.51.100.7']",
    pattern_type: "stix",
    created: "2026-08-20T00:00:00.000Z",
    modified: "2026-08-21T00:00:00.000Z",
    valid_from: "2026-08-20T00:00:00.000Z",
    valid_until: "2026-12-31T00:00:00.000Z",
    confidence: 85,
    labels: ["malicious-activity"],
    name: "Known C2 address",
    ...overrides,
  };
}

function buildFeed(
  options: {
    cursor?: string;
    lastPolledAt?: Date;
    pollIntervalInMinutes?: number;
    minimumConfidence?: number;
  } = {},
): ThreatIntelFeed {
  const feed: ThreatIntelFeed = new ThreatIntelFeed();
  feed._id = FEED_ID.toString();
  feed.projectId = PROJECT_ID;
  feed.name = "Test Feed";
  feed.apiRootUrl = "https://taxii.example.com/api1/";
  feed.collectionId = "col-1";
  feed.pollIntervalInMinutes = options.pollIntervalInMinutes ?? 60;
  feed.minimumConfidence = options.minimumConfidence ?? 0;
  if (options.cursor) {
    feed.cursor = options.cursor;
  }
  if (options.lastPolledAt) {
    feed.lastPolledAt = options.lastPolledAt;
  }
  return feed;
}

function buildClientServingPages(pages: Array<TaxiiObjectsPage>): {
  client: TaxiiClient;
  calls: Array<JSONObject>;
} {
  const calls: Array<JSONObject> = [];
  let index: number = 0;

  const client: TaxiiClient = {
    fetchIndicatorObjects: (params: JSONObject): Promise<TaxiiObjectsPage> => {
      calls.push(params);
      const page: TaxiiObjectsPage = pages[Math.min(index, pages.length - 1)]!;
      index++;
      return Promise.resolve(page);
    },
  } as unknown as TaxiiClient;

  return { client, calls };
}

let insertSpy: Spy;
let updateSpy: Spy;
let invalidateSpy: Spy;
let storedVersionsSpy: Spy;

beforeEach(() => {
  insertSpy = getJestSpyOn(
    ThreatIntelIndicatorService,
    "insertJsonRows",
  ).mockResolvedValue(undefined as never);
  storedVersionsSpy = getJestSpyOn(
    ThreatIntelIndicatorService,
    "findLatestVersionsByStixIds",
  ).mockResolvedValue([] as never);
  updateSpy = getJestSpyOn(
    ThreatIntelFeedService,
    "updateOneById",
  ).mockResolvedValue(undefined as never);
  invalidateSpy = getJestSpyOn(
    ThreatIntelEnricher,
    "invalidateProjectCache",
  ).mockImplementation((() => {
    return undefined;
  }) as never);
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ThreatIntelFeedPoller.parseStixIndicator", () => {
  test("a supported indicator becomes one row per IOC value with normalized fields", () => {
    const result: StixIndicatorParseResult =
      ThreatIntelFeedPoller.parseStixIndicator(
        buildStixIndicator({
          pattern:
            "[domain-name:value = 'EVIL.example' OR domain-name:value = 'evil2.example']",
        }),
        CONTEXT,
        NOW,
      );

    expect(result.outcome).toBe("ingested");
    expect(result.rows).toHaveLength(2);

    const first: JSONObject = result.rows[0]!;
    expect(first["projectId"]).toBe(PROJECT_ID.toString());
    expect(first["feedId"]).toBe(FEED_ID.toString());
    expect(first["feedName"]).toBe("Test Feed");
    expect(first["stixId"]).toBe("indicator--0001");
    expect(first["indicatorType"]).toBe(ThreatIntelIndicatorType.DomainName);
    expect(first["indicatorValue"]).toBe("evil.example");
    expect(first["indicatorName"]).toBe("Known C2 address");
    expect(first["confidence"]).toBe(85);
    expect(first["stixLabels"]).toEqual(["malicious-activity"]);
    expect(first["revoked"]).toBe(false);
    // Version is the STIX modified timestamp in unix millis.
    expect(first["version"]).toBe(
      new Date("2026-08-21T00:00:00.000Z").getTime(),
    );
    expect(result.rows[1]!["indicatorValue"]).toBe("evil2.example");
    // Both rows carry the same identity apart from the value.
    expect(result.rows[1]!["stixId"]).toBe("indicator--0001");
  });

  test("non-indicator objects and unsupported patterns are counted, not ingested", () => {
    expect(
      ThreatIntelFeedPoller.parseStixIndicator(
        { type: "malware", id: "malware--1" },
        CONTEXT,
        NOW,
      ).outcome,
    ).toBe("not-indicator");

    expect(
      ThreatIntelFeedPoller.parseStixIndicator(
        buildStixIndicator({
          pattern:
            "[ipv4-addr:value = '1.2.3.4' AND domain-name:value = 'x.example']",
        }),
        CONTEXT,
        NOW,
      ).outcome,
    ).toBe("unsupported");

    expect(
      ThreatIntelFeedPoller.parseStixIndicator(
        buildStixIndicator({ pattern_type: "snort" }),
        CONTEXT,
        NOW,
      ).outcome,
    ).toBe("unsupported");

    expect(
      ThreatIntelFeedPoller.parseStixIndicator(
        buildStixIndicator({ id: "" }),
        CONTEXT,
        NOW,
      ).outcome,
    ).toBe("unsupported");
  });

  test("a missing pattern_type is treated as stix (the spec default)", () => {
    const indicator: JSONObject = buildStixIndicator();
    delete indicator["pattern_type"];

    expect(
      ThreatIntelFeedPoller.parseStixIndicator(indicator, CONTEXT, NOW).outcome,
    ).toBe("ingested");
  });

  test("minimum confidence filters scored indicators but never unscored ones", () => {
    const strictContext: StixParseContext = {
      ...CONTEXT,
      minimumConfidence: 50,
    };

    expect(
      ThreatIntelFeedPoller.parseStixIndicator(
        buildStixIndicator({ confidence: 30 }),
        strictContext,
        NOW,
      ).outcome,
    ).toBe("filtered");

    expect(
      ThreatIntelFeedPoller.parseStixIndicator(
        buildStixIndicator({ confidence: 50 }),
        strictContext,
        NOW,
      ).outcome,
    ).toBe("ingested");

    const unscored: JSONObject = buildStixIndicator();
    delete unscored["confidence"];

    const result: StixIndicatorParseResult =
      ThreatIntelFeedPoller.parseStixIndicator(unscored, strictContext, NOW);
    expect(result.outcome).toBe("ingested");
    expect(result.rows[0]!["confidence"]).toBe(0);
  });

  test("confidence is clamped to 0-100 whole numbers", () => {
    expect(
      ThreatIntelFeedPoller.parseStixIndicator(
        buildStixIndicator({ confidence: 250 }),
        CONTEXT,
        NOW,
      ).rows[0]!["confidence"],
    ).toBe(100);

    expect(
      ThreatIntelFeedPoller.parseStixIndicator(
        buildStixIndicator({ confidence: -5 }),
        CONTEXT,
        NOW,
      ).rows[0]!["confidence"],
    ).toBe(0);
  });

  test("deactivations are INGESTED, never skipped: revocations and already-expired updates", () => {
    /*
     * An update whose valid_until moved into the past is the other
     * standard STIX deactivation idiom. Skipping it would leave the
     * older, still-active version the argMax winner forever — so it
     * lands as a newer, dead-on-arrival version.
     */
    const expired: StixIndicatorParseResult =
      ThreatIntelFeedPoller.parseStixIndicator(
        buildStixIndicator({ valid_until: "2026-01-01T00:00:00.000Z" }),
        CONTEXT,
        NOW,
      );

    expect(expired.outcome).toBe("ingested");
    expect(expired.deadOnArrival).toBe(true);
    expect(expired.rows[0]!["revoked"]).toBe(false);

    const revoked: StixIndicatorParseResult =
      ThreatIntelFeedPoller.parseStixIndicator(
        buildStixIndicator({ revoked: true }),
        CONTEXT,
        NOW,
      );

    expect(revoked.outcome).toBe("ingested");
    expect(revoked.deadOnArrival).toBe(true);
    expect(revoked.rows[0]!["revoked"]).toBe(true);
  });

  test("dead-on-arrival rows get tombstone retention at least a year out — TTL must never drop the mask before what it masks", () => {
    const expired: StixIndicatorParseResult =
      ThreatIntelFeedPoller.parseStixIndicator(
        buildStixIndicator({ valid_until: "2026-01-01T00:00:00.000Z" }),
        CONTEXT,
        NOW,
      );

    const retention: Date = new Date(String(expired.rows[0]!["retentionDate"]));
    const daysOut: number =
      (retention.getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000);

    expect(daysOut).toBeGreaterThanOrEqual(365);
  });

  test("revocations bypass the confidence filter — retractions are not new claims", () => {
    const strictContext: StixParseContext = {
      ...CONTEXT,
      minimumConfidence: 50,
    };

    const revoked: StixIndicatorParseResult =
      ThreatIntelFeedPoller.parseStixIndicator(
        buildStixIndicator({ revoked: true, confidence: 30 }),
        strictContext,
        NOW,
      );

    expect(revoked.outcome).toBe("ingested");
    expect(revoked.rows[0]!["revoked"]).toBe(true);
  });

  test("a missing valid_until defaults forward from valid_from, not to expiry", () => {
    const indicator: JSONObject = buildStixIndicator();
    delete indicator["valid_until"];

    const result: StixIndicatorParseResult =
      ThreatIntelFeedPoller.parseStixIndicator(indicator, CONTEXT, NOW);

    expect(result.outcome).toBe("ingested");
    expect(result.deadOnArrival).toBe(false);
  });

  test("far-future dates are clamped to the ClickHouse-representable range", () => {
    /*
     * 9999-12-31 is a common "never expires" idiom; unclamped it
     * overflows DateTime64 and lands retentionDate in a wrapped ~1970
     * partition that TTL would drop immediately.
     */
    const result: StixIndicatorParseResult =
      ThreatIntelFeedPoller.parseStixIndicator(
        buildStixIndicator({ valid_until: "9999-12-31T23:59:59.000Z" }),
        CONTEXT,
        NOW,
      );

    expect(result.outcome).toBe("ingested");
    expect(result.deadOnArrival).toBe(false);

    // A day of slack: ClickHouse strings parse in local time here.
    const validUntil: Date = new Date(String(result.rows[0]!["validUntil"]));
    expect(validUntil.getTime()).toBeLessThanOrEqual(
      MAX_INDICATOR_DATE_MILLIS + 24 * 60 * 60 * 1000,
    );

    const retention: Date = new Date(String(result.rows[0]!["retentionDate"]));
    expect(retention.getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe("ThreatIntelFeedPoller.pollFeed", () => {
  test("a single drained page ingests rows, advances the header cursor, and clears errors", async () => {
    const { client } = buildClientServingPages([
      {
        objects: [
          buildStixIndicator(),
          buildStixIndicator({
            id: "indicator--0002",
            pattern: "[process:name = 'evil.exe']",
          }),
        ],
        more: false,
        next: null,
        dateAddedLast: "2026-08-27T11:59:00.000Z",
      },
    ]);

    const result: FeedPollResult = await ThreatIntelFeedPoller.pollFeed(
      buildFeed(),
      client,
    );

    expect(result.pages).toBe(1);
    expect(result.objectsFetched).toBe(2);
    expect(result.indicatorRowsIngested).toBe(1);
    expect(result.unsupportedPatterns).toBe(1);
    expect(result.drained).toBe(true);

    expect(insertSpy).toHaveBeenCalledTimes(1);

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const update: JSONObject = updateSpy.mock.calls[0]![0] as JSONObject;
    const data: JSONObject = update["data"] as JSONObject;
    expect(data["cursor"]).toBe("2026-08-27T11:59:00.000Z");
    expect(data["lastError"]).toBeNull();
    expect(String(data["lastPollSummary"])).toContain("2 STIX objects");
    expect(String(data["lastPollSummary"])).toContain("1 unsupported pattern");

    expect(invalidateSpy).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("pages through next tokens, repeating the original added_after", async () => {
    const { client, calls } = buildClientServingPages([
      {
        objects: [buildStixIndicator()],
        more: true,
        next: "token-2",
        dateAddedLast: "2026-08-27T11:00:00.000Z",
      },
      {
        objects: [buildStixIndicator({ id: "indicator--0002" })],
        more: false,
        next: null,
        dateAddedLast: "2026-08-27T11:30:00.000Z",
      },
    ]);

    const result: FeedPollResult = await ThreatIntelFeedPoller.pollFeed(
      buildFeed({ cursor: "2026-08-27T10:00:00.000Z" }),
      client,
    );

    expect(result.pages).toBe(2);
    expect(result.indicatorRowsIngested).toBe(2);
    expect(calls[0]!["addedAfter"]).toBe("2026-08-27T10:00:00.000Z");
    expect(calls[0]!["next"]).toBeUndefined();
    expect(calls[1]!["addedAfter"]).toBe("2026-08-27T10:00:00.000Z");
    expect(calls[1]!["next"]).toBe("token-2");

    // The newest header wins the cursor.
    const data: JSONObject = (updateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;
    expect(data["cursor"]).toBe("2026-08-27T11:30:00.000Z");
  });

  test("the per-tick page cap bounds a huge initial sync and reports the remainder", async () => {
    const { client, calls } = buildClientServingPages([
      {
        objects: [buildStixIndicator()],
        more: true,
        next: "again",
        dateAddedLast: "2026-08-27T11:45:00.000Z",
      },
    ]);

    const result: FeedPollResult = await ThreatIntelFeedPoller.pollFeed(
      buildFeed(),
      client,
    );

    expect(result.pages).toBe(MAX_PAGES_PER_POLL);
    expect(calls).toHaveLength(MAX_PAGES_PER_POLL);
    expect(result.drained).toBe(false);

    const data: JSONObject = (updateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;
    // Header cursor still advances — the next tick resumes from it.
    expect(data["cursor"]).toBe("2026-08-27T11:45:00.000Z");
    expect(String(data["lastPollSummary"])).toContain("more pages remain");
  });

  test("more without a next token stops the tick; the cursor resumes the sync", async () => {
    const { client, calls } = buildClientServingPages([
      {
        objects: [buildStixIndicator()],
        more: true,
        next: null,
        dateAddedLast: "2026-08-27T11:50:00.000Z",
      },
    ]);

    const result: FeedPollResult = await ThreatIntelFeedPoller.pollFeed(
      buildFeed(),
      client,
    );

    expect(calls).toHaveLength(1);
    expect(result.drained).toBe(false);
  });

  test("a drained poll from a server with no date-added-last header falls back to a time cursor", async () => {
    const { client } = buildClientServingPages([
      {
        objects: [],
        more: false,
        next: null,
        dateAddedLast: null,
      },
    ]);

    await ThreatIntelFeedPoller.pollFeed(buildFeed(), client);

    const data: JSONObject = (updateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;
    const cursor: Date = new Date(String(data["cursor"]));
    expect(Number.isNaN(cursor.getTime())).toBe(false);
    // About a minute of overlap behind "now".
    expect(
      OneUptimeDate.getCurrentDate().getTime() - cursor.getTime(),
    ).toBeGreaterThanOrEqual(55 * 1000);
  });

  test("an undrained poll with no header keeps the old cursor — advancing would skip objects forever", async () => {
    const { client } = buildClientServingPages([
      {
        objects: [buildStixIndicator()],
        more: true,
        next: null,
        dateAddedLast: null,
      },
    ]);

    await ThreatIntelFeedPoller.pollFeed(
      buildFeed({ cursor: "2026-08-27T10:00:00.000Z" }),
      client,
    );

    const data: JSONObject = (updateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;
    expect(data["cursor"]).toBeUndefined();
  });

  test("no enricher invalidation when nothing was ingested", async () => {
    const { client } = buildClientServingPages([
      { objects: [], more: false, next: null, dateAddedLast: null },
    ]);

    await ThreatIntelFeedPoller.pollFeed(buildFeed(), client);

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  test("a feed missing its essentials throws instead of polling garbage", async () => {
    const feed: ThreatIntelFeed = buildFeed();
    feed.apiRootUrl = "" as unknown as string;

    await expect(ThreatIntelFeedPoller.pollFeed(feed)).rejects.toThrow();
  });

  test("new versions inherit their object's stored retention ceiling — a superseding row must outlive what it masks", async () => {
    storedVersionsSpy.mockResolvedValue([
      {
        stixId: "indicator--0001",
        indicatorValue: "198.51.100.7",
        indicatorType: "ipv4-addr",
        indicatorName: "Known C2 address",
        confidence: 85,
        version: new Date("2026-08-01T00:00:00.000Z").getTime(),
        validFrom: "2026-08-01 00:00:00",
        validUntil: "2028-06-01 00:00:00",
        retentionDate: "2028-06-02 00:00:00",
      },
    ] as never);

    const { client } = buildClientServingPages([
      {
        // An update that shortens validity into the near future.
        objects: [
          buildStixIndicator({ valid_until: "2026-09-01T00:00:00.000Z" }),
        ],
        more: false,
        next: null,
        dateAddedLast: null,
      },
    ]);

    await ThreatIntelFeedPoller.pollFeed(buildFeed(), client);

    const rows: Array<JSONObject> = insertSpy.mock
      .calls[0]![0] as Array<JSONObject>;
    const retention: Date = new Date(String(rows[0]!["retentionDate"]));

    // Raised to the stored 2028 ceiling, not its own 2026-09-02.
    expect(retention.getFullYear()).toBe(2028);
  });

  test("values dropped by an updated pattern are retracted with tombstone versions", async () => {
    storedVersionsSpy.mockResolvedValue([
      {
        stixId: "indicator--0001",
        indicatorValue: "198.51.100.7",
        indicatorType: "ipv4-addr",
        indicatorName: "Known C2 address",
        confidence: 85,
        version: new Date("2026-08-01T00:00:00.000Z").getTime(),
        validFrom: "2026-08-01 00:00:00",
        validUntil: "2026-12-31 00:00:00",
        retentionDate: "2027-01-01 00:00:00",
      },
      {
        stixId: "indicator--0001",
        indicatorValue: "203.0.113.9",
        indicatorType: "ipv4-addr",
        indicatorName: "Known C2 address",
        confidence: 85,
        version: new Date("2026-08-01T00:00:00.000Z").getTime(),
        validFrom: "2026-08-01 00:00:00",
        validUntil: "2026-12-31 00:00:00",
        retentionDate: "2027-01-01 00:00:00",
      },
    ] as never);

    const { client } = buildClientServingPages([
      {
        /*
         * The update (modified 2026-08-21, newer than stored 2026-08-01)
         * keeps 198.51.100.7 and drops 203.0.113.9.
         */
        objects: [buildStixIndicator()],
        more: false,
        next: null,
        dateAddedLast: null,
      },
    ]);

    const result: FeedPollResult = await ThreatIntelFeedPoller.pollFeed(
      buildFeed(),
      client,
    );

    expect(result.valuesRetracted).toBe(1);

    const rows: Array<JSONObject> = insertSpy.mock
      .calls[0]![0] as Array<JSONObject>;
    const tombstone: JSONObject | undefined = rows.find(
      (row: JSONObject): boolean => {
        return row["indicatorValue"] === "203.0.113.9";
      },
    );

    expect(tombstone).toBeDefined();
    expect(tombstone!["revoked"]).toBe(true);
    expect(tombstone!["stixId"]).toBe("indicator--0001");
    // The tombstone carries the UPDATE's version, so it wins the argMax.
    expect(tombstone!["version"]).toBe(
      new Date("2026-08-21T00:00:00.000Z").getTime(),
    );

    // Retraction changes match state — the enricher cache must drop.
    expect(invalidateSpy).toHaveBeenCalled();

    const data: JSONObject = (updateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;
    expect(String(data["lastPollSummary"])).toContain("retracted 1 value");
  });

  test("a stored value is NOT retracted when the stored version is newer than the fetched object", async () => {
    storedVersionsSpy.mockResolvedValue([
      {
        stixId: "indicator--0001",
        indicatorValue: "203.0.113.9",
        indicatorType: "ipv4-addr",
        indicatorName: "Known C2 address",
        confidence: 85,
        // Stored is NEWER than the page's 2026-08-21 modified.
        version: new Date("2026-09-01T00:00:00.000Z").getTime(),
        validFrom: "2026-08-01 00:00:00",
        validUntil: "2026-12-31 00:00:00",
        retentionDate: "2027-01-01 00:00:00",
      },
    ] as never);

    const { client } = buildClientServingPages([
      {
        objects: [buildStixIndicator()],
        more: false,
        next: null,
        dateAddedLast: null,
      },
    ]);

    const result: FeedPollResult = await ThreatIntelFeedPoller.pollFeed(
      buildFeed(),
      client,
    );

    expect(result.valuesRetracted).toBe(0);
  });

  test("a saved page token resumes an interrupted pagination with the unchanged cursor", async () => {
    const { client, calls } = buildClientServingPages([
      {
        objects: [],
        more: false,
        next: null,
        dateAddedLast: null,
      },
    ]);

    const feed: ThreatIntelFeed = buildFeed({
      cursor: "2026-08-27T10:00:00.000Z",
    });
    feed.nextPageToken = "saved-token";

    await ThreatIntelFeedPoller.pollFeed(feed, client);

    expect(calls[0]!["next"]).toBe("saved-token");
    expect(calls[0]!["addedAfter"]).toBe("2026-08-27T10:00:00.000Z");

    // Drained: the token is cleared.
    const data: JSONObject = (updateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;
    expect(data["nextPageToken"]).toBeNull();
  });

  test("an undrained poll on a header-less server persists the next token — the sync must progress", async () => {
    const { client } = buildClientServingPages([
      {
        objects: [buildStixIndicator()],
        more: true,
        next: "token-for-next-page",
        dateAddedLast: null,
      },
    ]);

    await ThreatIntelFeedPoller.pollFeed(buildFeed(), client);

    const data: JSONObject = (updateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;
    expect(data["nextPageToken"]).toBe("token-for-next-page");
    expect(String(data["lastPollSummary"])).toContain("saved page token");
  });

  test("a header cursor supersedes the page token — tokens pair with the added_after they were issued under", async () => {
    const { client } = buildClientServingPages([
      {
        objects: [buildStixIndicator()],
        more: true,
        next: "token-2",
        dateAddedLast: "2026-08-27T11:45:00.000Z",
      },
    ]);

    await ThreatIntelFeedPoller.pollFeed(buildFeed(), client);

    const data: JSONObject = (updateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;
    expect(data["cursor"]).toBe("2026-08-27T11:45:00.000Z");
    expect(data["nextPageToken"]).toBeNull();
  });

  test("more with neither next token nor header is reported as a stall, not as progress", async () => {
    const { client } = buildClientServingPages([
      {
        objects: [buildStixIndicator()],
        more: true,
        next: null,
        dateAddedLast: null,
      },
    ]);

    await ThreatIntelFeedPoller.pollFeed(buildFeed(), client);

    const data: JSONObject = (updateSpy.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;
    expect(data["nextPageToken"]).toBeNull();
    expect(String(data["lastPollSummary"])).toContain("no resume point");
  });
});

describe("ThreatIntelFeedPoller.pollAllDueFeeds", () => {
  function stubFeedList(feeds: Array<ThreatIntelFeed>): Spy {
    return getJestSpyOn(ThreatIntelFeedService, "findBy").mockResolvedValue(
      feeds as never,
    );
  }

  test("skips feeds that are not due yet", async () => {
    stubFeedList([
      buildFeed({
        lastPolledAt: OneUptimeDate.getCurrentDate(),
        pollIntervalInMinutes: 60,
      }),
    ]);

    const pollSpy: Spy = getJestSpyOn(
      ThreatIntelFeedPoller,
      "pollFeed",
    ).mockResolvedValue({} as never);

    await ThreatIntelFeedPoller.pollAllDueFeeds();

    expect(pollSpy).not.toHaveBeenCalled();
  });

  test("polls a due feed and records a failure on the row without stopping the loop", async () => {
    const failing: ThreatIntelFeed = buildFeed();
    const healthy: ThreatIntelFeed = buildFeed();
    healthy._id = new ObjectID(
      "33333333-3333-4333-8333-333333333333",
    ).toString();

    stubFeedList([failing, healthy]);

    const pollSpy: Spy = getJestSpyOn(ThreatIntelFeedPoller, "pollFeed")
      .mockRejectedValueOnce(new Error("TAXII server exploded") as never)
      .mockResolvedValueOnce({} as never);

    await ThreatIntelFeedPoller.pollAllDueFeeds();

    // Both feeds were attempted despite the first one's failure.
    expect(pollSpy).toHaveBeenCalledTimes(2);

    // The failure was stamped onto the failing row.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const update: JSONObject = updateSpy.mock.calls[0]![0] as JSONObject;
    expect((update["id"] as ObjectID).toString()).toBe(FEED_ID.toString());
    const data: JSONObject = update["data"] as JSONObject;
    expect(String(data["lastError"])).toContain("TAXII server exploded");
    expect(String(data["lastError"]).length).toBeLessThanOrEqual(
      MAX_CONNECTOR_ERROR_MESSAGE_LENGTH,
    );
    expect(data["lastPolledAt"]).toBeInstanceOf(Date);
  });

  test("even the failure write failing does not take the loop down", async () => {
    stubFeedList([buildFeed()]);

    getJestSpyOn(ThreatIntelFeedPoller, "pollFeed").mockRejectedValue(
      new Error("poll failed") as never,
    );
    updateSpy.mockRejectedValue(new Error("db down") as never);

    await expect(
      ThreatIntelFeedPoller.pollAllDueFeeds(),
    ).resolves.toBeUndefined();
  });
});
