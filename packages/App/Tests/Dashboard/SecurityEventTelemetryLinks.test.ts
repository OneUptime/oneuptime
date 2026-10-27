import { beforeAll, describe, expect, test } from "@jest/globals";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import {
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_TYPE_ATTRIBUTE,
} from "Common/Types/SecurityCase/SecurityConnection";
import { SECURITY_LOG_ID_ATTRIBUTE } from "Common/Types/SecurityEvent/SecurityLogFormat";
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

  test("a line outside any request opens its service's lines in the second around it", () => {
    const link: ReturnType<typeof Links.getSecurityEventLogsLink> =
      Links.getSecurityEventLogsLink(logEvent());
    const query: URLSearchParams = queryOf(link!.route);

    expect(link!.scope).toBe("neighbours");
    expect(JSON.parse(query.get("filters")!)).toEqual([
      ["primaryEntityId", [SERVICE_ID]],
    ]);
    expect(
      new Date(query.get("end")!).getTime() -
        new Date(query.get("start")!).getTime(),
    ).toBe(Links.NEIGHBOUR_LOGS_WINDOW_IN_SECONDS * 2 * 1000);
  });

  test("an event with neither a trace nor a log line has no logs to open", () => {
    expect(Links.getSecurityEventLogsLink(event())).toBeNull();
    // A line whose service is unknown cannot be found among the logs.
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
