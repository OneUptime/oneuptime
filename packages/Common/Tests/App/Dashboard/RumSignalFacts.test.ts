import { describe, expect, test } from "@jest/globals";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import { WebVitalDefinitions } from "../../../Types/Rum/WebVitals";
import {
  RUM_SIGNAL_APPLICATION_SELECT,
  getRumApplicationArrivalFacts,
  getRumClientKind,
  getRumRetentionInDays,
  getWebVitalMetricNames,
  toDateOrNull,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalFacts";

/*
 * What a RUM application's own record says about what arrives from it
 * (issue #5770): the facts RumSignalDiagnosis reads before it says why an
 * Exceptions or Logs chart is empty. When the app was last heard from at
 * all - its SDK's heartbeat or its last recording, whichever is newer -
 * whether only Session Replay reports, whether it is a browser or a mobile
 * app, how long it keeps telemetry, and every name a Web Vital arrives
 * under.
 */

const DAY_MS: number = 24 * 60 * 60 * 1000;
const NOW: Date = new Date("2026-11-09T12:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function app(
  data: Partial<Record<keyof RumApplication, unknown>>,
): RumApplication {
  const record: RumApplication = new RumApplication();
  Object.assign(record, data);
  return record;
}

describe("toDateOrNull", () => {
  test("a Date stays the same moment", () => {
    const date: Date = daysAgo(3);

    expect(toDateOrNull(date)).toBe(date);
  });

  test("an ISO string, as the API sends a date, becomes that moment", () => {
    expect(toDateOrNull("2026-11-06T12:00:00.000Z")?.getTime()).toBe(
      daysAgo(3).getTime(),
    );
  });

  test("nothing, an empty string and a string that is no date are null", () => {
    expect(toDateOrNull(undefined)).toBeNull();
    expect(toDateOrNull(null)).toBeNull();
    expect(toDateOrNull("")).toBeNull();
    expect(toDateOrNull("not a date")).toBeNull();
    expect(toDateOrNull(new Date("not a date"))).toBeNull();
  });
});

describe("getRumApplicationArrivalFacts", () => {
  test("an app nothing has arrived from has not been heard from", () => {
    expect(getRumApplicationArrivalFacts(app({}))).toEqual({
      anythingArrived: false,
      lastHeardFromAt: null,
      replayOnly: false,
    });
  });

  test("the SDK's heartbeat alone: heard from then, and not replay-only", () => {
    expect(
      getRumApplicationArrivalFacts(
        app({
          lastSeenAt: daysAgo(1),
          clientType: "browser",
          sdkLanguage: "webjs",
          agentVersion: "1.30.0",
        }),
      ),
    ).toEqual({
      anythingArrived: true,
      lastHeardFromAt: daysAgo(1),
      replayOnly: false,
    });
  });

  test("recordings alone, with no SDK metadata: heard from, and replay-only", () => {
    expect(
      getRumApplicationArrivalFacts(
        app({ sessionReplayLastChunkReceivedAt: daysAgo(2) }),
      ),
    ).toEqual({
      anythingArrived: true,
      lastHeardFromAt: daysAgo(2),
      replayOnly: true,
    });
  });

  test("both: last heard from at whichever is newer", () => {
    const sdk: Record<string, unknown> = {
      clientType: "browser",
      sdkLanguage: "webjs",
      agentVersion: "1.30.0",
    };

    expect(
      getRumApplicationArrivalFacts(
        app({
          ...sdk,
          lastSeenAt: daysAgo(5),
          sessionReplayLastChunkReceivedAt: daysAgo(1),
        }),
      ).lastHeardFromAt,
    ).toEqual(daysAgo(1));
    expect(
      getRumApplicationArrivalFacts(
        app({
          ...sdk,
          lastSeenAt: daysAgo(1),
          sessionReplayLastChunkReceivedAt: daysAgo(5),
        }),
      ).lastHeardFromAt,
    ).toEqual(daysAgo(1));
  });

  test("dates read from the API as strings count the same", () => {
    expect(
      getRumApplicationArrivalFacts(
        app({ lastSeenAt: daysAgo(4).toISOString() }),
      ).lastHeardFromAt,
    ).toEqual(daysAgo(4));
  });
});

describe("getRumClientKind", () => {
  test("mobile as ingest records it, however it is cased or padded", () => {
    expect(getRumClientKind(app({ clientType: "mobile" }))).toBe("mobile");
    expect(getRumClientKind(app({ clientType: " Mobile " }))).toBe("mobile");
  });

  test("a browser app, and one whose kind is not known yet, are browser apps", () => {
    expect(getRumClientKind(app({ clientType: "browser" }))).toBe("browser");
    expect(getRumClientKind(app({}))).toBe("browser");
    expect(getRumClientKind(app({ clientType: "" }))).toBe("browser");
  });
});

describe("getRumRetentionInDays", () => {
  test("the application's own retention", () => {
    expect(getRumRetentionInDays(app({ retainTelemetryDataForDays: 15 }))).toBe(
      15,
    );
  });

  test("none, zero, a negative and a number that is not one: no retention of its own", () => {
    expect(getRumRetentionInDays(app({}))).toBeNull();
    expect(
      getRumRetentionInDays(app({ retainTelemetryDataForDays: 0 })),
    ).toBeNull();
    expect(
      getRumRetentionInDays(app({ retainTelemetryDataForDays: -3 })),
    ).toBeNull();
    expect(
      getRumRetentionInDays(app({ retainTelemetryDataForDays: Number.NaN })),
    ).toBeNull();
    expect(
      getRumRetentionInDays(app({ retainTelemetryDataForDays: "30" })),
    ).toBeNull();
  });
});

describe("getWebVitalMetricNames", () => {
  test("every name each Web Vital is read under, so no SDK's naming is missed", () => {
    const names: Array<string> = getWebVitalMetricNames();

    for (const vital of WebVitalDefinitions) {
      expect(names).toEqual(expect.arrayContaining(vital.names));
    }
    expect(names).toEqual(
      expect.arrayContaining([
        "web_vital.lcp",
        "browser.interaction_to_next_paint",
        "web.vitals.cls",
      ]),
    );
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("RUM_SIGNAL_APPLICATION_SELECT", () => {
  test("reads every column the diagnosis needs, each a column of the application", () => {
    const columns: Array<string> = Object.keys(RUM_SIGNAL_APPLICATION_SELECT);

    expect(columns).toEqual(
      expect.arrayContaining([
        "lastSeenAt",
        "clientType",
        "sdkLanguage",
        "agentVersion",
        "sessionReplayLastChunkReceivedAt",
        "tracesLastReceivedAt",
        "logsLastReceivedAt",
        "metricsLastReceivedAt",
        "signalArrivalsTrackedSince",
        "retainTelemetryDataForDays",
      ]),
    );

    const record: RumApplication = new RumApplication();
    expect(
      columns.filter((column: string): boolean => {
        return !record.isTableColumn(column);
      }),
    ).toEqual([]);
  });
});
