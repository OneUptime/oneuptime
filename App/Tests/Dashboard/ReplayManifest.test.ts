import { describe, expect, test } from "@jest/globals";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  ReplayManifestFailure,
  SessionReplayManifest,
  SessionReplayManifestChunk,
  SessionReplayManifestTab,
  classifyManifestFailure,
  describeFootageAbsence,
  findTabContinuingAfter,
  getRetentionDays,
  hasPlayableFootage,
  parseManifest,
  pickInitialTab,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/ReplayManifest";

/*
 * The /manifest parser, moved out of the player so it is testable without
 * a Replayer. Pinned: the additive WP-S2 fields (numeric clocks, identity
 * behind the permission, tags, counters, firstChunkStartOffsetMs, per-chunk
 * clickCount / url), the defaults an OLDER server's response falls to
 * (absent means "not measured", identity absent means null, the clock from
 * the ISO string), tab ordering and the 404 message prefixes.
 */

const START_ISO: string = "2026-09-04T10:12:41.200Z";
const START_UNIX_MS: number = Date.parse(START_ISO);
const DAY_MS: number = 24 * 60 * 60 * 1000;

function chunkRow(
  chunkIndex: number,
  tabId: string,
  startMs: number,
  endMs: number,
  extra?: JSONObject,
): JSONObject {
  return {
    chunkIndex: chunkIndex,
    tabId: tabId,
    chunkStartOffsetMs: startMs,
    chunkEndOffsetMs: endMs,
    eventCount: 120,
    hasFullSnapshot: chunkIndex === 0 ? 1 : 0,
    payloadBytes: 4096,
    errorCount: 0,
    rageClickCount: 0,
    deadClickCount: 0,
    errorClickCount: 0,
    refreshRageCount: 0,
    routeCount: 0,
    ...(extra || {}),
  };
}

function fullResponse(): JSONObject {
  return {
    viewId: "view-1",
    isChunkIndexTruncated: 0,
    header: {
      sessionId: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      rumApplicationId: "app-1",
      startTime: START_ISO,
      endTime: "2026-09-04T10:16:53.200Z",
      startTimeUnixMs: START_UNIX_MS,
      endTimeUnixMs: START_UNIX_MS + 252000,
      clientReportedStartUnixMs: START_UNIX_MS + 1500,
      durationMs: 252000,
      isFinalized: 1,
      sealedReason: "final-chunk",
      chunkCount: "17",
      missingChunkCount: 0,
      eventCount: 2040,
      errorCount: 2,
      rageClickCount: 1,
      deadClickCount: 0,
      errorClickCount: 0,
      refreshRageCount: 0,
      pageCount: 3,
      clickCount: 41,
      customEventCount: 5,
      activeMs: 150000,
      firstErrorOffsetMs: 44000,
      expiresAtUnixMs: START_UNIX_MS + 7 * DAY_MS,
      tags: { plan: "enterprise", region: 42 },
      identifiedUserLabel: "jane@acme.com",
      identifiedUserTraits: { plan: "pro", name: "Jane" },
      recorderCapabilities: ["click", "custom"],
      entryUrl: "https://app.acme.com/checkout",
      exitUrl: "https://app.acme.com/thanks",
      routes: ["/checkout", "/pay", "/thanks"],
      browserName: "Chrome",
      browserVersion: "126",
      osName: "macOS",
      deviceType: "desktop",
      countryCode: "DE",
      viewportWidth: 1440,
      viewportHeight: 900,
      clockSkewMs: -120,
      payloadBytes: 1048576,
      maskingMode: "mask-all-text",
      consentState: "granted",
      triggerReason: "always",
      recorderVersion: "1.4.0",
      rrwebVersion: "2.1.1",
      fidelityNotices: ["fonts-not-captured"],
      traceIds: ["t1", "t2"],
      exceptionFingerprints: ["f1"],
    },
    tabs: [
      {
        tabId: "tab-b",
        firstChunkStartOffsetMs: 134000,
        chunks: [
          chunkRow(0, "tab-b", 134000, 149000),
          chunkRow(1, "tab-b", 149000, 164000),
        ],
        gaps: [],
      },
      {
        tabId: "tab-a",
        firstChunkStartOffsetMs: 0,
        chunks: [
          chunkRow(1, "tab-a", 15000, 30000, {
            clickCount: 3,
            url: "https://app.acme.com/pay",
          }),
          chunkRow(0, "tab-a", 0, 15000, { clickCount: 0 }),
          chunkRow(3, "tab-a", 45000, 60000),
        ],
        gaps: [{ fromIndex: 1, toIndex: 3, missingMs: 15000 }],
      },
      { tabId: "tab-empty", chunks: [], gaps: [] },
    ],
  };
}

describe("parseManifest with the current server", () => {
  const manifest: SessionReplayManifest = parseManifest(fullResponse());

  test("reads the numeric clocks straight off the header", () => {
    expect(manifest.startTimeUnixMs).toBe(START_UNIX_MS);
    expect(manifest.endTimeUnixMs).toBe(START_UNIX_MS + 252000);
    expect(manifest.clientReportedStartUnixMs).toBe(START_UNIX_MS + 1500);
    expect(manifest.expiresAtUnixMs).toBe(START_UNIX_MS + 7 * DAY_MS);
  });

  test("reads identity as supplied, and the traits and tags as string maps", () => {
    expect(manifest.details.identifiedUserLabel).toBe("jane@acme.com");
    expect(manifest.details.identifiedUserTraits).toEqual({
      plan: "pro",
      name: "Jane",
    });
    expect(manifest.tags).toEqual({ plan: "enterprise", region: "42" });
    expect(manifest.details.tags).toEqual(manifest.tags);
  });

  test("reads the engagement counters, numeric strings included", () => {
    expect(manifest.counts.chunkCount).toBe(17);
    expect(manifest.counts.clickCount).toBe(41);
    expect(manifest.counts.customEventCount).toBe(5);
    expect(manifest.counts.activeMs).toBe(150000);
    expect(manifest.counts.firstErrorOffsetMs).toBe(44000);
    expect(manifest.counts.errorCount).toBe(2);
  });

  test("carries the recorder capabilities, the routes, the sealed reason and the flags", () => {
    expect(manifest.recorderCapabilities).toEqual(["click", "custom"]);
    expect(manifest.details.recorderCapabilities).toEqual(["click", "custom"]);
    expect(manifest.routes).toEqual(["/checkout", "/pay", "/thanks"]);
    expect(manifest.sealedReason).toBe("final-chunk");
    expect(manifest.details.sealedReason).toBe("final-chunk");
    expect(manifest.isFinalized).toBe(true);
    expect(manifest.details.isFinalized).toBe(true);
    expect(manifest.details.durationMs).toBe(252000);
    expect(manifest.viewId).toBe("view-1");
    expect(manifest.isChunkIndexTruncated).toBe(false);
  });

  test("orders tabs by where their footage starts and puts chunkless tabs last", () => {
    expect(
      manifest.tabs.map((tab: SessionReplayManifestTab): string => {
        return tab.tabId;
      }),
    ).toEqual(["tab-a", "tab-b", "tab-empty"]);
  });

  test("sorts chunk rows by index and reads per-chunk clickCount and url only when present", () => {
    const tabA: SessionReplayManifestTab = manifest
      .tabs[0] as SessionReplayManifestTab;

    expect(
      tabA.chunks.map((chunk: SessionReplayManifestChunk): number => {
        return chunk.chunkIndex;
      }),
    ).toEqual([0, 1, 3]);
    expect(tabA.chunks[0]?.clickCount).toBe(0);
    expect(tabA.chunks[1]?.clickCount).toBe(3);
    expect(tabA.chunks[1]?.url).toBe("https://app.acme.com/pay");
    expect(tabA.chunks[2]).not.toHaveProperty("clickCount");
    expect(tabA.chunks[2]).not.toHaveProperty("url");
    expect(tabA.chunks[0]?.hasFullSnapshot).toBe(true);
    expect(tabA.chunks[1]?.hasFullSnapshot).toBe(false);
  });

  test("takes firstChunkStartOffsetMs from the server and derives each tab's duration", () => {
    const tabA: SessionReplayManifestTab = manifest
      .tabs[0] as SessionReplayManifestTab;
    const tabB: SessionReplayManifestTab = manifest
      .tabs[1] as SessionReplayManifestTab;
    const empty: SessionReplayManifestTab = manifest
      .tabs[2] as SessionReplayManifestTab;

    expect(tabA.firstChunkStartOffsetMs).toBe(0);
    expect(tabA.durationMs).toBe(60000);
    expect(tabB.firstChunkStartOffsetMs).toBe(134000);
    expect(tabB.durationMs).toBe(30000);
    expect(empty.firstChunkStartOffsetMs).toBeNull();
    expect(empty.durationMs).toBe(0);
  });

  test("flattens every tab's gaps for the notices and the details panel", () => {
    expect(manifest.gaps).toEqual([
      { fromIndex: 1, toIndex: 3, missingMs: 15000 },
    ]);
  });
});

describe("parseManifest with an older server", () => {
  const response: JSONObject = fullResponse();
  const header: JSONObject = response["header"] as JSONObject;

  for (const key of [
    "startTimeUnixMs",
    "endTimeUnixMs",
    "clientReportedStartUnixMs",
    "expiresAtUnixMs",
    "clickCount",
    "customEventCount",
    "activeMs",
    "firstErrorOffsetMs",
    "tags",
    "identifiedUserLabel",
    "identifiedUserTraits",
    "recorderCapabilities",
    "routes",
  ]) {
    delete header[key];
  }

  for (const tab of response["tabs"] as Array<JSONObject>) {
    delete tab["firstChunkStartOffsetMs"];

    for (const chunk of tab["chunks"] as Array<JSONObject>) {
      delete chunk["clickCount"];
      delete chunk["url"];
    }
  }

  const manifest: SessionReplayManifest = parseManifest(response);

  test("derives the session clock from the ISO start time", () => {
    expect(manifest.startTimeUnixMs).toBe(START_UNIX_MS);
    expect(manifest.endTimeUnixMs).toBe(Date.parse("2026-09-04T10:16:53.200Z"));
    expect(manifest.clientReportedStartUnixMs).toBeNull();
    expect(manifest.expiresAtUnixMs).toBeNull();
  });

  test("reports identity as null (not permitted / not served), never as anonymous", () => {
    expect(manifest.details.identifiedUserLabel).toBeNull();
    expect(manifest.details.identifiedUserTraits).toBeNull();
  });

  test("leaves unmeasured counters undefined rather than 0", () => {
    expect(manifest.counts.clickCount).toBeUndefined();
    expect(manifest.counts.customEventCount).toBeUndefined();
    expect(manifest.counts.activeMs).toBeUndefined();
    expect(manifest.counts.firstErrorOffsetMs).toBeUndefined();
    expect(manifest.tags).toEqual({});
    expect(manifest.recorderCapabilities).toEqual([]);
    expect(manifest.routes).toEqual([]);
  });

  test("derives firstChunkStartOffsetMs from the first chunk row", () => {
    expect(manifest.tabs[0]?.tabId).toBe("tab-a");
    expect(manifest.tabs[0]?.firstChunkStartOffsetMs).toBe(0);
    expect(manifest.tabs[1]?.firstChunkStartOffsetMs).toBe(134000);
    expect(manifest.tabs[0]?.chunks[0]).not.toHaveProperty("clickCount");
  });

  test("an empty identity label served with the permission reads as anonymous, not null", () => {
    const withEmptyLabel: JSONObject = fullResponse();

    (withEmptyLabel["header"] as JSONObject)["identifiedUserLabel"] = "";
    (withEmptyLabel["header"] as JSONObject)["identifiedUserTraits"] = {};

    const parsed: SessionReplayManifest = parseManifest(withEmptyLabel);

    expect(parsed.details.identifiedUserLabel).toBe("");
    expect(parsed.details.identifiedUserTraits).toEqual({});
  });

  test("an unparseable start time yields a null clock instead of epoch", () => {
    const broken: JSONObject = fullResponse();

    delete (broken["header"] as JSONObject)["startTimeUnixMs"];
    (broken["header"] as JSONObject)["startTime"] = "not a date";

    expect(parseManifest(broken).startTimeUnixMs).toBeNull();
  });

  test("a missing header or tabs list parses to an empty manifest rather than throwing", () => {
    const parsed: SessionReplayManifest = parseManifest({});

    expect(parsed.tabs).toEqual([]);
    expect(parsed.startTimeUnixMs).toBeNull();
    expect(parsed.details.identifiedUserLabel).toBeNull();
    expect(parsed.viewId).toBe("");
  });
});

describe("tab selection", () => {
  const manifest: SessionReplayManifest = parseManifest(fullResponse());

  test("prefers the URL's tab when it has footage, else the first tab with footage", () => {
    expect(pickInitialTab(manifest, "tab-b")?.tabId).toBe("tab-b");
    expect(pickInitialTab(manifest, "tab-empty")?.tabId).toBe("tab-a");
    expect(pickInitialTab(manifest, "nope")?.tabId).toBe("tab-a");
    expect(pickInitialTab(manifest, null)?.tabId).toBe("tab-a");
  });

  test("finds the tab whose footage continues after the active tab's end", () => {
    expect(findTabContinuingAfter(manifest, "tab-a", 60000)?.tabId).toBe(
      "tab-b",
    );
    /* Past the end of every other tab: nothing continues. */
    expect(findTabContinuingAfter(manifest, "tab-a", 170000)).toBeNull();
    /* The active tab itself never counts. */
    expect(findTabContinuingAfter(manifest, "tab-b", 0)?.tabId).toBe("tab-a");
  });

  test("hasPlayableFootage is false when every tab is empty or terminator-only", () => {
    const empty: JSONObject = fullResponse();

    empty["tabs"] = [
      {
        tabId: "t",
        chunks: [chunkRow(0, "t", 0, 0, { eventCount: 0 })],
        gaps: [],
      },
    ];

    expect(hasPlayableFootage(parseManifest(empty))).toBe(false);
    expect(hasPlayableFootage(manifest)).toBe(true);
  });
});

describe("retention and absence", () => {
  test("getRetentionDays rounds the two clocks to whole days", () => {
    const manifest: SessionReplayManifest = parseManifest(fullResponse());

    expect(getRetentionDays(manifest)).toBe(7);

    const noExpiry: JSONObject = fullResponse();

    delete (noExpiry["header"] as JSONObject)["expiresAtUnixMs"];
    expect(getRetentionDays(parseManifest(noExpiry))).toBeNull();
  });

  test("returns null while footage is playable", () => {
    expect(
      describeFootageAbsence(parseManifest(fullResponse()), START_UNIX_MS),
    ).toBeNull();
  });

  test("names a lost recording from the sealed reason", () => {
    const lost: JSONObject = fullResponse();

    lost["tabs"] = [];
    (lost["header"] as JSONObject)["sealedReason"] = "recording-lost";

    expect(describeFootageAbsence(parseManifest(lost), START_UNIX_MS)).toEqual({
      kind: "recording-lost",
    });
  });

  test("explains expiry with the retention days once the expiry has passed", () => {
    const expired: JSONObject = fullResponse();

    expired["tabs"] = [];

    expect(
      describeFootageAbsence(
        parseManifest(expired),
        START_UNIX_MS + 8 * DAY_MS,
      ),
    ).toEqual({
      kind: "expired",
      expiresAtUnixMs: START_UNIX_MS + 7 * DAY_MS,
      retentionDays: 7,
    });
  });

  test("counted chunks with no rows in the index read as expired even before the header's expiry", () => {
    const aged: JSONObject = fullResponse();

    aged["tabs"] = [];

    expect(
      describeFootageAbsence(parseManifest(aged), START_UNIX_MS + DAY_MS)?.kind,
    ).toBe("expired");
  });

  test("a live header with nothing flushed yet is 'not yet uploaded'", () => {
    const live: JSONObject = fullResponse();

    live["tabs"] = [];
    (live["header"] as JSONObject)["isFinalized"] = 0;
    (live["header"] as JSONObject)["chunkCount"] = 0;
    (live["header"] as JSONObject)["sealedReason"] = "";
    delete (live["header"] as JSONObject)["expiresAtUnixMs"];

    expect(describeFootageAbsence(parseManifest(live), START_UNIX_MS)).toEqual({
      kind: "not-yet-uploaded",
    });
  });

  test("a finalized header with zero chunks is 'none stored'", () => {
    const none: JSONObject = fullResponse();

    none["tabs"] = [];
    (none["header"] as JSONObject)["chunkCount"] = 0;
    (none["header"] as JSONObject)["sealedReason"] = "idle-timeout";
    delete (none["header"] as JSONObject)["expiresAtUnixMs"];

    expect(describeFootageAbsence(parseManifest(none), START_UNIX_MS)).toEqual({
      kind: "none-stored",
    });
  });
});

describe("classifyManifestFailure", () => {
  function errorResponse(
    statusCode: number,
    message: string,
  ): HTTPErrorResponse {
    return new HTTPErrorResponse(statusCode, { message: message }, {});
  }

  test("reads the expiry date and retention days out of the 'expired:' 404", () => {
    const failure: ReplayManifestFailure = classifyManifestFailure(
      errorResponse(
        404,
        "expired: This recording expired on 2026-09-11T10:12:41.200Z under the application's 7-day retention. Its session signals may still be available from logs, traces and exceptions.",
      ),
    );

    expect(failure.kind).toBe("expired");

    if (failure.kind === "expired") {
      expect(failure.expiresAtIso).toBe("2026-09-11T10:12:41.200Z");
      expect(failure.retentionDays).toBe(7);
      expect(failure.message.startsWith("This recording expired")).toBe(true);
    }
  });

  test("distinguishes erased from not found", () => {
    expect(
      classifyManifestFailure(
        errorResponse(
          404,
          "erased: This recording was erased by a data subject request.",
        ),
      ),
    ).toEqual({
      kind: "erased",
      message: "This recording was erased by a data subject request.",
    });
    expect(
      classifyManifestFailure(
        errorResponse(
          404,
          "not-found: No session replay exists with this id in this project.",
        ),
      ),
    ).toEqual({
      kind: "not-found",
      message: "No session replay exists with this id in this project.",
    });
  });

  test("a bare 404 from an older server still reads as not found", () => {
    expect(classifyManifestFailure(errorResponse(404, "")).kind).toBe(
      "not-found",
    );
  });

  test("401 / 403 read as forbidden, everything else as a retryable error", () => {
    expect(classifyManifestFailure(errorResponse(403, "Nope")).kind).toBe(
      "forbidden",
    );
    expect(classifyManifestFailure(errorResponse(500, "Boom"))).toEqual({
      kind: "error",
      message: "Boom",
      isRetryable: true,
    });
    expect(classifyManifestFailure(new Error("network down"))).toEqual({
      kind: "error",
      message: "network down",
      isRetryable: true,
    });
    expect(classifyManifestFailure(undefined)).toEqual({
      kind: "error",
      message: "The recording's index could not be loaded.",
      isRetryable: true,
    });
  });
});
