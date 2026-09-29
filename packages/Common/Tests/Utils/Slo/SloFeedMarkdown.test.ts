import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import {
  SLO_BURN_RATE_RULE_FEED_COLUMNS,
  SLO_FEED_IS_ARCHIVED_COLUMN,
  SLO_FEED_IS_ENABLED_COLUMN,
  SLO_FEED_MONITORS_COLUMN,
  SLO_FEED_NONE_TEXT,
  SLO_FEED_NOT_SET_TEXT,
  SLO_FEED_UPDATE_COLUMNS,
  SloFeedColumn,
  SloFeedColumnChange,
  SloFeedMarkdown,
  SloFeedMonitorReference,
  SloFeedValueKind,
  describeSloFeedWindow,
  formatSloFeedDuration,
  formatSloFeedEntityNames,
  formatSloFeedMinutes,
  formatSloFeedNumber,
  formatSloFeedPercent,
  formatSloFeedText,
  formatSloFeedValue,
  getBurnRateRuleAddedFeedMarkdown,
  getBurnRateRuleChangedFeedMarkdown,
  getBurnRateRuleRemovedFeedMarkdown,
  getSloArchivedFeedMarkdown,
  getSloCreatedFeedMarkdown,
  getSloEnabledFeedMarkdown,
  getSloFeedColumnChanges,
  getSloFeedColumnsInPayload,
  getSloFeedEntityIds,
  getSloFeedSelect,
  getSloFeedWatchedColumns,
  getSloMonitorsChangedFeedMarkdown,
  getSloStatusChangedFeedMarkdown,
  getSloStatusEmoji,
  getSloUpdatedFeedMarkdown,
  isSloFeedValueEqual,
  normalizeSloFeedBoolean,
} from "../../../Utils/Slo/SloFeedMarkdown";
import { describe, expect, test } from "@jest/globals";

/*
 * Contract under test: the words of the SLO feed, and the change detection
 * that decides whether there are any words to post at all.
 *
 * Two properties carry the weight here:
 *
 *   - Nothing user-controlled can escape the sentence it is put in. Feed items
 *     render without the markdown viewer's safe mode, so an SLO, monitor,
 *     rule, label or user name that closes a link, opens an image or starts a
 *     heading changes what every viewer of the feed sees and fetches.
 *
 *   - A value that did not change is not a change. Settings forms re-submit
 *     every field they show, numbers arrive as strings, and relation sets come
 *     back in any order; if any of that reads as a change, the feed fills with
 *     "Target: 99.9% -> 99.9%".
 */

const LINK: string =
  "[SLO Checkout](https://oneuptime.test/dashboard/p/slos/s)";

/*
 * Names somebody could actually type, each aimed at a different way of
 * breaking out of the sentence.
 */
const HOSTILE_NAMES: Array<string> = [
  "x](https://evil.example/phish)",
  "![pixel](https://tracker.example/p.png)",
  "[click me](javascript:alert(1))",
  "**bold** _italic_ `code`",
  "<img src=x onerror=alert(1)>",
  "# heading",
  "line one\nline two",
  "pipe | table | row",
  "back\\slash",
];

type ExpectInertFunction = (escaped: string) => void;

/*
 * After removing every backslash-escape pair, no markdown-active character
 * and no line break may remain: whatever is left renders as literal text.
 */
const expectInert: ExpectInertFunction = (escaped: string): void => {
  const withoutEscapes: string = escaped.replace(/\\[\s\S]/g, "");

  expect(withoutEscapes).not.toMatch(/[\\`*_[\]()#+\-!|<>]/);
  expect(escaped).not.toMatch(/[\r\n]/);
};

describe("SloFeedMarkdown - numbers and durations", () => {
  test("rounds for reading and folds negative zero into zero", () => {
    expect(formatSloFeedNumber(14.4)).toBe("14.4");
    expect(formatSloFeedNumber(22.22222)).toBe("22.22");
    expect(formatSloFeedNumber(99.99954, 4)).toBe("99.9995");
    expect(formatSloFeedNumber(-0.001)).toBe("0");
    expect(formatSloFeedNumber(Number.NaN)).toBe("0");
    expect(formatSloFeedNumber(Number.POSITIVE_INFINITY)).toBe("0");
  });

  test("percentages keep the precision they are asked for", () => {
    expect(formatSloFeedPercent(7.407407)).toBe("7.41%");
    expect(formatSloFeedPercent(99.9, 3)).toBe("99.9%");
    expect(formatSloFeedPercent(99.999, 3)).toBe("99.999%");
  });

  test.each([
    [1, "1 minute"],
    [5, "5 minutes"],
    [0, "0 minutes"],
    [90, "90 minutes"],
    [60, "1 hour"],
    [360, "6 hours"],
    [1440, "1 day"],
    [4320, "3 days"],
  ])(
    "%p minutes of burn window reads as %p",
    (minutes: number, text: string) => {
      expect(formatSloFeedMinutes(minutes)).toBe(text);
    },
  );

  test("a window that is not a number reads as not set", () => {
    expect(formatSloFeedMinutes(Number.NaN)).toBe(SLO_FEED_NOT_SET_TEXT);
  });

  test.each([
    [0, "0 seconds"],
    [1, "1 second"],
    [59, "59 seconds"],
    [64, "1 minute"],
    [600, "10 minutes"],
    [7200, "2 hours"],
    [9000, "2.5 hours"],
    [172800, "2 days"],
    // The sign is the caller's to word ("over budget by ...").
    [-1136, "19 minutes"],
  ])(
    "an error budget of %p seconds reads as %p",
    (seconds: number, text: string) => {
      expect(formatSloFeedDuration(seconds)).toBe(text);
    },
  );
});

describe("SloFeedMarkdown - user text", () => {
  test.each(HOSTILE_NAMES)("renders %p as inert text", (name: string) => {
    expectInert(formatSloFeedText(name));
  });

  test("keeps an ordinary name exactly as typed", () => {
    expect(formatSloFeedText("Checkout availability")).toBe(
      "Checkout availability",
    );
  });

  test("folds line breaks and runs of whitespace into single spaces", () => {
    expect(formatSloFeedText("  first\n\n second\tthird  ")).toBe(
      "first second third",
    );
  });

  test("cuts long text before escaping, so no escape is ever split in half", () => {
    // The 160th character is a bracket: cutting after escaping would strand "\".
    const text: string = `${"a".repeat(159)}[${"b".repeat(50)}`;
    const formatted: string = formatSloFeedText(text);

    expect(formatted.endsWith("…")).toBe(true);
    expect(formatted).toBe(`${"a".repeat(159)}\\[…`);
    expectInert(formatted.replace("…", ""));
  });

  test("an absent value is empty, never the string 'undefined'", () => {
    expect(formatSloFeedText(undefined)).toBe("");
    expect(formatSloFeedText(null)).toBe("");
  });
});

describe("SloFeedMarkdown - relation ids and names", () => {
  test("reads ids from every shape a relation arrives in, sorted, de-duplicated and case-folded", () => {
    const id: ObjectID = new ObjectID("BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB");

    expect(
      getSloFeedEntityIds([
        { _id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        id,
        { id: id },
        { _id: "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC" },
        null,
        {},
      ]),
    ).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]);
  });

  test("anything that is not a list has no ids", () => {
    expect(getSloFeedEntityIds(undefined)).toEqual([]);
    expect(getSloFeedEntityIds(null)).toEqual([]);
    expect(getSloFeedEntityIds("not-a-list")).toEqual([]);
  });

  test("lists names alphabetically so an unchanged set reads identically", () => {
    expect(
      formatSloFeedEntityNames([{ name: "Tier 1" }, { name: "Production" }]),
    ).toBe("Production, Tier 1");
  });

  test("reads a user's Name value object, falls back to the email, and still counts a row with neither", () => {
    expect(
      formatSloFeedEntityNames([
        { name: new Name("Jane Doe") },
        { email: "ops@example.com" },
        { _id: "no-name" },
      ]),
    ).toBe("Jane Doe, ops@example.com, Unnamed");
  });

  test("collapses a long list into 'and N more'", () => {
    const labels: Array<{ name: string }> = Array.from(
      { length: 13 },
      (_value: unknown, index: number): { name: string } => {
        return { name: `Label ${String(index).padStart(2, "0")}` };
      },
    );

    const formatted: string = formatSloFeedEntityNames(labels);

    expect(formatted.startsWith("Label 00, Label 01")).toBe(true);
    expect(formatted.endsWith("Label 09 and 3 more")).toBe(true);
  });

  test("escapes every name in the list", () => {
    expectInert(
      formatSloFeedEntityNames(
        HOSTILE_NAMES.map((name: string): { name: string } => {
          return { name: name };
        }),
      ).replace(/ and \d+ more$/, ""),
    );
  });

  test("an empty relation reads as none", () => {
    expect(formatSloFeedEntityNames([])).toBe(SLO_FEED_NONE_TEXT);
    expect(formatSloFeedEntityNames(undefined)).toBe(SLO_FEED_NONE_TEXT);
  });
});

describe("SloFeedMarkdown - booleans", () => {
  test.each([
    [true, true],
    [false, false],
    ["true", true],
    [" FALSE ", false],
    ["1", true],
    ["0", false],
    [1, true],
    [0, false],
    ["", null],
    ["maybe", null],
    [null, null],
    [undefined, null],
  ])("%p normalizes to %p", (value: unknown, expected: boolean | null) => {
    expect(normalizeSloFeedBoolean(value)).toBe(expected);
  });
});

describe("SloFeedMarkdown - which columns a payload writes", () => {
  test("a key carrying undefined writes nothing, a key carrying null does", () => {
    expect(
      getSloFeedColumnsInPayload(
        { name: undefined, description: null },
        SLO_FEED_UPDATE_COLUMNS,
      ).map((column: SloFeedColumn): string => {
        return column.column;
      }),
    ).toEqual(["description"]);
  });

  test("anything that is not an object writes nothing", () => {
    expect(getSloFeedColumnsInPayload(null, SLO_FEED_UPDATE_COLUMNS)).toEqual(
      [],
    );
    expect(getSloFeedColumnsInPayload("name", SLO_FEED_UPDATE_COLUMNS)).toEqual(
      [],
    );
  });

  test("the evaluation worker's per-tick state write watches nothing", () => {
    /*
     * The one guarantee that keeps the feed off the hot path: this exact
     * payload is written for every SLO on every evaluation.
     */
    expect(
      getSloFeedWatchedColumns({
        payload: {
          currentSliPercentage: 99.1,
          errorBudgetRemainingPercentage: 42,
          errorBudgetRemainingSeconds: 1000,
          errorBudgetTotalSeconds: 2592,
          currentBurnRate: 1.2,
          sloStatus: SloStatus.AtRisk,
        },
        includeMonitors: true,
      }),
    ).toEqual([]);

    expect(
      getSloFeedWatchedColumns({
        payload: { nextEvaluationAt: new Date(), lastEvaluatedAt: new Date() },
        includeMonitors: true,
      }),
    ).toEqual([]);
  });

  test("the monitor set is only watched when the caller says the edit is hand-made", () => {
    const payload: Record<string, unknown> = {
      monitors: [{ _id: "a" }],
      autoAddedMonitors: [{ _id: "a" }],
    };

    expect(
      getSloFeedWatchedColumns({ payload: payload, includeMonitors: false }),
    ).toEqual([]);
    expect(
      getSloFeedWatchedColumns({ payload: payload, includeMonitors: true }),
    ).toEqual([SLO_FEED_MONITORS_COLUMN]);
  });

  test("enable and archive toggles are watched alongside the settings columns", () => {
    expect(
      getSloFeedWatchedColumns({
        payload: { isEnabled: false, isArchived: true, targetPercentage: 99 },
        includeMonitors: false,
      }).map((column: SloFeedColumn): string => {
        return column.column;
      }),
    ).toEqual(["targetPercentage", "isEnabled", "isArchived"]);
  });

  test("no worker-owned column can ever be watched", () => {
    const watched: Array<string> = [
      ...SLO_FEED_UPDATE_COLUMNS,
      SLO_FEED_IS_ENABLED_COLUMN,
      SLO_FEED_IS_ARCHIVED_COLUMN,
      SLO_FEED_MONITORS_COLUMN,
    ].map((column: SloFeedColumn): string => {
      return column.column;
    });

    for (const workerColumn of [
      "autoAddedMonitors",
      "currentSliPercentage",
      "errorBudgetRemainingPercentage",
      "errorBudgetRemainingSeconds",
      "errorBudgetTotalSeconds",
      "currentBurnRate",
      "sloStatus",
      "statusChangeNotificationSentAt",
      "lastEvaluatedAt",
      "nextEvaluationAt",
      "lastAccumulatedBucketEndAt",
      "archivedAt",
      "archivedByUserId",
    ]) {
      expect(watched).not.toContain(workerColumn);
    }
  });

  test("no burn rate rule lifecycle stamp can ever be watched", () => {
    const watched: Array<string> = SLO_BURN_RATE_RULE_FEED_COLUMNS.map(
      (column: SloFeedColumn): string => {
        return column.column;
      },
    );

    for (const stamp of [
      "lastAlertCreatedAt",
      "lastAlertResolvedAt",
      "lastIncidentCreatedAt",
      "lastIncidentResolvedAt",
    ]) {
      expect(watched).not.toContain(stamp);
    }
  });

  test("every watched column is a real column of its model", () => {
    /*
     * A misspelt column is never in any payload, so its edits would silently
     * never reach the feed - and never fail anything either.
     */
    const sloColumns: Array<string> =
      new ServiceLevelObjective().getTableColumns().columns;

    for (const column of [
      ...SLO_FEED_UPDATE_COLUMNS,
      SLO_FEED_IS_ENABLED_COLUMN,
      SLO_FEED_IS_ARCHIVED_COLUMN,
      SLO_FEED_MONITORS_COLUMN,
    ]) {
      expect(sloColumns).toContain(column.column);
    }

    const ruleColumns: Array<string> =
      new ServiceLevelObjectiveBurnRateRule().getTableColumns().columns;

    for (const column of SLO_BURN_RATE_RULE_FEED_COLUMNS) {
      expect(ruleColumns).toContain(column.column);

      if (column.relationProperty) {
        expect(ruleColumns).toContain(column.relationProperty);
      }
    }
  });
});

describe("SloFeedMarkdown - reading what changed", () => {
  const TARGET: SloFeedColumn = SLO_FEED_UPDATE_COLUMNS.find(
    (column: SloFeedColumn): boolean => {
      return column.column === "targetPercentage";
    },
  )!;
  const LABELS: SloFeedColumn = SLO_FEED_UPDATE_COLUMNS.find(
    (column: SloFeedColumn): boolean => {
      return column.column === "labels";
    },
  )!;
  const DESCRIPTION: SloFeedColumn = SLO_FEED_UPDATE_COLUMNS.find(
    (column: SloFeedColumn): boolean => {
      return column.column === "description";
    },
  )!;
  const TIMEZONE: SloFeedColumn = SLO_FEED_UPDATE_COLUMNS.find(
    (column: SloFeedColumn): boolean => {
      return column.column === "timezone";
    },
  )!;
  const ALERT_SEVERITY: SloFeedColumn = SLO_BURN_RATE_RULE_FEED_COLUMNS.find(
    (column: SloFeedColumn): boolean => {
      return column.column === "alertSeverityId";
    },
  )!;
  const ALERT_TEMPLATE: SloFeedColumn = SLO_BURN_RATE_RULE_FEED_COLUMNS.find(
    (column: SloFeedColumn): boolean => {
      return column.column === "alertTitleTemplate";
    },
  )!;

  test("the select expands relations to exactly what the feed prints", () => {
    const OWNER_USERS: SloFeedColumn = SLO_BURN_RATE_RULE_FEED_COLUMNS.find(
      (column: SloFeedColumn): boolean => {
        return column.column === "alertOwnerUsers";
      },
    )!;

    expect(
      getSloFeedSelect([TARGET, LABELS, ALERT_SEVERITY, OWNER_USERS]),
    ).toEqual({
      targetPercentage: true,
      labels: { _id: true, name: true },
      alertSeverityId: true,
      alertSeverity: { _id: true, name: true },
      alertOwnerUsers: { _id: true, name: true, email: true },
    });
  });

  test("a number that arrived as a string is the same number", () => {
    expect(
      isSloFeedValueEqual(
        TARGET,
        { targetPercentage: "99.9" },
        { targetPercentage: 99.9 },
      ),
    ).toBe(true);
    expect(
      isSloFeedValueEqual(
        TARGET,
        { targetPercentage: 99.9 },
        { targetPercentage: 99.95 },
      ),
    ).toBe(false);
  });

  test("a relation set in a different order, or a different id case, is the same set", () => {
    expect(
      isSloFeedValueEqual(
        LABELS,
        {
          labels: [
            { _id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
            { _id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
          ],
        },
        {
          labels: [
            { _id: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB" },
            { _id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
          ],
        },
      ),
    ).toBe(true);
  });

  test("an empty string and a null are both 'not set'", () => {
    expect(
      isSloFeedValueEqual(TIMEZONE, { timezone: null }, { timezone: "  " }),
    ).toBe(true);
  });

  test("a boolean that arrived as a string is the same boolean", () => {
    expect(
      isSloFeedValueEqual(
        SLO_FEED_IS_ENABLED_COLUMN,
        { isEnabled: false },
        { isEnabled: "false" },
      ),
    ).toBe(true);
  });

  test("a foreign key compares by id, whatever the case", () => {
    expect(
      isSloFeedValueEqual(
        ALERT_SEVERITY,
        {
          alertSeverityId: new ObjectID("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"),
        },
        { alertSeverityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      ),
    ).toBe(true);
  });

  test("formats each kind of value the way a person would say it", () => {
    expect(formatSloFeedValue(TARGET, { targetPercentage: 99.95 })).toBe(
      "99.95%",
    );
    expect(formatSloFeedValue(TIMEZONE, { timezone: null })).toBe(
      "UTC (default)",
    );
    expect(
      formatSloFeedValue(ALERT_SEVERITY, {
        alertSeverityId: "s-1",
        alertSeverity: { name: "Critical" },
      }),
    ).toBe("Critical");
    expect(formatSloFeedValue(ALERT_SEVERITY, { alertSeverityId: "s-1" })).toBe(
      "_a deleted item_",
    );
    expect(formatSloFeedValue(ALERT_SEVERITY, {})).toBe(SLO_FEED_NOT_SET_TEXT);
    // Templates are compared but never quoted.
    expect(
      formatSloFeedValue(ALERT_TEMPLATE, { alertTitleTemplate: "{{sloName}}" }),
    ).toBe("_set_");
    expect(
      formatSloFeedValue(SLO_FEED_IS_ENABLED_COLUMN, { isEnabled: "false" }),
    ).toBe("Off");
  });

  test("with a before-row, only the columns that really changed are reported", () => {
    const changes: Array<SloFeedColumnChange> = getSloFeedColumnChanges({
      columns: [TARGET, LABELS, DESCRIPTION],
      before: {
        targetPercentage: 99.9,
        labels: [{ _id: "a", name: "Production" }],
        description: "Checkout",
      },
      after: {
        targetPercentage: "99.9",
        labels: [{ _id: "a", name: "Production" }],
        description: "Checkout, including payment",
      },
    });

    expect(changes).toEqual([
      {
        column: "description",
        title: "Description",
        kind: SloFeedValueKind.LongText,
        from: "Checkout",
        to: "Checkout, including payment",
      },
    ]);
  });

  test("without a before-row, every written column is reported with its new value only", () => {
    const changes: Array<SloFeedColumnChange> = getSloFeedColumnChanges({
      columns: [TARGET],
      before: null,
      after: { targetPercentage: 99.5 },
    });

    expect(changes).toEqual([
      {
        column: "targetPercentage",
        title: "Target",
        kind: SloFeedValueKind.Percent,
        from: null,
        to: "99.5%",
      },
    ]);
  });
});

describe("SloFeedMarkdown - SLO lifecycle items", () => {
  test("a created SLO names its creator, its promise and the default rules that came with it", () => {
    const markdown: SloFeedMarkdown = getSloCreatedFeedMarkdown({
      sloMarkdownLink: LINK,
      createdByUserMarkdown: "[Jane Doe](https://oneuptime.test/u)",
      targetPercentage: 99.9,
      windowType: SloWindowType.Rolling,
      windowDays: 30,
      sliType: "Monitor Uptime",
      atRiskThresholdPercentage: 20,
      description: "Checkout *flow*",
      defaultBurnRateRules: [
        {
          name: "Fast burn",
          burnRateThreshold: 14.4,
          longWindowInMinutes: 60,
          shortWindowInMinutes: 5,
        },
        {
          name: "Slow burn",
          burnRateThreshold: 6,
          longWindowInMinutes: 360,
          shortWindowInMinutes: 30,
        },
      ],
    });

    expect(markdown.feedInfoInMarkdown).toBe(
      `🎯 ${LINK} was created by **[Jane Doe](https://oneuptime.test/u)**.`,
    );
    expect(markdown.moreInformationInMarkdown).toBe(
      [
        "**Created by**: [Jane Doe](https://oneuptime.test/u)",
        "**Target**: 99.9%",
        "**Compliance window**: Rolling 30 days",
        "**SLI**: Monitor Uptime",
        "**At-risk threshold**: 20% of the error budget remaining",
        "**Default burn rate rules**: Fast burn (burn rate above 14.4x over 1 hour, confirmed over 5 minutes); Slow burn (burn rate above 6x over 6 hours, confirmed over 30 minutes)",
        "**Description**: Checkout \\*flow\\*",
      ].join("\n\n"),
    );
  });

  test("a created SLO with nobody behind it says so instead of naming anyone", () => {
    const markdown: SloFeedMarkdown = getSloCreatedFeedMarkdown({
      sloMarkdownLink: LINK,
      createdByUserMarkdown: null,
      windowType: SloWindowType.CalendarMonth,
      timezone: "Europe/Oslo",
      defaultBurnRateRules: [],
    });

    expect(markdown.feedInfoInMarkdown).toBe(`🎯 ${LINK} was created.`);
    expect(markdown.moreInformationInMarkdown).toContain(
      "**Created by**: No user",
    );
    expect(markdown.moreInformationInMarkdown).toContain(
      "**Compliance window**: Calendar month (Europe/Oslo)",
    );
    // No seeded rules, no rules line - and no target claimed that was not set.
    expect(markdown.moreInformationInMarkdown).not.toContain("burn rate rules");
    expect(markdown.moreInformationInMarkdown).not.toContain("**Target**");
  });

  test("describes a rolling window with no length as the 30 days the worker measures", () => {
    expect(describeSloFeedWindow({ windowType: SloWindowType.Rolling })).toBe(
      "Rolling 30 days",
    );
    expect(
      describeSloFeedWindow({ windowType: undefined, windowDays: 1 }),
    ).toBe("Rolling 1 day");
    expect(
      describeSloFeedWindow({ windowType: SloWindowType.CalendarMonth }),
    ).toBe("Calendar month (UTC)");
  });

  test("escapes a hostile description and rule name in the created item", () => {
    for (const name of HOSTILE_NAMES) {
      const markdown: SloFeedMarkdown = getSloCreatedFeedMarkdown({
        sloMarkdownLink: LINK,
        createdByUserMarkdown: null,
        description: name,
        defaultBurnRateRules: [{ name: name }],
      });

      const rulesLine: string = markdown.moreInformationInMarkdown
        .split("\n\n")
        .find((line: string): boolean => {
          return line.startsWith("**Default burn rate rules**: ");
        })!;

      expectInert(rulesLine.replace("**Default burn rate rules**: ", ""));
    }
  });

  test("a single short change is spelled out in the summary line", () => {
    const markdown: SloFeedMarkdown = getSloUpdatedFeedMarkdown({
      sloMarkdownLink: LINK,
      changes: [
        {
          column: "targetPercentage",
          title: "Target",
          kind: SloFeedValueKind.Percent,
          from: "99.9%",
          to: "99.95%",
        },
      ],
    });

    expect(markdown.feedInfoInMarkdown).toBe(
      `📝 ${LINK} was updated: **Target** changed from 99.9% to 99.95%.`,
    );
    expect(markdown.moreInformationInMarkdown).toBe(
      "**Target**: 99.9% → 99.95%",
    );
  });

  test("several changes, or a long one, are named in the summary and spelled out below", () => {
    const markdown: SloFeedMarkdown = getSloUpdatedFeedMarkdown({
      sloMarkdownLink: LINK,
      changes: [
        {
          column: "targetPercentage",
          title: "Target",
          kind: SloFeedValueKind.Percent,
          from: "99.9%",
          to: "99.95%",
        },
        {
          column: "windowDays",
          title: "Rolling window length",
          kind: SloFeedValueKind.Days,
          from: "30 days",
          to: "7 days",
        },
        {
          column: "timezone",
          title: "Timezone",
          kind: SloFeedValueKind.Text,
          from: null,
          to: "Europe/Oslo",
        },
      ],
    });

    expect(markdown.feedInfoInMarkdown).toBe(
      `📝 ${LINK} was updated: **Target**, **Rolling window length** and **Timezone** changed.`,
    );
    expect(markdown.moreInformationInMarkdown).toBe(
      [
        "**Target**: 99.9% → 99.95%",
        "**Rolling window length**: 30 days → 7 days",
        "**Timezone**: Europe/Oslo",
      ].join("\n\n"),
    );

    const description: SloFeedMarkdown = getSloUpdatedFeedMarkdown({
      sloMarkdownLink: LINK,
      changes: [
        {
          column: "description",
          title: "Description",
          kind: SloFeedValueKind.LongText,
          from: "old",
          to: "new",
        },
      ],
    });

    expect(description.feedInfoInMarkdown).toBe(
      `📝 ${LINK} was updated: **Description** changed.`,
    );
  });

  test.each([
    {
      isEnabled: true,
      isArchived: false,
      summary: `▶️ ${LINK} was enabled.`,
      detail: "Evaluation resumes on the next worker tick",
    },
    {
      isEnabled: true,
      isArchived: true,
      summary: `▶️ ${LINK} was enabled.`,
      detail: "still archived",
    },
    {
      isEnabled: false,
      isArchived: false,
      summary: `⏸️ ${LINK} was disabled.`,
      detail:
        "Any burn rate alerts and incidents its rules had open were resolved.",
    },
  ])(
    "enabled=$isEnabled archived=$isArchived words the toggle for the state it leaves",
    (row: {
      isEnabled: boolean;
      isArchived: boolean;
      summary: string;
      detail: string;
    }) => {
      const markdown: SloFeedMarkdown = getSloEnabledFeedMarkdown({
        sloMarkdownLink: LINK,
        isEnabled: row.isEnabled,
        isArchived: row.isArchived,
      });

      expect(markdown.feedInfoInMarkdown).toBe(row.summary);
      expect(markdown.moreInformationInMarkdown).toContain(row.detail);
    },
  );

  test.each([
    {
      isArchived: true,
      isEnabled: true,
      summary: `🗄️ ${LINK} was archived.`,
      detail: "hidden from the SLO list and are not evaluated",
    },
    {
      isArchived: false,
      isEnabled: true,
      summary: `♻️ ${LINK} was restored from the archive.`,
      detail: "evaluated again from the next worker tick",
    },
    {
      isArchived: false,
      isEnabled: false,
      summary: `♻️ ${LINK} was restored from the archive.`,
      detail: "still disabled",
    },
  ])(
    "archived=$isArchived enabled=$isEnabled words the archive change honestly",
    (row: {
      isArchived: boolean;
      isEnabled: boolean;
      summary: string;
      detail: string;
    }) => {
      const markdown: SloFeedMarkdown = getSloArchivedFeedMarkdown({
        sloMarkdownLink: LINK,
        isArchived: row.isArchived,
        isEnabled: row.isEnabled,
      });

      expect(markdown.feedInfoInMarkdown).toBe(row.summary);
      expect(markdown.moreInformationInMarkdown).toContain(row.detail);
    },
  );
});

describe("SloFeedMarkdown - monitors attached and detached", () => {
  function monitor(name: string, id: string): SloFeedMonitorReference {
    return { name: name, link: `https://oneuptime.test/m/${id}` };
  }

  test("one monitor is named in the summary", () => {
    const markdown: SloFeedMarkdown = getSloMonitorsChangedFeedMarkdown({
      sloMarkdownLink: LINK,
      monitors: [monitor("API", "1")],
      change: "attached",
    });

    expect(markdown.feedInfoInMarkdown).toBe(
      `🔗 Monitor [API](https://oneuptime.test/m/1) was attached to ${LINK}.`,
    );
    expect(markdown.moreInformationInMarkdown).toBe(
      [
        "**Monitors attached**:",
        "- [API](https://oneuptime.test/m/1)",
        "The SLO is measured against its new monitor set from the next worker tick.",
      ].join("\n\n"),
    );
  });

  test("many monitors are counted, the first three named alphabetically", () => {
    const markdown: SloFeedMarkdown = getSloMonitorsChangedFeedMarkdown({
      sloMarkdownLink: LINK,
      monitors: ["E", "C", "A", "D", "B"].map((name: string) => {
        return monitor(name, name);
      }),
      change: "detached",
    });

    expect(markdown.feedInfoInMarkdown).toBe(
      `✂️ 5 monitors were detached from ${LINK}: [A](https://oneuptime.test/m/A), [B](https://oneuptime.test/m/B), [C](https://oneuptime.test/m/C) and 2 more.`,
    );
  });

  test("a very large change keeps More Information bounded", () => {
    const markdown: SloFeedMarkdown = getSloMonitorsChangedFeedMarkdown({
      sloMarkdownLink: LINK,
      monitors: Array.from({ length: 75 }, (_value: unknown, index: number) => {
        return monitor(`Monitor ${String(index).padStart(2, "0")}`, `${index}`);
      }),
      change: "attached",
    });

    expect(markdown.moreInformationInMarkdown.match(/^- \[/gm)).toHaveLength(
      50,
    );
    expect(markdown.moreInformationInMarkdown).toContain("- and 25 more");
  });

  test.each(HOSTILE_NAMES)(
    "a monitor named %p cannot re-point or add a link",
    (name: string) => {
      const markdown: SloFeedMarkdown = getSloMonitorsChangedFeedMarkdown({
        sloMarkdownLink: LINK,
        monitors: [monitor(name, "1")],
        change: "attached",
      });

      const linkText: string = markdown.feedInfoInMarkdown
        .replace("🔗 Monitor [", "")
        .replace(`](https://oneuptime.test/m/1) was attached to ${LINK}.`, "");

      expectInert(linkText);
    },
  );

  test("a monitor whose name could not be read is still listed", () => {
    const markdown: SloFeedMarkdown = getSloMonitorsChangedFeedMarkdown({
      sloMarkdownLink: LINK,
      monitors: [monitor("", "1")],
      change: "detached",
    });

    expect(markdown.feedInfoInMarkdown).toContain(
      "[Unnamed monitor](https://oneuptime.test/m/1)",
    );
  });
});

describe("SloFeedMarkdown - status changes", () => {
  test.each([
    [SloStatus.Healthy, "🟢"],
    [SloStatus.AtRisk, "🟡"],
    [SloStatus.BudgetExhausted, "🔴"],
    [SloStatus.Paused, "⏸️"],
    [SloStatus.Misconfigured, "⚠️"],
  ])("%p is marked %p", (status: SloStatus, emoji: string) => {
    expect(getSloStatusEmoji(status)).toBe(emoji);
  });

  test("an evaluated transition carries the numbers behind it", () => {
    const markdown: SloFeedMarkdown = getSloStatusChangedFeedMarkdown({
      sloMarkdownLink: LINK,
      previousStatus: SloStatus.Healthy,
      newStatus: SloStatus.AtRisk,
      measurement: {
        sliPercentage: 99.07407407,
        targetPercentage: 99,
        errorBudgetRemainingPercentage: 7.407407,
        errorBudgetRemainingSeconds: 64,
        currentBurnRate: 22.22222,
        currentBurnRateWindowInMinutes: 60,
        atRiskThresholdPercentage: 20,
      },
    });

    expect(markdown.feedInfoInMarkdown).toBe(
      `🟡 ${LINK} is now **At Risk** (was Healthy).`,
    );
    expect(markdown.moreInformationInMarkdown).toBe(
      [
        "**Status**: Healthy → At Risk",
        "**SLI**: 99.0741% against a 99% target",
        "**Error budget remaining**: 7.41% (1 minute)",
        "**Current burn rate**: 22.22x over the last 1 hour",
        "**At-risk threshold**: 20% of the error budget remaining",
      ].join("\n\n"),
    );
  });

  test("an over-budget SLO says by how much, not a negative duration", () => {
    const markdown: SloFeedMarkdown = getSloStatusChangedFeedMarkdown({
      sloMarkdownLink: LINK,
      previousStatus: SloStatus.AtRisk,
      newStatus: SloStatus.BudgetExhausted,
      measurement: {
        sliPercentage: 97.685,
        targetPercentage: 99,
        errorBudgetRemainingPercentage: -131.48,
        errorBudgetRemainingSeconds: -1136,
        currentBurnRate: 55.5,
        currentBurnRateWindowInMinutes: 60,
        atRiskThresholdPercentage: 20,
      },
    });

    expect(markdown.moreInformationInMarkdown).toContain(
      "**Error budget remaining**: -131.48% (over budget by 19 minutes)",
    );
  });

  test("a guard transition gives its reason and claims no measurement", () => {
    const markdown: SloFeedMarkdown = getSloStatusChangedFeedMarkdown({
      sloMarkdownLink: LINK,
      previousStatus: undefined,
      newStatus: SloStatus.Misconfigured,
      reason: "No monitors are attached to this SLO.",
    });

    expect(markdown.feedInfoInMarkdown).toBe(
      `⚠️ ${LINK} is now **Misconfigured**.`,
    );
    expect(markdown.moreInformationInMarkdown).toBe(
      [
        "**Status**: Not evaluated yet → Misconfigured",
        "**Why**: No monitors are attached to this SLO.",
        "While the SLO is Misconfigured, its SLI and error budget are not recalculated and its burn rate rules do not fire. Any burn rate alerts and incidents its rules had open were resolved.",
      ].join("\n\n"),
    );
  });
});

describe("SloFeedMarkdown - burn rate rules", () => {
  test("an added rule says when it fires and what it opens", () => {
    const markdown: SloFeedMarkdown = getBurnRateRuleAddedFeedMarkdown({
      sloMarkdownLink: LINK,
      rule: {
        name: "Fast burn",
        burnRateThreshold: 14.4,
        longWindowInMinutes: 60,
        shortWindowInMinutes: 5,
        isEnabled: true,
        shouldCreateAlert: true,
        shouldCreateIncident: true,
      },
    });

    expect(markdown.feedInfoInMarkdown).toBe(
      `🔥 Burn rate rule **Fast burn** was added to ${LINK}.`,
    );
    expect(markdown.moreInformationInMarkdown).toBe(
      [
        "**Fires on**: burn rate above 14.4x over 1 hour, confirmed over 5 minutes",
        "**When it fires**: it raises an alert and declares an incident",
        "**Enabled**: Yes",
      ].join("\n\n"),
    );
  });

  test.each([
    [
      { shouldCreateAlert: true, shouldCreateIncident: false },
      "raises an alert",
    ],
    [
      { shouldCreateAlert: false, shouldCreateIncident: true },
      "declares an incident",
    ],
    // Unset alert flag: the column default raises an alert.
    [{ shouldCreateIncident: false }, "raises an alert"],
  ])(
    "outputs %p read as %p",
    (outputs: Record<string, boolean>, text: string) => {
      const markdown: SloFeedMarkdown = getBurnRateRuleAddedFeedMarkdown({
        sloMarkdownLink: LINK,
        rule: { name: "Rule", ...outputs },
      });

      expect(markdown.moreInformationInMarkdown).toContain(
        `**When it fires**: it ${text}`,
      );
    },
  );

  test.each(["On", "Off"])(
    "turning a rule %s is its own sentence",
    (to: string) => {
      const markdown: SloFeedMarkdown = getBurnRateRuleChangedFeedMarkdown({
        sloMarkdownLink: LINK,
        ruleName: "Fast burn",
        changes: [
          {
            column: "isEnabled",
            title: "Enabled",
            kind: SloFeedValueKind.Boolean,
            from: to === "On" ? "Off" : "On",
            to: to,
          },
        ],
      });

      expect(markdown.feedInfoInMarkdown).toBe(
        `🔥 Burn rate rule **Fast burn** on ${LINK} was ${to === "On" ? "enabled" : "disabled"}.`,
      );
    },
  );

  test("any other change is spelled out like an SLO update", () => {
    const markdown: SloFeedMarkdown = getBurnRateRuleChangedFeedMarkdown({
      sloMarkdownLink: LINK,
      ruleName: "Fast burn",
      changes: [
        {
          column: "burnRateThreshold",
          title: "Burn rate threshold",
          kind: SloFeedValueKind.Multiplier,
          from: "14.4x",
          to: "10x",
        },
        {
          column: "alertTitleTemplate",
          title: "Alert title template",
          kind: SloFeedValueKind.Opaque,
          from: "_not set_",
          to: "_set_",
        },
      ],
    });

    expect(markdown.feedInfoInMarkdown).toBe(
      `🔥 Burn rate rule **Fast burn** on ${LINK} was updated: **Burn rate threshold** and **Alert title template** changed.`,
    );
    expect(markdown.moreInformationInMarkdown).toBe(
      "**Burn rate threshold**: 14.4x → 10x\n\n**Alert title template**: changed",
    );
  });

  test("a removed rule is described from the row read before it went", () => {
    const markdown: SloFeedMarkdown = getBurnRateRuleRemovedFeedMarkdown({
      sloMarkdownLink: LINK,
      rule: {
        name: "Slow burn",
        burnRateThreshold: 6,
        longWindowInMinutes: 360,
        shortWindowInMinutes: 30,
      },
    });

    expect(markdown.feedInfoInMarkdown).toBe(
      `🔥 Burn rate rule **Slow burn** was removed from ${LINK}.`,
    );
    expect(markdown.moreInformationInMarkdown).toBe(
      [
        "**Fires on**: burn rate above 6x over 6 hours, confirmed over 30 minutes",
        "Any alerts and incidents the rule had open were resolved.",
      ].join("\n\n"),
    );
  });

  test.each(HOSTILE_NAMES)(
    "a rule named %p stays inside its bold name",
    (name: string) => {
      for (const markdown of [
        getBurnRateRuleAddedFeedMarkdown({
          sloMarkdownLink: LINK,
          rule: { name: name },
        }),
        getBurnRateRuleRemovedFeedMarkdown({
          sloMarkdownLink: LINK,
          rule: { name: name },
        }),
      ]) {
        const boldName: string = markdown.feedInfoInMarkdown
          .replace("🔥 Burn rate rule **", "")
          .replace(/\*\* was (added to|removed from) .*$/, "");

        expectInert(boldName);
      }
    },
  );

  test("a nameless rule is still identifiable", () => {
    expect(
      getBurnRateRuleAddedFeedMarkdown({ sloMarkdownLink: LINK, rule: {} })
        .feedInfoInMarkdown,
    ).toBe(`🔥 Burn rate rule **Unnamed rule** was added to ${LINK}.`);
  });
});
