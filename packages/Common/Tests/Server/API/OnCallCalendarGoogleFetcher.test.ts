import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * The on-call calendar feeds as Google Calendar's own fetcher meets them.
 *
 * A customer reported that adding an on-call schedule to Google Calendar did
 * not work: the "Google Calendar" button showed an error, and pasting the
 * feed URL into Other calendars > From URL added a calendar that never showed
 * anything. Two causes, both reproduced here before they were fixed:
 *
 * - The button's link (OnCallCalendarFeedUrls / CalendarSubscriptionLinks,
 *   tested in their own suites) put the https:// address in Google's `cid`.
 * - Every feed URL on OneUptime Cloud answered 301 to ITSELF. The feed routes
 *   redirected to https whenever HTTP_PROTOCOL=https and PROVISION_SSL=true and
 *   the forwarded scheme said http. On OneUptime Cloud TLS is terminated in
 *   front of OneUptime's own Nginx, which then reports `X-Forwarded-Proto:
 *   http` on every request, so the redirect target was the very URL the
 *   fetcher had asked for: an endless loop, and Google - like every other
 *   calendar app - gave up with nothing to show. (Confirmed against the live
 *   service on 2026-10-08: GET https://oneuptime.com/api/on-call-calendar/
 *   user/<token>/shifts.ics -> 301 Location: the same URL.)
 *
 * Google fetches from its own servers with no cookie, no session, no API key
 * and no tenant header; the 43-character token in the path is all it has. So
 * this suite mounts the REAL router on a real Express app and sends what
 * Google sends, through the proxy headers each deployment produces, following
 * redirects the way a fetcher does. It asserts the whole answer: 200 at the
 * first hop, text/calendar; charset=utf-8, a body that a strict RFC 5545
 * reader accepts, HEAD answered like GET, and the right answer for a wrong,
 * rotated-out, expired, disabled or former member's link.
 *
 * Only the database services, the membership read and the renderer's I/O are
 * stubbed; the renderer's bodies are real serializations of a realistic
 * roster (OnCallCalendarFeedUtil.render).
 */

type EnvOverrides = {
  disableFeed: boolean;
  httpProtocol: string;
  host: string;
  trustedProxyHops: number;
  provisionSsl: boolean;
};

type EnvMockGlobal = typeof globalThis & {
  __oneuptimeGoogleFetcherEnv: EnvOverrides;
};

/*
 * OneUptime Cloud: https, PROVISION_SSL on (it provisions certificates for
 * custom domains), one trusted proxy hop - and TLS for the main host ended in
 * front of Nginx.
 */
const CLOUD_ENV: EnvOverrides = {
  disableFeed: false,
  httpProtocol: "https://",
  host: "oneuptime.com",
  trustedProxyHops: 1,
  provisionSsl: true,
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: EnvMockGlobal = globalThis as EnvMockGlobal;

  mockGlobal.__oneuptimeGoogleFetcherEnv = {
    disableFeed: false,
    httpProtocol: "https://",
    host: "oneuptime.com",
    trustedProxyHops: 1,
    provisionSsl: true,
  };

  const live: (key: keyof EnvOverrides) => () => unknown = (
    key: keyof EnvOverrides,
  ): (() => unknown) => {
    return (): unknown => {
      return mockGlobal.__oneuptimeGoogleFetcherEnv[key];
    };
  };

  for (const [name, key] of [
    ["DisableOnCallCalendarFeed", "disableFeed"],
    ["HttpProtocol", "httpProtocol"],
    ["Host", "host"],
    ["TrustedProxyHops", "trustedProxyHops"],
    ["ProvisionSsl", "provisionSsl"],
  ] as Array<[string, keyof EnvOverrides]>) {
    Object.defineProperty(mocked, name, {
      configurable: true,
      enumerable: true,
      get: live(key),
    });
  }

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return false;
    },
  });

  return mocked;
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: (): Record<string, string> => {
      return {};
    },
  };
});

/* No Redis: the real rate limiter is in front of every request, failing open. */
jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(() => {
        return null;
      }),
      isConnected: jest.fn(() => {
        return false;
      }),
    },
  };
});

/*
 * The session routes share the router; a calendar fetcher never reaches
 * them. Replaced so a stray call would be visible rather than half-work.
 */
jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: async (
        _req: unknown,
        res: { status: (code: number) => { send: (body: unknown) => void } },
      ): Promise<void> => {
        res.status(418).send({ message: "session middleware reached" });
      },
      requireUserAuthentication: async (
        _req: unknown,
        res: { status: (code: number) => { send: (body: unknown) => void } },
      ): Promise<void> => {
        res.status(418).send({ message: "session middleware reached" });
      },
    },
  };
});

jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import OnCallCalendarAPI from "../../../Server/API/OnCallCalendarAPI";
import OnCallDutyPolicyScheduleCalendarFeedService from "../../../Server/Services/OnCallDutyPolicyScheduleCalendarFeedService";
import ProjectOnCallCalendarFeedService from "../../../Server/Services/ProjectOnCallCalendarFeedService";
import UserOnCallCalendarFeedService from "../../../Server/Services/UserOnCallCalendarFeedService";
import CalendarFeedToken from "../../../Server/Utils/OnCall/CalendarFeedToken";
import OnCallCalendarFeedRenderer, {
  FEED_DISABLED_REASON,
  FeedRenderOutcome,
  FeedRenderRequest,
  FeedRenderStatus,
  NOT_A_PROJECT_MEMBER_REASON,
  TOKEN_ROTATED_REASON,
} from "../../../Server/Utils/OnCall/OnCallCalendarFeedRenderer";
import OnCallCalendarFeedUrls, {
  FeedUrls,
} from "../../../Server/Utils/OnCall/OnCallCalendarFeedUrls";
import Response from "../../../Server/Utils/Response";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import CalendarSubscriptionLinks from "../../../Types/Calendar/CalendarSubscriptionLinks";
import OneUptimeDate from "../../../Types/Date";
import Exception from "../../../Types/Exception/Exception";
import ObjectID from "../../../Types/ObjectID";
import { MaterializedShift } from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import OnCallCalendarFeedUtil, {
  FeedRenderResult,
  OnCallCalendarFeedKind,
} from "../../../Types/OnCallDutyPolicy/OnCallCalendarFeedUtil";
import {
  ParsedEvent,
  checkICalendarConformance,
  readCalendarText,
  readEvents,
} from "../../Types/Calendar/ICalendarConformance";
import {
  DASHBOARD_URL,
  at,
  shift,
  tzInstant,
} from "../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import express from "express";
import http from "http";
import { AddressInfo } from "net";

const NOW: Date = at("2026-09-01T12:00:00Z");

const GOOGLE_USER_AGENT: string = "Google-Calendar-Importer";

const MAX_REDIRECTS: number = 5;

const ALL_KINDS: Array<OnCallCalendarFeedKind> = [
  OnCallCalendarFeedKind.Personal,
  OnCallCalendarFeedKind.Schedule,
  OnCallCalendarFeedKind.Project,
];

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface FetchResult extends HttpResult {
  // Every status on the way, the final one last.
  hops: Array<number>;
  locations: Array<string>;
}

interface FeedRow {
  id: ObjectID;
  projectId: ObjectID;
  userId?: ObjectID | undefined;
  onCallDutyPolicyScheduleId?: ObjectID | undefined;
  tokenHash: string;
  previousTokenHash?: string | undefined;
  previousTokenExpiresAt?: Date | undefined;
  isEnabled: boolean;
  includeCoveringShifts?: boolean | undefined;
  includeCoverageGaps?: boolean | undefined;
  minimumGapMinutes?: number | undefined;
  pastDays: number;
  futureDays: number;
  fetchCount: number;
  lastFetchedAt?: Date | undefined;
}

// -- Environment -----------------------------------------------------------

function setEnv(overrides: Partial<EnvOverrides>): void {
  const mockGlobal: EnvMockGlobal = globalThis as EnvMockGlobal;

  mockGlobal.__oneuptimeGoogleFetcherEnv = {
    ...mockGlobal.__oneuptimeGoogleFetcherEnv,
    ...overrides,
  };
}

// -- A realistic roster, really serialized ----------------------------------

function roster(): Array<MaterializedShift> {
  return [
    shift({
      start: tzInstant("2026-09-01 09:00", "Europe/Paris"),
      end: tzInstant("2026-09-01 17:00", "Europe/Paris"),
      scheduleName: "Astreinte, équipe; Paris",
      scheduleTimezone: "Europe/Paris",
      userName: "Élodie Dupont",
    }),
    shift({
      start: tzInstant("2026-09-01 22:00", "Europe/Paris"),
      end: tzInstant("2026-09-02 06:00", "Europe/Paris"),
      scheduleName: "Astreinte, équipe; Paris",
      scheduleTimezone: "Europe/Paris",
      userId: "user-b",
      userName: "Jean \\ Martin",
    }),
    shift({
      start: tzInstant("2026-09-05 00:00", "Europe/Paris"),
      end: tzInstant("2026-09-06 00:00", "Europe/Paris"),
      scheduleName: "Astreinte, équipe; Paris",
      scheduleTimezone: "Europe/Paris",
      userId: "user-c",
      userName: "Zoë 📟 Laurent",
    }),
  ];
}

function renderedOutcome(request: FeedRenderRequest): FeedRenderOutcome {
  const rendered: FeedRenderResult = OnCallCalendarFeedUtil.render({
    kind: request.kind,
    shifts: roster(),
    dashboardUrl: DASHBOARD_URL,
    scheduleName: "Astreinte, équipe; Paris",
    projectName: "Acme",
    calendarTimezone: "Europe/Paris",
  });

  return {
    status: FeedRenderStatus.Rendered,
    kind: request.kind,
    body: rendered.body,
    etag: Response.getCalendarETag(rendered.body),
    lastModified: NOW,
    stale: false,
    truncated: false,
    eventCount: rendered.eventCount,
    cacheHit: false,
    reason: null,
    retryAfterSeconds: null,
  };
}

// -- Rows -------------------------------------------------------------------

let projectId: ObjectID;
let userId: ObjectID;
let rows: Record<OnCallCalendarFeedKind, FeedRow>;
let tokens: Record<OnCallCalendarFeedKind, string>;

function freshRow(kind: OnCallCalendarFeedKind, token: string): FeedRow {
  const row: FeedRow = {
    id: ObjectID.generate(),
    projectId,
    tokenHash: CalendarFeedToken.hash(token),
    isEnabled: true,
    pastDays: 2,
    futureDays: 90,
    fetchCount: 0,
  };

  if (kind === OnCallCalendarFeedKind.Personal) {
    row.userId = userId;
    row.includeCoveringShifts = true;
  } else {
    row.includeCoverageGaps = false;
    row.minimumGapMinutes = 60;
  }

  if (kind === OnCallCalendarFeedKind.Schedule) {
    row.onCallDutyPolicyScheduleId = ObjectID.generate();
  }

  return row;
}

/*
 * findOneBy over one row, answering the two public lookups ({ tokenHash } then
 * { previousTokenHash }) and handing back only the selected columns, as
 * TypeORM does.
 */
function lookupFor(
  kind: OnCallCalendarFeedKind,
): (args: {
  query: Record<string, unknown>;
  select?: Record<string, unknown>;
}) => Promise<FeedRow | null> {
  return async (args: {
    query: Record<string, unknown>;
    select?: Record<string, unknown>;
  }): Promise<FeedRow | null> => {
    const row: FeedRow = rows[kind];

    const matches: boolean =
      (typeof args.query["tokenHash"] === "string" &&
        args.query["tokenHash"] === row.tokenHash) ||
      (typeof args.query["previousTokenHash"] === "string" &&
        args.query["previousTokenHash"] === row.previousTokenHash);

    if (!matches) {
      return null;
    }

    if (!args.select) {
      return row;
    }

    const projected: Record<string, unknown> = {};

    for (const [column, wanted] of Object.entries(args.select)) {
      if (wanted) {
        const key: string = column === "_id" ? "id" : column;
        projected[key] = (row as unknown as Record<string, unknown>)[key];
      }
    }

    return projected as unknown as FeedRow;
  };
}

// -- The fetcher --------------------------------------------------------------

let server: http.Server;
let baseUrl: string;

function send(
  url: string,
  init: { method: string; headers: Record<string, string> },
): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (error: Error) => void) => {
      const request: http.ClientRequest = http.request(
        url,
        { method: init.method, headers: init.headers },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
          response.on("error", reject);
        },
      );

      request.on("error", reject);
      request.end();
    },
  );
}

/*
 * A GET the way Google's importer sends it: no cookie, no Authorization, no
 * API key, no tenant header, its own User-Agent - and whatever the proxies in
 * front of the app add. Redirects are followed up to MAX_REDIRECTS; a
 * Location on the instance's own host (the address calendar apps resolve to
 * this server) is fetched from the test server, the way DNS and the edge
 * proxy would route it.
 */
async function fetchLikeGoogle(
  path: string,
  options?: {
    method?: string | undefined;
    proxyHeaders?: Record<string, string> | undefined;
    extraHeaders?: Record<string, string> | undefined;
  },
): Promise<FetchResult> {
  const hops: Array<number> = [];
  const locations: Array<string> = [];

  let url: string = `${baseUrl}${path}`;

  for (let hop: number = 0; hop <= MAX_REDIRECTS; hop++) {
    const result: HttpResult = await send(url, {
      method: options?.method || "GET",
      headers: {
        "User-Agent": GOOGLE_USER_AGENT,
        Accept: "*/*",
        ...(options?.proxyHeaders || {
          "X-Forwarded-Proto": "http",
          "X-Forwarded-For": "66.249.66.1",
          "X-Real-IP": "66.249.66.1",
        }),
        ...(options?.extraHeaders || {}),
      },
    });

    hops.push(result.status);

    const location: string | undefined = result.headers.location;

    if (result.status < 300 || result.status >= 400 || !location) {
      return { ...result, hops, locations };
    }

    locations.push(location);

    const next: URL = new URL(location, url);

    url = `${baseUrl}${next.pathname}${next.search}`;
  }

  return {
    status: -1,
    headers: {},
    body: "too many redirects",
    hops,
    locations,
  };
}

function feedPath(kind: OnCallCalendarFeedKind, token: string): string {
  return OnCallCalendarFeedUrls.getFeedPath(kind, token);
}

// -- Spies --------------------------------------------------------------------

let renderSpy: jest.SpyInstance;
let membershipSpy: jest.SpyInstance;
let updateSpies: Array<jest.SpyInstance>;

beforeAll(async () => {
  const app: express.Express = express();

  /* The App mounts every custom router under /api, this one included. */
  app.use("/api", OnCallCalendarAPI);

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ): void => {
      const code: number = (err as Exception).code as number;
      const status: number =
        Number.isInteger(code) && code >= 400 && code <= 599 ? code : 500;

      res.status(status).send({ message: (err as Error).message });
    },
  );

  server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  setEnv(CLOUD_ENV);

  projectId = ObjectID.generate();
  userId = ObjectID.generate();

  tokens = {
    [OnCallCalendarFeedKind.Personal]: CalendarFeedToken.mint(),
    [OnCallCalendarFeedKind.Schedule]: CalendarFeedToken.mint(),
    [OnCallCalendarFeedKind.Project]: CalendarFeedToken.mint(),
  };

  rows = {
    [OnCallCalendarFeedKind.Personal]: freshRow(
      OnCallCalendarFeedKind.Personal,
      tokens[OnCallCalendarFeedKind.Personal],
    ),
    [OnCallCalendarFeedKind.Schedule]: freshRow(
      OnCallCalendarFeedKind.Schedule,
      tokens[OnCallCalendarFeedKind.Schedule],
    ),
    [OnCallCalendarFeedKind.Project]: freshRow(
      OnCallCalendarFeedKind.Project,
      tokens[OnCallCalendarFeedKind.Project],
    ),
  };

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

  jest
    .spyOn(UserOnCallCalendarFeedService, "findOneBy")
    .mockImplementation(lookupFor(OnCallCalendarFeedKind.Personal) as never);
  jest
    .spyOn(OnCallDutyPolicyScheduleCalendarFeedService, "findOneBy")
    .mockImplementation(lookupFor(OnCallCalendarFeedKind.Schedule) as never);
  jest
    .spyOn(ProjectOnCallCalendarFeedService, "findOneBy")
    .mockImplementation(lookupFor(OnCallCalendarFeedKind.Project) as never);

  updateSpies = [
    jest
      .spyOn(UserOnCallCalendarFeedService, "updateOneById")
      .mockResolvedValue(undefined as never),
    jest
      .spyOn(OnCallDutyPolicyScheduleCalendarFeedService, "updateOneById")
      .mockResolvedValue(undefined as never),
    jest
      .spyOn(ProjectOnCallCalendarFeedService, "updateOneById")
      .mockResolvedValue(undefined as never),
  ];

  membershipSpy = jest
    .spyOn(ProjectMembership, "isMember")
    .mockResolvedValue(true as never);

  renderSpy = jest
    .spyOn(OnCallCalendarFeedRenderer, "render")
    .mockImplementation((async (
      request: FeedRenderRequest,
    ): Promise<FeedRenderOutcome> => {
      return renderedOutcome(request);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function expectCalendarAnswer(result: FetchResult): void {
  expect(result.hops).toEqual([200]);
  expect(result.status).toBe(200);
  expect(result.headers.location).toBeUndefined();
  expect(result.headers["content-type"]).toBe("text/calendar; charset=utf-8");
}

// -- The regression -------------------------------------------------------------

describe("OneUptime Cloud: TLS ends before Nginx, so every request arrives marked http", () => {
  test.each(ALL_KINDS)(
    "the %s feed is served at the first hop, never redirected to itself",
    async (kind: OnCallCalendarFeedKind) => {
      const result: FetchResult = await fetchLikeGoogle(
        feedPath(kind, tokens[kind]),
      );

      expect(result.locations).toEqual([]);
      expectCalendarAnswer(result);
      expect(checkICalendarConformance(result.body).problems).toEqual([]);
      expect(readEvents(result.body).length).toBe(roster().length);
    },
  );

  test("the URL the settings page hands out is the URL that serves the calendar", async () => {
    const urls: FeedUrls = OnCallCalendarFeedUrls.buildFeedUrls({
      kind: OnCallCalendarFeedKind.Schedule,
      token: tokens[OnCallCalendarFeedKind.Schedule],
    });

    expect(urls.https.startsWith("https://oneuptime.com/api/")).toBe(true);

    const handedOut: URL = new URL(urls.https);
    const result: FetchResult = await fetchLikeGoogle(handedOut.pathname);

    expectCalendarAnswer(result);
  });

  test("what Google's add-by-URL link subscribes to is that same, working URL", async () => {
    const urls: FeedUrls = OnCallCalendarFeedUrls.buildFeedUrls({
      kind: OnCallCalendarFeedKind.Personal,
      token: tokens[OnCallCalendarFeedKind.Personal],
    });

    const address: string | null =
      CalendarSubscriptionLinks.readGoogleCalendarAddress(urls.googleAdd);

    expect(address).toBe(urls.webcal);
    expect(address!.startsWith("webcal://oneuptime.com/api/")).toBe(true);

    // Google fetches a webcal:// address over https.
    const fetched: URL = new URL(address!.replace("webcal://", "https://"));

    expect(fetched.toString()).toBe(urls.https);
    expectCalendarAnswer(await fetchLikeGoogle(fetched.pathname));
  });
});

/*
 * Every topology the shipped Nginx and Helm chart produce, plus the ones
 * operators build in front of them. Whatever the headers say, a feed is
 * never a redirect: the links are built from HOST and HTTP_PROTOCOL, so they
 * already carry the right scheme, and moving plain http to https is the
 * edge proxy's job - one that, unlike the app, can see the scheme the client
 * actually used.
 */
describe("no deployment ever answers a feed with a redirect", () => {
  const protocols: Array<string> = ["https://", "http://"];
  const provisionSslValues: Array<boolean> = [true, false];
  const forwardedProtos: Array<string | null> = ["http", "https", null, "https, http", "http, http"];
  const hopCounts: Array<number> = [0, 1, 2];

  const matrix: Array<[string, boolean, string | null, number]> = [];

  for (const protocol of protocols) {
    for (const provisionSsl of provisionSslValues) {
      for (const forwardedProto of forwardedProtos) {
        for (const hops of hopCounts) {
          matrix.push([protocol, provisionSsl, forwardedProto, hops]);
        }
      }
    }
  }

  test.each(matrix)(
    "HTTP_PROTOCOL=%s PROVISION_SSL=%s X-Forwarded-Proto=%s TRUSTED_PROXY_HOPS=%s",
    async (
      protocol: string,
      provisionSsl: boolean,
      forwardedProto: string | null,
      hops: number,
    ) => {
      setEnv({ httpProtocol: protocol, provisionSsl, trustedProxyHops: hops });

      const proxyHeaders: Record<string, string> = {
        "X-Forwarded-For": "66.249.66.1, 10.0.0.2",
      };

      if (forwardedProto !== null) {
        proxyHeaders["X-Forwarded-Proto"] = forwardedProto;
      }

      for (const kind of ALL_KINDS) {
        const result: FetchResult = await fetchLikeGoogle(
          feedPath(kind, tokens[kind]),
          { proxyHeaders },
        );

        expectCalendarAnswer(result);
      }
    },
  );

  test("a hostile Host header changes nothing about the answer", async () => {
    const result: FetchResult = await fetchLikeGoogle(
      feedPath(
        OnCallCalendarFeedKind.Personal,
        tokens[OnCallCalendarFeedKind.Personal],
      ),
      { extraHeaders: { Host: "evil.example.net" } },
    );

    expectCalendarAnswer(result);
  });

  test("the unknown-token answer is not a redirect either", async () => {
    const result: FetchResult = await fetchLikeGoogle(
      feedPath(OnCallCalendarFeedKind.Schedule, CalendarFeedToken.mint()),
    );

    expect(result.hops).toEqual([404]);
  });
});

describe("what Google's fetcher gets back", () => {
  test.each(ALL_KINDS)(
    "%s: the headers a subscribed calendar needs, and none that would stop it",
    async (kind: OnCallCalendarFeedKind) => {
      const result: FetchResult = await fetchLikeGoogle(
        feedPath(kind, tokens[kind]),
      );

      expectCalendarAnswer(result);
      expect(result.headers["cache-control"]).toBe("private, max-age=300");
      expect(result.headers["etag"]).toBeDefined();
      expect(result.headers["last-modified"]).toBe(NOW.toUTCString());
      expect(result.headers["x-content-type-options"]).toBe("nosniff");
      expect(result.headers["pragma"]).toBeUndefined();
      expect(result.headers["set-cookie"]).toBeUndefined();
      expect(result.headers["www-authenticate"]).toBeUndefined();
      expect(result.headers["warning"]).toBeUndefined();
      expect(Number(result.headers["content-length"])).toBe(
        Buffer.byteLength(result.body, "utf8"),
      );
    },
  );

  test("it needs no session, no API key and no tenant: none is sent, and stray ones are ignored", async () => {
    for (const extraHeaders of [
      {},
      { Cookie: "user-token=expired.jwt.value; sso=1" },
      { Authorization: "Bearer not-a-real-token" },
      { apikey: "" },
      { tenantid: ObjectID.generate().toString() },
    ]) {
      const result: FetchResult = await fetchLikeGoogle(
        feedPath(
          OnCallCalendarFeedKind.Personal,
          tokens[OnCallCalendarFeedKind.Personal],
        ),
        { extraHeaders },
      );

      expectCalendarAnswer(result);
    }
  });

  test("the body is a calendar a strict RFC 5545 reader accepts, with the roster in it", async () => {
    const result: FetchResult = await fetchLikeGoogle(
      feedPath(
        OnCallCalendarFeedKind.Schedule,
        tokens[OnCallCalendarFeedKind.Schedule],
      ),
    );

    const events: Array<ParsedEvent> = readEvents(result.body);

    expect(events.map((event: ParsedEvent) => {
      return event.start.toISOString();
    })).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-01T20:00:00.000Z",
      "2026-09-04T22:00:00.000Z",
    ]);
    expect(events[1]!.end.toISOString()).toBe("2026-09-02T04:00:00.000Z");
    expect(readCalendarText(result.body, "X-WR-CALNAME")).toBeTruthy();
    expect(readCalendarText(result.body, "X-WR-TIMEZONE")).toBe("Europe/Paris");
    expect(
      events.some((event: ParsedEvent) => {
        return event.description.includes("Jean \\ Martin");
      }),
    ).toBe(true);
  });

  test("two fetches a refresh apart carry the same UIDs (the calendar updates in place)", async () => {
    const path: string = feedPath(
      OnCallCalendarFeedKind.Project,
      tokens[OnCallCalendarFeedKind.Project],
    );

    const first: Array<string> = readEvents((await fetchLikeGoogle(path)).body).map(
      (event: ParsedEvent) => {
        return event.uid;
      },
    );
    const second: Array<string> = readEvents((await fetchLikeGoogle(path)).body).map(
      (event: ParsedEvent) => {
        return event.uid;
      },
    );

    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });

  test.each(ALL_KINDS)(
    "%s: HEAD is answered like GET, without the body and without counting as a fetch",
    async (kind: OnCallCalendarFeedKind) => {
      const get: FetchResult = await fetchLikeGoogle(feedPath(kind, tokens[kind]));

      for (const spy of updateSpies) {
        spy.mockClear();
      }

      const head: FetchResult = await fetchLikeGoogle(
        feedPath(kind, tokens[kind]),
        { method: "HEAD" },
      );

      expect(head.hops).toEqual([200]);
      expect(head.body).toBe("");
      for (const name of [
        "content-type",
        "etag",
        "last-modified",
        "cache-control",
        "content-length",
      ]) {
        expect({ name, value: head.headers[name] }).toEqual({
          name,
          value: get.headers[name],
        });
      }

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });

      for (const spy of updateSpies) {
        expect(spy).not.toHaveBeenCalled();
      }
    },
  );

  test("Google's cache-busting ?nocache=1 and the personal ?schedule= filter keep the token path intact", async () => {
    const scheduleId: string = ObjectID.generate().toString();

    const busted: FetchResult = await fetchLikeGoogle(
      `${feedPath(OnCallCalendarFeedKind.Personal, tokens[OnCallCalendarFeedKind.Personal])}?nocache=1`,
    );

    expectCalendarAnswer(busted);

    const filtered: FetchResult = await fetchLikeGoogle(
      `${feedPath(OnCallCalendarFeedKind.Personal, tokens[OnCallCalendarFeedKind.Personal])}?schedule=${scheduleId}&nocache=2`,
    );

    expectCalendarAnswer(filtered);

    const request: FeedRenderRequest = renderSpy.mock.calls[1]?.[0] as FeedRenderRequest;

    expect(
      request.kind === OnCallCalendarFeedKind.Personal
        ? request.scheduleFilterId?.toString()
        : null,
    ).toBe(scheduleId);
  });

  test("the fetch is recorded as Google Calendar's", async () => {
    await fetchLikeGoogle(
      feedPath(
        OnCallCalendarFeedKind.Personal,
        tokens[OnCallCalendarFeedKind.Personal],
      ),
    );

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    const update: { data: Record<string, unknown> } = updateSpies[0]!.mock
      .calls[0]?.[0] as { data: Record<string, unknown> };

    expect(update.data["lastFetchedClient"]).toBe("Google Calendar");
    expect(update.data["fetchCount"]).toBe(1);
  });
});

describe("links that should not, or no longer, show shifts", () => {
  test.each(ALL_KINDS)("%s: a wrong token is a plain 404, not an error page or a redirect", async (kind: OnCallCalendarFeedKind) => {
    for (const path of [
      feedPath(kind, CalendarFeedToken.mint()),
      feedPath(kind, "not-a-token"),
      feedPath(kind, tokens[kind]).replace(".ics", ".txt"),
    ]) {
      const result: FetchResult = await fetchLikeGoogle(path);

      expect({ path, hops: result.hops }).toEqual({ path, hops: [404] });
      expect(result.body).not.toContain(tokens[kind]);
    }

    expect(renderSpy).not.toHaveBeenCalled();
  });

  test.each(ALL_KINDS)(
    "%s: a regenerated (revoked) link inside its grace period is an empty calendar that says so",
    async (kind: OnCallCalendarFeedKind) => {
      const oldToken: string = tokens[kind];
      const newToken: string = CalendarFeedToken.mint();

      rows[kind].previousTokenHash = CalendarFeedToken.hash(oldToken);
      rows[kind].previousTokenExpiresAt = at("2026-09-20T00:00:00Z");
      rows[kind].tokenHash = CalendarFeedToken.hash(newToken);

      const result: FetchResult = await fetchLikeGoogle(feedPath(kind, oldToken));

      expectCalendarAnswer(result);
      expect(
        checkICalendarConformance(result.body, { allowNoComponents: true })
          .problems,
      ).toEqual([]);
      expect(readEvents(result.body, { allowNoComponents: true })).toEqual([]);
      expect(readCalendarText(result.body, "X-WR-CALDESC")).toContain(
        TOKEN_ROTATED_REASON,
      );
      expect(renderSpy).not.toHaveBeenCalled();

      // The new link shows the shifts.
      expectCalendarAnswer(await fetchLikeGoogle(feedPath(kind, newToken)));
    },
  );

  test.each(ALL_KINDS)(
    "%s: a regenerated link past its grace period is 404",
    async (kind: OnCallCalendarFeedKind) => {
      const oldToken: string = tokens[kind];

      rows[kind].previousTokenHash = CalendarFeedToken.hash(oldToken);
      rows[kind].previousTokenExpiresAt = at("2026-08-31T00:00:00Z");
      rows[kind].tokenHash = CalendarFeedToken.hash(CalendarFeedToken.mint());

      expect((await fetchLikeGoogle(feedPath(kind, oldToken))).hops).toEqual([404]);
    },
  );

  test.each(ALL_KINDS)(
    "%s: a disabled link is an empty calendar that says so",
    async (kind: OnCallCalendarFeedKind) => {
      rows[kind].isEnabled = false;

      const result: FetchResult = await fetchLikeGoogle(
        feedPath(kind, tokens[kind]),
      );

      expectCalendarAnswer(result);
      expect(readEvents(result.body, { allowNoComponents: true })).toEqual([]);
      expect(readCalendarText(result.body, "X-WR-CALDESC")).toContain(
        FEED_DISABLED_REASON,
      );
    },
  );

  test("a former member's personal link is an empty calendar that says why, and nothing is rendered", async () => {
    membershipSpy.mockResolvedValue(false as never);

    const result: FetchResult = await fetchLikeGoogle(
      feedPath(
        OnCallCalendarFeedKind.Personal,
        tokens[OnCallCalendarFeedKind.Personal],
      ),
    );

    expectCalendarAnswer(result);
    expect(
      checkICalendarConformance(result.body, { allowNoComponents: true })
        .problems,
    ).toEqual([]);
    expect(readCalendarText(result.body, "X-WR-CALDESC")).toContain(
      NOT_A_PROJECT_MEMBER_REASON,
    );
    expect(renderSpy).not.toHaveBeenCalled();
    expect(String(membershipSpy.mock.calls[0]?.[0]?.userId)).toBe(
      userId.toString(),
    );
  });
});
