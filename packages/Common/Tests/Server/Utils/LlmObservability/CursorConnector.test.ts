import { describe, expect, test } from "@jest/globals";
import CursorAdminClient, {
  CURSOR_EVENTS_REQUEST_SPACING_MS,
  CURSOR_OTHER_REQUEST_SPACING_MS,
  CURSOR_RATE_LIMIT_WAIT_MS,
  CursorAdminClientOptions,
} from "../../../../Server/Utils/LlmObservability/Connectors/Cursor/CursorAdminClient";
import CursorConnector, {
  CursorReadPlan,
} from "../../../../Server/Utils/LlmObservability/Connectors/Cursor/CursorConnector";
import LlmConnectorRegistry from "../../../../Server/Utils/LlmObservability/LlmConnectorRegistry";
import {
  LlmConnectionSettings,
  LlmUsageFetchResult,
  LlmUsageWindow,
} from "../../../../Server/Utils/LlmObservability/LlmConnectorTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import {
  LlmConnectionDefinition,
  LlmConnectionKind,
  getLlmConnectionDefinition,
} from "../../../../Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "../../../../Types/LlmObservability/LlmConnectionProvider";
import {
  LlmConnectionPullState,
  LlmUsageRecord,
} from "../../../../Types/LlmObservability/LlmConnectionRecords";
import {
  LlmConnectionFailureKind,
  LlmConnectionTestResult,
} from "../../../../Types/LlmObservability/LlmConnectionTest";
import {
  CURSOR_FORBIDDEN,
  CURSOR_RATE_LIMITED,
  CURSOR_UNAUTHORIZED,
  CURSOR_UNAVAILABLE,
  FakeCursorApi,
  FakeCursorCall,
  FakeCursorClock,
  FakeCursorIntercept,
  FakeCursorMember,
  FakeCursorTeam,
  FakeCursorUsage,
  createFakeCursorApi,
  cursorEvent,
  cursorMember,
  steadyUsage,
  usageOf,
} from "./FakeCursorApi";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  everythingSent,
  json,
} from "./FakeProviderApi";

/*
 * A Cursor team read with an Admin API key, against a fake of Cursor's
 * Admin API that answers in its documented shapes and enforces its limits
 * on the test's clock: where the key goes, the hour ranges a read plans and
 * resumes, every page of every piece, pieces that shrink for a busy
 * stretch, the request and time bounds that end a read part way and the
 * read that picks it up a minute later, waits for a 429 and a server error,
 * every refusal in words that say what to do, the team's people, a test's
 * answer - and that the key never leaves in an error.
 */

const API_KEY: string = `crsr_${"a1b2c3d4".repeat(8)}`;
const BASIC: string = Buffer.from(`${API_KEY}:`).toString("base64");

const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

const NOW: Date = new Date("2026-10-19T15:30:00Z");
const TODAY: number = Date.UTC(2026, 9, 19);
// The hour in progress starts here: a read ends at it.
const END: number = Date.UTC(2026, 9, 19, 15);
// 30 days of backfill, today included.
const EARLIEST: number = Date.UTC(2026, 8, 20);

const SETTINGS: LlmConnectionSettings = {
  provider: LlmConnectionProvider.Cursor,
  config: {},
  secrets: { apiKey: API_KEY },
};

const ANA: string = "ana@sysnetix.com";
const BOB: string = "bob@sysnetix.com";
const CY: string = "cy@sysnetix.com";
const DEE: string = "dee@sysnetix.com";

const MEMBERS: Array<FakeCursorMember> = [
  cursorMember(ANA, { role: "owner" }),
  cursorMember(BOB),
  cursorMember(CY),
  // Removed from the team: not a member, though their usage stays.
  cursorMember(DEE, { isRemoved: true }),
];

function iso(time: number): string {
  return new Date(time).toISOString();
}

function window(startMs: number, endMs: number): LlmUsageWindow {
  return { startDay: new Date(startMs), endDay: new Date(endMs) };
}

interface World {
  api: FakeCursorApi;
  clock: FakeCursorClock;
}

function world(
  data: {
    usage?: FakeCursorUsage | undefined;
    members?: Array<FakeCursorMember> | undefined;
    activeOn?: ((dayMs: number) => Array<string>) | undefined;
    intercept?: FakeCursorIntercept | undefined;
    latencyMs?: number | undefined;
    apiKey?: string | undefined;
  } = {},
): World {
  const clock: FakeCursorClock = new FakeCursorClock(NOW);
  const team: FakeCursorTeam = {
    apiKey: data.apiKey || API_KEY,
    members: data.members || MEMBERS,
    usage: data.usage || usageOf([]),
    activeOn: data.activeOn,
  };

  return {
    clock,
    api: createFakeCursorApi({
      team,
      clock,
      intercept: data.intercept,
      latencyMs: data.latencyMs,
    }),
  };
}

// One scheduled read, as the runner makes it.
async function read(
  at: World,
  state: LlmConnectionPullState = {},
  now: Date = NOW,
  settings: LlmConnectionSettings = SETTINGS,
): Promise<LlmUsageFetchResult> {
  const connector: CursorConnector = new CursorConnector();
  const planned: LlmUsageWindow = connector.planUsageWindow({
    now,
    state,
    backfillDays: 30,
  });

  return await connector.fetchUsage(settings, planned, {
    transport: at.api.transport,
    now: () => {
      return now;
    },
    state,
    sleep: at.clock.sleep,
    clock: at.clock.clock,
  });
}

async function test7Days(
  at: World,
  settings: LlmConnectionSettings = SETTINGS,
): Promise<LlmConnectionTestResult> {
  return await new CursorConnector().testConnection(settings, {
    transport: at.api.transport,
    now: () => {
      return NOW;
    },
    sleep: at.clock.sleep,
    clock: at.clock.clock,
  });
}

function client(
  at: World,
  overrides: Partial<CursorAdminClientOptions> = {},
): CursorAdminClient {
  return new CursorAdminClient({
    apiKey: API_KEY,
    transport: at.api.transport,
    sleep: at.clock.sleep,
    clock: at.clock.clock,
    ...overrides,
  });
}

async function failureOf(promise: Promise<unknown>): Promise<LlmProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LlmProviderError);
    return error as LlmProviderError;
  }

  throw new Error("Expected the call to fail.");
}

function sortRecords(records: Array<LlmUsageRecord>): Array<LlmUsageRecord> {
  return [...records].sort((a: LlmUsageRecord, b: LlmUsageRecord): number => {
    return (
      a.day.getTime() - b.day.getTime() ||
      a.person.localeCompare(b.person) ||
      a.model.localeCompare(b.model) ||
      a.apiKey.localeCompare(b.apiKey)
    );
  });
}

function sumOf(
  records: Array<LlmUsageRecord>,
  pick: (record: LlmUsageRecord) => number,
): number {
  return records.reduce((sum: number, record: LlmUsageRecord): number => {
    return sum + pick(record);
  }, 0);
}

// Answers the calls a test picks its own way, and the rest as the team.
function answerCalls(
  pick: (call: FakeCursorCall) => FakeResponse | undefined,
): FakeCursorIntercept {
  return (call: FakeCursorCall): FakeResponse | undefined => {
    return pick(call);
  };
}

// Answers the n-th usage events request (1-based) the test's way.
function onEventCall(
  pick: (n: number) => FakeResponse | undefined,
): FakeCursorIntercept {
  let n: number = 0;

  return (call: FakeCursorCall): FakeResponse | undefined => {
    if (call.path !== "/teams/filtered-usage-events") {
      return undefined;
    }

    n++;
    return pick(n);
  };
}

describe("CursorAdminClient", () => {
  test("the key is the Basic user name with no password, sent to api.cursor.com", async () => {
    const at: World = world();

    const members: Array<{ email: string; isRemoved: boolean }> = await client(
      at,
      { apiKey: `  ${API_KEY}\n` },
    ).listMembers();

    expect(members).toHaveLength(4);
    expect(members[0]).toEqual({
      id: "user_ana0000000000",
      email: ANA,
      name: "ana",
      role: "owner",
      isRemoved: false,
    });
    expect(members[3]!.isRemoved).toBe(true);

    const request: DataSourceHttpRequest = at.api.requests[0]!;
    expect(request.url).toBe("https://api.cursor.com/teams/members");
    expect(request.method).toBe("GET");
    expect(request.headers).toEqual({
      Authorization: `Basic ${BASIC}`,
      Accept: "application/json",
    });
    expect(request.body).toBeUndefined();
  });

  test("a key is asked for and pasted alone; Cursor itself says whether it is an admin key", () => {
    expect(() => {
      return CursorAdminClient.validateApiKey("");
    }).toThrow(BadDataException);
    expect(() => {
      return CursorAdminClient.validateApiKey("   ");
    }).toThrow("Admin API key is required.");
    expect(() => {
      return CursorAdminClient.validateApiKey("crsr_abc def");
    }).toThrow(
      "The Admin API key has a space or a line break in it. Paste the key alone.",
    );
    expect(() => {
      return CursorAdminClient.validateApiKey(`${API_KEY}\n`);
    }).not.toThrow();
    // Not refused here: Cursor's 401 says what is wrong with it.
    expect(() => {
      return CursorAdminClient.validateApiKey("key_without_the_prefix");
    }).not.toThrow();
  });

  test("a page of usage events: both bounds as sent, 1000 a page, and Cursor's count of pages", async () => {
    const hour: number = Date.UTC(2026, 9, 19, 10);
    const at: World = world({
      usage: steadyUsage({
        perHour: (hourMs: number): number => {
          return hourMs === hour ? 2500 : 0;
        },
        people: [ANA, BOB],
      }),
    });
    const cursor: CursorAdminClient = client(at);

    const first: { events: Array<JSONObject>; total: number; pages: number } =
      await cursor.getUsageEventsPage({
        startMs: hour,
        endMs: hour + HOUR - 1,
        page: 1,
      });
    const last: { events: Array<JSONObject>; total: number; pages: number } =
      await cursor.getUsageEventsPage({
        startMs: hour,
        endMs: hour + HOUR - 1,
        page: 3,
      });

    expect(first.total).toBe(2500);
    expect(first.pages).toBe(3);
    expect(first.events).toHaveLength(1000);
    expect(last.events).toHaveLength(500);
    expect(at.api.eventRequests()).toEqual([
      { startDate: hour, endDate: hour + HOUR - 1, page: 1, pageSize: 1000 },
      { startDate: hour, endDate: hour + HOUR - 1, page: 3, pageSize: 1000 },
    ]);
    expect(at.api.requests[0]!.method).toBe("POST");
    expect(at.api.requests[0]!.url).toBe(
      "https://api.cursor.com/teams/filtered-usage-events",
    );
  });

  test("the pages are counted from the total, or from hasNextPage, when Cursor leaves numPages out", async () => {
    const answers: Array<FakeResponse> = [
      json({ totalUsageEventsCount: 2001, pagination: {}, usageEvents: [] }),
      json({
        totalUsageEventsCount: 0,
        pagination: { hasNextPage: true },
        usageEvents: [],
      }),
      json({}),
    ];
    const api: FakeProviderApi = createFakeProviderApi([
      {
        path: "/teams/filtered-usage-events",
        respond: (): FakeResponse => {
          return answers.shift()!;
        },
      },
    ]);
    const clock: FakeCursorClock = new FakeCursorClock(NOW);
    const cursor: CursorAdminClient = new CursorAdminClient({
      apiKey: API_KEY,
      transport: api.transport,
      sleep: clock.sleep,
      clock: clock.clock,
    });

    expect(
      (await cursor.getUsageEventsPage({ startMs: 0, endMs: 1, page: 1 }))
        .pages,
    ).toBe(3);
    expect(
      (await cursor.getUsageEventsPage({ startMs: 0, endMs: 1, page: 2 }))
        .pages,
    ).toBe(3);
    expect(
      await cursor.getUsageEventsPage({ startMs: 0, endMs: 1, page: 1 }),
    ).toEqual({ events: [], total: 0, pages: 1 });
  });

  test("each endpoint is paced under Cursor's limit, apart from the others", async () => {
    const at: World = world();
    const cursor: CursorAdminClient = client(at);

    for (let index: number = 0; index < 3; index++) {
      await cursor.getUsageEventsPage({ startMs: END - HOUR, endMs: END, page: 1 });
    }
    await cursor.listMembers();
    await cursor.listMembers();

    expect(at.clock.sleeps).toEqual([
      CURSOR_EVENTS_REQUEST_SPACING_MS,
      CURSOR_EVENTS_REQUEST_SPACING_MS,
      CURSOR_OTHER_REQUEST_SPACING_MS,
    ]);
    // 50 usage-event requests a minute of Cursor's 60; 17 of its 20.
    expect(CURSOR_EVENTS_REQUEST_SPACING_MS).toBe(1200);
    expect(CURSOR_OTHER_REQUEST_SPACING_MS).toBe(3500);
    expect(at.api.rateLimitedByCursor()).toBe(0);
  });

  test("a slow answer counts toward the pace: only the rest is waited", async () => {
    const at: World = world({ latencyMs: 500 });
    const cursor: CursorAdminClient = client(at);

    await cursor.getUsageEventsPage({ startMs: END - HOUR, endMs: END, page: 1 });
    await cursor.getUsageEventsPage({ startMs: END - HOUR, endMs: END, page: 1 });

    expect(at.clock.sleeps).toEqual([700]);
  });

  test("a 429 is waited out once when the read has the time, as Cursor's Retry-After asks", async () => {
    let refused: number = 0;
    const at: World = world({
      intercept: answerCalls((call: FakeCursorCall) => {
        if (call.path === "/teams/members" && refused === 0) {
          refused++;
          return CURSOR_RATE_LIMITED;
        }
        return undefined;
      }),
    });
    const cursor: CursorAdminClient = client(at, {
      waitUntilMs: NOW.getTime() + 4 * 60 * 1000,
    });

    await expect(cursor.listMembers()).resolves.toHaveLength(4);
    expect(at.clock.sleeps).toEqual([CURSOR_RATE_LIMIT_WAIT_MS]);
    expect(CURSOR_RATE_LIMIT_WAIT_MS).toBe(60 * 1000);
    expect(cursor.wasRateLimited()).toBe(true);
    expect(cursor.getRequestCount()).toBe(2);
  });

  test("a second 429, or one with no time left to wait, is the answer, with Cursor's limits in it", async () => {
    const at: World = world({
      intercept: answerCalls((call: FakeCursorCall) => {
        return call.path === "/teams/filtered-usage-events"
          ? CURSOR_RATE_LIMITED
          : undefined;
      }),
    });

    const waited: LlmProviderError = await failureOf(
      client(at, {
        waitUntilMs: NOW.getTime() + 4 * 60 * 1000,
      }).getUsageEventsPage({ startMs: END - HOUR, endMs: END, page: 1 }),
    );

    expect(waited.kind).toBe(LlmConnectionFailureKind.RateLimited);
    expect(waited.statusCode).toBe(429);
    expect(waited.message).toBe(
      "Cursor asked OneUptime to slow down (HTTP 429) on the usage events request. Its Admin API takes 20 requests a minute from a team, 60 for usage events, shared with every other tool that reads it.",
    );
    expect(at.clock.sleeps).toEqual([CURSOR_RATE_LIMIT_WAIT_MS]);

    // A test has no read to wait in: the 429 is its answer at once.
    const quick: World = world({
      intercept: answerCalls(() => {
        return CURSOR_RATE_LIMITED;
      }),
    });
    const refused: LlmProviderError = await failureOf(client(quick).listMembers());
    expect(refused.kind).toBe(LlmConnectionFailureKind.RateLimited);
    expect(quick.clock.sleeps).toEqual([]);

    // A wait that would end past the read's deadline is not waited.
    const late: World = world({
      intercept: answerCalls(() => {
        return CURSOR_RATE_LIMITED;
      }),
    });
    await failureOf(
      client(late, { waitUntilMs: NOW.getTime() + 30 * 1000 }).listMembers(),
    );
    expect(late.clock.sleeps).toEqual([]);
  });

  test("a server error is asked again once, a moment later; a second is Cursor's answer as it is", async () => {
    let failed: number = 0;
    const once: World = world({
      intercept: answerCalls(() => {
        if (failed === 0) {
          failed++;
          return CURSOR_UNAVAILABLE;
        }
        return undefined;
      }),
    });

    await expect(
      client(once, { waitUntilMs: NOW.getTime() + 60 * 1000 }).listMembers(),
    ).resolves.toHaveLength(4);
    // The moment, then the rest of the endpoint's pace.
    expect(once.clock.sleeps).toEqual([2000, 1500]);

    const down: World = world({
      intercept: answerCalls(() => {
        return CURSOR_UNAVAILABLE;
      }),
    });
    const failure: LlmProviderError = await failureOf(
      client(down, { waitUntilMs: NOW.getTime() + 60 * 1000 }).listMembers(),
    );

    expect(failure.kind).toBe(LlmConnectionFailureKind.Unavailable);
    expect(failure.message).toBe(
      'Cursor team members request failed with HTTP 503: {"error":"Service Unavailable","message":"Please try again later."}',
    );
    expect(down.api.requests).toHaveLength(2);
  });

  test("a refused key, and a key or plan that may not read the team, say what to do with Cursor's reason", async () => {
    const wrongKey: LlmProviderError = await failureOf(
      client(world({ apiKey: `crsr_${"z".repeat(64)}` })).listMembers(),
    );

    expect(wrongKey.kind).toBe(LlmConnectionFailureKind.Authentication);
    expect(wrongKey.statusCode).toBe(401);
    expect(wrongKey.message).toBe(
      "Cursor did not accept the key for the team members request (HTTP 401: Invalid API key). Use a Cursor Admin API key, which starts with crsr_: a team admin creates it in the Cursor dashboard under Settings, Cursor Admin API Keys.",
    );

    const plan: LlmProviderError = await failureOf(
      client(
        world({
          intercept: answerCalls(() => {
            return CURSOR_FORBIDDEN;
          }),
        }),
      ).getUsageEventsPage({ startMs: END - HOUR, endMs: END, page: 1 }),
    );

    expect(plan.kind).toBe(LlmConnectionFailureKind.Permission);
    expect(plan.message).toBe(
      "Cursor accepted the key but refused the usage events request (HTTP 403: Enterprise access required). Reading a team's usage takes an Admin API key of a team on the Teams or Enterprise plan, which a team admin creates under Settings, Cursor Admin API Keys.",
    );
  });

  test("the key never leaves in an error, nor its Basic form, even when Cursor repeats them", async () => {
    const at: World = world({
      intercept: answerCalls(() => {
        return json(
          {
            error: "Unauthorized",
            message: `Invalid API key ${API_KEY} (Basic ${BASIC})`,
          },
          401,
        );
      }),
    });

    const failure: LlmProviderError = await failureOf(client(at).listMembers());

    expect(failure.message).not.toContain(API_KEY);
    expect(failure.message).not.toContain(BASIC);
    expect(failure.message).toContain(
      "(HTTP 401: Invalid API key [REDACTED] (Basic [REDACTED]))",
    );
    expect(failure.responseBody || "").not.toContain(API_KEY);
    // What the guidance names stays readable.
    expect(failure.message).toContain("which starts with crsr_:");

    // A key-shaped value of another connection is removed too.
    expect(
      LlmProviderError.redact(`Cursor said crsr_${"Q".repeat(64)} is not a key; keys start with crsr_.`),
    ).toBe("Cursor said [REDACTED] is not a key; keys start with crsr_.");
  });

  test("Cursor's reason is the message of its error body; anything else has none", () => {
    expect(CursorAdminClient.readReason(undefined)).toBe("");
    expect(CursorAdminClient.readReason("<html>bad gateway</html>")).toBe("");
    expect(CursorAdminClient.readReason('{"error":"Forbidden"}')).toBe(
      "Forbidden",
    );
    expect(
      CursorAdminClient.readReason('{"error":"Forbidden","message":"No"}'),
    ).toBe("No");

    const bare: LlmProviderError = CursorAdminClient.explain(
      new LlmProviderError({
        message: "Cursor usage events request failed with HTTP 401: ",
        kind: LlmConnectionFailureKind.Authentication,
        statusCode: 401,
        responseBody: "",
      }),
      "usage events request",
    );
    expect(bare.message).toContain("(HTTP 401). Use a Cursor Admin API key");

    const missing: LlmProviderError = new LlmProviderError({
      message: "Cursor team members request failed with HTTP 404: {}",
      kind: LlmConnectionFailureKind.Settings,
      statusCode: 404,
    });
    expect(CursorAdminClient.explain(missing, "team members request")).toBe(
      missing,
    );
  });

  test("a member's day is active when Cursor says so, or shows any use when it does not say", () => {
    expect(
      CursorAdminClient.isActiveDay({ isActive: false, agentRequests: 5 }),
    ).toBe(false);
    expect(CursorAdminClient.isActiveDay({ isActive: true })).toBe(true);
    expect(CursorAdminClient.isActiveDay({ agentRequests: 1 })).toBe(true);
    expect(CursorAdminClient.isActiveDay({ totalTabsAccepted: "3" })).toBe(
      true,
    );
    expect(
      CursorAdminClient.isActiveDay({ chatRequests: 0, cmdkUsages: 0 }),
    ).toBe(false);
    expect(CursorAdminClient.isActiveDay({})).toBe(false);
  });

  test("the active members are read page by page, every member of a big team, emails lowercased", async () => {
    const members: Array<FakeCursorMember> = [];

    for (let index: number = 0; index < 300; index++) {
      members.push(cursorMember(`Person${index}@Sysnetix.com`));
    }

    const at: World = world({
      members,
      activeOn: (dayMs: number): Array<string> => {
        // Person 7 on one day, person 299 - on the second page - on another.
        if (dayMs === TODAY - 3 * DAY) {
          return ["Person7@Sysnetix.com"];
        }
        if (dayMs === TODAY - 6 * DAY) {
          return ["Person299@Sysnetix.com"];
        }
        return [];
      },
    });

    const active: { emails: Set<string>; complete: boolean } = await client(
      at,
    ).listActiveEmails({ startMs: TODAY - 7 * DAY, endMs: TODAY - 1 });

    expect(active.complete).toBe(true);
    expect(Array.from(active.emails).sort()).toEqual([
      "person299@sysnetix.com",
      "person7@sysnetix.com",
    ]);
    expect(
      at.api.calls.map((call: FakeCursorCall) => {
        return call.body;
      }),
    ).toEqual([
      {
        startDate: TODAY - 7 * DAY,
        endDate: TODAY - 1,
        page: 1,
        pageSize: 250,
      },
      {
        startDate: TODAY - 7 * DAY,
        endDate: TODAY - 1,
        page: 2,
        pageSize: 250,
      },
    ]);
  });

  test("a team with more members than a read's pages hold is counted in part, and says so", async () => {
    const api: FakeProviderApi = createFakeProviderApi([
      {
        path: "/teams/daily-usage-data",
        respond: (): FakeResponse => {
          return json({
            data: [{ email: "Someone@Sysnetix.com", isActive: true }],
            pagination: { hasNextPage: true },
          });
        },
      },
    ]);
    const clock: FakeCursorClock = new FakeCursorClock(NOW);

    const active: { emails: Set<string>; complete: boolean } =
      await new CursorAdminClient({
        apiKey: API_KEY,
        transport: api.transport,
        sleep: clock.sleep,
        clock: clock.clock,
      }).listActiveEmails({ startMs: 0, endMs: 1 });

    expect(active.complete).toBe(false);
    expect(Array.from(active.emails)).toEqual(["someone@sysnetix.com"]);
    expect(api.requests).toHaveLength(40);
  });
});

describe("CursorConnector.toRecords", () => {
  // Cursor's own example events, from its Admin API reference.
  const EXAMPLE_EVENTS: Array<JSONObject> = [
    {
      timestamp: "1750979225854",
      userEmail: "developer@company.com",
      conversationId: "8f2e4a1b-6c3d-4e5f-9a7b-2d1c8e6f4a3b",
      model: "claude-4.5-sonnet",
      kind: "Usage-based",
      maxMode: true,
      requestsCosts: 5,
      isTokenBasedCall: true,
      isChargeable: true,
      isHeadless: false,
      tokenUsage: {
        inputTokens: 126,
        outputTokens: 450,
        cacheWriteTokens: 6112,
        cacheReadTokens: 11964,
        totalCents: 20.18232,
      },
      chargedCents: 21.36232,
      cursorTokenFee: 1.18,
    },
    {
      timestamp: "1750979173824",
      userEmail: "developer@company.com",
      conversationId: "8f2e4a1b-6c3d-4e5f-9a7b-2d1c8e6f4a3b",
      model: "claude-4.5-sonnet",
      kind: "Usage-based",
      maxMode: true,
      requestsCosts: 10,
      isTokenBasedCall: true,
      isChargeable: true,
      isHeadless: false,
      tokenUsage: {
        inputTokens: 5805,
        outputTokens: 311,
        cacheWriteTokens: 11964,
        cacheReadTokens: 0,
        totalCents: 40.167,
        discountPercentOff: 10,
      },
      chargedCents: 37.33,
      cursorTokenFee: 1.18,
    },
    {
      timestamp: "1750978339901",
      userEmail: "admin@company.com",
      model: "claude-4-sonnet-thinking",
      kind: "Included in Business",
      maxMode: true,
      requestsCosts: 1.4,
      isTokenBasedCall: false,
      isChargeable: false,
      isHeadless: false,
      chargedCents: 8,
    },
  ];

  test("Cursor's example events: by hour, model and person; cache in the input; what Cursor charged", () => {
    const { records, skipped } = CursorConnector.toRecords(EXAMPLE_EVENTS);

    expect(skipped).toBe(0);
    expect(sortRecords(records)).toEqual([
      {
        day: new Date("2025-06-26T22:00:00.000Z"),
        model: "claude-4-sonnet-thinking",
        person: "admin@company.com",
        project: "",
        apiKey: "",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        requests: 1,
        costUsd: 0.08,
      },
      {
        day: new Date("2025-06-26T23:00:00.000Z"),
        model: "claude-4.5-sonnet",
        person: "developer@company.com",
        project: "",
        apiKey: "",
        // 126 + 6112 + 11964, and 5805 + 11964 + 0.
        inputTokens: 35971,
        outputTokens: 761,
        cacheReadTokens: 11964,
        cacheWriteTokens: 18076,
        requests: 2,
        // chargedCents with the Cursor Token Rate, as the dashboard totals.
        costUsd: 0.5869232,
      },
    ]);
  });

  test("a service account is the key; with no charge, the model's cost; a charge of nothing is nothing", () => {
    const at: number = Date.UTC(2026, 9, 19, 9, 15);
    const { records } = CursorConnector.toRecords([
      cursorEvent({
        at,
        email: "",
        serviceAccountName: "CI bot",
        serviceAccountId: "sa_abc123",
      }),
      cursorEvent({ at, email: "", serviceAccountId: "sa_def456" }),
      cursorEvent({ at, email: ANA, chargedCents: null, totalCents: 7 }),
      cursorEvent({
        at,
        email: BOB,
        kind: "Included in Business",
        chargedCents: 0,
        totalCents: 9,
      }),
    ]);

    expect(
      sortRecords(records).map((record: LlmUsageRecord) => {
        return [record.person, record.apiKey, record.costUsd];
      }),
    ).toEqual([
      ["", "CI bot", 0.02],
      ["", "sa_def456", 0.02],
      [ANA, "", 0.07],
      [BOB, "", 0],
    ]);
  });

  test("a time as a number works; an event with no time, or outside the range, is left out and counted", () => {
    const hour: number = Date.UTC(2026, 9, 19, 9);
    const events: Array<JSONObject> = [
      { ...cursorEvent({ at: hour, email: ANA }), timestamp: hour + 5 },
      { ...cursorEvent({ at: hour, email: ANA }), timestamp: "soon" },
      { ...cursorEvent({ at: hour, email: ANA }), timestamp: undefined },
      cursorEvent({ at: hour + HOUR, email: ANA }),
      cursorEvent({ at: hour - 1, email: ANA }),
    ];

    const { records, skipped } = CursorConnector.toRecords(events, {
      startMs: hour,
      endMs: hour + HOUR,
    });

    expect(skipped).toBe(4);
    expect(records).toHaveLength(1);
    expect(records[0]!.requests).toBe(1);
  });

  test("records of two pieces add up as one", () => {
    const at: number = Date.UTC(2026, 9, 19, 9, 15);
    const into: Map<string, LlmUsageRecord> = new Map();
    const from: Map<string, LlmUsageRecord> = new Map();

    CursorConnector.addEvents(into, [cursorEvent({ at, email: ANA })]);
    CursorConnector.addEvents(from, [
      cursorEvent({ at, email: ANA }),
      cursorEvent({ at, email: BOB }),
    ]);
    CursorConnector.mergeRecords(into, from);

    const records: Array<LlmUsageRecord> = sortRecords(
      CursorConnector.recordsOf(into),
    );
    expect(
      records.map((record: LlmUsageRecord) => {
        return [record.person, record.requests, record.inputTokens];
      }),
    ).toEqual([
      [ANA, 2, 320],
      [BOB, 1, 160],
    ]);
  });
});

describe("CursorConnector.plan", () => {
  function plan(
    state: LlmConnectionPullState,
    now: Date = NOW,
  ): CursorReadPlan {
    return CursorConnector.plan({ now, state, backfillDays: 30 });
  }

  test("a first read: the 30 days up to the hour in progress, yesterday settled, the people counted", () => {
    expect(plan({})).toEqual({
      window: window(EARLIEST, END),
      pending: [window(EARLIEST, END)],
      queuedThrough: new Date(END),
      settledDay: iso(TODAY - DAY),
      countMembers: true,
      today: "2026-10-19",
    });
  });

  test("before 06:00 the day before is not yet settled", () => {
    const early: CursorReadPlan = plan({}, new Date("2026-10-19T04:30:00Z"));

    expect(early.window).toEqual(window(EARLIEST, Date.UTC(2026, 9, 19, 4)));
    expect(early.settledDay).toBeUndefined();
  });

  test("a later read: the hours since the last, and three before them again", () => {
    const later: CursorReadPlan = plan({
      windowEnd: iso(Date.UTC(2026, 9, 19, 12)),
      settledDay: iso(TODAY - DAY),
      membersDay: "2026-10-19",
    });

    expect(later.window).toEqual(window(Date.UTC(2026, 9, 19, 9), END));
    expect(later.pending).toEqual([window(Date.UTC(2026, 9, 19, 9), END)]);
    expect(later.countMembers).toBe(false);
    expect(later.settledDay).toBe(iso(TODAY - DAY));
  });

  test("what a stopped read left is read after the newest hours, newest first", () => {
    const resumed: CursorReadPlan = plan({
      windowEnd: iso(Date.UTC(2026, 9, 19, 14)),
      pendingWindows: [
        { start: iso(EARLIEST), end: iso(Date.UTC(2026, 9, 1)) },
      ],
      settledDay: iso(TODAY - DAY),
    });

    expect(resumed.pending).toEqual([
      window(Date.UTC(2026, 9, 19, 11), END),
      window(EARLIEST, Date.UTC(2026, 9, 1)),
    ]);
    expect(resumed.window).toEqual(window(Date.UTC(2026, 9, 19, 11), END));
  });

  test("ranges that touch or overlap are read as one; ranges older than the backfill are cut", () => {
    const merged: CursorReadPlan = plan({
      windowEnd: iso(Date.UTC(2026, 9, 19, 13)),
      pendingWindows: [
        {
          start: iso(Date.UTC(2026, 9, 19, 8)),
          end: iso(Date.UTC(2026, 9, 19, 10)),
        },
        { start: iso(Date.UTC(2026, 8, 1)), end: iso(Date.UTC(2026, 8, 25)) },
        { start: iso(Date.UTC(2026, 7, 1)), end: iso(Date.UTC(2026, 7, 5)) },
      ],
      settledDay: iso(TODAY - DAY),
    });

    expect(merged.pending).toEqual([
      window(Date.UTC(2026, 9, 19, 8), END),
      window(EARLIEST, Date.UTC(2026, 8, 25)),
    ]);
  });

  test("a resume point from the future, or one older than anything kept, reads the 30 days again", () => {
    for (const windowEnd of [
      iso(Date.UTC(2026, 9, 19, 18)),
      iso(Date.UTC(2026, 7, 1)),
      "not a date",
    ]) {
      expect(plan({ windowEnd, settledDay: iso(TODAY - DAY) }).pending).toEqual(
        [window(EARLIEST, END)],
      );
    }
  });

  test("with everything read, a read reads the last three hours again", () => {
    expect(
      plan({ windowEnd: iso(END), settledDay: iso(TODAY - DAY) }).window,
    ).toEqual(window(END - 3 * HOUR, END));
  });

  test("after 06:00 yesterday is read again in full, once", () => {
    const at: Date = new Date("2026-10-20T07:10:00Z");
    const settle: CursorReadPlan = plan(
      {
        windowEnd: "2026-10-20T07:00:00.000Z",
        settledDay: iso(TODAY - DAY),
        membersDay: "2026-10-20",
      },
      at,
    );

    expect(settle.window).toEqual(window(TODAY, TODAY + DAY));
    expect(settle.settledDay).toBe(iso(TODAY));

    const after: CursorReadPlan = plan(
      {
        windowEnd: "2026-10-20T07:00:00.000Z",
        settledDay: iso(TODAY),
        membersDay: "2026-10-20",
      },
      new Date("2026-10-20T08:10:00Z"),
    );
    expect(after.pending).toEqual([
      window(Date.UTC(2026, 9, 20, 4), Date.UTC(2026, 9, 20, 8)),
    ]);
  });

  test("at most eight ranges are kept, the newest", () => {
    const pendingWindows: Array<{ start: string; end: string }> = [];

    for (let day: number = 1; day <= 10; day++) {
      pendingWindows.push({
        start: iso(EARLIEST + 2 * day * DAY),
        end: iso(EARLIEST + (2 * day + 1) * DAY),
      });
    }

    const capped: CursorReadPlan = plan({
      windowEnd: iso(END),
      pendingWindows,
      settledDay: iso(TODAY - DAY),
    });

    expect(capped.pending).toHaveLength(8);
    expect(capped.pending[0]).toEqual(
      window(EARLIEST + 20 * DAY, EARLIEST + 21 * DAY),
    );
    expect(capped.pending[7]).toEqual(
      window(EARLIEST + 6 * DAY, EARLIEST + 7 * DAY),
    );
  });

  test("the people are counted once a UTC day", () => {
    expect(plan({ membersDay: "2026-10-18" }).countMembers).toBe(true);
    expect(plan({ membersDay: "2026-10-19" }).countMembers).toBe(false);
  });

  test("ranges taken out of ranges", () => {
    const ranges: Array<LlmUsageWindow> = [window(0, 10 * HOUR)];

    expect(
      CursorConnector.subtractWindow(ranges, window(4 * HOUR, 6 * HOUR)),
    ).toEqual([window(6 * HOUR, 10 * HOUR), window(0, 4 * HOUR)]);
    expect(
      CursorConnector.subtractWindow(ranges, window(6 * HOUR, 10 * HOUR)),
    ).toEqual([window(0, 6 * HOUR)]);
    expect(CursorConnector.subtractWindow(ranges, window(0, 10 * HOUR))).toEqual(
      [],
    );
    // An empty cut takes nothing.
    expect(
      CursorConnector.subtractWindow(ranges, window(10 * HOUR, 10 * HOUR)),
    ).toEqual(ranges);
  });
});

describe("CursorConnector.fetchUsage - a read", () => {
  test("a first read of a quiet team: every day of the backfill in day-long pieces, end to end", async () => {
    const at: World = world();

    const result: LlmUsageFetchResult = await read(at);

    expect(result).toMatchObject({
      records: [],
      warnings: [],
      bucket: "hour",
      coveredWindow: window(EARLIEST, END),
      complete: true,
      nextState: {
        windowEnd: iso(END),
        settledDay: iso(TODAY - DAY),
        membersDay: "2026-10-19",
      },
      members: 3,
      activeMembers: 0,
    });
    expect(result.nextState?.pendingWindows).toBeUndefined();

    // 711 hours: 29 pieces of a day and one of 15 hours, each its own range.
    const pieces: Array<JSONObject> = at.api.eventRequests();
    expect(pieces).toHaveLength(30);
    expect(pieces[0]).toEqual({
      startDate: END - DAY,
      endDate: END - 1,
      page: 1,
      pageSize: 1000,
    });
    expect(pieces[29]).toEqual({
      startDate: EARLIEST,
      endDate: EARLIEST + 15 * HOUR - 1,
      page: 1,
      pageSize: 1000,
    });
    for (let index: number = 1; index < pieces.length; index++) {
      expect(Number(pieces[index]!["endDate"]) + 1).toBe(
        Number(pieces[index - 1]!["startDate"]),
      );
    }

    expect(result.requestCount).toBe(32);
    expect(at.api.rateLimitedByCursor()).toBe(0);
  });

  test("a team's usage: by hour, person, model and service account, removed members included, nothing from the hour in progress", async () => {
    const events: Array<JSONObject> = [
      cursorEvent({ at: Date.UTC(2026, 9, 19, 14, 10), email: ANA }),
      cursorEvent({
        at: Date.UTC(2026, 9, 19, 14, 20),
        email: ANA,
        outputTokens: 80,
        chargedCents: 4,
      }),
      cursorEvent({
        at: Date.UTC(2026, 9, 19, 13, 5),
        email: ANA,
        model: "gpt-5",
      }),
      cursorEvent({ at: Date.UTC(2026, 9, 18, 9), email: BOB, model: "gpt-5" }),
      // Removed since: what they used is still the team's.
      cursorEvent({ at: Date.UTC(2026, 9, 17, 10, 30), email: DEE }),
      cursorEvent({
        at: Date.UTC(2026, 9, 16, 8),
        email: "",
        serviceAccountName: "CI bot",
        serviceAccountId: "sa_abc123",
      }),
      // The hour in progress, and a day older than the backfill.
      cursorEvent({ at: Date.UTC(2026, 9, 19, 15, 10), email: ANA }),
      cursorEvent({ at: Date.UTC(2026, 8, 19, 23), email: BOB }),
    ];
    const at: World = world({
      usage: usageOf(events),
      activeOn: (dayMs: number): Array<string> => {
        return dayMs === TODAY - DAY ? [ANA, DEE] : dayMs === TODAY - 2 * DAY ? [BOB] : [];
      },
    });

    const result: LlmUsageFetchResult = await read(at);

    const record: (
      hour: number,
      person: string,
      model: string,
      fields: Partial<LlmUsageRecord>,
    ) => LlmUsageRecord = (
      hour: number,
      person: string,
      model: string,
      fields: Partial<LlmUsageRecord>,
    ): LlmUsageRecord => {
      return {
        day: new Date(hour),
        model,
        person,
        project: "",
        apiKey: "",
        inputTokens: 160,
        outputTokens: 20,
        cacheReadTokens: 50,
        cacheWriteTokens: 10,
        requests: 1,
        costUsd: 0.02,
        ...fields,
      };
    };

    expect(sortRecords(result.records)).toEqual([
      record(Date.UTC(2026, 9, 16, 8), "", "claude-4.5-sonnet", {
        apiKey: "CI bot",
      }),
      record(Date.UTC(2026, 9, 17, 10), DEE, "claude-4.5-sonnet", {}),
      record(Date.UTC(2026, 9, 18, 9), BOB, "gpt-5", {}),
      record(Date.UTC(2026, 9, 19, 13), ANA, "gpt-5", {}),
      record(Date.UTC(2026, 9, 19, 14), ANA, "claude-4.5-sonnet", {
        inputTokens: 320,
        outputTokens: 100,
        cacheReadTokens: 100,
        cacheWriteTokens: 20,
        requests: 2,
        costUsd: 0.06,
      }),
    ]);
    // Removed members are not counted, nor are they active.
    expect(result.members).toBe(3);
    expect(result.activeMembers).toBe(2);
    expect(result.complete).toBe(true);
  });

  test("a busy hour is read page by page, every page of its piece", async () => {
    const busy: number = Date.UTC(2026, 9, 19, 10);
    const at: World = world({
      usage: steadyUsage({
        perHour: (hourMs: number): number => {
          return hourMs === busy ? 2500 : 0;
        },
        people: [ANA, BOB],
        models: ["claude-4.5-sonnet", "gpt-5"],
      }),
    });

    const result: LlmUsageFetchResult = await read(at);

    expect(
      at.api
        .eventRequests()
        .slice(0, 3)
        .map((body: JSONObject) => {
          return [body["startDate"], body["page"]];
        }),
    ).toEqual([
      [END - DAY, 1],
      [END - DAY, 2],
      [END - DAY, 3],
    ]);
    expect(sortRecords(result.records)).toEqual([
      {
        day: new Date(busy),
        model: "claude-4.5-sonnet",
        person: ANA,
        project: "",
        apiKey: "",
        inputTokens: 200000,
        outputTokens: 25000,
        cacheReadTokens: 62500,
        cacheWriteTokens: 12500,
        requests: 1250,
        costUsd: 25,
      },
      {
        day: new Date(busy),
        model: "gpt-5",
        person: BOB,
        project: "",
        apiKey: "",
        inputTokens: 200000,
        outputTokens: 25000,
        cacheReadTokens: 62500,
        cacheWriteTokens: 12500,
        requests: 1250,
        costUsd: 25,
      },
    ]);
    expect(at.api.eventRequests()).toHaveLength(32);
    expect(result.complete).toBe(true);
  });

  test("a busy day is read in shorter pieces, and quiet days in longer ones again", async () => {
    const at: World = world({
      usage: steadyUsage({
        perHour: (hourMs: number): number => {
          return hourMs >= END - DAY && hourMs < END ? 3000 : 0;
        },
        people: [ANA, BOB],
      }),
    });

    const result: LlmUsageFetchResult = await read(at);

    const firstPages: Array<Array<number>> = at.api
      .eventRequests()
      .filter((body: JSONObject): boolean => {
        return body["page"] === 1;
      })
      .slice(0, 7)
      .map((body: JSONObject): Array<number> => {
        return [
          (Number(body["endDate"]) + 1 - Number(body["startDate"])) / HOUR,
          (END - Number(body["endDate"]) - 1) / HOUR,
        ];
      });

    // [hours, hours before the end]: 72 pages for a day is too many for a
    // piece, so 8 hours at a time; then quiet hours, doubling.
    expect(firstPages).toEqual([
      [24, 0],
      [8, 0],
      [8, 8],
      [8, 16],
      [8, 24],
      [16, 32],
      [24, 48],
    ]);
    expect(sumOf(result.records, (r: LlmUsageRecord) => r.requests || 0)).toBe(
      72000,
    );
    expect(result.records).toHaveLength(48);
    expect(result.complete).toBe(true);
    expect(result.requestCount).toBe(105);
    expect(at.api.rateLimitedByCursor()).toBe(0);
  });

  test("an hour with more requests than a read takes in is left out, and the read says so", async () => {
    const huge: number = Date.UTC(2026, 9, 19, 10);
    const at: World = world({
      usage: steadyUsage({
        perHour: (hourMs: number): number => {
          return hourMs === huge ? 150000 : hourMs === huge - HOUR ? 3 : 0;
        },
        people: [ANA],
      }),
    });

    const result: LlmUsageFetchResult = await read(at);

    expect(result.warnings).toEqual([
      "Cursor reported 150000 requests in the hour from 2026-10-19T10:00 UTC, more than a read takes in, so that hour was left out.",
    ]);
    expect(
      result.records.map((record: LlmUsageRecord) => {
        return [record.day.toISOString(), record.requests];
      }),
    ).toEqual([["2026-10-19T09:00:00.000Z", 3]]);
    expect(result.complete).toBe(true);
  });

  test("the hours of an empty stretch are asked once, and nothing is made up for them", async () => {
    const at: World = world({
      usage: usageOf([
        cursorEvent({ at: Date.UTC(2026, 8, 25, 12), email: BOB }),
      ]),
    });

    const result: LlmUsageFetchResult = await read(at);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.day).toEqual(new Date(Date.UTC(2026, 8, 25, 12)));
    expect(at.api.eventRequests()).toHaveLength(30);
  });
});

describe("CursorConnector.fetchUsage - a read that stops part way and goes on", () => {
  const people: Array<string> = [ANA, BOB];
  const steady: FakeCursorUsage = steadyUsage({
    perHour: (): number => {
      return 500;
    },
    people,
  });

  test("the request bound ends a first read between pieces; the next reads the rest, and every event counts once", async () => {
    const first: World = world({ usage: steady });
    const one: LlmUsageFetchResult = await read(first);

    // 16 day-long pieces of 12 pages fit in 200 requests; the 17th does not.
    const stoppedAt: number = END - 16 * DAY;
    expect(one.complete).toBe(false);
    expect(one.requestCount).toBe(195);
    expect(one.coveredWindow).toEqual(window(stoppedAt, END));
    expect(one.nextState).toEqual({
      windowEnd: iso(END),
      pendingWindows: [{ start: iso(EARLIEST), end: iso(stoppedAt) }],
      settledDay: iso(TODAY - DAY),
      membersDay: "2026-10-19",
    });
    expect(one.records).toHaveLength(16 * 24 * 2);
    expect(first.api.rateLimitedByCursor()).toBe(0);
    // Within the read's 4 minutes.
    expect(first.clock.now - NOW.getTime()).toBeLessThan(4 * 60 * 1000);

    // A minute later, the same hour: the rest of the backfill.
    const second: World = world({ usage: steady });
    const two: LlmUsageFetchResult = await read(
      second,
      one.nextState,
      new Date(NOW.getTime() + 60 * 1000),
    );

    expect(two.complete).toBe(true);
    expect(two.coveredWindow).toEqual(window(EARLIEST, stoppedAt));
    expect(two.nextState).toEqual({
      windowEnd: iso(END),
      settledDay: iso(TODAY - DAY),
      membersDay: "2026-10-19",
    });
    // Counted once a day: not again.
    expect(two.members).toBeUndefined();
    expect(
      second.api.calls.some((call: FakeCursorCall): boolean => {
        return call.path !== "/teams/filtered-usage-events";
      }),
    ).toBe(false);

    // The two reads cover every hour once, and every event once.
    const hours: Set<number> = new Set<number>();
    for (const record of [...one.records, ...two.records]) {
      hours.add(record.day.getTime());
    }
    expect(hours.size).toBe(711);
    expect(
      sumOf([...one.records, ...two.records], (r: LlmUsageRecord) => {
        return r.requests || 0;
      }),
    ).toBe(711 * 500);
    for (const record of one.records) {
      expect(record.day.getTime()).toBeGreaterThanOrEqual(stoppedAt);
    }
    for (const record of two.records) {
      expect(record.day.getTime()).toBeLessThan(stoppedAt);
    }

    // An hour later: the new hour and the three before it.
    const third: World = world({ usage: steady });
    const three: LlmUsageFetchResult = await read(
      third,
      two.nextState,
      new Date("2026-10-19T16:40:00Z"),
    );
    expect(three.coveredWindow).toEqual(
      window(END - 3 * HOUR, END + HOUR),
    );
    expect(three.records).toHaveLength(8);
    expect(three.nextState?.windowEnd).toBe(iso(END + HOUR));
    expect(three.complete).toBe(true);
  });

  test("a slow Cursor ends a read at its time bound; what it read in full is kept", async () => {
    const at: World = world({ usage: steady, latencyMs: 2000 });

    const result: LlmUsageFetchResult = await read(at);

    // 9 pieces read in full in 4 minutes; the 10th, cut short, is not kept.
    const stoppedAt: number = END - 9 * DAY;
    expect(result.complete).toBe(false);
    expect(result.coveredWindow).toEqual(window(stoppedAt, END));
    expect(result.records).toHaveLength(9 * 24 * 2);
    expect(result.nextState?.pendingWindows).toEqual([
      { start: iso(EARLIEST), end: iso(stoppedAt) },
    ]);
    expect(at.clock.now - NOW.getTime()).toBeLessThanOrEqual(
      4 * 60 * 1000 + 2000,
    );
  });

  test("Cursor's events changing while a piece is read: the piece is read again, and counted once", async () => {
    const busy: number = Date.UTC(2026, 9, 19, 10);
    let changed: number = 0;
    const at: World = world({
      usage: steadyUsage({
        perHour: (hourMs: number): number => {
          return hourMs === busy ? 2500 : 0;
        },
        people: [ANA],
      }),
      intercept: (
        call: FakeCursorCall,
        answer: () => FakeResponse,
      ): FakeResponse | undefined => {
        if (call.body["page"] === 2 && changed === 0) {
          changed++;
          const body: JSONObject = answer().body as JSONObject;
          return json({ ...body, totalUsageEventsCount: 2501 });
        }
        return undefined;
      },
    });

    const result: LlmUsageFetchResult = await read(at);

    expect(
      at.api
        .eventRequests()
        .slice(0, 5)
        .map((body: JSONObject) => {
          return body["page"];
        }),
    ).toEqual([1, 2, 1, 2, 3]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!.requests).toBe(2500);
    expect(result.complete).toBe(true);
  });

  test("events that keep changing end the read there; the hours stay to read", async () => {
    const busy: number = Date.UTC(2026, 9, 19, 10);
    const at: World = world({
      usage: steadyUsage({
        perHour: (hourMs: number): number => {
          return hourMs === busy ? 2500 : 0;
        },
        people: [ANA],
      }),
      intercept: (
        call: FakeCursorCall,
        answer: () => FakeResponse,
      ): FakeResponse | undefined => {
        if (call.body["page"] === 2) {
          const body: JSONObject = answer().body as JSONObject;
          return json({ ...body, totalUsageEventsCount: 2500 + call.index });
        }
        return undefined;
      },
    });

    const result: LlmUsageFetchResult = await read(at);

    expect(result.warnings).toEqual([
      "Cursor's events for the hours to 2026-10-19T15:00 UTC kept changing while they were read; they are read again in a minute.",
    ]);
    expect(result.records).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.coveredWindow).toEqual(window(END, END));
    expect(result.nextState?.pendingWindows).toEqual([
      { start: iso(EARLIEST), end: iso(END) },
    ]);
  });
});

describe("CursorConnector.fetchUsage - Cursor refusing or failing", () => {
  test("a 429 part way is waited out once, and the read goes on", async () => {
    const at: World = world({
      intercept: onEventCall((n: number) => {
        return n === 5 ? CURSOR_RATE_LIMITED : undefined;
      }),
    });

    const result: LlmUsageFetchResult = await read(at);

    expect(result.complete).toBe(true);
    expect(
      at.clock.sleeps.filter((ms: number): boolean => {
        return ms === CURSOR_RATE_LIMIT_WAIT_MS;
      }),
    ).toHaveLength(1);
    expect(at.api.eventRequests()).toHaveLength(31);
  });

  test("a second 429 after some pieces ends the read there, to go on in a minute", async () => {
    const at: World = world({
      intercept: onEventCall((n: number) => {
        return n >= 5 ? CURSOR_RATE_LIMITED : undefined;
      }),
    });

    const result: LlmUsageFetchResult = await read(at);

    const stoppedAt: number = END - 4 * DAY;
    expect(result.complete).toBe(false);
    expect(result.coveredWindow).toEqual(window(stoppedAt, END));
    expect(result.warnings).toEqual([
      "The read stopped at 2026-10-15T15:00 UTC and goes on in a minute: Cursor asked OneUptime to slow down (HTTP 429) on the usage events request. Its Admin API takes 20 requests a minute from a team, 60 for usage events, shared with every other tool that reads it.",
    ]);
    expect(result.nextState?.pendingWindows).toEqual([
      { start: iso(EARLIEST), end: iso(stoppedAt) },
    ]);
  });

  test("a 429 before anything was read fails the read, as a rate limit", async () => {
    const at: World = world({
      intercept: answerCalls((call: FakeCursorCall) => {
        return call.path === "/teams/filtered-usage-events"
          ? CURSOR_RATE_LIMITED
          : undefined;
      }),
    });

    const failure: LlmProviderError = await failureOf(read(at));

    expect(failure.kind).toBe(LlmConnectionFailureKind.RateLimited);
  });

  test("a server error is asked again once; Cursor down after some pieces ends the read there", async () => {
    const blip: World = world({
      intercept: onEventCall((n: number) => {
        return n === 2 ? CURSOR_UNAVAILABLE : undefined;
      }),
    });

    expect((await read(blip)).complete).toBe(true);
    expect(blip.clock.sleeps).toContain(2000);

    const down: World = world({
      intercept: onEventCall((n: number) => {
        return n >= 3 ? CURSOR_UNAVAILABLE : undefined;
      }),
    });

    const result: LlmUsageFetchResult = await read(down);

    expect(result.complete).toBe(false);
    expect(result.coveredWindow).toEqual(window(END - 2 * DAY, END));
    expect(result.warnings[0]).toMatch(
      /^The read stopped at 2026-10-17T15:00 UTC and goes on in a minute: Cursor usage events request failed with HTTP 503/,
    );
  });

  test("a wrong key fails the read before any usage is asked for", async () => {
    const at: World = world({ apiKey: `crsr_${"z".repeat(64)}` });

    const failure: LlmProviderError = await failureOf(read(at));

    expect(failure.kind).toBe(LlmConnectionFailureKind.Authentication);
    expect(failure.message).toContain(
      "Cursor did not accept the key for the team members request (HTTP 401: Invalid API key).",
    );
    expect(at.api.eventRequests()).toEqual([]);
    for (const request of at.api.requests) {
      expect(everythingSent(request)).not.toContain(API_KEY);
    }
  });

  test("a key taken back part way fails the read, even with pieces read", async () => {
    const at: World = world({
      intercept: onEventCall((n: number) => {
        return n === 3 ? CURSOR_UNAUTHORIZED : undefined;
      }),
    });

    const failure: LlmProviderError = await failureOf(
      read(at, { membersDay: "2026-10-19", windowEnd: iso(END - 5 * DAY) }),
    );

    expect(failure.kind).toBe(LlmConnectionFailureKind.Authentication);
  });

  test("a plan without the Admin API fails the read as a permission, in Cursor's words", async () => {
    const at: World = world({
      intercept: answerCalls(() => {
        return CURSOR_FORBIDDEN;
      }),
    });

    const failure: LlmProviderError = await failureOf(read(at));

    expect(failure.kind).toBe(LlmConnectionFailureKind.Permission);
    expect(failure.message).toBe(
      "Cursor accepted the key but refused the team members request (HTTP 403: Enterprise access required). Reading a team's usage takes an Admin API key of a team on the Teams or Enterprise plan, which a team admin creates under Settings, Cursor Admin API Keys.",
    );
  });
});

describe("CursorConnector.fetchUsage - the team's people", () => {
  test("members and who was active in the past 7 days: the 7 full UTC days before today, removed members out, emails any case", async () => {
    const at: World = world({
      intercept: answerCalls((call: FakeCursorCall) => {
        if (call.path !== "/teams/daily-usage-data") {
          return undefined;
        }
        return json({
          data: [
            { email: "ANA@Sysnetix.com", isActive: true },
            { email: BOB, isActive: false, agentRequests: 4 },
            { email: CY, isActive: true },
            { email: DEE, isActive: true },
            { email: "guest@elsewhere.com", isActive: true },
          ],
          pagination: { page: 1, totalPages: 1, hasNextPage: false },
        });
      }),
    });

    const result: LlmUsageFetchResult = await read(at);

    expect(result.members).toBe(3);
    // Ana and Cy; Bob was not active, Dee was removed, the guest is no member.
    expect(result.activeMembers).toBe(2);
    expect(
      at.api.calls.find((call: FakeCursorCall): boolean => {
        return call.path === "/teams/daily-usage-data";
      })!.body,
    ).toEqual({
      startDate: TODAY - 7 * DAY,
      endDate: TODAY - 1,
      page: 1,
      pageSize: 250,
    });
  });

  test("the active members that cannot be read leave the members, a warning, and a count again next read", async () => {
    const at: World = world({
      intercept: answerCalls((call: FakeCursorCall) => {
        return call.path === "/teams/daily-usage-data"
          ? CURSOR_FORBIDDEN
          : undefined;
      }),
    });

    const result: LlmUsageFetchResult = await read(at);

    expect(result.members).toBe(3);
    expect(result.activeMembers).toBeUndefined();
    expect(result.warnings).toEqual([
      "How many members used Cursor could not be read: Cursor accepted the key but refused the daily usage request (HTTP 403: Enterprise access required). Reading a team's usage takes an Admin API key of a team on the Teams or Enterprise plan, which a team admin creates under Settings, Cursor Admin API Keys.",
    ]);
    expect(result.nextState?.membersDay).toBeUndefined();
    expect(result.complete).toBe(true);
  });

  test("members that cannot be read for a moment do not stop the usage", async () => {
    const at: World = world({
      intercept: answerCalls((call: FakeCursorCall) => {
        return call.path === "/teams/members" ? CURSOR_UNAVAILABLE : undefined;
      }),
    });

    const result: LlmUsageFetchResult = await read(at);

    expect(result.members).toBeUndefined();
    expect(result.activeMembers).toBeUndefined();
    expect(result.warnings[0]).toMatch(
      /^The team's members could not be read: Cursor team members request failed with HTTP 503/,
    );
    expect(result.nextState?.membersDay).toBeUndefined();
    expect(result.complete).toBe(true);
    expect(at.api.eventRequests()).toHaveLength(30);
  });

  test("a team bigger than the daily pages hold is counted in part, and says so", async () => {
    const at: World = world({
      intercept: answerCalls((call: FakeCursorCall) => {
        return call.path === "/teams/daily-usage-data"
          ? json({
              data: [{ email: ANA, isActive: true }],
              pagination: { hasNextPage: true },
            })
          : undefined;
      }),
    });

    const result: LlmUsageFetchResult = await read(at);

    expect(result.activeMembers).toBe(1);
    expect(result.warnings).toEqual([
      "Only the first 10000 members' days were read, so some members who use Cursor may not be counted.",
    ]);
    expect(result.nextState?.membersDay).toBe("2026-10-19");
    expect(at.api.rateLimitedByCursor()).toBe(0);
  });
});

describe("CursorConnector.testConnection", () => {
  test("a team with usage: the last 7 days added up, and its members", async () => {
    const at: World = world({
      usage: usageOf([
        cursorEvent({ at: Date.UTC(2026, 9, 19, 15, 10), email: ANA }),
        cursorEvent({ at: Date.UTC(2026, 9, 18, 9), email: ANA }),
        cursorEvent({
          at: Date.UTC(2026, 9, 15, 11),
          email: BOB,
          model: "gpt-5",
        }),
        cursorEvent({
          at: Date.UTC(2026, 9, 13, 8),
          email: "",
          serviceAccountName: "CI bot",
        }),
        // Before the 7 days.
        cursorEvent({ at: Date.UTC(2026, 9, 12, 15), email: CY }),
      ]),
    });

    const result: LlmConnectionTestResult = await test7Days(at);

    expect(result).toMatchObject({
      provider: "cursor",
      status: "pass",
      message: "Connected. Found usage in the last 7 days.",
      counts: {
        days: 7,
        models: 2,
        people: 2,
        apiKeys: 1,
        projects: 0,
        inputTokens: 640,
        outputTokens: 80,
        requests: 4,
        costUsd: 0.08,
        members: 3,
      },
    });
    expect(at.api.eventRequests()).toEqual([
      {
        startDate: NOW.getTime() - 7 * DAY,
        endDate: NOW.getTime(),
        page: 1,
        pageSize: 1000,
      },
    ]);
  });

  test("a busy team is counted, not added up: one page of events", async () => {
    const at: World = world({
      usage: steadyUsage({
        perHour: (hourMs: number): number => {
          return hourMs > NOW.getTime() - 7 * DAY && hourMs < END ? 40 : 0;
        },
        people: [ANA, BOB],
      }),
    });

    const result: LlmConnectionTestResult = await test7Days(at);

    expect(result).toMatchObject({
      status: "pass",
      message: "Connected. Found 6680 requests in the last 7 days.",
      counts: { days: 7, requests: 6680, members: 3 },
    });
    expect(at.api.eventRequests()).toHaveLength(1);
  });

  test("a quiet team: the key works, with nothing used yet", async () => {
    const result: LlmConnectionTestResult = await test7Days(world());

    expect(result).toMatchObject({
      status: "warn",
      message:
        "Connected, but there is no usage in the last 7 days. Usage will show up as soon as there is some.",
      counts: { members: 3, requests: 0 },
    });
  });

  test.each([
    [
      "a wrong key",
      CURSOR_UNAUTHORIZED,
      LlmConnectionFailureKind.Authentication,
      "Cursor did not accept the key for the team members request (HTTP 401: Invalid API key).",
    ],
    [
      "a plan without the Admin API",
      CURSOR_FORBIDDEN,
      LlmConnectionFailureKind.Permission,
      "Cursor accepted the key but refused the team members request (HTTP 403: Enterprise access required).",
    ],
    [
      "a rate limit",
      CURSOR_RATE_LIMITED,
      LlmConnectionFailureKind.RateLimited,
      "Cursor asked OneUptime to slow down (HTTP 429) on the team members request.",
    ],
    [
      "Cursor down",
      CURSOR_UNAVAILABLE,
      LlmConnectionFailureKind.Unavailable,
      "Cursor team members request failed with HTTP 503",
    ],
  ])(
    "%s: a failed test, of its kind, in words that say what to do",
    async (
      _name: string,
      response: FakeResponse,
      kind: LlmConnectionFailureKind,
      words: string,
    ) => {
      const at: World = world({
        intercept: answerCalls(() => {
          return response;
        }),
      });

      const result: LlmConnectionTestResult = await test7Days(at);

      expect(result.status).toBe("fail");
      expect(result.failureKind).toBe(kind);
      expect(result.message).toContain(words);
      expect(result.message).not.toContain(API_KEY);
      // A test answers at once: nothing is waited for.
      expect(at.clock.sleeps).toEqual([]);
    },
  );

  test("a key with a space in it is a setting to fix, and nothing is sent", async () => {
    const at: World = world();

    const result: LlmConnectionTestResult = await test7Days(at, {
      ...SETTINGS,
      secrets: { apiKey: "crsr_abc def" },
    });

    expect(result).toMatchObject({
      status: "fail",
      failureKind: LlmConnectionFailureKind.Settings,
      message:
        "The Admin API key has a space or a line break in it. Paste the key alone.",
    });
    expect(at.api.requests).toEqual([]);
  });
});

describe("Cursor as a connection", () => {
  test("a provider account read hourly, with its own connector", () => {
    const definition: LlmConnectionDefinition = getLlmConnectionDefinition(
      LlmConnectionProvider.Cursor,
    )!;

    expect(definition).toMatchObject({
      kind: LlmConnectionKind.ProviderAccount,
      title: "Cursor",
      pullIntervalInMinutes: 60,
      backfillDays: 30,
      costIsEstimated: false,
      genAiProviderName: "cursor",
      docsPath: "/docs/telemetry/ai-provider-accounts#cursor",
      otherWay: {
        title: "Cursor Enterprise: OpenTelemetry Export",
        docsPath: "/docs/telemetry/cursor",
      },
    });
    expect(
      definition.secretFields.map((field: { key: string }) => {
        return field.key;
      }),
    ).toEqual(["apiKey"]);
    expect(definition.configFields).toEqual([]);

    const connector: ReturnType<typeof LlmConnectorRegistry.getConnector> =
      LlmConnectorRegistry.getConnector(LlmConnectionProvider.Cursor);
    expect(connector).toBeInstanceOf(CursorConnector);
    expect(connector.kind).toBe(LlmConnectionKind.ProviderAccount);
  });

  test("settings are checked before a read", () => {
    const connector: CursorConnector = new CursorConnector();

    expect(() => {
      connector.validateSettings({ ...SETTINGS, secrets: {} });
    }).toThrow("Admin API key is required.");
    expect(() => {
      connector.validateSettings(SETTINGS);
    }).not.toThrow();
  });
});
