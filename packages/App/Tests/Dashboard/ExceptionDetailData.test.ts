import { describe, expect, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import ExceptionDetailSection from "../../FeatureSet/Dashboard/src/Components/Exceptions/ExceptionDetailSection";
import {
  buildBreadcrumbEventsFromSpans,
  buildExceptionOccurrenceQuery,
  ExceptionDetailDataPlan,
  getExceptionDetailDataPlan,
  SpanBreadcrumbEvent,
} from "../../FeatureSet/Dashboard/src/Utils/ExceptionDetailData";

const NOTHING_EXTRA: ExceptionDetailDataPlan = {
  loadServices: true,
  loadStackTrace: false,
  loadLatestOccurrence: false,
  resolveStackFrames: false,
  loadTraceBreadcrumbs: false,
  loadOccurrenceAttributes: false,
  loadAIAssistance: false,
  loadOccurrenceTrend: false,
  loadTriageHistory: false,
  showHeaderActions: true,
};

describe("exception detail data ownership", () => {
  const plans: Array<[ExceptionDetailSection, ExceptionDetailDataPlan]> = [
    [
      ExceptionDetailSection.Overview,
      {
        ...NOTHING_EXTRA,
        loadLatestOccurrence: true,
        loadOccurrenceTrend: true,
      },
    ],
    [
      ExceptionDetailSection.StackTrace,
      {
        ...NOTHING_EXTRA,
        loadStackTrace: true,
        loadLatestOccurrence: true,
        resolveStackFrames: true,
      },
    ],
    [ExceptionDetailSection.Occurrences, { ...NOTHING_EXTRA }],
    [
      ExceptionDetailSection.Context,
      {
        ...NOTHING_EXTRA,
        loadLatestOccurrence: true,
        loadTraceBreadcrumbs: true,
        loadOccurrenceAttributes: true,
      },
    ],
    [
      ExceptionDetailSection.Logs,
      { ...NOTHING_EXTRA, loadLatestOccurrence: true },
    ],
    [
      ExceptionDetailSection.AIAssistance,
      { ...NOTHING_EXTRA, loadAIAssistance: true },
    ],
    [
      ExceptionDetailSection.Settings,
      {
        ...NOTHING_EXTRA,
        loadTriageHistory: true,
        showHeaderActions: false,
      },
    ],
  ];

  test.each(plans)(
    "gives %s only its required data",
    (section: ExceptionDetailSection, expected: ExceptionDetailDataPlan) => {
      expect(getExceptionDetailDataPlan(section)).toEqual(expected);
    },
  );

  test("covers every section", () => {
    expect(
      plans.map(
        ([section]: [ExceptionDetailSection, ExceptionDetailDataPlan]) => {
          return section;
        },
      ),
    ).toEqual(Object.values(ExceptionDetailSection));
  });

  test("every page resolves the service for the header", () => {
    for (const section of Object.values(ExceptionDetailSection)) {
      expect(getExceptionDetailDataPlan(section).loadServices).toBe(true);
    }
  });

  test("the full stack trace text is only read by the Stack Trace page", () => {
    const readers: Array<ExceptionDetailSection> = Object.values(
      ExceptionDetailSection,
    ).filter((section: ExceptionDetailSection) => {
      return getExceptionDetailDataPlan(section).loadStackTrace;
    });

    expect(readers).toEqual([ExceptionDetailSection.StackTrace]);
  });

  test("Settings owns the resolve and archive buttons, so the header hides its own there", () => {
    const withoutHeaderActions: Array<ExceptionDetailSection> = Object.values(
      ExceptionDetailSection,
    ).filter((section: ExceptionDetailSection) => {
      return !getExceptionDetailDataPlan(section).showHeaderActions;
    });

    expect(withoutHeaderActions).toEqual([ExceptionDetailSection.Settings]);
  });

  test("frames and breadcrumbs are only derived from an occurrence that is loaded", () => {
    for (const section of Object.values(ExceptionDetailSection)) {
      const plan: ExceptionDetailDataPlan = getExceptionDetailDataPlan(section);

      if (plan.resolveStackFrames || plan.loadTraceBreadcrumbs) {
        expect(plan.loadLatestOccurrence).toBe(true);
      }
    }
  });

  test("occurrence attributes are read only by the Context page, from the occurrence it loads", () => {
    const readers: Array<ExceptionDetailSection> = Object.values(
      ExceptionDetailSection,
    ).filter((section: ExceptionDetailSection) => {
      return getExceptionDetailDataPlan(section).loadOccurrenceAttributes;
    });

    expect(readers).toEqual([ExceptionDetailSection.Context]);

    for (const section of readers) {
      expect(getExceptionDetailDataPlan(section).loadLatestOccurrence).toBe(
        true,
      );
    }
  });
});

describe("exception occurrence query scope", () => {
  const projectId: ObjectID = new ObjectID(
    "10000000-0000-4000-8000-000000000001",
  );
  const primaryEntityId: ObjectID = new ObjectID(
    "10000000-0000-4000-8000-000000000002",
  );

  test("scopes an exception group by project, service, and fingerprint", () => {
    expect(
      buildExceptionOccurrenceQuery({
        projectId,
        primaryEntityId,
        fingerprint: "same-stack-different-service",
      }),
    ).toEqual({
      projectId,
      primaryEntityId,
      fingerprint: "same-stack-different-service",
    });
  });

  test("omits the service filter only for legacy unattributed groups", () => {
    expect(
      buildExceptionOccurrenceQuery({
        projectId,
        fingerprint: "unattributed",
      }),
    ).toEqual({
      projectId,
      fingerprint: "unattributed",
    });
  });
});

describe("buildBreadcrumbEventsFromSpans", () => {
  const time: Date = new Date("2026-09-14T11:56:00.000Z");

  test("flattens the events of every span", () => {
    const events: Array<SpanBreadcrumbEvent> = buildBreadcrumbEventsFromSpans([
      {
        events: [
          {
            name: "http.request",
            time,
            timeUnixNano: time.getTime() * 1000000,
            attributes: { "http.method": "POST" },
          },
        ],
      },
      {
        events: [
          {
            name: "exception",
            time: new Date(time.getTime() + 500),
            timeUnixNano: (time.getTime() + 500) * 1000000,
            attributes: { "exception.type": "InventoryReservationError" },
          },
        ],
      },
    ]);

    expect(
      events.map((event: SpanBreadcrumbEvent) => {
        return event.name;
      }),
    ).toEqual(["http.request", "exception"]);
    expect(events[0]!.attributes).toEqual({ "http.method": "POST" });
  });

  test("parses string times and derives a missing timeUnixNano", () => {
    const [event] = buildBreadcrumbEventsFromSpans([
      {
        events: [
          {
            name: "db.query",
            time: time.toISOString(),
            attributes: {},
          },
        ],
      },
    ]);

    expect(event!.time.toISOString()).toBe(time.toISOString());
    expect(event!.timeUnixNano).toBe(time.getTime() * 1000000);
  });

  test("derives the time from timeUnixNano when only that is present", () => {
    const [event] = buildBreadcrumbEventsFromSpans([
      {
        events: [{ name: "log", timeUnixNano: time.getTime() * 1000000 }],
      },
    ]);

    expect(event!.time.toISOString()).toBe(time.toISOString());
  });

  test("drops events whose time cannot be read instead of stamping them now", () => {
    expect(
      buildBreadcrumbEventsFromSpans([
        {
          events: [
            { name: "no-time", attributes: {} },
            { name: "bad-time", time: "not a date" },
          ],
        },
      ]),
    ).toEqual([]);
  });

  test("tolerates spans without events and malformed entries", () => {
    expect(
      buildBreadcrumbEventsFromSpans([
        {},
        { events: "nope" },
        { events: [null, 7, "x"] },
        null as unknown as { events?: unknown },
      ]),
    ).toEqual([]);
    expect(buildBreadcrumbEventsFromSpans(undefined)).toEqual([]);
  });

  test("defaults a missing name and attributes", () => {
    const [event] = buildBreadcrumbEventsFromSpans([
      { events: [{ time, attributes: "bad" }] },
    ]);

    expect(event!.name).toBe("");
    expect(event!.attributes).toEqual({});
  });
});
