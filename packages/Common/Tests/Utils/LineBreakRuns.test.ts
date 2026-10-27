import MonitorCriteriaObservationBuilder from "../../Server/Utils/Monitor/MonitorCriteriaObservationBuilder";
import Monitor from "../../Models/DatabaseModels/Monitor";
import { CheckOn, FilterType } from "../../Types/Monitor/CriteriaFilter";
import { DatabaseMetricGroup } from "../../Types/Monitor/DatabaseMetricCatalog";
import DatabaseMonitorResponse, {
  DatabaseMetricGroupUnavailableReason,
} from "../../Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import MonitorMetricType from "../../Types/Monitor/MonitorMetricType";
import MonitorStep from "../../Types/Monitor/MonitorStep";
import ObjectID from "../../Types/ObjectID";
import ProbeMonitorResponse from "../../Types/Probe/ProbeMonitorResponse";
import { collapseLineBreakRuns } from "../../Utils/LineBreakRuns";
import { markdownCodeSpan } from "../../Utils/Markdown/MarkdownEscape";
import { generatedTexts } from "../Helpers/GeneratedTexts";
import { fastestRun } from "../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A RUN OF WHITE SPACE THAT HOLDS A LINE BREAK BECOMES ONE SPACE, EACH RUN
 * READ ONCE.
 *
 * Text that may span lines is written on one line in several places: a code
 * span in a feed item, the remediation a database monitor's probe reported
 * (in the sentence a criterion's observation says), the title an SLO alert or
 * incident is written with. Each turned every run of white space holding a
 * "\r" or "\n" into one space with a pattern that was tried again from every
 * character of a run that holds none, each try reading on to the end of the
 * run - so a long run of spaces took time that grew with the square of its
 * length. collapseLineBreakRuns reads each run once and changes exactly what
 * the pattern changed.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const LINE_SEPARATOR: string = String.fromCharCode(0x2028);

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

/*
 * How long the work takes: the fastest of up to three attempts, counted as
 * it would have run on a usual runner when every attempt overran on a slow
 * one (Tests/Helpers/FastestRun).
 */
const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  return fastestRun({ run: run, limitInMs: 2000 }).inMs;
};

// The pattern as it was: the reference the helper must agree with.
const LINE_BREAK_RUN_BEFORE: RegExp = /\s*[\r\n]+\s*/g;

const before: (text: string) => string = (text: string): string => {
  return text.replace(new RegExp(LINE_BREAK_RUN_BEFORE.source, "g"), " ");
};

const WORST_CASES: Array<[string, string]> = [
  ["spaces, then a character and a line break", repeat(" ", LENGTH) + "x\n"],
  ["tabs, then a NUL and a line break", repeat("\t", LENGTH) + "\u0000\n"],
  ["spaces and tabs with no line break", repeat(" \t", LENGTH) + "x"],
  ["line breaks between spaces", repeat(" \n ", LENGTH)],
  [
    "no-break spaces and line separators",
    repeat(" " + LINE_SEPARATOR, LENGTH) + "x\r",
  ],
];

// What a database monitor's probe reported for a metric it could not collect.
const observe: (remediation: string) => string | null = (
  remediation: string,
): string | null => {
  const databaseMonitorResponse: DatabaseMonitorResponse = {
    isOnline: true,
    responseTimeInMs: 12,
    failureCause: "",
    metrics: {},
    collectedGroups: [],
    unavailableGroups: [
      {
        group: DatabaseMetricGroup.Connections,
        reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
        message: "permission was denied",
        remediation,
      },
    ],
    connectionError: null,
  };

  const dataToProcess: ProbeMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "",
    isOnline: true,
    monitoredAt: new Date(),
    databaseMonitorResponse,
  };

  return MonitorCriteriaObservationBuilder.describeFilterObservation({
    monitor: new Monitor(),
    monitorStep: new MonitorStep(),
    criteriaFilter: {
      checkOn: CheckOn.DatabaseMetric,
      filterType: FilterType.GreaterThan,
      value: 100,
      databaseMonitorOptions: {
        metricType: MonitorMetricType.DatabaseConnectionsTotal,
      },
    },
    dataToProcess,
  });
};

describe("a run of white space that holds a line break is read once", () => {
  test.each(WORST_CASES)("the helper: %s", (_label: string, text: string) => {
    expect(
      timeOf(() => {
        return collapseLineBreakRuns(text);
      }),
    ).toBeLessThan(2000);
  });

  // The real path: a probe's report, read at ingest by the criterion's observation.
  test.each(WORST_CASES)(
    "a database monitor's remediation in its observation: %s",
    (_label: string, remediation: string) => {
      let observation: string | null = null;

      expect(
        timeOf(() => {
          observation = observe(remediation);
        }),
      ).toBeLessThan(2000);
      expect(observation).toContain("was not collected on this check");
    },
  );

  test.each(WORST_CASES)(
    "a feed item's code span: %s",
    (_label: string, value: string) => {
      expect(
        timeOf(() => {
          return markdownCodeSpan(value);
        }),
      ).toBeLessThan(2000);
    },
  );
});

describe("it changes exactly what the pattern changed", () => {
  test("a run holding a line break is one space; any other run stays", () => {
    expect(collapseLineBreakRuns("a \n\t b")).toBe("a b");
    expect(collapseLineBreakRuns("a\r\nb")).toBe("a b");
    expect(collapseLineBreakRuns("a\rb\nc")).toBe("a b c");
    expect(collapseLineBreakRuns("a \t b")).toBe("a \t b");
    expect(collapseLineBreakRuns(`a${LINE_SEPARATOR}b`)).toBe(
      `a${LINE_SEPARATOR}b`,
    );
    expect(collapseLineBreakRuns("\n")).toBe(" ");
    expect(collapseLineBreakRuns("")).toBe("");
  });

  test("a remediation that spans lines is still one sentence", () => {
    expect(observe("GRANT a TO b;\n  GRANT c TO d;")).toBe(
      "Connections was not collected on this check: the monitoring login is missing a grant (GRANT a TO b; GRANT c TO d;).",
    );
  });

  test("on forty thousand drawn texts, as the pattern wrote them", () => {
    const mismatches: Array<{ text: string; now: string; before: string }> = [];
    let changed: number = 0;

    for (const text of generatedTexts(
      40000,
      2718,
      [
        " ",
        "\t",
        "\n",
        "\r",
        "\r\n",
        " ",
        "　",
        "﻿",
        "\v",
        "\f",
        LINE_SEPARATOR,
        "a",
        "b",
        "\u0000",
      ],
      16,
    )) {
      const expected: string = before(text);
      const actual: string = collapseLineBreakRuns(text);

      if (expected !== text) {
        changed++;
      }

      if (actual !== expected) {
        mismatches.push({ text, now: actual, before: expected });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(changed).toBeGreaterThan(10000);
  });
});
