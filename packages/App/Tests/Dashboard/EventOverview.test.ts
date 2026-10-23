import { afterEach, describe, expect, jest, test } from "@jest/globals";
import OneUptimeDate from "Common/Types/Date";
import Timezone from "Common/Types/Timezone";
import { EventStateTimelineDate } from "../../FeatureSet/Dashboard/src/Utils/EventDuration";
import {
  ACKNOWLEDGED_AFTER_PAGING_TEMPLATE,
  EventResponseTimes,
  VisibleItems,
  EVENT_STARTED_AUTOMATICALLY,
  EVENT_STARTED_BY_TEMPLATE,
  IMPACT_BEFORE_START_TEMPLATE,
  NON_BREAKING_SPACE,
  getAcknowledgedAfterPagingParts,
  getAcknowledgedAfterPagingText,
  getEarliestTimelineDate,
  getEventCreatorName,
  getEventResponseTimes,
  getEventStartTileParts,
  getEventStartTileText,
  getEventStartedByText,
  getImpactBeforeStartParts,
  getImpactBeforeStartText,
  getKnownEventCreatorName,
  getFirstTimelineDateForState,
  getFirstTimelineDateForStates,
  getTimeToStateText,
  splitVisibleItems,
} from "../../FeatureSet/Dashboard/src/Utils/EventOverview";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The incident and alert overview pages both read their stat bar from these
 * helpers. They used to compute time-to-acknowledge from the LAST
 * acknowledgement and time-to-resolve from the FIRST resolution, so a
 * reopened event showed an acknowledge time later than its resolve time.
 */

const START: Date = new Date("2026-09-14T18:00:00.000Z");

const minutesAfterStart: (minutes: number) => Date = (
  minutes: number,
): Date => {
  return new Date(START.getTime() + minutes * 60 * 1000);
};

const CREATED: string = "state-created";
const ACKNOWLEDGED: string = "state-acknowledged";
const RESOLVED: string = "state-resolved";
/*
 * A state of the project's own placed between Acknowledged and Resolved: it
 * counts as acknowledged.
 */
const INVESTIGATING: string = "state-investigating";
// A state of the project's own placed after Resolved: it counts as resolved.
const CLOSED: string = "state-closed";

const entry: (stateId: string, minutes: number) => EventStateTimelineDate = (
  stateId: string,
  minutes: number,
): EventStateTimelineDate => {
  return { stateId: stateId, startsAt: minutesAfterStart(minutes) };
};

describe("getFirstTimelineDateForState", () => {
  test("returns the earliest entry for the state", () => {
    expect(
      getFirstTimelineDateForState(
        [entry(CREATED, 0), entry(ACKNOWLEDGED, 5), entry(ACKNOWLEDGED, 40)],
        ACKNOWLEDGED,
      ),
    ).toEqual(minutesAfterStart(5));
  });

  test("does not depend on the timeline being sorted", () => {
    expect(
      getFirstTimelineDateForState(
        [entry(ACKNOWLEDGED, 40), entry(CREATED, 0), entry(ACKNOWLEDGED, 5)],
        ACKNOWLEDGED,
      ),
    ).toEqual(minutesAfterStart(5));
  });

  test("skips undated entries", () => {
    expect(
      getFirstTimelineDateForState(
        [{ stateId: ACKNOWLEDGED }, entry(ACKNOWLEDGED, 12)],
        ACKNOWLEDGED,
      ),
    ).toEqual(minutesAfterStart(12));
  });

  test("is undefined without a state id or a matching entry", () => {
    const timelines: Array<EventStateTimelineDate> = [entry(CREATED, 0)];

    expect(getFirstTimelineDateForState(timelines, undefined)).toBeUndefined();
    expect(getFirstTimelineDateForState(timelines, "")).toBeUndefined();
    expect(getFirstTimelineDateForState(timelines, RESOLVED)).toBeUndefined();
    expect(getFirstTimelineDateForState([], RESOLVED)).toBeUndefined();
  });
});

describe("getFirstTimelineDateForStates", () => {
  test("returns the earliest entry for any of the states", () => {
    expect(
      getFirstTimelineDateForStates(
        [
          entry(CREATED, 0),
          entry(INVESTIGATING, 8),
          entry(ACKNOWLEDGED, 3),
          entry(ACKNOWLEDGED, 30),
        ],
        [INVESTIGATING, ACKNOWLEDGED],
      ),
    ).toEqual(minutesAfterStart(3));
  });

  test("is undefined without states or a matching entry", () => {
    const timelines: Array<EventStateTimelineDate> = [entry(CREATED, 0)];

    expect(getFirstTimelineDateForStates(timelines, undefined)).toBeUndefined();
    expect(getFirstTimelineDateForStates(timelines, [])).toBeUndefined();
    expect(
      getFirstTimelineDateForStates(timelines, [ACKNOWLEDGED, RESOLVED]),
    ).toBeUndefined();
  });
});

describe("getEarliestTimelineDate", () => {
  test("returns the earliest dated entry of any state", () => {
    expect(
      getEarliestTimelineDate([
        entry(RESOLVED, 30),
        { stateId: CREATED },
        entry(ACKNOWLEDGED, 3),
      ]),
    ).toEqual(minutesAfterStart(3));
  });

  test("is undefined for an empty or undated timeline", () => {
    expect(getEarliestTimelineDate([])).toBeUndefined();
    expect(getEarliestTimelineDate([{ stateId: CREATED }])).toBeUndefined();
  });
});

describe("getEventResponseTimes", () => {
  test("reads a straightforward created -> acknowledged -> resolved event", () => {
    const times: EventResponseTimes = getEventResponseTimes({
      timelines: [
        entry(CREATED, 0),
        entry(ACKNOWLEDGED, 5),
        entry(RESOLVED, 50),
      ],
      startedAt: START,
      acknowledgedStateIds: [ACKNOWLEDGED],
      resolvedStateIds: [RESOLVED],
    });

    expect(times).toEqual({
      startedAt: START,
      acknowledgedAt: minutesAfterStart(5),
      resolvedAt: minutesAfterStart(50),
      isAcknowledgedByResolution: false,
    });
  });

  test("keeps the FIRST acknowledgement and resolution when the event is reopened", () => {
    const times: EventResponseTimes = getEventResponseTimes({
      timelines: [
        entry(CREATED, 0),
        entry(ACKNOWLEDGED, 5),
        entry(RESOLVED, 20),
        entry(CREATED, 60),
        entry(ACKNOWLEDGED, 70),
        entry(RESOLVED, 90),
      ],
      startedAt: START,
      acknowledgedStateIds: [ACKNOWLEDGED],
      resolvedStateIds: [RESOLVED],
    });

    expect(times.acknowledgedAt).toEqual(minutesAfterStart(5));
    expect(times.resolvedAt).toEqual(minutesAfterStart(20));
    // The regression: acknowledge must never read later than resolve.
    expect(times.acknowledgedAt!.getTime()).toBeLessThanOrEqual(
      times.resolvedAt!.getTime(),
    );
  });

  test("counts a resolution without any acknowledgement as the first response", () => {
    const times: EventResponseTimes = getEventResponseTimes({
      timelines: [entry(CREATED, 0), entry(RESOLVED, 15)],
      startedAt: START,
      acknowledgedStateIds: [ACKNOWLEDGED],
      resolvedStateIds: [RESOLVED],
    });

    expect(times.acknowledgedAt).toEqual(minutesAfterStart(15));
    expect(times.resolvedAt).toEqual(minutesAfterStart(15));
    expect(times.isAcknowledgedByResolution).toBe(true);
  });

  test("uses the resolution when it came before the first acknowledgement", () => {
    const times: EventResponseTimes = getEventResponseTimes({
      timelines: [
        entry(CREATED, 0),
        entry(RESOLVED, 10),
        entry(CREATED, 30),
        entry(ACKNOWLEDGED, 45),
      ],
      startedAt: START,
      acknowledgedStateIds: [ACKNOWLEDGED],
      resolvedStateIds: [RESOLVED],
    });

    expect(times.acknowledgedAt).toEqual(minutesAfterStart(10));
    expect(times.isAcknowledgedByResolution).toBe(true);
  });

  test("an acknowledgement at the same instant as the resolution is still an acknowledgement", () => {
    const times: EventResponseTimes = getEventResponseTimes({
      timelines: [entry(ACKNOWLEDGED, 10), entry(RESOLVED, 10)],
      startedAt: START,
      acknowledgedStateIds: [ACKNOWLEDGED],
      resolvedStateIds: [RESOLVED],
    });

    expect(times.acknowledgedAt).toEqual(minutesAfterStart(10));
    expect(times.isAcknowledgedByResolution).toBe(false);
  });

  test("an event moved straight into a state after Resolved was resolved then", () => {
    const times: EventResponseTimes = getEventResponseTimes({
      timelines: [entry(CREATED, 0), entry(ACKNOWLEDGED, 5), entry(CLOSED, 25)],
      startedAt: START,
      acknowledgedStateIds: [ACKNOWLEDGED],
      resolvedStateIds: [RESOLVED, CLOSED],
    });

    expect(times.resolvedAt).toEqual(minutesAfterStart(25));
  });

  test("moving on from Resolved to a state after it keeps the first resolve", () => {
    const times: EventResponseTimes = getEventResponseTimes({
      timelines: [
        entry(CREATED, 0),
        entry(ACKNOWLEDGED, 5),
        entry(RESOLVED, 20),
        entry(CLOSED, 40),
      ],
      startedAt: START,
      acknowledgedStateIds: [ACKNOWLEDGED],
      resolvedStateIds: [RESOLVED, CLOSED],
    });

    expect(times.resolvedAt).toEqual(minutesAfterStart(20));
  });

  test("leaves both unset while the event is still open", () => {
    const times: EventResponseTimes = getEventResponseTimes({
      timelines: [entry(CREATED, 0)],
      startedAt: START,
      acknowledgedStateIds: [ACKNOWLEDGED],
      resolvedStateIds: [RESOLVED],
    });

    expect(times.acknowledgedAt).toBeUndefined();
    expect(times.resolvedAt).toBeUndefined();
    expect(times.isAcknowledgedByResolution).toBe(false);
  });

  test("falls back to the earliest timeline entry when there is no explicit start", () => {
    const times: EventResponseTimes = getEventResponseTimes({
      timelines: [entry(ACKNOWLEDGED, 5), entry(CREATED, 2)],
      acknowledgedStateIds: [ACKNOWLEDGED],
      resolvedStateIds: [RESOLVED],
    });

    expect(times.startedAt).toEqual(minutesAfterStart(2));
  });

  test("prefers the explicit start over the timeline", () => {
    const times: EventResponseTimes = getEventResponseTimes({
      timelines: [entry(CREATED, 2)],
      startedAt: START,
    });

    expect(times.startedAt).toEqual(START);
  });

  /*
   * A state of the project's own placed between Acknowledged and Resolved
   * ("Investigating") counts as acknowledged
   * (AcknowledgedStateUtil.getAcknowledgedUnresolvedStateIds lists it with
   * the acknowledged state): an event moved straight into it was answered
   * then. Reading the acknowledged state alone left it "Not yet
   * acknowledged" until it was resolved.
   */
  test("an event moved straight into a state after Acknowledged was acknowledged then", () => {
    const times: EventResponseTimes = getEventResponseTimes({
      timelines: [
        entry(CREATED, 0),
        entry(INVESTIGATING, 7),
        entry(RESOLVED, 30),
      ],
      startedAt: START,
      acknowledgedStateIds: [ACKNOWLEDGED, INVESTIGATING],
      resolvedStateIds: [RESOLVED],
    });

    expect(times.acknowledgedAt).toEqual(minutesAfterStart(7));
    expect(times.resolvedAt).toEqual(minutesAfterStart(30));
    expect(times.isAcknowledgedByResolution).toBe(false);
  });

  test("moving on from Acknowledged to a state after it keeps the first acknowledgement", () => {
    const times: EventResponseTimes = getEventResponseTimes({
      timelines: [
        entry(CREATED, 0),
        entry(ACKNOWLEDGED, 4),
        entry(INVESTIGATING, 9),
      ],
      startedAt: START,
      acknowledgedStateIds: [ACKNOWLEDGED, INVESTIGATING],
      resolvedStateIds: [RESOLVED],
    });

    expect(times.acknowledgedAt).toEqual(minutesAfterStart(4));
    expect(times.resolvedAt).toBeUndefined();
  });

  test("the first of any acknowledged state counts, whatever order the list arrives in", () => {
    const times: EventResponseTimes = getEventResponseTimes({
      timelines: [
        entry(ACKNOWLEDGED, 20),
        entry(INVESTIGATING, 6),
        entry(CREATED, 0),
      ],
      startedAt: START,
      acknowledgedStateIds: [INVESTIGATING, ACKNOWLEDGED],
      resolvedStateIds: [RESOLVED],
    });

    expect(times.acknowledgedAt).toEqual(minutesAfterStart(6));
  });

  test("a project without acknowledged or resolved states reports neither", () => {
    const times: EventResponseTimes = getEventResponseTimes({
      timelines: [entry(CREATED, 0), entry(ACKNOWLEDGED, 5)],
      startedAt: START,
    });

    expect(times.acknowledgedAt).toBeUndefined();
    expect(times.resolvedAt).toBeUndefined();
  });
});

describe("getTimeToStateText", () => {
  test("formats the time from the start to the state", () => {
    expect(
      getTimeToStateText({
        startedAt: START,
        reachedAt: minutesAfterStart(65),
        fallbackStateName: "acknowledged",
      }),
    ).toBe("1 hour, 5 minutes");
  });

  test("says less than a minute for an immediate response", () => {
    expect(
      getTimeToStateText({
        startedAt: START,
        reachedAt: new Date(START.getTime() + 20 * 1000),
        fallbackStateName: "acknowledged",
      }),
    ).toBe("less than a minute");
  });

  test("never reports a gap for a state entry stamped before the start", () => {
    expect(
      getTimeToStateText({
        startedAt: START,
        reachedAt: minutesAfterStart(-90),
        fallbackStateName: "resolved",
      }),
    ).toBe("less than a minute");
  });

  test("uses the project's own state name, lowercased, before the state is reached", () => {
    expect(
      getTimeToStateText({
        startedAt: START,
        stateName: "Mitigated",
        fallbackStateName: "resolved",
      }),
    ).toBe("Not yet mitigated");
  });

  test("falls back to the default name when the project has no such state", () => {
    expect(
      getTimeToStateText({
        startedAt: START,
        stateName: "   ",
        fallbackStateName: "acknowledged",
      }),
    ).toBe("Not yet acknowledged");
    expect(
      getTimeToStateText({
        fallbackStateName: "resolved",
      }),
    ).toBe("Not yet resolved");
  });

  test("shows a dash when the state was reached but there is no start to count from", () => {
    expect(
      getTimeToStateText({
        reachedAt: START,
        fallbackStateName: "resolved",
      }),
    ).toBe("-");
  });
});

describe("getEventCreatorName", () => {
  test("prefers the probe that raised the event", () => {
    expect(
      getEventCreatorName({
        probe: { name: "Probe US" },
        user: { name: "Ada Lovelace", email: "ada@example.com" },
      }),
    ).toBe("Probe US");
  });

  test("uses the user's name, then their email", () => {
    expect(
      getEventCreatorName({
        user: { name: "Ada Lovelace", email: "ada@example.com" },
      }),
    ).toBe("Ada Lovelace");
    expect(
      getEventCreatorName({
        probe: { name: "  " },
        user: { name: "", email: "ada@example.com" },
      }),
    ).toBe("ada@example.com");
  });

  test("accepts value objects that stringify (Name, Email)", () => {
    expect(
      getEventCreatorName({
        user: {
          name: {
            toString: (): string => {
              return "Grace Hopper";
            },
          },
        },
      }),
    ).toBe("Grace Hopper");
  });

  test("says Unknown when nobody is recorded", () => {
    expect(getEventCreatorName({})).toBe("Unknown");
    expect(getEventCreatorName({ probe: null, user: null })).toBe("Unknown");
    expect(
      getEventCreatorName({ probe: {}, user: { name: null, email: null } }),
    ).toBe("Unknown");
  });
});

describe("splitVisibleItems", () => {
  test("keeps everything when it fits", () => {
    const result: VisibleItems<string> = splitVisibleItems(["a", "b"], 2);

    expect(result).toEqual({ visible: ["a", "b"], hiddenCount: 0 });
  });

  test("counts what was left out", () => {
    const result: VisibleItems<string> = splitVisibleItems(
      ["a", "b", "c", "d", "e"],
      2,
    );

    expect(result).toEqual({ visible: ["a", "b"], hiddenCount: 3 });
  });

  test("always shows at least one item", () => {
    expect(splitVisibleItems(["a", "b"], 0)).toEqual({
      visible: ["a"],
      hiddenCount: 1,
    });
    expect(splitVisibleItems(["a", "b"], 1.7)).toEqual({
      visible: ["a"],
      hiddenCount: 1,
    });
  });

  test("handles an empty list", () => {
    expect(splitVisibleItems([], 3)).toEqual({ visible: [], hiddenCount: 0 });
  });

  test("does not mutate the input", () => {
    const items: Array<number> = [1, 2, 3];

    splitVisibleItems(items, 1);

    expect(items).toEqual([1, 2, 3]);
  });
});

/*
 * "Acknowledged in" counts from when the record started, so an alert raised
 * at night and paged in the morning reads as hours. The tile keeps that
 * number and adds how long the people paged took: "4 minutes after paging".
 */
describe("the time to acknowledge after paging", () => {
  const ENGLISH: Translator = createTranslator(undefined, "en");

  // A German Dashboard that words the sentence and the "less than" phrase.
  const GERMAN: Translator = createTranslator((text: string) => {
    return (
      {
        [ACKNOWLEDGED_AFTER_PAGING_TEMPLATE]:
          "{{duration}} nach der Alarmierung",
        "less than a minute": "weniger als eine Minute",
      } as Record<string, string>
    )[text];
  }, "de");

  // Raised at night (+0), paged in the morning (+600), acknowledged at +604.
  const pagedInTheMorning: EventResponseTimes = getEventResponseTimes({
    timelines: [entry(CREATED, 0), entry(ACKNOWLEDGED, 604)],
    startedAt: START,
    acknowledgedStateIds: [ACKNOWLEDGED],
    resolvedStateIds: [RESOLVED],
  });

  test("keeps the time from the start, and adds the time from the first page", () => {
    expect(
      getTimeToStateText({
        startedAt: pagedInTheMorning.startedAt,
        reachedAt: pagedInTheMorning.acknowledgedAt,
        fallbackStateName: "acknowledged",
      }),
    ).toBe("10 hours, 4 minutes");

    expect(
      getAcknowledgedAfterPagingText(
        {
          firstPagedAt: minutesAfterStart(600),
          acknowledgedAt: pagedInTheMorning.acknowledgedAt,
        },
        ENGLISH,
      ),
    ).toBe("4 minutes after paging");
  });

  test("says nothing for a record nobody was paged about", () => {
    expect(
      getAcknowledgedAfterPagingText(
        {
          firstPagedAt: undefined,
          acknowledgedAt: pagedInTheMorning.acknowledgedAt,
        },
        ENGLISH,
      ),
    ).toBeUndefined();
    expect(
      getAcknowledgedAfterPagingParts({
        acknowledgedAt: minutesAfterStart(4),
      }),
    ).toBeNull();
  });

  test("says nothing until somebody acknowledges", () => {
    expect(
      getAcknowledgedAfterPagingText(
        { firstPagedAt: minutesAfterStart(600), acknowledgedAt: undefined },
        ENGLISH,
      ),
    ).toBeUndefined();
  });

  test("says nothing for a record acknowledged before anybody was paged", () => {
    expect(
      getAcknowledgedAfterPagingText(
        {
          firstPagedAt: minutesAfterStart(30),
          acknowledgedAt: minutesAfterStart(10),
        },
        ENGLISH,
      ),
    ).toBeUndefined();
  });

  test("counts a resolve that came first as the acknowledgement, by the same rule as the tile", () => {
    const resolvedFirst: EventResponseTimes = getEventResponseTimes({
      timelines: [entry(CREATED, 0), entry(RESOLVED, 75)],
      startedAt: START,
      acknowledgedStateIds: [ACKNOWLEDGED],
      resolvedStateIds: [RESOLVED],
    });

    expect(resolvedFirst.isAcknowledgedByResolution).toBe(true);
    expect(
      getAcknowledgedAfterPagingText(
        {
          firstPagedAt: minutesAfterStart(15),
          acknowledgedAt: resolvedFirst.acknowledgedAt,
        },
        ENGLISH,
      ),
    ).toBe("1 hour after paging");
  });

  test("says less than a minute for an answer within the minute, and an answer at the page itself", () => {
    expect(
      getAcknowledgedAfterPagingText(
        {
          firstPagedAt: minutesAfterStart(60),
          acknowledgedAt: new Date(minutesAfterStart(60).getTime() + 40_000),
        },
        ENGLISH,
      ),
    ).toBe("less than a minute after paging");
    expect(
      getAcknowledgedAfterPagingParts({
        firstPagedAt: minutesAfterStart(60),
        acknowledgedAt: minutesAfterStart(60),
      }),
    ).toEqual([]);
  });

  test("stays one short line: at most the two largest units, never rounded up", () => {
    // Paged at +0, acknowledged a day, two hours and 13 minutes later.
    expect(
      getAcknowledgedAfterPagingText(
        {
          firstPagedAt: minutesAfterStart(0),
          acknowledgedAt: minutesAfterStart(24 * 60 + 2 * 60 + 13),
        },
        ENGLISH,
      ),
    ).toBe("1 day, 2 hours after paging");
    expect(
      getAcknowledgedAfterPagingText(
        {
          firstPagedAt: minutesAfterStart(0),
          acknowledgedAt: minutesAfterStart(2 * 60 + 59),
        },
        ENGLISH,
      ),
    ).toBe("2 hours, 59 minutes after paging");
  });

  test("reads in the reader's language when the Dashboard words the sentence", () => {
    expect(
      getAcknowledgedAfterPagingText(
        {
          firstPagedAt: minutesAfterStart(600),
          acknowledgedAt: minutesAfterStart(604),
        },
        GERMAN,
      ),
    ).toBe("4 Minuten nach der Alarmierung");
    expect(
      getAcknowledgedAfterPagingText(
        {
          firstPagedAt: minutesAfterStart(600),
          acknowledgedAt: minutesAfterStart(600),
        },
        GERMAN,
      ),
    ).toBe("weniger als eine Minute nach der Alarmierung");
  });

  test("is wholly English when the reader's language does not word the sentence", () => {
    const untranslated: Translator = createTranslator(() => {
      return undefined;
    }, "de");

    expect(
      getAcknowledgedAfterPagingText(
        {
          firstPagedAt: minutesAfterStart(600),
          acknowledgedAt: minutesAfterStart(604),
        },
        untranslated,
      ),
    ).toBe("4 minutes after paging");
  });
});

/*
 * The first tile of an incident's (or alert's, or episode's) stat bar: when
 * it was declared, who or what declared it, and - when somebody recorded
 * when customer impact began - how long impact had already gone on (the
 * time to detect). The header says how long it has lasted; the strip reads
 * the response left to right from here.
 */
describe("who or what started a record", () => {
  test("names the probe that raised it first, then the person", () => {
    expect(
      getKnownEventCreatorName({
        probe: { name: "eu-west-1 probe" },
        user: { name: "Maya Chen" },
      }),
    ).toBe("eu-west-1 probe");
    expect(getKnownEventCreatorName({ user: { name: " Maya Chen " } })).toBe(
      "Maya Chen",
    );
    expect(
      getKnownEventCreatorName({
        user: { name: "", email: "sam@acme-commerce.example" },
      }),
    ).toBe("sam@acme-commerce.example");
  });

  test("knows nobody when nobody is recorded, where the old name says Unknown", () => {
    expect(getKnownEventCreatorName({})).toBeUndefined();
    expect(getKnownEventCreatorName({ probe: { name: "  " } })).toBeUndefined();
    expect(getEventCreatorName({})).toBe("Unknown");
  });

  const ENGLISH: Translator = createTranslator(undefined, "en");

  test("says by whom under the start, in the reader's words", () => {
    expect(
      getEventStartedByText({ probe: { name: "eu-west-1 probe" } }, ENGLISH),
    ).toBe("By eu-west-1 probe");
    expect(
      getEventStartedByText({ user: { name: "Maya Chen" } }, ENGLISH),
    ).toBe("By Maya Chen");
    // Its own key: "by {{name}}" belongs to other sentences in other languages.
    expect(EVENT_STARTED_BY_TEMPLATE).toBe("By {{name}}");

    const german: Translator = createTranslator((text: string) => {
      return (
        {
          [EVENT_STARTED_BY_TEMPLATE]: "Von {{name}}",
          [EVENT_STARTED_AUTOMATICALLY]: "Automatisch",
        } as Record<string, string>
      )[text];
    }, "de");

    expect(getEventStartedByText({ user: { name: "Maya Chen" } }, german)).toBe(
      "Von Maya Chen",
    );
    expect(
      getEventStartedByText({ isCreatedAutomatically: true }, german),
    ).toBe("Automatisch");
  });

  test("says Automatically for one OneUptime opened with nobody on record", () => {
    expect(
      getEventStartedByText({ isCreatedAutomatically: true }, ENGLISH),
    ).toBe("Automatically");
    // A probe on record wins: it says where it came from.
    expect(
      getEventStartedByText(
        { isCreatedAutomatically: true, probe: { name: "eu-west-1 probe" } },
        ENGLISH,
      ),
    ).toBe("By eu-west-1 probe");
  });

  test("says nothing, rather than By Unknown, when nothing is on record", () => {
    expect(getEventStartedByText({}, ENGLISH)).toBeUndefined();
    expect(
      getEventStartedByText({ isCreatedAutomatically: false }, ENGLISH),
    ).toBeUndefined();
  });
});

describe("how long impact had gone on when the record started", () => {
  const ENGLISH: Translator = createTranslator(undefined, "en");

  test("counts from the recorded impact start to the declaration", () => {
    expect(
      getImpactBeforeStartText(
        {
          impactStartedAt: minutesAfterStart(0),
          startedAt: minutesAfterStart(3),
        },
        ENGLISH,
      ),
    ).toBe("3 minutes after impact began");
    expect(
      getImpactBeforeStartParts({
        impactStartedAt: minutesAfterStart(0),
        startedAt: minutesAfterStart(3),
      }),
    ).toEqual([{ count: 3, unit: "minute" }]);
  });

  test("stays one short line: the two largest units, never rounded up", () => {
    expect(
      getImpactBeforeStartText(
        {
          impactStartedAt: minutesAfterStart(0),
          startedAt: minutesAfterStart(24 * 60 + 2 * 60 + 59),
        },
        ENGLISH,
      ),
    ).toBe("1 day, 2 hours after impact began");
  });

  test("says less than a minute for a declaration within the minute", () => {
    expect(
      getImpactBeforeStartText(
        {
          impactStartedAt: minutesAfterStart(0),
          startedAt: new Date(minutesAfterStart(0).getTime() + 25_000),
        },
        ENGLISH,
      ),
    ).toBe("less than a minute after impact began");
  });

  test("says nothing without an impact start on record, or one that began only after", () => {
    expect(
      getImpactBeforeStartText({ startedAt: minutesAfterStart(3) }, ENGLISH),
    ).toBeUndefined();
    expect(
      getImpactBeforeStartText(
        { impactStartedAt: minutesAfterStart(3) },
        ENGLISH,
      ),
    ).toBeUndefined();
    // Recorded as the declaration itself (the fixture's default) or later.
    expect(
      getImpactBeforeStartParts({
        impactStartedAt: minutesAfterStart(3),
        startedAt: minutesAfterStart(3),
      }),
    ).toBeNull();
    expect(
      getImpactBeforeStartParts({
        impactStartedAt: minutesAfterStart(10),
        startedAt: minutesAfterStart(3),
      }),
    ).toBeNull();
  });

  test("reads in the reader's language when the Dashboard words the sentence", () => {
    const german: Translator = createTranslator((text: string) => {
      return (
        {
          [IMPACT_BEFORE_START_TEMPLATE]:
            "{{duration}} nach Beginn der Auswirkungen",
        } as Record<string, string>
      )[text];
    }, "de");

    expect(
      getImpactBeforeStartText(
        {
          impactStartedAt: minutesAfterStart(0),
          startedAt: minutesAfterStart(3),
        },
        german,
      ),
    ).toBe("3 Minuten nach Beginn der Auswirkungen");
  });
});

describe("the start tile's time", () => {
  const NBSP: string = NON_BREAKING_SPACE;

  afterEach(() => {
    OneUptimeDate.setUserTimezone(null);
    jest.restoreAllMocks();
  });

  test("says the day and the time in the reader's zone and clock, without this year's year", () => {
    OneUptimeDate.setUserTimezone("UTC" as Timezone);
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(true);

    expect(
      getEventStartTileText(
        new Date("2026-09-14T18:01:00.000Z"),
        new Date("2026-09-14T18:20:00.000Z"),
      ),
    ).toBe(`Sep${NBSP}14, 06:01${NBSP}PM UTC`);
  });

  test("gives the tile the date and time, and the zone it draws smaller after them", () => {
    OneUptimeDate.setUserTimezone("UTC" as Timezone);
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(true);

    expect(
      getEventStartTileParts(
        new Date("2026-09-14T18:01:00.000Z"),
        new Date("2026-09-14T18:20:00.000Z"),
      ),
    ).toEqual({ dateTime: `Sep${NBSP}14, 06:01${NBSP}PM`, zone: "UTC" });
  });

  test("adds the year for a record from another year", () => {
    OneUptimeDate.setUserTimezone("UTC" as Timezone);
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(true);

    expect(
      getEventStartTileText(
        new Date("2025-12-31T23:30:00.000Z"),
        new Date("2026-01-01T00:10:00.000Z"),
      ),
    ).toBe(`Dec${NBSP}31${NBSP}2025, 11:30${NBSP}PM UTC`);
  });

  test("follows a 24-hour clock and the reader's own time zone, daylight saving included", () => {
    OneUptimeDate.setUserTimezone("Europe/Berlin" as Timezone);
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);

    expect(
      getEventStartTileText(
        new Date("2026-09-14T18:01:00.000Z"),
        new Date("2026-09-14T18:20:00.000Z"),
      ),
    ).toBe(`Sep${NBSP}14, 20:01 CEST`);
    // In January the same zone is an hour ahead of UTC, not two.
    expect(
      getEventStartTileText(
        new Date("2026-01-14T18:01:00.000Z"),
        new Date("2026-01-14T18:20:00.000Z"),
      ),
    ).toBe(`Jan${NBSP}14, 19:01 CET`);
  });

  test("decides this year in the reader's zone, where the year may already have turned", () => {
    OneUptimeDate.setUserTimezone("Pacific/Auckland" as Timezone);
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);

    // 31 Dec 2025 in UTC, already 1 Jan 2026 in Auckland: this year there.
    expect(
      getEventStartTileText(
        new Date("2025-12-31T12:00:00.000Z"),
        new Date("2025-12-31T13:00:00.000Z"),
      ),
    ).toBe(`Jan${NBSP}01, 01:00 NZDT`);
  });

  test("breaks after the date's comma and before the zone, never inside the date, the time or the zone", () => {
    OneUptimeDate.setUserTimezone("UTC" as Timezone);
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(true);

    const text: string = getEventStartTileText(
      new Date("2026-09-14T18:01:00.000Z"),
      new Date("2026-09-14T18:20:00.000Z"),
    );

    expect(text.split(" ")).toEqual([`Sep${NBSP}14,`, `06:01${NBSP}PM`, "UTC"]);
    expect(NBSP).toBe(String.fromCharCode(0xa0));
  });

  test("a zone of more than one word holds together too", () => {
    OneUptimeDate.setUserTimezone("UTC" as Timezone);
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);
    jest
      .spyOn(OneUptimeDate, "getZoneAbbrByTimezone")
      .mockReturnValue("GMT+5 30");

    expect(
      getEventStartTileParts(
        new Date("2026-09-14T18:01:00.000Z"),
        new Date("2026-09-14T18:20:00.000Z"),
      ).zone,
    ).toBe(`GMT+5${NBSP}30`);
  });

  test("a time with no zone to name is the date and the time alone", () => {
    OneUptimeDate.setUserTimezone("UTC" as Timezone);
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);
    jest.spyOn(OneUptimeDate, "getZoneAbbrByTimezone").mockReturnValue("");

    const startedAt: Date = new Date("2026-09-14T18:01:00.000Z");
    const now: Date = new Date("2026-09-14T18:20:00.000Z");

    expect(getEventStartTileParts(startedAt, now)).toEqual({
      dateTime: `Sep${NBSP}14, 18:01`,
      zone: "",
    });
    expect(getEventStartTileText(startedAt, now)).toBe(`Sep${NBSP}14, 18:01`);
  });
});
