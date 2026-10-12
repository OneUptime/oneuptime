import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  BarColorPreviewEntry,
  BarColorPreviewEntryKind,
  NO_DATA_ENTRY,
  addRecommendedBarColorRules,
  formatUptimePercent,
  getLookAlikeEntryPairs,
  getRulePreviewEntries,
  getStatusPreviewEntries,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/HistoryChartBarColorPreviewModel";
import StatusPageHistoryChartBarColorRule from "../../../Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import { Green, Red, Yellow } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  HistoryChartBarColorRuleInput,
  NO_DATA_BAR_COLOR,
  RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
} from "../../../Utils/StatusPage/HistoryChartBarColors";

/*
 * What the Branding page's bar color preview draws (issue #486): the colours
 * a status page's uptime history can take, each named, and the two things
 * wrong with them that an operator who sees every colour cannot see - two
 * colours red-green colour-blind visitors cannot tell apart, and a rule
 * that never colours a day. And the one-click add of the recommended rules,
 * which takes back what it made when it cannot make them all.
 */

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

type EntryShape = [string, BarColorPreviewEntryKind, string, unknown];

function shapeOf(entries: Array<BarColorPreviewEntry>): Array<EntryShape> {
  return entries.map((entry: BarColorPreviewEntry): EntryShape => {
    return [
      entry.key,
      entry.kind,
      entry.color.toString().toLowerCase(),
      entry.kind === BarColorPreviewEntryKind.Status
        ? entry.statusName
        : entry.uptimePercent,
    ];
  });
}

function rule(
  uptimePercentGreaterThanOrEqualTo: number | string | null,
  barColor: string | null,
): HistoryChartBarColorRuleInput {
  return { uptimePercentGreaterThanOrEqualTo, barColor };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getRulePreviewEntries", () => {
  test("the recommended rules: one colour per rule, in order, then no data", () => {
    const entries: Array<BarColorPreviewEntry> = getRulePreviewEntries({
      rules: RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
      fallbackColor: Green,
    });

    expect(shapeOf(entries)).toEqual([
      ["rule-0", BarColorPreviewEntryKind.Rule, "#22c55e", 100],
      ["rule-1", BarColorPreviewEntryKind.Rule, "#fde047", 99],
      ["rule-2", BarColorPreviewEntryKind.Rule, "#c2410c", 95],
      ["rule-3", BarColorPreviewEntryKind.Rule, "#7f1d1d", 0],
      ["no-data", BarColorPreviewEntryKind.NoData, "#9ca3af", undefined],
    ]);

    expect(
      entries.some((entry: BarColorPreviewEntry): boolean => {
        return Boolean(entry.isShadowed);
      }),
    ).toBe(false);
  });

  test("days below every rule take the default bar colour, drawn before no data", () => {
    expect(
      shapeOf(
        getRulePreviewEntries({
          rules: [rule(99, "#00ff00"), rule(95, "#ffff00")],
          fallbackColor: new Color("#123456"),
        }),
      ),
    ).toEqual([
      ["rule-0", BarColorPreviewEntryKind.Rule, "#00ff00", 99],
      ["rule-1", BarColorPreviewEntryKind.Rule, "#ffff00", 95],
      [
        "no-rule-matches",
        BarColorPreviewEntryKind.NoRuleMatches,
        "#123456",
        95,
      ],
      ["no-data", BarColorPreviewEntryKind.NoData, "#9ca3af", undefined],
    ]);
  });

  test.each([undefined, null, "", "   "])(
    "a page without a default colour (%p) is drawn green below its rules, as the status page draws it",
    (fallbackColor: string | null | undefined) => {
      const entries: Array<BarColorPreviewEntry> = getRulePreviewEntries({
        rules: [rule(99, "#00ff00")],
        fallbackColor: fallbackColor,
      });

      expect(entries[1]!.kind).toBe(BarColorPreviewEntryKind.NoRuleMatches);
      expect(entries[1]!.color.toString()).toBe(Green.toString());
    },
  );

  test("a rule under one with a percentage as low or lower is marked: it never colours a day", () => {
    const entries: Array<BarColorPreviewEntry> = getRulePreviewEntries({
      rules: [
        ...RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
        rule(99.9, "#0000ff"),
      ],
    });

    expect(
      entries.map((entry: BarColorPreviewEntry) => {
        return [entry.key, Boolean(entry.isShadowed)];
      }),
    ).toEqual([
      ["rule-0", false],
      ["rule-1", false],
      ["rule-2", false],
      ["rule-3", false],
      ["rule-4", true],
      ["no-data", false],
    ]);
  });

  test("a rule without a percentage or a colour is left out, keeping the others' places", () => {
    expect(
      shapeOf(
        getRulePreviewEntries({
          rules: [
            rule(null, "#00ff00"),
            rule(99, "not a colour"),
            rule("95.00", "#ffff00"),
            rule(0, "#ff0000"),
          ],
        }),
      ),
    ).toEqual([
      ["rule-2", BarColorPreviewEntryKind.Rule, "#ffff00", 95],
      ["rule-3", BarColorPreviewEntryKind.Rule, "#ff0000", 0],
      ["no-data", BarColorPreviewEntryKind.NoData, "#9ca3af", undefined],
    ]);
  });

  test("no data is the fixed hatched grey of the strip", () => {
    expect(NO_DATA_ENTRY.color.toString()).toBe(NO_DATA_BAR_COLOR.toString());
    expect(getRulePreviewEntries({ rules: [] })).toEqual([NO_DATA_ENTRY]);
  });
});

describe("getStatusPreviewEntries", () => {
  test("each status's own colour, least severe first, then no data", () => {
    expect(
      shapeOf(
        getStatusPreviewEntries([
          { name: "Offline", color: Red, priority: 3 },
          { name: "Operational", color: Green, priority: 1 },
          { name: "Degraded", color: "#ffbf53", priority: 2 },
        ]),
      ),
    ).toEqual([
      [
        "status-0",
        BarColorPreviewEntryKind.Status,
        Green.toString(),
        "Operational",
      ],
      ["status-1", BarColorPreviewEntryKind.Status, "#ffbf53", "Degraded"],
      ["status-2", BarColorPreviewEntryKind.Status, Red.toString(), "Offline"],
      ["no-data", BarColorPreviewEntryKind.NoData, "#9ca3af", undefined],
    ]);
  });

  test("a status without a colour is left out, and one without a name is named nothing", () => {
    expect(
      shapeOf(
        getStatusPreviewEntries([
          { name: "Operational", priority: 1 },
          { color: Red, priority: 2 },
        ]),
      ),
    ).toEqual([
      ["status-1", BarColorPreviewEntryKind.Status, Red.toString(), ""],
      ["no-data", BarColorPreviewEntryKind.NoData, "#9ca3af", undefined],
    ]);
  });
});

describe("getLookAlikeEntryPairs", () => {
  function keys(
    pairs: Array<[BarColorPreviewEntry, BarColorPreviewEntry]>,
  ): Array<[string, string]> {
    return pairs.map(
      ([first, second]: [BarColorPreviewEntry, BarColorPreviewEntry]): [
        string,
        string,
      ] => {
        return [first.statusName || first.key, second.statusName || second.key];
      },
    );
  }

  test("the statuses every project starts with: Operational and Offline", () => {
    expect(
      keys(
        getLookAlikeEntryPairs(
          getStatusPreviewEntries([
            { name: "Operational", color: Green, priority: 1 },
            { name: "Degraded", color: Yellow, priority: 2 },
            { name: "Offline", color: Red, priority: 3 },
          ]),
        ),
      ),
    ).toEqual([["Operational", "Offline"]]);
  });

  test("the recommended rules: none", () => {
    expect(
      getLookAlikeEntryPairs(
        getRulePreviewEntries({
          rules: RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
          fallbackColor: Green,
        }),
      ),
    ).toEqual([]);
  });

  test("rules in the statuses' green and red: they look alike", () => {
    expect(
      keys(
        getLookAlikeEntryPairs(
          getRulePreviewEntries({
            rules: [rule(99.9, Green.toString()), rule(0, Red.toString())],
          }),
        ),
      ),
    ).toEqual([["rule-0", "rule-1"]]);
  });

  test("the default colour below the rules is checked as well", () => {
    expect(
      keys(
        getLookAlikeEntryPairs(
          getRulePreviewEntries({
            rules: [rule(99, Green.toString())],
            fallbackColor: Red,
          }),
        ),
      ),
    ).toEqual([["rule-0", "no-rule-matches"]]);
  });

  /*
   * The no-data grey is as light as the statuses' green, and one colour with
   * it to a deuteranope - which is why the strip hatches it. The hatch tells
   * them apart, so the pair is not raised.
   */
  test("no data is never one of a pair: its hatch tells it apart", () => {
    expect(
      getLookAlikeEntryPairs(
        getStatusPreviewEntries([
          { name: "Operational", color: Green, priority: 1 },
        ]),
      ),
    ).toEqual([]);
  });

  test("two entries in one colour are not a pair: that was chosen, and can be seen", () => {
    expect(
      getLookAlikeEntryPairs(
        getRulePreviewEntries({
          rules: [
            rule(99.9, "#22c55e"),
            rule(99, "#22c55e"),
            rule(0, "#7f1d1d"),
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe("formatUptimePercent", () => {
  test.each([
    [100, "100"],
    [99, "99"],
    [99.5, "99.5"],
    [99.95, "99.95"],
    [99.999, "99.999"],
    [0, "0"],
  ])("%p reads %p", (percent: number, text: string) => {
    expect(formatUptimePercent(percent)).toBe(text);
  });
});

describe("addRecommendedBarColorRules", () => {
  type CreateArgs = {
    model: StatusPageHistoryChartBarColorRule;
    modelType: unknown;
  };

  test("makes the recommended rules on the page, in their order", async () => {
    const made: Array<StatusPageHistoryChartBarColorRule> = [];

    jest.spyOn(ModelAPI, "create").mockImplementation((async (
      args: CreateArgs,
    ) => {
      expect(args.modelType).toBe(StatusPageHistoryChartBarColorRule);
      args.model.id = ObjectID.generate();
      made.push(args.model);
      return { data: args.model } as never;
    }) as never);

    await addRecommendedBarColorRules({
      statusPageId: STATUS_PAGE_ID,
      projectId: PROJECT_ID,
    });

    expect(
      made.map((created: StatusPageHistoryChartBarColorRule) => {
        return [
          created.uptimePercentGreaterThanOrEqualTo,
          created.barColor?.toString(),
          created.statusPageId?.toString(),
          created.projectId?.toString(),
        ];
      }),
    ).toEqual([
      [100, "#22c55e", STATUS_PAGE_ID.toString(), PROJECT_ID.toString()],
      [99, "#fde047", STATUS_PAGE_ID.toString(), PROJECT_ID.toString()],
      [95, "#c2410c", STATUS_PAGE_ID.toString(), PROJECT_ID.toString()],
      [0, "#7f1d1d", STATUS_PAGE_ID.toString(), PROJECT_ID.toString()],
    ]);
  });

  test("a refusal takes back the rules made before it, then is handed on", async () => {
    const madeIds: Array<string> = [];
    let attempts: number = 0;

    jest.spyOn(ModelAPI, "create").mockImplementation((async (
      args: CreateArgs,
    ) => {
      attempts++;

      if (attempts === 4) {
        throw new Error("refused");
      }

      args.model.id = ObjectID.generate();
      madeIds.push(args.model.id.toString());
      return { data: args.model } as never;
    }) as never);

    const deleted: Array<string> = [];

    jest.spyOn(ModelAPI, "deleteItem").mockImplementation((async (args: {
      id: ObjectID;
      modelType: unknown;
    }) => {
      expect(args.modelType).toBe(StatusPageHistoryChartBarColorRule);
      deleted.push(args.id.toString());
    }) as never);

    await expect(
      addRecommendedBarColorRules({
        statusPageId: STATUS_PAGE_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("refused");

    expect(madeIds).toHaveLength(3);
    expect(deleted).toEqual(madeIds);
  });

  test("a rule that cannot be taken back does not hide the refusal", async () => {
    let attempts: number = 0;

    jest.spyOn(ModelAPI, "create").mockImplementation((async (
      args: CreateArgs,
    ) => {
      attempts++;

      if (attempts === 2) {
        throw new Error("refused");
      }

      args.model.id = ObjectID.generate();
      return { data: args.model } as never;
    }) as never);

    jest
      .spyOn(ModelAPI, "deleteItem")
      .mockRejectedValue(new Error("offline") as never);

    await expect(
      addRecommendedBarColorRules({
        statusPageId: STATUS_PAGE_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("refused");
  });
});
