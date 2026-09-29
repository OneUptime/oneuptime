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
 * Samples block (a table back then) or the "- Unit:" line, and both
 * rendered raw digits with the exporter's raw UCUM code glued on: a memory
 * breach that the dashboard drew as "1.07 GB" arrived in the inbox as
 * "1073741824 By", and a ratio metric's Value column read "0.06 1".
 *
 * These tests pin:
 *   - each sample's value at human scale, in the unit that sample landed
 *     on,
 *   - formula components each in their OWN unit, labelled by alias alone
 *     (auto-scaling means neighbouring samples disagree with any one
 *     configured unit),
 *   - the "- Unit:" line spelled out, and dropped when there is no unit,
 *   - the formula guard: a formula expression is not a metric name,
 *   - that the Breaching Samples list and the "Filter Conditions Met"
 *     sentence in the same email render the same sample identically.
 *
 * The list's own shape — its markdown, and how it parses and renders in
 * the email, Slack and plain text — is pinned in
 * MonitorCriteriaEvaluatorBreachingSamples.test.ts.
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

/*
 * The Breaching Samples list item of the sample taken at BREACH_TIME: its
 * first line ("1. `<timestamp>` — **<value>**"), the value on it, and the
 * detail bullets nested under it.
 */
const LIST_ITEM_LINE: RegExp = /^\d+\. /;
const DETAIL_LINE: RegExp = /^ {3,4}- /;

function sampleItemLines(context: string): Array<string> {
  const lines: Array<string> = context.split("\n");
  const index: number = lines.findIndex((line: string) => {
    return LIST_ITEM_LINE.test(line) && line.includes(BREACH_TIME_ISO);
  });

  expect(index).toBeGreaterThan(-1);

  const itemLines: Array<string> = [lines[index] as string];

  for (const line of lines.slice(index + 1)) {
    if (!DETAIL_LINE.test(line)) {
      break;
    }

    itemLines.push(line);
  }

  return itemLines;
}

function sampleItem(context: string): string {
  return sampleItemLines(context)[0] as string;
}

function sampleValue(context: string): string {
  const match: RegExpMatchArray | null =
    sampleItem(context).match(/ — \*\*(.*)\*\*$/);

  expect(match).not.toBeNull();
  return (match as RegExpMatchArray)[1] as string;
}

function sampleDetails(context: string): Array<string> {
  return sampleItemLines(context).slice(1);
}

describe("MonitorCriteriaEvaluator - Breaching Samples values", () => {
  test("renders bytes at human scale instead of raw digits", () => {
    const context: string = rootCause(makeContext({ unit: "By" }));

    expect(sampleItem(context)).toBe(`1. \`${BREACH_TIME_ISO}\` — **1.07 GB**`);
    expect(sampleDetails(context)).toEqual([]);
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

    expect(sampleValue(context)).toBe("1.5 sec");
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

    expect(sampleValue(context)).toBe("2.5 TB");
  });

  test("each sample names the unit IT landed on", () => {
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
     * 922 KB and 1.26 MB in the same list. This is exactly why the unit
     * rides each value instead of a heading — no single unit could
     * describe both samples.
     */
    expect(context).toContain("1. `2026-08-14T10:29:00.000Z` — **922 KB**");
    expect(context).toContain(`2. \`${BREACH_TIME_ISO}\` — **1.26 MB**`);
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

    expect(sampleValue(context)).toBe("5.85%");
    // The old rendering: a bare "0.06", which reads as 0.06%.
    expect(context).not.toContain("**0.06**");
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

    expect(sampleValue(context)).toBe("512");
    expect(context).not.toContain("{thread}");
  });

  /*
   * BACKWARD COMPATIBILITY. A metric with no unit must keep every digit —
   * a counter at 5000 is not "5K" in an alert, because the reader may be
   * scanning the list for the exact value that crossed the threshold.
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

    expect(sampleValue(context)).toBe("5000");
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

    expect(sampleValue(context)).toBe("2.33");
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

    expect(sampleValue(context)).toBe("Infinity");
    expect(context).not.toContain("InfinityP");
  });

  test("attributes are listed under the sample, unaffected by the unit", () => {
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

    expect(sampleItem(context)).toBe(`1. \`${BREACH_TIME_ISO}\` — **1.07 GB**`);
    expect(sampleDetails(context)).toEqual(["   - `k8s.pod.name`: `web-1`"]);
  });
});

describe("MonitorCriteriaEvaluator - Breaching Samples formula components", () => {
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

  test("each component is formatted in its own unit", () => {
    const context: string = rootCause(formulaContext());

    expect(sampleItemLines(context)).toEqual([
      `1. \`${BREACH_TIME_ISO}\` — **1.07 GB**`,
      "   - `a`: 537 MB",
      "   - `b`: 1.5 sec",
    ]);
  });

  /*
   * The table header used to read "a (By)". Now that each value says which
   * scale it landed on, a configured unit beside the alias is a claim two
   * samples can contradict — and the Components bullet list above the
   * samples still records the configured unit, so nothing is lost.
   */
  test("components are labelled by alias only, not the configured unit", () => {
    const context: string = rootCause(formulaContext());

    expect(context).not.toContain("a (By)");
    expect(context).not.toContain("`a (By)`");
  });

  test("the Components bullet list spells each component's unit out", () => {
    const context: string = rootCause(formulaContext());

    expect(context).toContain("- `a` = `container.memory.usage` — unit: Bytes");
    expect(context).toContain(
      "- `b` = `container.memory.cache` — unit: Milliseconds",
    );
  });

  test("a component with no value for this sample is left out, not printed as a dash", () => {
    const ctx: MetricCriteriaContext = formulaContext();
    ctx.breachingSamples![0]!.componentValues = [
      { alias: "a", value: 536870912 },
      { alias: "b", value: null },
    ];

    const context: string = rootCause(ctx);

    expect(sampleDetails(context)).toEqual(["   - `a`: 537 MB"]);
    expect(context).not.toContain("`b`:");
    expect(context).not.toContain(": -");
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

    expect(sampleValue(context)).toBe("0.42");
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

    expect(sampleDetails(context)).toEqual(["   - `x`: 0.42"]);
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

    expect(sampleValue(context)).toBe("42.00%");
  });
});

/*
 * ONE EMAIL, ONE ANSWER.
 *
 * The unit-suppression rule was hand-rolled three separate times before
 * this change — in CompareCriteria's "Filter Conditions Met" sentence, in
 * MonitorCriteriaObservationBuilder, and nowhere at all in the Breaching
 * Samples table (now a list) — with the result that a single evaluation
 * read differently in its own two halves: "0.31" in the sentence and
 * "0.31 1" in the table directly beneath it.
 *
 * Both sections of one email now go through MetricValueFormatter. These
 * tests assert the two strings are IDENTICAL rather than merely both
 * plausible, so a fourth copy of the rule cannot quietly appear.
 */
describe("MonitorCriteriaEvaluator - the Breaching Samples list and the sentence agree", () => {
  function bothRenderings(input: {
    value: number;
    unit: string | null;
    metricName: string;
  }): { sampleValue: string; sentence: string } {
    const ctx: MetricCriteriaContext = makeContext({
      metricName: input.metricName,
      unit: input.unit,
      breachingSamples: [
        { value: input.value, timestamp: BREACH_TIME, attributes: {} },
      ],
    });

    return {
      sampleValue: sampleValue(rootCause(ctx)),
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
      const rendered: { sampleValue: string; sentence: string } =
        bothRenderings(testCase);

      expect(rendered.sampleValue.length).toBeGreaterThan(0);
      expect(rendered.sentence).toBe(
        `${testCase.metricName} was ${rendered.sampleValue}. The condition requires the value to be above the ${rendered.sampleValue} threshold.`,
      );
    });
  }
});
