import { beforeAll, describe, expect, test } from "@jest/globals";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import SecurityEventRequestOutcome from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import type * as ModelModuleType from "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsInSignalModel";

/*
 * The way back: from a log line, a trace, a session or an exception to the
 * security events it is part of. Pinned here: which scope a callout asks
 * for, the window it asks over, the query it sends (the reader's own read
 * of SecurityEvent), the link into the events list, the event it names and
 * the sentence it says.
 */

type ModelModule = typeof ModelModuleType;

let Model: ModelModule;

const ENGLISH: Translator = createTranslator(undefined, "en");
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000p101",
);

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

  Model = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsInSignalModel"
  );
});

function queryOf(route: { toString(): string }): URLSearchParams {
  const value: string = route.toString();

  return new URLSearchParams(value.slice(value.indexOf("?") + 1));
}

function event(fields: Partial<SecurityEvent>): SecurityEvent {
  return Object.assign(new SecurityEvent(), fields);
}

describe("which events a callout asks for", () => {
  test("a request's, before its line's, its session's or an exception's", () => {
    expect(
      Model.getSecurityEventsInSignalKind({
        traceId: "trace-1",
        logId: "log-1",
        sessionId: "session-1",
      }),
    ).toBe(Model.SecurityEventsInSignalKind.Request);
    expect(
      Model.getSecurityEventsInSignalKind({
        traceId: " ",
        logId: "log-1",
      }),
    ).toBe(Model.SecurityEventsInSignalKind.LogLine);
    expect(
      Model.getSecurityEventsInSignalKind({ sessionId: "session-1" }),
    ).toBe(Model.SecurityEventsInSignalKind.Session);
    expect(
      Model.getSecurityEventsInSignalKind({ exceptionFingerprint: "fp" }),
    ).toBe(Model.SecurityEventsInSignalKind.Exception);
    expect(Model.getSecurityEventsInSignalKind({})).toBeNull();
  });

  test("a line or a request is looked for around its time; a page without one looks back a month", () => {
    const time: Date = new Date("2026-10-27T06:45:12.000Z");
    const around: InBetween<Date> = Model.getSecurityEventsInSignalWindow({
      time,
      now: NOW,
    });

    expect(new Date(around.startValue).getTime()).toBe(
      time.getTime() - Model.SIGNAL_EVENT_WINDOW_IN_HOURS * 3600 * 1000,
    );
    expect(new Date(around.endValue).getTime()).toBe(
      time.getTime() + Model.SIGNAL_EVENT_WINDOW_IN_HOURS * 3600 * 1000,
    );

    const back: InBetween<Date> = Model.getSecurityEventsInSignalWindow({
      time: null,
      now: NOW,
    });

    expect(new Date(back.endValue).getTime()).toBe(NOW.getTime());
    expect(NOW.getTime() - new Date(back.startValue).getTime()).toBe(
      Model.SIGNAL_EVENT_LOOKBACK_IN_DAYS * 24 * 3600 * 1000,
    );
  });
});

describe("the query the reader sends", () => {
  const window: InBetween<Date> = new InBetween<Date>(
    new Date("2026-10-27T05:45:12.000Z"),
    new Date("2026-10-27T07:45:12.000Z"),
  );

  test("a request's events, by the trace column", () => {
    const query: Record<string, unknown> =
      Model.buildSecurityEventsInSignalQuery({
        scope: { traceId: " trace-1 " },
        window,
        projectId: PROJECT_ID,
      }) as Record<string, unknown>;

    expect(query["traceId"]).toBe("trace-1");
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["time"]).toBe(window);
    expect(query["attributes"]).toBeUndefined();
  });

  test("a line's events, by the log id each one names", () => {
    const query: Record<string, unknown> =
      Model.buildSecurityEventsInSignalQuery({
        scope: { logId: "log-1" },
        window,
        projectId: PROJECT_ID,
      }) as Record<string, unknown>;

    expect(query["attributes"]).toEqual({ "oneuptime.log.id": "log-1" });
  });

  test("an exception's events, by the fingerprint each followed request names", () => {
    const query: Record<string, unknown> =
      Model.buildSecurityEventsInSignalQuery({
        scope: { exceptionFingerprint: "fp-1" },
        window,
        projectId: null,
      }) as Record<string, unknown>;

    expect(query["attributes"]).toEqual({
      "oneuptime.exception.fingerprint": "fp-1",
    });
    expect(query["projectId"]).toBeUndefined();
  });

  test("a session's events, by the session column", () => {
    expect(
      (
        Model.buildSecurityEventsInSignalQuery({
          scope: { sessionId: "session-1" },
          window,
          projectId: PROJECT_ID,
        }) as Record<string, unknown>
      )["sessionId"],
    ).toBe("session-1");
  });

  test("nothing to ask for sends nothing", () => {
    expect(
      Model.buildSecurityEventsInSignalQuery({
        scope: {},
        window,
        projectId: PROJECT_ID,
      }),
    ).toBeNull();
  });
});

describe("the link into Security Events", () => {
  const window: InBetween<Date> = new InBetween<Date>(
    new Date("2026-10-27T05:45:12.000Z"),
    new Date("2026-10-27T07:45:12.000Z"),
  );

  test("opens the events list on the same events, over the same window", () => {
    const route: ReturnType<typeof Model.buildSecurityEventsInSignalRoute> =
      Model.buildSecurityEventsInSignalRoute({
        scope: { traceId: "trace-1" },
        window,
      });
    const query: URLSearchParams = queryOf(route!);

    expect(route!.toString().split("?")[0]).toContain("/security-events");
    expect(JSON.parse(query.get("filters")!)).toEqual([["traceId", "trace-1"]]);
    expect(query.get("range")).toBe("Custom");
    expect(query.get("start")).toBe("2026-10-27T05:45:12.000Z");
    expect(query.get("end")).toBe("2026-10-27T07:45:12.000Z");
  });

  test("an attribute scope opens as the attribute chip the list reads", () => {
    const query: URLSearchParams = queryOf(
      Model.buildSecurityEventsInSignalRoute({
        scope: { exceptionFingerprint: "fp-1" },
        window,
      })!,
    );

    expect(JSON.parse(query.get("filters")!)).toEqual([
      ["attributes.oneuptime.exception.fingerprint", "fp-1"],
    ]);
  });
});

/*
 * The occurrences of the exceptions merged into one count on it
 * (TelemetryExceptionMerge), so a request that threw one of them threw it:
 * an exception's callout asks for any of its group's fingerprints, its own
 * first, and links to all of them - held to a bound its link can carry.
 */
describe("the security events of an exception others were merged into", () => {
  const window: InBetween<Date> = new InBetween<Date>(
    new Date("2026-10-27T05:45:12.000Z"),
    new Date("2026-10-27T07:45:12.000Z"),
  );

  test("asks for any of its own fingerprint and those merged into it", () => {
    const query: Record<string, unknown> =
      Model.buildSecurityEventsInSignalQuery({
        scope: {
          exceptionFingerprint: " fp-1 ",
          mergedExceptionFingerprints: ["fp-2", " fp-3 ", "", "fp-1", "fp-2"],
        },
        window,
        projectId: PROJECT_ID,
      }) as Record<string, unknown>;

    const value: unknown = (query["attributes"] as Record<string, unknown>)[
      "oneuptime.exception.fingerprint"
    ];
    expect(value).toBeInstanceOf(Includes);
    expect((value as Includes).values).toEqual(["fp-1", "fp-2", "fp-3"]);
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["time"]).toBe(window);
  });

  test("nothing merged into it: the plain equality it always was", () => {
    for (const merged of [undefined, [], [""], ["fp-1"]]) {
      const query: Record<string, unknown> =
        Model.buildSecurityEventsInSignalQuery({
          scope: {
            exceptionFingerprint: "fp-1",
            ...(merged ? { mergedExceptionFingerprints: merged } : {}),
          },
          window,
          projectId: null,
        }) as Record<string, unknown>;

      expect(query["attributes"]).toEqual({
        "oneuptime.exception.fingerprint": "fp-1",
      });
    }
  });

  test("links into Security Events with a chip for each, which the list reads as any of them", () => {
    const query: URLSearchParams = queryOf(
      Model.buildSecurityEventsInSignalRoute({
        scope: {
          exceptionFingerprint: "fp-1",
          mergedExceptionFingerprints: ["fp-2", "fp-3"],
        },
        window,
      })!,
    );

    expect(JSON.parse(query.get("filters")!)).toEqual([
      ["attributes.oneuptime.exception.fingerprint", "fp-1"],
      ["attributes.oneuptime.exception.fingerprint", "fp-2"],
      ["attributes.oneuptime.exception.fingerprint", "fp-3"],
    ]);
  });

  test(`at most ${20} fingerprints, its own first, in the read and in the link alike`, () => {
    const merged: Array<string> = Array.from(
      { length: 40 },
      (_value: unknown, index: number): string => {
        return `fp-merged-${index}`;
      },
    );
    const scope: ModelModuleType.SecurityEventsInSignalScope = {
      exceptionFingerprint: "fp-own",
      mergedExceptionFingerprints: merged,
    };

    expect(Model.SECURITY_EVENTS_IN_SIGNAL_MAX_EXCEPTION_FINGERPRINTS).toBe(20);

    const asked: Array<string> = (
      (
        (
          Model.buildSecurityEventsInSignalQuery({
            scope,
            window,
            projectId: null,
          }) as Record<string, unknown>
        )["attributes"] as Record<string, unknown>
      )["oneuptime.exception.fingerprint"] as Includes
    ).values as Array<string>;

    expect(asked).toEqual(["fp-own", ...merged.slice(0, 19)]);

    const linked: Array<[string, string]> = JSON.parse(
      queryOf(Model.buildSecurityEventsInSignalRoute({ scope, window })!).get(
        "filters",
      )!,
    );
    expect(
      linked.map((pair: [string, string]): string => {
        return pair[1];
      }),
    ).toEqual(asked);
    // A link a server takes: well under the 8 KB a request line may be.
    expect(
      Model.buildSecurityEventsInSignalRoute({ scope, window })!.toString()
        .length,
    ).toBeLessThan(4096);
  });

  test("is still an exception's callout, saying so in its own words", () => {
    expect(
      Model.getSecurityEventsInSignalKind({
        exceptionFingerprint: "fp-1",
        mergedExceptionFingerprints: ["fp-2"],
      }),
    ).toBe(Model.SecurityEventsInSignalKind.Exception);
    // A request's, line's or session's scope says nothing of merged ones.
    expect(
      Model.getSecurityEventsInSignalFilterValues({ traceId: "trace-1" }),
    ).toEqual(["traceId", ["trace-1"]]);
    expect(
      Model.getSecurityEventsInSignalFilter({
        exceptionFingerprint: "fp-1",
        mergedExceptionFingerprints: ["fp-2"],
      }),
    ).toEqual(["attributes.oneuptime.exception.fingerprint", "fp-1"]);
  });
});

describe("the event a callout names", () => {
  test("the most severe, and of two as severe the one that got furthest", () => {
    const low: SecurityEvent = event({ severityId: 2, message: "low" });
    const highRejected: SecurityEvent = event({
      severityId: 4,
      requestOutcome: SecurityEventRequestOutcome.Rejected,
      message: "high rejected",
    });
    const highErrored: SecurityEvent = event({
      severityId: 4,
      requestOutcome: SecurityEventRequestOutcome.Errored,
      message: "high errored",
    });

    expect(
      Model.getWorstSecurityEvent([low, highRejected, highErrored])?.message,
    ).toBe("high errored");
    expect(Model.getWorstSecurityEvent([low])?.message).toBe("low");
    expect(Model.getWorstSecurityEvent([])).toBeNull();
  });

  test("says how many, in the words of what was asked", () => {
    expect(
      ENGLISH.translatePlural(
        Model.SECURITY_EVENTS_IN_SIGNAL_TITLES[
          Model.SecurityEventsInSignalKind.Request
        ],
        1,
      ),
    ).toBe("1 security event happened in this request");
    expect(
      ENGLISH.translatePlural(
        Model.SECURITY_EVENTS_IN_SIGNAL_TITLES[
          Model.SecurityEventsInSignalKind.LogLine
        ],
        3,
      ),
    ).toBe("This line raised 3 security events");
    expect(
      ENGLISH.translatePlural(
        Model.SECURITY_EVENTS_IN_SIGNAL_TITLES[
          Model.SecurityEventsInSignalKind.Exception
        ],
        2,
      ),
    ).toBe("2 security events happened in requests that threw this exception");
  });
});
