import MetricFormulaEvaluator, {
  MetricFormulaEvaluationInput,
} from "../../../Utils/Metrics/MetricFormulaEvaluator";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import SlicedWork, { SlicedWorkSteps } from "../../../Utils/SlicedWork";
import { INHERITED_PROPERTY_NAMES } from "../../Helpers/InheritedNames";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * A GROUPED FORMULA, A STEP AT A TIME (issue #10108).
 *
 * A grouped monitor's formula over 16,000 series is 160,000 rows, evaluated
 * at every evaluation. MetricFormulaEvaluator now:
 *
 *   - evaluates it in steps (evaluateFormulaInSteps), pausing every 1,024
 *     rows it buckets and between two groups, so a server caller can hand
 *     the event loop back there; evaluateFormula runs the same steps
 *     through;
 *   - buckets a row by a group key read from its values of the keys
 *     (getGroupKeyReader), written once a group, where every row was read
 *     into a label set, sorted and joined (computeGroupKey of
 *     extractGroupLabels);
 *   - parses a formula once per text (toRpn), and writes a time's ISO text
 *     once (normalizeTimestamp).
 *
 * Each must give exactly what was given before: the group key a row's
 * series is joined by, the points a formula writes. These tests compare with
 * the functions it replaces, still in the evaluator, and with the formula's
 * arithmetic done by hand.
 */

interface EvaluatorInternals {
  getGroupKeyReader: (
    groupByAttributeKeys: Array<string>,
  ) => ((sample: AggregatedModel) => string) | null;
  extractGroupLabels: (input: {
    sample: AggregatedModel;
    groupByAttributeKeys: Array<string>;
  }) => JSONObject;
  computeGroupKey: (labels: JSONObject) => string;
  normalizeTimestamp: (timestamp: Date | string) => string;
  parseToRpn: (expression: string) => Array<unknown>;
}

const internals: EvaluatorInternals =
  MetricFormulaEvaluator as unknown as EvaluatorInternals;

const KEYS: Array<string> = ["resource.host.name", "resource.container.name"];
const WINDOW_START_MS: number = Date.UTC(2026, 10, 17, 10, 0, 0);
const MINUTE_MS: number = 60 * 1000;

function groupedQuery(variable: string): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: "",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: `metric_${variable}`,
        aggegationType: MetricsAggregationType.Max,
      },
      groupByAttributeKeys: KEYS,
    },
  };
}

function hostOf(series: number): string {
  return `docker-host-${String(series % 97).padStart(4, "0")}`;
}

function containerOf(series: number): string {
  return `container-${series}`;
}

// A value per series and minute that both sides can compute.
function valueOf(variable: string, series: number, minute: number): number {
  return variable === "a"
    ? (series * 7 + minute * 3) % 101
    : (series * 5 + minute * 11) % 37;
}

/*
 * A grouped read: a row per series and minute, minutes newest first (as
 * ClickHouse orders them), series in an order that is not their number's.
 */
function groupedResult(input: {
  variable: string;
  series: number;
  minutes: number;
}): AggregatedResult {
  const data: Array<AggregatedModel> = [];

  for (let minute: number = input.minutes - 1; minute >= 0; minute--) {
    for (let index: number = 0; index < input.series; index++) {
      const series: number = (index * 31) % input.series;

      data.push({
        timestamp: new Date(WINDOW_START_MS + minute * MINUTE_MS),
        value: valueOf(input.variable, series, minute),
        attributes: {
          "resource.host.name": hostOf(series),
          "resource.container.name": containerOf(series),
        },
      } as unknown as AggregatedModel);
    }
  }

  return { data: data };
}

function formulaInput(input: {
  formula: string;
  series: number;
  minutes: number;
}): MetricFormulaEvaluationInput {
  return {
    formula: input.formula,
    queryConfigs: [groupedQuery("a"), groupedQuery("b")],
    formulaConfigs: [],
    results: [
      groupedResult({
        variable: "a",
        series: input.series,
        minutes: input.minutes,
      }),
      groupedResult({
        variable: "b",
        series: input.series,
        minutes: input.minutes,
      }),
    ],
  };
}

// The points a formula writes, by series and minute.
function pointsOf(result: AggregatedResult): Map<string, number> {
  const points: Map<string, number> = new Map<string, number>();

  for (const row of result.data) {
    const attributes: JSONObject = ((row as unknown as JSONObject)[
      "attributes"
    ] || {}) as JSONObject;

    points.set(
      `${String(attributes["resource.container.name"])}@${new Date(
        row.timestamp,
      ).toISOString()}`,
      row.value,
    );
  }

  return points;
}

// The points of "a * 2 + b", by hand.
function expectedPoints(input: {
  series: number;
  minutes: number;
}): Map<string, number> {
  const points: Map<string, number> = new Map<string, number>();

  for (let series: number = 0; series < input.series; series++) {
    for (let minute: number = 0; minute < input.minutes; minute++) {
      points.set(
        `${containerOf(series)}@${new Date(
          WINDOW_START_MS + minute * MINUTE_MS,
        ).toISOString()}`,
        valueOf("a", series, minute) * 2 + valueOf("b", series, minute),
      );
    }
  }

  return points;
}

function countPauses<T>(work: SlicedWorkSteps<T>): {
  pauses: number;
  value: T;
} {
  let pauses: number = 0;
  let step: IteratorResult<void, T> = work.next();

  while (!step.done) {
    pauses++;
    step = work.next();
  }

  return { pauses: pauses, value: step.value };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MetricFormulaEvaluator's group key reader", () => {
  function expectAsBefore(input: {
    keys: Array<string>;
    sample: AggregatedModel;
    read: (sample: AggregatedModel) => string;
  }): void {
    expect(input.read(input.sample)).toBe(
      internals.computeGroupKey(
        internals.extractGroupLabels({
          sample: input.sample,
          groupByAttributeKeys: input.keys,
        }),
      ),
    );
  }

  function sampleWith(attributes: JSONObject | undefined): AggregatedModel {
    return {
      timestamp: new Date(WINDOW_START_MS),
      value: 1,
      ...(attributes === undefined ? {} : { attributes: attributes }),
    } as unknown as AggregatedModel;
  }

  test("is none for a query without group keys, whose rows keep what attributes they carry", () => {
    expect(internals.getGroupKeyReader([])).toBeNull();
  });

  test("5,000 random rows get the key computeGroupKey(extractGroupLabels(row)) gave", () => {
    const random: SeededRandom = seededRandom(10108);
    const values: Array<JSONValue | undefined> = [
      undefined,
      null,
      "",
      "a",
      "b|c",
      "d=e",
      "|",
      7,
      0,
      true,
      ["x", "y"],
      { nested: 1 },
      "😀 хост",
    ];

    for (const keys of [
      KEYS,
      [...KEYS].reverse(),
      [KEYS[0]!, KEYS[1]!, KEYS[0]!],
      ["only"],
      ["a", "b", "c", "d"],
    ]) {
      const read: ((sample: AggregatedModel) => string) | null =
        internals.getGroupKeyReader(keys);

      for (let index: number = 0; index < 1_000; index++) {
        const attributes: JSONObject = {};

        for (const key of keys) {
          const value: JSONValue | undefined = values[random(values.length)];

          if (value !== undefined) {
            attributes[key] = value;
          }
        }

        expectAsBefore({
          keys: keys,
          sample: sampleWith(random(20) === 0 ? undefined : attributes),
          read: read!,
        });
      }
    }
  });

  test("keys named as what every object inherits read the row's own attributes only, as before", () => {
    const keys: Array<string> = [...INHERITED_PROPERTY_NAMES];
    const read: ((sample: AggregatedModel) => string) | null =
      internals.getGroupKeyReader(keys);

    const own: JSONObject = {};
    for (const key of keys) {
      Object.defineProperty(own, key, {
        value: `own-${key}`,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }

    expectAsBefore({ keys: keys, sample: sampleWith(own), read: read! });
    expectAsBefore({ keys: keys, sample: sampleWith({}), read: read! });
  });

  test("a group's key is read back for its later rows, whatever objects they are", () => {
    const read: ((sample: AggregatedModel) => string) | null =
      internals.getGroupKeyReader(KEYS);

    const first: string = read!(
      sampleWith({
        "resource.host.name": "docker-host-0001",
        "resource.container.name": "nginx",
      }),
    );

    for (let index: number = 0; index < 100; index++) {
      expect(
        read!(
          sampleWith({
            "resource.container.name": "nginx",
            "resource.host.name": "docker-host-0001",
            other: index,
          } as unknown as JSONObject),
        ),
      ).toBe(first);
    }

    expect(first).toBe(
      "resource.container.name=nginx|resource.host.name=docker-host-0001",
    );
  });
});

describe("MetricFormulaEvaluator.evaluateFormulaInSteps", () => {
  test("pauses every 1,024 rows it buckets and between two groups, and gives what evaluateFormula gives", () => {
    const input: MetricFormulaEvaluationInput = formulaInput({
      formula: "a * 2 + b",
      series: 600,
      minutes: 10,
    });

    const stepped: { pauses: number; value: AggregatedResult } = countPauses(
      MetricFormulaEvaluator.evaluateFormulaInSteps(input),
    );

    // 6,000 rows a variable, then a pause per group.
    expect(stepped.pauses).toBeGreaterThanOrEqual(
      2 * Math.floor(6_000 / 1_024) + 600,
    );
    expect(stepped.value).toEqual(
      MetricFormulaEvaluator.evaluateFormula(input),
    );
    expect(pointsOf(stepped.value)).toEqual(
      expectedPoints({ series: 600, minutes: 10 }),
    );
  });

  test("two evaluations stepped in turn give what each gives alone", () => {
    const first: MetricFormulaEvaluationInput = formulaInput({
      formula: "a * 2 + b",
      series: 300,
      minutes: 10,
    });
    const second: MetricFormulaEvaluationInput = formulaInput({
      formula: "a * 2 + b",
      series: 450,
      minutes: 5,
    });

    const firstSteps: SlicedWorkSteps<AggregatedResult> =
      MetricFormulaEvaluator.evaluateFormulaInSteps(first);
    const secondSteps: SlicedWorkSteps<AggregatedResult> =
      MetricFormulaEvaluator.evaluateFormulaInSteps(second);

    let firstStep: IteratorResult<void, AggregatedResult> = firstSteps.next();
    let secondStep: IteratorResult<void, AggregatedResult> = secondSteps.next();

    while (!firstStep.done || !secondStep.done) {
      if (!firstStep.done) {
        firstStep = firstSteps.next();
      }

      if (!secondStep.done) {
        secondStep = secondSteps.next();
      }
    }

    expect(pointsOf(firstStep.value)).toEqual(
      expectedPoints({ series: 300, minutes: 10 }),
    );
    expect(pointsOf(secondStep.value)).toEqual(
      expectedPoints({ series: 450, minutes: 5 }),
    );
  });

  test("throws what evaluateFormula throws, before its first pause", () => {
    const input: MetricFormulaEvaluationInput = formulaInput({
      formula: "a + unknownVariable",
      series: 10,
      minutes: 2,
    });

    expect(() => {
      MetricFormulaEvaluator.evaluateFormulaInSteps(input).next();
    }).toThrow(BadDataException);
    expect(() => {
      MetricFormulaEvaluator.evaluateFormula(input);
    }).toThrow(BadDataException);
  });

  test("an empty formula is no points, at once", () => {
    const stepped: { pauses: number; value: AggregatedResult } = countPauses(
      MetricFormulaEvaluator.evaluateFormulaInSteps(
        formulaInput({ formula: "   ", series: 10, minutes: 2 }),
      ),
    );

    expect(stepped).toEqual({ pauses: 0, value: { data: [] } });
  });
});

describe("MetricFormulaEvaluator's parsed formulas", () => {
  test("a formula is parsed once, and evaluates every input it is given", () => {
    const parseToRpn: SpyInstance<EvaluatorInternals["parseToRpn"]> =
      jest.spyOn(internals, "parseToRpn");
    // A text no other test parses.
    const formula: string = "a * 2 + b + 0 * 1234.5";

    for (const series of [5, 50, 120]) {
      const result: AggregatedResult = MetricFormulaEvaluator.evaluateFormula(
        formulaInput({ formula: formula, series: series, minutes: 3 }),
      );

      expect(pointsOf(result)).toEqual(
        expectedPoints({ series: series, minutes: 3 }),
      );
    }

    expect(
      parseToRpn.mock.calls.filter((call: Array<unknown>): boolean => {
        return call[0] === formula;
      }),
    ).toHaveLength(1);
  });

  test("a formula that does not parse is refused every time it is given", () => {
    const parseToRpn: SpyInstance<EvaluatorInternals["parseToRpn"]> =
      jest.spyOn(internals, "parseToRpn");

    for (let attempt: number = 0; attempt < 3; attempt++) {
      expect(() => {
        MetricFormulaEvaluator.evaluateFormula(
          formulaInput({ formula: "a * (b +", series: 2, minutes: 1 }),
        );
      }).toThrow(BadDataException);
    }

    expect(parseToRpn).toHaveBeenCalledTimes(3);
  });

  test("past the 512 formulas kept, each still evaluates as written", () => {
    for (let index: number = 0; index < 600; index++) {
      const result: AggregatedResult = MetricFormulaEvaluator.evaluateFormula(
        formulaInput({
          formula: `a * 2 + b + 0 * ${index}`,
          series: 2,
          minutes: 1,
        }),
      );

      expect(pointsOf(result)).toEqual(
        expectedPoints({ series: 2, minutes: 1 }),
      );
    }

    // The first of them, long since let go, parses again.
    const result: AggregatedResult = MetricFormulaEvaluator.evaluateFormula(
      formulaInput({ formula: "a * 2 + b + 0 * 0", series: 4, minutes: 2 }),
    );
    expect(pointsOf(result)).toEqual(expectedPoints({ series: 4, minutes: 2 }));
  });
});

describe("MetricFormulaEvaluator's times", () => {
  test("a time's text is toISOString's, for 10,000 times, past the 4,096 kept", () => {
    for (let index: number = 0; index < 10_000; index++) {
      const time: Date = new Date(WINDOW_START_MS + index * 1_000 + index);

      expect(internals.normalizeTimestamp(time)).toBe(time.toISOString());
      // Read again: the text kept.
      expect(internals.normalizeTimestamp(new Date(time.getTime()))).toBe(
        time.toISOString(),
      );
    }
  });

  test("an invalid date throws as toISOString does, every time, and keeps nothing", () => {
    for (let attempt: number = 0; attempt < 2; attempt++) {
      expect(() => {
        internals.normalizeTimestamp(new Date("not a date"));
      }).toThrow(RangeError);
    }

    const time: Date = new Date(WINDOW_START_MS);
    expect(internals.normalizeTimestamp(time)).toBe(time.toISOString());
  });

  test("a time given as text is read as before", () => {
    expect(internals.normalizeTimestamp("2026-11-17T10:00:00")).toBe(
      new Date("2026-11-17T10:00:00").toISOString(),
    );
    expect(internals.normalizeTimestamp("2026-11-17T10:00:00.000Z")).toBe(
      "2026-11-17T10:00:00.000Z",
    );
    expect(internals.normalizeTimestamp("not a time")).toBe("not a time");
  });
});

describe("SlicedWork.runToEnd", () => {
  test("is the formula's result, never pausing", () => {
    const input: MetricFormulaEvaluationInput = formulaInput({
      formula: "a * 2 + b",
      series: 30,
      minutes: 4,
    });

    expect(
      pointsOf(
        SlicedWork.runToEnd(
          MetricFormulaEvaluator.evaluateFormulaInSteps(input),
        ),
      ),
    ).toEqual(expectedPoints({ series: 30, minutes: 4 }));
  });
});
