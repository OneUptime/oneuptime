import { describe, expect, test } from "@jest/globals";
import {
  SECURITY_DETECTION_MATCHED_EVENTS_FIRING_DETECTIONS,
  SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX,
  SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX_BYTES,
  SECURITY_DETECTION_MATCHED_EVENTS_FULL_SHARE,
  SECURITY_DETECTION_MATCHED_EVENTS_MAX,
  SECURITY_DETECTION_MATCHED_EVENTS_MAX_BYTES,
  SECURITY_DETECTION_MATCHED_EVENT_ATTRIBUTES_MAX,
  SECURITY_DETECTION_MATCHED_EVENT_ATTRIBUTE_VALUE_MAX_LENGTH,
  SECURITY_DETECTION_MATCHED_EVENT_LIST_MAX,
  SECURITY_DETECTION_MATCHED_EVENT_TEXT_MAX_LENGTH,
  SECURITY_DETECTION_MATCHED_EVENT_VALUE_MAX_LENGTH,
  SecurityDetectionMatchedEvent,
  SecurityDetectionMatchedEvents,
  SecurityDetectionMatchedEventsShare,
  buildSecurityDetectionMatchedEvent,
  getSecurityDetectionMatchedEventsShare,
  isSecurityDetectionMatchedEventPastRetention,
  isSecurityDetectionMatchedEventsFull,
  keepSecurityDetectionMatchedEvents,
  readSecurityDetectionMatchedEvents,
} from "../../../Types/SecurityCase/SecurityDetectionMatchedEvents";
import { DETECTION_MAX_GROUPS_PER_EVALUATION } from "../../../Types/SecurityEvent/DetectionFindingConstants";
import { SECURITY_CASE_MATCHES_MAX_EVENTS } from "../../../Types/SecurityCase/SecurityCaseMatches";
import { SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS } from "../../../Types/SecurityCase/SecurityCaseEventEvidence";

/*
 * The events a detection keeps when it fires (#9619): each as the case's
 * Evidence keeps an event, shorter, with when the events table deletes it;
 * the earliest first, each once, within a count and a size; and how far
 * their requests got, added up over every firing.
 */

const SOURCE_ID: string = "88888888-8888-4888-8888-888888888888";

function row(overrides: { [column: string]: unknown } = {}): {
  [column: string]: unknown;
} {
  return {
    time: "2026-11-17 19:22:14.000000000",
    eventUid: "log:abc:0",
    primaryEntityId: SOURCE_ID,
    severityName: "Medium",
    className: "HTTP Activity",
    categoryName: "Application Activity",
    activityName: "Get",
    statusName: "Failure",
    message: "Path traversal attempt: GET /../../etc/passwd → 404",
    vendorName: "OneUptime",
    productName: "Your logs",
    ruleName: "",
    principalUser: "",
    principalHost: "",
    principalIp: "35.196.249.14",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: 443,
    processName: "",
    processCommandLine: "",
    observables: ["35.196.249.14"],
    mitreTactics: ["TA0001"],
    mitreTechniques: ["T1190"],
    attributes: {
      "oneuptime.log.id": "abc",
      "url.original": "/../../etc/passwd",
    },
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    sessionId: "",
    requestOutcome: "Rejected",
    retentionDate: "2026-11-24 19:22:20",
    ...overrides,
  };
}

function kept(
  index: number,
  overrides: { [column: string]: unknown } = {},
): SecurityDetectionMatchedEvent {
  const seconds: string = String(index % 60).padStart(2, "0");
  const minutes: string = String(Math.floor(index / 60)).padStart(2, "0");

  return buildSecurityDetectionMatchedEvent(
    row({
      eventUid: `log:abc:${index}`,
      time: `2026-11-17 19:${minutes}:${seconds}.000000000`,
      ...overrides,
    }),
  )!;
}

describe("an event as a detection keeps it", () => {
  test("keeps what the event stored, with when the events table deletes it", () => {
    const event: SecurityDetectionMatchedEvent =
      buildSecurityDetectionMatchedEvent(row())!;

    expect(event).toMatchObject({
      time: "2026-11-17T19:22:14.000Z",
      eventUid: "log:abc:0",
      sourceId: SOURCE_ID,
      severityName: "Medium",
      principalIp: "35.196.249.14",
      targetPort: 443,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      requestOutcome: "Rejected",
      retentionDate: "2026-11-24T19:22:20.000Z",
      hunt: null,
    });
    expect(event.attributes).toEqual({
      "url.original": "/../../etc/passwd",
      "oneuptime.log.id": "abc",
    });
  });

  test("keeps nothing the event did not store: every field is one of the event's own columns", () => {
    const event: SecurityDetectionMatchedEvent =
      buildSecurityDetectionMatchedEvent(
        row({
          // A column a snapshot does not read is not kept, whatever it holds.
          body: "password=hunter2",
          parentProcessCommandLine: "secret",
        }),
      )!;
    const keys: Array<string> = Object.keys(event).sort();

    expect(JSON.stringify(event)).not.toContain("hunter2");
    expect(JSON.stringify(event)).not.toContain("secret");
    expect(keys).toEqual(
      [
        ...SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS.filter((column: string) => {
          return column !== "primaryEntityId";
        }),
        "sourceId",
        "hunt",
        "retentionDate",
      ].sort(),
    );
  });

  test("cuts its longer text, its short values, its lists and its attributes to their bounds", () => {
    const attributes: { [key: string]: string } = {};

    for (let index: number = 0; index < 60; index++) {
      attributes[`custom.${String(index).padStart(2, "0")}`] = "v".repeat(
        SECURITY_DETECTION_MATCHED_EVENT_ATTRIBUTE_VALUE_MAX_LENGTH + 50,
      );
    }

    // The card's own attribute sorts after every custom one, and is still kept.
    attributes["oneuptime.log.id"] = "line-1";

    const event: SecurityDetectionMatchedEvent =
      buildSecurityDetectionMatchedEvent(
        row({
          message: "m".repeat(5000),
          processCommandLine: "c".repeat(5000),
          principalUser: "u".repeat(2000),
          observables: Array.from({ length: 50 }, (_: unknown, i: number) => {
            return `10.0.0.${i}`;
          }),
          attributes,
        }),
      )!;

    expect(event.message).toHaveLength(
      SECURITY_DETECTION_MATCHED_EVENT_TEXT_MAX_LENGTH,
    );
    expect(event.processCommandLine).toHaveLength(
      SECURITY_DETECTION_MATCHED_EVENT_TEXT_MAX_LENGTH,
    );
    expect(event.principalUser).toHaveLength(
      SECURITY_DETECTION_MATCHED_EVENT_VALUE_MAX_LENGTH,
    );
    expect(event.observables).toHaveLength(
      SECURITY_DETECTION_MATCHED_EVENT_LIST_MAX,
    );
    expect(Object.keys(event.attributes)).toHaveLength(
      SECURITY_DETECTION_MATCHED_EVENT_ATTRIBUTES_MAX,
    );
    expect(event.attributes["oneuptime.log.id"]).toBe("line-1");
    expect(Object.keys(event.attributes)[0]).toBe("oneuptime.log.id");
    expect(event.attributes["custom.00"]).toHaveLength(
      SECURITY_DETECTION_MATCHED_EVENT_ATTRIBUTE_VALUE_MAX_LENGTH,
    );
  });

  test("a row that names no event is none", () => {
    expect(
      buildSecurityDetectionMatchedEvent(row({ eventUid: "", time: "" })),
    ).toBeNull();
  });

  test("a retention date it cannot read is not known, never a guess", () => {
    expect(
      buildSecurityDetectionMatchedEvent(row({ retentionDate: "soon" }))!
        .retentionDate,
    ).toBe("");
    expect(
      buildSecurityDetectionMatchedEvent(row({ retentionDate: undefined }))!
        .retentionDate,
    ).toBe("");
  });

  test("keeps as many events as the card lists", () => {
    expect(SECURITY_DETECTION_MATCHED_EVENTS_MAX).toBe(
      SECURITY_CASE_MATCHES_MAX_EVENTS,
    );
  });
});

describe("what a detection keeps when it fires", () => {
  test("its first firing's events, the earliest first, and their outcomes", () => {
    const result: SecurityDetectionMatchedEvents =
      keepSecurityDetectionMatchedEvents({
        kept: null,
        firing: {
          events: [kept(2), kept(0), kept(1)],
          outcomes: { Rejected: 9, "": 3 },
        },
      });

    expect(
      result.events.map((event: SecurityDetectionMatchedEvent): string => {
        return event.eventUid;
      }),
    ).toEqual(["log:abc:0", "log:abc:1", "log:abc:2"]);
    expect(result.outcomes).toEqual({ Rejected: 9, "": 3 });
  });

  test("a firing again adds its events after the ones kept, each once, and adds up the outcomes", () => {
    const first: SecurityDetectionMatchedEvents =
      keepSecurityDetectionMatchedEvents({
        kept: null,
        firing: { events: [kept(5), kept(6)], outcomes: { Rejected: 2 } },
      });

    const second: SecurityDetectionMatchedEvents =
      keepSecurityDetectionMatchedEvents({
        kept: first,
        firing: {
          // One it kept already, and one older than any it kept.
          events: [kept(6), kept(1), kept(7)],
          outcomes: { Rejected: 1, "Reached App": 2 },
        },
      });

    expect(
      second.events.map((event: SecurityDetectionMatchedEvent): string => {
        return event.eventUid;
      }),
    ).toEqual(["log:abc:5", "log:abc:6", "log:abc:1", "log:abc:7"]);
    expect(second.outcomes).toEqual({ Rejected: 3, "Reached App": 2 });
  });

  test("keeps at most its bound of events, and a full detection takes in no more", () => {
    const firing: Array<SecurityDetectionMatchedEvent> = Array.from(
      { length: SECURITY_DETECTION_MATCHED_EVENTS_MAX + 10 },
      (_: unknown, index: number): SecurityDetectionMatchedEvent => {
        return kept(index);
      },
    );

    const full: SecurityDetectionMatchedEvents =
      keepSecurityDetectionMatchedEvents({
        kept: null,
        firing: { events: firing, outcomes: { Rejected: 35 } },
      });

    expect(full.events).toHaveLength(SECURITY_DETECTION_MATCHED_EVENTS_MAX);
    expect(full.events[0]!.eventUid).toBe("log:abc:0");
    expect(isSecurityDetectionMatchedEventsFull(full)).toBe(true);
    expect(isSecurityDetectionMatchedEventsFull(null)).toBe(false);

    const again: SecurityDetectionMatchedEvents =
      keepSecurityDetectionMatchedEvents({
        kept: full,
        firing: { events: [kept(100)], outcomes: { Rejected: 1 } },
      });

    expect(again.events).toEqual(full.events);
    // The firing still counts.
    expect(again.outcomes).toEqual({ Rejected: 36 });
  });

  test("keeps within its size, but always its first event", () => {
    const big: (index: number) => SecurityDetectionMatchedEvent = (
      index: number,
    ): SecurityDetectionMatchedEvent => {
      const attributes: { [key: string]: string } = {};

      for (let key: number = 0; key < 40; key++) {
        attributes[`a.${key}`] = "x".repeat(450);
      }

      return kept(index, {
        message: "m".repeat(SECURITY_DETECTION_MATCHED_EVENT_TEXT_MAX_LENGTH),
        attributes,
      });
    };

    const result: SecurityDetectionMatchedEvents =
      keepSecurityDetectionMatchedEvents({
        kept: null,
        firing: {
          events: Array.from({ length: 10 }, (_: unknown, index: number) => {
            return big(index);
          }),
          outcomes: {},
        },
      });

    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.length).toBeLessThan(10);
    expect(JSON.stringify(result.events).length).toBeLessThanOrEqual(
      SECURITY_DETECTION_MATCHED_EVENTS_MAX_BYTES,
    );
  });

  test("an event with no id is told apart by when it happened and what it said", () => {
    const result: SecurityDetectionMatchedEvents =
      keepSecurityDetectionMatchedEvents({
        kept: null,
        firing: {
          events: [
            kept(1, { eventUid: "" }),
            kept(1, { eventUid: "" }),
            kept(1, { eventUid: "", message: "another" }),
          ],
          outcomes: {},
        },
      });

    expect(result.events).toHaveLength(2);
  });
});

/*
 * One firing's budget, across every group it fires for (#9795): as much
 * as 40 full detections keep - 1,000 events and 2.5 MB - shared equally by
 * its groups, never more than a detection's bound and never less than one
 * event.
 */
describe("what one firing keeps, shared by its groups", () => {
  test("the budget is 40 full detections: 1,000 events and 2.5 MB", () => {
    expect(SECURITY_DETECTION_MATCHED_EVENTS_FIRING_DETECTIONS).toBe(40);
    expect(SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX).toBe(1000);
    expect(SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX_BYTES).toBe(
      2.5 * 1024 * 1024,
    );
    expect(SECURITY_DETECTION_MATCHED_EVENTS_FULL_SHARE).toEqual({
      maxEvents: SECURITY_DETECTION_MATCHED_EVENTS_MAX,
      maxBytes: SECURITY_DETECTION_MATCHED_EVENTS_MAX_BYTES,
    });
  });

  test.each([
    [1, 25, 64 * 1024],
    [10, 25, 64 * 1024],
    [40, 25, 64 * 1024],
    [41, 24, Math.floor((2.5 * 1024 * 1024) / 41)],
    [64, 15, 40 * 1024],
    [100, 10, Math.floor((2.5 * 1024 * 1024) / 100)],
  ])(
    "a firing for %i groups keeps %i events of each, in %i bytes",
    (groups: number, events: number, bytes: number) => {
      expect(getSecurityDetectionMatchedEventsShare(groups)).toEqual({
        maxEvents: events,
        maxBytes: bytes,
      });
    },
  );

  test("at the most groups a run opens, each keeps twice the five the card lists first", () => {
    expect(
      getSecurityDetectionMatchedEventsShare(
        DETECTION_MAX_GROUPS_PER_EVALUATION,
      ).maxEvents,
    ).toBe(10);
  });

  test("however many groups fire, all of them together keep no more than the budget", () => {
    for (let groups: number = 1; groups <= 1000; groups++) {
      const share: SecurityDetectionMatchedEventsShare =
        getSecurityDetectionMatchedEventsShare(groups);

      expect(share.maxEvents).toBeGreaterThanOrEqual(1);
      expect(share.maxEvents).toBeLessThanOrEqual(
        SECURITY_DETECTION_MATCHED_EVENTS_MAX,
      );
      expect(share.maxBytes).toBeLessThanOrEqual(
        SECURITY_DETECTION_MATCHED_EVENTS_MAX_BYTES,
      );

      // Past the budget only where each group keeps its one first event.
      if (share.maxEvents > 1) {
        expect(share.maxEvents * groups).toBeLessThanOrEqual(
          SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX,
        );
      }

      expect(share.maxBytes * groups).toBeLessThanOrEqual(
        SECURITY_DETECTION_MATCHED_EVENTS_FIRING_MAX_BYTES,
      );
    }
  });

  test("a count it cannot read is one group", () => {
    for (const groups of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(getSecurityDetectionMatchedEventsShare(groups)).toEqual(
        SECURITY_DETECTION_MATCHED_EVENTS_FULL_SHARE,
      );
    }
  });

  test("a group keeps its share of a firing, the earliest first", () => {
    const share: SecurityDetectionMatchedEventsShare =
      getSecurityDetectionMatchedEventsShare(100);

    const result: SecurityDetectionMatchedEvents =
      keepSecurityDetectionMatchedEvents({
        kept: null,
        firing: {
          events: Array.from({ length: 30 }, (_: unknown, index: number) => {
            return kept(29 - index);
          }),
          outcomes: { Rejected: 30 },
        },
        share,
      });

    expect(
      result.events.map((event: SecurityDetectionMatchedEvent): string => {
        return event.eventUid;
      }),
    ).toEqual(
      Array.from({ length: 10 }, (_: unknown, index: number) => {
        return `log:abc:${index}`;
      }),
    );
    // How far all of their requests got, not only the kept ones'.
    expect(result.outcomes).toEqual({ Rejected: 30 });
  });

  test("a share never lets a detection keep more than its own bound", () => {
    const result: SecurityDetectionMatchedEvents =
      keepSecurityDetectionMatchedEvents({
        kept: null,
        firing: {
          events: Array.from({ length: 40 }, (_: unknown, index: number) => {
            return kept(index);
          }),
          outcomes: {},
        },
        share: { maxEvents: 500, maxBytes: 10 * 1024 * 1024 },
      });

    expect(result.events).toHaveLength(SECURITY_DETECTION_MATCHED_EVENTS_MAX);
  });

  test("a detection that fires again tops its events up to the full 25, past its first firing's share", () => {
    const first: SecurityDetectionMatchedEvents =
      keepSecurityDetectionMatchedEvents({
        kept: null,
        firing: {
          events: Array.from({ length: 30 }, (_: unknown, index: number) => {
            return kept(index);
          }),
          outcomes: {},
        },
        share: getSecurityDetectionMatchedEventsShare(100),
      });

    expect(first.events).toHaveLength(10);

    // Its next firing, joined to what it kept as the case's detection does.
    const again: SecurityDetectionMatchedEvents =
      keepSecurityDetectionMatchedEvents({
        kept: first,
        firing: {
          events: Array.from({ length: 30 }, (_: unknown, index: number) => {
            return kept(100 + index);
          }),
          outcomes: {},
        },
      });

    expect(again.events).toHaveLength(SECURITY_DETECTION_MATCHED_EVENTS_MAX);
  });
});

describe("what a detection kept, read back", () => {
  test("reads what it wrote", () => {
    const written: SecurityDetectionMatchedEvents =
      keepSecurityDetectionMatchedEvents({
        kept: null,
        firing: { events: [kept(0), kept(1)], outcomes: { Rejected: 12 } },
      });

    expect(
      readSecurityDetectionMatchedEvents(JSON.parse(JSON.stringify(written))),
    ).toEqual(written);
  });

  test("a detection that kept nothing, or a value of another shape, is none", () => {
    expect(readSecurityDetectionMatchedEvents(null)).toBeNull();
    expect(readSecurityDetectionMatchedEvents(undefined)).toBeNull();
    expect(readSecurityDetectionMatchedEvents([])).toBeNull();
    expect(readSecurityDetectionMatchedEvents("events")).toBeNull();
    expect(
      readSecurityDetectionMatchedEvents({ events: [], outcomes: {} }),
    ).toBeNull();
  });

  test("leaves out what does not read, never trusting a stored value's type", () => {
    const read: SecurityDetectionMatchedEvents | null =
      readSecurityDetectionMatchedEvents({
        events: [
          "not an event",
          { message: "no id and no time" },
          {
            ...kept(0),
            targetPort: "not a port",
            observables: "not a list",
          },
        ],
        outcomes: { Rejected: "7", Errored: -2, "Reached App": "x" },
      });

    expect(read!.events).toHaveLength(1);
    expect(read!.events[0]!.targetPort).toBeNull();
    expect(read!.events[0]!.observables).toEqual([]);
    expect(read!.outcomes).toEqual({ Rejected: 7 });
  });

  test("reads at most its bound of events", () => {
    const stored: Array<SecurityDetectionMatchedEvent> = Array.from(
      { length: SECURITY_DETECTION_MATCHED_EVENTS_MAX + 5 },
      (_: unknown, index: number): SecurityDetectionMatchedEvent => {
        return kept(index);
      },
    );

    expect(
      readSecurityDetectionMatchedEvents({ events: stored, outcomes: {} })!
        .events,
    ).toHaveLength(SECURITY_DETECTION_MATCHED_EVENTS_MAX);
  });
});

describe("whether a kept event is past its retention", () => {
  const now: Date = new Date("2026-12-01T00:00:00.000Z");

  test("it is once its retention date has gone by", () => {
    expect(
      isSecurityDetectionMatchedEventPastRetention({
        event: { retentionDate: "2026-11-24T19:22:20.000Z" },
        now,
      }),
    ).toBe(true);
    expect(
      isSecurityDetectionMatchedEventPastRetention({
        event: { retentionDate: "2026-12-24T19:22:20.000Z" },
        now,
      }),
    ).toBe(false);
  });

  test("an event whose retention is not known is never said to be past it", () => {
    expect(
      isSecurityDetectionMatchedEventPastRetention({
        event: { retentionDate: "" },
        now,
      }),
    ).toBe(false);
    expect(
      isSecurityDetectionMatchedEventPastRetention({
        event: { retentionDate: "not a date" },
        now,
      }),
    ).toBe(false);
  });
});
