import RumSessionService from "../../../../Server/Services/RumSessionService";
import RumSessionChunkService from "../../../../Server/Services/RumSessionChunkService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import SessionReplayUserFlowReadService, {
  clampUserFlowMaxSessions,
  UserFlowJourneysRequest,
  UserFlowJourneysScope,
} from "../../../../Server/Utils/SessionReplay/SessionReplayUserFlowReadService";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  readUserFlowJourneysResponse,
  USER_FLOW_DEFAULT_MAX_SESSIONS,
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
    /* One page over the cap: how a cut journey is told from a long one. */
    expect(boundValues(statement)).toContain(
      USER_FLOW_MAX_PAGES_PER_JOURNEY + 1,
    );
    expect(query).toContain("AND retentionDate >= now()");
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

describe("narrowed statements", () => {
  const SCOPES: Array<UserFlowJourneysScope> = [
    { kind: "user", identifiedUserKey: "k".repeat(64) },
    { kind: "visitor", visitorId: "v".repeat(32) },
    { kind: "session", sessionId: "s".repeat(32) },
  ];

  function statementsFor(request: UserFlowJourneysRequest): Array<Statement> {
    return [
      SessionReplayUserFlowReadService.buildHeaderStatement(request, 10),
      SessionReplayUserFlowReadService.buildChunkStatement(request, 10),
      SessionReplayUserFlowReadService.buildCountStatement(request),
    ];
  }

  test("every statement takes the same narrowing, so they agree on the sessions", () => {
    for (const scope of SCOPES) {
      const value: string = Object.values(scope)[1] as string;

      for (const statement of statementsFor({ ...REQUEST, scope: scope })) {
        expect(boundValues(statement)).toContain(value);
      }
    }
  });

  test("a person is judged on the newest header, never in the WHERE", () => {
    for (const statement of statementsFor({
      ...REQUEST,
      scope: { kind: "user", identifiedUserKey: "k".repeat(64) },
    })) {
      const query: string = squash(statement.query);

      expect(query).toContain("HAVING argMax(identifiedUserKey, version) = ");
      expect(query).not.toMatch(/WHERE[^)]*\bidentifiedUserKey\s*=/);
    }

    for (const statement of statementsFor({
      ...REQUEST,
      scope: { kind: "visitor", visitorId: "v".repeat(32) },
    })) {
      const query: string = squash(statement.query);

      expect(query).toContain("HAVING argMax(visitorId, version) = ");
      expect(query).not.toMatch(/WHERE[^)]*\bvisitorId\s*=/);
    }
  });

  test("a session id goes in the WHERE, which the sort key can prune on", () => {
    for (const statement of statementsFor({
      ...REQUEST,
      scope: { kind: "session", sessionId: "s".repeat(32) },
    })) {
      const query: string = squash(statement.query);

      expect(query).toContain("AND sessionId = ");
      expect(query).not.toContain("HAVING");
    }
  });

  test("the count counts sessions, because a narrowing is judged per session", () => {
    const query: string = squash(
      SessionReplayUserFlowReadService.buildCountStatement({
        ...REQUEST,
        scope: { kind: "user", identifiedUserKey: "k".repeat(64) },
      }).query,
    );

    expect(query).toContain("toFloat64(count()) AS flowSessionCount");
    expect(query).toContain("GROUP BY sessionId HAVING");
    expect(query).not.toContain("uniqExact");
  });

  test("the label is named only when the caller may read it, and only then", () => {
    const scope: UserFlowJourneysScope = {
      kind: "session",
      sessionId: "s".repeat(32),
    };

    const denied: string =
      SessionReplayUserFlowReadService.buildHeaderStatement(
        { ...REQUEST, scope: scope, includeIdentifiedUserLabel: false },
        10,
      ).query;
    const allowed: string =
      SessionReplayUserFlowReadService.buildHeaderStatement(
        { ...REQUEST, scope: scope, includeIdentifiedUserLabel: true },
        10,
      ).query;

    expect(denied).not.toContain("identifiedUserLabel");
    expect(allowed).toContain("flowIdentifiedUserLabel");
  });

  test("a read over everyone names no identity column, whatever it was told", () => {
    for (const statement of statementsFor({
      ...REQUEST,
      includeIdentifiedUserLabel: true,
    })) {
      expect(statement.query).not.toMatch(/identifiedUser|visitorId/);
      expect(statement.query).not.toContain("HAVING");
    }
  });

  test("no narrowed statement names the payload", () => {
    for (const scope of SCOPES) {
      for (const statement of statementsFor({
        ...REQUEST,
        scope: scope,
        includeIdentifiedUserLabel: true,
      })) {
        expect(squash(statement.query)).not.toMatch(/\bpayload\b/);
      }
    }
  });
});

describe("toResponse", () => {
  const HEADER: {
    sessionId: string;
    startUnixMs: number;
    deviceType: string;
    browserName: string;
    countryCode: string;
    entryUrl: string;
  } = {
    sessionId: "s-1",
    startUnixMs: 1000,
    deviceType: "desktop",
    browserName: "Chrome",
    countryCode: "DK",
    entryUrl: "https://a.example.com/",
  };

  function pagesFrom(count: number): Array<string> {
    return Array.from({ length: count }, (_value: unknown, index: number) => {
      return `https://a.example.com/step-${index}`;
    });
  }

  function responseFor(data: {
    pages: Array<string>;
    request?: Partial<UserFlowJourneysRequest>;
  }): UserFlowJourneysResponseDto {
    return SessionReplayUserFlowReadService.toResponse({
      headers: [HEADER],
      chunks: new Map([
        [
          "s-1",
          {
            pages: data.pages,
            signals: [],
            errorCount: 0,
            frustrationCount: 0,
            spanMs: 1000,
          },
        ],
      ]),
      sessionsInWindow: 1,
      maxSessions: 5000,
      request: { ...REQUEST, ...(data.request ?? {}) },
    });
  }

  test("a journey at the cap is whole", () => {
    const response: UserFlowJourneysResponseDto = responseFor({
      pages: pagesFrom(USER_FLOW_MAX_PAGES_PER_JOURNEY),
    });

    expect(response.sessions[0]?.pages).toHaveLength(
      USER_FLOW_MAX_PAGES_PER_JOURNEY,
    );
    expect(response.sessions[0]).not.toHaveProperty("isTruncated");
  });

  test("the page over the cap says the journey went on, and is not sent", () => {
    const pages: Array<string> = pagesFrom(USER_FLOW_MAX_PAGES_PER_JOURNEY + 1);
    const response: UserFlowJourneysResponseDto = responseFor({ pages: pages });

    expect(response.sessions[0]?.pages).toHaveLength(
      USER_FLOW_MAX_PAGES_PER_JOURNEY,
    );
    expect(response.sessions[0]?.isTruncated).toBe(true);
    expect(response.pages).not.toContain(pages[pages.length - 1]);
    /* The Dashboard's parser keeps it. */
    expect(
      readUserFlowJourneysResponse(JSON.parse(JSON.stringify(response)))
        .sessions[0]?.isTruncated,
    ).toBe(true);
  });

  test("a read over everyone carries no scope and no recording flag", () => {
    const response: UserFlowJourneysResponseDto = responseFor({
      pages: pagesFrom(2),
    });

    expect(response.scope).toBeNull();
    expect(response.sessions[0]).not.toHaveProperty("hasRecording");
  });

  test("an answer with no sessions still says what was asked", () => {
    const response: UserFlowJourneysResponseDto =
      SessionReplayUserFlowReadService.toResponse({
        headers: [],
        chunks: new Map(),
        sessionsInWindow: 0,
        maxSessions: 5000,
        request: {
          ...REQUEST,
          scope: { kind: "session", sessionId: "s-gone" },
          includeIdentifiedUserLabel: true,
        },
      });

    expect(response.scope).toEqual({
      kind: "session",
      identifiedUserKey: "",
      visitorId: "",
      sessionId: "s-gone",
      identifiedUserLabel: "",
    });
  });

  test("the newest session that names the person names them", () => {
    const response: UserFlowJourneysResponseDto =
      SessionReplayUserFlowReadService.toResponse({
        headers: [
          { ...HEADER, sessionId: "s-new", identifiedUserLabel: "" },
          {
            ...HEADER,
            sessionId: "s-older",
            identifiedUserLabel: "jane@example.com",
          },
          {
            ...HEADER,
            sessionId: "s-oldest",
            identifiedUserLabel: "j.doe@example.com",
          },
        ],
        chunks: new Map(),
        sessionsInWindow: 3,
        maxSessions: 5000,
        request: {
          ...REQUEST,
          scope: { kind: "user", identifiedUserKey: "k".repeat(64) },
          includeIdentifiedUserLabel: true,
        },
      });

    expect(response.scope?.identifiedUserLabel).toBe("jane@example.com");
  });

  test("a visitor is a browser: the answer names no person", () => {
    const response: UserFlowJourneysResponseDto =
      SessionReplayUserFlowReadService.toResponse({
        headers: [{ ...HEADER, identifiedUserLabel: "jane@example.com" }],
        chunks: new Map(),
        sessionsInWindow: 1,
        maxSessions: 5000,
        request: {
          ...REQUEST,
          scope: { kind: "visitor", visitorId: "v".repeat(32) },
          includeIdentifiedUserLabel: true,
        },
      });

    expect(response.scope).toEqual({
      kind: "visitor",
      identifiedUserKey: "",
      visitorId: "v".repeat(32),
      sessionId: "",
    });
  });

  test("the scope survives the Dashboard's parser unchanged", () => {
    const response: UserFlowJourneysResponseDto = responseFor({
      pages: pagesFrom(2),
      request: {
        scope: { kind: "user", identifiedUserKey: "k".repeat(64) },
        includeIdentifiedUserLabel: false,
      },
    });

    expect(
      readUserFlowJourneysResponse(JSON.parse(JSON.stringify(response))),
    ).toEqual(response);
    expect(response.scope).not.toHaveProperty("identifiedUserLabel");
  });
});

describe("readJourneys", () => {
  test("a narrowed read reads who the session is and whether it can be watched", async () => {
    jest
      .spyOn(RumSessionService, "executeQuery")
      .mockImplementation(
        async (statement: string | Statement): Promise<never> => {
          const query: string =
            typeof statement === "string" ? statement : statement.query;

          if (query.includes("flowSessionCount")) {
            return fakeResultSet([{ flowSessionCount: "4" }]) as never;
          }

          return fakeResultSet(
            [
              ["s-finalized", true, 3, ""],
              ["s-counting", false, 0, ""],
              ["s-nothing-stored", true, 0, ""],
              ["s-lost", true, 3, "recording-lost"],
            ].map((row: Array<unknown>): JSONObject => {
              return {
                flowSessionId: row[0] as string,
                flowStartUnixMs: 1000,
                flowDeviceType: "desktop",
                flowBrowserName: "Chrome",
                flowCountryCode: "",
                flowEntryUrl: "https://a.example.com/",
                flowIdentifiedUserKey: "k".repeat(64),
                flowVisitorId: "v".repeat(32),
                flowIsFinalized: row[1] as boolean,
                flowChunkCount: row[2] as number,
                flowSealedReason: row[3] as string,
              };
            }),
          ) as never;
        },
      );

    jest
      .spyOn(RumSessionChunkService, "executeQuery")
      .mockImplementation(async (): Promise<never> => {
        return fakeResultSet([]) as never;
      });

    const response: UserFlowJourneysResponseDto =
      await SessionReplayUserFlowReadService.readJourneys({
        ...REQUEST,
        scope: { kind: "visitor", visitorId: "v".repeat(32) },
      });

    expect(
      response.sessions.map(
        (
          session: UserFlowJourneysResponseDto["sessions"][number],
        ): [string, boolean | undefined] => {
          return [session.sessionId, session.hasRecording];
        },
      ),
    ).toEqual([
      ["s-finalized", true],
      /* Unfinalized: its zero means "not counted yet". */
      ["s-counting", true],
      ["s-nothing-stored", false],
      ["s-lost", false],
    ]);
    expect(response.sessionsInWindow).toBe(4);
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
  test("a scope of an unknown kind is no scope", () => {
    for (const scope of [null, "user", 42, {}, { kind: "everyone" }]) {
      expect(
        readUserFlowJourneysResponse({ pages: [], sessions: [], scope: scope })
          .scope,
      ).toBeNull();
    }
  });

  test("a label that is not there stays not there", () => {
    const scope: unknown = readUserFlowJourneysResponse({
      scope: { kind: "user", identifiedUserKey: "k" },
    }).scope;

    expect(scope).not.toHaveProperty("identifiedUserLabel");
    expect(
      readUserFlowJourneysResponse({
        scope: { kind: "user", identifiedUserLabel: "" },
      }).scope?.identifiedUserLabel,
    ).toBe("");
  });

  test("a recording flag is kept only when it says something", () => {
    const parsed: UserFlowJourneysResponseDto = readUserFlowJourneysResponse({
      pages: ["/a"],
      sessions: [
        { sessionId: "a", pages: [0], hasRecording: false },
        { sessionId: "b", pages: [0], hasRecording: true },
        { sessionId: "c", pages: [0] },
        { sessionId: "d", pages: [0], hasRecording: "yes" },
      ],
    });

    expect(
      parsed.sessions.map(
        (
          session: UserFlowJourneysResponseDto["sessions"][number],
        ): boolean | undefined => {
          return session.hasRecording;
        },
      ),
    ).toEqual([false, true, undefined, undefined]);
  });

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
    }
  });
});
