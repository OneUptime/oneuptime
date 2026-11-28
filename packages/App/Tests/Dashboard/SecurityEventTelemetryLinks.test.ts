import { beforeAll, describe, expect, test } from "@jest/globals";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Route from "Common/Types/API/Route";
import {
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
} from "Common/Types/SecurityCase/SecurityConnection";
import {
  SECURITY_LOG_ID_ATTRIBUTE,
  SECURITY_LOG_SOURCE_ATTRIBUTE,
} from "Common/Types/SecurityEvent/SecurityLogFormat";
import { SecurityTelemetrySourceKind } from "Common/Types/SecurityEvent/SecurityTelemetrySource";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import type * as LinksModuleType from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventTelemetryLinks";

/*
 * Where a security event leads: the trace of its request (focused on the
 * span that answered it), the exception that request threw, and the log
 * lines it wrote. Each route is the one the explorer already reads, so the
 * reader lands on exactly the request, with their own permissions.
 */

type LinksModule = typeof LinksModuleType;

let Links: LinksModule;

const LOG_ID: string = "0192f1a0-0000-7000-8000-000000000001";
const SERVICE_ID: string = "0192f1a0-0000-7000-8000-0000000000aa";
const TIME: Date = new Date("2026-10-27T06:45:12.000Z");

/*
 * Common/UI/Config reads `window` when it loads, and the route helpers pull
 * it in through RouteMap -> ProjectUtil, so the stub exists before the
 * deferred import (as AIInsightExplorerLinks.test.ts does).
 */
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  Links = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventTelemetryLinks"
  );
});

function event(fields: Partial<SecurityEvent> = {}): SecurityEvent {
  return Object.assign(new SecurityEvent(), { time: TIME, ...fields });
}

function logEvent(fields: Partial<SecurityEvent> = {}): SecurityEvent {
  return event({
    attributes: {
      [SECURITY_LOG_ID_ATTRIBUTE]: LOG_ID,
      [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]: SERVICE_ID,
      [SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]: ServiceType.OpenTelemetry,
    },
    ...fields,
  });
}

function pathOf(route: { toString(): string }): string {
  return route.toString().split("?")[0]!;
}

function queryOf(route: { toString(): string }): URLSearchParams {
  const value: string = route.toString();
  const index: number = value.indexOf("?");

  return new URLSearchParams(index === -1 ? "" : value.slice(index + 1));
}

describe("the log record an event came from", () => {
  test("reads its id and the service it was sent under", () => {
    expect(Links.getSecurityEventLogId(logEvent())).toBe(LOG_ID);
    expect(Links.getSecurityEventLogServiceId(logEvent())).toBe(SERVICE_ID);
  });

  test("a line sent under a host names no service", () => {
    expect(
      Links.getSecurityEventLogServiceId(
        event({
          attributes: {
            [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]: SERVICE_ID,
            [SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE]: ServiceType.Host,
          },
        }),
      ),
    ).toBe("");
  });

  test("an event from a connected product came from no log record", () => {
    expect(Links.getSecurityEventLogId(event())).toBe("");
    expect(Links.getSecurityEventLogServiceId(event())).toBe("");
  });
});

describe("getSecurityEventTraceRoute", () => {
  test("opens the trace on the span that answered the request", () => {
    const route: ReturnType<typeof Links.getSecurityEventTraceRoute> =
      Links.getSecurityEventTraceRoute({
        event: event({
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: "00f067aa0ba902b7",
        }),
        serverSpanId: "aaaaaaaaaaaaaaaa",
      });

    expect(pathOf(route!)).toContain(
      "/traces/view/4bf92f3577b34da6a3ce929d0e0e4736",
    );
    expect(queryOf(route!).get("spanId")).toBe("aaaaaaaaaaaaaaaa");
  });

  test("without the answering span, on the span the line was written in", () => {
    expect(
      queryOf(
        Links.getSecurityEventTraceRoute({
          event: event({
            traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
            spanId: "00f067aa0ba902b7",
          }),
        })!,
      ).get("spanId"),
    ).toBe("00f067aa0ba902b7");
  });

  test("an event in no request has no trace to open", () => {
    expect(Links.getSecurityEventTraceRoute({ event: event() })).toBeNull();
    expect(
      Links.getSecurityEventTraceRoute({ event: event({ traceId: "  " }) }),
    ).toBeNull();
  });
});

describe("getSecurityEventExceptionRoute", () => {
  test("opens the exceptions list on the one group", () => {
    const route: ReturnType<typeof Links.getSecurityEventExceptionRoute> =
      Links.getSecurityEventExceptionRoute("fp-123");

    expect(pathOf(route!)).toContain("/exceptions");
    expect(decodeURIComponent(queryOf(route!).get("search") || "")).toBe(
      "@fingerprint:fp-123",
    );
  });

  test("no fingerprint, no link", () => {
    expect(Links.getSecurityEventExceptionRoute("")).toBeNull();
    expect(Links.getSecurityEventExceptionRoute("  ")).toBeNull();
  });
});

/*
 * The very line an event was read from (#9620): the logs explorer open on
 * it by its id - read with the reader's own permissions - with its
 * service's lines in the second around it under it.
 */
describe("getSecurityEventLogLineRoute", () => {
  test("opens the line by its id and when it was written, over its service's second", () => {
    const route: Route | null = Links.getSecurityEventLogLineRoute(
      logEvent({ traceId: "4bf92f3577b34da6a3ce929d0e0e4736" }),
    );
    const query: URLSearchParams = queryOf(route!);

    expect(pathOf(route!)).toContain("/logs");
    expect(query.get("log")).toBe(LOG_ID);
    expect(new Date(query.get("logTime")!).getTime()).toBe(TIME.getTime());
    expect(JSON.parse(query.get("filters")!)).toEqual([
      ["primaryEntityId", [SERVICE_ID]],
    ]);
    expect(query.get("range")).toBe("Custom");
    expect(new Date(query.get("start")!).getTime()).toBe(
      TIME.getTime() - Links.NEIGHBOUR_LOGS_WINDOW_IN_SECONDS * 1000,
    );
    expect(new Date(query.get("end")!).getTime()).toBe(
      TIME.getTime() + Links.NEIGHBOUR_LOGS_WINDOW_IN_SECONDS * 1000,
    );
  });

  test("a line whose service is not known still opens, over the second around it", () => {
    const route: Route | null = Links.getSecurityEventLogLineRoute(
      event({ attributes: { [SECURITY_LOG_ID_ATTRIBUTE]: LOG_ID } }),
    );
    const query: URLSearchParams = queryOf(route!);

    expect(query.get("log")).toBe(LOG_ID);
    expect(query.get("filters")).toBeNull();
  });

  test("an event read from no log line, or that says not when, opens none", () => {
    expect(Links.getSecurityEventLogLineRoute(event())).toBeNull();
    expect(
      Links.getSecurityEventLogLineRoute(
        Object.assign(new SecurityEvent(), {
          attributes: { [SECURITY_LOG_ID_ATTRIBUTE]: LOG_ID },
        }),
      ),
    ).toBeNull();
  });
});

describe("getSecurityEventLogsLink", () => {
  test("a line written inside a request opens every line of that request", () => {
    const link: ReturnType<typeof Links.getSecurityEventLogsLink> =
      Links.getSecurityEventLogsLink(
        logEvent({ traceId: "4bf92f3577b34da6a3ce929d0e0e4736" }),
      );

    expect(link!.scope).toBe("request");
    expect(pathOf(link!.route)).toContain("/logs");

    const query: URLSearchParams = queryOf(link!.route);

    expect(JSON.parse(query.get("filters")!)).toEqual([
      ["traceId", ["4bf92f3577b34da6a3ce929d0e0e4736"]],
    ]);
    expect(query.get("range")).toBe("Custom");
    expect(new Date(query.get("start")!).getTime()).toBe(
      TIME.getTime() - Links.REQUEST_LOGS_WINDOW_IN_MINUTES * 60 * 1000,
    );
    expect(new Date(query.get("end")!).getTime()).toBe(
      TIME.getTime() + Links.REQUEST_LOGS_WINDOW_IN_MINUTES * 60 * 1000,
    );
  });

  test("a line outside any request has no request's lines: the line itself opens with its neighbours", () => {
    expect(Links.getSecurityEventLogsLink(logEvent())).toBeNull();
    expect(Links.getSecurityEventLogLineRoute(logEvent())).not.toBeNull();
  });

  test("an event with neither a trace nor a log line has no logs to open", () => {
    expect(Links.getSecurityEventLogsLink(event())).toBeNull();
    expect(
      Links.getSecurityEventLogsLink(
        event({ attributes: { [SECURITY_LOG_ID_ATTRIBUTE]: LOG_ID } }),
      ),
    ).toBeNull();
    // An event with no time cannot be found in time.
    expect(
      Links.getSecurityEventLogsLink(
        Object.assign(new SecurityEvent(), {
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        }),
      ),
    ).toBeNull();
  });
});

/*
 * How your logs know a user a Hash rule hid (#10909): the panel says
 * "Hashed in your logs as [HASHED:...]" and links to a search for the
 * token, in the signal the event was read from, a day either side of it.
 */
describe("the search for a hashed user's token", () => {
  const TOKEN: string = "[HASHED:0123456789abcdef]";
  const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

  function filtersOf(route: Route): Array<[string, Array<string>]> {
    return JSON.parse(queryOf(route).get("filters") || "[]");
  }

  test("an event read from traces is a trace's, any other a log line's", () => {
    expect(
      Links.getSecurityEventSignal(
        event({
          attributes: {
            [SECURITY_LOG_SOURCE_ATTRIBUTE]: SecurityTelemetrySourceKind.Traces,
          },
        }),
      ),
    ).toBe(Links.HashedUserSignal.Trace);
    expect(
      Links.getSecurityEventSignal(
        event({
          attributes: {
            [SECURITY_LOG_SOURCE_ATTRIBUTE]:
              SecurityTelemetrySourceKind.CloudAudit,
          },
        }),
      ),
    ).toBe(Links.HashedUserSignal.Log);
    expect(Links.getSecurityEventSignal(event())).toBe(
      Links.HashedUserSignal.Log,
    );
    expect(Links.getSecurityEventSignal({ attributes: "not a map" })).toBe(
      Links.HashedUserSignal.Log,
    );
  });

  test("searches the logs' bodies for the token, a day either side of the event", () => {
    const search: ReturnType<typeof Links.getHashedUserSearch> =
      Links.getHashedUserSearch({
        hashed: TOKEN,
        signal: Links.HashedUserSignal.Log,
        time: TIME,
      });

    expect(search).not.toBeNull();
    expect(search!.token).toBe(TOKEN);
    expect(search!.signal).toBe(Links.HashedUserSignal.Log);
    expect(pathOf(search!.route)).toMatch(/\/logs$/);
    expect(filtersOf(search!.route)).toEqual([["body", [TOKEN]]]);

    const query: URLSearchParams = queryOf(search!.route);

    expect(query.get("range")).toBeTruthy();
    expect(new Date(query.get("start")!).getTime()).toBe(
      TIME.getTime() - DAY_IN_MS,
    );
    expect(new Date(query.get("end")!).getTime()).toBe(
      TIME.getTime() + DAY_IN_MS,
    );
  });

  test("searches the traces for the request's user holding the token", () => {
    const search: ReturnType<typeof Links.getHashedUserSearch> =
      Links.getHashedUserSearch({
        hashed: TOKEN,
        signal: Links.HashedUserSignal.Trace,
        time: TIME,
      });

    expect(search!.signal).toBe(Links.HashedUserSignal.Trace);
    expect(pathOf(search!.route)).toMatch(/\/traces$/);
    expect(queryOf(search!.route).get("search")).toContain(
      `@${Links.TRACE_USER_ATTRIBUTE}:`,
    );
    expect(queryOf(search!.route).get("search")).toContain(TOKEN);
    expect(new Date(queryOf(search!.route).get("end")!).getTime()).toBe(
      TIME.getTime() + DAY_IN_MS,
    );
  });

  test("a user with the token inside is searched for by the token alone in logs", () => {
    const search: ReturnType<typeof Links.getHashedUserSearch> =
      Links.getHashedUserSearch({
        hashed: ` arn:aws:iam::123456789012:user/${TOKEN} `,
        signal: Links.HashedUserSignal.Log,
        time: TIME,
      });

    expect(search!.token).toBe(TOKEN);
    expect(search!.hashed).toBe(`arn:aws:iam::123456789012:user/${TOKEN}`);
    expect(filtersOf(search!.route)).toEqual([["body", [TOKEN]]]);
  });

  test("without a time it searches the explorer's own range", () => {
    for (const time of [undefined, new Date("not a date")]) {
      const query: URLSearchParams = queryOf(
        Links.getHashedUserSearch({
          hashed: TOKEN,
          signal: Links.HashedUserSignal.Log,
          time,
        })!.route,
      );

      expect(query.get("start")).toBeNull();
      expect(query.get("end")).toBeNull();
    }
  });

  /*
   * #11045: the user vault reads a user from more than a log's body and a
   * span's enduser.id - a span's user.id, an AI call's user, a log line's
   * attribute - and the event says which. The search looks there, for the
   * token inside the field as well as being all of it.
   */
  function containsToken(token: string): string {
    return `~"${token}"`;
  }

  function traceSearchOf(route: Route): string {
    return queryOf(route).get("search") || "";
  }

  test.each([
    ["a request's enduser.id", "enduser.id"],
    ["a request's user.id", "user.id"],
    [
      "an AI call's user, from the attribute it was copied from",
      "langfuse.user.id",
    ],
    [
      "an AI call's user, from a resource's attribute",
      "resource.user.account_uuid",
    ],
  ])(
    "a span's user read from %s is searched for in that attribute",
    (_place: string, key: string) => {
      const search: ReturnType<typeof Links.getHashedUserSearch> =
        Links.getHashedUserSearch({
          hashed: TOKEN,
          signal: Links.HashedUserSignal.Trace,
          field: `attributes.${key}`,
          time: TIME,
        });

      expect(search!.field).toBe(`attributes.${key}`);
      expect(pathOf(search!.route)).toMatch(/\/traces$/);
      expect(traceSearchOf(search!.route)).toBe(
        `@${key}:${containsToken(TOKEN)}`,
      );
      expect(queryOf(search!.route).get("filters")).toBeNull();
      expect(new Date(queryOf(search!.route).get("start")!).getTime()).toBe(
        TIME.getTime() - DAY_IN_MS,
      );
    },
  );

  test("a span's user with no field said - an event named before fields were kept - is searched for in enduser.id, as before", () => {
    for (const field of [undefined, "", "body", "nonsense"]) {
      const search: ReturnType<typeof Links.getHashedUserSearch> =
        Links.getHashedUserSearch({
          hashed: TOKEN,
          signal: Links.HashedUserSignal.Trace,
          field,
          time: TIME,
        });

      expect(search!.field).toBe(`attributes.${Links.TRACE_USER_ATTRIBUTE}`);
      expect(traceSearchOf(search!.route)).toBe(
        `@${Links.TRACE_USER_ATTRIBUTE}:${containsToken(TOKEN)}`,
      );
    }
  });

  test("a span attribute no search token can name rides a filter chip with the same contains value", () => {
    const search: ReturnType<typeof Links.getHashedUserSearch> =
      Links.getHashedUserSearch({
        hashed: TOKEN,
        signal: Links.HashedUserSignal.Trace,
        field: "attributes.user name:id",
        time: TIME,
      });

    expect(traceSearchOf(search!.route)).toBe("");
    expect(JSON.parse(queryOf(search!.route).get("filters") || "[]")).toEqual([
      ["attributes.user name:id", containsToken(TOKEN)],
    ]);
  });

  test("a log line's user read from an attribute is searched for in that attribute, not the body", () => {
    const search: ReturnType<typeof Links.getHashedUserSearch> =
      Links.getHashedUserSearch({
        hashed: TOKEN,
        signal: Links.HashedUserSignal.Log,
        field: "attributes.openstack.user_name",
        time: TIME,
      });

    expect(search!.field).toBe("attributes.openstack.user_name");
    expect(pathOf(search!.route)).toMatch(/\/logs$/);
    expect(filtersOf(search!.route)).toEqual([
      ["attributes.openstack.user_name", [containsToken(TOKEN)]],
    ]);
  });

  test("a log line's user read from the body, or with no field said, is searched for in the body", () => {
    for (const field of [undefined, "", "body"]) {
      const search: ReturnType<typeof Links.getHashedUserSearch> =
        Links.getHashedUserSearch({
          hashed: `auth0|${TOKEN}`,
          signal: Links.HashedUserSignal.Log,
          field,
          time: TIME,
        });

      expect(search!.field).toBe("body");
      expect(filtersOf(search!.route)).toEqual([["body", [TOKEN]]]);
    }
  });

  test("the token is searched for, never what else the rule left around it", () => {
    const search: ReturnType<typeof Links.getHashedUserSearch> =
      Links.getHashedUserSearch({
        hashed: `CORP\\${TOKEN}`,
        signal: Links.HashedUserSignal.Trace,
        field: "attributes.user.id",
        time: TIME,
      });

    expect(search!.hashed).toBe(`CORP\\${TOKEN}`);
    expect(traceSearchOf(search!.route)).toBe(
      `@user.id:${containsToken(TOKEN)}`,
    );
  });

  test("what a rule that redacts or masks left, or no token at all, has no search", () => {
    for (const hashed of [
      "",
      "   ",
      "[REDACTED]",
      "a***e",
      "[HASHED]",
      "[HASHED:XYZ]",
      "alice@example.com",
    ]) {
      expect({
        hashed,
        search: Links.getHashedUserSearch({
          hashed,
          signal: Links.HashedUserSignal.Log,
          time: TIME,
        }),
      }).toEqual({ hashed, search: null });
    }
  });
});
