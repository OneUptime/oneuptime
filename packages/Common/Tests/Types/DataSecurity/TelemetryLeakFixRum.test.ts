import { describe, expect, test } from "@jest/globals";
import {
  TelemetryLeakFixTaskContext,
  getTelemetryLeakFixTaskContext,
} from "../../../Types/AI/CodeFixTaskContext";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import {
  RUM_TELEMETRY_LEAK_SIGNALS,
  RUM_TELEMETRY_STORE_KINDS,
  SERVICE_TELEMETRY_STORE_KINDS,
  TELEMETRY_LEAK_SIGNALS,
  TelemetryLeakFixOwnerKind,
  TelemetryLeakFixStrategy,
  TelemetryLeakHandling,
  TelemetryLeakPlace,
  TelemetryLeakSignal,
  decideTelemetryLeakFix,
  getRumSessionKey,
  getRumTelemetryLeakSignal,
  getTelemetryLeakFixOwnerKind,
  getTelemetryLeakPlaceKey,
  getTelemetryLeakSignal,
  getTelemetryLeakSignalOf,
  isRumTelemetryLeakSignal,
  isTelemetryLeakFixOwnerKind,
  readTelemetryLeakPlace,
} from "../../../Types/DataSecurity/TelemetryLeakFix";
import { JSONObject } from "../../../Types/JSON";

/*
 * A RUM APPLICATION'S LEAKS, AS THE FIX'S TYPES SAY THEM (#10933).
 *
 * A session replay store's finding is the signal its location says - a
 * browser log's or span's attribute, a session's details - and the
 * owner of its fix is the application. A place it names is the page it
 * was written on and, for a session's user details, the session recorder
 * call; read back from a plan or a task's context, both are bounded text,
 * and a fix's owner that is not one is a service's.
 */

describe("a session replay store's findings", () => {
  test("each the signal its location says: a browser log's or span's attribute, a session's details", () => {
    const kind: DataStoreKind = DataStoreKind.TelemetrySessionReplays;

    expect(getRumTelemetryLeakSignal(kind, "logs.attributes.user.email")).toBe(
      TelemetryLeakSignal.RumLogs,
    );
    expect(getRumTelemetryLeakSignal(kind, "spans.attributes.http.url")).toBe(
      TelemetryLeakSignal.RumSpans,
    );
    expect(
      getRumTelemetryLeakSignal(kind, "sessions.identifiedUserLabel"),
    ).toBe(TelemetryLeakSignal.RumSessions);
    expect(
      getRumTelemetryLeakSignal(kind, "sessions.identifiedUserTraits.email"),
    ).toBe(TelemetryLeakSignal.RumSessions);
    expect(getRumTelemetryLeakSignal(kind, "sessions.attributes.plan")).toBe(
      TelemetryLeakSignal.RumSessions,
    );
  });

  test("no signal for a bare prefix, nothing, or another store's", () => {
    const kind: DataStoreKind = DataStoreKind.TelemetrySessionReplays;

    expect(getRumTelemetryLeakSignal(kind, "logs.attributes.")).toBeNull();
    expect(getRumTelemetryLeakSignal(kind, "sessions.")).toBeNull();
    expect(getRumTelemetryLeakSignal(kind, "body")).toBeNull();
    expect(getRumTelemetryLeakSignal(kind, null)).toBeNull();
    expect(
      getRumTelemetryLeakSignal(
        DataStoreKind.TelemetryLogs,
        "logs.attributes.user.email",
      ),
    ).toBeNull();
  });

  test("a service's store is still said by its kind alone; a session replay store by its location", () => {
    expect(
      getTelemetryLeakSignalOf(DataStoreKind.TelemetryLogs, "sessions.x"),
    ).toBe(TelemetryLeakSignal.Logs);
    expect(
      getTelemetryLeakSignalOf(
        DataStoreKind.TelemetrySessionReplays,
        "spans.attributes.user.email",
      ),
    ).toBe(TelemetryLeakSignal.RumSpans);
    // A session replay store is no service's telemetry: the service's fix never takes it.
    expect(getTelemetryLeakSignal(DataStoreKind.TelemetrySessionReplays)).toBe(
      null,
    );
    expect(SERVICE_TELEMETRY_STORE_KINDS).not.toContain(
      DataStoreKind.TelemetrySessionReplays,
    );
    expect(RUM_TELEMETRY_STORE_KINDS).toEqual([
      DataStoreKind.TelemetrySessionReplays,
    ]);
  });

  test("the RUM signals are the front end's, and every one is a signal", () => {
    for (const signal of RUM_TELEMETRY_LEAK_SIGNALS) {
      expect(isRumTelemetryLeakSignal(signal)).toBe(true);
      expect(TELEMETRY_LEAK_SIGNALS).toContain(signal);
    }

    for (const signal of [
      TelemetryLeakSignal.Logs,
      TelemetryLeakSignal.Spans,
      TelemetryLeakSignal.Exceptions,
      TelemetryLeakSignal.AiCalls,
      TelemetryLeakSignal.Metrics,
    ]) {
      expect(isRumTelemetryLeakSignal(signal)).toBe(false);
    }
  });
});

describe("the key a session holds the data under", () => {
  test("a trait identify() named, or an attribute the page attached", () => {
    expect(getRumSessionKey("sessions.identifiedUserTraits.email")).toBe(
      "email",
    );
    expect(getRumSessionKey("sessions.attributes.customer.phone")).toBe(
      "customer.phone",
    );
  });

  test("none for its user's label, a bare prefix, or anything else", () => {
    expect(getRumSessionKey("sessions.identifiedUserLabel")).toBeUndefined();
    expect(getRumSessionKey("sessions.identifiedUserTraits.")).toBeUndefined();
    expect(getRumSessionKey("logs.attributes.user.email")).toBeUndefined();
  });

  test("bounded, as any key a plan carries", () => {
    expect(
      getRumSessionKey(`sessions.attributes.${"k".repeat(5000)}`)!.length,
    ).toBeLessThan(5000);
  });
});

describe("whose code a fix changes", () => {
  test("a service's, unless it says a RUM application's", () => {
    expect(isTelemetryLeakFixOwnerKind("RumApplication")).toBe(true);
    expect(isTelemetryLeakFixOwnerKind("Service")).toBe(true);
    expect(isTelemetryLeakFixOwnerKind("Robot")).toBe(false);
    expect(getTelemetryLeakFixOwnerKind("RumApplication")).toBe(
      TelemetryLeakFixOwnerKind.RumApplication,
    );
    expect(getTelemetryLeakFixOwnerKind(undefined)).toBe(
      TelemetryLeakFixOwnerKind.Service,
    );
    expect(getTelemetryLeakFixOwnerKind({ kind: "RumApplication" })).toBe(
      TelemetryLeakFixOwnerKind.Service,
    );
  });

  function context(raw: JSONObject): TelemetryLeakFixTaskContext | null {
    return getTelemetryLeakFixTaskContext({
      serviceId: "a9000000-0000-4000-8000-000000000001",
      serviceName: "Storefront",
      title: "Stop Storefront sending sensitive data from the browser",
      request: "the request",
      strategy: TelemetryLeakFixStrategy.CallSites,
      placeCount: 1,
      leaks: [
        {
          issueId: "a9000000-0000-4000-8000-0000000000a1",
          dataStoreId: "a9000000-0000-4000-8000-0000000000b1",
          checkId: "sensitive-data-in-telemetry",
          signal: TelemetryLeakSignal.RumSessions,
          dataTypeId: "email-address",
          dataTypeName: "Email address",
          isSecret: false,
          location: "sessions.identifiedUserLabel",
          isMaskedByScrubRule: false,
          handling: TelemetryLeakHandling.CallSite,
          places: [
            { recorderCall: "identify", page: "/account", recordCount: 3 },
          ],
        },
      ],
      issues: [],
      redactionKeys: [],
      redactionDataTypes: [],
      startFiles: [],
      hasSecrets: false,
      issuesUrl: "https://oneuptime.example/issues",
      ...raw,
    });
  }

  test("a task's context keeps an application's owner; a service's - or anything else - says none", () => {
    const read: TelemetryLeakFixTaskContext | null = context({
      ownerKind: "RumApplication",
    });

    expect(read?.ownerKind).toBe(TelemetryLeakFixOwnerKind.RumApplication);
    // Its session place, as the plan held it.
    expect(read?.leaks[0]?.places[0]).toEqual({
      recorderCall: "identify",
      page: "/account",
      recordCount: 3,
    });
    expect(context({ ownerKind: "Service" })).not.toHaveProperty("ownerKind");
    expect(context({ ownerKind: "Robot" })).not.toHaveProperty("ownerKind");
    expect(context({})).not.toHaveProperty("ownerKind");
  });
});

describe("a place a RUM record names", () => {
  test("its key: a file first, then a template or a span; else the recorder call and its page, else the page", () => {
    const file: TelemetryLeakPlace = {
      filePath: "src/checkout/payment.js",
      lineNumber: 8,
      page: "/checkout",
      recordCount: 1,
    };

    expect(getTelemetryLeakPlaceKey(file)).toBe(
      getTelemetryLeakPlaceKey({ ...file, page: "/elsewhere" }),
    );
    expect(
      getTelemetryLeakPlaceKey({
        recorderCall: "identify",
        page: "/account",
        recordCount: 1,
      }),
    ).toBe("recorder:identify:/account");
    expect(
      getTelemetryLeakPlaceKey({ recorderCall: "identify", recordCount: 1 }),
    ).toBe("recorder:identify:");
    expect(getTelemetryLeakPlaceKey({ page: "/cart", recordCount: 1 })).toBe(
      "page:/cart",
    );
    expect(getTelemetryLeakPlaceKey({ recordCount: 1 })).toBeNull();
  });

  test("read back from a plan, its page and recorder call are bounded text; anything else is dropped", () => {
    const place: TelemetryLeakPlace | null = readTelemetryLeakPlace({
      page: `/${"p".repeat(5000)}`,
      recorderCall: `identify${"x".repeat(500)}`,
      recordCount: 2,
    });

    expect(place?.page!.length).toBeLessThan(5000);
    expect(place?.recorderCall!.length).toBeLessThan(500);
    expect(
      readTelemetryLeakPlace({ page: 7, recorderCall: {}, recordCount: 1 }),
    ).toBeNull();
  });

  test("a session's user details are fixed where identify() is called: one place, its call site", () => {
    const decision: ReturnType<typeof decideTelemetryLeakFix> =
      decideTelemetryLeakFix([
        {
          issueId: "a9000000-0000-4000-8000-0000000000a1",
          dataStoreId: "a9000000-0000-4000-8000-0000000000b1",
          checkId: "sensitive-data-in-telemetry",
          findingId: "a9000000-0000-4000-8000-0000000000d1",
          signal: TelemetryLeakSignal.RumSessions,
          dataTypeId: "email-address",
          dataTypeName: "Email address",
          isSecret: false,
          location: "sessions.identifiedUserLabel",
          isMaskedByScrubRule: false,
          places: [
            { recorderCall: "identify", page: "/account", recordCount: 3 },
          ],
        },
      ]);

    expect(decision.strategy).toBe(TelemetryLeakFixStrategy.CallSites);
    expect(decision.leaks[0]).toMatchObject({
      signal: TelemetryLeakSignal.RumSessions,
      handling: TelemetryLeakHandling.CallSite,
      places: [{ recorderCall: "identify", page: "/account" }],
    });
  });
});
