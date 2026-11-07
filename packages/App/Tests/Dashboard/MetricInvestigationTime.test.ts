import { describe, expect, test } from "@jest/globals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import MetricInvestigationTime, {
  CUSTOM_TIME_URL_VALUE,
  DEFAULT_RELATIVE_RANGE,
  MetricInvestigationCustomTime,
  MetricInvestigationTimeKind,
  MetricInvestigationTimePreset,
  MetricInvestigationTimeSelection,
  MetricInvestigationTimeUrlValue,
} from "../../FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationTime";

/*
 * The time model of a metric investigation (issue #5954): what a pick
 * shows, how the picker and the URL write it, and what a drag zooms it to.
 */

const MINUTE_MS: number = 60 * 1000;
const NOW: Date = new Date("2026-11-05T12:00:00.000Z");

function window(startIso: string, endIso: string): InBetween<Date> {
  return new InBetween<Date>(new Date(startIso), new Date(endIso));
}

const AROUND_START: MetricInvestigationTimePreset = {
  id: "around-start",
  label: "Around the start",
  window: window("2026-11-05T05:14:00.000Z", "2026-11-05T06:14:00.000Z"),
};

const EVALUATED: MetricInvestigationTimePreset = {
  id: "evaluated",
  label: "What the monitor saw",
  window: window("2026-11-05T05:39:00.000Z", "2026-11-05T05:44:00.000Z"),
};

// A preset whose window could not be worked out: never offered.
const BROKEN: MetricInvestigationTimePreset = {
  id: "broken",
  label: "Broken",
  window: window("2026-11-05T06:00:00.000Z", "2026-11-05T05:00:00.000Z"),
};

const PRESETS: Array<MetricInvestigationTimePreset> = [AROUND_START, EVALUATED];

const RELATIVE_RANGES: Array<TimeRange> = (
  Object.values(TimeRange) as Array<TimeRange>
).filter((range: TimeRange): boolean => {
  return range !== TimeRange.CUSTOM;
});

function preset(presetId: string): MetricInvestigationTimeSelection {
  return { kind: MetricInvestigationTimeKind.Preset, presetId: presetId };
}

function relative(range: TimeRange): MetricInvestigationTimeSelection {
  return { kind: MetricInvestigationTimeKind.Relative, range: range };
}

function custom(
  startIso: string,
  endIso: string,
): MetricInvestigationTimeSelection {
  return {
    kind: MetricInvestigationTimeKind.Custom,
    window: window(startIso, endIso),
  };
}

describe("isUsableWindow", () => {
  test("a window with its start before its end is usable", () => {
    expect(MetricInvestigationTime.isUsableWindow(AROUND_START.window)).toBe(
      true,
    );
  });

  test.each([
    ["no window", null],
    ["an undefined window", undefined],
    [
      "a window of no width",
      window("2026-11-05T05:00:00.000Z", "2026-11-05T05:00:00.000Z"),
    ],
    [
      "a window that ends before it starts",
      window("2026-11-05T06:00:00.000Z", "2026-11-05T05:00:00.000Z"),
    ],
    [
      "a window with an invalid date",
      new InBetween<Date>(new Date("nonsense"), new Date(NOW.getTime())),
    ],
    [
      "a window with blank bounds",
      new InBetween<Date>("" as unknown as Date, "" as unknown as Date),
    ],
  ])(
    "%s is not",
    (_name: string, value: InBetween<Date> | null | undefined) => {
      expect(MetricInvestigationTime.isUsableWindow(value)).toBe(false);
    },
  );

  test("bounds stored as ISO strings or epoch numbers are read as instants", () => {
    expect(
      MetricInvestigationTime.isUsableWindow(
        new InBetween<Date>(
          "2026-11-05T05:00:00.000Z" as unknown as Date,
          "2026-11-05T06:00:00.000Z" as unknown as Date,
        ),
      ),
    ).toBe(true);
    expect(
      MetricInvestigationTime.isUsableWindow(
        new InBetween<Date>(1000 as unknown as Date, 2000 as unknown as Date),
      ),
    ).toBe(true);
    expect(
      MetricInvestigationTime.isUsableWindow(
        new InBetween<Date>(
          Number.NaN as unknown as Date,
          2000 as unknown as Date,
        ),
      ),
    ).toBe(false);
  });
});

describe("toUsableWindow", () => {
  test("hands back the very same window when its bounds are Dates", () => {
    expect(MetricInvestigationTime.toUsableWindow(AROUND_START.window)).toBe(
      AROUND_START.window,
    );
  });

  test("turns stored string bounds into Dates", () => {
    const converted: InBetween<Date> | null =
      MetricInvestigationTime.toUsableWindow(
        new InBetween<Date>(
          "2026-11-05T05:00:00.000Z" as unknown as Date,
          "2026-11-05T06:00:00.000Z" as unknown as Date,
        ),
      );

    expect(converted?.startValue).toBeInstanceOf(Date);
    expect(converted?.endValue).toBeInstanceOf(Date);
    expect(converted?.startValue.toISOString()).toBe(
      "2026-11-05T05:00:00.000Z",
    );
    expect(converted?.endValue.toISOString()).toBe("2026-11-05T06:00:00.000Z");
  });

  test("is null for a window it cannot show", () => {
    expect(MetricInvestigationTime.toUsableWindow(BROKEN.window)).toBeNull();
    expect(MetricInvestigationTime.toUsableWindow(null)).toBeNull();
  });
});

describe("isSameWindow", () => {
  test("compares by the instants, not the objects", () => {
    expect(
      MetricInvestigationTime.isSameWindow(
        AROUND_START.window,
        window("2026-11-05T05:14:00.000Z", "2026-11-05T06:14:00.000Z"),
      ),
    ).toBe(true);
    expect(
      MetricInvestigationTime.isSameWindow(
        AROUND_START.window,
        new InBetween<Date>(
          "2026-11-05T05:14:00.000Z" as unknown as Date,
          "2026-11-05T06:14:00.000Z" as unknown as Date,
        ),
      ),
    ).toBe(true);
  });

  test("a window differing by one millisecond at either end is another", () => {
    expect(
      MetricInvestigationTime.isSameWindow(
        AROUND_START.window,
        window("2026-11-05T05:14:00.001Z", "2026-11-05T06:14:00.000Z"),
      ),
    ).toBe(false);
    expect(
      MetricInvestigationTime.isSameWindow(
        AROUND_START.window,
        window("2026-11-05T05:14:00.000Z", "2026-11-05T06:14:00.001Z"),
      ),
    ).toBe(false);
  });

  test("two missing windows are the same, one missing window is not", () => {
    expect(MetricInvestigationTime.isSameWindow(null, undefined)).toBe(true);
    expect(
      MetricInvestigationTime.isSameWindow(AROUND_START.window, null),
    ).toBe(false);
    expect(
      MetricInvestigationTime.isSameWindow(null, AROUND_START.window),
    ).toBe(false);
  });

  test("windows with unreadable bounds are never the same", () => {
    const unreadable: InBetween<Date> = new InBetween<Date>(
      new Date("nonsense"),
      new Date("nonsense"),
    );

    expect(MetricInvestigationTime.isSameWindow(unreadable, unreadable)).toBe(
      false,
    );
  });
});

describe("isRelativeRange", () => {
  test.each(RELATIVE_RANGES)("%s is a relative range", (range: TimeRange) => {
    expect(MetricInvestigationTime.isRelativeRange(range)).toBe(true);
  });

  test.each([
    ["Custom", TimeRange.CUSTOM],
    ["an unknown range", "Past 1 Decade"],
    ["an empty string", ""],
    ["a number", 5],
    ["undefined", undefined],
    ["null", null],
  ])("%s is not", (_name: string, value: unknown) => {
    expect(MetricInvestigationTime.isRelativeRange(value)).toBe(false);
  });
});

describe("findPreset", () => {
  test("finds a preset by its id, and nothing for an unknown id", () => {
    expect(MetricInvestigationTime.findPreset(PRESETS, "evaluated")).toBe(
      EVALUATED,
    );
    expect(MetricInvestigationTime.findPreset(PRESETS, "nope")).toBeNull();
    expect(MetricInvestigationTime.findPreset([], "evaluated")).toBeNull();
  });
});

describe("resolveRelativeWindow", () => {
  test.each(RELATIVE_RANGES)(
    "%s ends at the moment handed in, and is as long as the picker's own",
    (range: TimeRange) => {
      const resolved: InBetween<Date> | null =
        MetricInvestigationTime.resolveRelativeWindow(range, NOW);
      const pickers: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate({ range: range });

      expect(resolved).not.toBeNull();
      expect(resolved!.endValue.getTime()).toBe(NOW.getTime());
      expect(
        resolved!.endValue.getTime() - resolved!.startValue.getTime(),
      ).toBe(pickers.endValue.getTime() - pickers.startValue.getTime());
    },
  );

  test("the past hour is sixty minutes long", () => {
    const resolved: InBetween<Date> | null =
      MetricInvestigationTime.resolveRelativeWindow(
        TimeRange.PAST_ONE_HOUR,
        NOW,
      );

    expect(resolved?.startValue.toISOString()).toBe("2026-11-05T11:00:00.000Z");
    expect(resolved?.endValue.toISOString()).toBe("2026-11-05T12:00:00.000Z");
  });

  test("Custom, an unknown range or an unreadable now resolve to nothing", () => {
    expect(
      MetricInvestigationTime.resolveRelativeWindow(TimeRange.CUSTOM, NOW),
    ).toBeNull();
    expect(
      MetricInvestigationTime.resolveRelativeWindow(
        "Past 1 Decade" as TimeRange,
        NOW,
      ),
    ).toBeNull();
    expect(
      MetricInvestigationTime.resolveRelativeWindow(
        TimeRange.PAST_ONE_HOUR,
        new Date("nonsense"),
      ),
    ).toBeNull();
  });

  test("whatever the moment, the window ends exactly there (seeded)", () => {
    const random: SeededRandom = seededRandom(5954);

    for (let draw: number = 0; draw < 200; draw++) {
      const now: Date = new Date(
        Date.UTC(2020, 0, 1) + random(10 * 365 * 24 * 60) * MINUTE_MS,
      );
      const range: TimeRange = RELATIVE_RANGES[random(RELATIVE_RANGES.length)]!;
      const resolved: InBetween<Date> | null =
        MetricInvestigationTime.resolveRelativeWindow(range, now);

      expect(resolved?.endValue.getTime()).toBe(now.getTime());
      expect(MetricInvestigationTime.isUsableWindow(resolved)).toBe(true);
    }
  });
});

describe("isUsableSelection", () => {
  test.each([
    ["a preset the page offers", preset("around-start"), true],
    ["a preset the page does not offer", preset("nope"), false],
    ["a preset whose window is broken", preset("broken"), false],
    ["a relative range", relative(TimeRange.PAST_ONE_DAY), true],
    ["Custom as a relative range", relative(TimeRange.CUSTOM), false],
    [
      "a custom window",
      custom("2026-11-05T01:00:00.000Z", "2026-11-05T02:00:00.000Z"),
      true,
    ],
    [
      "a custom window that ends before it starts",
      custom("2026-11-05T02:00:00.000Z", "2026-11-05T01:00:00.000Z"),
      false,
    ],
    ["no pick", null, false],
  ])(
    "%s: %s",
    (
      _name: string,
      selection: MetricInvestigationTimeSelection | null,
      expected: boolean,
    ) => {
      expect(
        MetricInvestigationTime.isUsableSelection(selection, [
          ...PRESETS,
          BROKEN,
        ]),
      ).toBe(expected);
    },
  );

  test("a pick of an unknown kind is not usable", () => {
    expect(
      MetricInvestigationTime.isUsableSelection(
        { kind: "later" } as unknown as MetricInvestigationTimeSelection,
        PRESETS,
      ),
    ).toBe(false);
  });
});

describe("getDefaultSelection", () => {
  test("the page's preferred pick, when it can be shown", () => {
    expect(
      MetricInvestigationTime.getDefaultSelection({
        presets: PRESETS,
        preferred: preset("evaluated"),
      }),
    ).toEqual(preset("evaluated"));
    expect(
      MetricInvestigationTime.getDefaultSelection({
        presets: PRESETS,
        preferred: relative(TimeRange.PAST_ONE_DAY),
      }),
    ).toEqual(relative(TimeRange.PAST_ONE_DAY));
  });

  test("the first preset that can be shown, when the preferred one cannot", () => {
    expect(
      MetricInvestigationTime.getDefaultSelection({
        presets: [BROKEN, EVALUATED, AROUND_START],
        preferred: preset("nope"),
      }),
    ).toEqual(preset("evaluated"));
  });

  test("the past hour when the page offers no preset it can show", () => {
    expect(
      MetricInvestigationTime.getDefaultSelection({ presets: [] }),
    ).toEqual(relative(DEFAULT_RELATIVE_RANGE));
    expect(
      MetricInvestigationTime.getDefaultSelection({ presets: [BROKEN] }),
    ).toEqual(relative(TimeRange.PAST_ONE_HOUR));
  });
});

describe("resolveWindow", () => {
  test("a preset shows the window the page worked out", () => {
    expect(
      MetricInvestigationTime.resolveWindow({
        selection: preset("around-start"),
        presets: PRESETS,
        now: NOW,
      }),
    ).toBe(AROUND_START.window);
  });

  test("a preset the page no longer offers shows nothing", () => {
    expect(
      MetricInvestigationTime.resolveWindow({
        selection: preset("evaluated"),
        presets: [AROUND_START],
        now: NOW,
      }),
    ).toBeNull();
  });

  test("a relative range ends at now", () => {
    const resolved: InBetween<Date> | null =
      MetricInvestigationTime.resolveWindow({
        selection: relative(TimeRange.PAST_FIFTEEN_MINS),
        presets: PRESETS,
        now: NOW,
      });

    expect(resolved?.startValue.toISOString()).toBe("2026-11-05T11:45:00.000Z");
    expect(resolved?.endValue.toISOString()).toBe("2026-11-05T12:00:00.000Z");
  });

  test("a custom window is its own, whatever now is", () => {
    const resolved: InBetween<Date> | null =
      MetricInvestigationTime.resolveWindow({
        selection: custom(
          "2026-10-01T00:00:00.000Z",
          "2026-10-02T00:00:00.000Z",
        ),
        presets: PRESETS,
        now: NOW,
      });

    expect(resolved?.startValue.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(resolved?.endValue.toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });
});

describe("isSameSelection", () => {
  const picks: Array<MetricInvestigationTimeSelection> = [
    preset("around-start"),
    preset("evaluated"),
    relative(TimeRange.PAST_ONE_HOUR),
    relative(TimeRange.PAST_ONE_DAY),
    custom("2026-11-05T01:00:00.000Z", "2026-11-05T02:00:00.000Z"),
    custom("2026-11-05T01:00:00.000Z", "2026-11-05T03:00:00.000Z"),
  ];

  test("every pick is the same as an equal copy of itself, and no other", () => {
    for (let first: number = 0; first < picks.length; first++) {
      for (let second: number = 0; second < picks.length; second++) {
        const copy: MetricInvestigationTimeSelection = JSON.parse(
          JSON.stringify(picks[second]),
        ) as MetricInvestigationTimeSelection;

        if (copy.kind === MetricInvestigationTimeKind.Custom) {
          copy.window = new InBetween<Date>(
            new Date(copy.window.startValue),
            new Date(copy.window.endValue),
          );
        }

        expect(
          MetricInvestigationTime.isSameSelection(picks[first], copy),
        ).toBe(first === second);
      }
    }
  });

  test("two missing picks are the same, one missing pick is not", () => {
    expect(MetricInvestigationTime.isSameSelection(null, undefined)).toBe(true);
    expect(MetricInvestigationTime.isSameSelection(picks[0], null)).toBe(false);
    expect(MetricInvestigationTime.isSameSelection(undefined, picks[0])).toBe(
      false,
    );
  });
});

describe("the picker's value", () => {
  test("a relative range keeps its preset, so the picker marks it", () => {
    const value: RangeStartAndEndDateTime =
      MetricInvestigationTime.toPickerValue(
        relative(TimeRange.PAST_ONE_DAY),
        AROUND_START.window,
      );

    expect(value.range).toBe(TimeRange.PAST_ONE_DAY);
    expect(value.startAndEndDate).toBe(AROUND_START.window);
  });

  test("a preset and a custom window are custom windows to the picker", () => {
    expect(
      MetricInvestigationTime.toPickerValue(
        preset("around-start"),
        AROUND_START.window,
      ),
    ).toEqual({
      range: TimeRange.CUSTOM,
      startAndEndDate: AROUND_START.window,
    });
    expect(
      MetricInvestigationTime.toPickerValue(
        custom("2026-11-05T01:00:00.000Z", "2026-11-05T02:00:00.000Z"),
        EVALUATED.window,
      ).range,
    ).toBe(TimeRange.CUSTOM);
  });

  test("a pick from the picker's own list is a relative range or a custom window", () => {
    expect(
      MetricInvestigationTime.fromPickerValue({
        range: TimeRange.PAST_THREE_HOURS,
      }),
    ).toEqual(relative(TimeRange.PAST_THREE_HOURS));

    const picked: MetricInvestigationTimeSelection | null =
      MetricInvestigationTime.fromPickerValue({
        range: TimeRange.CUSTOM,
        startAndEndDate: EVALUATED.window,
      });

    expect(picked?.kind).toBe(MetricInvestigationTimeKind.Custom);
    expect(
      MetricInvestigationTime.isSameSelection(
        picked,
        custom("2026-11-05T05:39:00.000Z", "2026-11-05T05:44:00.000Z"),
      ),
    ).toBe(true);
  });

  test("nothing usable from the picker is no pick", () => {
    expect(MetricInvestigationTime.fromPickerValue(null)).toBeNull();
    expect(
      MetricInvestigationTime.fromPickerValue({ range: TimeRange.CUSTOM }),
    ).toBeNull();
    expect(
      MetricInvestigationTime.fromPickerValue({
        range: TimeRange.CUSTOM,
        startAndEndDate: BROKEN.window,
      }),
    ).toBeNull();
    expect(
      MetricInvestigationTime.fromPickerValue({
        range: "Past 1 Decade" as TimeRange,
      }),
    ).toBeNull();
  });
});

describe("getZoomSelection", () => {
  const current: InBetween<Date> = window(
    "2026-11-05T05:00:00.000Z",
    "2026-11-05T06:00:00.000Z",
  );

  test("zooms to the window dragged out, whichever way it was dragged", () => {
    const forwards: MetricInvestigationCustomTime | null =
      MetricInvestigationTime.getZoomSelection({
        startTime: new Date("2026-11-05T05:10:00.000Z"),
        endTime: new Date("2026-11-05T05:20:00.000Z"),
        currentWindow: current,
      });
    const backwards: MetricInvestigationCustomTime | null =
      MetricInvestigationTime.getZoomSelection({
        startTime: new Date("2026-11-05T05:20:00.000Z"),
        endTime: new Date("2026-11-05T05:10:00.000Z"),
        currentWindow: current,
      });

    expect(forwards?.window.startValue.toISOString()).toBe(
      "2026-11-05T05:10:00.000Z",
    );
    expect(forwards?.window.endValue.toISOString()).toBe(
      "2026-11-05T05:20:00.000Z",
    );
    expect(MetricInvestigationTime.isSameSelection(forwards, backwards)).toBe(
      true,
    );
  });

  test("never past the end of the window on screen", () => {
    const zoomed: MetricInvestigationCustomTime | null =
      MetricInvestigationTime.getZoomSelection({
        startTime: new Date("2026-11-05T05:50:00.000Z"),
        endTime: new Date("2026-11-05T06:10:00.000Z"),
        currentWindow: current,
      });

    expect(zoomed?.window.endValue.toISOString()).toBe(
      "2026-11-05T06:00:00.000Z",
    );
  });

  test("a drag that never left its spot, or unreadable edges, zoom nowhere", () => {
    expect(
      MetricInvestigationTime.getZoomSelection({
        startTime: new Date("2026-11-05T05:10:00.000Z"),
        endTime: new Date("2026-11-05T05:10:00.000Z"),
        currentWindow: current,
      }),
    ).toBeNull();
    expect(
      MetricInvestigationTime.getZoomSelection({
        startTime: new Date("nonsense"),
        endTime: new Date("2026-11-05T05:10:00.000Z"),
        currentWindow: current,
      }),
    ).toBeNull();
  });
});

describe("the URL", () => {
  test("a preset is written by its id, a relative range by its name", () => {
    expect(MetricInvestigationTime.toUrlValue(preset("around-start"))).toEqual({
      time: "around-start",
    });
    expect(
      MetricInvestigationTime.toUrlValue(relative(TimeRange.PAST_ONE_WEEK)),
    ).toEqual({ time: "Past 1 Week" });
  });

  test("a custom window is written with both of its instants", () => {
    expect(
      MetricInvestigationTime.toUrlValue(
        custom("2026-11-05T01:00:00.000Z", "2026-11-05T02:30:00.000Z"),
      ),
    ).toEqual({
      time: CUSTOM_TIME_URL_VALUE,
      start: "2026-11-05T01:00:00.000Z",
      end: "2026-11-05T02:30:00.000Z",
    });
  });

  test.each([
    ["a preset", preset("evaluated")],
    ["a relative range", relative(TimeRange.PAST_TWO_DAYS)],
    [
      "a custom window",
      custom("2026-01-31T23:59:59.000Z", "2026-02-01T00:00:01.000Z"),
    ],
  ])(
    "%s reads back as the same pick",
    (_name: string, selection: MetricInvestigationTimeSelection) => {
      const written: MetricInvestigationTimeUrlValue =
        MetricInvestigationTime.toUrlValue(selection);

      expect(
        MetricInvestigationTime.isSameSelection(
          MetricInvestigationTime.fromUrlValue({
            ...written,
            presets: PRESETS,
          }),
          selection,
        ),
      ).toBe(true);
    },
  );

  test("any custom window reads back as itself (seeded)", () => {
    const random: SeededRandom = seededRandom(20261105);

    for (let draw: number = 0; draw < 300; draw++) {
      const startMs: number = Date.UTC(2015, 0, 1) + random(2 ** 31) * 1000;
      const endMs: number = startMs + 1 + random(90 * 24 * 60 * 60) * 1000;
      const selection: MetricInvestigationTimeSelection = {
        kind: MetricInvestigationTimeKind.Custom,
        window: new InBetween<Date>(new Date(startMs), new Date(endMs)),
      };

      expect(
        MetricInvestigationTime.isSameSelection(
          MetricInvestigationTime.fromUrlValue({
            ...MetricInvestigationTime.toUrlValue(selection),
            presets: [],
          }),
          selection,
        ),
      ).toBe(true);
    }
  });

  test.each([
    ["nothing", { time: null }],
    ["a blank pick", { time: "   " }],
    ["a preset this page does not offer", { time: "start-to-end" }],
    ["a preset whose window is broken", { time: "broken" }],
    ["something that is neither", { time: "yesterday" }],
    [
      "a custom window without its start",
      { time: "custom", end: "2026-11-05T02:00:00.000Z" },
    ],
    [
      "a custom window without its end",
      { time: "custom", start: "2026-11-05T02:00:00.000Z" },
    ],
    [
      "a custom window with an unreadable start",
      { time: "custom", start: "soon", end: "2026-11-05T02:00:00.000Z" },
    ],
    [
      "a custom window that ends before it starts",
      {
        time: "custom",
        start: "2026-11-05T02:00:00.000Z",
        end: "2026-11-05T01:00:00.000Z",
      },
    ],
    [
      "a custom window of no width",
      {
        time: "custom",
        start: "2026-11-05T02:00:00.000Z",
        end: "2026-11-05T02:00:00.000Z",
      },
    ],
  ])(
    "%s is no pick",
    (
      _name: string,
      value: {
        time: string | null;
        start?: string | undefined;
        end?: string | undefined;
      },
    ) => {
      expect(
        MetricInvestigationTime.fromUrlValue({
          ...value,
          presets: [...PRESETS, BROKEN],
        }),
      ).toBeNull();
    },
  );

  test("the pick is read with the blanks around it trimmed", () => {
    expect(
      MetricInvestigationTime.fromUrlValue({
        time: "  around-start ",
        presets: PRESETS,
      }),
    ).toEqual(preset("around-start"));
  });

  test("a preset is matched before a relative range of the same name", () => {
    const namedLikeARange: MetricInvestigationTimePreset = {
      ...AROUND_START,
      id: TimeRange.PAST_ONE_HOUR,
    };

    expect(
      MetricInvestigationTime.fromUrlValue({
        time: TimeRange.PAST_ONE_HOUR,
        presets: [namedLikeARange],
      }),
    ).toEqual(preset(TimeRange.PAST_ONE_HOUR));
  });
});
