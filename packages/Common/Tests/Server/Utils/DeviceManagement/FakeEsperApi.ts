import BadDataException from "../../../../Types/Exception/BadDataException";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { DeviceManagementTransport } from "../../../../Server/Utils/DeviceManagement/DeviceManagementTypes";
import {
  ESPER_ENTERPRISE_ID,
  ESPER_TENANT,
  buildEsperUserInfo,
} from "./EsperFixtures";

/*
 * Esper's API in a test, answering the way its API reference documents
 * (api.esper.io):
 *
 *   - at https://<tenant>-api.esper.cloud/api, the key in
 *     "Authorization: Bearer <key>", else 401;
 *   - GET /user_info/                  bare: the key's user, its enterprise
 *                                      and role
 *   - GET /v2/devices/                 wrapped {"code", "message",
 *                                      "content": {"count", "previous",
 *                                      "next", "results"}}, limit and
 *                                      offset, `next` an absolute URL on
 *                                      the tenant's host; platform, a CSV
 *                                      (ANDROID,APPLE), leaves other
 *                                      platforms out
 *   GET /v2/heartbeat/?platform=       one platform's devices only
 *   - GET /enterprise/{eid}/devicegroup/   bare {"count", "next",
 *                                      "previous", "results"}, 20 a page
 *                                      by default
 *   - GET /v2/heartbeat/               wrapped {"content": {"count", "prev",
 *                                      "next", "results"}}: the devices last
 *                                      seen strictly between last_seen_gt
 *                                      and last_seen_lt, both required
 *                                      (400 without them)
 *   - GET /device/v0/heartbeat/{id}/   wrapped {"content": {"device_id",
 *                                      "timestamp", "status"}}, 404 for a
 *                                      device it has none for
 *   - GET /enterprise/{eid}/device/{id}/app/  bare, paged like the groups
 *
 * A route of another enterprise answers 404. Faults are scripted per path:
 * answers to give first (a 429 with or without Retry-After, a 500), or a
 * transport that throws. The production transport answers every status only
 * when asked (acceptAnyStatus); asked without it, this one throws for
 * anything but 2xx the way DataSourceHttpFetch does.
 *
 * Every request is recorded, with the clock's time.
 */

export const FAKE_ESPER_API_KEY: string = "esper-key-0123456789abcdefGHIJKL";

export interface FakeEsperAnswer {
  status: number;
  body?: unknown;
  headers?: Dictionary<string> | undefined;
}

export interface FakeEsperOptions {
  tenant?: string | undefined;
  enterpriseId?: string | undefined;
  role?: string | undefined;
  apiKey?: string | undefined;
  devices?: Array<JSONObject> | undefined;
  groups?: Array<JSONObject> | undefined;
  // The last check-in of each device, by its ID.
  heartbeats?: Record<string, Date> | undefined;
  // Each device's apps, by its ID.
  apps?: Record<string, Array<JSONObject>> | undefined;
  now: () => Date;
  // The largest page each list gives, whatever limit is asked.
  maxPageSize?: number | undefined;
}

export interface FakeEsperRequest {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  headers: Dictionary<string>;
  at: Date;
}

// What the fake tenant holds now: a test changes it between reads.
export interface FakeEsperState {
  devices: Array<JSONObject>;
  groups: Array<JSONObject>;
  heartbeats: Record<string, Date>;
  apps: Record<string, Array<JSONObject>>;
  role: string;
  enterpriseId: string;
}

export interface FakeEsperApi {
  transport: DeviceManagementTransport;
  requests: Array<FakeEsperRequest>;
  state: FakeEsperState;
  // Answers to give, first, to requests whose path starts with the prefix.
  fault: (
    pathPrefix: string,
    answers: Array<FakeEsperAnswer | "throw">,
  ) => void;
  // Requests whose path starts with the prefix.
  requestsTo: (pathPrefix: string) => Array<FakeEsperRequest>;
}

function wrapped(status: number, content: unknown): FakeEsperAnswer {
  return {
    status,
    body: { code: status, message: status === 200 ? "success" : "", content },
  };
}

export function createFakeEsperApi(options: FakeEsperOptions): FakeEsperApi {
  const tenant: string = options.tenant ?? ESPER_TENANT;
  const host: string = `${tenant}-api.esper.cloud`;
  const requests: Array<FakeEsperRequest> = [];
  const faults: Array<{
    prefix: string;
    answers: Array<FakeEsperAnswer | "throw">;
  }> = [];
  const state: FakeEsperState = {
    devices: options.devices ?? [],
    groups: options.groups ?? [],
    heartbeats: options.heartbeats ?? {},
    apps: options.apps ?? {},
    role: options.role ?? "Viewer",
    enterpriseId: options.enterpriseId ?? ESPER_ENTERPRISE_ID,
  };
  const maxPageSize: number = options.maxPageSize ?? 1000;

  // One page of a list, and the absolute URL of the next one.
  const page: (
    url: URL,
    items: Array<unknown>,
    defaultLimit: number,
  ) => { count: number; next: string | null; results: Array<unknown> } = (
    url: URL,
    items: Array<unknown>,
    defaultLimit: number,
  ): { count: number; next: string | null; results: Array<unknown> } => {
    const limit: number = Math.min(
      maxPageSize,
      Number(url.searchParams.get("limit") || defaultLimit) || defaultLimit,
    );
    const offset: number = Number(url.searchParams.get("offset") || 0) || 0;
    const results: Array<unknown> = items.slice(offset, offset + limit);
    let next: string | null = null;

    if (offset + limit < items.length) {
      const nextUrl: URL = new URL(url.toString());
      nextUrl.searchParams.set("limit", String(limit));
      nextUrl.searchParams.set("offset", String(offset + limit));
      next = nextUrl.toString();
    }

    return { count: items.length, next, results };
  };

  const answer: (url: URL) => FakeEsperAnswer = (url: URL): FakeEsperAnswer => {
    const path: string = url.pathname;
    const enterprisePrefix: string = `/api/enterprise/${state.enterpriseId}/`;

    if (path === "/api/user_info/") {
      return {
        status: 200,
        body: buildEsperUserInfo({
          enterpriseId: state.enterpriseId,
          role: state.role,
        }),
      };
    }

    if (path === "/api/v2/devices/") {
      // A CSV of platforms, as the v2 list takes it: ANDROID,APPLE.
      const platforms: Array<string> = (url.searchParams.get("platform") || "")
        .split(",")
        .map((platform: string): string => {
          return platform.trim();
        })
        .filter(Boolean);
      const devices: Array<JSONObject> = state.devices.filter(
        (device: JSONObject): boolean => {
          return (
            platforms.length === 0 ||
            platforms.includes(String(device["platform"]))
          );
        },
      );
      const listed: {
        count: number;
        next: string | null;
        results: Array<unknown>;
      } = page(url, devices, 10);

      return wrapped(200, {
        count: listed.count,
        previous: null,
        next: listed.next,
        results: listed.results,
      });
    }

    if (path === "/api/v2/heartbeat/") {
      const after: number = Date.parse(
        url.searchParams.get("last_seen_gt") || "",
      );
      const before: number = Date.parse(
        url.searchParams.get("last_seen_lt") || "",
      );

      if (!Number.isFinite(after) || !Number.isFinite(before)) {
        return {
          status: 400,
          body: {
            code: 400,
            message: "last_seen_gt and last_seen_lt are required.",
            content: {},
          },
        };
      }

      const now: number = options.now().getTime();
      // One platform, as the heartbeat list takes it.
      const platform: string | null = url.searchParams.get("platform");
      const platformOf: (deviceId: string) => string = (
        deviceId: string,
      ): string => {
        const device: JSONObject | undefined = state.devices.find(
          (candidate: JSONObject): boolean => {
            return candidate["id"] === deviceId;
          },
        );

        return String(device?.["platform"] ?? "ANDROID");
      };
      const results: Array<JSONObject> = Object.entries(state.heartbeats)
        .filter(([deviceId, seenAt]: [string, Date]): boolean => {
          return (
            seenAt.getTime() > after &&
            seenAt.getTime() < before &&
            (!platform || platformOf(deviceId) === platform)
          );
        })
        .map(([deviceId, seenAt]: [string, Date]): JSONObject => {
          return {
            device_id: deviceId,
            timestamp: seenAt.toISOString(),
            status: now - seenAt.getTime() <= 30 * 60 * 1000 ? 1 : 0,
          };
        });
      const listed: {
        count: number;
        next: string | null;
        results: Array<unknown>;
      } = page(url, results, 10);

      return wrapped(200, {
        count: listed.count,
        prev: null,
        next: listed.next,
        results: listed.results,
      });
    }

    const heartbeatPrefix: string = "/api/device/v0/heartbeat/";

    if (path.startsWith(heartbeatPrefix)) {
      const deviceId: string = path
        .substring(heartbeatPrefix.length)
        .replace(/\/$/, "");
      const seenAt: Date | undefined = state.heartbeats[deviceId];

      if (!seenAt) {
        return {
          status: 404,
          body: { code: 404, message: "Not found.", content: {} },
        };
      }

      return wrapped(200, {
        device_id: deviceId,
        timestamp: seenAt.toISOString(),
        status:
          options.now().getTime() - seenAt.getTime() <= 30 * 60 * 1000 ? 1 : 0,
      });
    }

    if (
      path.startsWith("/api/enterprise/") &&
      !path.startsWith(enterprisePrefix)
    ) {
      return {
        status: 404,
        body: { errors: [], message: "Not found.", status: 404 },
      };
    }

    if (path === `${enterprisePrefix}devicegroup/`) {
      const listed: {
        count: number;
        next: string | null;
        results: Array<unknown>;
      } = page(url, state.groups, 20);

      return {
        status: 200,
        body: {
          count: listed.count,
          next: listed.next,
          previous: null,
          results: listed.results,
        },
      };
    }

    const appsMatch: RegExpExecArray | null = new RegExp(
      `^${enterprisePrefix}device/([^/]+)/app/$`,
    ).exec(path);

    if (appsMatch) {
      const deviceId: string = appsMatch[1]!;
      const known: boolean = state.devices.some(
        (device: JSONObject): boolean => {
          return device["id"] === deviceId;
        },
      );

      if (!known) {
        return {
          status: 404,
          body: { errors: [], message: "Not found.", status: 404 },
        };
      }

      const listed: {
        count: number;
        next: string | null;
        results: Array<unknown>;
      } = page(url, state.apps[deviceId] || [], 20);

      return {
        status: 200,
        body: {
          count: listed.count,
          next: listed.next,
          previous: null,
          results: listed.results,
        },
      };
    }

    return {
      status: 404,
      body: { errors: [], message: "Not found.", status: 404 },
    };
  };

  const transport: DeviceManagementTransport = async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    const url: URL = new URL(request.url);
    const headers: Dictionary<string> = request.headers || {};

    requests.push({
      method: request.method,
      url: request.url,
      path: url.pathname,
      query: url.searchParams,
      headers,
      at: options.now(),
    });

    let response: FakeEsperAnswer;
    const fault:
      | { prefix: string; answers: Array<FakeEsperAnswer | "throw"> }
      | undefined = faults.find(
      (candidate: {
        prefix: string;
        answers: Array<FakeEsperAnswer | "throw">;
      }): boolean => {
        return (
          url.pathname.startsWith(candidate.prefix) &&
          candidate.answers.length > 0
        );
      },
    );

    if (fault) {
      const next: FakeEsperAnswer | "throw" = fault.answers.shift()!;

      if (next === "throw") {
        throw new Error("socket hang up");
      }

      response = next;
    } else if (url.hostname !== host) {
      throw new Error(`getaddrinfo ENOTFOUND ${url.hostname}`);
    } else if (
      headers["Authorization"] !==
      `Bearer ${options.apiKey ?? FAKE_ESPER_API_KEY}`
    ) {
      response = {
        status: 401,
        body: {
          errors: [],
          message: "Invalid token.",
          status: 401,
        },
      };
    } else {
      response = answer(url);
    }

    const bodyText: string =
      response.body === undefined ? "" : JSON.stringify(response.body);

    if (
      !request.acceptAnyStatus &&
      (response.status < 200 || response.status >= 300)
    ) {
      throw new BadDataException(
        `Data source responded with HTTP ${response.status}: ${bodyText.substring(0, 500)}`,
      );
    }

    return {
      statusCode: response.status,
      bodyText,
      bodyJson: response.body,
      headers: response.headers || {},
    };
  };

  return {
    transport,
    requests,
    state,
    fault: (
      pathPrefix: string,
      answers: Array<FakeEsperAnswer | "throw">,
    ): void => {
      faults.push({ prefix: pathPrefix, answers: [...answers] });
    },
    requestsTo: (pathPrefix: string): Array<FakeEsperRequest> => {
      return requests.filter((request: FakeEsperRequest): boolean => {
        return request.path.startsWith(pathPrefix);
      });
    },
  };
}

export interface TestClock {
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  advance: (milliseconds: number) => void;
  sleeps: Array<number>;
}

// A clock a test moves: a sleep moves it by what was asked, at once.
export function createTestClock(start: Date): TestClock {
  let current: number = start.getTime();
  const sleeps: Array<number> = [];

  return {
    now: (): Date => {
      return new Date(current);
    },
    sleep: async (milliseconds: number): Promise<void> => {
      sleeps.push(milliseconds);
      current += Math.max(0, milliseconds);
    },
    advance: (milliseconds: number): void => {
      current += milliseconds;
    },
    sleeps,
  };
}
