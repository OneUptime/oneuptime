import RumSessionService from "../../../../Server/Services/RumSessionService";
import RumSessionChunkService from "../../../../Server/Services/RumSessionChunkService";
import ExceptionInstanceService from "../../../../Server/Services/ExceptionInstanceService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import SessionReplayReadService, {
  MAX_LIST_ROUTES,
  MAX_SESSION_REPLAY_USERS_LIMIT,
  SESSION_REPLAY_ACTIVITY_SUMMARY_CACHE_TTL_MS,
  SessionReplayApplicationActivitySummary,
  SessionReplayChunkReadResult,
  SessionReplayExceptionSession,
  SessionReplayExpiredSessionInfo,
  SessionReplayListFilters,
  SessionReplayListItem,
  SessionReplayListRequest,
  SessionReplayListResult,
  SessionReplayManifest,
  SessionReplaySessionHeader,
  SessionReplaySessionIdentity,
  SessionReplayUserRollup,
  SessionReplayUsersRequest,
  SessionReplayUsersResult,
} from "../../../../Server/Utils/SessionReplay/SessionReplayReadService";
import logger from "../../../../Server/Utils/Logger";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import {
  MAX_SESSION_REPLAY_CHUNKS_PER_SESSION,
  MAX_SESSION_REPLAY_READ_BYTES,
  SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS,
  SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS,
} from "../../../../Types/Rum/SessionReplay";
import { SessionReplaySortBy } from "../../../../Types/Rum/SessionReplayApi";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Statement-text tests for the bespoke ClickHouse reads. Nothing here
 * talks to a database: executeQuery is spied and the SQL it would have
 * run is asserted. What is pinned is the shape that keeps the reads
 * correct on a ReplacingMergeTree and cheap under the sort key: every
 * list predicate is a HAVING clause over an argMax alias (never a raw
 * column, which would match a superseded header version), the WHERE
 * stays the (projectId, rumApplicationId, startTime) prefix, the
 * payload column is named by exactly one read, and the identity columns
 * are named only when the caller asked for them.
 */

function fakeResultSet(rows: Array<JSONObject>): unknown {
  return {
    json: async (): Promise<JSONObject> => {
      return { data: rows } as unknown as JSONObject;
    },
  };
}

function statementOf(spy: jest.SpyInstance, call: number = 0): Statement {
  const statement: Statement | undefined = spy.mock.calls[call]?.[0] as
    | Statement
    | undefined;

  if (!statement) {
    throw new Error(`executeQuery call ${call} was not made`);
  }

  return statement;
}

function boundValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

/* The HAVING section of a list statement, so WHERE-level leaks fail. */
function havingSection(query: string): string {
  const index: number = query.indexOf("HAVING 1 = 1");

  if (index < 0) {
    throw new Error("Statement has no HAVING section");
  }

  return query.substring(index);
}

function whereSection(query: string): string {
  const start: number = query.indexOf("WHERE");
  const end: number = query.indexOf("GROUP BY");

  return query.substring(start, end > 0 ? end : undefined);
}

describe("SessionReplayReadService statements", () => {
  const projectId: ObjectID = ObjectID.generate();
  const rumApplicationId: ObjectID = ObjectID.generate();

  let headerQuerySpy: jest.SpyInstance;
  let chunkQuerySpy: jest.SpyInstance;
  let exceptionQuerySpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    SessionReplayReadService.clearActivitySummaryCache();
    SessionReplayReadService.setPublishedRecorderVersionProvider(null);

    headerQuerySpy = jest
      .spyOn(RumSessionService, "executeQuery")
      .mockResolvedValue(fakeResultSet([]) as never);
    chunkQuerySpy = jest
      .spyOn(RumSessionChunkService, "executeQuery")
      .mockResolvedValue(fakeResultSet([]) as never);
    exceptionQuerySpy = jest
      .spyOn(ExceptionInstanceService, "executeQuery")
      .mockResolvedValue(fakeResultSet([]) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function listRequest(
    overrides: Partial<SessionReplayListRequest> = {},
  ): SessionReplayListRequest {
    return {
      projectId: projectId,
      rumApplicationId: rumApplicationId,
      startTime: new Date("2026-08-01T00:00:00.000Z"),
      endTime: new Date("2026-08-08T00:00:00.000Z"),
      filters: {},
      limit: 20,
      includeIdentifiedUserLabel: false,
      ...overrides,
    };
  }

  async function listQuery(
    filters: SessionReplayListFilters,
    overrides: Partial<SessionReplayListRequest> = {},
  ): Promise<string> {
    await SessionReplayReadService.listSessions(
      listRequest({ filters: filters, ...overrides }),
    );

    return statementOf(headerQuerySpy).query;
  }

  describe("list predicates are HAVING clauses over argMax aliases", () => {
    test("hasIdentifiedUser tests the digest alias, never the label", async () => {
      const positive: string = await listQuery({ hasIdentifiedUser: true });
      expect(havingSection(positive)).toContain(
        "AND aggIdentifiedUserKey != ''",
      );
      expect(whereSection(positive)).not.toContain("identifiedUserKey");
      expect(positive).not.toContain("identifiedUserLabel");

      headerQuerySpy.mockClear();

      const negative: string = await listQuery({ hasIdentifiedUser: false });
      expect(havingSection(negative)).toContain(
        "AND aggIdentifiedUserKey = ''",
      );
    });

    /*
     * "Every session from this browser". The recorder-minted visitor id is
     * argMax'd like every other header column, so the predicate runs over
     * the alias in HAVING - a WHERE on the raw column would match a
     * superseded header version, and a provisional header written before
     * the recorder's first meta chunk carries no id at all - and the id is
     * bound, never interpolated.
     */
    test("visitorId is a HAVING predicate over the visitor alias with the id bound", async () => {
      const visitorId: string = "0123456789abcdef0123456789abcdef";
      const query: string = await listQuery({ visitorId: visitorId });

      expect(havingSection(query)).toMatch(
        /AND aggVisitorId = \{p\d+:String\}/,
      );
      expect(whereSection(query)).not.toContain("visitorId");
      expect(query).toContain("argMax(visitorId, version) AS aggVisitorId");
      expect(query).not.toContain(`'${visitorId}'`);
      expect(boundValues(statementOf(headerQuerySpy))).toContain(visitorId);

      /* Ordinary session ACL: no identity column is named for it. */
      expect(query).not.toContain("identifiedUserLabel");
    });

    test("an absent visitorId adds no predicate", async () => {
      const query: string = await listQuery({});
      expect(havingSection(query)).not.toContain("aggVisitorId");
    });

    test("isPlayable combines finalization, chunk count and the lost seal", async () => {
      const playable: string = await listQuery({ isPlayable: true });
      expect(havingSection(playable)).toContain(
        "AND ((aggIsFinalized = 0 OR aggChunkCount > 0) AND aggSealedReason != 'recording-lost')",
      );

      headerQuerySpy.mockClear();

      const unplayable: string = await listQuery({ isPlayable: false });
      expect(havingSection(unplayable)).toContain(
        "AND NOT ((aggIsFinalized = 0 OR aggChunkCount > 0) AND aggSealedReason != 'recording-lost')",
      );
    });

    test("hasTraces tests the trace-count alias", async () => {
      const query: string = await listQuery({ hasTraces: true });
      expect(havingSection(query)).toContain("AND aggTraceCount > 0");
      expect(query).toContain(
        "toFloat64(length(argMax(traceIds, version))) AS aggTraceCount",
      );

      headerQuerySpy.mockClear();

      const none: string = await listQuery({ hasTraces: false });
      expect(havingSection(none)).toContain("AND aggTraceCount = 0");
    });

    /*
     * The routes and entry URL stored on a header are scrubbed ABSOLUTE
     * urls (https://host/path), but the filter a person types is a PATH -
     * the search box routes anything beginning with "/" to this filter, and
     * the docs promise `url:/checkout` outright. Matching the whole string
     * only meant that documented search returned an empty list in every
     * project, silently. Both arms are needed: the whole-URL one for a
     * caller that pastes an absolute URL, the path() one for the path.
     */
    test("urlPrefix matches the PATH of a route and of the entry URL, as well as the whole URL", async () => {
      const query: string = await listQuery({ urlPrefix: "/checkout" });
      const having: string = havingSection(query);

      expect(having).toMatch(
        /AND \(arrayExists\(r -> startsWith\(r, \{p\d+:String\}\) OR startsWith\(path\(r\), \{p\d+:String\}\), aggRoutes\) OR startsWith\(aggEntryUrl, \{p\d+:String\}\) OR startsWith\(path\(aggEntryUrl\), \{p\d+:String\}\)\)/,
      );
      expect(query).toContain("argMax(routes, version) AS aggRoutes");
      /* Bound four times, never interpolated. */
      expect(query).not.toContain("'/checkout'");
      expect(
        boundValues(statementOf(headerQuerySpy)).filter(
          (value: unknown): boolean => {
            return value === "/checkout";
          },
        ),
      ).toHaveLength(4);
    });

    test("tags require every pair through mapContains over the argMax'd map", async () => {
      const query: string = await listQuery({
        tags: { build: "1.2.3", tier: "enterprise" },
      });
      const having: string = havingSection(query);

      expect(having).toMatch(
        /AND mapContains\(aggTags, \{p\d+:String\}\) AND aggTags\[\{p\d+:String\}\] = \{p\d+:String\}/,
      );
      expect(having.match(/mapContains\(aggTags/g)).toHaveLength(2);
      expect(query).toContain("argMax(tags, version) AS aggTags");

      const bound: Array<unknown> = boundValues(statementOf(headerQuerySpy));
      expect(bound).toContain("build");
      expect(bound).toContain("1.2.3");
      expect(bound).toContain("tier");
      expect(bound).toContain("enterprise");
    });

    test("search covers sessionId, both URLs, routes and trace ids, binds the term, and omits the label by default", async () => {
      const query: string = await listQuery({ search: "acme" });
      const having: string = havingSection(query);

      expect(having).toMatch(/startsWith\(sessionId, \{p\d+:String\}\)/);
      expect(having).toMatch(
        /positionCaseInsensitiveUTF8\(aggEntryUrl, \{p\d+:String\}\) > 0/,
      );
      expect(having).toMatch(
        /positionCaseInsensitiveUTF8\(aggExitUrl, \{p\d+:String\}\) > 0/,
      );
      expect(having).toMatch(
        /arrayExists\(r -> positionCaseInsensitiveUTF8\(r, \{p\d+:String\}\) > 0, aggRoutes\)/,
      );
      expect(having).toMatch(
        /has\(argMax\(traceIds, version\), \{p\d+:String\}\)/,
      );
      expect(query).not.toContain("identifiedUserLabel");
      expect(query).not.toContain("'acme'");
      expect(boundValues(statementOf(headerQuerySpy))).toContain("acme");
    });

    test("search names the identified user label only when the caller may read it", async () => {
      const query: string = await listQuery(
        { search: "jane" },
        { includeIdentifiedUserLabel: true },
      );

      expect(havingSection(query)).toMatch(
        /positionCaseInsensitiveUTF8\(aggIdentifiedUserLabel, \{p\d+:String\}\) > 0/,
      );
      expect(query).toContain(
        "argMax(identifiedUserLabel, version) AS aggIdentifiedUserLabel",
      );
    });

    test("search is appended after the cheap boolean predicates", async () => {
      const query: string = await listQuery({
        search: "acme",
        hasError: true,
        hasTraces: true,
        isPlayable: true,
      });
      const having: string = havingSection(query);

      const searchAt: number = having.indexOf("startsWith(sessionId");
      expect(searchAt).toBeGreaterThan(having.indexOf("aggHasError ="));
      expect(searchAt).toBeGreaterThan(having.indexOf("aggTraceCount > 0"));
      expect(searchAt).toBeGreaterThan(having.indexOf("aggIsFinalized = 0"));
    });

    test("the WHERE stays the sort-key prefix whatever filters are set", async () => {
      const query: string = await listQuery({
        search: "acme",
        urlPrefix: "/x",
        tags: { a: "b" },
        hasTraces: true,
        isPlayable: true,
        hasIdentifiedUser: true,
        route: "/y",
        browserNames: ["Chrome"],
        visitorId: "0123456789abcdef0123456789abcdef",
      });
      const where: string = whereSection(query);

      expect(where).toContain("projectId = ");
      expect(where).toContain("rumApplicationId = ");
      expect(where).toContain("startTime >= ");
      expect(where).toContain("startTime <= ");
      expect(where).toContain("retentionDate >= now()");

      for (const forbidden of [
        "routes",
        "tags",
        "traceIds",
        "entryUrl",
        "browserName",
        "identifiedUserKey",
        "visitorId",
        "sealedReason",
      ]) {
        expect(where).not.toContain(forbidden);
      }
    });

    test("the exact route filter runs over the routes alias", async () => {
      const query: string = await listQuery({ route: "https://a/b" });
      expect(havingSection(query)).toMatch(
        /AND has\(aggRoutes, \{p\d+:String\}\)/,
      );
    });
  });

  describe("list sort and cursor", () => {
    test("defaults to newest first with a sessionId tiebreak", async () => {
      const query: string = await listQuery({});
      expect(query).toContain("ORDER BY aggStartTime DESC, sessionId DESC");
    });

    test.each([
      ["durationMs", "aggDurationMs"],
      ["errorCount", "aggErrorCount"],
      [
        "frustration",
        "(aggRageClickCount + aggDeadClickCount + aggErrorClickCount + aggRefreshRageCount)",
      ],
    ] as Array<[SessionReplaySortBy, string]>)(
      "sortBy %s orders by its alias with a sessionId tiebreak",
      async (sortBy: SessionReplaySortBy, expression: string) => {
        const query: string = await listQuery({}, { sortBy: sortBy });
        expect(query).toContain(`ORDER BY ${expression} DESC, sessionId DESC`);
      },
    );

    test("an unknown sortBy is refused before any query", async () => {
      await expect(
        SessionReplayReadService.listSessions(
          listRequest({ sortBy: "payloadBytes" as SessionReplaySortBy }),
        ),
      ).rejects.toBeInstanceOf(BadDataException);
      expect(headerQuerySpy).not.toHaveBeenCalled();
    });

    test("a newest-first cursor bounds startTime in the WHERE and tiebreaks in HAVING", async () => {
      const query: string = await listQuery(
        {},
        {
          cursor: {
            sortBy: "startTime",
            sortValue: 1700000000000,
            sessionId: "s-9",
          },
        },
      );

      /* The window's own upper bound plus the cursor's. */
      expect(whereSection(query).match(/startTime <= /g)).toHaveLength(2);
      expect(havingSection(query)).toMatch(
        /AND \(aggStartTime < \{p\d+:Double\} OR \(aggStartTime = \{p\d+:Double\} AND sessionId < \{p\d+:String\}\)\)/,
      );
    });

    test("a cursor on any other sort never touches the WHERE", async () => {
      const query: string = await listQuery(
        {},
        {
          sortBy: "errorCount",
          cursor: { sortBy: "errorCount", sortValue: 4, sessionId: "s-9" },
        },
      );

      expect(whereSection(query).match(/startTime <= /g)).toHaveLength(1);
      expect(havingSection(query)).toMatch(
        /AND \(aggErrorCount < \{p\d+:Double\} OR \(aggErrorCount = \{p\d+:Double\} AND sessionId < \{p\d+:String\}\)\)/,
      );
    });

    test("a cursor from a different ordering is refused", async () => {
      await expect(
        SessionReplayReadService.listSessions(
          listRequest({
            sortBy: "durationMs",
            cursor: { sortBy: "errorCount", sortValue: 4, sessionId: "s" },
          }),
        ),
      ).rejects.toBeInstanceOf(BadDataException);
      expect(headerQuerySpy).not.toHaveBeenCalled();
    });

    test("nextCursor carries the sort key of the last row, and only when a page follows", async () => {
      const rows: Array<JSONObject> = [
        { sessionId: "a", aggErrorCount: 9, aggStartTime: 3 },
        { sessionId: "b", aggErrorCount: 4, aggStartTime: 2 },
        { sessionId: "c", aggErrorCount: 1, aggStartTime: 1 },
      ];
      headerQuerySpy.mockResolvedValue(fakeResultSet(rows) as never);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(
          listRequest({ limit: 2, sortBy: "errorCount" }),
        );

      expect(result.sessions).toHaveLength(2);
      expect(result.nextCursor).toEqual({
        sortBy: "errorCount",
        sortValue: 4,
        sessionId: "b",
      });

      headerQuerySpy.mockResolvedValue(fakeResultSet(rows) as never);

      const lastPage: SessionReplayListResult =
        await SessionReplayReadService.listSessions(
          listRequest({ limit: 3, sortBy: "errorCount" }),
        );
      expect(lastPage.nextCursor).toBeNull();
    });
  });

  describe("list projections", () => {
    test("selects the engagement, correlation and expiry columns and the live duration", async () => {
      const query: string = await listQuery({});

      for (const projection of [
        "toFloat64(length(argMax(exceptionFingerprints, version))) AS aggExceptionGroupCount",
        "toFloat64(argMax(clickCount, version)) AS aggClickCount",
        "toFloat64(argMax(activeMs, version)) AS aggActiveMs",
        "toFloat64(argMax(firstErrorOffsetMs, version)) AS aggFirstErrorOffsetMs",
        "toFloat64(toUnixTimestamp(argMax(retentionDate, version))) * 1000 AS aggExpiresAt",
        "argMax(tags, version) AS aggTags",
        "argMax(routes, version) AS aggRoutes",
      ]) {
        expect(query).toContain(projection);
      }

      /*
       * A provisional header says durationMs 0 for ten minutes; the span
       * it asserts itself is the honest lower bound until then.
       */
      expect(query).toContain(
        "toFloat64(if(argMax(isFinalized, version), toInt64(argMax(durationMs, version)), greatest(toInt64(argMax(durationMs, version)), toUnixTimestamp64Milli(argMax(endTime, version)) - toUnixTimestamp64Milli(argMax(startTime, version))))) AS aggDurationMs",
      );

      expect(query).not.toContain("identifiedUserTraits");
      expect(query).not.toMatch(/\bpayload\b(?!Bytes)/);
      expect(query).toContain("retentionDate >= now()");
    });

    test("maps the new projections, slicing routes and keeping the clock as numbers", async () => {
      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          {
            sessionId: "s-1",
            applicationId: rumApplicationId.toString(),
            aggStartTime: 1700000000000,
            aggEndTime: 1700000090000,
            aggRoutes: ["/a", "/b", "/c", "/d", "/e", "/f", "/g"],
            aggTraceCount: "3",
            aggExceptionGroupCount: 2,
            aggClickCount: 41,
            aggActiveMs: "54000",
            aggFirstErrorOffsetMs: "12000",
            aggExpiresAt: 1700604800000,
            aggTags: { build: "1.2.3" },
          },
        ]) as never,
      );

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(listRequest());
      const item: SessionReplayListItem = result.sessions[0]!;

      expect(item.routes).toHaveLength(MAX_LIST_ROUTES);
      expect(item.routes[0]).toBe("/a");
      expect(item.traceCount).toBe(3);
      expect(item.exceptionGroupCount).toBe(2);
      expect(item.clickCount).toBe(41);
      expect(item.activeMs).toBe(54000);
      expect(item.firstErrorOffsetMs).toBe(12000);
      expect(item.expiresAtUnixMs).toBe(1700604800000);
      expect(item.tags).toEqual({ build: "1.2.3" });
      expect(item.startTimeUnixMs).toBe(1700000000000);
      expect(item.endTimeUnixMs).toBe(1700000090000);
      expect(item.identifiedUserTraits).toBeUndefined();
      expect(item.identifiedUserLabel).toBeUndefined();
    });

    /*
     * The list's "3 errors" badge has nowhere to link without a
     * fingerprint: the Exceptions page can only be opened unfiltered.
     * Projected from the same argMax'd array the group count is measured
     * over, so the two can never disagree about which session errored.
     */
    test("the first exception fingerprint is projected so the errors badge can link", async () => {
      const query: string = await listQuery({});

      expect(query).toContain(
        "arrayElement(argMax(exceptionFingerprints, version), 1) AS aggTopExceptionFingerprint",
      );

      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          {
            sessionId: "s-1",
            aggTopExceptionFingerprint: "fp-abc",
          },
        ]) as never,
      );

      const withFingerprint: SessionReplayListResult =
        await SessionReplayReadService.listSessions(listRequest());

      expect(withFingerprint.sessions[0]!.topExceptionFingerprint).toBe(
        "fp-abc",
      );

      /* A clean session reports "", never undefined. */
      headerQuerySpy.mockResolvedValue(
        fakeResultSet([{ sessionId: "s-2" }]) as never,
      );

      const clean: SessionReplayListResult =
        await SessionReplayReadService.listSessions(listRequest());

      expect(clean.sessions[0]!.topExceptionFingerprint).toBe("");
    });

    test("names and maps the identity columns only when asked", async () => {
      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          {
            sessionId: "s-1",
            aggIdentifiedUserLabel: "jane@example.com",
            aggIdentifiedUserTraits: { plan: "pro" },
          },
        ]) as never,
      );

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(
          listRequest({ includeIdentifiedUserLabel: true }),
        );

      const query: string = statementOf(headerQuerySpy).query;
      expect(query).toContain(
        "argMax(identifiedUserTraits, version) AS aggIdentifiedUserTraits",
      );
      expect(result.sessions[0]!.identifiedUserLabel).toBe("jane@example.com");
      expect(result.sessions[0]!.identifiedUserTraits).toEqual({
        plan: "pro",
      });
    });

    /*
     * The visitor id sits beside the digest under the ordinary session ACL:
     * it is what the list groups anonymous sessions by and what the player
     * reads for "other sessions from this visitor", so every list-capable
     * caller gets it. "" - never undefined - for a session an older
     * recorder produced, so the UI has one branch to write.
     */
    test("projects and maps the visitor id for every caller, '' from an older recorder", async () => {
      const visitorId: string = "0123456789abcdef0123456789abcdef";

      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          {
            sessionId: "s-1",
            aggIdentifiedUserKey: "hmac-1",
            aggVisitorId: visitorId,
          },
          { sessionId: "s-2" },
        ]) as never,
      );

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(listRequest());

      const query: string = statementOf(headerQuerySpy).query;
      expect(query).toContain("argMax(visitorId, version) AS aggVisitorId");
      expect(query).not.toContain("identifiedUserLabel");

      expect(result.sessions[0]!.identifiedUserKey).toBe("hmac-1");
      expect(result.sessions[0]!.visitorId).toBe(visitorId);
      expect(result.sessions[1]!.visitorId).toBe("");
    });
  });

  /*
   * The bug: a user closed the tab, the recorder sent its final chunk, and
   * the sessions table kept saying "Recording now" for 10-15 minutes -
   * because the only fact the list returned was isFinalized, and the
   * finalizer only runs once a session has been idle for ten minutes. The
   * list now also says whether every tab of an unfinalized session has
   * ended, read from the chunk rows by the shared rule, once the same
   * grace the finalizer waits on has passed.
   */
  describe("hasRecordingEnded on the session list", () => {
    /* An arbitrary fixed device clock: the end of a tab's final chunk. */
    const FINAL_END: number = 1757000000000;
    /*
     * The SERVER unix ms the tab's newest chunk row was written (its
     * version). Deliberately not FINAL_END: the grace is measured on the
     * server clock, never on the device's.
     */
    const STORED_AT: number = FINAL_END + 2345;
    /* The first server "now" at which STORED_AT is past the grace. */
    const GRACE_PASSED: number =
      STORED_AT + SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS;

    function request(
      overrides: Partial<SessionReplayListRequest> = {},
    ): SessionReplayListRequest {
      return listRequest({ nowUnixMs: GRACE_PASSED, ...overrides });
    }

    function listRow(sessionId: string, isFinalized: boolean): JSONObject {
      return {
        sessionId: sessionId,
        applicationId: rumApplicationId.toString(),
        aggStartTime: FINAL_END - 60000,
        aggEndTime: FINAL_END,
        aggIsFinalized: isFinalized ? 1 : 0,
        aggSealedReason: isFinalized ? "final-chunk" : "",
      };
    }

    /* A tab whose final chunk ended at FINAL_END and nothing started after. */
    function endedTabRow(
      sessionId: string,
      tabId: string,
      overrides: JSONObject = {},
    ): JSONObject {
      return {
        sessionId: sessionId,
        tabId: tabId,
        tabHasFinalChunk: 1,
        tabFinalChunkEndUnixMs: FINAL_END,
        tabLastChunkStartUnixMs: FINAL_END - 15000,
        tabMaxChunkIndex: 4,
        tabLastChunkStoredAtUnixMs: STORED_AT,
        ...overrides,
      };
    }

    /* A tab that has not sent a final chunk: maxIf's default end is epoch. */
    function liveTabRow(
      sessionId: string,
      tabId: string,
      overrides: JSONObject = {},
    ): JSONObject {
      return {
        sessionId: sessionId,
        tabId: tabId,
        tabHasFinalChunk: 0,
        tabFinalChunkEndUnixMs: 0,
        tabLastChunkStartUnixMs: FINAL_END,
        tabMaxChunkIndex: 4,
        tabLastChunkStoredAtUnixMs: STORED_AT,
        ...overrides,
      };
    }

    function mockPage(rows: Array<JSONObject>): void {
      headerQuerySpy.mockResolvedValue(fakeResultSet(rows) as never);
    }

    function mockChunkFacts(rows: Array<JSONObject>): void {
      chunkQuerySpy.mockResolvedValue(fakeResultSet(rows) as never);
    }

    function endedBySessionId(
      result: SessionReplayListResult,
    ): Record<string, boolean> {
      const ended: Record<string, boolean> = {};

      for (const session of result.sessions) {
        ended[session.sessionId] = session.hasRecordingEnded;
      }

      return ended;
    }

    test("the follow-up is one parameterised, application-pinned, per-tab key-range read over the chunk table", async () => {
      mockPage([
        listRow("s-1", false),
        listRow("s-2", true),
        listRow("s-3", false),
      ]);

      await SessionReplayReadService.listSessions(request());

      expect(headerQuerySpy).toHaveBeenCalledTimes(1);
      expect(chunkQuerySpy).toHaveBeenCalledTimes(1);

      const statement: Statement = statementOf(chunkQuerySpy);
      const query: string = statement.query;
      const bound: Array<unknown> = boundValues(statement);

      /* The chunk table, bound as an identifier like every other read. */
      expect(bound).toContain(AnalyticsTableName.RumSessionChunk);

      /* The sort-key prefix (projectId, sessionId) plus the app pin. */
      expect(whereSection(query)).toMatch(/projectId = \{p\d+:String\}/);
      expect(whereSection(query)).toMatch(
        /AND sessionId IN \(\{p\d+:Array\(String\)\}\)/,
      );
      expect(whereSection(query)).toMatch(
        /AND rumApplicationId = \{p\d+:String\}/,
      );
      expect(whereSection(query)).toContain("retentionDate >= now()");
      expect(bound).toContain(projectId.toString());
      expect(bound).toContain(rumApplicationId.toString());

      /* Only the unfinalized sessions of the page, bound, never spelled. */
      expect(bound).toContainEqual(["s-1", "s-3"]);
      expect(query).not.toContain("'s-1'");
      expect(query).not.toContain("'s-3'");
      for (const value of bound) {
        if (Array.isArray(value)) {
          expect(value).not.toContain("s-2");
        }
      }

      /* Per tab, with exactly the five documented facts. */
      expect(query).toContain("GROUP BY sessionId, tabId");
      expect(query).toContain("max(toUInt8(isFinal)) AS tabHasFinalChunk");
      expect(query).toContain(
        "toFloat64(toUnixTimestamp64Milli(maxIf(chunkEndTime, isFinal))) AS tabFinalChunkEndUnixMs",
      );
      expect(query).toContain(
        "toFloat64(toUnixTimestamp64Milli(max(chunkStartTime))) AS tabLastChunkStartUnixMs",
      );
      expect(query).toContain("toFloat64(max(chunkIndex)) AS tabMaxChunkIndex");
      expect(query).toContain(
        "toFloat64(max(version)) AS tabLastChunkStoredAtUnixMs",
      );

      /*
       * The grace is judged in the process against the rows' server write
       * time, not in SQL against the device clock or now64().
       */
      expect(query).not.toContain("now64(");

      /* Maxima need no de-duplication, and the payload is never named. */
      expect(query).not.toContain("LIMIT 1 BY");
      expect(query).not.toMatch(/\bpayload\b(?!Bytes)/);
      expect(query).toContain("timeout_overflow_mode = 'throw'");
    });

    test("an unfinalized session whose single tab sent its final chunk reads as ended once the grace has passed (the closed-tab regression)", async () => {
      mockPage([listRow("s-1", false)]);
      mockChunkFacts([endedTabRow("s-1", "tab-1")]);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(request());

      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]!.isFinalized).toBe(false);
      expect(result.sessions[0]!.hasRecordingEnded).toBe(true);
    });

    /*
     * The flap this grace exists for: in a multi-page app, page A's final
     * chunk lands while page B (a new tab id under the same session) has
     * not stored its first chunk yet. For that moment the only tab the
     * rows know about has ended, and without a grace the list would say
     * "Recording ended" for a session that is still recording, then flip
     * back on the next poll.
     */
    test.each([
      ["stored just now", 0, false],
      ["stored 20 s ago (page B's first chunk still on its way)", 20000, false],
      [
        "stored 1 ms short of the grace",
        SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS - 1,
        false,
      ],
      [
        "stored exactly the grace ago",
        SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS,
        true,
      ],
      [
        "stored well past the grace",
        SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS + 5 * 60 * 1000,
        true,
      ],
    ] as Array<[string, number, boolean]>)(
      "a single sealed tab %s (%i ms old): hasRecordingEnded %s",
      async (_label: string, ageMs: number, expected: boolean) => {
        mockPage([listRow("s-1", false)]);
        mockChunkFacts([endedTabRow("s-1", "tab-1")]);

        const result: SessionReplayListResult =
          await SessionReplayReadService.listSessions(
            request({ nowUnixMs: STORED_AT + ageMs }),
          );

        expect(result.sessions[0]!.hasRecordingEnded).toBe(expected);
      },
    );

    test("the grace is measured from the NEWEST stored chunk of any tab, not from the oldest seal", async () => {
      /*
       * Page A sealed and was stored long ago; page B sealed moments ago.
       * Page C may still be about to register, so the session is not over.
       */
      mockPage([listRow("s-1", false)]);
      mockChunkFacts([
        endedTabRow("s-1", "tab-page-a", {
          tabLastChunkStoredAtUnixMs: STORED_AT - 10 * 60 * 1000,
        }),
        endedTabRow("s-1", "tab-page-b", {
          tabLastChunkStoredAtUnixMs: STORED_AT,
        }),
      ]);

      const early: SessionReplayListResult =
        await SessionReplayReadService.listSessions(
          request({ nowUnixMs: GRACE_PASSED - 1 }),
        );
      expect(early.sessions[0]!.hasRecordingEnded).toBe(false);

      const late: SessionReplayListResult =
        await SessionReplayReadService.listSessions(
          request({ nowUnixMs: GRACE_PASSED }),
        );
      expect(late.sessions[0]!.hasRecordingEnded).toBe(true);
    });

    test("the grace reads the rows' server write time, not the device's chunk clock", async () => {
      /*
       * A device clock hours behind the server: its final chunk "ended"
       * long before now, but the row was stored seconds ago.
       */
      mockPage([listRow("s-1", false)]);
      mockChunkFacts([
        endedTabRow("s-1", "tab-1", {
          tabFinalChunkEndUnixMs: FINAL_END - 3 * 60 * 60 * 1000,
          tabLastChunkStartUnixMs: FINAL_END - 3 * 60 * 60 * 1000 - 15000,
        }),
      ]);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(
          request({ nowUnixMs: STORED_AT + 5000 }),
        );

      expect(result.sessions[0]!.hasRecordingEnded).toBe(false);
    });

    test("without an injected clock the list measures the grace against Date.now()", async () => {
      mockPage([listRow("s-1", false)]);
      mockChunkFacts([endedTabRow("s-1", "tab-1")]);

      const nowSpy: jest.SpyInstance = jest
        .spyOn(Date, "now")
        .mockReturnValue(GRACE_PASSED - 1);

      const early: SessionReplayListResult =
        await SessionReplayReadService.listSessions(listRequest());
      expect(early.sessions[0]!.hasRecordingEnded).toBe(false);

      nowSpy.mockReturnValue(GRACE_PASSED);

      const late: SessionReplayListResult =
        await SessionReplayReadService.listSessions(listRequest());
      expect(late.sessions[0]!.hasRecordingEnded).toBe(true);
    });

    /*
     * A tab that reached the per-session chunk cap never gets a final
     * chunk: the ingest gate refuses every index past the last one, the
     * recorder's own truncation seal included. It has ended all the same.
     */
    test.each([
      [
        "at the last permitted index, grace passed",
        MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1,
        GRACE_PASSED,
        true,
      ],
      [
        "at the last permitted index, inside the grace",
        MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1,
        GRACE_PASSED - 1,
        false,
      ],
      [
        "one index short of the cap, grace passed",
        MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 2,
        GRACE_PASSED,
        false,
      ],
    ] as Array<[string, number, number, boolean]>)(
      "a capped tab with no final chunk %s (index %i, now %i): hasRecordingEnded %s",
      async (
        _label: string,
        maxChunkIndex: number,
        nowUnixMs: number,
        expected: boolean,
      ) => {
        mockPage([listRow("s-1", false)]);
        mockChunkFacts([
          liveTabRow("s-1", "tab-1", { tabMaxChunkIndex: maxChunkIndex }),
        ]);

        const result: SessionReplayListResult =
          await SessionReplayReadService.listSessions(
            request({ nowUnixMs: nowUnixMs }),
          );

        expect(result.sessions[0]!.hasRecordingEnded).toBe(expected);
      },
    );

    test("one live tab among ended ones keeps the whole session recording", async () => {
      mockPage([listRow("s-1", false)]);
      mockChunkFacts([
        endedTabRow("s-1", "tab-1"),
        liveTabRow("s-1", "tab-2"),
        endedTabRow("s-1", "tab-3"),
      ]);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(request());

      expect(result.sessions[0]!.hasRecordingEnded).toBe(false);
    });

    test("an older recorder's trailing chunk inside the tolerance still ends the tab; one past it does not", async () => {
      mockPage([listRow("s-trailing", false), listRow("s-resumed", false)]);
      mockChunkFacts([
        endedTabRow("s-trailing", "tab-1", {
          tabLastChunkStartUnixMs:
            FINAL_END + SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS,
        }),
        endedTabRow("s-resumed", "tab-1", {
          tabLastChunkStartUnixMs:
            FINAL_END + SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS + 1,
        }),
      ]);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(request());

      expect(endedBySessionId(result)).toEqual({
        "s-trailing": true,
        "s-resumed": false,
      });
    });

    test("each session is judged on its own tabs and its own stored times", async () => {
      mockPage([
        listRow("s-ended", false),
        listRow("s-live", false),
        listRow("s-mixed", false),
        listRow("s-recent", false),
      ]);
      mockChunkFacts([
        endedTabRow("s-ended", "tab-1"),
        endedTabRow("s-ended", "tab-2"),
        liveTabRow("s-live", "tab-1"),
        endedTabRow("s-mixed", "tab-1"),
        liveTabRow("s-mixed", "tab-2"),
        endedTabRow("s-recent", "tab-1", {
          tabLastChunkStoredAtUnixMs: GRACE_PASSED - 1000,
        }),
      ]);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(request());

      expect(endedBySessionId(result)).toEqual({
        "s-ended": true,
        "s-live": false,
        "s-mixed": false,
        "s-recent": false,
      });
    });

    test("a finalized session is never 'ended', even when chunk facts for it come back", async () => {
      mockPage([listRow("s-final", true), listRow("s-open", false)]);
      mockChunkFacts([
        endedTabRow("s-final", "tab-1"),
        endedTabRow("s-open", "tab-1"),
      ]);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(request());

      expect(endedBySessionId(result)).toEqual({
        "s-final": false,
        "s-open": true,
      });
      expect(boundValues(statementOf(chunkQuerySpy))).toContainEqual([
        "s-open",
      ]);
    });

    test("a page of only finalized sessions runs no follow-up query", async () => {
      mockPage([listRow("s-1", true), listRow("s-2", true)]);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(request());

      expect(chunkQuerySpy).not.toHaveBeenCalled();
      expect(endedBySessionId(result)).toEqual({ "s-1": false, "s-2": false });
    });

    test("an empty page runs no follow-up query", async () => {
      mockPage([]);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(request());

      expect(result.sessions).toHaveLength(0);
      expect(chunkQuerySpy).not.toHaveBeenCalled();
    });

    test("the look-ahead row past the page size is not asked about", async () => {
      mockPage([listRow("s-1", false), listRow("s-2", false)]);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(request({ limit: 1 }));

      expect(result.sessions).toHaveLength(1);
      expect(result.nextCursor).not.toBeNull();
      expect(boundValues(statementOf(chunkQuerySpy))).toContainEqual(["s-1"]);
    });

    test("an unfinalized session with no chunk rows yet is not 'ended'", async () => {
      mockPage([listRow("s-1", false), listRow("s-2", false)]);
      mockChunkFacts([endedTabRow("s-2", "tab-1")]);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(request());

      expect(endedBySessionId(result)).toEqual({ "s-1": false, "s-2": true });
    });

    test("a thrown follow-up leaves every row false and still returns the list", async () => {
      const warnSpy: jest.SpyInstance = jest
        .spyOn(logger, "warn")
        .mockImplementation((): void => {
          return;
        });

      mockPage([listRow("s-1", false), listRow("s-2", true)]);
      chunkQuerySpy.mockRejectedValue(new Error("clickhouse down") as never);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(request());

      expect(result.sessions).toHaveLength(2);
      expect(endedBySessionId(result)).toEqual({ "s-1": false, "s-2": false });
      expect(warnSpy).toHaveBeenCalled();
    });

    test("a follow-up whose body cannot be parsed degrades the same way", async () => {
      jest.spyOn(logger, "warn").mockImplementation((): void => {
        return;
      });

      mockPage([listRow("s-1", false)]);
      chunkQuerySpy.mockResolvedValue({
        json: async (): Promise<JSONObject> => {
          throw new Error("truncated body");
        },
      } as never);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(request());

      expect(result.sessions[0]!.hasRecordingEnded).toBe(false);
    });

    test("ClickHouse's quoted numbers parse, and a missing clock is never read as ended", async () => {
      mockPage([
        listRow("s-quoted", false),
        listRow("s-no-start", false),
        listRow("s-no-end", false),
        listRow("s-garbled", false),
        listRow("s-no-stored-at", false),
        listRow("s-blank-stored-at", false),
        listRow("s-no-index", false),
      ]);
      mockChunkFacts([
        {
          sessionId: "s-quoted",
          tabId: "tab-1",
          tabHasFinalChunk: "1",
          tabFinalChunkEndUnixMs: String(FINAL_END),
          tabLastChunkStartUnixMs: String(FINAL_END - 15000),
          tabMaxChunkIndex: "4",
          tabLastChunkStoredAtUnixMs: String(STORED_AT),
        },
        {
          sessionId: "s-no-start",
          tabId: "tab-1",
          tabHasFinalChunk: 1,
          tabFinalChunkEndUnixMs: FINAL_END,
          tabMaxChunkIndex: 4,
          tabLastChunkStoredAtUnixMs: STORED_AT,
        },
        {
          sessionId: "s-no-end",
          tabId: "tab-1",
          tabHasFinalChunk: 1,
          tabLastChunkStartUnixMs: FINAL_END - 15000,
          tabMaxChunkIndex: 4,
          tabLastChunkStoredAtUnixMs: STORED_AT,
        },
        {
          sessionId: "s-garbled",
          tabId: "tab-1",
          tabHasFinalChunk: 1,
          tabFinalChunkEndUnixMs: "not-a-number",
          tabLastChunkStartUnixMs: FINAL_END - 15000,
          tabMaxChunkIndex: 4,
          tabLastChunkStoredAtUnixMs: STORED_AT,
        },
        /*
         * A missing write time must not read as 0 - epoch is older than
         * any grace, which would skip it outright.
         */
        {
          sessionId: "s-no-stored-at",
          tabId: "tab-1",
          tabHasFinalChunk: 1,
          tabFinalChunkEndUnixMs: FINAL_END,
          tabLastChunkStartUnixMs: FINAL_END - 15000,
          tabMaxChunkIndex: 4,
        },
        {
          sessionId: "s-blank-stored-at",
          tabId: "tab-1",
          tabHasFinalChunk: 1,
          tabFinalChunkEndUnixMs: FINAL_END,
          tabLastChunkStartUnixMs: FINAL_END - 15000,
          tabMaxChunkIndex: 4,
          tabLastChunkStoredAtUnixMs: " ",
        },
        /*
         * A missing chunk index only means the cap rule cannot apply; a
         * sealed tab is still judged by its seal.
         */
        {
          sessionId: "s-no-index",
          tabId: "tab-1",
          tabHasFinalChunk: 1,
          tabFinalChunkEndUnixMs: FINAL_END,
          tabLastChunkStartUnixMs: FINAL_END - 15000,
          tabLastChunkStoredAtUnixMs: STORED_AT,
        },
      ]);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(request());

      expect(endedBySessionId(result)).toEqual({
        "s-quoted": true,
        "s-no-start": false,
        "s-no-end": false,
        "s-garbled": false,
        "s-no-stored-at": false,
        "s-blank-stored-at": false,
        "s-no-index": true,
      });
    });

    test("a missing or garbled chunk index never reads as capped", async () => {
      mockPage([listRow("s-no-index", false), listRow("s-garbled", false)]);
      mockChunkFacts([
        liveTabRow("s-no-index", "tab-1", { tabMaxChunkIndex: undefined }),
        liveTabRow("s-garbled", "tab-1", { tabMaxChunkIndex: "Infinity" }),
      ]);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(request());

      expect(endedBySessionId(result)).toEqual({
        "s-no-index": false,
        "s-garbled": false,
      });
    });

    test("a chunk row for a session that was not asked about decides nothing", async () => {
      mockPage([listRow("s-1", false)]);
      mockChunkFacts([
        endedTabRow("s-1", "tab-1"),
        liveTabRow("someone-else", "tab-1"),
        endedTabRow("", "tab-1"),
      ]);

      const result: SessionReplayListResult =
        await SessionReplayReadService.listSessions(request());

      expect(result.sessions[0]!.hasRecordingEnded).toBe(true);
    });

    test("the follow-up does not change the list statement or its filters", async () => {
      mockPage([listRow("s-1", false)]);

      const query: string = await listQuery({ isFinalized: false });

      /* "Live" stays "not finalized"; the chunk facts never reach HAVING. */
      expect(havingSection(query)).toMatch(/aggIsFinalized = \{p\d+:Bool\}/);
      expect(query).not.toContain("isFinal)");
      expect(query).not.toContain("tabHasFinalChunk");
      expect(query).not.toContain("tabLastChunkStoredAtUnixMs");
    });
  });

  describe("getSessionHeader", () => {
    const headerRow: JSONObject = {
      sessionId: "s-1",
      headerProjectId: "p",
      applicationId: "a",
      aggStartTime: 1700000000000,
      aggEndTime: 1700000060000,
      aggIsFinalized: 1,
      aggClientReportedStart: 1699999999000,
      aggTags: { env: "prod" },
      aggExpiresAt: 1700604800000,
      aggClickCount: 7,
      aggCustomEventCount: 2,
      aggActiveMs: 30000,
      aggFirstErrorOffsetMs: 5000,
      aggAttributes: {
        "recorder.capabilities": "click-events,web-vitals,made-up",
      },
      aggIdentifiedUserKey: "hmac-key",
      aggVisitorId: "0123456789abcdef0123456789abcdef",
    };

    test("never names the identity columns and pins the application only when given one", async () => {
      headerQuerySpy.mockResolvedValue(fakeResultSet([headerRow]) as never);

      await SessionReplayReadService.getSessionHeader({
        projectId: projectId,
        sessionId: "s-1",
      });

      const plain: string = statementOf(headerQuerySpy).query;
      expect(plain).not.toContain("identifiedUserLabel");
      expect(plain).not.toContain("identifiedUserTraits");
      expect(plain).not.toContain("rumApplicationId = ");
      expect(plain).toContain("LIMIT 2");
      expect(plain).toContain("retentionDate >= now()");

      headerQuerySpy.mockClear();

      await SessionReplayReadService.getSessionHeader({
        projectId: projectId,
        sessionId: "s-1",
        rumApplicationId: rumApplicationId,
      });

      const pinned: Statement = statementOf(headerQuerySpy);
      expect(whereSection(pinned.query)).toContain("rumApplicationId = ");
      expect(boundValues(pinned)).toContain(rumApplicationId.toString());
    });

    test("maps the clock, tags, expiry, counters and the known recorder capabilities", async () => {
      headerQuerySpy.mockResolvedValue(fakeResultSet([headerRow]) as never);

      const header: SessionReplaySessionHeader | null =
        await SessionReplayReadService.getSessionHeader({
          projectId: projectId,
          sessionId: "s-1",
        });

      expect(header).not.toBeNull();
      expect(header!.startTimeUnixMs).toBe(1700000000000);
      expect(header!.endTimeUnixMs).toBe(1700000060000);
      expect(header!.clientReportedStartUnixMs).toBe(1699999999000);
      expect(header!.tags).toEqual({ env: "prod" });
      expect(header!.expiresAtUnixMs).toBe(1700604800000);
      expect(header!.clickCount).toBe(7);
      expect(header!.customEventCount).toBe(2);
      expect(header!.activeMs).toBe(30000);
      expect(header!.firstErrorOffsetMs).toBe(5000);
      /* A stored value outside the vocabulary never reaches the player. */
      expect(header!.recorderCapabilities).toEqual([
        "click-events",
        "web-vitals",
      ]);
      expect(header!.identifiedUserLabel).toBeUndefined();
      expect(header!.identifiedUserTraits).toBeUndefined();
    });

    /*
     * The digest alias was always SELECTed by the header read and simply
     * never mapped, so the player had no key to hand back to /list for
     * "this person's other sessions". Both keys ride on the header read
     * itself - not on the separate, identity-gated getSessionIdentity -
     * because neither names anyone.
     */
    test("maps the identity digest and the visitor id off the header read, without the identity columns", async () => {
      headerQuerySpy.mockResolvedValue(fakeResultSet([headerRow]) as never);

      const header: SessionReplaySessionHeader | null =
        await SessionReplayReadService.getSessionHeader({
          projectId: projectId,
          sessionId: "s-1",
        });

      const query: string = statementOf(headerQuerySpy).query;
      expect(query).toContain(
        "argMax(identifiedUserKey, version) AS aggIdentifiedUserKey",
      );
      expect(query).toContain("argMax(visitorId, version) AS aggVisitorId");
      expect(query).not.toContain("identifiedUserLabel");

      expect(header!.identifiedUserKey).toBe("hmac-key");
      expect(header!.visitorId).toBe("0123456789abcdef0123456789abcdef");

      /* An older recorder's header reads as "", never undefined. */
      const olderRow: JSONObject = { ...headerRow, aggIdentifiedUserKey: "" };
      delete olderRow["aggVisitorId"];

      headerQuerySpy.mockResolvedValue(fakeResultSet([olderRow]) as never);

      const older: SessionReplaySessionHeader | null =
        await SessionReplayReadService.getSessionHeader({
          projectId: projectId,
          sessionId: "s-1",
        });

      expect(older!.identifiedUserKey).toBe("");
      expect(older!.visitorId).toBe("");
    });

    /*
     * The header read is also the authorization lookup behind every chunk
     * and heartbeat request (cached 30s), so it must not grow a chunk-table
     * read. It answers false; getManifest judges the field.
     */
    test("never reads the chunk table and leaves hasRecordingEnded to the manifest", async () => {
      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          { ...headerRow, aggIsFinalized: 0, aggSealedReason: "final-chunk" },
        ]) as never,
      );

      const header: SessionReplaySessionHeader | null =
        await SessionReplayReadService.getSessionHeader({
          projectId: projectId,
          sessionId: "s-1",
          rumApplicationId: rumApplicationId,
        });

      expect(header!.isFinalized).toBe(false);
      expect(header!.hasRecordingEnded).toBe(false);
      expect(chunkQuerySpy).not.toHaveBeenCalled();
    });

    test("an ambiguous session id is refused with an actionable message", async () => {
      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          headerRow,
          { ...headerRow, applicationId: "b" },
        ]) as never,
      );

      await expect(
        SessionReplayReadService.getSessionHeader({
          projectId: projectId,
          sessionId: "s-1",
        }),
      ).rejects.toThrow(/rumApplicationId/);
    });
  });

  describe("getSessionIdentity", () => {
    test("names both identity columns, pinned to the application", async () => {
      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          {
            aggIdentifiedUserLabel: "jane@example.com",
            aggIdentifiedUserTraits: { plan: "pro", seats: 4 },
          },
        ]) as never,
      );

      const identity: SessionReplaySessionIdentity =
        await SessionReplayReadService.getSessionIdentity({
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          sessionId: "s-1",
        });

      const statement: Statement = statementOf(headerQuerySpy);
      expect(statement.query).toContain(
        "argMax(identifiedUserLabel, version) AS aggIdentifiedUserLabel",
      );
      expect(statement.query).toContain(
        "argMax(identifiedUserTraits, version) AS aggIdentifiedUserTraits",
      );
      expect(whereSection(statement.query)).toContain("rumApplicationId = ");
      expect(statement.query).toContain("retentionDate >= now()");

      expect(identity.identifiedUserLabel).toBe("jane@example.com");
      /* A numeric-looking trait still renders. */
      expect(identity.identifiedUserTraits).toEqual({
        plan: "pro",
        seats: "4",
      });
    });

    test("answers empty rather than throwing when no row survives retention", async () => {
      const identity: SessionReplaySessionIdentity =
        await SessionReplayReadService.getSessionIdentity({
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          sessionId: "s-1",
        });

      expect(identity).toEqual({
        identifiedUserLabel: "",
        identifiedUserTraits: {},
      });
    });
  });

  /*
   * The per-user rollup: the list grouped by person. What is pinned is
   * that it is TWO levels - sessions de-duplicated exactly as the list
   * does them, THEN grouped - because a rollup over raw ReplacingMergeTree
   * rows counts a session once per header version; that the WHERE is the
   * same sort-key prefix and never names an identity key; that the cursor
   * is a HAVING keyset over the rollup aliases and touches the WHERE not
   * at all (a WHERE bound on startTime would return a person from the
   * previous page as a phantom with partial counts); and that the label
   * and traits are named at neither level unless asked.
   */
  describe("listUsers", () => {
    const VISITOR_ID: string = "0123456789abcdef0123456789abcdef";

    function usersRequest(
      overrides: Partial<SessionReplayUsersRequest> = {},
    ): SessionReplayUsersRequest {
      return {
        projectId: projectId,
        rumApplicationId: rumApplicationId,
        startTime: new Date("2026-08-01T00:00:00.000Z"),
        endTime: new Date("2026-08-08T00:00:00.000Z"),
        limit: 20,
        includeIdentifiedUserLabel: false,
        ...overrides,
      };
    }

    async function usersQuery(
      overrides: Partial<SessionReplayUsersRequest> = {},
    ): Promise<string> {
      await SessionReplayReadService.listUsers(usersRequest(overrides));

      return statementOf(headerQuerySpy).query;
    }

    /* The per-session subquery: from its opening paren to the outer GROUP BY. */
    function innerSection(query: string): string {
      const start: number = query.indexOf("FROM (");
      const end: number = query.indexOf("GROUP BY rollupKey");

      if (start < 0 || end < 0) {
        throw new Error("Statement is not the two-level rollup shape");
      }

      return query.substring(start, end);
    }

    /* Everything that is NOT the subquery. */
    function outerSection(query: string): string {
      const start: number = query.indexOf("FROM (");
      const end: number = query.indexOf("GROUP BY rollupKey");

      return query.substring(0, start) + query.substring(end);
    }

    function rollupRow(overrides: JSONObject = {}): JSONObject {
      return {
        rollupKey: "u:hmac-1",
        rollupIdentifiedUserKey: "hmac-1",
        rollupVisitorId: VISITOR_ID,
        rollupSessionCount: 3,
        rollupLiveSessionCount: 1,
        rollupFirstSeenUnixMs: 1700000000000,
        rollupLastSeenUnixMs: 1700000900000,
        rollupTotalDurationMs: 180000,
        rollupErrorCount: 2,
        rollupFrustrationCount: 4,
        rollupErrorSessionCount: 1,
        rollupPageCount: 9,
        rollupLastSessionId: "s-3",
        rollupLastEntryUrl: "https://a/checkout",
        rollupBrowserName: "Chrome",
        rollupBrowserVersion: "128",
        rollupOsName: "macOS",
        rollupDeviceType: "desktop",
        rollupCountryCode: "GB",
        ...overrides,
      };
    }

    test("de-duplicates each session at the inner level exactly as the list does", async () => {
      const query: string = await usersQuery();
      const inner: string = innerSection(query);

      expect(inner).toContain(
        "GROUP BY projectId, rumApplicationId, sessionId",
      );
      expect(inner).toContain(
        "argMax(identifiedUserKey, version) AS aggIdentifiedUserKey",
      );
      expect(inner).toContain("argMax(visitorId, version) AS aggVisitorId");
      expect(inner).toContain(
        "toFloat64(toUnixTimestamp64Milli(argMax(startTime, version))) AS aggStartTime",
      );
      /* The list's live-duration expression, verbatim: one definition. */
      expect(inner).toContain(
        "toFloat64(if(argMax(isFinalized, version), toInt64(argMax(durationMs, version)), greatest(toInt64(argMax(durationMs, version)), toUnixTimestamp64Milli(argMax(endTime, version)) - toUnixTimestamp64Milli(argMax(startTime, version))))) AS aggDurationMs",
      );
      expect(inner).toContain(
        "toFloat64(argMax(errorCount, version)) AS aggErrorCount",
      );
      expect(inner).toContain("argMax(isFinalized, version) AS aggIsFinalized");
      expect(inner).toContain("argMax(hasError, version) AS aggHasError");

      expect(query).not.toContain(" FINAL");
      expect(query).toContain("retentionDate >= now()");
      expect(query).toContain("timeout_overflow_mode = 'throw'");
      expect(query).not.toMatch(/\bpayload\b(?!Bytes)/);
    });

    test("files each session under its user, else its browser, else the anonymous bucket, and groups the outer level by that key", async () => {
      const query: string = await usersQuery();

      expect(innerSection(query)).toContain(
        "if(aggIdentifiedUserKey != '', concat('u:', aggIdentifiedUserKey), if(aggVisitorId != '', concat('v:', aggVisitorId), '')) AS rollupKey",
      );

      const outer: string = outerSection(query);
      expect(outer).toContain("GROUP BY rollupKey");
      expect(outer).toContain(
        "ORDER BY rollupLastSeenUnixMs DESC, rollupKey DESC",
      );
      /* The bucket is a row like any other: nothing excludes the empty key. */
      expect(outer).not.toContain("rollupKey != ''");
    });

    test("the outer level counts, sums and takes the newest session's facts over the de-duplicated aliases", async () => {
      const query: string = await usersQuery();
      const outer: string = outerSection(query);

      for (const projection of [
        "toFloat64(count()) AS rollupSessionCount",
        "toFloat64(countIf(aggIsFinalized = 0)) AS rollupLiveSessionCount",
        "toFloat64(min(aggStartTime)) AS rollupFirstSeenUnixMs",
        "toFloat64(max(aggStartTime)) AS rollupLastSeenUnixMs",
        "toFloat64(sum(aggDurationMs)) AS rollupTotalDurationMs",
        "toFloat64(sum(aggErrorCount)) AS rollupErrorCount",
        "toFloat64(sum(aggRageClickCount + aggDeadClickCount + aggErrorClickCount + aggRefreshRageCount)) AS rollupFrustrationCount",
        "toFloat64(countIf(aggHasError)) AS rollupErrorSessionCount",
        "toFloat64(sum(aggPageCount)) AS rollupPageCount",
        "argMax(sessionId, aggStartTime) AS rollupLastSessionId",
        "argMax(aggEntryUrl, aggStartTime) AS rollupLastEntryUrl",
        "argMax(aggIdentifiedUserKey, aggStartTime) AS rollupIdentifiedUserKey",
        "argMax(aggVisitorId, aggStartTime) AS rollupVisitorId",
        "argMax(aggBrowserName, aggStartTime) AS rollupBrowserName",
        "argMax(aggBrowserVersion, aggStartTime) AS rollupBrowserVersion",
        "argMax(aggOsName, aggStartTime) AS rollupOsName",
        "argMax(aggDeviceType, aggStartTime) AS rollupDeviceType",
        "argMax(aggCountryCode, aggStartTime) AS rollupCountryCode",
      ]) {
        expect(outer).toContain(projection);
      }

      /* Never a sum over a raw column: that counts every header version. */
      expect(outer).not.toContain("sum(errorCount)");
      expect(outer).not.toContain("sum(durationMs)");
      expect(outer).not.toContain("argMax(entryUrl,");
    });

    test("the WHERE is the sort-key prefix plus retention and never names an identity key, cursor or not", async () => {
      const query: string = await usersQuery({
        cursor: { lastSeenUnixMs: 1700000000000, groupKey: "u:hmac-1" },
      });
      const where: string = whereSection(query);

      expect(where).toContain("projectId = ");
      expect(where).toContain("rumApplicationId = ");
      expect(where).toContain("startTime >= ");
      expect(where).toContain("startTime <= ");
      expect(where).toContain("retentionDate >= now()");

      for (const forbidden of [
        "identifiedUserKey",
        "visitorId",
        "identifiedUserLabel",
        "rollupKey",
        "rollupLastSeenUnixMs",
      ]) {
        expect(where).not.toContain(forbidden);
      }

      /*
       * The window's own upper bound and nothing from the cursor: a
       * cursor-derived WHERE bound would drop a previous-page person's
       * newest sessions and return them again with a smaller "last seen".
       */
      expect(where.match(/startTime <= /g)).toHaveLength(1);

      const bound: Array<unknown> = boundValues(statementOf(headerQuerySpy));
      expect(bound).toContain(projectId.toString());
      expect(bound).toContain(rumApplicationId.toString());
    });

    test("names the identity columns at both levels only when the caller may read them", async () => {
      const plain: string = await usersQuery();
      expect(plain).not.toContain("identifiedUserLabel");
      expect(plain).not.toContain("identifiedUserTraits");

      headerQuerySpy.mockClear();

      const permitted: string = await usersQuery({
        includeIdentifiedUserLabel: true,
      });

      expect(innerSection(permitted)).toContain(
        "argMax(identifiedUserLabel, version) AS aggIdentifiedUserLabel",
      );
      expect(innerSection(permitted)).toContain(
        "argMax(identifiedUserTraits, version) AS aggIdentifiedUserTraits",
      );
      expect(outerSection(permitted)).toContain(
        "argMax(aggIdentifiedUserLabel, aggStartTime) AS rollupIdentifiedUserLabel",
      );
      expect(outerSection(permitted)).toContain(
        "argMax(aggIdentifiedUserTraits, aggStartTime) AS rollupIdentifiedUserTraits",
      );
      /* Still never in a WHERE. */
      expect(whereSection(permitted)).not.toContain("identifiedUser");
    });

    test("the cursor is a bound HAVING keyset over the rollup aliases, and one row over the page is fetched", async () => {
      const query: string = await usersQuery({
        limit: 20,
        cursor: {
          lastSeenUnixMs: 1700000000000,
          groupKey: `v:${VISITOR_ID}`,
        },
      });

      expect(havingSection(query)).toMatch(
        /AND \(rollupLastSeenUnixMs < \{p\d+:Double\} OR \(rollupLastSeenUnixMs = \{p\d+:Double\} AND rollupKey < \{p\d+:String\}\)\)/,
      );
      expect(query).toMatch(/LIMIT \{p\d+:Int32\}/);
      expect(query).not.toContain(`'v:${VISITOR_ID}'`);

      const bound: Array<unknown> = boundValues(statementOf(headerQuerySpy));
      expect(bound).toContain(21);
      expect(bound).toContain(`v:${VISITOR_ID}`);
      expect(
        bound.filter((value: unknown): boolean => {
          return value === 1700000000000;
        }),
      ).toHaveLength(2);
    });

    test("without a cursor the HAVING carries no keyset", async () => {
      const query: string = await usersQuery();
      expect(havingSection(query)).not.toContain("rollupLastSeenUnixMs <");
      expect(havingSection(query)).not.toContain("rollupKey <");
    });

    /*
     * The anonymous bucket's key is the empty string, and the bucket can
     * be the last row of a page like any other - so "" must be accepted as
     * a tiebreak and bound as itself, not treated as "no cursor".
     */
    test("the anonymous bucket's empty key is a valid cursor tiebreak", async () => {
      const query: string = await usersQuery({
        cursor: { lastSeenUnixMs: 5, groupKey: "" },
      });

      expect(havingSection(query)).toContain("AND rollupKey < ");
      expect(boundValues(statementOf(headerQuerySpy))).toContain("");
    });

    test("maps the rollup rows, deriving kind from the key prefix", async () => {
      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          rollupRow({
            rollupSessionCount: "3",
            rollupTotalDurationMs: "180000",
          }),
          rollupRow({
            rollupKey: `v:${VISITOR_ID}`,
            rollupIdentifiedUserKey: "",
            rollupLastSeenUnixMs: 1700000800000,
            rollupSessionCount: 1,
          }),
          rollupRow({
            rollupKey: "",
            rollupIdentifiedUserKey: "",
            rollupVisitorId: "",
            rollupLastSeenUnixMs: 1700000700000,
            rollupSessionCount: 7,
          }),
        ]) as never,
      );

      const result: SessionReplayUsersResult =
        await SessionReplayReadService.listUsers(usersRequest({ limit: 5 }));

      expect(result.users).toHaveLength(3);
      expect(result.nextCursor).toBeNull();

      const identified: SessionReplayUserRollup = result.users[0]!;
      expect(identified.groupKey).toBe("u:hmac-1");
      expect(identified.kind).toBe("identified");
      expect(identified.identifiedUserKey).toBe("hmac-1");
      expect(identified.visitorId).toBe(VISITOR_ID);
      /* ClickHouse quotes wide integers; numeric strings still read. */
      expect(identified.sessionCount).toBe(3);
      expect(identified.totalDurationMs).toBe(180000);
      expect(identified.liveSessionCount).toBe(1);
      expect(identified.firstSeenUnixMs).toBe(1700000000000);
      expect(identified.lastSeenUnixMs).toBe(1700000900000);
      expect(identified.errorCount).toBe(2);
      expect(identified.frustrationCount).toBe(4);
      expect(identified.errorSessionCount).toBe(1);
      expect(identified.pageCount).toBe(9);
      expect(identified.lastSessionId).toBe("s-3");
      expect(identified.lastEntryUrl).toBe("https://a/checkout");
      expect(identified.browserName).toBe("Chrome");
      expect(identified.browserVersion).toBe("128");
      expect(identified.osName).toBe("macOS");
      expect(identified.deviceType).toBe("desktop");
      expect(identified.countryCode).toBe("GB");
      expect(identified.identifiedUserLabel).toBeUndefined();
      expect(identified.identifiedUserTraits).toBeUndefined();

      const visitor: SessionReplayUserRollup = result.users[1]!;
      expect(visitor.kind).toBe("visitor");
      expect(visitor.identifiedUserKey).toBe("");
      expect(visitor.visitorId).toBe(VISITOR_ID);

      const anonymous: SessionReplayUserRollup = result.users[2]!;
      expect(anonymous.kind).toBe("anonymous");
      expect(anonymous.groupKey).toBe("");
      expect(anonymous.identifiedUserKey).toBe("");
      expect(anonymous.visitorId).toBe("");
      expect(anonymous.sessionCount).toBe(7);
    });

    test("a digest on a non-identified row never leaks into identifiedUserKey", async () => {
      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          rollupRow({
            rollupKey: `v:${VISITOR_ID}`,
            rollupIdentifiedUserKey: "stray",
          }),
        ]) as never,
      );

      const result: SessionReplayUsersResult =
        await SessionReplayReadService.listUsers(usersRequest());

      expect(result.users[0]!.kind).toBe("visitor");
      expect(result.users[0]!.identifiedUserKey).toBe("");
    });

    test("maps the label and traits only when asked, even when the row carries them", async () => {
      const rows: Array<JSONObject> = [
        rollupRow({
          rollupIdentifiedUserLabel: "jane@example.com",
          rollupIdentifiedUserTraits: { plan: "pro", seats: 4 },
        }),
      ];

      headerQuerySpy.mockResolvedValue(fakeResultSet(rows) as never);

      const withheld: SessionReplayUsersResult =
        await SessionReplayReadService.listUsers(usersRequest());
      expect(withheld.users[0]!.identifiedUserLabel).toBeUndefined();
      expect(withheld.users[0]!.identifiedUserTraits).toBeUndefined();

      headerQuerySpy.mockResolvedValue(fakeResultSet(rows) as never);

      const permitted: SessionReplayUsersResult =
        await SessionReplayReadService.listUsers(
          usersRequest({ includeIdentifiedUserLabel: true }),
        );
      expect(permitted.users[0]!.identifiedUserLabel).toBe("jane@example.com");
      expect(permitted.users[0]!.identifiedUserTraits).toEqual({
        plan: "pro",
        seats: "4",
      });
    });

    test("nextCursor carries the last row's clock and key, and only when a page follows", async () => {
      const rows: Array<JSONObject> = [
        rollupRow(),
        rollupRow({
          rollupKey: `v:${VISITOR_ID}`,
          rollupIdentifiedUserKey: "",
          rollupLastSeenUnixMs: 1700000800000,
        }),
        rollupRow({
          rollupKey: "",
          rollupIdentifiedUserKey: "",
          rollupVisitorId: "",
          rollupLastSeenUnixMs: 1700000700000,
        }),
      ];

      headerQuerySpy.mockResolvedValue(fakeResultSet(rows) as never);

      const firstPage: SessionReplayUsersResult =
        await SessionReplayReadService.listUsers(usersRequest({ limit: 2 }));

      expect(firstPage.users).toHaveLength(2);
      expect(firstPage.nextCursor).toEqual({
        lastSeenUnixMs: 1700000800000,
        groupKey: `v:${VISITOR_ID}`,
      });

      headerQuerySpy.mockResolvedValue(fakeResultSet(rows) as never);

      const lastPage: SessionReplayUsersResult =
        await SessionReplayReadService.listUsers(usersRequest({ limit: 3 }));

      expect(lastPage.users).toHaveLength(3);
      expect(lastPage.nextCursor).toBeNull();

      /* The bucket as the last row of a page yields its own empty key. */
      headerQuerySpy.mockResolvedValue(
        fakeResultSet([...rows, rollupRow({ rollupKey: "u:hmac-2" })]) as never,
      );

      const bucketLast: SessionReplayUsersResult =
        await SessionReplayReadService.listUsers(usersRequest({ limit: 3 }));

      expect(bucketLast.nextCursor).toEqual({
        lastSeenUnixMs: 1700000700000,
        groupKey: "",
      });
    });

    test("clamps the page size to the cap and the floor, and answers empty without a row", async () => {
      await SessionReplayReadService.listUsers(usersRequest({ limit: 10000 }));
      expect(boundValues(statementOf(headerQuerySpy))).toContain(
        MAX_SESSION_REPLAY_USERS_LIMIT + 1,
      );

      headerQuerySpy.mockClear();

      await SessionReplayReadService.listUsers(usersRequest({ limit: 0 }));
      expect(boundValues(statementOf(headerQuerySpy))).toContain(2);

      const empty: SessionReplayUsersResult =
        await SessionReplayReadService.listUsers(usersRequest());
      expect(empty).toEqual({ users: [], nextCursor: null });
    });
  });

  describe("getExpiredSessionInfo", () => {
    test("reads past retention, returning only dates and the application", async () => {
      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          {
            applicationId: rumApplicationId.toString(),
            expiresAtUnixMs: 1700604800000,
            startTimeUnixMs: 1700000000000,
          },
        ]) as never,
      );

      const info: SessionReplayExpiredSessionInfo | null =
        await SessionReplayReadService.getExpiredSessionInfo({
          projectId: projectId,
          sessionId: "s-1",
        });

      const query: string = statementOf(headerQuerySpy).query;
      expect(query).not.toContain("retentionDate >= now()");
      expect(query).toContain("max(retentionDate)");
      expect(query).not.toMatch(/\bpayload\b/);
      expect(query).not.toContain("identifiedUser");

      expect(info).not.toBeNull();
      expect(info!.rumApplicationId).toBe(rumApplicationId.toString());
      expect(info!.expiresAt.getTime()).toBe(1700604800000);
      expect(info!.startTime.getTime()).toBe(1700000000000);
    });

    test("is null when no header ever existed", async () => {
      expect(
        await SessionReplayReadService.getExpiredSessionInfo({
          projectId: projectId,
          sessionId: "never",
        }),
      ).toBeNull();
    });
  });

  describe("getManifest", () => {
    function header(
      overrides: Partial<SessionReplaySessionHeader>,
    ): SessionReplaySessionHeader {
      return {
        sessionId: "s-1",
        projectId: projectId.toString(),
        rumApplicationId: rumApplicationId.toString(),
        startTime: new Date(1700000000000),
        endTime: new Date(1700000015000),
        durationMs: 0,
        isFinalized: false,
        sealedReason: "",
        chunkCount: 0,
        maxChunkIndex: 0,
        missingChunkCount: 0,
        eventCount: 0,
        payloadBytes: 0,
        hasError: false,
        errorCount: 0,
        rageClickCount: 0,
        deadClickCount: 0,
        errorClickCount: 0,
        refreshRageCount: 0,
        pageCount: 1,
        triggerReason: "always",
        maskingMode: "MaskAllText",
        consentState: "NotRequired",
        recorderKind: "dom",
        recorderVersion: "1.0.0",
        rrwebVersion: "2.1.1",
        schemaVersion: 1,
        wireVersion: 1,
        entryUrl: "https://a/",
        exitUrl: "https://a/",
        routes: ["https://a/"],
        browserName: "Chrome",
        browserVersion: "1",
        osName: "macOS",
        deviceType: "desktop",
        countryCode: "GB",
        viewportWidth: 1,
        viewportHeight: 1,
        fidelityNotices: [],
        fullSnapshotChunkIndexes: [],
        traceIds: [],
        exceptionFingerprints: [],
        clockSkewMs: 0,
        startTimeUnixMs: 1700000000000,
        endTimeUnixMs: 1700000015000,
        clientReportedStartUnixMs: 1700000000000,
        tags: {},
        expiresAtUnixMs: 1700604800000,
        clickCount: 0,
        customEventCount: 0,
        activeMs: 0,
        firstErrorOffsetMs: 0,
        recorderCapabilities: [],
        identifiedUserKey: "",
        visitorId: "",
        hasRecordingEnded: false,
        ...overrides,
      };
    }

    const chunkRows: Array<JSONObject> = [
      {
        tabId: "tab-1",
        chunkIndex: 0,
        chunkStartOffsetMs: 0,
        chunkEndOffsetMs: 15000,
        eventCount: 100,
        hasFullSnapshot: 1,
        chunkPayloadBytes: 1024,
        clickCount: 3,
        url: "https://a/",
      },
      {
        tabId: "tab-1",
        chunkIndex: 1,
        chunkStartOffsetMs: 15000,
        chunkEndOffsetMs: 30000,
        eventCount: 50,
        hasFullSnapshot: 0,
        chunkPayloadBytes: 512,
        clickCount: 1,
        url: "https://a/checkout",
      },
      {
        tabId: "tab-2",
        chunkIndex: 0,
        chunkStartOffsetMs: 134000,
        chunkEndOffsetMs: 150000,
        eventCount: 20,
        hasFullSnapshot: 1,
        chunkPayloadBytes: 256,
        clickCount: 0,
        url: "https://a/help",
      },
    ];

    test("projects clickCount and url per chunk, never the payload, and derives each tab's first offset", async () => {
      chunkQuerySpy.mockResolvedValue(fakeResultSet(chunkRows) as never);

      const manifest: SessionReplayManifest =
        await SessionReplayReadService.getManifest({
          header: header({ isFinalized: true, durationMs: 150000 }),
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          sessionId: "s-1",
        });

      const query: string = statementOf(chunkQuerySpy).query;
      expect(query).toContain("clickCount");
      expect(query).toContain("url");
      expect(query).not.toMatch(/\bpayload\b(?!Bytes)/);
      expect(query).not.toContain("length(payload)");
      expect(query).toContain("retentionDate >= now()");

      expect(manifest.tabs).toHaveLength(2);
      expect(manifest.tabs[0]!.firstChunkStartOffsetMs).toBe(0);
      expect(manifest.tabs[1]!.firstChunkStartOffsetMs).toBe(134000);
      expect(manifest.tabs[0]!.chunks[1]!.clickCount).toBe(1);
      expect(manifest.tabs[0]!.chunks[1]!.url).toBe("https://a/checkout");
    });

    test("a finalized header is returned untouched", async () => {
      chunkQuerySpy.mockResolvedValue(fakeResultSet(chunkRows) as never);

      const finalized: SessionReplaySessionHeader = header({
        isFinalized: true,
        durationMs: 90000,
        chunkCount: 9,
        eventCount: 9,
      });

      const manifest: SessionReplayManifest =
        await SessionReplayReadService.getManifest({
          header: finalized,
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          sessionId: "s-1",
        });

      expect(manifest.header).toBe(finalized);
    });

    test("a provisional header reports what its chunk rows prove instead of zeros", async () => {
      chunkQuerySpy.mockResolvedValue(fakeResultSet(chunkRows) as never);

      const manifest: SessionReplayManifest =
        await SessionReplayReadService.getManifest({
          header: header({ isFinalized: false }),
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          sessionId: "s-1",
        });

      expect(manifest.header.isFinalized).toBe(false);
      expect(manifest.header.durationMs).toBe(150000);
      expect(manifest.header.chunkCount).toBe(3);
      expect(manifest.header.eventCount).toBe(170);
      expect(manifest.header.maxChunkIndex).toBe(1);
      expect(manifest.header.endTimeUnixMs).toBe(1700000150000);
      expect(manifest.header.endTime.getTime()).toBe(1700000150000);
    });

    /*
     * The player's Live pill reads the manifest header. The header read
     * itself never judges hasRecordingEnded (it is also the cached
     * authorization lookup), so the manifest does, with the same helper
     * and the same statement as the list.
     */
    describe("hasRecordingEnded on the manifest header", () => {
      const FINAL_END: number = 1700000150000;
      /* Server write time of the newest chunk row (its version). */
      const STORED_AT: number = FINAL_END + 1500;
      const GRACE_PASSED: number =
        STORED_AT + SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS;

      function endedTabRow(
        tabId: string,
        overrides: JSONObject = {},
      ): JSONObject {
        return {
          sessionId: "s-1",
          tabId: tabId,
          tabHasFinalChunk: 1,
          tabFinalChunkEndUnixMs: FINAL_END,
          tabLastChunkStartUnixMs: FINAL_END - 16000,
          tabMaxChunkIndex: 1,
          tabLastChunkStoredAtUnixMs: STORED_AT,
          ...overrides,
        };
      }

      function liveTabRow(
        tabId: string,
        overrides: JSONObject = {},
      ): JSONObject {
        return {
          sessionId: "s-1",
          tabId: tabId,
          tabHasFinalChunk: 0,
          tabFinalChunkEndUnixMs: 0,
          tabLastChunkStartUnixMs: FINAL_END,
          tabMaxChunkIndex: 1,
          tabLastChunkStoredAtUnixMs: STORED_AT,
          ...overrides,
        };
      }

      async function manifestAt(
        nowUnixMs: number | undefined,
      ): Promise<SessionReplayManifest> {
        return SessionReplayReadService.getManifest({
          header: header({ isFinalized: false }),
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          sessionId: "s-1",
          ...(nowUnixMs !== undefined && { nowUnixMs: nowUnixMs }),
        });
      }

      function mockManifestThenFacts(facts: Array<JSONObject>): void {
        chunkQuerySpy
          .mockResolvedValueOnce(fakeResultSet(chunkRows) as never)
          .mockResolvedValueOnce(fakeResultSet(facts) as never);
      }

      test("an unfinalized session whose every tab sent its final chunk is ended once the grace has passed, read pinned to the authorized application", async () => {
        mockManifestThenFacts([
          endedTabRow("tab-1"),
          endedTabRow("tab-2", {
            tabLastChunkStartUnixMs: FINAL_END + 4,
          }),
        ]);

        const manifest: SessionReplayManifest = await manifestAt(GRACE_PASSED);

        expect(chunkQuerySpy).toHaveBeenCalledTimes(2);

        /* The manifest statement goes first and is unchanged. */
        const manifestQuery: string = statementOf(chunkQuerySpy, 0).query;
        expect(manifestQuery).toContain("LIMIT 1 BY tabId, chunkIndex");
        expect(manifestQuery).not.toContain("tabHasFinalChunk");

        const ended: Statement = statementOf(chunkQuerySpy, 1);
        expect(ended.query).toContain("GROUP BY sessionId, tabId");
        expect(ended.query).toMatch(
          /AND sessionId IN \(\{p\d+:Array\(String\)\}\)/,
        );
        expect(ended.query).toMatch(/AND rumApplicationId = \{p\d+:String\}/);
        expect(ended.query).toContain(
          "toFloat64(max(chunkIndex)) AS tabMaxChunkIndex",
        );
        expect(ended.query).toContain(
          "toFloat64(max(version)) AS tabLastChunkStoredAtUnixMs",
        );
        expect(boundValues(ended)).toContainEqual(["s-1"]);
        expect(boundValues(ended)).toContain(rumApplicationId.toString());
        expect(boundValues(ended)).toContain(projectId.toString());

        expect(manifest.header.isFinalized).toBe(false);
        expect(manifest.header.hasRecordingEnded).toBe(true);
        /* The live reconciliation still happens alongside it. */
        expect(manifest.header.durationMs).toBe(150000);
        expect(manifest.header.chunkCount).toBe(3);
      });

      /*
       * The player's Live pill must not switch off while a multi-page
       * app's next page is still registering its first chunk.
       */
      test.each([
        ["stored just now", 0, false],
        [
          "stored 1 ms short of the grace",
          SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS - 1,
          false,
        ],
        [
          "stored exactly the grace ago",
          SESSION_REPLAY_ENDED_FINALIZE_GRACE_MS,
          true,
        ],
      ] as Array<[string, number, boolean]>)(
        "a single sealed tab %s (%i ms old): hasRecordingEnded %s",
        async (_label: string, ageMs: number, expected: boolean) => {
          mockManifestThenFacts([endedTabRow("tab-1")]);

          const manifest: SessionReplayManifest = await manifestAt(
            STORED_AT + ageMs,
          );

          expect(manifest.header.hasRecordingEnded).toBe(expected);
        },
      );

      test("a capped tab with no final chunk is ended after the grace, not before", async () => {
        const capped: JSONObject = liveTabRow("tab-1", {
          tabMaxChunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1,
        });

        mockManifestThenFacts([capped]);
        expect(
          (await manifestAt(GRACE_PASSED - 1)).header.hasRecordingEnded,
        ).toBe(false);

        mockManifestThenFacts([capped]);
        expect((await manifestAt(GRACE_PASSED)).header.hasRecordingEnded).toBe(
          true,
        );
      });

      test("without an injected clock the manifest measures the grace against Date.now()", async () => {
        const nowSpy: jest.SpyInstance = jest
          .spyOn(Date, "now")
          .mockReturnValue(GRACE_PASSED - 1);

        mockManifestThenFacts([endedTabRow("tab-1")]);
        expect((await manifestAt(undefined)).header.hasRecordingEnded).toBe(
          false,
        );

        nowSpy.mockReturnValue(GRACE_PASSED);

        mockManifestThenFacts([endedTabRow("tab-1")]);
        expect((await manifestAt(undefined)).header.hasRecordingEnded).toBe(
          true,
        );
      });

      test("one tab still recording keeps the header live", async () => {
        mockManifestThenFacts([endedTabRow("tab-1"), liveTabRow("tab-2")]);

        const manifest: SessionReplayManifest = await manifestAt(GRACE_PASSED);

        expect(manifest.header.hasRecordingEnded).toBe(false);
      });

      test("a tab that kept recording past the tolerance after its final chunk keeps the header live", async () => {
        mockManifestThenFacts([
          endedTabRow("tab-1", {
            tabLastChunkStartUnixMs:
              FINAL_END + SESSION_REPLAY_ENDED_TRAILING_CHUNK_TOLERANCE_MS + 1,
          }),
        ]);

        const manifest: SessionReplayManifest = await manifestAt(GRACE_PASSED);

        expect(manifest.header.hasRecordingEnded).toBe(false);
      });

      test("a finalized header runs no second read and is still returned untouched", async () => {
        chunkQuerySpy.mockResolvedValue(fakeResultSet(chunkRows) as never);

        const finalized: SessionReplaySessionHeader = header({
          isFinalized: true,
          durationMs: 150000,
        });

        const manifest: SessionReplayManifest =
          await SessionReplayReadService.getManifest({
            header: finalized,
            projectId: projectId,
            rumApplicationId: rumApplicationId,
            sessionId: "s-1",
            nowUnixMs: GRACE_PASSED,
          });

        expect(chunkQuerySpy).toHaveBeenCalledTimes(1);
        expect(manifest.header).toBe(finalized);
        expect(manifest.header.hasRecordingEnded).toBe(false);
      });

      test("a failed ended read answers 'not ended' and never fails the manifest", async () => {
        const warnSpy: jest.SpyInstance = jest
          .spyOn(logger, "warn")
          .mockImplementation((): void => {
            return;
          });

        chunkQuerySpy
          .mockResolvedValueOnce(fakeResultSet(chunkRows) as never)
          .mockRejectedValueOnce(new Error("clickhouse down") as never);

        const manifest: SessionReplayManifest = await manifestAt(GRACE_PASSED);

        expect(manifest.tabs).toHaveLength(2);
        expect(manifest.header.hasRecordingEnded).toBe(false);
        expect(manifest.header.chunkCount).toBe(3);
        expect(warnSpy).toHaveBeenCalled();
      });

      test("a failed manifest read still fails, whatever the ended read answered", async () => {
        chunkQuerySpy
          .mockRejectedValueOnce(new Error("manifest down") as never)
          .mockResolvedValueOnce(
            fakeResultSet([endedTabRow("tab-1")]) as never,
          );

        await expect(manifestAt(GRACE_PASSED)).rejects.toThrow("manifest down");
      });

      test("an unfinalized header with no chunk rows is not ended and keeps its fields", async () => {
        const provisional: SessionReplaySessionHeader = header({
          isFinalized: false,
        });

        const manifest: SessionReplayManifest =
          await SessionReplayReadService.getManifest({
            header: provisional,
            projectId: projectId,
            rumApplicationId: rumApplicationId,
            sessionId: "s-1",
            nowUnixMs: GRACE_PASSED,
          });

        expect(manifest.tabs).toHaveLength(0);
        expect(manifest.header).toEqual({
          ...provisional,
          hasRecordingEnded: false,
        });
      });

      /*
       * The list badge and the player's Live pill are two reads of one
       * helper. Fed the same chunk facts at the same server "now", they
       * must give the same answer, at every edge of the rule.
       */
      describe("the list and the manifest agree", () => {
        const scenarios: Array<[string, Array<JSONObject>, number, boolean]> = [
          [
            "a sealed tab inside the grace",
            [endedTabRow("tab-1")],
            GRACE_PASSED - 1,
            false,
          ],
          [
            "a sealed tab at the grace",
            [endedTabRow("tab-1")],
            GRACE_PASSED,
            true,
          ],
          [
            "a capped non-final tab inside the grace",
            [
              liveTabRow("tab-1", {
                tabMaxChunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1,
              }),
            ],
            GRACE_PASSED - 1,
            false,
          ],
          [
            "a capped non-final tab at the grace",
            [
              liveTabRow("tab-1", {
                tabMaxChunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 1,
              }),
            ],
            GRACE_PASSED,
            true,
          ],
          [
            "a non-final tab one index short of the cap",
            [
              liveTabRow("tab-1", {
                tabMaxChunkIndex: MAX_SESSION_REPLAY_CHUNKS_PER_SESSION - 2,
              }),
            ],
            GRACE_PASSED,
            false,
          ],
          [
            "an old sealed tab next to a freshly sealed one",
            [
              endedTabRow("tab-1", {
                tabLastChunkStoredAtUnixMs: STORED_AT - 10 * 60 * 1000,
              }),
              endedTabRow("tab-2"),
            ],
            GRACE_PASSED - 1,
            false,
          ],
          [
            "a sealed tab next to a live one",
            [endedTabRow("tab-1"), liveTabRow("tab-2")],
            GRACE_PASSED,
            false,
          ],
        ];

        test.each(scenarios)(
          "%s",
          async (
            _label: string,
            facts: Array<JSONObject>,
            nowUnixMs: number,
            expected: boolean,
          ) => {
            /*
             * Answer each chunk-table statement by what it is, so the
             * list's single follow-up and the manifest's pair can share
             * one mock regardless of order.
             */
            chunkQuerySpy.mockImplementation(
              async (statement: Statement): Promise<unknown> => {
                return fakeResultSet(
                  statement.query.includes("tabHasFinalChunk")
                    ? facts
                    : chunkRows,
                );
              },
            );
            headerQuerySpy.mockResolvedValue(
              fakeResultSet([
                {
                  sessionId: "s-1",
                  applicationId: rumApplicationId.toString(),
                  aggStartTime: FINAL_END - 60000,
                  aggEndTime: FINAL_END,
                  aggIsFinalized: 0,
                  aggSealedReason: "",
                },
              ]) as never,
            );

            const list: SessionReplayListResult =
              await SessionReplayReadService.listSessions(
                listRequest({ nowUnixMs: nowUnixMs }),
              );
            const manifest: SessionReplayManifest = await manifestAt(nowUnixMs);

            expect(list.sessions).toHaveLength(1);
            expect(list.sessions[0]!.hasRecordingEnded).toBe(expected);
            expect(manifest.header.hasRecordingEnded).toBe(expected);
          },
        );
      });
    });
  });

  describe("getChunks", () => {
    const chunkRequest: {
      projectId: ObjectID;
      rumApplicationId: ObjectID;
      sessionId: string;
      tabId: string;
      chunkIndexes: Array<number>;
    } = {
      projectId: projectId,
      rumApplicationId: rumApplicationId,
      sessionId: "s-1",
      tabId: "tab-1",
      chunkIndexes: [0, 1, 2],
    };

    test("measures the stored size in the one statement that ships the bytes", async () => {
      chunkQuerySpy.mockResolvedValue(
        fakeResultSet([
          { chunkIndex: 0, servedPayload: "[1]", isServed: 1 },
          { chunkIndex: 1, servedPayload: "[22]", isServed: 1 },
        ]) as never,
      );

      const result: SessionReplayChunkReadResult =
        await SessionReplayReadService.getChunks(chunkRequest);

      expect(chunkQuerySpy).toHaveBeenCalledTimes(1);

      const query: string = statementOf(chunkQuerySpy).query;
      expect(query).toContain("length(payload)");
      expect(query).not.toContain("toFloat64(payloadBytes)");
      expect(query).toContain(
        "ORDER BY chunkIndex ASC, version DESC LIMIT 1 BY chunkIndex",
      );
      expect(query).toContain(
        "row_number() OVER (ORDER BY chunkIndex ASC) = 1",
      );
      expect(query).toContain("retentionDate >= now()");
      expect(boundValues(statementOf(chunkQuerySpy))).toContain(
        MAX_SESSION_REPLAY_READ_BYTES,
      );

      expect(
        result.chunks.map((c: { chunkIndex: number }): number => {
          return c.chunkIndex;
        }),
      ).toEqual([0, 1]);
      expect(result.omittedChunkIndexes).toEqual([]);
    });

    test("serves the prefix that fits and names what was left out, never refusing outright", async () => {
      chunkQuerySpy.mockResolvedValue(
        fakeResultSet([
          { chunkIndex: 0, servedPayload: "[1]", isServed: 1 },
          { chunkIndex: 1, servedPayload: "", isServed: 0 },
          { chunkIndex: 2, servedPayload: "[3]", isServed: 1 },
        ]) as never,
      );

      const result: SessionReplayChunkReadResult =
        await SessionReplayReadService.getChunks(chunkRequest);

      expect(
        result.chunks.map((c: { chunkIndex: number }): number => {
          return c.chunkIndex;
        }),
      ).toEqual([0]);
      /* Chunk 2 fit, but a hole before it would be unplayable. */
      expect(result.omittedChunkIndexes).toEqual([1, 2]);
    });

    test("a single oversized chunk is still served: the ingest cap already bounded it", async () => {
      const fat: string = "a".repeat(MAX_SESSION_REPLAY_READ_BYTES + 10);

      chunkQuerySpy.mockResolvedValue(
        fakeResultSet([
          { chunkIndex: 0, servedPayload: fat, isServed: 1 },
        ]) as never,
      );

      const result: SessionReplayChunkReadResult =
        await SessionReplayReadService.getChunks({
          ...chunkRequest,
          chunkIndexes: [0],
        });

      expect(result.chunks).toHaveLength(1);
      expect(result.omittedChunkIndexes).toEqual([]);
    });

    test("re-applies the cap to the bytes actually returned", async () => {
      const half: string = "a".repeat(5 * 1024 * 1024);

      chunkQuerySpy.mockResolvedValue(
        fakeResultSet([
          { chunkIndex: 0, servedPayload: half, isServed: 1 },
          { chunkIndex: 1, servedPayload: half, isServed: 1 },
        ]) as never,
      );

      const result: SessionReplayChunkReadResult =
        await SessionReplayReadService.getChunks({
          ...chunkRequest,
          chunkIndexes: [0, 1],
        });

      expect(
        result.chunks.map((c: { chunkIndex: number }): number => {
          return c.chunkIndex;
        }),
      ).toEqual([0]);
      expect(result.omittedChunkIndexes).toEqual([1]);
    });

    test("refuses more than the per-read chunk cap before querying", async () => {
      await expect(
        SessionReplayReadService.getChunks({
          ...chunkRequest,
          chunkIndexes: [0, 1, 2, 3, 4, 5, 6, 7, 8],
        }),
      ).rejects.toBeInstanceOf(BadDataException);
      expect(chunkQuerySpy).not.toHaveBeenCalled();
    });
  });

  describe("getSessionsForException", () => {
    test("always bounds the window and consults the exception instances for live sessions", async () => {
      exceptionQuerySpy.mockResolvedValue(
        fakeResultSet([
          { sessionId: "live-1" },
          { sessionId: "live-2" },
        ]) as never,
      );

      await SessionReplayReadService.getSessionsForException({
        projectId: projectId,
        exceptionFingerprint: "fp-1",
        accessibleRumApplicationIds: null,
        limit: 5,
      });

      const instances: Statement = statementOf(exceptionQuerySpy);
      expect(instances.query).toContain("SELECT DISTINCT sessionId");
      expect(instances.query).toContain("fingerprint = ");
      expect(instances.query).toContain("sessionId != ''");
      expect(instances.query).toContain("time >= ");
      expect(instances.query).toContain("time <= ");
      expect(boundValues(instances)).toContain("fp-1");

      const headers: Statement = statementOf(headerQuerySpy);
      const where: string = whereSection(headers.query);
      expect(where).toContain("startTime >= ");
      expect(where).toContain("startTime <= ");
      expect(where).toContain("retentionDate >= now()");
      expect(where).toMatch(
        /AND \(hasAny\(exceptionFingerprints, \[\{p\d+:String\}\]\) OR sessionId IN \(\{p\d+:Array\(String\)\}\)\)/,
      );
      expect(
        havingSection(headers.query.replace("HAVING (", "HAVING 1 = 1 AND (")),
      ).toMatch(
        /hasAny\(aggExceptionFingerprints, \[\{p\d+:String\}\]\) OR sessionId IN \(\{p\d+:Array\(String\)\}\)/,
      );
      expect(boundValues(headers)).toContainEqual(["live-1", "live-2"]);
    });

    /*
     * A pinned sessionId NARROWS the instance lookup; it does not replace
     * it. Returning the pin unchecked reduced the statement to
     * `sessionId = X AND (hasAny(fingerprints, [f]) OR sessionId IN (X))`,
     * whose second arm is trivially true - so the fingerprint constrained
     * nothing and the "Watch what the user saw" card would present any
     * accessible session as having observed the exception, on nothing but a
     * stale occurrence row.
     */
    test("a pinned session id still has to be confirmed by the instance table", async () => {
      exceptionQuerySpy.mockResolvedValue(
        fakeResultSet([{ sessionId: "s-9" }]) as never,
      );

      await SessionReplayReadService.getSessionsForException({
        projectId: projectId,
        exceptionFingerprint: "fp-1",
        accessibleRumApplicationIds: null,
        sessionId: "s-9",
        limit: 5,
      });

      const instances: Statement = statementOf(exceptionQuerySpy);
      expect(instances.query).toContain("fingerprint = ");
      expect(instances.query).toContain("AND sessionId = ");
      expect(boundValues(instances)).toContain("fp-1");
      expect(boundValues(instances)).toContain("s-9");

      const headers: Statement = statementOf(headerQuerySpy);
      expect(whereSection(headers.query)).toContain("AND sessionId = ");
      expect(boundValues(headers)).toContain("s-9");
    });

    test("scopes both live instances and finalized fingerprint matches to the exception's primary entity", async () => {
      const primaryEntityId: ObjectID = ObjectID.generate();

      exceptionQuerySpy.mockResolvedValue(
        fakeResultSet([{ sessionId: "scoped-live-session" }]) as never,
      );

      await SessionReplayReadService.getSessionsForException({
        projectId: projectId,
        exceptionFingerprint: "shared-fingerprint",
        primaryEntityId: primaryEntityId,
        accessibleRumApplicationIds: null,
        limit: 5,
      });

      const instances: Statement = statementOf(exceptionQuerySpy);
      expect(instances.query).toContain("AND primaryEntityId = ");
      expect(boundValues(instances)).toContain(primaryEntityId.toString());

      const headers: Statement = statementOf(headerQuerySpy);
      const where: string = whereSection(headers.query);
      expect(where).toMatch(
        /\(rumApplicationId = \{p\d+:String\} AND hasAny\(exceptionFingerprints/,
      );
      expect(where).toContain("OR sessionId IN (");
      expect(headers.query).toMatch(
        /HAVING \(\(rumApplicationId = \{p\d+:String\} AND hasAny\(aggExceptionFingerprints/,
      );
      expect(boundValues(headers)).toContain(primaryEntityId.toString());
      expect(boundValues(headers)).toContainEqual(["scoped-live-session"]);
    });

    test("a pinned session the instance table has never seen falls back to the fingerprint alone", async () => {
      /* The session exists, but it never threw this exception. */
      exceptionQuerySpy.mockResolvedValue(fakeResultSet([]) as never);

      await SessionReplayReadService.getSessionsForException({
        projectId: projectId,
        exceptionFingerprint: "fp-1",
        accessibleRumApplicationIds: null,
        sessionId: "s-9",
        limit: 5,
      });

      const headers: Statement = statementOf(headerQuerySpy);

      /*
       * No `OR sessionId IN (...)` escape hatch: the header's own
       * fingerprint list is the only thing that can admit the row.
       */
      expect(headers.query).not.toContain("OR sessionId IN (");
      expect(headers.query).toContain("hasAny(exceptionFingerprints");
    });

    test("a failed instance lookup degrades to the finalized headers", async () => {
      exceptionQuerySpy.mockRejectedValue(
        new Error("clickhouse down") as never,
      );
      headerQuerySpy.mockResolvedValue(
        fakeResultSet([
          {
            sessionId: "s-1",
            applicationId: rumApplicationId.toString(),
            aggStartTime: 1,
            aggEndTime: 2,
            aggIsFinalized: 1,
          },
        ]) as never,
      );

      const sessions: Array<SessionReplayExceptionSession> =
        await SessionReplayReadService.getSessionsForException({
          projectId: projectId,
          exceptionFingerprint: "fp-1",
          accessibleRumApplicationIds: null,
          limit: 5,
        });

      expect(sessions).toHaveLength(1);
      expect(statementOf(headerQuerySpy).query).not.toContain(
        "OR sessionId IN (",
      );
    });

    test("a caller who reaches no application gets no rows and no query", async () => {
      const sessions: Array<SessionReplayExceptionSession> =
        await SessionReplayReadService.getSessionsForException({
          projectId: projectId,
          exceptionFingerprint: "fp-1",
          accessibleRumApplicationIds: [],
          limit: 5,
        });

      expect(sessions).toEqual([]);
      expect(headerQuerySpy).not.toHaveBeenCalled();
      expect(exceptionQuerySpy).not.toHaveBeenCalled();
    });
  });

  describe("getApplicationActivitySummary", () => {
    const summaryRows: Array<Array<JSONObject>> = [
      [{ sessionCount: 143, unplayableCount: 3 }],
      [{ lastStartUnixMs: 1700000000000 }],
    ];

    function mockSummaryRows(): void {
      headerQuerySpy
        .mockResolvedValueOnce(fakeResultSet(summaryRows[0]!) as never)
        .mockResolvedValueOnce(fakeResultSet(summaryRows[1]!) as never);
    }

    test("counts without a GROUP BY and reads the latest start in sort-key order", async () => {
      mockSummaryRows();

      const summary: SessionReplayApplicationActivitySummary =
        await SessionReplayReadService.getApplicationActivitySummary({
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          nowUnixMs: 1700000000000,
        });

      expect(headerQuerySpy).toHaveBeenCalledTimes(2);

      const counts: Statement = statementOf(headerQuerySpy, 0);
      expect(counts.query).toContain("uniqExact(sessionId)");
      expect(counts.query).toContain(
        "uniqExactIf(sessionId, isFinalized AND (chunkCount = 0 OR sealedReason = ",
      );
      expect(counts.query).not.toContain("GROUP BY");
      expect(counts.query).toContain("startTime >= ");
      expect(counts.query).toContain("retentionDate >= now()");
      expect(counts.query).not.toMatch(/\bpayload\b/);
      expect(boundValues(counts)).toContain("recording-lost");

      const latest: Statement = statementOf(headerQuerySpy, 1);
      expect(latest.query).toContain("ORDER BY startTime DESC LIMIT 1");
      expect(latest.query).not.toContain("GROUP BY");
      expect(latest.query).toContain("retentionDate >= now()");

      expect(summary.sessionsLast24h).toBe(143);
      expect(summary.playableSessionsLast24h).toBe(140);
      expect(summary.lastSessionStartedAt?.getTime()).toBe(1700000000000);
    });

    test("is served from memory within the cache window and re-read after it", async () => {
      mockSummaryRows();

      await SessionReplayReadService.getApplicationActivitySummary({
        projectId: projectId,
        rumApplicationId: rumApplicationId,
        nowUnixMs: 1700000000000,
      });
      await SessionReplayReadService.getApplicationActivitySummary({
        projectId: projectId,
        rumApplicationId: rumApplicationId,
        nowUnixMs:
          1700000000000 + SESSION_REPLAY_ACTIVITY_SUMMARY_CACHE_TTL_MS - 1,
      });

      expect(headerQuerySpy).toHaveBeenCalledTimes(2);

      mockSummaryRows();

      await SessionReplayReadService.getApplicationActivitySummary({
        projectId: projectId,
        rumApplicationId: rumApplicationId,
        nowUnixMs:
          1700000000000 + SESSION_REPLAY_ACTIVITY_SUMMARY_CACHE_TTL_MS + 1,
      });

      expect(headerQuerySpy).toHaveBeenCalledTimes(4);
    });

    test("answers null counts, never zero, when ClickHouse cannot be read", async () => {
      headerQuerySpy.mockRejectedValue(new Error("timeout") as never);

      const summary: SessionReplayApplicationActivitySummary =
        await SessionReplayReadService.getApplicationActivitySummary({
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          nowUnixMs: 1700000000000,
        });

      expect(summary).toEqual({
        sessionsLast24h: null,
        playableSessionsLast24h: null,
        lastSessionStartedAt: null,
        recorderCapabilities: null,
      });
    });

    /*
     * The health card and the installation test both promise "the
     * capabilities of the newest recorder that reported" - the one place an
     * operator can spot a stale cached artifact ("click labels: no")
     * without opening a recording, which writes an audit row. The route
     * never sent them, so the row said "not reported yet" for every
     * application forever. They ride on the last-session query rather than
     * costing a query of their own.
     */
    test("the newest session's recorder capabilities ride on the last-start read", async () => {
      headerQuerySpy
        .mockResolvedValueOnce(
          fakeResultSet([{ sessionCount: 4, unplayableCount: 0 }]) as never,
        )
        .mockResolvedValueOnce(
          fakeResultSet([
            {
              lastStartUnixMs: 1700000000000,
              aggAttributes: {
                "recorder.capabilities":
                  "click-events,web-vitals,not-a-capability",
              },
            },
          ]) as never,
        );

      const summary: SessionReplayApplicationActivitySummary =
        await SessionReplayReadService.getApplicationActivitySummary({
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          nowUnixMs: 1700000000000,
        });

      const latest: Statement = statementOf(headerQuerySpy, 1);
      expect(latest.query).toContain("attributes AS aggAttributes");

      /* Filtered to the vocabulary this build knows. */
      expect(summary.recorderCapabilities).toEqual([
        "click-events",
        "web-vitals",
      ]);
    });

    test("a session that declared no capabilities answers null, never an empty list", async () => {
      headerQuerySpy
        .mockResolvedValueOnce(
          fakeResultSet([{ sessionCount: 1, unplayableCount: 0 }]) as never,
        )
        .mockResolvedValueOnce(
          fakeResultSet([{ lastStartUnixMs: 1700000000000 }]) as never,
        );

      const summary: SessionReplayApplicationActivitySummary =
        await SessionReplayReadService.getApplicationActivitySummary({
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          nowUnixMs: 1700000000000,
        });

      /*
       * "An old recorder declared nothing" and "we could not tell" are both
       * rendered as "not reported yet"; claiming the recorder can do
       * NOTHING would be a stronger statement than the row supports.
       */
      expect(summary.recorderCapabilities).toBeNull();
    });

    test("an application with no session in retention has no last start", async () => {
      headerQuerySpy
        .mockResolvedValueOnce(
          fakeResultSet([{ sessionCount: 0, unplayableCount: 0 }]) as never,
        )
        .mockResolvedValueOnce(fakeResultSet([]) as never);

      const summary: SessionReplayApplicationActivitySummary =
        await SessionReplayReadService.getApplicationActivitySummary({
          projectId: projectId,
          rumApplicationId: rumApplicationId,
          nowUnixMs: 1700000000000,
        });

      expect(summary.sessionsLast24h).toBe(0);
      expect(summary.lastSessionStartedAt).toBeNull();
    });
  });

  describe("published recorder version", () => {
    test("is unknown until a provider is registered, and survives a throwing provider", () => {
      expect(SessionReplayReadService.getPublishedRecorderVersion()).toBeNull();

      SessionReplayReadService.setPublishedRecorderVersionProvider(
        (): string | null => {
          return "2.3.4";
        },
      );
      expect(SessionReplayReadService.getPublishedRecorderVersion()).toBe(
        "2.3.4",
      );

      SessionReplayReadService.setPublishedRecorderVersionProvider(
        (): string | null => {
          throw new Error("manifest unreadable");
        },
      );
      expect(SessionReplayReadService.getPublishedRecorderVersion()).toBeNull();

      SessionReplayReadService.setPublishedRecorderVersionProvider(
        (): string | null => {
          return "";
        },
      );
      expect(SessionReplayReadService.getPublishedRecorderVersion()).toBeNull();
    });
  });
});
