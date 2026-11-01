import RumSessionService from "../../../../Server/Services/RumSessionService";
import RumSessionChunkService from "../../../../Server/Services/RumSessionChunkService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import SessionReplayIdentity from "../../../../Server/Utils/SessionReplay/SessionReplayIdentity";
import SessionReplayReadService from "../../../../Server/Utils/SessionReplay/SessionReplayReadService";
import SessionReplayUserFlowReadService, {
  clampUserFlowMaxSessions,
  hasUserFlowPersonFilter,
  readUserFlowPersonFilter,
  UserFlowJourneysRequest,
  UserFlowPersonFilterResult,
} from "../../../../Server/Utils/SessionReplay/SessionReplayUserFlowReadService";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SESSION_REPLAY_MAX_USER_REF_LENGTH } from "../../../../Types/Rum/SessionReplay";
import {
  readUserFlowJourneysResponse,
  USER_FLOW_DEFAULT_MAX_SESSIONS,
  USER_FLOW_IGNORED_USER_REFERENCE,
  USER_FLOW_MAX_PAGES_PER_JOURNEY,
  USER_FLOW_MAX_SESSIONS,
  UserFlowJourneysResponseDto,
} from "../../../../Types/Rum/UserFlow";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The User Flows read, without a database: the statements it would run and
 * the dictionary encoding of what comes back. The real-ClickHouse suite
 * (App/Tests/Telemetry/SessionReplayUserFlowClickhouse.test.ts) proves the
 * server accepts the SQL; this one pins the properties a later edit could
 * quietly lose - the payload column is never named, the chunk read is
 * keyed by the header read's session ids, and retried deliveries collapse.
 */

const REQUEST: UserFlowJourneysRequest = {
  projectId: new ObjectID("6600000000000000000000d1"),
  rumApplicationId: new ObjectID("6600000000000000000000d2"),
  startTime: new Date("2026-09-20T00:00:00.000Z"),
  endTime: new Date("2026-09-21T00:00:00.000Z"),
};

function fakeResultSet(rows: Array<JSONObject>): unknown {
  return {
    json: async (): Promise<JSONObject> => {
      return { data: rows } as unknown as JSONObject;
    },
  };
}

function boundValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function squash(query: string): string {
  return query.replace(/\s+/g, " ");
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("clampUserFlowMaxSessions", () => {
  test("defaults, floors and caps", () => {
    expect(clampUserFlowMaxSessions(undefined)).toBe(
      USER_FLOW_DEFAULT_MAX_SESSIONS,
    );
    expect(clampUserFlowMaxSessions(Number.NaN)).toBe(
      USER_FLOW_DEFAULT_MAX_SESSIONS,
    );
    expect(clampUserFlowMaxSessions(0)).toBe(1);
    expect(clampUserFlowMaxSessions(12.7)).toBe(12);
    expect(clampUserFlowMaxSessions(10 ** 9)).toBe(USER_FLOW_MAX_SESSIONS);
  });
});

describe("statements", () => {
  test("the header read is the sort-key prefix plus retention, newest first, capped", () => {
    const statement: Statement =
      SessionReplayUserFlowReadService.buildHeaderStatement(REQUEST, 250);
    const query: string = squash(statement.query);

    expect(query).toContain("WHERE projectId = ");
    expect(query).toContain("AND rumApplicationId = ");
    expect(query).toContain("AND startTime >= ");
    expect(query).toContain("AND startTime <= ");
    expect(query).toContain("AND retentionDate >= now()");
    expect(query).toContain("GROUP BY sessionId");
    expect(query).toContain(
      "ORDER BY flowStartUnixMs DESC, flowSessionId DESC",
    );
    /* Header columns are argMax'd: a provisional and a finalized row count once. */
    expect(query).toContain("argMax(deviceType, version) AS flowDeviceType");
    expect(boundValues(statement)).toContain(AnalyticsTableName.RumSession);
    expect(boundValues(statement)).toContain(250);
    expect(query).toContain("timeout_overflow_mode = 'throw'");
  });

  test("the chunk read never names the payload and is keyed by the newest sessions", () => {
    const statement: Statement =
      SessionReplayUserFlowReadService.buildChunkStatement(REQUEST, 250);
    const query: string = squash(statement.query);

    expect(query).not.toMatch(/\bpayload\b/);
    expect(boundValues(statement)).toContain(
      AnalyticsTableName.RumSessionChunk,
    );
    expect(boundValues(statement)).toContain(AnalyticsTableName.RumSession);
    expect(query).toContain("AND sessionId IN ( SELECT sessionId FROM (");
    expect(query).toContain(
      "ORDER BY flowNewestStart DESC, sessionId DESC LIMIT",
    );
    /* A retried delivery or a pinned copy collapses to one row per chunk. */
    expect(query).toContain(
      "ORDER BY version DESC LIMIT 1 BY sessionId, tabId, chunkIndex",
    );
    /* Chunks are ordered by wall clock across tabs, then by tab and index. */
    expect(query).toContain(
      "flowChunk -> (flowChunk.1, flowChunk.2, flowChunk.3)",
    );
    expect(query).toContain(
      "groupArray((chunkStartTime, tabId, chunkIndex, flowChunkRoutes))",
    );
    /*
     * Every chunk's list ends on the page it was flushed from, so a return
     * in a session's last chunk is where the journey ends even in a
     * recording whose list holds each page once.
     */
    expect(query).toContain(
      "if(url = '' OR routes[-1] = url, routes, arrayPushBack(routes, url)) AS flowChunkRoutes",
    );
    /* Back-to-back repeats are collapsed in the statement. */
    expect(query).toContain(
      "(flowRoute, flowAt) -> flowAt = 1 OR flowRoute != flowRawRoutes[flowAt - 1]",
    );
    expect(boundValues(statement)).toContain(USER_FLOW_MAX_PAGES_PER_JOURNEY);
    expect(query).toContain("AND retentionDate >= now()");
  });

  test("the exit is read before any cap can reach it, and a cut journey says so", () => {
    const query: string = squash(
      SessionReplayUserFlowReadService.buildChunkStatement(REQUEST, 250).query,
    );

    expect(query).toContain("flowAllRoutes[-1] AS flowExitRoute");
    expect(query.indexOf("flowAllRoutes[-1]")).toBeLessThan(
      query.indexOf("GROUP BY sessionId )"),
    );
    expect(query).toContain("flowRouteCount > length(flowRawRoutes)");
    expect(query).toContain("OR length(flowJourney) > ");
    expect(query).toContain(") AS flowIsCut");
  });

  test("the count reads the same window", () => {
    const statement: Statement =
      SessionReplayUserFlowReadService.buildCountStatement(REQUEST);
    const query: string = squash(statement.query);

    expect(query).toContain("uniqExact(sessionId)");
    expect(query).toContain("AND startTime >= ");
    expect(query).toContain("AND retentionDate >= now()");
  });

  test("every statement binds the tenant and the application", () => {
    for (const statement of [
      SessionReplayUserFlowReadService.buildHeaderStatement(REQUEST, 10),
      SessionReplayUserFlowReadService.buildChunkStatement(REQUEST, 10),
      SessionReplayUserFlowReadService.buildCountStatement(REQUEST),
    ]) {
      const values: Array<string> = boundValues(statement).map(
        (value: unknown): string => {
          return String(value);
        },
      );

      expect(values).toContain(REQUEST.projectId.toString());
      expect(values).toContain(REQUEST.rumApplicationId.toString());
    }
  });
});

describe("everyone's read", () => {
  /*
   * The page never asks who anyone is to draw a map, so the statements behind
   * it must not name a person: this is what let the route say it projects no
   * identity at all, and it keeps saying so.
   */
  test("names no identity column in any statement, whatever the flag says", () => {
    for (const statement of [
      SessionReplayUserFlowReadService.buildHeaderStatement(
        { ...REQUEST, includeIdentifiedUserLabel: true },
        10,
      ),
      SessionReplayUserFlowReadService.buildChunkStatement(
        { ...REQUEST, includeIdentifiedUserLabel: true },
        10,
      ),
      SessionReplayUserFlowReadService.buildCountStatement({
        ...REQUEST,
        includeIdentifiedUserLabel: true,
      }),
    ]) {
      expect(statement.query).not.toMatch(
        /identifiedUserKey|identifiedUserLabel|visitorId/,
      );
      expect(statement.query).not.toContain("HAVING");
    }
  });
});

describe("one person", () => {
  const KEY: string = "a".repeat(64);
  const VISITOR: string = "b".repeat(32);
  const SESSION: string = "c".repeat(32);

  const ONE: UserFlowJourneysRequest = {
    ...REQUEST,
    person: { identifiedUserKey: KEY },
  };

  test("all three statements carry the same predicate, so they cannot disagree", () => {
    for (const statement of [
      SessionReplayUserFlowReadService.buildHeaderStatement(ONE, 10),
      SessionReplayUserFlowReadService.buildChunkStatement(ONE, 10),
      SessionReplayUserFlowReadService.buildCountStatement(ONE),
    ]) {
      expect(squash(statement.query)).toMatch(
        /GROUP BY sessionId HAVING \(argMax\(identifiedUserKey, version\) = \{p\d+:String\}\)/,
      );
      expect(boundValues(statement)).toContain(KEY);
    }
  });

  /*
   * A WHERE would run over raw rows: a session re-identified as someone else
   * would stay in the first person's journeys. The real-ClickHouse suite
   * proves that; this keeps the predicate out of the WHERE for good.
   */
  test("the predicate is never on raw rows", () => {
    for (const statement of [
      SessionReplayUserFlowReadService.buildHeaderStatement(ONE, 10),
      SessionReplayUserFlowReadService.buildCountStatement(ONE),
    ]) {
      const query: string = squash(statement.query);
      const where: string = query.slice(
        query.indexOf("WHERE"),
        query.indexOf("GROUP BY"),
      );

      expect(where).not.toContain("identifiedUserKey");
      expect(where).not.toContain("visitorId");
    }
  });

  test("the count goes through the same groups, not uniqExact over raw rows", () => {
    const query: string = squash(
      SessionReplayUserFlowReadService.buildCountStatement(ONE).query,
    );

    expect(query).toContain("SELECT toFloat64(count()) AS flowSessionCount");
    expect(query).not.toContain("uniqExact");
  });

  test("the chunk read keeps its sessions to this person's newest", () => {
    const query: string = squash(
      SessionReplayUserFlowReadService.buildChunkStatement(ONE, 10).query,
    );

    expect(query.indexOf("HAVING")).toBeGreaterThan(
      query.indexOf("AND sessionId IN ("),
    );
    expect(query.indexOf("HAVING")).toBeLessThan(
      query.indexOf("ORDER BY flowNewestStart DESC"),
    );
  });

  test("a typed value matches any of the three it could be", () => {
    const statement: Statement =
      SessionReplayUserFlowReadService.buildHeaderStatement(
        {
          ...REQUEST,
          person: {
            identifiedUserKey: KEY,
            visitorId: VISITOR,
            sessionId: SESSION,
          },
        },
        10,
      );

    expect(squash(statement.query)).toMatch(
      /HAVING \(argMax\(identifiedUserKey, version\) = \{p\d+:String\} OR argMax\(visitorId, version\) = \{p\d+:String\} OR sessionId = \{p\d+:String\}\)/,
    );
    expect(boundValues(statement)).toEqual(
      expect.arrayContaining([KEY, VISITOR, SESSION]),
    );
  });

  test("a person with nothing left to match matches nobody, never everyone", () => {
    for (const statement of [
      SessionReplayUserFlowReadService.buildHeaderStatement(
        { ...REQUEST, person: {} },
        10,
      ),
      SessionReplayUserFlowReadService.buildChunkStatement(
        { ...REQUEST, person: {} },
        10,
      ),
      SessionReplayUserFlowReadService.buildCountStatement({
        ...REQUEST,
        person: {},
      }),
    ]) {
      expect(squash(statement.query)).toContain("GROUP BY sessionId HAVING 0");
    }
  });

  test("the label is named only when the role may read it", () => {
    const denied: string =
      SessionReplayUserFlowReadService.buildHeaderStatement(ONE, 10).query;
    const allowed: string =
      SessionReplayUserFlowReadService.buildHeaderStatement(
        { ...ONE, includeIdentifiedUserLabel: true },
        10,
      ).query;

    expect(denied).not.toContain("identifiedUserLabel");
    expect(allowed).toContain(
      "argMax(identifiedUserLabel, version) AS flowUserLabel",
    );
    /* The digest and the visitor id are the list's, under the ordinary ACL. */
    expect(denied).toContain(
      "argMax(identifiedUserKey, version) AS flowUserKey",
    );
    expect(denied).toContain("argMax(visitorId, version) AS flowVisitorId");
  });

  test("aliases never shadow a physical column", () => {
    const query: string = SessionReplayUserFlowReadService.buildHeaderStatement(
      { ...ONE, includeIdentifiedUserLabel: true },
      10,
    ).query;

    for (const column of [
      "identifiedUserKey",
      "identifiedUserLabel",
      "visitorId",
      "isFinalized",
      "sealedReason",
      "chunkCount",
    ]) {
      expect(query).not.toContain(`AS ${column}`);
    }
  });

  test("still never names the payload", () => {
    expect(
      SessionReplayUserFlowReadService.buildChunkStatement(ONE, 10).query,
    ).not.toMatch(/\bpayload\b/);
  });
});

describe("readUserFlowPersonFilter", () => {
  const PROJECT: ObjectID = REQUEST.projectId;

  const read: (
    filters: JSONObject,
    canReadIdentity?: boolean,
  ) => UserFlowPersonFilterResult = (
    filters: JSONObject,
    canReadIdentity: boolean = true,
  ): UserFlowPersonFilterResult => {
    return readUserFlowPersonFilter({
      filters: filters,
      projectId: PROJECT,
      canReadIdentity: canReadIdentity,
    });
  };

  const VISITOR: string = "b".repeat(32);

  test("no person named reads everyone, and asks nothing about identity", () => {
    expect(read({})).toEqual({ person: undefined, ignoredFilters: [] });
    expect(read({ visitorId: null, sessionId: undefined } as never)).toEqual({
      person: undefined,
      ignoredFilters: [],
    });
    expect(hasUserFlowPersonFilter({})).toBe(false);
    expect(hasUserFlowPersonFilter({ somethingElse: "x" })).toBe(false);
    expect(hasUserFlowPersonFilter({ sessionId: "x" })).toBe(true);
    expect(hasUserFlowPersonFilter({ identifier: "x" })).toBe(true);
  });

  test("a reference is hashed the way the ingest hashed it", () => {
    const expected: string = SessionReplayIdentity.buildUserKey({
      projectId: PROJECT,
      userRef: "jane@example.com",
    });

    expect(read({ identifier: "  jane@example.com " }).person).toMatchObject({
      identifiedUserKey: expected,
    });
  });

  test("the reference itself never reaches a statement", () => {
    const { person } = read({ identifier: "jane@example.com" });

    expect(person?.visitorId).toBeUndefined();
    expect(person?.identifiedUserKey).not.toContain("jane");

    const statement: Statement =
      SessionReplayUserFlowReadService.buildHeaderStatement(
        {
          ...REQUEST,
          person: { identifiedUserKey: person?.identifiedUserKey },
        },
        10,
      );

    expect(JSON.stringify(boundValues(statement))).not.toContain("jane");
  });

  test("a value that could be a visitor id or a session id is tried as each", () => {
    expect(read({ identifier: VISITOR }).person).toEqual({
      identifiedUserKey: SessionReplayIdentity.buildUserKey({
        projectId: PROJECT,
        userRef: VISITOR,
      }),
      visitorId: VISITOR,
      sessionId: VISITOR,
    });
  });

  test("a value too long to be a session id is not tried as one", () => {
    const long: string = "x".repeat(200);

    expect(read({ identifier: long }).person?.sessionId).toBeUndefined();
  });

  /*
   * The gate the session list has for the same reason: without it a caller
   * denied the label could ask "does jane@example.com have sessions here"
   * and read the answer, one candidate at a time.
   */
  describe("a role that may not read identity", () => {
    test("is never told whether a reference has sessions: it is not hashed", () => {
      const result: UserFlowPersonFilterResult = read(
        { identifier: "jane@example.com" },
        false,
      );

      expect(result.person?.identifiedUserKey).toBeUndefined();
      expect(result.ignoredFilters).toEqual([USER_FLOW_IGNORED_USER_REFERENCE]);
    });

    test("can still follow a link, which names nobody", () => {
      expect(read({ identifiedUserKey: "a".repeat(64) }, false)).toEqual({
        person: { identifiedUserKey: "a".repeat(64) },
        ignoredFilters: [],
      });
      expect(read({ visitorId: VISITOR }, false)).toEqual({
        person: { visitorId: VISITOR },
        ignoredFilters: [],
      });
      expect(read({ sessionId: "s-1" }, false)).toEqual({
        person: { sessionId: "s-1" },
        ignoredFilters: [],
      });
    });

    test("can still look up an id, and is told the reference half was skipped", () => {
      const result: UserFlowPersonFilterResult = read(
        { identifier: VISITOR },
        false,
      );

      expect(result.person).toEqual({ visitorId: VISITOR, sessionId: VISITOR });
      expect(result.ignoredFilters).toEqual([USER_FLOW_IGNORED_USER_REFERENCE]);
    });
  });

  /*
   * Dropping an unusable filter would answer a question about one person with
   * everyone's journeys and a 200.
   */
  describe("refuses what it cannot use, never reading everyone instead", () => {
    const refusals: Array<[string, JSONObject]> = [
      ["an empty identifier", { identifier: "" }],
      ["a blank identifier", { identifier: "   " }],
      ["a non-string identifier", { identifier: 42 }],
      [
        "an identifier past the reference cap",
        { identifier: "x".repeat(SESSION_REPLAY_MAX_USER_REF_LENGTH + 1) },
      ],
      ["a malformed visitor id", { visitorId: "not-a-visitor" }],
      ["an upper-case visitor id", { visitorId: "B".repeat(32) }],
      ["an empty digest", { identifiedUserKey: "" }],
      ["a non-string digest", { identifiedUserKey: ["a"] as never }],
      ["an empty session id", { sessionId: "" }],
      ["a session id past its cap", { sessionId: "s".repeat(129) }],
      [
        "two people at once",
        { identifiedUserKey: "a".repeat(64), visitorId: VISITOR },
      ],
      ["a person and a session", { identifier: "x", sessionId: "s" }],
    ];

    test.each(refusals)("%s", (_name: string, filters: JSONObject) => {
      expect(() => {
        return read(filters);
      }).toThrow(BadDataException);
    });
  });
});

describe("readJourneys", () => {
  test("a narrowed read says whose each session is and whether it has ended", async () => {
    jest
      .spyOn(RumSessionService, "executeQuery")
      .mockImplementation(
        async (statement: string | Statement): Promise<never> => {
          const query: string =
            typeof statement === "string" ? statement : statement.query;

          if (query.includes("flowSessionCount")) {
            return fakeResultSet([{ flowSessionCount: "2" }]) as never;
          }

          return fakeResultSet([
            {
              flowSessionId: "s-live",
              flowStartUnixMs: 2000,
              flowEntryUrl: "https://a.example.com/",
              flowUserKey: "k",
              flowVisitorId: "v",
              flowUserLabel: "jane@example.com",
              flowIsFinalized: 0,
              flowSealedReason: "",
              flowChunkCount: "0",
            },
            {
              flowSessionId: "s-done",
              flowStartUnixMs: 1000,
              flowEntryUrl: "https://a.example.com/",
              flowUserKey: "k",
              flowVisitorId: "v",
              flowUserLabel: "jane@example.com",
              flowIsFinalized: 1,
              flowSealedReason: "recording-lost",
              flowChunkCount: "3",
            },
          ]) as never;
        },
      );
    jest
      .spyOn(RumSessionChunkService, "executeQuery")
      .mockImplementation(async (): Promise<never> => {
        return fakeResultSet([]) as never;
      });

    const ended: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SessionReplayReadService, "readRecordingEndedSessionIds")
      .mockResolvedValue(new Set<string>(["s-live"]) as never);

    const response: UserFlowJourneysResponseDto =
      await SessionReplayUserFlowReadService.readJourneys({
        ...REQUEST,
        person: { identifiedUserKey: "k" },
        includeIdentifiedUserLabel: true,
        nowUnixMs: 12345,
      });

    expect(response.sessions[0]?.detail).toEqual({
      identifiedUserKey: "k",
      visitorId: "v",
      identifiedUserLabel: "jane@example.com",
      isFinalized: false,
      hasRecordingEnded: true,
      sealedReason: "",
      chunkCount: 0,
    });
    expect(response.sessions[1]?.detail).toMatchObject({
      isFinalized: true,
      hasRecordingEnded: false,
      sealedReason: "recording-lost",
      chunkCount: 3,
    });

    /* Only the unfinalized session is asked about. */
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledWith({
      projectId: REQUEST.projectId,
      rumApplicationId: REQUEST.rumApplicationId,
      sessionIds: ["s-live"],
      nowUnixMs: 12345,
    });

    /* The detail survives the Dashboard's parser unchanged. */
    expect(
      readUserFlowJourneysResponse(JSON.parse(JSON.stringify(response))),
    ).toEqual(response);
  });

  test("everyone's read asks nothing about who or whether anything ended", async () => {
    jest
      .spyOn(RumSessionService, "executeQuery")
      .mockImplementation(async (): Promise<never> => {
        return fakeResultSet([
          {
            flowSessionId: "s-1",
            flowStartUnixMs: 1000,
            flowEntryUrl: "https://a.example.com/",
            flowSessionCount: "1",
          },
        ]) as never;
      });
    jest
      .spyOn(RumSessionChunkService, "executeQuery")
      .mockImplementation(async (): Promise<never> => {
        return fakeResultSet([]) as never;
      });

    const ended: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SessionReplayReadService,
      "readRecordingEndedSessionIds",
    );

    const response: UserFlowJourneysResponseDto =
      await SessionReplayUserFlowReadService.readJourneys(REQUEST);

    expect(response.sessions[0]?.detail).toBeUndefined();
    expect(ended).not.toHaveBeenCalled();
  });

  test("a cut journey keeps where it really ended in the dictionary", () => {
    const response: UserFlowJourneysResponseDto =
      SessionReplayUserFlowReadService.toResponse({
        headers: [
          {
            sessionId: "s",
            startUnixMs: 1,
            deviceType: "",
            browserName: "",
            countryCode: "",
            entryUrl: "https://a.example.com/",
          },
        ],
        chunks: new Map([
          [
            "s",
            {
              pages: ["https://a.example.com/1", "https://a.example.com/2"],
              signals: [],
              errorCount: 0,
              frustrationCount: 0,
              spanMs: 0,
              exitUrl: "https://a.example.com/last",
              isCut: true,
            },
          ],
        ]),
        sessionsInWindow: 1,
        maxSessions: 10,
        request: REQUEST,
      });

    expect(response.pages[response.sessions[0]?.exitPage as number]).toBe(
      "https://a.example.com/last",
    );
    expect(response.sessions[0]?.pages).toEqual([0, 1]);
  });

  test("a journey that was not cut has no separate exit, and its exit adds no page", () => {
    const response: UserFlowJourneysResponseDto =
      SessionReplayUserFlowReadService.toResponse({
        headers: [
          {
            sessionId: "s",
            startUnixMs: 1,
            deviceType: "",
            browserName: "",
            countryCode: "",
            entryUrl: "https://a.example.com/",
          },
        ],
        chunks: new Map([
          [
            "s",
            {
              pages: ["https://a.example.com/1"],
              signals: [],
              errorCount: 0,
              frustrationCount: 0,
              spanMs: 0,
              exitUrl: "https://a.example.com/1",
              isCut: false,
            },
          ],
        ]),
        sessionsInWindow: 1,
        maxSessions: 10,
        request: REQUEST,
      });

    expect(response.sessions[0]).not.toHaveProperty("exitPage");
    expect(response.pages).toHaveLength(1);
  });

  test("joins headers to chunk rollups and dictionary-encodes the pages", async () => {
    jest
      .spyOn(RumSessionService, "executeQuery")
      .mockImplementation(
        async (statement: string | Statement): Promise<never> => {
          const query: string =
            typeof statement === "string" ? statement : statement.query;

          if (query.includes("uniqExact")) {
            return fakeResultSet([{ flowSessionCount: "7" }]) as never;
          }

          return fakeResultSet([
            {
              flowSessionId: "s-new",
              flowStartUnixMs: 2000,
              flowDeviceType: "mobile",
              flowBrowserName: "Safari",
              flowCountryCode: "DK",
              flowEntryUrl: "https://a.example.com/",
            },
            {
              flowSessionId: "s-no-chunks",
              flowStartUnixMs: 1000,
              flowDeviceType: "desktop",
              flowBrowserName: "Chrome",
              flowCountryCode: "",
              flowEntryUrl: "https://a.example.com/landing",
            },
            {
              flowSessionId: "s-nothing",
              flowStartUnixMs: 500,
              flowDeviceType: "",
              flowBrowserName: "",
              flowCountryCode: "",
              flowEntryUrl: "",
            },
          ]) as never;
        },
      );

    jest
      .spyOn(RumSessionChunkService, "executeQuery")
      .mockImplementation(async (): Promise<never> => {
        return fakeResultSet([
          {
            flowSessionId: "s-new",
            flowPages: [
              "https://a.example.com/",
              "https://a.example.com/cart",
              "https://a.example.com/",
            ],
            flowSignals: [
              ["https://a.example.com/cart", 1, 0],
              ["https://a.example.com/cart", 2, 3],
              ["", 9, 9],
            ],
            flowErrorTotal: "3",
            flowFrustrationTotal: "3",
            flowSpanMs: "45000",
          },
        ]) as never;
      });

    const response: UserFlowJourneysResponseDto =
      await SessionReplayUserFlowReadService.readJourneys({
        ...REQUEST,
        maxSessions: 3,
      });

    expect(response.pages).toEqual([
      "https://a.example.com/",
      "https://a.example.com/cart",
      "https://a.example.com/landing",
    ]);
    expect(response.sessions).toEqual([
      {
        sessionId: "s-new",
        startUnixMs: 2000,
        durationMs: 45000,
        deviceType: "mobile",
        browserName: "Safari",
        countryCode: "DK",
        errorCount: 3,
        frustrationCount: 3,
        pages: [0, 1, 0],
        /* Two chunks flushed from /cart fold into one entry. */
        pageSignals: [[1, 3, 3]],
      },
      {
        sessionId: "s-no-chunks",
        startUnixMs: 1000,
        durationMs: 0,
        deviceType: "desktop",
        browserName: "Chrome",
        countryCode: "",
        errorCount: 0,
        frustrationCount: 0,
        pages: [2],
        pageSignals: [],
      },
    ]);
    expect(response.sessionsInWindow).toBe(7);
    expect(response.isSampled).toBe(true);
    expect(response.maxSessions).toBe(3);
    expect(response.startUnixMs).toBe(REQUEST.startTime.getTime());

    /* The wire shape survives the Dashboard's parser unchanged. */
    expect(
      readUserFlowJourneysResponse(JSON.parse(JSON.stringify(response))),
    ).toEqual(response);
  });
});

describe("readUserFlowJourneysResponse", () => {
  test("drops what it cannot trust instead of rendering it", () => {
    const parsed: UserFlowJourneysResponseDto = readUserFlowJourneysResponse({
      pages: ["/a", "/b"],
      sessions: [
        {
          sessionId: "x",
          startUnixMs: "12",
          pages: [0, 1, 7, -1, "1", 1.5],
          pageSignals: [[1, "2", "nope"], [9, 1, 1], "bad", [0]],
        },
        { pages: [0] },
        null,
      ],
      sessionsInWindow: "3",
      isSampled: 1,
    });

    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0]?.startUnixMs).toBe(12);
    expect(parsed.sessions[0]?.pages).toEqual([0, 1, 1]);
    expect(parsed.sessions[0]?.pageSignals).toEqual([[1, 2, 0]]);
    expect(parsed.sessionsInWindow).toBe(3);
    expect(parsed.isSampled).toBe(true);
  });

  test("anything that is not an object reads as empty", () => {
    for (const value of [null, undefined, "x", 42]) {
      const parsed: UserFlowJourneysResponseDto =
        readUserFlowJourneysResponse(value);

      expect(parsed.pages).toEqual([]);
      expect(parsed.sessions).toEqual([]);
      expect(parsed.isSampled).toBe(false);
      expect(parsed.ignoredFilters).toEqual([]);
    }
  });

  test("an exit page outside the dictionary is dropped, not guessed", () => {
    const parsed: UserFlowJourneysResponseDto = readUserFlowJourneysResponse({
      pages: ["/a"],
      sessions: [
        { sessionId: "ok", pages: [0], exitPage: 0 },
        { sessionId: "past", pages: [0], exitPage: 9 },
        { sessionId: "text", pages: [0], exitPage: "nope" },
        { sessionId: "none", pages: [0] },
      ],
    });

    expect(parsed.sessions[0]?.exitPage).toBe(0);
    expect(parsed.sessions[1]).not.toHaveProperty("exitPage");
    expect(parsed.sessions[2]).not.toHaveProperty("exitPage");
    expect(parsed.sessions[3]).not.toHaveProperty("exitPage");
  });

  test("an absent label stays absent: hidden is not the same as nobody", () => {
    const parsed: UserFlowJourneysResponseDto = readUserFlowJourneysResponse({
      pages: ["/a"],
      sessions: [
        {
          sessionId: "hidden",
          pages: [0],
          detail: { identifiedUserKey: "k", chunkCount: "2", isFinalized: 1 },
        },
        {
          sessionId: "visible",
          pages: [0],
          detail: { identifiedUserKey: "", identifiedUserLabel: "" },
        },
        { sessionId: "everyone", pages: [0] },
        { sessionId: "garbage", pages: [0], detail: "nope" },
      ],
    });

    expect(parsed.sessions[0]?.detail).not.toHaveProperty(
      "identifiedUserLabel",
    );
    expect(parsed.sessions[0]?.detail?.chunkCount).toBe(2);
    expect(parsed.sessions[0]?.detail?.isFinalized).toBe(true);
    expect(parsed.sessions[1]?.detail?.identifiedUserLabel).toBe("");
    expect(parsed.sessions[2]).not.toHaveProperty("detail");
    expect(parsed.sessions[3]).not.toHaveProperty("detail");
  });

  test("ignored filters are read as text, whatever else arrives", () => {
    expect(
      readUserFlowJourneysResponse({
        ignoredFilters: [USER_FLOW_IGNORED_USER_REFERENCE, 7, null],
      }).ignoredFilters,
    ).toEqual([USER_FLOW_IGNORED_USER_REFERENCE]);
    expect(
      readUserFlowJourneysResponse({ ignoredFilters: "nope" }).ignoredFilters,
    ).toEqual([]);
  });
});
