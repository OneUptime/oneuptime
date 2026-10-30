import { describe, expect, test } from "@jest/globals";
import {
  FacetHelp,
  FacetHelpEntry,
  buildFacetHelp,
  getFacetValueDescription,
} from "../../../../UI/Components/TelemetryViewer/FacetHelp";
import { FacetValue } from "../../../../UI/Components/TelemetryViewer/types";
import {
  TRACE_SPAN_TYPE_OPTIONS,
  TraceSpanTypeOption,
  getTraceSpanTypeDescriptions,
} from "../../../../Types/Telemetry/TraceSpanType";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../../Helpers/SeededRandom";

/*
 * What a facet's (i) explains (FacetHelp), worked out apart from React:
 * whether there is anything to explain at all - a facet with nothing gets
 * no (i) - and, for each described value, the name its row draws and the
 * order the facet lists it in.
 */

const SPAN_TYPE_VALUES: Array<FacetValue> = [
  { value: "entry", count: 40 },
  { value: "root", count: 0 },
  { value: "all", count: 1000 },
];

const SPAN_TYPE_NAMES: Record<string, string> = Object.fromEntries(
  TRACE_SPAN_TYPE_OPTIONS.map(
    (option: TraceSpanTypeOption): [string, string] => {
      return [option.value, option.label];
    },
  ),
);

const entriesOf: (
  help: FacetHelp | undefined,
) => Array<[string, string, string]> = (
  help: FacetHelp | undefined,
): Array<[string, string, string]> => {
  return (help?.entries || []).map(
    (entry: FacetHelpEntry): [string, string, string] => {
      return [entry.value, entry.label, entry.description];
    },
  );
};

describe("whether a facet has anything to explain", () => {
  test("nothing at all: no help, so no (i)", () => {
    expect(buildFacetHelp({ values: SPAN_TYPE_VALUES })).toBeUndefined();
    expect(
      buildFacetHelp({
        values: SPAN_TYPE_VALUES,
        valueDisplayMap: SPAN_TYPE_NAMES,
      }),
    ).toBeUndefined();
  });

  test.each([
    ["empty", ""],
    ["blank", "   "],
    ["a line break", "\n\t "],
  ])(
    "a description that is %s says nothing",
    (_name: string, blank: string) => {
      expect(
        buildFacetHelp({
          description: blank,
          valueDescriptionMap: { entry: blank, root: blank },
          values: SPAN_TYPE_VALUES,
        }),
      ).toBeUndefined();
    },
  );

  test("a facet's own sentence alone is help, trimmed", () => {
    expect(
      buildFacetHelp({
        description: "  Which spans the list shows.  ",
        values: SPAN_TYPE_VALUES,
      }),
    ).toEqual({ description: "Which spans the list shows.", entries: [] });
  });

  test("a value's sentence alone is help", () => {
    expect(
      buildFacetHelp({
        valueDescriptionMap: { root: "Where a trace starts." },
        values: SPAN_TYPE_VALUES,
        valueDisplayMap: SPAN_TYPE_NAMES,
      }),
    ).toEqual({
      description: undefined,
      entries: [
        {
          value: "root",
          label: "Root spans",
          description: "Where a trace starts.",
        },
      ],
    });
  });
});

describe("what the (i) lists", () => {
  test("the Span Type: each choice under the name its row draws, in the facet's order", () => {
    expect(
      entriesOf(
        buildFacetHelp({
          valueDescriptionMap: getTraceSpanTypeDescriptions(),
          values: SPAN_TYPE_VALUES,
          valueDisplayMap: SPAN_TYPE_NAMES,
        }),
      ),
    ).toEqual([
      ["entry", "Entry spans", "Where a request or message enters a service."],
      ["root", "Root spans", "Where a trace starts."],
      [
        "all",
        "All spans",
        "Every operation, including database calls and internal steps.",
      ],
    ]);
  });

  test("follows the facet's order, not the map's, whatever order the facet answers in", () => {
    const random: SeededRandom = seededRandom(4107);

    for (let round: number = 0; round < 20; round++) {
      const values: Array<FacetValue> = shuffled(SPAN_TYPE_VALUES, random);

      expect(
        entriesOf(
          buildFacetHelp({
            valueDescriptionMap: getTraceSpanTypeDescriptions(),
            values: values,
            valueDisplayMap: SPAN_TYPE_NAMES,
          }),
        ).map((entry: [string, string, string]): string => {
          return entry[0];
        }),
      ).toEqual(
        values.map((value: FacetValue): string => {
          return value.value;
        }),
      );
    }
  });

  test("names a value as its row does: the server's name, then the display map, then the value", () => {
    expect(
      entriesOf(
        buildFacetHelp({
          valueDescriptionMap: {
            a: "One.",
            b: "Two.",
            c: "Three.",
          },
          values: [
            { value: "a", count: 1, displayName: "Alpha (server)" },
            { value: "b", count: 1 },
            { value: "c", count: 1 },
          ],
          valueDisplayMap: { a: "Alpha (map)", b: "Beta (map)" },
        }),
      ),
    ).toEqual([
      ["a", "Alpha (server)", "One."],
      ["b", "Beta (map)", "Two."],
      ["c", "c", "Three."],
    ]);
  });

  test("an empty value is named '(empty)', as its row names it", () => {
    expect(
      entriesOf(
        buildFacetHelp({
          valueDescriptionMap: { "": "No value was recorded." },
          values: [{ value: "", count: 3 }],
        }),
      ),
    ).toEqual([["", "(empty)", "No value was recorded."]]);
  });

  test("a described value the facet has no row for yet still says what it is, after the others", () => {
    expect(
      entriesOf(
        buildFacetHelp({
          valueDescriptionMap: getTraceSpanTypeDescriptions(),
          // The counts are not in yet: only Root spans has a row.
          values: [{ value: "root", count: 3 }],
          valueDisplayMap: SPAN_TYPE_NAMES,
        }),
      ),
    ).toEqual([
      ["root", "Root spans", "Where a trace starts."],
      ["entry", "Entry spans", "Where a request or message enters a service."],
      [
        "all",
        "All spans",
        "Every operation, including database calls and internal steps.",
      ],
    ]);
  });

  test("no row at all: every described value, in the map's order", () => {
    expect(
      entriesOf(
        buildFacetHelp({
          valueDescriptionMap: getTraceSpanTypeDescriptions(),
          values: [],
          valueDisplayMap: SPAN_TYPE_NAMES,
        }),
      ).map((entry: [string, string, string]): string => {
        return entry[1];
      }),
    ).toEqual(["Entry spans", "Root spans", "All spans"]);
  });

  test("lists each value once, and leaves out the values with nothing to say", () => {
    expect(
      entriesOf(
        buildFacetHelp({
          valueDescriptionMap: { a: "One.", c: "  " },
          values: [
            { value: "a", count: 1 },
            { value: "a", count: 2 },
            { value: "b", count: 1 },
            { value: "c", count: 1 },
          ],
        }),
      ),
    ).toEqual([["a", "a", "One."]]);
  });

  test("the facet's own sentence comes with its values' sentences", () => {
    const help: FacetHelp | undefined = buildFacetHelp({
      description: "Which spans the list shows.",
      valueDescriptionMap: { root: "Where a trace starts." },
      values: SPAN_TYPE_VALUES,
      valueDisplayMap: SPAN_TYPE_NAMES,
    });

    expect(help?.description).toBe("Which spans the list shows.");
    expect(entriesOf(help)).toEqual([
      ["root", "Root spans", "Where a trace starts."],
    ]);
  });
});

describe("a value's own sentence", () => {
  test("is its map's sentence, trimmed", () => {
    expect(
      getFacetValueDescription(getTraceSpanTypeDescriptions(), "root"),
    ).toBe("Where a trace starts.");
    expect(getFacetValueDescription({ a: "  One.  " }, "a")).toBe("One.");
  });

  test("is nothing without a map, for a value the map leaves out, or a blank one", () => {
    expect(getFacetValueDescription(undefined, "root")).toBeUndefined();
    expect(
      getFacetValueDescription(getTraceSpanTypeDescriptions(), "other"),
    ).toBeUndefined();
    expect(getFacetValueDescription({ a: " " }, "a")).toBeUndefined();
  });

  test("never reads what every object inherits", () => {
    for (const name of ["constructor", "toString", "__proto__", "valueOf"]) {
      expect(getFacetValueDescription({}, name)).toBeUndefined();
      expect(
        buildFacetHelp({
          valueDescriptionMap: {},
          values: [{ value: name, count: 1 }],
        }),
      ).toBeUndefined();
    }
  });
});
