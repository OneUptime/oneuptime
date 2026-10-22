import CorrelationQueries, {
  CORRELATION_TEMPORAL_CANDIDATE_LIMIT,
  CorrelationCountRow,
  CorrelationNewValueRow,
  CorrelationTemporalRow,
} from "../../../../../Server/Utils/SecurityEvent/Correlation/CorrelationQueries";
import CorrelationRuleMatcher, {
  CorrelationMatchResult,
  describeGap,
} from "../../../../../Server/Utils/SecurityEvent/Correlation/CorrelationRuleMatcher";
import ObjectID from "../../../../../Types/ObjectID";
import { DetectionRuleDefinition } from "../../../../../Types/SecurityEvent/SigmaCorrelation";
import SigmaRuleSetParser from "../../../../../Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * CorrelationRuleMatcher turns what the reads answer into the groups the
 * engine opens alerts and cases for: the window each type reads, the
 * steps' times worked through CorrelationTimeline, and the sentence each
 * match is described by. The reads are stubbed here; the real-server suite
 * (App Tests/Telemetry/SecurityCorrelationRulesClickhouse) runs them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const MINUTE: number = 60 * 1000;
const START: Date = new Date("2026-10-21T10:00:00.000Z");
const END: Date = new Date("2026-10-21T10:15:00.000Z");

const FAILED: string = `title: Failed sign-in
name: failed_sign_in
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection`;

const SUCCEEDED: string = `title: Successful sign-in
name: successful_sign_in
detection:
  selection:
    className: Authentication
    statusName: Success
  condition: selection`;

function correlation(
  yaml: string,
): Extract<DetectionRuleDefinition, { kind: "correlation" }> {
  const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(yaml);

  if (definition.kind !== "correlation") {
    throw new Error("expected a correlation");
  }

  return definition;
}

async function match(
  definition: Extract<DetectionRuleDefinition, { kind: "correlation" }>,
  maxGroups: number = 100,
): Promise<CorrelationMatchResult> {
  return CorrelationRuleMatcher.findMatches({
    projectId: PROJECT_ID,
    correlation: definition.correlation,
    steps: definition.steps,
    startTime: START,
    endTime: END,
    maxGroups,
  });
}

function at(minutes: number): number {
  return START.getTime() + minutes * MINUTE;
}

function temporalRow(
  values: Array<string>,
  stepTimes: Array<Array<number>>,
): CorrelationTemporalRow {
  return {
    values,
    stepCounts: stepTimes.map((times: Array<number>): number => {
      return times.length;
    }),
    stepTimes,
    matchCount: stepTimes.flat().length,
    lastMatchAt: new Date(Math.max(...stepTimes.flat())),
    sampleMessage: "sample",
    sampleObservables: ["alice"],
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("describeGap", () => {
  test("how far apart two times are, as a person says it", () => {
    expect(describeGap(0)).toBe("less than a second");
    expect(describeGap(-5)).toBe("less than a second");
    expect(describeGap(1000)).toBe("1 second");
    expect(describeGap(45 * 1000)).toBe("45 seconds");
    expect(describeGap(MINUTE)).toBe("1 minute");
    expect(describeGap(150 * 1000)).toBe("2 minutes");
    expect(describeGap(60 * MINUTE)).toBe("1 hour");
    expect(describeGap(5 * 60 * MINUTE + 59 * MINUTE)).toBe("5 hours");
  });
});

describe("CorrelationRuleMatcher: counts", () => {
  test("event_count reads a whole timespan before the run and says how many events", async () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Brute force
correlation:
  type: event_count
  rules: [failed_sign_in]
  group-by: [principalIp, principalUser]
  timespan: 10m
  condition:
    gte: 10
---
${FAILED}`);

    const rows: Array<CorrelationCountRow> = [
      {
        values: ["203.0.113.7", "alice"],
        matchCount: 12,
        distinctCount: 0,
        eventsInRun: 4,
        sampleMessage: "Failed password",
        sampleObservables: ["203.0.113.7"],
      },
    ];

    const read: SpyInstance<typeof CorrelationQueries.findCountGroups> = jest
      .spyOn(CorrelationQueries, "findCountGroups")
      .mockResolvedValue(rows);

    const result: CorrelationMatchResult = await match(definition);

    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]![0].countDistinct).toBe(false);
    expect(read.mock.calls[0]![0].window.startTime).toBe(START);
    expect(read.mock.calls[0]![0].window.endTime).toBe(END);
    expect(read.mock.calls[0]![0].window.readFrom.toISOString()).toBe(
      "2026-10-21T09:50:10.000Z",
    );
    expect(result.readFrom.toISOString()).toBe("2026-10-21T09:50:10.000Z");
    expect(result.candidatesCapped).toBe(false);
    expect(result.groups).toEqual([
      {
        groupValue: "203.0.113.7 / alice",
        matchCount: 12,
        distinctCount: 0,
        sampleMessage: "Failed password",
        sampleObservables: ["203.0.113.7"],
        groupFields: [
          { field: "principalIp", value: "203.0.113.7" },
          { field: "principalUser", value: "alice" },
        ],
        summary: "12 events in 10 minutes",
      },
    ]);
  });

  test("value_count says how many different values, and of what", async () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Spraying
correlation:
  type: value_count
  rules: [failed_sign_in]
  group-by: [principalIp]
  timespan: 1h
  condition:
    field: principalUser
    gte: 5
---
${FAILED}`);

    jest.spyOn(CorrelationQueries, "findCountGroups").mockResolvedValue([
      {
        values: ["192.0.2.50"],
        matchCount: 1,
        distinctCount: 1,
        eventsInRun: 1,
        sampleMessage: "",
        sampleObservables: [],
      },
      {
        values: ["192.0.2.51"],
        matchCount: 9,
        distinctCount: 6,
        eventsInRun: 9,
        sampleMessage: "",
        sampleObservables: [],
      },
    ]);

    const result: CorrelationMatchResult = await match(definition);

    expect(result.groups[0]!.summary).toBe(
      "1 different principalUser value in 1 hour (1 event)",
    );
    expect(result.groups[1]!.summary).toBe(
      "6 different principalUser values in 1 hour (9 events)",
    );
    expect(result.groups[1]!.distinctCount).toBe(6);
  });
});

describe("CorrelationRuleMatcher: sequences and events together", () => {
  const SEQUENCE: string = `title: Many failures then success
correlation:
  type: temporal_ordered
  rules: [many_failures, successful_sign_in]
  group-by: [principalUser]
  timespan: 10m
---
title: Many failures
name: many_failures
correlation:
  type: event_count
  rules: [failed_sign_in]
  timespan: 5m
  condition:
    gte: 3
---
${FAILED}
---
${SUCCEEDED}`;

  test("reads the timespan and the longest counting step before the run, and asks for every step", async () => {
    const read: SpyInstance<typeof CorrelationQueries.findTemporalGroups> = jest
      .spyOn(CorrelationQueries, "findTemporalGroups")
      .mockResolvedValue([]);

    const result: CorrelationMatchResult = await match(correlation(SEQUENCE));

    expect(result.groups).toEqual([]);
    expect(read.mock.calls[0]![0].window.readFrom.toISOString()).toBe(
      "2026-10-21T09:45:00.000Z",
    );
    expect(read.mock.calls[0]![0].stepMinimums).toEqual([3, 1]);
    expect(read.mock.calls[0]![0].minimumSteps).toBe(2);
    expect(read.mock.calls[0]![0].limit).toBe(
      CORRELATION_TEMPORAL_CANDIDATE_LIMIT,
    );
  });

  test("a counting step happens when its count is reached, and the chain is described", async () => {
    jest.spyOn(CorrelationQueries, "findTemporalGroups").mockResolvedValue([
      // carol: three failures by minute 2, a success at minute 4.
      temporalRow(["carol"], [[at(0), at(1), at(2)], [at(4)]]),
      // dave: only two failures - the counting step never happens.
      temporalRow(["dave"], [[at(0), at(1)], [at(4)]]),
      // erin: the success came before the failures.
      temporalRow(["erin"], [[at(5), at(6), at(7)], [at(1)]]),
    ]);

    const result: CorrelationMatchResult = await match(correlation(SEQUENCE));

    expect(
      result.groups.map((group: { groupValue: string }): string => {
        return group.groupValue;
      }),
    ).toEqual(["carol"]);
    expect(result.groups[0]!.summary).toBe(
      "Many failures (3+ events in 5 minutes), then Successful sign-in, 2 minutes apart",
    );
    expect(result.groups[0]!.groupFields).toEqual([
      { field: "principalUser", value: "carol" },
    ]);
  });

  test("a chain that ended before this run is not reported again", async () => {
    jest
      .spyOn(CorrelationQueries, "findTemporalGroups")
      .mockResolvedValue([
        temporalRow(["carol"], [[at(-9), at(-8), at(-7)], [at(-5)]]),
      ]);

    const result: CorrelationMatchResult = await match(correlation(SEQUENCE));

    expect(result.groups).toEqual([]);
  });

  test("events together: at least the steps the condition asks for, and only those named", async () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: Two of three
correlation:
  type: temporal
  rules: [failed_sign_in, successful_sign_in, third]
  group-by: [principalHost]
  timespan: 5m
  condition:
    gte: 2
---
${FAILED}
---
${SUCCEEDED}
---
title: Third
name: third
detection:
  selection:
    className: Account Change
  condition: selection`);

    const read: SpyInstance<typeof CorrelationQueries.findTemporalGroups> = jest
      .spyOn(CorrelationQueries, "findTemporalGroups")
      .mockResolvedValue([temporalRow(["web-1"], [[at(1)], [], [at(3)]])]);

    const result: CorrelationMatchResult = await match(definition);

    expect(read.mock.calls[0]![0].minimumSteps).toBe(2);
    expect(result.groups[0]!.summary).toBe(
      "Failed sign-in, Third, within 2 minutes",
    );
  });

  test("stops at the groups a run records, and says when it read its candidate limit", async () => {
    const rows: Array<CorrelationTemporalRow> = [];

    for (
      let index: number = 0;
      index < CORRELATION_TEMPORAL_CANDIDATE_LIMIT;
      index++
    ) {
      rows.push(
        temporalRow([`user${index}`], [[at(0), at(1), at(2)], [at(3)]]),
      );
    }

    jest
      .spyOn(CorrelationQueries, "findTemporalGroups")
      .mockResolvedValue(rows);

    const result: CorrelationMatchResult = await match(
      correlation(SEQUENCE),
      5,
    );

    expect(result.groups).toHaveLength(5);
    expect(result.candidatesCapped).toBe(true);
  });
});

describe("CorrelationRuleMatcher: first seen", () => {
  test("reads the history before the run and names the new values first", async () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: New address
correlation:
  type: new_value
  rules: [successful_sign_in]
  group-by: [principalUser]
  timespan: 14d
  condition:
    field: principalIp
---
${SUCCEEDED}`);

    const rows: Array<CorrelationNewValueRow> = [
      {
        values: ["frank"],
        newValues: [
          "203.0.113.1",
          "203.0.113.2",
          "203.0.113.3",
          "203.0.113.4",
          "203.0.113.5",
          "203.0.113.6",
        ],
        newValueCount: 7,
        matchCount: 9,
        firstSeenAt: new Date(at(3)),
        sampleMessage: "Accepted password",
        sampleObservables: ["frank", "203.0.113.1"],
      },
    ];

    const read: SpyInstance<typeof CorrelationQueries.findNewValueGroups> = jest
      .spyOn(CorrelationQueries, "findNewValueGroups")
      .mockResolvedValue(rows);

    const result: CorrelationMatchResult = await match(definition);

    expect(read.mock.calls[0]![0].historyFrom.toISOString()).toBe(
      "2026-10-07T10:00:00.000Z",
    );
    expect(read.mock.calls[0]![0].window.readFrom).toBe(START);
    expect(result.readFrom.toISOString()).toBe("2026-10-07T10:00:00.000Z");
    expect(result.groups[0]!.summary).toBe(
      "First principalIp in 2 weeks: 203.0.113.1, 203.0.113.2, 203.0.113.3, 203.0.113.4, 203.0.113.5 and 2 more",
    );
    expect(result.groups[0]!.distinctCount).toBe(7);
    expect(result.groups[0]!.sampleObservables.slice(0, 7)).toEqual([
      "203.0.113.1",
      "203.0.113.2",
      "203.0.113.3",
      "203.0.113.4",
      "203.0.113.5",
      "203.0.113.6",
      "frank",
    ]);
  });

  test("several value fields are split into their own observables", async () => {
    const definition: Extract<
      DetectionRuleDefinition,
      { kind: "correlation" }
    > = correlation(`title: New device and address
correlation:
  type: new_value
  rules: [successful_sign_in]
  group-by: [principalUser]
  timespan: 7d
  condition:
    field: [principalIp, principalHost]
---
${SUCCEEDED}`);

    jest.spyOn(CorrelationQueries, "findNewValueGroups").mockResolvedValue([
      {
        values: ["frank"],
        newValues: ["203.0.113.1 / laptop-9"],
        newValueCount: 1,
        matchCount: 1,
        firstSeenAt: new Date(at(3)),
        sampleMessage: "",
        sampleObservables: [],
      },
    ]);

    const result: CorrelationMatchResult = await match(definition);

    expect(result.groups[0]!.sampleObservables).toEqual([
      "203.0.113.1",
      "laptop-9",
    ]);
    expect(result.groups[0]!.summary).toBe(
      "First principalIp / principalHost in 1 week: 203.0.113.1 / laptop-9",
    );
  });
});
