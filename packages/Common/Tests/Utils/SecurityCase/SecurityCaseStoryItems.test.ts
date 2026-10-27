import { describe, expect, test } from "@jest/globals";
import {
  SECURITY_CASE_STORY_MAX_TEXT_LENGTH,
  SECURITY_CASE_STORY_RUN_GAP_IN_MINUTES,
  SecurityCaseStoryFilter,
  SecurityCaseStoryItemJson,
  SecurityCaseStoryItemKind,
} from "../../../Types/SecurityCase/SecurityCaseContext";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  SECURITY_CASE_STORY_KEEP_ORDER,
  SECURITY_CASE_STORY_SAME_TIME_ORDER,
  StoryEventRow,
  buildStoryExceptionItems,
  compareStoryItems,
  countStoryItemsByFilter,
  cutStoryText,
  filterStoryItems,
  firstLine,
  getStoryEventPrincipal,
  getStoryEventRunKey,
  isMoreTelling,
  mergeStoryItems,
  readClickhouseTime,
  readStoryEventRow,
  runStoryEvents,
} from "../../../Utils/SecurityCase/SecurityCaseStoryItems";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

/*
 * A case's Story, told from rows already read: a scanner's ninety-six probes
 * are one run, headed by the request that got furthest; every exception a
 * request threw is its own item; everything sits on one time axis, oldest
 * first; and a story that holds too much keeps what tells it best.
 */

const START: Date = new Date("2026-10-27T06:00:00.000Z");

function minutesAfter(minutes: number): Date {
  return new Date(START.getTime() + minutes * 60 * 1000);
}

function eventRow(overrides: Partial<StoryEventRow> = {}): StoryEventRow {
  return {
    time: START,
    eventUid: "log:1",
    className: "HTTP Activity",
    message: "SQL injection attempt: GET /sitemap.xml?offset=1 → 404",
    severityName: "Low",
    severityId: 2,
    principalUser: "",
    principalHost: "",
    principalIp: "203.0.113.7",
    targetResource: "/sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)",
    requestOutcome: SecurityEventRequestOutcome.Rejected,
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId: "00f067aa0ba902b7",
    sessionId: "",
    attackKind: "sql-injection",
    exceptionFingerprint: "",
    exceptionType: "",
    exceptionMessage: "",
    ...overrides,
  };
}

function item(
  overrides: Partial<SecurityCaseStoryItemJson> & {
    key: string;
    kind: SecurityCaseStoryItemKind;
  },
): SecurityCaseStoryItemJson {
  return {
    time: START.toISOString(),
    title: overrides.key,
    links: {},
    ...overrides,
  };
}

describe("reading the events a story is told from", () => {
  test("reads a ClickHouse time as UTC, whatever way it is written", () => {
    expect(
      readClickhouseTime("2026-10-27 06:45:00.123456789")?.toISOString(),
    ).toBe("2026-10-27T06:45:00.123Z");
    expect(readClickhouseTime("2026-10-27T06:45:00Z")?.toISOString()).toBe(
      "2026-10-27T06:45:00.000Z",
    );
    expect(readClickhouseTime("")).toBeNull();
    expect(readClickhouseTime(null)).toBeNull();
    expect(readClickhouseTime("not a time")).toBeNull();
  });

  test("reads a row's columns, and the attack and exception its attributes name", () => {
    expect(
      readStoryEventRow({
        time: "2026-10-27 06:45:00.000000000",
        eventUid: "log:abc:0",
        className: "HTTP Activity",
        message: "SQL injection attempt: GET /x → 500",
        severityName: "High",
        severityId: "4",
        principalIp: "203.0.113.7",
        principalUser: "",
        principalHost: "",
        targetResource: "/x?id=1' or 1=1",
        requestOutcome: "Errored",
        traceId: "trace-1",
        spanId: "span-1",
        sessionId: "session-1",
        attributes: {
          "web.attack.kind": "sql-injection",
          "oneuptime.exception.fingerprint": "fp-1",
          "oneuptime.exception.type": "QueryFailedError",
          "oneuptime.exception.message": "syntax error at or near \"or\"",
        },
      }),
    ).toEqual({
      time: new Date("2026-10-27T06:45:00.000Z"),
      eventUid: "log:abc:0",
      className: "HTTP Activity",
      message: "SQL injection attempt: GET /x → 500",
      severityName: "High",
      severityId: 4,
      principalUser: "",
      principalHost: "",
      principalIp: "203.0.113.7",
      targetResource: "/x?id=1' or 1=1",
      requestOutcome: "Errored",
      traceId: "trace-1",
      spanId: "span-1",
      sessionId: "session-1",
      attackKind: "sql-injection",
      exceptionFingerprint: "fp-1",
      exceptionType: "QueryFailedError",
      exceptionMessage: 'syntax error at or near "or"',
    });
  });

  test("leaves out a row with no usable time, and reads a missing number as 0", () => {
    expect(readStoryEventRow({ message: "x" })).toBeNull();
    expect(
      readStoryEventRow({ time: "2026-10-27T06:00:00Z", severityId: "high" })
        ?.severityId,
    ).toBe(0);
    expect(
      readStoryEventRow({ time: "2026-10-27T06:00:00Z", attributes: [] })
        ?.attackKind,
    ).toBe("");
  });

  test("says who acted by the address first, then the user, then the host", () => {
    expect(getStoryEventPrincipal(eventRow())).toBe("203.0.113.7");
    expect(
      getStoryEventPrincipal(
        eventRow({ principalIp: "", principalUser: "kim", principalHost: "h" }),
      ),
    ).toBe("kim");
    expect(
      getStoryEventPrincipal(
        eventRow({ principalIp: "", principalUser: "", principalHost: "web-1" }),
      ),
    ).toBe("web-1");
    expect(
      getStoryEventPrincipal(
        eventRow({ principalIp: "", principalUser: "", principalHost: "" }),
      ),
    ).toBe("");
  });
});

describe("telling alike events as one run", () => {
  test("a scanner's ninety-six probes from one address are one run, with how far each got", () => {
    const rows: Array<StoryEventRow> = Array.from(
      { length: 96 },
      (_value: unknown, index: number): StoryEventRow => {
        return eventRow({
          eventUid: `log:${index}`,
          time: minutesAfter(index),
          requestOutcome:
            index === 40
              ? SecurityEventRequestOutcome.ReachedDatabase
              : SecurityEventRequestOutcome.Rejected,
          severityName: index === 40 ? "Critical" : "Low",
          severityId: index === 40 ? 5 : 2,
          message: `probe ${index}`,
        });
      },
    );

    const items: Array<SecurityCaseStoryItemJson> = runStoryEvents(rows);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: SecurityCaseStoryItemKind.Events,
      time: START.toISOString(),
      endTime: minutesAfter(95).toISOString(),
      count: 96,
      // Headed by the request that got furthest.
      title: "probe 40",
      requestOutcome: SecurityEventRequestOutcome.ReachedDatabase,
      severityName: "Critical",
      className: "HTTP Activity",
      outcomes: {
        [SecurityEventRequestOutcome.Rejected]: 95,
        [SecurityEventRequestOutcome.ReachedDatabase]: 1,
      },
      links: {
        eventUid: "log:40",
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        observable: "203.0.113.7",
      },
    });
  });

  test("a quiet spell longer than the gap starts a new run", () => {
    const items: Array<SecurityCaseStoryItemJson> = runStoryEvents([
      eventRow({ eventUid: "a", time: minutesAfter(0) }),
      eventRow({
        eventUid: "b",
        time: minutesAfter(SECURITY_CASE_STORY_RUN_GAP_IN_MINUTES),
      }),
      eventRow({
        eventUid: "c",
        time: minutesAfter(SECURITY_CASE_STORY_RUN_GAP_IN_MINUTES * 2 + 1),
      }),
    ]);

    expect(
      items.map((story: SecurityCaseStoryItemJson): number | undefined => {
        return story.count;
      }),
    ).toEqual([2, 1]);
  });

  test("events from another address, of another class or another attack run on their own", () => {
    const items: Array<SecurityCaseStoryItemJson> = runStoryEvents([
      eventRow({ eventUid: "a" }),
      eventRow({ eventUid: "b", principalIp: "198.51.100.9" }),
      eventRow({ eventUid: "c", className: "Authentication" }),
      eventRow({ eventUid: "d", attackKind: "path-traversal" }),
      eventRow({ eventUid: "e", time: minutesAfter(1) }),
    ]);

    expect(items).toHaveLength(4);
    expect(
      items.find((story: SecurityCaseStoryItemJson): boolean => {
        return story.links.eventUid === "a";
      })?.count,
    ).toBe(2);
  });

  test("two attackers taking turns are still two runs", () => {
    const rows: Array<StoryEventRow> = [];

    for (let index: number = 0; index < 10; index++) {
      rows.push(
        eventRow({
          eventUid: `x${index}`,
          time: minutesAfter(index * 2),
          principalIp: "203.0.113.7",
        }),
        eventRow({
          eventUid: `y${index}`,
          time: minutesAfter(index * 2 + 1),
          principalIp: "198.51.100.9",
        }),
      );
    }

    expect(
      runStoryEvents(rows).map((story: SecurityCaseStoryItemJson): number => {
        return story.count || 0;
      }),
    ).toEqual([10, 10]);
  });

  test("runs by the class and the actor whatever their case", () => {
    expect(getStoryEventRunKey(eventRow({ className: "HTTP Activity" }))).toBe(
      getStoryEventRunKey(eventRow({ className: "http activity" })),
    );
    expect(
      runStoryEvents([
        eventRow({ principalIp: "", principalHost: "WEB-1" }),
        eventRow({ principalIp: "", principalHost: "web-1" }),
      ]),
    ).toHaveLength(1);
  });

  test("one event is an item of its own: no span of time, no tally", () => {
    const items: Array<SecurityCaseStoryItemJson> = runStoryEvents([
      eventRow({ sessionId: "session-1" }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]!.endTime).toBeUndefined();
    expect(items[0]!.outcomes).toBeUndefined();
    expect(items[0]!.count).toBe(1);
    expect(items[0]!.links).toEqual({
      eventUid: "log:1",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      sessionId: "session-1",
      observable: "203.0.113.7",
    });
    // The target is said beside the message, when it is not the message.
    expect(items[0]!.detail).toBe(
      "/sitemap.xml?offset=1;SELECT%20IF((SLEEP(16)),1,2356)",
    );
  });

  test("an event that names nobody links no value to look it up by", () => {
    const items: Array<SecurityCaseStoryItemJson> = runStoryEvents([
      eventRow({ principalIp: "", traceId: "", spanId: "" }),
    ]);

    expect(items[0]!.links).toEqual({ eventUid: "log:1" });
  });

  test("an event with no message is told by its class", () => {
    expect(runStoryEvents([eventRow({ message: "" })])[0]!.title).toBe(
      "HTTP Activity",
    );
    expect(
      runStoryEvents([eventRow({ message: "", className: "" })])[0]!.title,
    ).toBe("Security event");
  });

  test("leads a run by how far a request got, then by severity, then by who came first", () => {
    const rejected: StoryEventRow = eventRow({
      requestOutcome: SecurityEventRequestOutcome.Rejected,
      severityId: 5,
    });
    const reached: StoryEventRow = eventRow({
      requestOutcome: SecurityEventRequestOutcome.ReachedApp,
      severityId: 1,
    });

    expect(isMoreTelling(reached, rejected)).toBe(true);
    expect(isMoreTelling(rejected, reached)).toBe(false);
    expect(
      isMoreTelling(
        eventRow({ severityId: 4 }),
        eventRow({ severityId: 3 }),
      ),
    ).toBe(true);
    expect(
      isMoreTelling(
        eventRow({ time: minutesAfter(0) }),
        eventRow({ time: minutesAfter(1) }),
      ),
    ).toBe(true);
    expect(
      isMoreTelling(
        eventRow({ time: minutesAfter(1) }),
        eventRow({ time: minutesAfter(0) }),
      ),
    ).toBe(false);
  });

  test("whatever order the rows come in, every event is told once, in a run of its kind", () => {
    const random: SeededRandom = seededRandom(20261027);
    const addresses: Array<string> = [
      "203.0.113.7",
      "198.51.100.9",
      "192.0.2.4",
    ];
    const rows: Array<StoryEventRow> = Array.from(
      { length: 200 },
      (_value: unknown, index: number): StoryEventRow => {
        return eventRow({
          eventUid: `log:${index}`,
          time: minutesAfter(random(600)),
          principalIp: addresses[random(addresses.length)]!,
          requestOutcome:
            random(5) === 0
              ? SecurityEventRequestOutcome.ReachedApp
              : SecurityEventRequestOutcome.Rejected,
        });
      },
    );

    const told: Array<SecurityCaseStoryItemJson> = runStoryEvents(rows);
    const again: Array<SecurityCaseStoryItemJson> = runStoryEvents(
      shuffled(rows, random),
    );

    expect(
      told.reduce((sum: number, story: SecurityCaseStoryItemJson): number => {
        return sum + (story.count || 0);
      }, 0),
    ).toBe(200);
    // The same runs, told the same way, whatever order the rows came in.
    expect(
      again.map((story: SecurityCaseStoryItemJson): [string, number] => {
        return [story.time, story.count || 0];
      }),
    ).toEqual(
      told.map((story: SecurityCaseStoryItemJson): [string, number] => {
        return [story.time, story.count || 0];
      }),
    );

    for (const story of told) {
      const tally: number = Object.values(story.outcomes || {}).reduce(
        (sum: number, count: number): number => {
          return sum + count;
        },
        0,
      );

      expect(story.outcomes ? tally : 1).toBe(story.count);
    }
  });
});

describe("the exceptions the requests threw", () => {
  test("each thrown exception is one item, at the first time it was thrown", () => {
    const items: Array<SecurityCaseStoryItemJson> = buildStoryExceptionItems([
      eventRow({
        time: minutesAfter(5),
        exceptionFingerprint: "fp-1",
        exceptionType: "QueryFailedError",
        exceptionMessage: "syntax error",
        traceId: "trace-late",
      }),
      eventRow({
        time: minutesAfter(1),
        exceptionFingerprint: "fp-1",
        exceptionType: "QueryFailedError",
        exceptionMessage: "syntax error",
        traceId: "trace-early",
      }),
      eventRow({
        time: minutesAfter(3),
        exceptionFingerprint: "fp-2",
        exceptionType: "",
        exceptionMessage: "",
      }),
      eventRow({ time: minutesAfter(2) }),
    ]);

    expect(items).toEqual([
      {
        key: "exception:fp-1",
        kind: SecurityCaseStoryItemKind.Exception,
        time: minutesAfter(1).toISOString(),
        title: "QueryFailedError",
        detail: "syntax error",
        count: 2,
        links: {
          exceptionFingerprint: "fp-1",
          traceId: "trace-early",
          spanId: "00f067aa0ba902b7",
        },
      },
      {
        key: "exception:fp-2",
        kind: SecurityCaseStoryItemKind.Exception,
        time: minutesAfter(3).toISOString(),
        title: "Exception",
        count: 1,
        links: {
          exceptionFingerprint: "fp-2",
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: "00f067aa0ba902b7",
        },
      },
    ]);
  });

  test("a request that threw nothing adds no exception", () => {
    expect(buildStoryExceptionItems([eventRow(), eventRow()])).toEqual([]);
  });
});

describe("one time axis, oldest first", () => {
  test("sorts by time, and at one moment tells what changed before what fired, and the response last", () => {
    const merged: Array<SecurityCaseStoryItemJson> = mergeStoryItems(
      [
        item({ key: "note", kind: SecurityCaseStoryItemKind.Note }),
        item({ key: "detection", kind: SecurityCaseStoryItemKind.Detection }),
        item({ key: "change", kind: SecurityCaseStoryItemKind.Change }),
        item({
          key: "early",
          kind: SecurityCaseStoryItemKind.Note,
          time: minutesAfter(-1).toISOString(),
        }),
      ],
      100,
    ).items;

    expect(
      merged.map((story: SecurityCaseStoryItemJson): string => {
        return story.key;
      }),
    ).toEqual(["early", "change", "detection", "note"]);
  });

  test("tells an item once, however many times it was read", () => {
    const merged: { items: Array<SecurityCaseStoryItemJson> } =
      mergeStoryItems(
        [
          item({ key: "a", kind: SecurityCaseStoryItemKind.Note }),
          item({ key: "a", kind: SecurityCaseStoryItemKind.Note }),
        ],
        10,
      );

    expect(merged.items).toHaveLength(1);
  });

  test("names every kind in both orders, once", () => {
    for (const order of [
      SECURITY_CASE_STORY_KEEP_ORDER,
      SECURITY_CASE_STORY_SAME_TIME_ORDER,
    ]) {
      expect([...order].sort()).toEqual(
        Object.values(SecurityCaseStoryItemKind).sort(),
      );
    }
  });

  test("orders items at the same moment of the same kind by key, so a read again lays out the same", () => {
    expect(
      compareStoryItems(
        item({ key: "b", kind: SecurityCaseStoryItemKind.Note }),
        item({ key: "a", kind: SecurityCaseStoryItemKind.Note }),
      ),
    ).toBeGreaterThan(0);
    expect(
      compareStoryItems(
        item({ key: "a", kind: SecurityCaseStoryItemKind.Note }),
        item({ key: "a", kind: SecurityCaseStoryItemKind.Note }),
      ),
    ).toBe(0);
  });

  test("a story within its bound is not cut", () => {
    expect(
      mergeStoryItems(
        [item({ key: "a", kind: SecurityCaseStoryItemKind.Note })],
        1,
      ).isTruncated,
    ).toBe(false);
  });
});

describe("a story that holds too much", () => {
  test("keeps how the case opened, its detections and the furthest-reaching events, and leaves out notes and quiet events first", () => {
    const items: Array<SecurityCaseStoryItemJson> = [
      item({ key: "opened", kind: SecurityCaseStoryItemKind.CaseOpened }),
      item({ key: "detection", kind: SecurityCaseStoryItemKind.Detection }),
      item({
        key: "reached-db",
        kind: SecurityCaseStoryItemKind.Events,
        requestOutcome: SecurityEventRequestOutcome.ReachedDatabase,
        time: minutesAfter(10).toISOString(),
      }),
      item({
        key: "rejected",
        kind: SecurityCaseStoryItemKind.Events,
        requestOutcome: SecurityEventRequestOutcome.Rejected,
        time: minutesAfter(5).toISOString(),
      }),
      item({ key: "note", kind: SecurityCaseStoryItemKind.Note }),
    ];

    const merged: {
      items: Array<SecurityCaseStoryItemJson>;
      isTruncated: boolean;
    } = mergeStoryItems(items, 3);

    expect(merged.isTruncated).toBe(true);
    expect(
      merged.items.map((story: SecurityCaseStoryItemJson): string => {
        return story.key;
      }),
    ).toEqual(["detection", "opened", "reached-db"]);
  });

  test("between runs that got as far, keeps the bigger", () => {
    const merged: Array<SecurityCaseStoryItemJson> = mergeStoryItems(
      [
        item({
          key: "small",
          kind: SecurityCaseStoryItemKind.Events,
          count: 2,
        }),
        item({
          key: "big",
          kind: SecurityCaseStoryItemKind.Events,
          count: 50,
        }),
      ],
      1,
    ).items;

    expect(merged[0]!.key).toBe("big");
  });

  test("a bound of nothing keeps nothing, and says so", () => {
    expect(
      mergeStoryItems(
        [item({ key: "a", kind: SecurityCaseStoryItemKind.Note })],
        0,
      ),
    ).toEqual({ items: [], isTruncated: true });
  });
});

describe("narrowing a story", () => {
  const story: Array<SecurityCaseStoryItemJson> = [
    item({ key: "opened", kind: SecurityCaseStoryItemKind.CaseOpened }),
    item({ key: "detection", kind: SecurityCaseStoryItemKind.Detection }),
    item({ key: "events", kind: SecurityCaseStoryItemKind.Events }),
    item({ key: "exception", kind: SecurityCaseStoryItemKind.Exception }),
    item({ key: "change", kind: SecurityCaseStoryItemKind.Change }),
    item({ key: "incident", kind: SecurityCaseStoryItemKind.Incident }),
    item({ key: "alert", kind: SecurityCaseStoryItemKind.Alert }),
    item({ key: "run", kind: SecurityCaseStoryItemKind.PlaybookRun }),
    item({ key: "note", kind: SecurityCaseStoryItemKind.Note }),
    item({ key: "closed", kind: SecurityCaseStoryItemKind.Milestone }),
  ];

  function keysFor(filter: SecurityCaseStoryFilter): Array<string> {
    return filterStoryItems(story, filter).map(
      (entry: SecurityCaseStoryItemJson): string => {
        return entry.key;
      },
    );
  }

  test("to the attack, what changed, what it set off, or the response", () => {
    expect(keysFor(SecurityCaseStoryFilter.All)).toHaveLength(story.length);
    expect(keysFor(SecurityCaseStoryFilter.Attack)).toEqual([
      "detection",
      "events",
      "exception",
    ]);
    expect(keysFor(SecurityCaseStoryFilter.Changes)).toEqual(["change"]);
    expect(keysFor(SecurityCaseStoryFilter.IncidentsAndAlerts)).toEqual([
      "incident",
      "alert",
    ]);
    expect(keysFor(SecurityCaseStoryFilter.Response)).toEqual([
      "opened",
      "run",
      "note",
      "closed",
    ]);
  });

  test("counts what each filter shows, the whole story under All", () => {
    expect(countStoryItemsByFilter(story)).toEqual({
      [SecurityCaseStoryFilter.All]: 10,
      [SecurityCaseStoryFilter.Attack]: 3,
      [SecurityCaseStoryFilter.Changes]: 1,
      [SecurityCaseStoryFilter.IncidentsAndAlerts]: 2,
      [SecurityCaseStoryFilter.Response]: 4,
    });
  });
});

describe("the text an item keeps", () => {
  test("cuts a long text with an ellipsis, and trims", () => {
    const long: string = "x".repeat(SECURITY_CASE_STORY_MAX_TEXT_LENGTH + 50);

    expect(cutStoryText(long)).toHaveLength(SECURITY_CASE_STORY_MAX_TEXT_LENGTH);
    expect(cutStoryText(long).endsWith("…")).toBe(true);
    expect(cutStoryText("  short  ")).toBe("short");
    expect(cutStoryText(undefined)).toBe("");
  });

  test("a note is told by its first line", () => {
    expect(firstLine("Blocked the address at the edge.\nDetails follow.")).toBe(
      "Blocked the address at the edge.",
    );
    expect(firstLine(null)).toBe("");
  });
});
