import ThreatIntelListSource, {
  ListFeedPollResult,
  THREAT_INTEL_LIST_REQUEST_TIMEOUT_IN_MS,
  hashListValues,
  looksLikeWebPage,
  readListCursor,
  writeListCursor,
} from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelListSource";
import { INDICATOR_INSERT_BATCH_SIZE } from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/IndicatorRows";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../Server/Utils/DataSource/HttpFetch";
import ThreatIntelIndicatorService from "../../../../../Server/Services/ThreatIntelIndicatorService";
import ThreatIntelFeed from "../../../../../Models/DatabaseModels/ThreatIntelFeed";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import OneUptimeDate from "../../../../../Types/Date";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ThreatIntelFeedType, {
  THREAT_INTEL_LIST_INDICATOR_ID,
  THREAT_INTEL_LIST_MAX_INDICATORS,
} from "../../../../../Types/SecurityEvent/ThreatIntelFeedType";
import IndicatorListParser from "../../../../../Utils/SecurityEvent/ThreatIntel/IndicatorListParser";
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
 * A list feed keeps its indicators the same as the list at its address:
 * every value on it written as the latest version of its indicator, every
 * value it no longer has let go, and an unchanged list not written again
 * until half its validity has passed. The download is a fake transport;
 * ClickHouse is stubbed at the service boundary.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const FEED_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const NOW: Date = new Date("2026-10-21T12:00:00.000Z");
const LIST_URL: string =
  "https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt";

const FEODO_LIST: string = [
  "################################################################",
  "# abuse.ch Feodo Tracker Botnet C2 IP Blocklist (recommended)  #",
  "################################################################",
  "# DstIP",
  "192.0.2.10",
  "198.51.100.20",
  "# END 2 entries",
].join("\n");

function buildFeed(
  options: { cursor?: string; confidence?: number } = {},
): ThreatIntelFeed {
  const feed: ThreatIntelFeed = new ThreatIntelFeed();
  feed._id = FEED_ID.toString();
  feed.projectId = PROJECT_ID;
  feed.name = "Feodo Tracker";
  feed.feedType = ThreatIntelFeedType.List;
  feed.listUrl = LIST_URL;
  feed.indicatorConfidence = options.confidence ?? 90;
  if (options.cursor) {
    feed.cursor = options.cursor;
  }
  return feed;
}

interface FakeDownload {
  fetch: (request: DataSourceHttpRequest) => Promise<DataSourceHttpResponse>;
  requests: Array<DataSourceHttpRequest>;
}

function serving(text: string): FakeDownload {
  const requests: Array<DataSourceHttpRequest> = [];

  return {
    requests,
    fetch: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      requests.push(request);
      return { statusCode: 200, bodyText: text, bodyJson: undefined };
    },
  };
}

let insertSpy: Spy;
let heldSpy: Spy;

function insertedRows(): Array<JSONObject> {
  return insertSpy.mock.calls.flatMap(
    (call: Array<unknown>): Array<JSONObject> => {
      return call[0] as Array<JSONObject>;
    },
  );
}

function holding(values: Array<string>): void {
  heldSpy.mockResolvedValue(
    values.map((value: string): JSONObject => {
      return { indicatorValue: value, indicatorType: "ipv4-addr" };
    }) as never,
  );
}

beforeEach(() => {
  insertSpy = getJestSpyOn(
    ThreatIntelIndicatorService,
    "insertJsonRows",
  ).mockResolvedValue(undefined as never);
  heldSpy = getJestSpyOn(
    ThreatIntelIndicatorService,
    "findActiveValuesForFeed",
  ).mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a list feed's first poll", () => {
  test("downloads the list through the egress guard, with a deadline", async () => {
    const download: FakeDownload = serving(FEODO_LIST);

    await ThreatIntelListSource.poll(buildFeed(), {
      fetchImplementation: download.fetch,
      now: NOW,
    });

    expect(download.requests).toHaveLength(1);
    expect(download.requests[0]).toMatchObject({
      method: "GET",
      url: LIST_URL,
      timeoutInMs: THREAT_INTEL_LIST_REQUEST_TIMEOUT_IN_MS,
      egressOptions: { targetLabel: "Threat intel list" },
    });
    expect(download.requests[0]!.headers!["Accept"]).toContain("text/plain");
  });

  test("writes every value on the list as an active indicator for two days", async () => {
    const result: ListFeedPollResult = await ThreatIntelListSource.poll(
      buildFeed(),
      { fetchImplementation: serving(FEODO_LIST).fetch, now: NOW },
    );

    expect(result).toMatchObject({
      lines: 2,
      indicators: 2,
      unchanged: false,
      letGo: 0,
    });

    const rows: Array<JSONObject> = insertedRows();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      projectId: PROJECT_ID.toString(),
      feedId: FEED_ID.toString(),
      feedName: "Feodo Tracker",
      stixId: THREAT_INTEL_LIST_INDICATOR_ID,
      indicatorType: "ipv4-addr",
      indicatorValue: "192.0.2.10",
      indicatorName: "",
      confidence: 90,
      stixLabels: [],
      revoked: false,
      version: NOW.getTime(),
      validFrom: OneUptimeDate.toClickhouseDateTime64(NOW),
      validUntil: OneUptimeDate.toClickhouseDateTime64(
        OneUptimeDate.addRemoveDays(NOW, 2),
      ),
      retentionDate: OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDays(NOW, 3),
      ),
    });
    expect(rows[1]!["indicatorValue"]).toBe("198.51.100.20");

    // It asked what the feed held, under the list's one indicator id.
    expect(heldSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      feedId: FEED_ID,
      stixId: THREAT_INTEL_LIST_INDICATOR_ID,
      now: NOW,
      limit: THREAT_INTEL_LIST_MAX_INDICATORS * 2,
    });
  });

  test("returns the cursor that remembers the list and when it was written", async () => {
    const result: ListFeedPollResult = await ThreatIntelListSource.poll(
      buildFeed(),
      { fetchImplementation: serving(FEODO_LIST).fetch, now: NOW },
    );

    const cursor: { hash: string; writtenAt: Date } | null = readListCursor(
      result.cursor,
    );

    expect(cursor).not.toBeNull();
    expect(cursor!.writtenAt.toISOString()).toBe(NOW.toISOString());
    expect(cursor!.hash).toBe(
      hashListValues(
        IndicatorListParser.parse(FEODO_LIST, { maxValues: 100 }).values,
      ),
    );
  });

  test("a feed with no confidence gives its indicators none (a Medium match)", async () => {
    const feed: ThreatIntelFeed = buildFeed();
    feed.indicatorConfidence = undefined;

    await ThreatIntelListSource.poll(feed, {
      fetchImplementation: serving("192.0.2.1").fetch,
      now: NOW,
    });

    expect(insertedRows()[0]!["confidence"]).toBe(0);
  });

  test("a long list is written in batches", async () => {
    const lines: Array<string> = [];

    for (
      let index: number = 0;
      index < INDICATOR_INSERT_BATCH_SIZE * 2 + 7;
      index++
    ) {
      lines.push(
        `10.${(index >> 16) & 255}.${(index >> 8) & 255}.${index & 255}`,
      );
    }

    await ThreatIntelListSource.poll(buildFeed(), {
      fetchImplementation: serving(lines.join("\n")).fetch,
      now: NOW,
    });

    expect(
      insertSpy.mock.calls.map((call: Array<unknown>): number => {
        return (call[0] as Array<JSONObject>).length;
      }),
    ).toEqual([INDICATOR_INSERT_BATCH_SIZE, INDICATOR_INSERT_BATCH_SIZE, 7]);
  });
});

describe("a list that changed", () => {
  test("lets go of every value it no longer has, at the same version, at once", async () => {
    holding(["192.0.2.10", "203.0.113.99"]);

    const result: ListFeedPollResult = await ThreatIntelListSource.poll(
      buildFeed(),
      { fetchImplementation: serving(FEODO_LIST).fetch, now: NOW },
    );

    expect(result.letGo).toBe(1);

    const rows: Array<JSONObject> = insertedRows();
    const letGo: Array<JSONObject> = rows.filter((row: JSONObject): boolean => {
      return row["revoked"] === true;
    });

    expect(rows).toHaveLength(3);
    expect(letGo).toHaveLength(1);
    expect(letGo[0]).toMatchObject({
      indicatorValue: "203.0.113.99",
      indicatorType: "ipv4-addr",
      stixId: THREAT_INTEL_LIST_INDICATOR_ID,
      version: NOW.getTime(),
      validUntil: OneUptimeDate.toClickhouseDateTime64(NOW),
      // Kept as long as any version it masks.
      retentionDate: OneUptimeDate.toClickhouseDateTime(
        OneUptimeDate.addRemoveDays(NOW, 3),
      ),
    });
  });

  test("an empty list lets every indicator go, and is not an error", async () => {
    holding(["192.0.2.10", "198.51.100.20"]);

    const result: ListFeedPollResult = await ThreatIntelListSource.poll(
      buildFeed(),
      {
        fetchImplementation: serving("# END 0 entries\n").fetch,
        now: NOW,
      },
    );

    expect(result).toMatchObject({ indicators: 0, letGo: 2 });
    expect(
      insertedRows().every((row: JSONObject): boolean => {
        return row["revoked"] === true;
      }),
    ).toBe(true);
  });
});

describe("a list that has not changed", () => {
  const writtenAgo: (hours: number) => string = (hours: number): string => {
    return writeListCursor({
      hash: hashListValues(
        IndicatorListParser.parse(FEODO_LIST, { maxValues: 100 }).values,
      ),
      writtenAt: OneUptimeDate.addRemoveHours(NOW, -hours),
    });
  };

  test("is not read from ClickHouse nor written within a day of its last write", async () => {
    const result: ListFeedPollResult = await ThreatIntelListSource.poll(
      buildFeed({ cursor: writtenAgo(3) }),
      { fetchImplementation: serving(FEODO_LIST).fetch, now: NOW },
    );

    expect(result).toMatchObject({ unchanged: true, indicators: 2 });
    expect(result.cursor).toBeUndefined();
    expect(heldSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  test("is the same list re-sorted, re-commented or with its lines repeated", async () => {
    const shuffled: string = [
      "# Generated again",
      "198.51.100.20",
      "",
      "192.0.2.10 # still here",
      "198.51.100.20",
    ].join("\n");

    const result: ListFeedPollResult = await ThreatIntelListSource.poll(
      buildFeed({ cursor: writtenAgo(1) }),
      { fetchImplementation: serving(shuffled).fetch, now: NOW },
    );

    expect(result.unchanged).toBe(true);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  test("is written again a day after its last write, so its indicators never lapse", async () => {
    const result: ListFeedPollResult = await ThreatIntelListSource.poll(
      buildFeed({ cursor: writtenAgo(25) }),
      { fetchImplementation: serving(FEODO_LIST).fetch, now: NOW },
    );

    expect(result.unchanged).toBe(false);
    expect(insertedRows()).toHaveLength(2);
    expect(readListCursor(result.cursor)!.writtenAt.toISOString()).toBe(
      NOW.toISOString(),
    );
  });

  test("a cursor written in the future (a clock that jumped) is not trusted", async () => {
    const result: ListFeedPollResult = await ThreatIntelListSource.poll(
      buildFeed({ cursor: writtenAgo(-5) }),
      { fetchImplementation: serving(FEODO_LIST).fetch, now: NOW },
    );

    expect(result.unchanged).toBe(false);
  });
});

describe("a list address that does not answer with a list", () => {
  test("a web page is refused, and nothing is let go", async () => {
    holding(["192.0.2.10"]);

    await expect(
      ThreatIntelListSource.poll(buildFeed(), {
        fetchImplementation: serving(
          '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">\n<html><head><title>410 Gone</title></head></html>',
        ).fetch,
        now: NOW,
      }),
    ).rejects.toThrow("answered with a web page");

    expect(insertSpy).not.toHaveBeenCalled();
  });

  test("text with no indicator in it is refused, and nothing is let go", async () => {
    holding(["192.0.2.10"]);

    await expect(
      ThreatIntelListSource.poll(buildFeed(), {
        fetchImplementation: serving(
          "Service temporarily unavailable\nTry later",
        ).fetch,
        now: NOW,
      }),
    ).rejects.toThrow(
      "The list has 2 lines but no IP address, domain, URL or file hash OneUptime can match.",
    );

    expect(insertSpy).not.toHaveBeenCalled();
  });

  test("a download that fails says why, and nothing is written", async () => {
    await expect(
      ThreatIntelListSource.poll(buildFeed(), {
        fetchImplementation: async (): Promise<DataSourceHttpResponse> => {
          throw new BadDataException(
            "Data source responded with HTTP 404: Not Found",
          );
        },
        now: NOW,
      }),
    ).rejects.toThrow("HTTP 404");

    expect(insertSpy).not.toHaveBeenCalled();
  });

  test("a feed with no address says how to fix it", async () => {
    const feed: ThreatIntelFeed = buildFeed();
    feed.listUrl = undefined;

    await expect(
      ThreatIntelListSource.poll(feed, {
        fetchImplementation: serving(FEODO_LIST).fetch,
        now: NOW,
      }),
    ).rejects.toThrow("Edit the feed and add the address of the list.");
  });
});

describe("the list's address", () => {
  test.each([
    LIST_URL,
    "https://check.torproject.org/torbulkexitlist",
    "https://lists.example.com/c2.txt?format=plain",
  ])("%s is one", (url: string) => {
    expect(() => {
      ThreatIntelListSource.validateListUrl(url);
    }).not.toThrow();
  });

  test.each([
    ["http://lists.example.com/c2.txt", "List URL must start with https://."],
    ["ftp://lists.example.com/c2.txt", "List URL must start with https://."],
    ["not a url", "List URL must be a valid address"],
    ["", "List URL must be a valid address"],
    [
      "https://user:secret@lists.example.com/c2.txt",
      "must not hold a user name or password",
    ],
    [`https://lists.example.com/${"a".repeat(500)}`, "at most 500 characters"],
  ])("%s is refused", (url: string, message: string) => {
    expect(() => {
      ThreatIntelListSource.validateListUrl(url);
    }).toThrow(message);
  });
});

describe("the cursor and the hash", () => {
  test("a cursor round-trips, and anything else is no cursor", () => {
    const cursor: string = writeListCursor({
      hash: "a".repeat(64),
      writtenAt: NOW,
    });

    expect(cursor).toBe(`sha256:${"a".repeat(64)}@2026-10-21T12:00:00.000Z`);
    expect(readListCursor(cursor)).toEqual({
      hash: "a".repeat(64),
      writtenAt: NOW,
    });

    for (const other of [
      undefined,
      "",
      "2026-10-21T12:00:00Z",
      "sha256:abc@2026-10-21T12:00:00Z",
      `sha256:${"a".repeat(64)}`,
      `sha256:${"a".repeat(64)}@not a date`,
    ]) {
      expect(readListCursor(other)).toBeNull();
    }
  });

  test("the hash is of the values, not the text", () => {
    const one: string = hashListValues(
      IndicatorListParser.parse("192.0.2.1\nevil.example", { maxValues: 10 })
        .values,
    );
    const same: string = hashListValues(
      IndicatorListParser.parse("# x\nEVIL.example\n192.0.2.1:80", {
        maxValues: 10,
      }).values,
    );
    const other: string = hashListValues(
      IndicatorListParser.parse("192.0.2.2\nevil.example", { maxValues: 10 })
        .values,
    );

    expect(one).toHaveLength(64);
    expect(same).toBe(one);
    expect(other).not.toBe(one);
  });

  test("a web page is told by its start", () => {
    expect(looksLikeWebPage("<!DOCTYPE html><html>")).toBe(true);
    expect(looksLikeWebPage("\n  <HTML><body>")).toBe(true);
    expect(looksLikeWebPage("# <html> in a comment\n192.0.2.1")).toBe(false);
    expect(looksLikeWebPage("192.0.2.1")).toBe(false);
  });
});

describe("what the feed's Last poll says", () => {
  const base: ListFeedPollResult = {
    lines: 3,
    indicators: 1234,
    duplicates: 0,
    unsupported: 0,
    overLimit: 0,
    unchanged: false,
    letGo: 0,
  };

  test.each([
    [base, "Read 1,234 indicators from the list."],
    [{ ...base, indicators: 1 }, "Read 1 indicator from the list."],
    [
      { ...base, unchanged: true },
      "The list has not changed: 1,234 indicators.",
    ],
    [
      { ...base, letGo: 3 },
      "Read 1,234 indicators from the list, let go of 3 indicators no longer on it.",
    ],
    [
      { ...base, unsupported: 2 },
      "Read 1,234 indicators from the list, skipped 2 lines OneUptime cannot match (an address range or a word).",
    ],
    [
      { ...base, overLimit: 10 },
      "Read 1,234 indicators from the list, left out 10 indicators past the first 50,000.",
    ],
  ])("%j", (result: ListFeedPollResult, summary: string) => {
    expect(ThreatIntelListSource.describeResult(result)).toBe(summary);
    // The feed stores at most 500 characters of it.
    expect(summary.length).toBeLessThan(500);
  });
});
