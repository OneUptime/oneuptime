/*
 * The evaluator's import chain pulls the native isolated-vm addon
 * (MonitorCriteriaEvaluator → VMAPI → VMRunner). Nothing under test here
 * touches the sandbox, and the prebuilt binary cannot always dlopen in the
 * test environment — so stub the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import CompareCriteria from "../../../../Server/Utils/Monitor/Criteria/CompareCriteria";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MetricCriteriaContext from "../../../../Types/Monitor/MetricMonitor/MetricCriteriaContext";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * HUMAN-READABLE METRIC VALUES IN THE ROOT CAUSE.
 *
 * The metric root cause is what an alert or incident email shows under
 * "Root Cause" — MonitorCriteriaEvaluator writes it, AlertService and
 * IncidentService copy it onto the row, and the owner-notification jobs
 * run it through Markdown.convertToHTML for the email body.
 *
 * Before this suite existed, nothing anywhere pinned the Breaching
 * Samples table or the "- Unit:" line, and both rendered raw digits with
 * the exporter's raw UCUM code glued on: a memory breach that the
 * dashboard drew as "1.07 GB" arrived in the inbox as "1073741824 By",
 * and a ratio metric's Value column read "0.06 1".
 *
 * These tests pin:
 *   - the Value column at human scale, in the unit each row landed on,
 *   - component columns each in their OWN unit, with no unit in the header
 *     (auto-scaling means neighbouring rows disagree with any one header),
 *   - the "- Unit:" line spelled out, and dropped when there is no unit,
 *   - the formula guard: a formula expression is not a metric name,
 *   - that the table and the "Filter Conditions Met" sentence in the same
 *     email render the same sample identically.
 */

type EvaluatorPrivate = {
  buildMetricRootCauseContext: (input: {
    criteriaInstance: MonitorCriteriaInstance;
    monitor: Monitor;
    monitorStep?: MonitorStep | undefined;
  }) => string | null;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

const BREACH_TIME: Date = new Date("2026-08-14T10:30:00.000Z");
const BREACH_TIME_ISO: string = "2026-08-14T10:30:00.000Z";

function makeContext(
  overrides: Partial<MetricCriteriaContext> = {},
): MetricCriteriaContext {
  return {
    metricName: "k8s.pod.memory.usage",
    alias: "a",
    unit: null,
    aggregationType: null,
    isFormula: false,
    filterAttributes: {},
    groupBy: [],
    breachingSamples: [
      {
        value: 1073741824,
        timestamp: BREACH_TIME,
        attributes: {},
      },
    ],
    ...overrides,
  };
}

function makeCriteriaInstance(
  ctx: MetricCriteriaContext,
): MonitorCriteriaInstance {
  const filter: CriteriaFilter = {
    checkOn: CheckOn.MetricValue,
    metricCriteriaContext: ctx,
  } as CriteriaFilter;

  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data = {
    monitorStatusId: undefined,
    filterCondition: FilterCondition.All,
    filters: [filter],
    incidents: [],
    alerts: [],
    name: "Memory breach",
    description: "Memory breach",
    id: ObjectID.generate().toString(),
  };
  return instance;
}

function rootCause(ctx: MetricCriteriaContext): string {
  const context: string | null = Evaluator.buildMetricRootCauseContext({
    criteriaInstance: makeCriteriaInstance(ctx),
    monitor: new Monitor(),
  });

  expect(context).not.toBeNull();
  return context as string;
}

/** The one data row of the Breaching Samples table. */
function sampleRow(context: string): string {
  const row: string | undefined = context.split("\n").find((line: string) => {
    return line.includes(BREACH_TIME_ISO);
  });

  expect(row).toBeDefined();
  return row as string;
}

/** The header row of the Breaching Samples table. */
function headerRow(context: string): string {
  const row: string | undefined = context.split("\n").find((line: string) => {
    return line.startsWith("| Timestamp |");
  });

  expect(row).toBeDefined();
  return row as string;
}

describe("MonitorCriteriaEvaluator - Breaching Samples value column", () => {
  test("renders bytes at human scale instead of raw digits", () => {
    const context: string = rootCause(makeContext({ unit: "By" }));

    expect(sampleRow(context)).toBe(
      `| \`${BREACH_TIME_ISO}\` | \`k8s.pod.memory.usage\` | \`a\` | 1.07 GB |`,
    );
    expect(context).not.toContain("1073741824");
  });

  test("renders a duration at human scale", () => {
    const context: string = rootCause(
      makeContext({
        metricName: "http.server.duration",
        unit: "ms",
        breachingSamples: [
          { value: 1500, timestamp: BREACH_TIME, attributes: {} },
        ],
      }),
    );

    expect(sampleRow(context)).toContain("| 1.5 sec |");
  });

  test("renders a value the user typed a GB threshold against in GB terms", () => {
    /*
     * When the criteria carries a thresholdUnit, samples arrive already
     * converted into it — so ctx.unit is "GB" and the values are counts
     * of gigabytes. ValueFormatter has no ladder for "GB" on its own;
     * MetricValueFormatter restates the value in bytes first.
     */
    const context: string = rootCause(
      makeContext({
        unit: "GB",
        breachingSamples: [
          { value: 2500, timestamp: BREACH_TIME, attributes: {} },
        ],
      }),
    );

    expect(sampleRow(context)).toContain("| 2.5 TB |");
  });

  test("each row names the unit IT landed on", () => {
    const context: string = rootCause(
      makeContext({
        unit: "By",
        breachingSamples: [
          {
            value: 921600,
            timestamp: new Date("2026-08-14T10:29:00.000Z"),
            attributes: {},
          },
          { value: 1258291, timestamp: BREACH_TIME, attributes: {} },
        ],
      }),
    );

    /*
     * 922 KB and 1.26 MB in the same table. This is exactly why the unit
     * rides each cell instead of the column header — no single header
     * could describe both rows.
     */
    expect(context).toContain("| 922 KB |");
    expect(context).toContain("| 1.26 MB |");
  });

  test("a ratio metric's fraction is shown as the percentage it means", () => {
    const context: string = rootCause(
      makeContext({
        metricName: "system.cpu.utilization",
        unit: "1",
        breachingSamples: [
          { value: 0.0585, timestamp: BREACH_TIME, attributes: {} },
        ],
      }),
    );

    expect(sampleRow(context)).toContain("| 5.85% |");
    // The old rendering: a bare "0.06", which reads as 0.06%.
    expect(context).not.toContain("| 0.06 |");
    expect(context).not.toContain("0.06 1");
  });

  test("a UCUM annotation-only unit is dropped rather than printed", () => {
    const context: string = rootCause(
      makeContext({
        metricName: "process.threads",
        unit: "{thread}",
        breachingSamples: [
          { value: 512, timestamp: BREACH_TIME, attributes: {} },
        ],
      }),
    );

    expect(sampleRow(context)).toContain("| 512 |");
    expect(context).not.toContain("{thread}");
  });

  /*
   * BACKWARD COMPATIBILITY. A metric with no unit must keep every digit —
   * a counter at 5000 is not "5K" in an alert, because the reader may be
   * scanning the table for the exact value that crossed the threshold.
   */
  test("a unitless value keeps its exact digits", () => {
    const context: string = rootCause(
      makeContext({
        metricName: "http.server.request.count",
        unit: null,
        breachingSamples: [
          { value: 5000, timestamp: BREACH_TIME, attributes: {} },
        ],
      }),
    );

    expect(sampleRow(context)).toContain("| 5000 |");
    expect(context).not.toContain("5K");
  });

  test("a unitless non-integer is rounded to two decimals", () => {
    const context: string = rootCause(
      makeContext({
        unit: null,
        breachingSamples: [
          { value: 2.3333333333333335, timestamp: BREACH_TIME, attributes: {} },
        ],
      }),
    );

    expect(sampleRow(context)).toContain("| 2.33 |");
  });

  /*
   * ValueFormatter renders Infinity as "InfinityP PB" — its
   * formatLargeNumber divides by 1e15, gets Infinity back and appends the
   * "P". A broken metric must not produce that in an on-call email.
   */
  test("a non-finite sample is reported verbatim", () => {
    const context: string = rootCause(
      makeContext({
        unit: "By",
        breachingSamples: [
          { value: Infinity, timestamp: BREACH_TIME, attributes: {} },
        ],
      }),
    );

    expect(sampleRow(context)).toContain("| Infinity |");
    expect(context).not.toContain("InfinityP");
  });

  test("attribute columns are unaffected", () => {
    const context: string = rootCause(
      makeContext({
        unit: "By",
        groupBy: ["k8s.pod.name"],
        breachingSamples: [
          {
            value: 1073741824,
            timestamp: BREACH_TIME,
            attributes: { "k8s.pod.name": "web-1" },
          },
        ],
      }),
    );

    expect(headerRow(context)).toBe(
      "| Timestamp | Metric | Alias | Value | k8s.pod.name |",
    );
    expect(sampleRow(context)).toContain("| web-1 |");
  });
});

describe("MonitorCriteriaEvaluator - Breaching Samples component columns", () => {
  function formulaContext(): MetricCriteriaContext {
    return makeContext({
      metricName: "a + b",
      alias: "c",
      isFormula: true,
      formulaExpression: "a + b",
      unit: "By",
      components: [
        {
          alias: "a",
          name: "container.memory.usage",
          unit: "By",
          isFormula: false,
        },
        {
          alias: "b",
          name: "container.memory.cache",
          unit: "ms",
          isFormula: false,
        },
      ],
      breachingSamples: [
        {
          value: 1073741824,
          timestamp: BREACH_TIME,
          attributes: {},
          componentValues: [
            { alias: "a", value: 536870912 },
            { alias: "b", value: 1500 },
          ],
        },
      ],
    });
  }

  test("each component cell is formatted in its own unit", () => {
    const context: string = rootCause(formulaContext());

    expect(sampleRow(context)).toBe(
      `| \`${BREACH_TIME_ISO}\` | \`a + b\` | \`c\` | 1.07 GB | 537 MB | 1.5 sec |`,
    );
  });

  /*
   * The header used to read "a (By)". Now that a cell says which scale it
   * landed on, a header unit is a claim two rows of the same column can
   * contradict — and the Components bullet list above the table still
   * records the configured unit, so nothing is lost.
   */
  test("component headers carry the alias only, not the configured unit", () => {
    const context: string = rootCause(formulaContext());

    expect(headerRow(context)).toBe(
      "| Timestamp | Metric | Alias | Value | a | b |",
    );
    expect(context).not.toContain("| a (By) |");
  });

  test("the Components bullet list spells each component's unit out", () => {
    const context: string = rootCause(formulaContext());

    expect(context).toContain("- `a` = `container.memory.usage` — unit: Bytes");
    expect(context).toContain(
      "- `b` = `container.memory.cache` — unit: Milliseconds",
    );
  });

  test("a component with no value for this sample still renders a dash", () => {
    const ctx: MetricCriteriaContext = formulaContext();
    ctx.breachingSamples![0]!.componentValues = [
      { alias: "a", value: 536870912 },
      { alias: "b", value: null },
    ];

    expect(sampleRow(rootCause(ctx))).toContain("| 537 MB | - |");
  });
});

describe("MonitorCriteriaEvaluator - the Unit line", () => {
  test("spells the UCUM code out", () => {
    expect(rootCause(makeContext({ unit: "By" }))).toContain("- Unit: Bytes");
  });

  test("names the percent a fraction metric carries", () => {
    const context: string = rootCause(
      makeContext({ metricName: "system.cpu.utilization", unit: "1" }),
    );

    expect(context).toContain("- Unit: Percent");
  });

  /*
   * The line used to read "- Unit: 1" for every ratio metric — a unit
   * that names nothing, printed as if it did.
   */
  test("is dropped entirely when the unit names no dimension", () => {
    expect(rootCause(makeContext({ unit: "1" }))).not.toContain("- Unit:");
    expect(rootCause(makeContext({ unit: "{thread}" }))).not.toContain(
      "- Unit:",
    );
    expect(rootCause(makeContext({ unit: null }))).not.toContain("- Unit:");
  });
});

/*
 * THE FORMULA GUARD.
 *
 * MetricCriteriaContext.metricName is the FORMULA EXPRESSION when the
 * criteria targets a formula. The only use a name has downstream is
 * ValueFormatter.isFractionMetric, whose regex asks whether the name ends
 * in `.utilization` / `_ratio` / `_percent`. A formula written as
 * `a / b_ratio` ends in `_ratio`, so feeding it through would silently
 * report every value at 100× its real magnitude.
 */
describe("MonitorCriteriaEvaluator - formula names are not metric names", () => {
  test("a formula ending in _ratio is not multiplied by 100", () => {
    const context: string = rootCause(
      makeContext({
        metricName: "a / b_ratio",
        alias: "c",
        isFormula: true,
        formulaExpression: "a / b_ratio",
        unit: "1",
        breachingSamples: [
          { value: 0.42, timestamp: BREACH_TIME, attributes: {} },
        ],
      }),
    );

    expect(sampleRow(context)).toContain("| 0.42 |");
    expect(context).not.toContain("42.00%");
    expect(context).not.toContain("- Unit:");
  });

  test("a formula COMPONENT ending in _ratio is not multiplied by 100 either", () => {
    const context: string = rootCause(
      makeContext({
        metricName: "c",
        alias: "c",
        isFormula: true,
        formulaExpression: "x",
        unit: null,
        components: [
          {
            alias: "x",
            name: "p / q_utilization",
            unit: "1",
            isFormula: true,
          },
        ],
        breachingSamples: [
          {
            value: 1,
            timestamp: BREACH_TIME,
            attributes: {},
            componentValues: [{ alias: "x", value: 0.42 }],
          },
        ],
      }),
    );

    expect(sampleRow(context)).toContain("| 0.42 |");
    expect(context).not.toContain("42.00%");
  });

  /*
   * A plain metric criteria DOES get the heuristic — this is the control
   * that shows the guard is narrow rather than a blanket opt-out.
   */
  test("a plain metric criteria still gets the fraction heuristic", () => {
    const context: string = rootCause(
      makeContext({
        metricName: "system.memory.utilization",
        isFormula: false,
        unit: "1",
        breachingSamples: [
          { value: 0.42, timestamp: BREACH_TIME, attributes: {} },
        ],
      }),
    );

    expect(sampleRow(context)).toContain("| 42.00% |");
  });
});

/*
 * ONE EMAIL, ONE ANSWER.
 *
 * The unit-suppression rule was hand-rolled three separate times before
 * this change — in CompareCriteria's "Filter Conditions Met" sentence, in
 * MonitorCriteriaObservationBuilder, and nowhere at all in the Breaching
 * Samples table — with the result that a single evaluation read
 * differently in its own two halves: "0.31" in the sentence and "0.31 1"
 * in the table directly beneath it.
 *
 * Both sections of one email now go through MetricValueFormatter. These
 * tests assert the two strings are IDENTICAL rather than merely both
 * plausible, so a fourth copy of the rule cannot quietly appear.
 */
describe("MonitorCriteriaEvaluator - the table and the sentence agree", () => {
  function bothRenderings(input: {
    value: number;
    unit: string | null;
    metricName: string;
  }): { cell: string; sentence: string } {
    const ctx: MetricCriteriaContext = makeContext({
      metricName: input.metricName,
      unit: input.unit,
      breachingSamples: [
        { value: input.value, timestamp: BREACH_TIME, attributes: {} },
      ],
    });

    const row: string = sampleRow(rootCause(ctx));
    const cells: Array<string> = row.split("|").map((cell: string) => {
      return cell.trim();
    });

    return {
      // | ts | metric | alias | VALUE | → index 4 once the leading "" is counted.
      cell: cells[4] as string,
      sentence: CompareCriteria.getCompareMessage({
        values: input.value,
        threshold: input.value,
        criteriaFilter: {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.GreaterThan,
        } as CriteriaFilter,
        metricDisplayName: input.metricName,
        metricName: input.metricName,
        unit: input.unit || undefined,
      }),
    };
  }

  const cases: Array<{
    value: number;
    unit: string | null;
    metricName: string;
  }> = [
    { value: 1073741824, unit: "By", metricName: "k8s.pod.memory.usage" },
    { value: 1500, unit: "ms", metricName: "http.server.duration" },
    { value: 0.0585, unit: "1", metricName: "system.cpu.utilization" },
    { value: 0.31, unit: "1", metricName: "browser.cls" },
    { value: 5000, unit: null, metricName: "http.server.request.count" },
    { value: 2500, unit: "GB", metricName: "system.filesystem.usage" },
  ];

  for (const testCase of cases) {
    test(`${testCase.metricName} @ ${testCase.unit ?? "no unit"} reads the same in both`, () => {
      const rendered: { cell: string; sentence: string } =
        bothRenderings(testCase);

      expect(rendered.cell.length).toBeGreaterThan(0);
      expect(rendered.sentence).toContain(`is ${rendered.cell} which is`);
      expect(rendered.sentence).toContain(`greater than ${rendered.cell}.`);
    });
  }
});
