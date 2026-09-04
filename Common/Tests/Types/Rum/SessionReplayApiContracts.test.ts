import { describe, expect, it } from "@jest/globals";
import {
  SESSION_REPLAY_SORT_BY_VALUES,
  SessionReplayExceptionSessionDto,
  SessionReplayForExceptionResponseDto,
  SessionReplayHeartbeatResponseDto,
  SessionReplayListItemDto,
  SessionReplayListRequestDto,
  SessionReplayListResponseDto,
  SessionReplayManifestHeaderDto,
  SessionReplayManifestRequestDto,
  SessionReplayManifestResponseDto,
  SessionReplayManifestTabDto,
  isSessionReplaySortedListCursor,
  parseSessionReplayListCursor,
  readDtoBoolean,
  readDtoNumber,
  readDtoNumberArray,
  readDtoOptionalNumber,
  readDtoOptionalString,
  readDtoString,
  readDtoStringArray,
  readDtoStringMap,
  readDtoUnixMs,
} from "../../../Types/Rum/SessionReplayApi";
import { SessionReplayChunkManifestEntry } from "../../../Types/Rum/SessionReplay";

/*
 * The DTOs are the wire between the Dashboard and TelemetryAPI's
 * session-replay routes. The fixtures below are shaped EXACTLY like the
 * handlers answer today (SessionReplayReadService.listSessions /
 * getSessionHeader / getManifest / getSessionsForException through
 * Response.sendJsonObjectResponse, which turns Dates into ISO strings).
 * Two things are pinned:
 *
 *   1. Today's response satisfies the DTO with no additive field present,
 *      so an older server (or a cached response) still parses.
 *   2. The readDto* helpers keep the defensive semantics the player and
 *      table parsers were written with.
 *
 * The typed fixtures are also compile-time assertions: if a required
 * field is added to a DTO, this file stops type-checking.
 */

const START_ISO: string = "2026-09-04T10:00:00.000Z";
const END_ISO: string = "2026-09-04T10:04:12.000Z";

/* One row of /list as listSessions builds it, serialised. */
const legacyListItem: SessionReplayListItemDto = {
  sessionId: "sess-1",
  rumApplicationId: "app-1",
  startTime: START_ISO,
  endTime: END_ISO,
  durationMs: 252000,
  isFinalized: true,
  sealedReason: "final-chunk",
  chunkCount: 17,
  maxChunkIndex: 16,
  missingChunkCount: 0,
  eventCount: 4210,
  payloadBytes: 812345,
  hasError: true,
  errorCount: 2,
  rageClickCount: 1,
  deadClickCount: 0,
  errorClickCount: 0,
  refreshRageCount: 0,
  pageCount: 6,
  triggerReason: "sampled",
  entryUrl: "https://acme.com/cart",
  exitUrl: "https://acme.com/pay",
  browserName: "Chrome",
  browserVersion: "128",
  osName: "macOS",
  deviceType: "desktop",
  countryCode: "US",
  viewportWidth: 1440,
  viewportHeight: 900,
  identifiedUserKey: "hmac-1",
  samplePercentageAtCapture: 100,
};

const legacyListResponse: SessionReplayListResponseDto = {
  sessions: [legacyListItem],
  nextCursor: { startTimeUnixMs: Date.parse(START_ISO), sessionId: "sess-1" },
};

/* The chunk row getManifest builds. */
const legacyChunk: SessionReplayChunkManifestEntry = {
  chunkIndex: 0,
  tabId: "tab-1",
  chunkStartOffsetMs: 0,
  chunkEndOffsetMs: 15000,
  eventCount: 240,
  hasFullSnapshot: true,
  payloadBytes: 54000,
  errorCount: 0,
  rageClickCount: 0,
  deadClickCount: 0,
  errorClickCount: 0,
  refreshRageCount: 0,
  routeCount: 1,
};

const legacyTab: SessionReplayManifestTabDto = {
  tabId: "tab-1",
  chunks: [legacyChunk],
  chunkIndexes: [0],
  fullSnapshotChunkIndexes: [0],
  gaps: [],
  maxChunkIndex: 0,
  totalPayloadBytes: 54000,
};

/* The header getSessionHeader builds, serialised. */
const legacyHeader: SessionReplayManifestHeaderDto = {
  sessionId: "sess-1",
  projectId: "proj-1",
  rumApplicationId: "app-1",
  startTime: START_ISO,
  endTime: END_ISO,
  durationMs: 252000,
  isFinalized: true,
  sealedReason: "final-chunk",
  chunkCount: 17,
  maxChunkIndex: 16,
  missingChunkCount: 0,
  eventCount: 4210,
  payloadBytes: 812345,
  hasError: true,
  errorCount: 2,
  rageClickCount: 1,
  deadClickCount: 0,
  errorClickCount: 0,
  refreshRageCount: 0,
  pageCount: 6,
  triggerReason: "sampled",
  maskingMode: "MaskSensitiveInputsOnly",
  consentState: "NotRequired",
  recorderKind: "dom",
  recorderVersion: "1.2.3",
  rrwebVersion: "2.1.1",
  schemaVersion: 1,
  wireVersion: 1,
  entryUrl: "https://acme.com/cart",
  exitUrl: "https://acme.com/pay",
  routes: ["/cart", "/checkout", "/pay"],
  browserName: "Chrome",
  browserVersion: "128",
  osName: "macOS",
  deviceType: "desktop",
  countryCode: "US",
  viewportWidth: 1440,
  viewportHeight: 900,
  fidelityNotices: [],
  fullSnapshotChunkIndexes: [0],
  traceIds: ["abc"],
  exceptionFingerprints: [],
  clockSkewMs: -120,
};

const legacyManifestResponse: SessionReplayManifestResponseDto = {
  viewId: "view-1",
  header: legacyHeader,
  tabs: [legacyTab],
  isChunkIndexTruncated: false,
};

const legacyExceptionSession: SessionReplayExceptionSessionDto = {
  sessionId: "sess-1",
  rumApplicationId: "app-1",
  startTime: START_ISO,
  endTime: END_ISO,
  durationMs: 252000,
  hasError: true,
  errorCount: 2,
  rageClickCount: 0,
  deadClickCount: 0,
  errorClickCount: 0,
  refreshRageCount: 0,
  maskingMode: "MaskSensitiveInputsOnly",
  triggerReason: "error",
  entryUrl: "https://acme.com/cart",
  browserName: "Chrome",
  osName: "macOS",
  deviceType: "desktop",
  isFinalized: true,
};

const legacyForExceptionResponse: SessionReplayForExceptionResponseDto = {
  sessions: [legacyExceptionSession],
  isApplicationScopeTruncated: false,
};

const legacyHeartbeat: SessionReplayHeartbeatResponseDto = {
  secondsWatched: 30,
};

describe("SessionReplayApi DTOs - today's wire shapes satisfy them", () => {
  it("a /list response with no additive field parses, and dates are ISO strings", () => {
    const item: SessionReplayListItemDto = legacyListResponse.sessions[0]!;

    expect(typeof item.startTime).toBe("string");
    expect(Date.parse(item.startTime)).toBe(Date.parse(START_ISO));
    expect(item.routes).toBeUndefined();
    expect(item.clickCount).toBeUndefined();
    expect(item.expiresAtUnixMs).toBeUndefined();
    expect(item.identifiedUserLabel).toBeUndefined();
    expect(legacyListResponse.nextCursor).not.toBeNull();
  });

  it("a /manifest response with no additive field parses", () => {
    expect(legacyManifestResponse.header.startTimeUnixMs).toBeUndefined();
    expect(legacyManifestResponse.header.recorderCapabilities).toBeUndefined();
    expect(
      legacyManifestResponse.tabs[0]?.firstChunkStartOffsetMs,
    ).toBeUndefined();
    expect(
      legacyManifestResponse.tabs[0]?.chunks[0]?.clickCount,
    ).toBeUndefined();
    expect(legacyManifestResponse.viewId).toBe("view-1");
  });

  it("a /manifest viewId may be null when no audit row could be created", () => {
    const withoutView: SessionReplayManifestResponseDto = {
      ...legacyManifestResponse,
      viewId: null,
    };

    expect(withoutView.viewId).toBeNull();
  });

  it("/for-exception and /heartbeat responses parse", () => {
    expect(legacyForExceptionResponse.sessions[0]?.isFinalized).toBe(true);
    expect(legacyHeartbeat.secondsWatched).toBe(30);
  });

  it("the additive list and manifest fields are all optional and carry the documented types", () => {
    const richItem: SessionReplayListItemDto = {
      ...legacyListItem,
      routes: ["/cart", "/checkout"],
      traceCount: 3,
      exceptionGroupCount: 1,
      clickCount: 41,
      activeMs: 150000,
      firstErrorOffsetMs: 62000,
      expiresAtUnixMs: Date.parse(START_ISO) + 7 * 24 * 60 * 60 * 1000,
      tags: { build: "1.4.2" },
      startTimeUnixMs: Date.parse(START_ISO),
      endTimeUnixMs: Date.parse(END_ISO),
      identifiedUserLabel: "jane@acme.com",
      identifiedUserTraits: { plan: "pro" },
    };

    const richHeader: SessionReplayManifestHeaderDto = {
      ...legacyHeader,
      startTimeUnixMs: Date.parse(START_ISO),
      endTimeUnixMs: Date.parse(END_ISO),
      clientReportedStartUnixMs: Date.parse(START_ISO) - 120,
      tags: { build: "1.4.2" },
      expiresAtUnixMs: Date.parse(START_ISO) + 7 * 24 * 60 * 60 * 1000,
      clickCount: 41,
      customEventCount: 3,
      activeMs: 150000,
      firstErrorOffsetMs: 62000,
      identifiedUserLabel: "jane@acme.com",
      identifiedUserTraits: { plan: "pro" },
      recorderCapabilities: ["click-events", "web-vitals"],
    };

    const richTab: SessionReplayManifestTabDto = {
      ...legacyTab,
      firstChunkStartOffsetMs: 134000,
      chunks: [{ ...legacyChunk, clickCount: 4, url: "https://acme.com/cart" }],
    };

    expect(richItem.tags?.["build"]).toBe("1.4.2");
    expect(richHeader.recorderCapabilities).toHaveLength(2);
    expect(richTab.chunks[0]?.url).toBe("https://acme.com/cart");
  });

  it("request bodies: the list request matches what SessionReplayTable posts, the manifest request accepts the refresh fields", () => {
    const listRequest: SessionReplayListRequestDto = {
      rumApplicationId: "app-1",
      startTime: START_ISO,
      endTime: END_ISO,
      filters: {
        hasError: true,
        triggerReasons: ["error"],
        search: "checkout",
        urlPrefix: "/checkout",
        tags: { build: "1.4.2" },
        hasIdentifiedUser: true,
        isPlayable: true,
        hasTraces: true,
      },
      limit: 20,
      cursor: { startTimeUnixMs: 1, sessionId: "sess-0" },
      sortBy: "errorCount",
    };

    const manifestRequest: SessionReplayManifestRequestDto = {
      sessionId: "sess-1",
      isRefresh: true,
      viewId: "view-1",
    };

    const minimalManifestRequest: SessionReplayManifestRequestDto = {
      sessionId: "sess-1",
    };

    expect(listRequest.sortBy).toBe("errorCount");
    expect(manifestRequest.isRefresh).toBe(true);
    expect(minimalManifestRequest.isRefresh).toBeUndefined();
  });

  it("SESSION_REPLAY_SORT_BY_VALUES lists exactly the four sort keys", () => {
    expect([...SESSION_REPLAY_SORT_BY_VALUES]).toEqual([
      "startTime",
      "durationMs",
      "errorCount",
      "frustration",
    ]);
  });
});

describe("SessionReplayApi cursor helpers", () => {
  it("isSessionReplaySortedListCursor tells the two cursor shapes apart", () => {
    expect(
      isSessionReplaySortedListCursor({
        sortBy: "durationMs",
        sortValue: 5,
        sessionId: "s",
      }),
    ).toBe(true);
    expect(
      isSessionReplaySortedListCursor({ startTimeUnixMs: 5, sessionId: "s" }),
    ).toBe(false);
  });

  it("parseSessionReplayListCursor normalises the legacy shape to sortBy startTime", () => {
    expect(
      parseSessionReplayListCursor({
        startTimeUnixMs: 1700000000000,
        sessionId: "s",
      }),
    ).toEqual({
      sortBy: "startTime",
      sortValue: 1700000000000,
      sessionId: "s",
    });
  });

  it("parseSessionReplayListCursor reads the sorted shape, including numeric strings", () => {
    expect(
      parseSessionReplayListCursor({
        sortBy: "frustration",
        sortValue: "7",
        sessionId: "s",
      }),
    ).toEqual({ sortBy: "frustration", sortValue: 7, sessionId: "s" });
  });

  it("parseSessionReplayListCursor prefers the sorted fields when both shapes are present", () => {
    expect(
      parseSessionReplayListCursor({
        sortBy: "errorCount",
        sortValue: 3,
        startTimeUnixMs: 1,
        sessionId: "s",
      }),
    ).toEqual({ sortBy: "errorCount", sortValue: 3, sessionId: "s" });
  });

  it("parseSessionReplayListCursor rejects an unknown sortBy, a missing sessionId and non-objects", () => {
    expect(
      parseSessionReplayListCursor({
        sortBy: "nope",
        sortValue: 1,
        sessionId: "s",
      }),
    ).toBeNull();
    expect(
      parseSessionReplayListCursor({ sortBy: "startTime", sortValue: 1 }),
    ).toBeNull();
    expect(parseSessionReplayListCursor({ sessionId: "s" })).toBeNull();
    expect(parseSessionReplayListCursor(null)).toBeNull();
    expect(parseSessionReplayListCursor("x")).toBeNull();
    expect(parseSessionReplayListCursor([1])).toBeNull();
  });
});

describe("readDto* helpers keep the parsers' defensive semantics", () => {
  const row: Record<string, unknown> = {
    n: 42,
    nStr: "42",
    nBad: "forty-two",
    nNull: null,
    nEmpty: "",
    s: "text",
    sNum: 7,
    sNull: null,
    bTrue: true,
    bOne: 1,
    bOneStr: "1",
    bZeroStr: "0",
    bFalse: false,
    arr: ["a", 1, true],
    notArr: "a",
    nums: [1, "2", "x", null],
    map: { a: "1", b: 2, c: null },
    mapArr: ["a"],
    iso: "2026-09-04T10:00:00.000Z",
    isoBad: "yesterday",
    unixNum: 1700000000000,
  };

  it("readDtoNumber: finite numbers and numeric strings, else 0", () => {
    expect(readDtoNumber(row, "n")).toBe(42);
    expect(readDtoNumber(row, "nStr")).toBe(42);
    expect(readDtoNumber(row, "nBad")).toBe(0);
    expect(readDtoNumber(row, "missing")).toBe(0);
  });

  it("readDtoOptionalNumber: undefined for absent, null, empty and non-numeric - never 0", () => {
    expect(readDtoOptionalNumber(row, "n")).toBe(42);
    expect(readDtoOptionalNumber(row, "nStr")).toBe(42);
    expect(readDtoOptionalNumber(row, "nBad")).toBeUndefined();
    expect(readDtoOptionalNumber(row, "nNull")).toBeUndefined();
    expect(readDtoOptionalNumber(row, "nEmpty")).toBeUndefined();
    expect(readDtoOptionalNumber(row, "missing")).toBeUndefined();
  });

  it("readDtoString: stringifies, null/undefined become empty", () => {
    expect(readDtoString(row, "s")).toBe("text");
    expect(readDtoString(row, "sNum")).toBe("7");
    expect(readDtoString(row, "sNull")).toBe("");
    expect(readDtoString(row, "missing")).toBe("");
  });

  it("readDtoOptionalString: non-empty strings only", () => {
    expect(readDtoOptionalString(row, "s")).toBe("text");
    expect(readDtoOptionalString(row, "sNum")).toBeUndefined();
    expect(readDtoOptionalString(row, "nEmpty")).toBeUndefined();
  });

  it("readDtoBoolean: true, 1 and '1' are true; everything else is false", () => {
    expect(readDtoBoolean(row, "bTrue")).toBe(true);
    expect(readDtoBoolean(row, "bOne")).toBe(true);
    expect(readDtoBoolean(row, "bOneStr")).toBe(true);
    expect(readDtoBoolean(row, "bZeroStr")).toBe(false);
    expect(readDtoBoolean(row, "bFalse")).toBe(false);
    expect(readDtoBoolean(row, "missing")).toBe(false);
  });

  it("readDtoStringArray / readDtoNumberArray", () => {
    expect(readDtoStringArray(row, "arr")).toEqual(["a", "1", "true"]);
    expect(readDtoStringArray(row, "notArr")).toEqual([]);
    expect(readDtoNumberArray(row, "nums")).toEqual([1, 2, 0]);
    expect(readDtoNumberArray(row, "notArr")).toEqual([]);
  });

  it("readDtoStringMap: objects only, values stringified, nulls dropped", () => {
    expect(readDtoStringMap(row, "map")).toEqual({ a: "1", b: "2" });
    expect(readDtoStringMap(row, "mapArr")).toEqual({});
    expect(readDtoStringMap(row, "missing")).toEqual({});
  });

  it("readDtoUnixMs: ISO strings and numbers, never epoch for garbage", () => {
    expect(readDtoUnixMs(row, "iso")).toBe(
      Date.parse("2026-09-04T10:00:00.000Z"),
    );
    expect(readDtoUnixMs(row, "unixNum")).toBe(1700000000000);
    expect(readDtoUnixMs(row, "isoBad")).toBeUndefined();
    expect(readDtoUnixMs(row, "nEmpty")).toBeUndefined();
    expect(readDtoUnixMs(row, "missing")).toBeUndefined();
  });
});
