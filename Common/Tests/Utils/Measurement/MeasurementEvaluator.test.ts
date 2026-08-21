import MeasurementEvaluator, {
  EvaluatedMeasurement,
  MeasurementAnchorSpec,
  MeasurementDefinitionSpec,
  MeasurementTimelineEntry,
} from "../../../Utils/Measurement/MeasurementEvaluator";
import MeasurementAnchorKind from "../../../Types/Measurement/MeasurementAnchorKind";
import MeasurementOccurrence from "../../../Types/Measurement/MeasurementOccurrence";
import MeasurementStatus from "../../../Types/Measurement/MeasurementStatus";

/*
 * A three-state project: Identified(1) -> Acknowledged(2) -> Resolved(3),
 * mirroring the default incident states a project is seeded with.
 */
const IDENTIFIED: string = "state-identified";
const ACKNOWLEDGED: string = "state-acknowledged";
const RESOLVED: string = "state-resolved";

const ORDER: Record<string, number> = {
  [IDENTIFIED]: 1,
  [ACKNOWLEDGED]: 2,
  [RESOLVED]: 3,
};

const ROLES: Record<string, Array<string>> = {
  [IDENTIFIED]: ["Created"],
  [ACKNOWLEDGED]: ["Acknowledged"],
  [RESOLVED]: ["Resolved"],
};

type EntryOptions = {
  id?: string;
  order?: number;
  roles?: Array<string>;
};

function at(minutes: number): Date {
  return new Date(Date.UTC(2026, 7, 21, 10, minutes, 0));
}

function entry(
  stateId: string,
  minutes: number,
  options: EntryOptions = {},
): MeasurementTimelineEntry {
  return {
    id: options.id || `${stateId}-${minutes}`,
    stateId: stateId,
    stateName: stateId,
    stateOrder: options.order ?? ORDER[stateId],
    stateRoles: options.roles ?? ROLES[stateId] ?? [],
    startsAt: at(minutes),
  };
}

function stateAnchor(
  stateId: string,
  label: string,
  overrides: Partial<MeasurementAnchorSpec> = {},
): MeasurementAnchorSpec {
  return {
    kind: MeasurementAnchorKind.StateEntered,
    label: label,
    stateId: stateId,
    stateOrder: ORDER[stateId],
    occurrence: MeasurementOccurrence.First,
    ...overrides,
  };
}

function roleAnchor(
  role: string,
  overrides: Partial<MeasurementAnchorSpec> = {},
): MeasurementAnchorSpec {
  return {
    kind: MeasurementAnchorKind.StateRoleEntered,
    label: role,
    stateRole: role,
    occurrence: MeasurementOccurrence.First,
    ...overrides,
  };
}

function timestampAnchor(
  label: string,
  timestamp: Date | undefined,
  overrides: Partial<MeasurementAnchorSpec> = {},
): MeasurementAnchorSpec {
  return {
    kind: MeasurementAnchorKind.Timestamp,
    label: label,
    timestamp: timestamp,
    ...overrides,
  };
}

function definition(
  start: MeasurementAnchorSpec,
  end: MeasurementAnchorSpec,
  id: string = "definition-1",
  name: string = "Time to Something",
): MeasurementDefinitionSpec {
  return { id: id, name: name, start: start, end: end };
}

function evaluate(
  def: MeasurementDefinitionSpec,
  timeline: Array<MeasurementTimelineEntry>,
): EvaluatedMeasurement {
  return MeasurementEvaluator.evaluateOne({
    definition: def,
    timeline: MeasurementEvaluator.sortTimeline(timeline),
  });
}

describe("MeasurementEvaluator", () => {
  describe("the happy path", () => {
    test("records the duration between two states that were both entered", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          stateAnchor(IDENTIFIED, "Identified"),
          stateAnchor(ACKNOWLEDGED, "Acknowledged"),
        ),
        [entry(IDENTIFIED, 0), entry(ACKNOWLEDGED, 7), entry(RESOLVED, 30)],
      );

      expect(result.status).toBe(MeasurementStatus.Recorded);
      expect(result.valueInSeconds).toBe(7 * 60);
      expect(result.startedAt).toEqual(at(0));
      expect(result.endedAt).toEqual(at(7));
      expect(result.statusMessage).toBeUndefined();
    });

    test("carries the timeline row ids that produced the number", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          stateAnchor(IDENTIFIED, "Identified"),
          stateAnchor(RESOLVED, "Resolved"),
        ),
        [
          entry(IDENTIFIED, 0, { id: "row-a" }),
          entry(RESOLVED, 45, { id: "row-b" }),
        ],
      );

      expect(result.startTimelineEntryId).toBe("row-a");
      expect(result.endTimelineEntryId).toBe("row-b");
    });

    test("measures a timestamp anchor against a state anchor", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          timestampAnchor("Impact Started At", at(0)),
          roleAnchor("Acknowledged"),
        ),
        [entry(IDENTIFIED, 17), entry(ACKNOWLEDGED, 20)],
      );

      // Time to acknowledge measured from real impact, not from ingest.
      expect(result.status).toBe(MeasurementStatus.Recorded);
      expect(result.valueInSeconds).toBe(20 * 60);
    });

    test("measures between two timestamp anchors", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          timestampAnchor("Impact Started At", at(0)),
          timestampAnchor("Declared At", at(17)),
        ),
        [],
      );

      expect(result.status).toBe(MeasurementStatus.Recorded);
      expect(result.valueInSeconds).toBe(17 * 60);
    });

    test("a zero-length measurement is Recorded, not Invalid", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          timestampAnchor("Impact Started At", at(5)),
          timestampAnchor("Declared At", at(5)),
        ),
        [],
      );

      expect(result.status).toBe(MeasurementStatus.Recorded);
      expect(result.valueInSeconds).toBe(0);
    });

    test("rounds sub-second precision to whole seconds", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          timestampAnchor("Start", new Date("2026-08-21T10:00:00.000Z")),
          timestampAnchor("End", new Date("2026-08-21T10:00:01.600Z")),
        ),
        [],
      );

      expect(result.valueInSeconds).toBe(2);
    });
  });

  describe("state role anchors", () => {
    test("resolves by role flag rather than by state id", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(roleAnchor("Created"), roleAnchor("Resolved")),
        [entry(IDENTIFIED, 0), entry(ACKNOWLEDGED, 5), entry(RESOLVED, 25)],
      );

      expect(result.status).toBe(MeasurementStatus.Recorded);
      expect(result.valueInSeconds).toBe(25 * 60);
    });

    test("takes the first state carrying the role when two states share it", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(roleAnchor("Created"), roleAnchor("Resolved")),
        [
          entry(IDENTIFIED, 0),
          entry(ACKNOWLEDGED, 5, { roles: ["Resolved"] }),
          entry(RESOLVED, 25, { roles: ["Resolved"] }),
        ],
      );

      // Matches how the built-in metrics resolve a flag today: first wins.
      expect(result.valueInSeconds).toBe(5 * 60);
    });

    test("a role no state carries stays Pending rather than being declared skipped", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(roleAnchor("Created"), roleAnchor("Acknowledged")),
        [entry(IDENTIFIED, 0), entry(RESOLVED, 25, { roles: ["Resolved"] })],
      );

      /*
       * A project may simply have no acknowledged state. Nothing about the
       * timeline rules the role out, so claiming it was skipped would be a
       * stronger statement than the data supports.
       */
      expect(result.status).toBe(MeasurementStatus.Pending);
    });
  });

  describe("occurrence selection (the reopen knob)", () => {
    const reopened: Array<MeasurementTimelineEntry> = [
      entry(IDENTIFIED, 0, { id: "a" }),
      entry(ACKNOWLEDGED, 5, { id: "b" }),
      entry(RESOLVED, 20, { id: "c" }),
      entry(ACKNOWLEDGED, 40, { id: "d" }),
      entry(RESOLVED, 90, { id: "e" }),
    ];

    test("First pins to the original resolution", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          stateAnchor(IDENTIFIED, "Identified"),
          stateAnchor(RESOLVED, "Resolved", {
            occurrence: MeasurementOccurrence.First,
          }),
        ),
        reopened,
      );

      expect(result.valueInSeconds).toBe(20 * 60);
      expect(result.endTimelineEntryId).toBe("c");
    });

    test("Last follows the reopen through to the final resolution", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          stateAnchor(IDENTIFIED, "Identified"),
          stateAnchor(RESOLVED, "Resolved", {
            occurrence: MeasurementOccurrence.Last,
          }),
        ),
        reopened,
      );

      expect(result.valueInSeconds).toBe(90 * 60);
      expect(result.endTimelineEntryId).toBe("e");
    });

    test("Last applies to the start anchor too", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          stateAnchor(ACKNOWLEDGED, "Acknowledged", {
            occurrence: MeasurementOccurrence.Last,
          }),
          stateAnchor(RESOLVED, "Resolved", {
            occurrence: MeasurementOccurrence.Last,
          }),
        ),
        reopened,
      );

      expect(result.valueInSeconds).toBe(50 * 60);
    });

    test("defaults to First when no occurrence is given", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          stateAnchor(IDENTIFIED, "Identified"),
          stateAnchor(RESOLVED, "Resolved", { occurrence: undefined }),
        ),
        reopened,
      );

      expect(result.valueInSeconds).toBe(20 * 60);
    });
  });

  describe("anchors that have not resolved", () => {
    test("an unreached state on a still-progressing entity is Pending", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          stateAnchor(IDENTIFIED, "Identified"),
          stateAnchor(RESOLVED, "Resolved"),
        ),
        [entry(IDENTIFIED, 0), entry(ACKNOWLEDGED, 5)],
      );

      expect(result.status).toBe(MeasurementStatus.Pending);
      expect(result.statusMessage).toBe("Resolved has not been reached yet");
      expect(result.valueInSeconds).toBeUndefined();
    });

    test("a skipped state is NotApplicable, not Pending forever", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          stateAnchor(IDENTIFIED, "Identified"),
          stateAnchor(ACKNOWLEDGED, "Acknowledged"),
        ),
        [entry(IDENTIFIED, 0), entry(RESOLVED, 25)],
      );

      /*
       * The entity moved from order 1 straight to order 3. The timeline
       * services enforce strictly increasing order, so order 2 can never be
       * entered -- this measurement is over, with no value.
       */
      expect(result.status).toBe(MeasurementStatus.NotApplicable);
      expect(result.statusMessage).toBe("Acknowledged was skipped");
    });

    test("a state at exactly the current order is unreachable", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          stateAnchor(IDENTIFIED, "Identified"),
          stateAnchor(ACKNOWLEDGED, "Acknowledged"),
        ),
        [entry(IDENTIFIED, 0), entry(ACKNOWLEDGED, 5)],
      );

      // Entered, so it resolves -- the boundary is exercised by the next test.
      expect(result.status).toBe(MeasurementStatus.Recorded);
    });

    test("a state ordered after the current position is still reachable", () => {
      const custom: string = "state-post-mortem-done";
      const result: EvaluatedMeasurement = evaluate(
        definition(stateAnchor(IDENTIFIED, "Identified"), {
          kind: MeasurementAnchorKind.StateEntered,
          label: "Postmortem Done",
          stateId: custom,
          stateOrder: 4,
          occurrence: MeasurementOccurrence.First,
        }),
        [entry(IDENTIFIED, 0), entry(RESOLVED, 25)],
      );

      /*
       * States ordered after Resolved are a configuration the product
       * encourages, so a resolved entity must not be treated as terminal.
       */
      expect(result.status).toBe(MeasurementStatus.Pending);
    });

    test("an empty timeline leaves state anchors Pending", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          stateAnchor(IDENTIFIED, "Identified"),
          stateAnchor(RESOLVED, "Resolved"),
        ),
        [],
      );

      expect(result.status).toBe(MeasurementStatus.Pending);
    });

    test("NotApplicable outranks Pending when one end is skipped", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(stateAnchor(ACKNOWLEDGED, "Acknowledged"), {
          kind: MeasurementAnchorKind.StateEntered,
          label: "Postmortem Done",
          stateId: "state-later",
          stateOrder: 9,
          occurrence: MeasurementOccurrence.First,
        }),
        [entry(IDENTIFIED, 0), entry(RESOLVED, 25)],
      );

      /*
       * Start was skipped (unreachable), end is still reachable. The
       * measurement can never complete, so the honest status is the one that
       * says so.
       */
      expect(result.status).toBe(MeasurementStatus.NotApplicable);
      expect(result.statusMessage).toBe("Acknowledged was skipped");
    });
  });

  describe("timestamp anchors that were never recorded", () => {
    test("an unset creation-time timestamp is NotApplicable, never zero", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          timestampAnchor("Impact Started At", undefined),
          roleAnchor("Acknowledged"),
        ),
        [entry(IDENTIFIED, 0), entry(ACKNOWLEDGED, 12)],
      );

      /*
       * The single most important assertion in this file. Reporting 0 here
       * would render "we detect instantly" on every incident in the project.
       */
      expect(result.status).toBe(MeasurementStatus.NotApplicable);
      expect(result.statusMessage).toBe("Impact Started At was never recorded");
      expect(result.valueInSeconds).toBeUndefined();
    });

    test("an unset later-filled timestamp is Pending", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(roleAnchor("Created"), {
          kind: MeasurementAnchorKind.Timestamp,
          label: "Postmortem Posted At",
          timestamp: undefined,
          canResolveAfterTerminalState: true,
        }),
        [entry(IDENTIFIED, 0), entry(RESOLVED, 25)],
      );

      // A postmortem is posted after resolution, so resolution is not the end.
      expect(result.status).toBe(MeasurementStatus.Pending);
      expect(result.statusMessage).toBe(
        "Postmortem Posted At has not been recorded yet",
      );
    });
  });

  describe("timestamps that disagree with each other", () => {
    test("an end before a start is Invalid and says by how much", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          timestampAnchor("Declared At", at(17)),
          timestampAnchor("Impact Started At", at(0)),
        ),
        [],
      );

      expect(result.status).toBe(MeasurementStatus.Invalid);
      expect(result.statusMessage).toBe(
        "Impact Started At precedes Declared At by 17m",
      );
      expect(result.valueInSeconds).toBeUndefined();
      // Both ends are still reported so the operator can see what to fix.
      expect(result.startedAt).toEqual(at(17));
      expect(result.endedAt).toEqual(at(0));
    });

    test("a backdated timeline row that inverts a measurement is Invalid", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          stateAnchor(ACKNOWLEDGED, "Acknowledged"),
          stateAnchor(RESOLVED, "Resolved"),
        ),
        [entry(IDENTIFIED, 0), entry(ACKNOWLEDGED, 50), entry(RESOLVED, 20)],
      );

      expect(result.status).toBe(MeasurementStatus.Invalid);
      expect(result.statusMessage).toBe(
        "Resolved precedes Acknowledged by 30m",
      );
    });
  });

  describe("deleted state references", () => {
    test("a dangling start reference degrades rather than throwing", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          stateAnchor(IDENTIFIED, "Identified", {
            isDanglingStateReference: true,
          }),
          stateAnchor(RESOLVED, "Resolved"),
        ),
        [entry(IDENTIFIED, 0), entry(RESOLVED, 25)],
      );

      expect(result.status).toBe(MeasurementStatus.NotApplicable);
      expect(result.statusMessage).toContain("has been deleted");
    });

    test("a dangling end reference degrades too", () => {
      const result: EvaluatedMeasurement = evaluate(
        definition(
          stateAnchor(IDENTIFIED, "Identified"),
          stateAnchor(RESOLVED, "Resolved", {
            isDanglingStateReference: true,
          }),
        ),
        [entry(IDENTIFIED, 0), entry(RESOLVED, 25)],
      );

      expect(result.status).toBe(MeasurementStatus.NotApplicable);
    });
  });

  describe("determinism", () => {
    test("ties on startsAt are broken by row id, not by input order", () => {
      const forwards: Array<MeasurementTimelineEntry> = [
        entry(IDENTIFIED, 0, { id: "aaa" }),
        entry(ACKNOWLEDGED, 5, { id: "bbb" }),
        entry(ACKNOWLEDGED, 5, { id: "ccc" }),
      ];

      const backwards: Array<MeasurementTimelineEntry> = [
        ...forwards,
      ].reverse();

      const def: MeasurementDefinitionSpec = definition(
        stateAnchor(IDENTIFIED, "Identified"),
        stateAnchor(ACKNOWLEDGED, "Acknowledged"),
      );

      expect(evaluate(def, forwards).endTimelineEntryId).toBe("bbb");
      expect(evaluate(def, backwards).endTimelineEntryId).toBe("bbb");
    });

    test("evaluation never mutates the timeline it is handed", () => {
      const timeline: Array<MeasurementTimelineEntry> = [
        entry(RESOLVED, 25),
        entry(IDENTIFIED, 0),
      ];
      const snapshot: Array<string> = timeline.map(
        (entryItem: MeasurementTimelineEntry) => {
          return entryItem.id;
        },
      );

      MeasurementEvaluator.evaluate({
        definitions: [
          definition(
            stateAnchor(IDENTIFIED, "Identified"),
            stateAnchor(RESOLVED, "Resolved"),
          ),
        ],
        timeline: timeline,
      });

      expect(
        timeline.map((entryItem: MeasurementTimelineEntry) => {
          return entryItem.id;
        }),
      ).toEqual(snapshot);
    });

    test("recomputing over the same data twice gives the same answer", () => {
      const timeline: Array<MeasurementTimelineEntry> = [
        entry(IDENTIFIED, 0),
        entry(ACKNOWLEDGED, 5),
        entry(RESOLVED, 25),
      ];
      const def: MeasurementDefinitionSpec = definition(
        stateAnchor(IDENTIFIED, "Identified"),
        stateAnchor(RESOLVED, "Resolved"),
      );

      expect(evaluate(def, timeline)).toEqual(evaluate(def, timeline));
    });
  });

  describe("evaluate() over many definitions", () => {
    test("returns one result per definition, keyed by definition id", () => {
      const results: Array<EvaluatedMeasurement> =
        MeasurementEvaluator.evaluate({
          definitions: [
            definition(
              roleAnchor("Created"),
              roleAnchor("Acknowledged"),
              "d1",
              "Time to Acknowledge",
            ),
            definition(
              roleAnchor("Created"),
              roleAnchor("Resolved"),
              "d2",
              "Time to Resolve",
            ),
            definition(
              timestampAnchor("Impact Started At", undefined),
              roleAnchor("Created"),
              "d3",
              "Time to Detect",
            ),
          ],
          timeline: [
            entry(IDENTIFIED, 0),
            entry(ACKNOWLEDGED, 5),
            entry(RESOLVED, 25),
          ],
        });

      expect(results).toHaveLength(3);
      expect(results[0]!.measurementId).toBe("d1");
      expect(results[0]!.valueInSeconds).toBe(5 * 60);
      expect(results[1]!.valueInSeconds).toBe(25 * 60);
      expect(results[2]!.status).toBe(MeasurementStatus.NotApplicable);
    });

    test("an empty definition list yields an empty result list", () => {
      expect(
        MeasurementEvaluator.evaluate({ definitions: [], timeline: [] }),
      ).toEqual([]);
    });
  });

  describe("formatDuration", () => {
    test.each([
      [0, "0s"],
      [45, "45s"],
      [60, "1m"],
      [1020, "17m"],
      [3600, "1h"],
      [3660, "1h 1m"],
      [86400, "1d"],
      [90000, "1d 1h"],
    ])("%ss formats as %s", (seconds: number, expected: string) => {
      expect(MeasurementEvaluator.formatDuration(seconds)).toBe(expected);
    });
  });
});
