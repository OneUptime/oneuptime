/**
 * DIFFERENTIAL test for the priority merge (`LayerUtil.removeOverlappingEvents`).
 *
 * `reference()` below is the ORIGINAL O(n^2) implementation, kept as an
 * executable specification: for every input the original can actually finish,
 * the current implementation must agree with it exactly.
 *
 * This matters more than the usual unit tests, because the merge is
 * order-sensitive. A lower-priority final event is trimmed with whatever
 * `event.start` happens to be when it is visited, and a higher-priority final
 * event visited earlier in the same scan may already have pushed that start
 * forward. Any rewrite that changes visit order silently changes who is on call.
 * Random inputs with dense overlaps and repeated boundaries exercise exactly
 * that.
 *
 * THE STEP BUDGET IS NOT A CONVENIENCE. The original does not terminate on some
 * inputs: an event whose start has been pushed past its own end still matches
 * and still trims, so it re-splits the very segment it just created, forever.
 * Empirically, on an hourly grid with 3 priorities, 14 events settle in ~110
 * inner steps and 16 events do not finish in 50,000,000. That is the hang this
 * rewrite removes, so the reference has to run under a budget or this suite
 * would hang instead. Inputs that exhaust the budget are counted and skipped,
 * and are covered by the invariant assertions below rather than by comparison.
 */
import LayerUtil, {
  PriorityCalendarEvents,
} from "../../../Types/OnCallDutyPolicy/Layer";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import OneUptimeDate from "../../../Types/Date";
import { describe, expect, test } from "@jest/globals";

class ReferenceBudgetExceeded extends Error {}

/*
 * Comfortably separates the two populations rather than splitting one: inputs
 * the original can finish settle in a few hundred inner steps, and the ones it
 * cannot run away without limit. Raising this to 50,000 or 2,000,000 does not
 * move a single input from skipped to compared on these generators; it only
 * makes the suite slower, because the whole cost is the runaway inputs spinning
 * up to the ceiling.
 */
const REFERENCE_STEP_BUDGET: number = 5_000;

function reference(events: PriorityCalendarEvents[]): CalendarEvent[] {
  let steps: number = 0;

  events = events.filter((event: PriorityCalendarEvents) => {
    return !OneUptimeDate.isSame(event.start, event.end);
  });

  events = events.filter((event: PriorityCalendarEvents) => {
    return !OneUptimeDate.isBefore(event.end, event.start);
  });

  const finalEvents: PriorityCalendarEvents[] = [];

  events.sort((a: CalendarEvent, b: CalendarEvent) => {
    if (OneUptimeDate.isBefore(a.start, b.start)) {
      return -1;
    }

    if (OneUptimeDate.isAfter(a.start, b.start)) {
      return 1;
    }

    return 0;
  });

  for (const event of events) {
    if (OneUptimeDate.isSame(event.start, event.end)) {
      continue;
    }

    if (OneUptimeDate.isBefore(event.end, event.start)) {
      continue;
    }

    for (let i: number = 0; i < finalEvents.length; i++) {
      if (++steps > REFERENCE_STEP_BUDGET) {
        throw new ReferenceBudgetExceeded();
      }

      const finalEvent: PriorityCalendarEvents | undefined = finalEvents[i];

      if (!finalEvent) {
        continue;
      }

      if (
        OneUptimeDate.isOverlapping(
          finalEvent.start,
          finalEvent.end,
          event.start,
          event.end,
        )
      ) {
        if (event.priority < finalEvent.priority) {
          const tempFinalEventEnd: Date = finalEvent.end;

          if (OneUptimeDate.isAfter(tempFinalEventEnd, event.end)) {
            const trimmedEvent: PriorityCalendarEvents = {
              ...finalEvent,
              priority: finalEvent.priority,
              start: OneUptimeDate.addRemoveSeconds(event.end, 1),
              end: tempFinalEventEnd,
            };

            if (OneUptimeDate.isAfter(trimmedEvent.end, trimmedEvent.start)) {
              finalEvents.push(trimmedEvent);
            }
          }

          finalEvent.end = OneUptimeDate.addRemoveSeconds(event.start, -1);

          if (OneUptimeDate.isBefore(finalEvent.end, finalEvent.start)) {
            finalEvents.splice(i, 1);
            i--;
            continue;
          }

          if (OneUptimeDate.isSame(finalEvent.start, finalEvent.end)) {
            finalEvents.splice(i, 1);
            i--;
            continue;
          }
        } else {
          event.start = OneUptimeDate.getGreaterDate(
            event.start,
            OneUptimeDate.addRemoveSeconds(finalEvent.end, 1),
          );
        }
      }
    }

    if (OneUptimeDate.isAfter(event.end, event.start)) {
      finalEvents.push(event);
    }

    for (let index: number = 0; index < finalEvents.length; index++) {
      if (++steps > REFERENCE_STEP_BUDGET) {
        throw new ReferenceBudgetExceeded();
      }

      const finalEvent: PriorityCalendarEvents | undefined = finalEvents[index];

      if (!finalEvent) {
        continue;
      }

      if (OneUptimeDate.isSame(finalEvent.start, finalEvent.end)) {
        finalEvents.splice(index, 1);
        index--;
        continue;
      }

      if (OneUptimeDate.isBefore(finalEvent.end, finalEvent.start)) {
        finalEvents.splice(index, 1);
        index--;
      }
    }
  }

  finalEvents.sort((a: CalendarEvent, b: CalendarEvent) => {
    if (OneUptimeDate.isBefore(a.start, b.start)) {
      return -1;
    }

    if (OneUptimeDate.isAfter(a.start, b.start)) {
      return 1;
    }

    return 0;
  });

  const calendarEvents: CalendarEvent[] = [];
  let id: number = 1;

  for (const event of finalEvents) {
    calendarEvents.push({ ...event, id: id });
    id++;
  }

  return calendarEvents;
}

// Deterministic PRNG so any failure is reproducible from the seed alone.
function makeRng(seed: number): () => number {
  let state: number = seed >>> 0;
  return (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const BASE_MS: number = Date.UTC(2026, 0, 5, 0, 0, 0);

function clone(
  events: Array<PriorityCalendarEvents>,
): Array<PriorityCalendarEvents> {
  return events.map((event: PriorityCalendarEvents) => {
    return {
      ...event,
      start: new Date(event.start.getTime()),
      end: new Date(event.end.getTime()),
    };
  });
}

function describeInput(events: Array<PriorityCalendarEvents>): string {
  return events
    .map((event: PriorityCalendarEvents) => {
      return `p${event.priority}[${event.start.toISOString()},${event.end.toISOString()}]`;
    })
    .join(" ");
}

function normalise(events: Array<CalendarEvent>): Array<string> {
  return events.map((event: CalendarEvent) => {
    return [
      event.id,
      event.title,
      new Date(event.start).toISOString(),
      new Date(event.end).toISOString(),
      (event as PriorityCalendarEvents).priority,
    ].join("|");
  });
}

interface GeneratorShape {
  name: string;
  // Granularity of generated boundaries, in seconds.
  gridSeconds: number;
  maxSpanUnits: number;
  eventCount: number;
  priorities: number;
  /*
   * Whether the current implementation must reproduce the original's output
   * exactly. False only for the 1-second grid — see the exhaustion note on the
   * dense-grid shape below.
   */
  exactMatch: boolean;
}

const SHAPES: Array<GeneratorShape> = [
  /*
   * The one shape where output is NOT required to match. Boundaries one second
   * apart are what let an event's start be pushed onto its own end, and the
   * original kept trimming with such exhausted events (see the break in
   * removeOverlappingEvents). That behaviour is not a specification worth
   * reproducing: it is the same mechanism that makes the original hang, and
   * where it does terminate it emits a spurious extra 1-second seam. Measured
   * over 300 inputs, 272 of which the original can finish, the two disagree on
   * 7, always by a single second of seam placement.
   *
   * Invariants and termination are still asserted on every input here.
   */
  {
    name: "dense 1s grid, heavy overlap",
    gridSeconds: 1,
    maxSpanUnits: 6,
    eventCount: 14,
    priorities: 3,
    exactMatch: false,
  },
  {
    name: "hourly grid, 3 layers",
    gridSeconds: 3600,
    maxSpanUnits: 5,
    eventCount: 12,
    priorities: 3,
    exactMatch: true,
  },
  {
    name: "mixed grid, long fallback spans",
    gridSeconds: 900,
    maxSpanUnits: 40,
    eventCount: 10,
    priorities: 4,
    exactMatch: true,
  },
  {
    name: "identical boundaries, many ties",
    gridSeconds: 3600,
    maxSpanUnits: 2,
    eventCount: 20,
    priorities: 2,
    exactMatch: true,
  },
  {
    name: "single priority, no trimming",
    gridSeconds: 60,
    maxSpanUnits: 10,
    eventCount: 16,
    priorities: 1,
    exactMatch: true,
  },
];

function generate(
  shape: GeneratorShape,
  rng: () => number,
): Array<PriorityCalendarEvents> {
  const events: Array<PriorityCalendarEvents> = [];

  for (let i: number = 0; i < shape.eventCount; i++) {
    const startUnits: number = Math.floor(rng() * 24);
    const spanUnits: number = 1 + Math.floor(rng() * shape.maxSpanUnits);
    const startMs: number = BASE_MS + startUnits * shape.gridSeconds * 1000;

    events.push({
      id: i + 1,
      title: `u${i % 5}`,
      start: new Date(startMs),
      end: new Date(startMs + spanUnits * shape.gridSeconds * 1000),
      priority: 1 + Math.floor(rng() * shape.priorities),
    });
  }

  return events;
}

function assertMergeInvariants(events: Array<CalendarEvent>): void {
  for (let i: number = 0; i < events.length; i++) {
    expect(new Date(events[i]!.end).getTime()).toBeGreaterThan(
      new Date(events[i]!.start).getTime(),
    );

    if (i > 0) {
      expect(new Date(events[i]!.start).getTime()).toBeGreaterThanOrEqual(
        new Date(events[i - 1]!.start).getTime(),
      );
      expect(new Date(events[i - 1]!.end).getTime()).toBeLessThanOrEqual(
        new Date(events[i]!.start).getTime(),
      );
    }
  }
}

describe("removeOverlappingEvents agrees with the original implementation", () => {
  for (const shape of SHAPES) {
    test(shape.name, () => {
      const rng: () => number = makeRng(0x5eed + shape.name.length);
      let compared: number = 0;
      let skipped: number = 0;

      for (let iteration: number = 0; iteration < 300; iteration++) {
        const generated: Array<PriorityCalendarEvents> = generate(shape, rng);

        const actual: Array<CalendarEvent> =
          new LayerUtil().removeOverlappingEvents(clone(generated));

        /*
         * The current implementation must hold the invariants on EVERY input,
         * including the ones the original cannot finish.
         */
        assertMergeInvariants(actual);

        let expected: Array<CalendarEvent>;

        try {
          expected = reference(clone(generated));
        } catch (err) {
          if (err instanceof ReferenceBudgetExceeded) {
            skipped++;
            continue;
          }
          throw err;
        }

        compared++;

        if (!shape.exactMatch) {
          continue;
        }

        expect({
          input: describeInput(generated),
          output: normalise(actual),
        }).toEqual({
          input: describeInput(generated),
          output: normalise(expected),
        });
      }

      /*
       * Guard against this test quietly becoming vacuous: if a future change to
       * the generators pushed every input past the reference budget, the
       * comparison above would never run and the suite would still be green.
       */
      expect(compared).toBeGreaterThan(0);
      expect(compared + skipped).toBe(300);
    });
  }

  /*
   * The one INTENTIONAL behaviour change, pinned with hand-computed expected
   * output rather than by comparison, because the original is wrong here.
   *
   * C(p2) covers 14-16. B(p2) covers 15-17, but 15-16 belongs to the
   * equal-priority C that was placed first, so B is left with [17,17] — zero
   * length, contributing nothing and dropped from the output. A(p3) covers
   * 15-21 and should therefore pick up everything from 17 on.
   *
   * The original let the exhausted B keep trimming, so B carved a second out of
   * A and returned A as [18,21] — a schedule where nobody is on call at 17
   * despite A covering it and B contributing nothing. The current implementation
   * stops B when it runs out and returns [17,21].
   */
  test("an event trimmed away to nothing does not carve a hole in a lower-priority event", () => {
    const at: (second: number) => Date = (second: number): Date => {
      return new Date(BASE_MS + second * 1000);
    };

    const events: Array<PriorityCalendarEvents> = [
      { id: 1, title: "A", start: at(15), end: at(21), priority: 3 },
      { id: 2, title: "B", start: at(15), end: at(17), priority: 2 },
      { id: 3, title: "C", start: at(14), end: at(16), priority: 2 },
    ];

    const actual: Array<CalendarEvent> =
      new LayerUtil().removeOverlappingEvents(clone(events));

    expect(
      actual.map((event: CalendarEvent) => {
        return `${event.title}[${(new Date(event.start).getTime() - BASE_MS) / 1000},${(new Date(event.end).getTime() - BASE_MS) / 1000}]`;
      }),
    ).toEqual(["C[14,16]", "A[17,21]"]);

    // The original's answer, kept here so the difference is explicit.
    expect(
      reference(clone(events)).map((event: CalendarEvent) => {
        return `${event.title}[${(new Date(event.start).getTime() - BASE_MS) / 1000},${(new Date(event.end).getTime() - BASE_MS) / 1000}]`;
      }),
    ).toEqual(["C[14,16]", "A[18,21]"]);
  });

  test("terminates on inputs the original implementation cannot finish", () => {
    /*
     * 16 events on an hourly grid with 3 priorities is past the point where the
     * original stops terminating (14 events settle in ~110 inner steps; 16 do
     * not finish in 50,000,000). The rewrite must return, quickly, and with the
     * merge invariants intact.
     */
    const rng: () => number = makeRng(0x5eed + 15);
    const generated: Array<PriorityCalendarEvents> = generate(
      {
        name: "blowup",
        gridSeconds: 3600,
        maxSpanUnits: 5,
        eventCount: 16,
        priorities: 3,
        exactMatch: false,
      },
      rng,
    );

    expect(() => {
      return reference(clone(generated));
    }).toThrow(ReferenceBudgetExceeded);

    const started: number = Date.now();
    const actual: Array<CalendarEvent> =
      new LayerUtil().removeOverlappingEvents(clone(generated));
    const elapsedMs: number = Date.now() - started;

    expect(actual.length).toBeGreaterThan(0);
    assertMergeInvariants(actual);
    expect(elapsedMs).toBeLessThan(1000);
  });

  test("degenerate and inverted intervals are dropped identically", () => {
    const base: number = BASE_MS;
    const events: Array<PriorityCalendarEvents> = [
      // zero length
      {
        id: 1,
        title: "a",
        start: new Date(base),
        end: new Date(base),
        priority: 1,
      },
      // inverted
      {
        id: 2,
        title: "b",
        start: new Date(base + 3600_000),
        end: new Date(base),
        priority: 1,
      },
      // normal, fully covered by a higher priority event
      {
        id: 3,
        title: "c",
        start: new Date(base),
        end: new Date(base + 7200_000),
        priority: 2,
      },
      {
        id: 4,
        title: "d",
        start: new Date(base),
        end: new Date(base + 7200_000),
        priority: 1,
      },
    ];

    expect(
      normalise(new LayerUtil().removeOverlappingEvents(clone(events))),
    ).toEqual(normalise(reference(clone(events))));
  });
});
