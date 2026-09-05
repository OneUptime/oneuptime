import RumSessionService from "../../../../Server/Services/RumSessionService";
import RumSessionChunkService from "../../../../Server/Services/RumSessionChunkService";
import ExceptionInstanceService from "../../../../Server/Services/ExceptionInstanceService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import SessionReplayReadService, {
  MAX_LIST_ROUTES,
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
} from "../../../../Server/Utils/SessionReplay/SessionReplayReadService";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { MAX_SESSION_REPLAY_READ_BYTES } from "../../../../Types/Rum/SessionReplay";
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
