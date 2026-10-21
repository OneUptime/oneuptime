import {
  Green,
  Green500,
  Orange700,
  Red,
  Red900,
  Yellow300,
} from "../../../Types/BrandColors";
import Color, { RGB } from "../../../Types/Color";
import { getContrastRatio, parseColor } from "../../../Utils/ColorContrast";
import {
  COLOR_BLIND_DISTINCT_COLOR_DIFFERENCE,
  ColorVision,
  DISTINCT_COLOR_DIFFERENCE,
  RED_GREEN_COLOR_VISIONS,
  getColorDifference,
  looksAlikeWithRedGreenColorBlindness,
} from "../../../Utils/ColorVision";
import {
  ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY,
  HistoryChartBarColorRuleInput,
  HistoryChartBarColorRuleValues,
  RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
  getBarColorForUptimePercent,
  getMatchingRuleIndex,
  getRuleBarColor,
  getRuleUptimePercent,
  getUptimePercentBelowWhichNoRuleMatches,
  isRecommendedHistoryChartBarColorRuleSet,
  isRuleShadowed,
} from "../../../Utils/StatusPage/HistoryChartBarColors";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The colours of a status page's uptime history (issue #486).
 *
 * Without rules a day takes the colour of its most severe status, so two
 * minutes offline turned a whole day red. The recommended rules grade a day
 * by how long it was down instead, in colours that people with red-green
 * colour blindness can tell apart, and every status page made in the
 * dashboard starts with them. These tests hold the rules to both promises,
 * and pin the matching the status page draws its bars with.
 */

const SECONDS_IN_A_DAY: number = 24 * 60 * 60;

// The uptime of a full day with this many minutes of downtime.
function uptimeOfADayWithDowntime(minutes: number): number {
  const downtime: number = minutes * 60;

  return ((SECONDS_IN_A_DAY - downtime) / SECONDS_IN_A_DAY) * 100;
}

function hex(color: Color | null): string | null {
  return color ? color.toString().toLowerCase() : null;
}

function rgb(color: Color | string): RGB {
  return parseColor(color)!;
}

const NO_DATA_GREY: string = "#9ca3af";

const RECOMMENDED_COLORS: Array<string> =
  RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES.map(
    (rule: HistoryChartBarColorRuleValues): string => {
      return rule.barColor.toString().toLowerCase();
    },
  );

describe("HistoryChartBarColors stands on its own", () => {
  test("imports nothing from React, the UI or the server", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../Utils/StatusPage/HistoryChartBarColors.ts",
      ),
      "utf8",
    );
    const imports: Array<string> = Array.from(
      source.matchAll(/from\s+"([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(imports).toEqual([
      "../../Types/BrandColors",
      "../../Types/Color",
      "../ColorContrast",
    ]);
  });

  /*
   * Part of the API: a script that creates a status page sends it to start
   * with these rules, and the docs say so.
   */
  test("the create flag is addRecommendedBarColorRules", () => {
    expect(ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY).toBe(
      "addRecommendedBarColorRules",
    );
  });
});

describe("the recommended rules grade a day by how long it was down", () => {
  test("are 100%, 99%, 95% and 0%, in that order", () => {
    expect(
      RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES.map(
        (rule: HistoryChartBarColorRuleValues): number => {
          return rule.uptimePercentGreaterThanOrEqualTo;
        },
      ),
    ).toEqual([100, 99, 95, 0]);
  });

  test("are green, pale yellow, dark orange and very dark red", () => {
    expect(RECOMMENDED_COLORS).toEqual([
      Green500.toString(),
      Yellow300.toString(),
      Orange700.toString(),
      Red900.toString(),
    ]);
    expect(RECOMMENDED_COLORS).toEqual([
      "#22c55e",
      "#fde047",
      "#c2410c",
      "#7f1d1d",
    ]);
  });

  test("every day matches one, and every rule colours some day", () => {
    expect(
      getUptimePercentBelowWhichNoRuleMatches(
        RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
      ),
    ).toBeNull();

    RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES.forEach(
      (_rule: HistoryChartBarColorRuleValues, index: number) => {
        expect(
          isRuleShadowed(RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES, index),
        ).toBe(false);
      },
    );
  });

  test.each([
    ["no downtime", 0, "#22c55e"],
    ["a minute down", 1, "#fde047"],
    // The day issue #486 opened with: red for two minutes of a day.
    ["two minutes down", 2, "#fde047"],
    ["fourteen minutes down", 14, "#fde047"],
    ["fifteen minutes down", 15, "#c2410c"],
    ["an hour down", 60, "#c2410c"],
    ["exactly 72 minutes down: 95%", 72, "#c2410c"],
    ["73 minutes down", 73, "#7f1d1d"],
    ["six hours down", 360, "#7f1d1d"],
    ["the whole day down", 1440, "#7f1d1d"],
  ] as Array<[string, number, string]>)(
    "%s",
    (_day: string, minutesDown: number, color: string) => {
      expect(
        hex(
          getBarColorForUptimePercent(
            RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
            uptimeOfADayWithDowntime(minutesDown),
          ),
        ),
      ).toBe(color);
    },
  );

  test("a day only partly measured is graded by the share of it that was down", () => {
    // Half a day covered, a quarter of that down: 75%.
    expect(
      hex(
        getBarColorForUptimePercent(
          RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
          75,
        ),
      ),
    ).toBe("#7f1d1d");
  });
});

describe("the recommended colours, to people with red-green colour blindness", () => {
  const pairs: Array<[string, string]> = [];

  for (let first: number = 0; first < RECOMMENDED_COLORS.length; first++) {
    for (
      let second: number = first + 1;
      second < RECOMMENDED_COLORS.length;
      second++
    ) {
      pairs.push([RECOMMENDED_COLORS[first]!, RECOMMENDED_COLORS[second]!]);
    }
  }

  test("there are six pairs to tell apart", () => {
    expect(pairs).toHaveLength(6);
  });

  test.each(pairs)(
    "%s and %s are distinct with full colour vision",
    (first: string, second: string) => {
      expect(getColorDifference(rgb(first), rgb(second))).toBeGreaterThan(
        DISTINCT_COLOR_DIFFERENCE,
      );
    },
  );

  test.each(pairs)(
    "%s and %s stay apart with protanopia, deuteranopia and tritanopia",
    (first: string, second: string) => {
      for (const vision of [
        ...RED_GREEN_COLOR_VISIONS,
        ColorVision.Tritanopia,
      ]) {
        expect([
          vision,
          getColorDifference(rgb(first), rgb(second), vision) >
            COLOR_BLIND_DISTINCT_COLOR_DIFFERENCE + 2,
        ]).toEqual([vision, true]);
      }

      expect(looksAlikeWithRedGreenColorBlindness(first, second)).toBe(false);
    },
  );

  test.each(RECOMMENDED_COLORS)(
    "%s stays apart from the no-data grey, even before its hatching",
    (color: string) => {
      for (const vision of [
        ColorVision.Full,
        ...RED_GREEN_COLOR_VISIONS,
        ColorVision.Tritanopia,
      ]) {
        expect([
          vision,
          getColorDifference(rgb(color), rgb(NO_DATA_GREY), vision) >
            COLOR_BLIND_DISTINCT_COLOR_DIFFERENCE,
        ]).toEqual([vision, true]);
      }
    },
  );

  /*
   * What a red-green colour-blind reader tells the colours apart by. A good
   * day and a bad one need WCAG's 3:1 for graphics between them, and each
   * step down from "a little downtime" is darker than the one before.
   */
  test("a day with no downtime and a day mostly down are 3:1 apart in lightness", () => {
    expect(getContrastRatio(rgb("#22c55e"), rgb("#7f1d1d"))).toBeGreaterThan(3);
  });

  test("each step of downtime is darker than the one before it", () => {
    const [, minor, partial, major] = RECOMMENDED_COLORS;

    const luminance: (color: string) => number = (color: string): number => {
      // Contrast against black orders colours by lightness.
      return getContrastRatio(rgb(color), { red: 0, green: 0, blue: 0 });
    };

    expect(luminance(minor!)).toBeGreaterThan(luminance(partial!));
    expect(luminance(partial!)).toBeGreaterThan(luminance(major!));
  });

  // Why they exist: the colours the monitor statuses start with.
  test("unlike the Operational green and Offline red every project starts with", () => {
    expect(looksAlikeWithRedGreenColorBlindness(Green, Red)).toBe(true);
    expect(getContrastRatio(rgb(Green), rgb(Red))).toBeLessThan(1.2);
  });
});

describe("getRuleUptimePercent", () => {
  test.each([
    [99, 99],
    [0, 0],
    [99.95, 99.95],
    ["99.00", 99],
    ["100", 100],
    [" 95 ", 95],
  ] as Array<[number | string, number]>)(
    "%p reads as %p",
    (value: number | string, percent: number) => {
      expect(
        getRuleUptimePercent({ uptimePercentGreaterThanOrEqualTo: value }),
      ).toBe(percent);
    },
  );

  test.each([null, undefined, "", "abc", Number.NaN, Number.POSITIVE_INFINITY])(
    "%p is no percentage",
    (value: unknown) => {
      expect(
        getRuleUptimePercent({
          uptimePercentGreaterThanOrEqualTo: value as number,
        }),
      ).toBeNull();
    },
  );
});

describe("getRuleBarColor", () => {
  test("a Color is used as it is", () => {
    const color: Color = new Color("#123456");

    expect(getRuleBarColor({ barColor: color })).toBe(color);
  });

  test("a hex is read as a colour", () => {
    expect(hex(getRuleBarColor({ barColor: "#ABCDEF" }))).toBe("#abcdef");
  });

  test.each([null, undefined, "", "not a colour", "#12345"])(
    "%p is no colour",
    (value: unknown) => {
      expect(getRuleBarColor({ barColor: value as string })).toBeNull();
    },
  );
});

describe("which rule colours a day", () => {
  const GREEN: string = "#00ff00";
  const YELLOW: string = "#ffff00";
  const RED: string = "#ff0000";

  function rule(
    uptimePercentGreaterThanOrEqualTo: number | string | null,
    barColor: string | null,
  ): HistoryChartBarColorRuleInput {
    return { uptimePercentGreaterThanOrEqualTo, barColor };
  }

  test("the first rule from the top whose percentage the day reaches", () => {
    const rules: Array<HistoryChartBarColorRuleInput> = [
      rule(99, GREEN),
      rule(40, YELLOW),
      rule(0, RED),
    ];

    expect(getMatchingRuleIndex(rules, 100)).toBe(0);
    expect(getMatchingRuleIndex(rules, 99)).toBe(0);
    expect(getMatchingRuleIndex(rules, 98.999)).toBe(1);
    expect(getMatchingRuleIndex(rules, 40)).toBe(1);
    expect(getMatchingRuleIndex(rules, 39.9)).toBe(2);
    expect(getMatchingRuleIndex(rules, 0)).toBe(2);
  });

  test("order decides: a lower rule above a higher one takes its days", () => {
    const rules: Array<HistoryChartBarColorRuleInput> = [
      rule(0, RED),
      rule(99, GREEN),
    ];

    expect(hex(getBarColorForUptimePercent(rules, 100))).toBe(RED);
    expect(isRuleShadowed(rules, 1)).toBe(true);
  });

  test("a day under every rule matches none", () => {
    const rules: Array<HistoryChartBarColorRuleInput> = [
      rule(99, GREEN),
      rule(95, YELLOW),
    ];

    expect(getMatchingRuleIndex(rules, 50)).toBeNull();
    expect(getBarColorForUptimePercent(rules, 50)).toBeNull();
    expect(getUptimePercentBelowWhichNoRuleMatches(rules)).toBe(95);
  });

  test("no rules match nothing", () => {
    expect(getMatchingRuleIndex([], 100)).toBeNull();
    expect(getBarColorForUptimePercent([], 0)).toBeNull();
    expect(getUptimePercentBelowWhichNoRuleMatches([])).toBeNull();
  });

  test("a percentage stored as text matches as the number it spells", () => {
    const rules: Array<HistoryChartBarColorRuleInput> = [
      rule("99.00", GREEN),
      rule("0.00", RED),
    ];

    expect(hex(getBarColorForUptimePercent(rules, 99))).toBe(GREEN);
    expect(hex(getBarColorForUptimePercent(rules, 98.5))).toBe(RED);
  });

  test("a rule without a percentage or a colour is passed over", () => {
    const rules: Array<HistoryChartBarColorRuleInput> = [
      rule(null, GREEN),
      rule(50, null),
      rule(50, "not a colour"),
      rule(10, YELLOW),
    ];

    expect(getMatchingRuleIndex(rules, 100)).toBe(3);
    expect(getUptimePercentBelowWhichNoRuleMatches(rules)).toBe(10);
    // Nor does it shadow anything.
    expect(isRuleShadowed(rules, 3)).toBe(false);
  });

  /*
   * The strip used to match inline:
   *
   *   for (const rule of rules) {
   *     if (uptime >= rule.uptimePercentGreaterThanOrEqualTo) {
   *       color = rule.barColor; break;
   *     }
   *   }
   *
   * The shared matcher must pick exactly what that picked, for any rules
   * and any uptime, so moving the strip onto it changes no page.
   */
  test("picks what the strip's old inline loop picked, for any rules and uptime", () => {
    const random: SeededRandom = seededRandom(486486);
    const palette: Array<string> = [GREEN, YELLOW, RED, "#0000ff", "#123456"];

    for (let draw: number = 0; draw < 2000; draw++) {
      const rules: Array<{
        uptimePercentGreaterThanOrEqualTo: number;
        barColor: Color;
      }> = [];
      const count: number = random(6);

      for (let index: number = 0; index < count; index++) {
        rules.push({
          uptimePercentGreaterThanOrEqualTo:
            random(2) === 0 ? random(101) : random(10001) / 100,
          barColor: new Color(palette[random(palette.length)]!),
        });
      }

      const uptime: number =
        random(4) === 0 ? random(101) : random(100001) / 1000;

      let expected: Color | null = null;

      for (const old of rules) {
        if (uptime >= old.uptimePercentGreaterThanOrEqualTo) {
          expected = old.barColor;
          break;
        }
      }

      expect(getBarColorForUptimePercent(rules, uptime)).toBe(expected);
    }
  });
});

describe("getUptimePercentBelowWhichNoRuleMatches", () => {
  test("is the lowest percentage of any rule, wherever it is in the list", () => {
    expect(
      getUptimePercentBelowWhichNoRuleMatches([
        { uptimePercentGreaterThanOrEqualTo: 50, barColor: "#ff0000" },
        { uptimePercentGreaterThanOrEqualTo: 99, barColor: "#00ff00" },
      ]),
    ).toBe(50);
  });

  test("is nothing once a rule matches every day", () => {
    expect(
      getUptimePercentBelowWhichNoRuleMatches([
        { uptimePercentGreaterThanOrEqualTo: 99, barColor: "#00ff00" },
        { uptimePercentGreaterThanOrEqualTo: 0, barColor: "#ff0000" },
      ]),
    ).toBeNull();
    expect(
      getUptimePercentBelowWhichNoRuleMatches([
        { uptimePercentGreaterThanOrEqualTo: -5, barColor: "#ff0000" },
      ]),
    ).toBeNull();
  });
});

describe("isRuleShadowed", () => {
  test("a rule under one with the same percentage never colours a day", () => {
    const rules: Array<HistoryChartBarColorRuleInput> = [
      { uptimePercentGreaterThanOrEqualTo: 99, barColor: "#00ff00" },
      { uptimePercentGreaterThanOrEqualTo: 99, barColor: "#ff0000" },
    ];

    expect(isRuleShadowed(rules, 0)).toBe(false);
    expect(isRuleShadowed(rules, 1)).toBe(true);
  });

  /*
   * The trap the recommended rules set: a rule added later goes to the end
   * of the list, under their 0% rule, which already matches every day.
   */
  test("a rule added under the recommended ones is dead until it is dragged up", () => {
    const rules: Array<HistoryChartBarColorRuleInput> = [
      ...RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
      { uptimePercentGreaterThanOrEqualTo: 99.9, barColor: "#0000ff" },
    ];

    expect(isRuleShadowed(rules, 4)).toBe(true);

    const draggedUp: Array<HistoryChartBarColorRuleInput> = [
      rules[4]!,
      ...RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
    ];

    expect(isRuleShadowed(draggedUp, 0)).toBe(false);
    expect(hex(getBarColorForUptimePercent(draggedUp, 99.95))).toBe("#0000ff");
  });

  test("descending rules shadow nothing", () => {
    const rules: Array<HistoryChartBarColorRuleInput> = [
      { uptimePercentGreaterThanOrEqualTo: 99.9, barColor: "#00ff00" },
      { uptimePercentGreaterThanOrEqualTo: 99, barColor: "#ffff00" },
      { uptimePercentGreaterThanOrEqualTo: 90, barColor: "#ff0000" },
    ];

    expect(
      rules.map((_rule: HistoryChartBarColorRuleInput, index: number) => {
        return isRuleShadowed(rules, index);
      }),
    ).toEqual([false, false, false]);
  });

  test("a place with no rule is not shadowed", () => {
    expect(isRuleShadowed([], 0)).toBe(false);
    expect(isRuleShadowed(RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES, 9)).toBe(
      false,
    );
  });
});

describe("isRecommendedHistoryChartBarColorRuleSet", () => {
  test("the recommended rules are", () => {
    expect(
      isRecommendedHistoryChartBarColorRuleSet(
        RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
      ),
    ).toBe(true);
  });

  test("so are the same rules as they come back from the database", () => {
    expect(
      isRecommendedHistoryChartBarColorRuleSet([
        { uptimePercentGreaterThanOrEqualTo: "100.00", barColor: "#22C55E" },
        { uptimePercentGreaterThanOrEqualTo: "99.00", barColor: "#FDE047" },
        { uptimePercentGreaterThanOrEqualTo: "95.00", barColor: "#c2410c" },
        {
          uptimePercentGreaterThanOrEqualTo: 0,
          barColor: new Color("#7f1d1d"),
        },
      ]),
    ).toBe(true);
  });

  const recommended: Array<HistoryChartBarColorRuleInput> = [
    ...RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
  ];

  test.each([
    ["no rules", []],
    ["one rule fewer", recommended.slice(0, 3)],
    [
      "one rule more",
      [
        ...recommended,
        { uptimePercentGreaterThanOrEqualTo: 50, barColor: "#000000" },
      ],
    ],
    ["the same rules in another order", [...recommended].reverse()],
    [
      "another colour",
      [
        { uptimePercentGreaterThanOrEqualTo: 100, barColor: "#2ab57d" },
        ...recommended.slice(1),
      ],
    ],
    [
      "another percentage",
      [
        { uptimePercentGreaterThanOrEqualTo: 99.9, barColor: "#22c55e" },
        ...recommended.slice(1),
      ],
    ],
  ] as Array<[string, Array<HistoryChartBarColorRuleInput>]>)(
    "%s are not",
    (_what: string, rules: Array<HistoryChartBarColorRuleInput>) => {
      expect(isRecommendedHistoryChartBarColorRuleSet(rules)).toBe(false);
    },
  );
});
