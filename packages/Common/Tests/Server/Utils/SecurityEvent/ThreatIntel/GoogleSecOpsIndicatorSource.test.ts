import GoogleSecOpsIndicatorSource, {
  GOOGLE_SECOPS_IOC_WINDOW_OVERLAP_IN_MINUTES,
  GoogleSecOpsFeedPollResult,
  GoogleSecOpsIocReader,
} from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/GoogleSecOpsIndicatorSource";
import { GoogleSecOpsIocMatchesResult } from "../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import { SecurityConnectorSettings } from "../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import SecurityEventConnectionService from "../../../../../Server/Services/SecurityEventConnectionService";
import ThreatIntelIndicatorService from "../../../../../Server/Services/ThreatIntelIndicatorService";
import SecurityEventConnection from "../../../../../Models/DatabaseModels/SecurityEventConnection";
import ThreatIntelFeed from "../../../../../Models/DatabaseModels/ThreatIntelFeed";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import ThreatIntelFeedType, {
  THREAT_INTEL_GOOGLE_SECOPS_INDICATOR_ID,
  THREAT_INTEL_GOOGLE_SECOPS_MAX_MATCHES,
} from "../../../../../Types/SecurityEvent/ThreatIntelFeedType";
import {
  API_BASE,
  CONNECTION_SETTINGS,
  FakeChronicle,
  RecordedCall,
  fakeChronicle,
  googleError,
} from "../Connectors/AlertClosing/GoogleSecOpsFakeApi";
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
 * A Google SecOps feed brings the indicators Google SecOps's threat
 * intelligence found in its events into OneUptime, through one of the
 * project's Google SecOps connections, so the rest of the project's events
 * are matched against them too. The real GoogleSecOpsClient is driven
 * against a fake Google (GoogleSecOpsFakeApi): token exchange, the search's
 * query, 401/403/429 answers. ClickHouse and Postgres are stubbed at the
 * service boundary.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const FEED_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const NOW: Date = new Date("2026-10-21T12:00:00.000Z");
const SEARCH_URL: string = `${API_BASE}/legacy:legacySearchEnterpriseWideIoCs`;

function buildFeed(
  options: { cursor?: string; minimumConfidence?: number } = {},
): ThreatIntelFeed {
  const feed: ThreatIntelFeed = new ThreatIntelFeed();
  feed._id = FEED_ID.toString();
  feed.projectId = PROJECT_ID;
  feed.name = "Google SecOps IOCs";
  feed.feedType = ThreatIntelFeedType.GoogleSecOps;
  feed.securityEventConnectionId = CONNECTION_ID;
  feed.minimumConfidence = options.minimumConfidence ?? 0;
  if (options.cursor) {
    feed.cursor = options.cursor;
  }
  return feed;
}

function buildConnection(
  options: {
    projectId?: ObjectID;
    provider?: SecurityEventConnectorProvider;
  } = {},
): SecurityEventConnection {
  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection._id = CONNECTION_ID.toString();
  connection.projectId = options.projectId || PROJECT_ID;
  connection.provider =
    options.provider || SecurityEventConnectorProvider.GoogleSecOps;
  connection.name = "Google SecOps (prod)";
  return connection;
}

const C2_MATCH: JSONObject = {
  artifactIndicator: { domain: "C2.Evil.Example" },
  categories: ["Malware Command and Control Server"],
  confidenceScore: 95,
  firstSeenTimestamp: "2026-10-18T10:00:00Z",
  lastSeenTimestamp: "2026-10-20T12:00:00Z",
  associationIdentifier: [{ name: "APT29", associationType: "THREAT_ACTOR" }],
};

let insertSpy: Spy;
let connectionSpy: Spy;

function insertedRows(): Array<JSONObject> {
  return insertSpy.mock.calls.flatMap(
    (call: Array<unknown>): Array<JSONObject> => {
      return call[0] as Array<JSONObject>;
    },
  );
}

function reading(
  matches: Array<JSONObject>,
  moreDataAvailable: boolean = false,
): {
  factory: () => GoogleSecOpsIocReader;
  searches: Array<{ startTime: Date; endTime: Date; maxMatches: number }>;
} {
  const searches: Array<{
    startTime: Date;
    endTime: Date;
    maxMatches: number;
  }> = [];

  return {
    searches,
    factory: (): GoogleSecOpsIocReader => {
      return {
        searchEnterpriseIocMatches: async (data: {
          startTime: Date;
          endTime: Date;
          maxMatches: number;
        }): Promise<GoogleSecOpsIocMatchesResult> => {
          searches.push(data);
          return { matches, moreDataAvailable };
        },
      };
    },
  };
}

beforeEach(() => {
  insertSpy = getJestSpyOn(
    ThreatIntelIndicatorService,
    "insertJsonRows",
  ).mockResolvedValue(undefined as never);
  connectionSpy = getJestSpyOn(
    SecurityEventConnectionService,
    "findOneById",
  ).mockResolvedValue(buildConnection() as never);
  getJestSpyOn(
    SecurityEventConnectionService,
    "getConnectorSettings",
  ).mockResolvedValue(CONNECTION_SETTINGS as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the connection a feed reads through", () => {
  test("is read as OneUptime, by the feed's connection id", async () => {
    await GoogleSecOpsIndicatorSource.loadConnection(buildFeed());

    const args: JSONObject = connectionSpy.mock.calls[0]![0] as JSONObject;

    expect((args["id"] as ObjectID).toString()).toBe(CONNECTION_ID.toString());
    expect(args["props"]).toEqual({ isRoot: true });
  });

  test("a feed with none says how to choose one", async () => {
    const feed: ThreatIntelFeed = buildFeed();
    delete feed.securityEventConnectionId;

    await expect(
      GoogleSecOpsIndicatorSource.loadConnection(feed),
    ).rejects.toThrow(
      "Edit the feed and choose the Google SecOps connection it reads through.",
    );
  });

  test("a deleted connection, or another project's, is gone", async () => {
    connectionSpy.mockResolvedValue(null as never);

    await expect(
      GoogleSecOpsIndicatorSource.loadConnection(buildFeed()),
    ).rejects.toThrow(
      "The Google SecOps connection this feed read through was deleted.",
    );

    connectionSpy.mockResolvedValue(
      buildConnection({ projectId: OTHER_PROJECT_ID }) as never,
    );

    await expect(
      GoogleSecOpsIndicatorSource.loadConnection(buildFeed()),
    ).rejects.toThrow(
      "The Google SecOps connection this feed read through was deleted.",
    );
  });

  test("a connection to another product is not one", async () => {
    connectionSpy.mockResolvedValue(
      buildConnection({
        provider: SecurityEventConnectorProvider.OktaSystemLog,
      }) as never,
    );

    await expect(
      GoogleSecOpsIndicatorSource.loadConnection(buildFeed()),
    ).rejects.toThrow("is not a Google SecOps connection");
  });
});

describe("the window of match time one poll reads", () => {
  test("a first poll reads the last week", () => {
    expect(GoogleSecOpsIndicatorSource.windowFor(undefined, NOW)).toEqual({
      start: OneUptimeDate.addRemoveDays(NOW, -7),
      end: NOW,
    });
  });

  test("a later poll reads from the last one's end, less a quarter hour", () => {
    const lastEnd: Date = OneUptimeDate.addRemoveHours(NOW, -1);

    expect(
      GoogleSecOpsIndicatorSource.windowFor(lastEnd.toISOString(), NOW),
    ).toEqual({
      start: OneUptimeDate.addRemoveMinutes(
        lastEnd,
        -GOOGLE_SECOPS_IOC_WINDOW_OVERLAP_IN_MINUTES,
      ),
      end: NOW,
    });
  });

  test("a feed that stopped for a month starts again a week back", () => {
    expect(
      GoogleSecOpsIndicatorSource.windowFor(
        OneUptimeDate.addRemoveDays(NOW, -30).toISOString(),
        NOW,
      ).start,
    ).toEqual(OneUptimeDate.addRemoveDays(NOW, -7));
  });

  test("a cursor in the future, or not a date, still reads a window that ends now", () => {
    const future: { start: Date; end: Date } =
      GoogleSecOpsIndicatorSource.windowFor(
        OneUptimeDate.addRemoveDays(NOW, 2).toISOString(),
        NOW,
      );

    expect(future.end).toEqual(NOW);
    expect(future.start).toEqual(
      OneUptimeDate.addRemoveMinutes(
        NOW,
        -GOOGLE_SECOPS_IOC_WINDOW_OVERLAP_IN_MINUTES,
      ),
    );

    expect(GoogleSecOpsIndicatorSource.windowFor("garbage", NOW).start).toEqual(
      OneUptimeDate.addRemoveDays(NOW, -7),
    );
  });
});

describe("a poll", () => {
  test("asks Google SecOps for the window's matches, with Mandiant's attributes", async () => {
    const google: FakeChronicle = fakeChronicle(
      (): { status: number; body: string } => {
        return { status: 200, body: JSON.stringify({ matches: [C2_MATCH] }) };
      },
    );

    await GoogleSecOpsIndicatorSource.poll(
      buildFeed({
        cursor: OneUptimeDate.addRemoveHours(NOW, -1).toISOString(),
      }),
      {
        readerFactory: (
          settings: SecurityConnectorSettings,
        ): GoogleSecOpsIocReader => {
          return GoogleSecOpsIndicatorSource.createReader(
            settings,
            google.fetchImplementation,
          );
        },
        now: NOW,
      },
    );

    expect(google.tokenRequests).toBe(1);
    expect(google.calls).toHaveLength(1);

    const call: RecordedCall = google.calls[0]!;
    const url: URL = new URL(call.url);

    expect(call.method).toBe("GET");
    expect(call.authorization).toBe("Bearer token-1");
    expect(`${url.origin}${url.pathname}`).toBe(SEARCH_URL);
    expect(url.searchParams.get("timestampRange.startTime")).toBe(
      "2026-10-21T10:45:00.000Z",
    );
    expect(url.searchParams.get("timestampRange.endTime")).toBe(
      "2026-10-21T12:00:00.000Z",
    );
    expect(url.searchParams.get("maxMatchesToReturn")).toBe(
      String(THREAT_INTEL_GOOGLE_SECOPS_MAX_MATCHES),
    );
    expect(url.searchParams.get("addMandiantAttributes")).toBe("true");
  });

  test("writes each artifact as an indicator, active for 30 days after Google SecOps last saw it", async () => {
    const result: GoogleSecOpsFeedPollResult =
      await GoogleSecOpsIndicatorSource.poll(buildFeed(), {
        readerFactory: reading([C2_MATCH]).factory,
        now: NOW,
      });

    expect(result).toMatchObject({
      matches: 1,
      indicators: 1,
      muted: 0,
      filtered: 0,
      unsupported: 0,
      moreAvailable: false,
      cursor: NOW.toISOString(),
    });

    expect(insertedRows()).toEqual([
      expect.objectContaining({
        projectId: PROJECT_ID.toString(),
        feedId: FEED_ID.toString(),
        feedName: "Google SecOps IOCs",
        stixId: THREAT_INTEL_GOOGLE_SECOPS_INDICATOR_ID,
        indicatorType: "domain-name",
        indicatorValue: "c2.evil.example",
        indicatorName: "Malware Command and Control Server: APT29",
        confidence: 95,
        stixLabels: ["Malware Command and Control Server", "APT29"],
        revoked: false,
        version: NOW.getTime(),
        validFrom: OneUptimeDate.toClickhouseDateTime64(
          new Date("2026-10-18T10:00:00Z"),
        ),
        validUntil: OneUptimeDate.toClickhouseDateTime64(
          OneUptimeDate.addRemoveDays(new Date("2026-10-20T12:00:00Z"), 30),
        ),
        retentionDate: OneUptimeDate.toClickhouseDateTime(
          OneUptimeDate.addRemoveDays(NOW, 31),
        ),
      }),
    ]);
  });

  test("an indicator its feed says ends sooner ends then", async () => {
    await GoogleSecOpsIndicatorSource.poll(buildFeed(), {
      readerFactory: reading([
        {
          ...C2_MATCH,
          activeTimerange: { endTime: "2026-10-25T00:00:00Z" },
        },
      ]).factory,
      now: NOW,
    });

    expect(insertedRows()[0]!["validUntil"]).toBe(
      OneUptimeDate.toClickhouseDateTime64(new Date("2026-10-25T00:00:00Z")),
    );
  });

  test("a sighting dated in the future counts from now", async () => {
    await GoogleSecOpsIndicatorSource.poll(buildFeed(), {
      readerFactory: reading([
        {
          artifactIndicator: { domain: "evil.example" },
          firstSeenTimestamp: "2027-01-01T00:00:00Z",
          lastSeenTimestamp: "2027-01-02T00:00:00Z",
        },
      ]).factory,
      now: NOW,
    });

    expect(insertedRows()[0]).toMatchObject({
      validFrom: OneUptimeDate.toClickhouseDateTime64(NOW),
      validUntil: OneUptimeDate.toClickhouseDateTime64(
        OneUptimeDate.addRemoveDays(NOW, 30),
      ),
    });
  });

  test("one muted in Google SecOps is let go here too", async () => {
    const result: GoogleSecOpsFeedPollResult =
      await GoogleSecOpsIndicatorSource.poll(buildFeed(), {
        readerFactory: reading([{ ...C2_MATCH, iocState: "STATUS_MUTED" }])
          .factory,
        now: NOW,
      });

    expect(result).toMatchObject({ indicators: 0, muted: 1 });
    expect(insertedRows()[0]).toMatchObject({
      indicatorValue: "c2.evil.example",
      revoked: true,
      validUntil: OneUptimeDate.toClickhouseDateTime64(NOW),
    });
  });

  test("one below the feed's minimum confidence is left out; an unscored one is kept", async () => {
    const result: GoogleSecOpsFeedPollResult =
      await GoogleSecOpsIndicatorSource.poll(
        buildFeed({ minimumConfidence: 60 }),
        {
          readerFactory: reading([
            {
              artifactIndicator: { domain: "weak.example" },
              confidenceScore: 30,
            },
            { artifactIndicator: { domain: "unscored.example" } },
            C2_MATCH,
          ]).factory,
          now: NOW,
        },
      );

    expect(result).toMatchObject({ indicators: 2, filtered: 1 });
    expect(
      insertedRows().map((row: JSONObject): unknown => {
        return row["indicatorValue"];
      }),
    ).toEqual(["unscored.example", "c2.evil.example"]);
  });

  test("matches about nothing OneUptime can match are counted, and the same artifact twice is one indicator", async () => {
    const result: GoogleSecOpsFeedPollResult =
      await GoogleSecOpsIndicatorSource.poll(buildFeed(), {
        readerFactory: reading([
          C2_MATCH,
          { ...C2_MATCH, confidenceScore: 40 },
          { assetIndicators: [{ hostname: "laptop-7" }] },
        ]).factory,
        now: NOW,
      });

    expect(result).toMatchObject({ matches: 3, indicators: 1, unsupported: 1 });
    expect(insertedRows()).toHaveLength(1);
    expect(insertedRows()[0]!["confidence"]).toBe(95);
  });

  test("more matches than one poll reads is said", async () => {
    const result: GoogleSecOpsFeedPollResult =
      await GoogleSecOpsIndicatorSource.poll(buildFeed(), {
        readerFactory: reading([C2_MATCH], true).factory,
        now: NOW,
      });

    expect(result.moreAvailable).toBe(true);
    expect(GoogleSecOpsIndicatorSource.describeResult(result)).toContain(
      "Google SecOps had more than 10,000 matches, so the most recent were read",
    );
  });

  test("no match writes nothing, and still moves the window on", async () => {
    const result: GoogleSecOpsFeedPollResult =
      await GoogleSecOpsIndicatorSource.poll(buildFeed(), {
        readerFactory: reading([]).factory,
        now: NOW,
      });

    expect(insertSpy).not.toHaveBeenCalled();
    expect(result.cursor).toBe(NOW.toISOString());
  });
});

describe("Google SecOps answering with an error", () => {
  function pollAgainst(
    google: FakeChronicle,
  ): Promise<GoogleSecOpsFeedPollResult> {
    return GoogleSecOpsIndicatorSource.poll(buildFeed(), {
      readerFactory: (
        settings: SecurityConnectorSettings,
      ): GoogleSecOpsIocReader => {
        return GoogleSecOpsIndicatorSource.createReader(
          settings,
          google.fetchImplementation,
        );
      },
      now: NOW,
    });
  }

  test("a token Google refused once is fetched again, and the search goes on", async () => {
    const google: FakeChronicle = fakeChronicle(
      (
        _call: RecordedCall,
        index: number,
      ): { status: number; body: string } => {
        return index === 0
          ? {
              status: 401,
              body: googleError(
                401,
                "Request had invalid authentication credentials.",
              ),
            }
          : { status: 200, body: JSON.stringify({ matches: [C2_MATCH] }) };
      },
    );

    const result: GoogleSecOpsFeedPollResult = await pollAgainst(google);

    expect(google.tokenRequests).toBe(2);
    expect(google.calls[1]!.authorization).toBe("Bearer token-2");
    expect(result.indicators).toBe(1);
  });

  test.each([
    [
      403,
      "Permission 'chronicle.legacies.legacySearchEnterpriseWideIoCs' denied",
    ],
    [429, "Quota exceeded"],
    [500, "Internal error"],
  ])(
    "HTTP %s fails the poll with Google's words, and writes nothing",
    async (status: number, message: string) => {
      const google: FakeChronicle = fakeChronicle(
        (): { status: number; body: string } => {
          return { status, body: googleError(status, message) };
        },
      );

      await expect(pollAgainst(google)).rejects.toThrow(`HTTP ${status}`);
      expect(insertSpy).not.toHaveBeenCalled();
    },
  );

  test("a connection whose key cannot be read fails before anything is asked", async () => {
    getJestSpyOn(
      SecurityEventConnectionService,
      "getConnectorSettings",
    ).mockResolvedValue({
      ...CONNECTION_SETTINGS,
      secrets: { serviceAccountJson: "not json" },
    } as never);

    const google: FakeChronicle = fakeChronicle();

    await expect(pollAgainst(google)).rejects.toThrow();
    expect(google.calls).toHaveLength(0);
  });
});

describe("what the feed's Last poll says", () => {
  const base: GoogleSecOpsFeedPollResult = {
    matches: 12,
    indicators: 9,
    muted: 0,
    filtered: 0,
    unsupported: 0,
    moreAvailable: false,
    windowStart: NOW,
    windowEnd: NOW,
    cursor: NOW.toISOString(),
  };

  test.each([
    [
      base,
      "Read 9 indicators Google SecOps found in your events (12 matches).",
    ],
    [
      { ...base, matches: 1, indicators: 1 },
      "Read 1 indicator Google SecOps found in your events (1 match).",
    ],
    [
      { ...base, muted: 2 },
      "Read 9 indicators Google SecOps found in your events (12 matches), revoked 2 indicators muted in Google SecOps.",
    ],
    [
      { ...base, filtered: 3 },
      "Read 9 indicators Google SecOps found in your events (12 matches), 3 below the minimum confidence.",
    ],
    [
      { ...base, unsupported: 1 },
      "Read 9 indicators Google SecOps found in your events (12 matches), skipped 1 match OneUptime cannot read.",
    ],
  ])("%j", (result: GoogleSecOpsFeedPollResult, summary: string) => {
    expect(GoogleSecOpsIndicatorSource.describeResult(result)).toBe(summary);
  });
});
