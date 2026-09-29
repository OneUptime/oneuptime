import RumSessionService from "../../../../Server/Services/RumSessionService";
import RumSessionChunkService from "../../../../Server/Services/RumSessionChunkService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import SessionReplayUserFlowReadService, {
  clampUserFlowMaxSessions,
  UserFlowJourneysRequest,
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
      "groupArray((chunkStartTime, tabId, chunkIndex, routes))",
    );
    /* Back-to-back repeats are collapsed in the statement. */
    expect(query).toContain(
      "(flowRoute, flowAt) -> flowAt = 1 OR flowRoute != flowRawRoutes[flowAt - 1]",
    );
    expect(boundValues(statement)).toContain(USER_FLOW_MAX_PAGES_PER_JOURNEY);
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

describe("readJourneys", () => {
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
    }
  });
});
