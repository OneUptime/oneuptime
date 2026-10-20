import DataSourceEgressGuard, {
  PinnedAgents,
} from "../../../../../Server/Utils/DataSource/EgressGuard";
import ExternalCalendarFetch, {
  EXTERNAL_CALENDAR_ACCEPT_HEADER,
  ExternalCalendarAddressGuard,
  ExternalCalendarFetchResult,
  ExternalCalendarHttpRequest,
  ExternalCalendarHttpResponse,
  ExternalCalendarTransport,
} from "../../../../../Server/Utils/ScheduledMaintenance/ExternalCalendar/ExternalCalendarFetch";
import EgressGuardException, {
  EgressFailureReason,
} from "../../../../../Types/Exception/EgressGuardException";
import {
  EXTERNAL_CALENDAR_MAX_BYTES,
  EXTERNAL_CALENDAR_MAX_REDIRECTS,
  ExternalCalendarReadError,
} from "../../../../../Types/ScheduledMaintenance/ExternalCalendar";
import { GOOGLE_HOLIDAYS_CALENDAR } from "./ExternalCalendarFixtures";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";
import zlib from "zlib";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * Reading a calendar link (ExternalCalendarFetch): every address - the
 * link's and every redirect's - checked and pinned by the egress guard
 * before anything is sent to it, the body cut off past its size, the whole
 * read cut off past its time, and what failed answered as a reason that
 * never names the link.
 *
 * The first half drives the logic with a guard and a transport of its own;
 * the second reads a real HTTP server on this machine with the real axios
 * transport (the guard pins it to 127.0.0.1, which the real guard refuses);
 * the third asks the real guard about addresses no link may reach.
 */

const SECRET_LINK: string =
  "https://calendar.example.com/private-3f8a9c1d7e/basic.ics";

function pinned(url: string): { url: URL } & PinnedAgents {
  return {
    url: new URL(url),
    ...DataSourceEgressGuard.createPinnedAgents([
      { address: "127.0.0.1", family: 4 },
    ]),
  };
}

// A guard that lets every address through, recording each it was asked about.
function recordingGuard(asked: Array<string>): ExternalCalendarAddressGuard {
  return async (url: string): Promise<{ url: URL } & PinnedAgents> => {
    asked.push(url);
    return pinned(url);
  };
}

function respond(
  statusCode: number,
  body: string = "",
  headers: Record<string, string> = {},
): ExternalCalendarHttpResponse {
  return { statusCode: statusCode, body: body, headers: headers };
}

// A transport that answers each request with the next response, recording it.
function scriptedTransport(
  responses: Array<ExternalCalendarHttpResponse | Error>,
  requests: Array<ExternalCalendarHttpRequest>,
): ExternalCalendarTransport {
  return async (
    request: ExternalCalendarHttpRequest,
  ): Promise<ExternalCalendarHttpResponse> => {
    requests.push(request);
    const next: ExternalCalendarHttpResponse | Error | undefined =
      responses.shift();

    if (!next) {
      throw new Error("No more responses");
    }

    if (next instanceof Error) {
      throw next;
    }

    return next;
  };
}

describe("a read that works", () => {
  test("answers the body, asking for a calendar as OneUptime, over the pinned agents", async () => {
    const requests: Array<ExternalCalendarHttpRequest> = [];
    const asked: Array<string> = [];

    const result: ExternalCalendarFetchResult =
      await ExternalCalendarFetch.fetch(SECRET_LINK, {
        guard: recordingGuard(asked),
        transport: scriptedTransport(
          [respond(200, GOOGLE_HOLIDAYS_CALENDAR)],
          requests,
        ),
      });

    expect(result).toEqual({ ok: true, body: GOOGLE_HOLIDAYS_CALENDAR });
    expect(asked).toEqual([SECRET_LINK]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(SECRET_LINK);
    expect(requests[0]!.headers["Accept"]).toBe(EXTERNAL_CALENDAR_ACCEPT_HEADER);
    expect(requests[0]!.headers["User-Agent"]).toMatch(/^OneUptime/);
    expect(requests[0]!.maxBytes).toBe(EXTERNAL_CALENDAR_MAX_BYTES);
    expect(EXTERNAL_CALENDAR_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  test("follows a redirect only after checking where it points, relative ones read against the address that answered", async () => {
    const requests: Array<ExternalCalendarHttpRequest> = [];
    const asked: Array<string> = [];

    const result: ExternalCalendarFetchResult =
      await ExternalCalendarFetch.fetch(SECRET_LINK, {
        guard: recordingGuard(asked),
        transport: scriptedTransport(
          [
            respond(301, "", { location: "/moved/basic.ics#ignored" }),
            respond(302, "", {
              location: "https://cdn.example.net/calendars/basic.ics",
            }),
            respond(200, GOOGLE_HOLIDAYS_CALENDAR),
          ],
          requests,
        ),
      });

    expect(result.ok).toBe(true);
    expect(asked).toEqual([
      SECRET_LINK,
      "https://calendar.example.com/moved/basic.ics",
      "https://cdn.example.net/calendars/basic.ics",
    ]);
  });
});

describe("a read that fails says why, without the link", () => {
  test.each([
    [404, ExternalCalendarReadError.NotFound],
    [410, ExternalCalendarReadError.NotFound],
    [401, ExternalCalendarReadError.AccessDenied],
    [403, ExternalCalendarReadError.AccessDenied],
    [400, ExternalCalendarReadError.ServerError],
    [429, ExternalCalendarReadError.ServerError],
    [500, ExternalCalendarReadError.ServerError],
    [503, ExternalCalendarReadError.ServerError],
  ])(
    "an answer of %i is %s, with its status",
    async (status: number, error: ExternalCalendarReadError) => {
      const result: ExternalCalendarFetchResult =
        await ExternalCalendarFetch.fetch(SECRET_LINK, {
          guard: recordingGuard([]),
          transport: scriptedTransport(
            [respond(status, `<html>${SECRET_LINK} is not here</html>`)],
            [],
          ),
        });

      expect(result).toEqual({ ok: false, error: error, httpStatus: status });
      expect(JSON.stringify(result)).not.toContain("private-3f8a9c1d7e");
    },
  );

  test("more redirects than it follows", async () => {
    const responses: Array<ExternalCalendarHttpResponse> = [];

    for (let index: number = 0; index <= EXTERNAL_CALENDAR_MAX_REDIRECTS; index++) {
      responses.push(respond(302, "", { location: `/hop-${index}.ics` }));
    }

    const requests: Array<ExternalCalendarHttpRequest> = [];

    const result: ExternalCalendarFetchResult =
      await ExternalCalendarFetch.fetch(SECRET_LINK, {
        guard: recordingGuard([]),
        transport: scriptedTransport(responses, requests),
      });

    expect(EXTERNAL_CALENDAR_MAX_REDIRECTS).toBe(3);
    expect(result).toEqual({
      ok: false,
      error: ExternalCalendarReadError.TooManyRedirects,
      httpStatus: null,
    });
    expect(requests).toHaveLength(EXTERNAL_CALENDAR_MAX_REDIRECTS + 1);
  });

  test.each([
    ["no Location", {}],
    ["a Location that is not http(s)", { location: "file:///etc/passwd" }],
    ["a Location with credentials", { location: "https://user:pass@example.com/a.ics" }],
    ["a Location that is not an address", { location: "http://" }],
  ])(
    "a redirect with %s is not followed",
    async (_name: string, headers: Record<string, string>) => {
      const result: ExternalCalendarFetchResult =
        await ExternalCalendarFetch.fetch(SECRET_LINK, {
          guard: recordingGuard([]),
          transport: scriptedTransport([respond(302, "", headers)], []),
        });

      expect(result).toEqual({
        ok: false,
        error: ExternalCalendarReadError.ServerError,
        httpStatus: 302,
      });
    },
  );

  test.each([
    [EgressFailureReason.AddressBlocked, ExternalCalendarReadError.NotAllowed],
    [EgressFailureReason.InvalidTarget, ExternalCalendarReadError.NotAllowed],
    [EgressFailureReason.ResolutionFailed, ExternalCalendarReadError.Unreachable],
    /*
     * Where the guard keeps its reason back (OneUptime Cloud), a link to an
     * internal name and one to a name that does not exist read the same.
     */
    [EgressFailureReason.Unreachable, ExternalCalendarReadError.Unreachable],
  ])(
    "an address the guard refuses for %s is %s, and nothing is sent to it",
    async (reason: EgressFailureReason, error: ExternalCalendarReadError) => {
      const requests: Array<ExternalCalendarHttpRequest> = [];

      const result: ExternalCalendarFetchResult =
        await ExternalCalendarFetch.fetch(SECRET_LINK, {
          guard: async (): Promise<{ url: URL } & PinnedAgents> => {
            throw new EgressGuardException("refused", reason);
          },
          transport: scriptedTransport([respond(200, "never")], requests),
        });

      expect(result).toEqual({ ok: false, error: error, httpStatus: null });
      expect(requests).toHaveLength(0);
    },
  );

  test("a redirect to an address the guard refuses is not followed", async () => {
    const requests: Array<ExternalCalendarHttpRequest> = [];

    const result: ExternalCalendarFetchResult =
      await ExternalCalendarFetch.fetch(SECRET_LINK, {
        guard: async (url: string): Promise<{ url: URL } & PinnedAgents> => {
          if (url.startsWith("http://169.254.169.254")) {
            throw new EgressGuardException(
              "metadata",
              EgressFailureReason.AddressBlocked,
            );
          }

          return pinned(url);
        },
        transport: scriptedTransport(
          [
            respond(302, "", {
              location: "http://169.254.169.254/latest/meta-data/",
            }),
            respond(200, "secrets"),
          ],
          requests,
        ),
      });

    expect(result).toEqual({
      ok: false,
      error: ExternalCalendarReadError.NotAllowed,
      httpStatus: null,
    });
    expect(requests).toHaveLength(1);
  });

  test("a body larger than the limit is too large", async () => {
    const result: ExternalCalendarFetchResult =
      await ExternalCalendarFetch.fetch(SECRET_LINK, {
        guard: recordingGuard([]),
        maxBytes: 10,
        transport: scriptedTransport([respond(200, "BEGIN:VCALENDAR")], []),
      });

    expect(result).toEqual({
      ok: false,
      error: ExternalCalendarReadError.TooLarge,
      httpStatus: null,
    });
  });

  test.each([
    [
      "axios's size limit",
      Object.assign(new Error("maxContentLength size of 5242880 exceeded"), {
        code: "ERR_BAD_RESPONSE",
      }),
      ExternalCalendarReadError.TooLarge,
    ],
    [
      "a timeout",
      Object.assign(new Error("timeout of 20000ms exceeded"), {
        code: "ECONNABORTED",
      }),
      ExternalCalendarReadError.Timeout,
    ],
    [
      "a refused connection",
      Object.assign(new Error("connect ECONNREFUSED 203.0.113.5:443"), {
        code: "ECONNREFUSED",
      }),
      ExternalCalendarReadError.Unreachable,
    ],
    [
      "a host that does not exist",
      Object.assign(new Error("getaddrinfo ENOTFOUND calendar.invalid"), {
        code: "ENOTFOUND",
      }),
      ExternalCalendarReadError.Unreachable,
    ],
  ])(
    "a transport error from %s",
    async (
      _name: string,
      error: Error,
      expected: ExternalCalendarReadError,
    ) => {
      const result: ExternalCalendarFetchResult =
        await ExternalCalendarFetch.fetch(SECRET_LINK, {
          guard: recordingGuard([]),
          transport: scriptedTransport([error], []),
        });

      expect(result).toEqual({ ok: false, error: expected, httpStatus: null });
    },
  );

  test("one deadline covers the whole read, redirects included", async () => {
    const result: ExternalCalendarFetchResult =
      await ExternalCalendarFetch.fetch(SECRET_LINK, {
        guard: recordingGuard([]),
        timeoutInMs: 300,
        transport: async (
          request: ExternalCalendarHttpRequest,
        ): Promise<ExternalCalendarHttpResponse> => {
          // Each hop is quick, but they never end.
          await new Promise((resolve: (value: unknown) => void) => {
            setTimeout(resolve, 120);
          });

          if (request.signal.aborted) {
            throw Object.assign(new Error("canceled"), {
              code: "ERR_CANCELED",
            });
          }

          return respond(302, "", { location: `/next-${Date.now()}.ics` });
        },
      });

    expect(result).toEqual({
      ok: false,
      error: ExternalCalendarReadError.Timeout,
      httpStatus: null,
    });
  });
});

describe("a real HTTP server on this machine", () => {
  let server: http.Server;
  let port: number;
  let slowResponses: Array<http.ServerResponse> = [];

  const handler: http.RequestListener = (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): void => {
    const path: string = request.url || "/";

    if (path === "/calendar.ics") {
      response.writeHead(200, { "Content-Type": "text/calendar" });
      response.end(GOOGLE_HOLIDAYS_CALENDAR);
      return;
    }

    if (path === "/compressed.ics") {
      response.writeHead(200, {
        "Content-Type": "text/calendar",
        "Content-Encoding": "gzip",
      });
      response.end(zlib.gzipSync(GOOGLE_HOLIDAYS_CALENDAR));
      return;
    }

    if (path === "/huge.ics") {
      response.writeHead(200, { "Content-Type": "text/calendar" });
      response.end("X".repeat(64 * 1024));
      return;
    }

    if (path === "/slow.ics") {
      // A byte every 100 ms: an idle timeout never fires on this.
      response.writeHead(200, { "Content-Type": "text/calendar" });
      slowResponses.push(response);
      const timer: NodeJS.Timeout = setInterval(() => {
        if (response.writableEnded || response.destroyed) {
          clearInterval(timer);
          return;
        }

        response.write("B");
      }, 100);
      response.on("close", () => {
        clearInterval(timer);
      });
      return;
    }

    if (path === "/redirect") {
      response.writeHead(302, { Location: "/calendar.ics" });
      response.end();
      return;
    }

    if (path === "/loop") {
      response.writeHead(302, { Location: "/loop" });
      response.end();
      return;
    }

    if (path === "/to-metadata") {
      response.writeHead(302, {
        Location: "http://169.254.169.254/latest/meta-data/",
      });
      response.end();
      return;
    }

    response.writeHead(404);
    response.end("not here");
  };

  beforeAll(async () => {
    server = http.createServer(handler);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterEach(() => {
    for (const response of slowResponses) {
      response.destroy();
    }

    slowResponses = [];
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  /*
   * The real guard refuses 127.0.0.1 (loopback, in every deployment), so
   * this server is reached through a guard that pins every address to it:
   * what is under test is the transport.
   */
  function read(
    path: string,
    options: { maxBytes?: number; timeoutInMs?: number } = {},
  ): Promise<ExternalCalendarFetchResult> {
    return ExternalCalendarFetch.fetch(`http://127.0.0.1:${port}${path}`, {
      guard: async (url: string): Promise<{ url: URL } & PinnedAgents> => {
        return pinned(url);
      },
      ...options,
    });
  }

  test("reads a calendar", async () => {
    expect(await read("/calendar.ics")).toEqual({
      ok: true,
      body: GOOGLE_HOLIDAYS_CALENDAR,
    });
  });

  test("reads a compressed calendar", async () => {
    expect(await read("/compressed.ics")).toEqual({
      ok: true,
      body: GOOGLE_HOLIDAYS_CALENDAR,
    });
  });

  test("stops reading a body past its size", async () => {
    expect(await read("/huge.ics", { maxBytes: 4096 })).toEqual({
      ok: false,
      error: ExternalCalendarReadError.TooLarge,
      httpStatus: null,
    });
  });

  test("stops a server that answers a byte at a time, at the deadline", async () => {
    const startedAt: number = Date.now();

    expect(await read("/slow.ics", { timeoutInMs: 800 })).toEqual({
      ok: false,
      error: ExternalCalendarReadError.Timeout,
      httpStatus: null,
    });

    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  test("follows a redirect", async () => {
    expect(await read("/redirect")).toEqual({
      ok: true,
      body: GOOGLE_HOLIDAYS_CALENDAR,
    });
  });

  test("gives up on a redirect loop", async () => {
    expect(await read("/loop")).toEqual({
      ok: false,
      error: ExternalCalendarReadError.TooManyRedirects,
      httpStatus: null,
    });
  });

  test("answers a missing calendar as not found", async () => {
    expect(await read("/missing.ics")).toEqual({
      ok: false,
      error: ExternalCalendarReadError.NotFound,
      httpStatus: 404,
    });
  });

  test("a redirect to the cloud metadata address is checked by the real guard, and refused", async () => {
    const reached: Array<string> = [];

    const result: ExternalCalendarFetchResult =
      await ExternalCalendarFetch.fetch(
        `http://127.0.0.1:${port}/to-metadata`,
        {
          guard: async (url: string): Promise<{ url: URL } & PinnedAgents> => {
            reached.push(url);

            // This machine's server is let through; every other address meets the real guard.
            if (url.startsWith(`http://127.0.0.1:${port}/`)) {
              return pinned(url);
            }

            return await ExternalCalendarFetch.defaultGuard(url);
          },
        },
      );

    expect(result.ok).toBe(false);
    expect(
      result.ok === false &&
        (result.error === ExternalCalendarReadError.NotAllowed ||
          result.error === ExternalCalendarReadError.Unreachable),
    ).toBe(true);
    expect(reached).toEqual([
      `http://127.0.0.1:${port}/to-metadata`,
      "http://169.254.169.254/latest/meta-data/",
    ]);
  });

  test("a port nothing listens on is unreachable", async () => {
    const closed: http.Server = http.createServer();

    await new Promise<void>((resolve: () => void) => {
      closed.listen(0, "127.0.0.1", resolve);
    });

    const closedPort: number = (closed.address() as AddressInfo).port;

    await new Promise<void>((resolve: () => void) => {
      closed.close(() => {
        resolve();
      });
    });

    expect(
      await ExternalCalendarFetch.fetch(`http://127.0.0.1:${closedPort}/a.ics`, {
        guard: async (url: string): Promise<{ url: URL } & PinnedAgents> => {
          return pinned(url);
        },
      }),
    ).toEqual({
      ok: false,
      error: ExternalCalendarReadError.Unreachable,
      httpStatus: null,
    });
  });
});

describe("the real egress guard", () => {
  const billingBefore: string | undefined = process.env["BILLING_ENABLED"];

  beforeEach(() => {
    delete process.env["BILLING_ENABLED"];
  });

  afterEach(() => {
    if (billingBefore === undefined) {
      delete process.env["BILLING_ENABLED"];
    } else {
      process.env["BILLING_ENABLED"] = billingBefore;
    }
  });

  test.each([
    ["loopback", "http://127.0.0.1/calendar.ics"],
    ["loopback over IPv6", "http://[::1]/calendar.ics"],
    ["the cloud metadata address", "http://169.254.169.254/latest/meta-data/"],
    ["the unspecified address", "http://0.0.0.0/calendar.ics"],
    ["localhost", "http://localhost/calendar.ics"],
  ])(
    "refuses %s in every deployment, before anything is sent",
    async (_name: string, link: string) => {
      const requests: Array<ExternalCalendarHttpRequest> = [];

      for (const billing of [undefined, "true"]) {
        if (billing) {
          process.env["BILLING_ENABLED"] = billing;
        } else {
          delete process.env["BILLING_ENABLED"];
        }

        const result: ExternalCalendarFetchResult =
          await ExternalCalendarFetch.fetch(link, {
            transport: scriptedTransport([respond(200, "never")], requests),
          });

        expect(result.ok).toBe(false);
        expect(
          result.ok === false &&
            (result.error === ExternalCalendarReadError.NotAllowed ||
              result.error === ExternalCalendarReadError.Unreachable),
        ).toBe(true);
      }

      expect(requests).toHaveLength(0);
    },
  );

  test("refuses a private network address on OneUptime Cloud", async () => {
    process.env["BILLING_ENABLED"] = "true";
    const requests: Array<ExternalCalendarHttpRequest> = [];

    const result: ExternalCalendarFetchResult =
      await ExternalCalendarFetch.fetch("http://10.20.30.40/exchange.ics", {
        transport: scriptedTransport([respond(200, "never")], requests),
      });

    expect(result.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  test("lets a self-hosted OneUptime read a calendar on its own network", async () => {
    const requests: Array<ExternalCalendarHttpRequest> = [];

    const result: ExternalCalendarFetchResult =
      await ExternalCalendarFetch.fetch("http://10.20.30.40/exchange.ics", {
        transport: scriptedTransport(
          [respond(200, GOOGLE_HOLIDAYS_CALENDAR)],
          requests,
        ),
      });

    expect(result).toEqual({ ok: true, body: GOOGLE_HOLIDAYS_CALENDAR });
    expect(requests).toHaveLength(1);
  });
});
