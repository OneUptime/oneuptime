import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  bodyOf,
  createFakeProviderApi,
  json,
} from "./FakeProviderApi";

/*
 * Cursor's Admin API in a test, answering as its reference documents it
 * (cursor.com/docs/account/teams/admin-api, cursor.com/docs/api):
 *
 *   GET  /teams/members                { teamMembers: [{ id, name, email,
 *                                        role, isRemoved }] }
 *   POST /teams/filtered-usage-events  { totalUsageEventsCount, pagination:
 *                                        { numPages, currentPage, pageSize,
 *                                        hasNextPage, hasPreviousPage },
 *                                        usageEvents: [...], period }, newest
 *                                        first, both bounds inclusive, at
 *                                        most 1000 a page
 *   POST /teams/daily-usage-data       { data: [a row per member and day,
 *                                        isActive with page and pageSize],
 *                                        period, pagination: { page,
 *                                        pageSize, totalUsers, totalPages,
 *                                        hasNextPage, hasPreviousPage } }, at
 *                                        most 30 days
 *
 * Basic authentication with the key as the user name, 401 for any other
 * key, and Cursor's limits enforced on the test's clock: 60 usage-event
 * requests a minute, 20 a minute for each other endpoint, a 429 with
 * Cursor's own body past them. A test answers any request its own way
 * (intercept): a failure, a total that changed mid-read.
 */

export const CURSOR_TEST_HOST: string = "api.cursor.com";

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;
const MINUTE_MS: number = 60 * 1000;

// Cursor's documented error bodies.
export const CURSOR_UNAUTHORIZED: FakeResponse = json(
  { error: "Unauthorized", message: "Invalid API key" },
  401,
);
export const CURSOR_FORBIDDEN: FakeResponse = json(
  { error: "Forbidden", message: "Enterprise access required" },
  403,
);
export const CURSOR_RATE_LIMITED: FakeResponse = json(
  { code: "error", message: "Rate limit exceeded" },
  429,
);
export const CURSOR_UNAVAILABLE: FakeResponse = json(
  { error: "Service Unavailable", message: "Please try again later." },
  503,
);

/*
 * The test's clock: the client's pacing and a read's time bound go by it,
 * and a wait moves it on instead of waiting.
 */
export class FakeCursorClock {
  public now: number;
  public sleeps: Array<number> = [];

  public constructor(start: Date) {
    this.now = start.getTime();
  }

  public clock: () => number = (): number => {
    return this.now;
  };

  public sleep: (ms: number) => Promise<void> = async (
    ms: number,
  ): Promise<void> => {
    this.sleeps.push(ms);
    this.now += Math.max(0, ms);
  };
}

export interface FakeCursorMember {
  id: string;
  name: string;
  email: string;
  role: string;
  isRemoved: boolean;
}

export function cursorMember(
  email: string,
  overrides: Partial<FakeCursorMember> = {},
): FakeCursorMember {
  return {
    id: `user_${email.split("@")[0]!.replace(/[^A-Za-z0-9]/g, "")}0000000000`,
    name: email.split("@")[0]!,
    email,
    role: "member",
    isRemoved: false,
    ...overrides,
  };
}

// One usage event as Cursor answers it: a token-based request by default.
export function cursorEvent(data: {
  at: number;
  email: string;
  model?: string | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cacheReadTokens?: number | undefined;
  cacheWriteTokens?: number | undefined;
  totalCents?: number | undefined;
  // Undefined: Cursor charged what the tokens cost (totalCents).
  chargedCents?: number | null | undefined;
  serviceAccountName?: string | undefined;
  serviceAccountId?: string | undefined;
  kind?: string | undefined;
  tokenBased?: boolean | undefined;
}): JSONObject {
  const tokenBased: boolean = data.tokenBased !== false;
  const totalCents: number = data.totalCents ?? 2;
  const event: JSONObject = {
    // Cursor gives epoch milliseconds as a string.
    timestamp: String(data.at),
    userEmail: data.email,
    model: data.model || "claude-4.5-sonnet",
    kind: data.kind || "Usage-based",
    maxMode: false,
    requestsCosts: 1,
    isTokenBasedCall: tokenBased,
    isChargeable: true,
    isHeadless: false,
  };

  if (tokenBased) {
    event["tokenUsage"] = {
      inputTokens: data.inputTokens ?? 100,
      outputTokens: data.outputTokens ?? 20,
      cacheWriteTokens: data.cacheWriteTokens ?? 10,
      cacheReadTokens: data.cacheReadTokens ?? 50,
      totalCents,
    };
  }

  if (data.chargedCents !== null) {
    event["chargedCents"] = data.chargedCents ?? totalCents;
  }

  if (data.serviceAccountName) {
    event["serviceAccountName"] = data.serviceAccountName;
  }

  if (data.serviceAccountId) {
    event["serviceAccountId"] = data.serviceAccountId;
  }

  return event;
}

// An hour of a team's usage events, newest first.
export interface FakeCursorHour {
  count: number;
  event: (index: number) => JSONObject;
}

// A team's usage, hour by hour (the hour's start in epoch ms).
export type FakeCursorUsage = (hourMs: number) => FakeCursorHour | undefined;

// The events given, as Cursor keeps them.
export function usageOf(events: Array<JSONObject>): FakeCursorUsage {
  const hours: Map<number, Array<JSONObject>> = new Map();

  for (const event of events) {
    const at: number = Number(event["timestamp"]);
    const hour: number = Math.floor(at / HOUR_MS) * HOUR_MS;
    const list: Array<JSONObject> = hours.get(hour) || [];
    list.push(event);
    hours.set(hour, list);
  }

  for (const list of hours.values()) {
    list.sort((a: JSONObject, b: JSONObject): number => {
      return Number(b["timestamp"]) - Number(a["timestamp"]);
    });
  }

  return (hourMs: number): FakeCursorHour | undefined => {
    const list: Array<JSONObject> | undefined = hours.get(hourMs);

    return list
      ? {
          count: list.length,
          event: (index: number): JSONObject => {
            return list[index]!;
          },
        }
      : undefined;
  };
}

/*
 * A busy team without keeping its events: each hour holds as many as
 * perHour says, spread over the hour, by the people and models in turn,
 * each 160 input tokens (cache included), 20 output and 2 cents.
 */
export function steadyUsage(data: {
  perHour: (hourMs: number) => number;
  people: Array<string>;
  models?: Array<string> | undefined;
}): FakeCursorUsage {
  const models: Array<string> = data.models || ["claude-4.5-sonnet"];

  return (hourMs: number): FakeCursorHour | undefined => {
    const count: number = Math.max(0, Math.floor(data.perHour(hourMs)));

    if (count === 0) {
      return undefined;
    }

    return {
      count,
      event: (index: number): JSONObject => {
        return cursorEvent({
          at: hourMs + HOUR_MS - 1 - Math.floor((index * (HOUR_MS - 1)) / count),
          email: data.people[index % data.people.length]!,
          model: models[index % models.length]!,
        });
      },
    };
  };
}

export interface FakeCursorTeam {
  apiKey: string;
  members: Array<FakeCursorMember>;
  usage: FakeCursorUsage;
  // The emails active on a UTC day (its start in epoch ms).
  activeOn?: ((dayMs: number) => Array<string>) | undefined;
}

export interface FakeCursorCall {
  path: string;
  body: JSONObject;
  // The test clock when it was asked.
  at: number;
  // 1-based, across every endpoint.
  index: number;
}

export type FakeCursorIntercept = (
  call: FakeCursorCall,
  answer: () => FakeResponse,
) => FakeResponse | undefined;

export interface FakeCursorApi extends FakeProviderApi {
  calls: Array<FakeCursorCall>;
  // The bodies of the usage events requests, in order.
  eventRequests: () => Array<JSONObject>;
  // How many 429s Cursor answered because its limit was passed.
  rateLimitedByCursor: () => number;
}

function inRange(at: number, startMs: number, endMs: number): boolean {
  return at >= startMs && at <= endMs;
}

// An hour's events between two inclusive bounds, as indexes of the hour.
function hourIndexes(
  hour: FakeCursorHour,
  hourMs: number,
  startMs: number,
  endMs: number,
): { count: number; at: (position: number) => number } {
  if (hourMs >= startMs && hourMs + HOUR_MS - 1 <= endMs) {
    return {
      count: hour.count,
      at: (position: number): number => {
        return position;
      },
    };
  }

  const indexes: Array<number> = [];

  for (let index: number = 0; index < hour.count; index++) {
    if (inRange(Number(hour.event(index)["timestamp"]), startMs, endMs)) {
      indexes.push(index);
    }
  }

  return {
    count: indexes.length,
    at: (position: number): number => {
      return indexes[position]!;
    },
  };
}

function usageEventsAnswer(
  team: FakeCursorTeam,
  body: JSONObject,
): FakeResponse {
  const startMs: number = Number(body["startDate"]);
  const endMs: number = Number(body["endDate"]);
  const page: number = body["page"] === undefined ? 1 : Number(body["page"]);
  const pageSize: number =
    body["pageSize"] === undefined ? 100 : Number(body["pageSize"]);

  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 1000
  ) {
    return json(
      { error: "Bad Request", message: "Invalid request parameters" },
      400,
    );
  }

  // Newest hour first, the hour's events newest first.
  const hours: Array<{
    hourMs: number;
    hour: FakeCursorHour;
    count: number;
    at: (position: number) => number;
  }> = [];
  let total: number = 0;

  for (
    let hourMs: number = Math.floor(endMs / HOUR_MS) * HOUR_MS;
    hourMs >= Math.floor(startMs / HOUR_MS) * HOUR_MS;
    hourMs -= HOUR_MS
  ) {
    const hour: FakeCursorHour | undefined = team.usage(hourMs);

    if (!hour || hour.count === 0) {
      continue;
    }

    const indexes: { count: number; at: (position: number) => number } =
      hourIndexes(hour, hourMs, startMs, endMs);

    if (indexes.count > 0) {
      hours.push({ hourMs, hour, ...indexes });
      total += indexes.count;
    }
  }

  const numPages: number = Math.ceil(total / pageSize);
  const events: Array<JSONObject> = [];
  let skip: number = (page - 1) * pageSize;

  for (const entry of hours) {
    if (events.length >= pageSize) {
      break;
    }

    if (skip >= entry.count) {
      skip -= entry.count;
      continue;
    }

    for (
      let position: number = skip;
      position < entry.count && events.length < pageSize;
      position++
    ) {
      events.push(entry.hour.event(entry.at(position)));
    }

    skip = 0;
  }

  return json({
    totalUsageEventsCount: total,
    pagination: {
      numPages,
      currentPage: page,
      pageSize,
      hasNextPage: page < numPages,
      hasPreviousPage: page > 1,
    },
    usageEvents: events,
    period: { startDate: startMs, endDate: endMs },
  });
}

function dailyUsageAnswer(team: FakeCursorTeam, body: JSONObject): FakeResponse {
  const startMs: number = Number(body["startDate"]);
  const endMs: number = Number(body["endDate"]);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return json(
      { error: "Bad Request", message: "startDate and endDate are required" },
      400,
    );
  }

  if (endMs - startMs > 30 * DAY_MS) {
    return json(
      { error: "Bad Request", message: "Date range cannot exceed 30 days" },
      400,
    );
  }

  const paged: boolean =
    body["page"] !== undefined && body["pageSize"] !== undefined;
  const page: number = paged ? Number(body["page"]) : 1;
  const pageSize: number = paged
    ? Number(body["pageSize"])
    : team.members.length;
  const days: Array<number> = [];

  for (
    let day: number = Math.floor(startMs / DAY_MS) * DAY_MS;
    day <= endMs;
    day += DAY_MS
  ) {
    days.push(day);
  }

  const rowOf: (member: FakeCursorMember, day: number) => JSONObject = (
    member: FakeCursorMember,
    day: number,
  ): JSONObject => {
    const active: boolean = (team.activeOn ? team.activeOn(day) : []).some(
      (email: string): boolean => {
        return email === member.email;
      },
    );

    return {
      userId: 12345,
      day: new Date(day).toISOString().substring(0, 10),
      date: day,
      email: member.email,
      // Only with pagination; without it, only the active are listed.
      ...(paged ? { isActive: active } : {}),
      totalLinesAdded: active ? 120 : 0,
      totalApplies: active ? 4 : 0,
      totalTabsAccepted: active ? 30 : 0,
      composerRequests: 0,
      chatRequests: active ? 3 : 0,
      agentRequests: active ? 5 : 0,
      cmdkUsages: 0,
      bugbotUsages: 0,
      mostUsedModel: active ? "claude-4.5-sonnet" : null,
    };
  };

  const users: Array<FakeCursorMember> = paged
    ? team.members.slice((page - 1) * pageSize, page * pageSize)
    : team.members;
  const data: Array<JSONObject> = [];

  for (const member of users) {
    for (const day of days) {
      const row: JSONObject = rowOf(member, day);

      if (paged || row["agentRequests"]) {
        data.push(row);
      }
    }
  }

  const totalPages: number = Math.ceil(team.members.length / pageSize);

  return json({
    data,
    period: { startDate: startMs, endDate: endMs },
    ...(paged
      ? {
          pagination: {
            page,
            pageSize,
            totalUsers: team.members.length,
            totalPages,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
          },
        }
      : {}),
  });
}

export function createFakeCursorApi(data: {
  team: FakeCursorTeam;
  clock: FakeCursorClock;
  intercept?: FakeCursorIntercept | undefined;
  // How long Cursor takes to answer, on the test clock.
  latencyMs?: number | undefined;
}): FakeCursorApi {
  const calls: Array<FakeCursorCall> = [];
  const asked: Map<string, Array<number>> = new Map();
  let rateLimited: number = 0;

  const authorized: (request: DataSourceHttpRequest) => boolean = (
    request: DataSourceHttpRequest,
  ): boolean => {
    const header: string = String(
      (request.headers || {})["Authorization"] || "",
    );

    return (
      header ===
      `Basic ${Buffer.from(`${data.team.apiKey}:`).toString("base64")}`
    );
  };

  const answer: (
    path: string,
    limit: number,
    respond: (body: JSONObject) => FakeResponse,
  ) => (request: DataSourceHttpRequest) => FakeResponse = (
    path: string,
    limit: number,
    respond: (body: JSONObject) => FakeResponse,
  ): ((request: DataSourceHttpRequest) => FakeResponse) => {
    return (request: DataSourceHttpRequest): FakeResponse => {
      const at: number = data.clock.now;
      const body: JSONObject = request.body ? bodyOf(request) : {};
      const call: FakeCursorCall = {
        path,
        body,
        at,
        index: calls.length + 1,
      };
      calls.push(call);
      data.clock.now += data.latencyMs || 0;

      const own: () => FakeResponse = (): FakeResponse => {
        if (!authorized(request)) {
          return CURSOR_UNAUTHORIZED;
        }

        // Cursor's limit for the endpoint, over the last minute.
        const recent: Array<number> = (asked.get(path) || []).filter(
          (time: number): boolean => {
            return time > at - MINUTE_MS;
          },
        );
        recent.push(at);
        asked.set(path, recent);

        if (recent.length > limit) {
          rateLimited++;
          return CURSOR_RATE_LIMITED;
        }

        return respond(body);
      };

      const intercepted: FakeResponse | undefined = data.intercept
        ? data.intercept(call, own)
        : undefined;

      return intercepted || own();
    };
  };

  const api: FakeProviderApi = createFakeProviderApi([
    {
      host: CURSOR_TEST_HOST,
      method: "GET",
      path: "/teams/members",
      respond: answer("/teams/members", 20, (): FakeResponse => {
        return json({ teamMembers: data.team.members as never });
      }),
    },
    {
      host: CURSOR_TEST_HOST,
      method: "POST",
      path: "/teams/filtered-usage-events",
      respond: answer(
        "/teams/filtered-usage-events",
        60,
        (body: JSONObject): FakeResponse => {
          return usageEventsAnswer(data.team, body);
        },
      ),
    },
    {
      host: CURSOR_TEST_HOST,
      method: "POST",
      path: "/teams/daily-usage-data",
      respond: answer(
        "/teams/daily-usage-data",
        20,
        (body: JSONObject): FakeResponse => {
          return dailyUsageAnswer(data.team, body);
        },
      ),
    },
  ]);

  return {
    ...api,
    calls,
    eventRequests: (): Array<JSONObject> => {
      return calls
        .filter((call: FakeCursorCall): boolean => {
          return call.path === "/teams/filtered-usage-events";
        })
        .map((call: FakeCursorCall): JSONObject => {
          return call.body;
        });
    },
    rateLimitedByCursor: (): number => {
      return rateLimited;
    },
  };
}
