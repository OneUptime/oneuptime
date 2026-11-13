import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_TIME_WINDOW_MINUTES,
  ENGINE_FALLBACK_TIME_WINDOW_MINUTES,
  EPISODE_OWNERS_FIELD_KEY,
  EPISODE_OWNER_TEAMS_COLUMN,
  EPISODE_OWNER_USERS_COLUMN,
  GROUPING_MODE_FIELD_KEY,
  GROUPING_MODE_OPTIONS,
  GROUPING_RULE_COPY,
  GROUPING_RULE_TEMPLATES,
  GROUPING_SUMMARY_COPY,
  GROUP_BY_FIELD_NAMES,
  GroupByFieldNames,
  GroupingMode,
  GroupingModeOption,
  GroupingRuleKind,
  GroupingRuleSummary,
  GroupingRuleTemplate,
  GroupingRuleTranslateFunction,
  GroupingRuleValues,
  LEGACY_DEFAULT_ASSIGNEE_FIELD_KEY,
  LEGACY_DEFAULT_ASSIGNEE_TEAM_COLUMN,
  LEGACY_DEFAULT_ASSIGNEE_USER_COLUMN,
  LegacyDefaultAssigneeAction,
  MAX_SETTING_MINUTES,
  MINUTES_VALIDATION_MESSAGE,
  COUNT_VALIDATION_MESSAGE,
  DEFAULT_MINIMUM_COUNT,
  MAX_MINIMUM_COUNT,
  MIN_MINIMUM_COUNT,
  MINIMUM_COUNT_FIELD_NAMES,
  MinimumCountFieldNames,
  getEffectiveMinimumCount,
  getMinimumCountDisplay,
  getMinimumCountFoldedValue,
  getMinimumCountValidationError,
  getMinimumCountValues,
  parseMinimumCount,
  formatGroupingDuration,
  getDefaultTimeWindowMinutes,
  getEffectiveTimeWindowMinutes,
  getGroupByValuesForMode,
  getGroupingMode,
  getGroupingRuleSummary,
  getGroupingRuleSummarySelect,
  getGroupingRuleSummaryText,
  getGroupingRuleTemplate,
  getGroupingRuleUiStrings,
  getLegacyDefaultAssignee,
  getMinutesSettingDisplay,
  getGroupingRuleMoreFieldsSummary,
  getMinutesSettingFoldedValue,
  getMinutesSettingValues,
  getMinutesValidationError,
  getNewGroupingRuleValues,
  getSelectedGroupingMode,
  getSuggestedRuleName,
  getTemplateRuleValues,
  getValuesForGroupingModeChange,
  getValuesForLegacyDefaultAssigneeChange,
  isGroupingMode,
  isLegacyDefaultAssigneeChange,
  isSuggestedRuleName,
  parseMinutes,
} from "../../FeatureSet/Dashboard/src/Utils/GroupingRule/GroupingRuleSetup";
import ObjectID from "Common/Types/ObjectID";

/*
 * "The incident grouping rules are extremely hard to understand and use for
 * people. How can we make this simple?"
 *
 * The Incident and Alert Grouping Rules pages now ask one question - group by
 * monitor, everything together, connected services, severity, title, or a
 * custom mix - instead of six switches, add five ready-made rules in one
 * click, and say what each rule does in words. All of that is decided by the
 * React-free module pinned here. The rule's columns, and the engines that
 * read them, are unchanged; so the properties that matter most are that the
 * one-question view of a rule is a faithful view of its six switches, and
 * that opening an existing rule and saving it changes nothing.
 */

const KINDS: Array<GroupingRuleKind> = [
  GroupingRuleKind.Incident,
  GroupingRuleKind.Alert,
];

// The English text, with {{placeholders}} filled in - what an untranslated page shows.
const english: GroupingRuleTranslateFunction = (
  text: string,
  values?: Record<string, string | number> | undefined,
): string => {
  return text.replace(
    /\{\{\s*([\w.]+)\s*\}\}/g,
    (match: string, key: string): string => {
      return values && key in values ? String(values[key]) : match;
    },
  );
};

// A stand-in language: every sentence comes back marked, placeholders filled.
const marked: GroupingRuleTranslateFunction = (
  text: string,
  values?: Record<string, string | number> | undefined,
): string => {
  return `«${english(text, values)}»`;
};

// Every combination of the six group-by switches, for one kind.
function everySwitchCombination(
  kind: GroupingRuleKind,
): Array<Record<string, boolean>> {
  const names: GroupByFieldNames = GROUP_BY_FIELD_NAMES[kind];
  const fields: Array<string> = [
    names.monitor,
    names.severity,
    names.title,
    names.labels,
    names.monitorLabels,
    names.connectedServices,
  ];
  const combinations: Array<Record<string, boolean>> = [];

  for (let mask: number = 0; mask < 64; mask++) {
    const values: Record<string, boolean> = {};

    fields.forEach((field: string, index: number): void => {
      values[field] = (mask & (1 << index)) !== 0;
    });

    combinations.push(values);
  }

  return combinations;
}

function countOn(values: Record<string, boolean>): number {
  return Object.values(values).filter(Boolean).length;
}

describe("the group-by switches each model has", () => {
  test("incidents and alerts name their title and label switches after what they group", () => {
    expect(GROUP_BY_FIELD_NAMES[GroupingRuleKind.Incident]).toEqual({
      monitor: "groupByMonitor",
      severity: "groupBySeverity",
      title: "groupByIncidentTitle",
      labels: "groupByIncidentLabels",
      monitorLabels: "groupByMonitorLabels",
      connectedServices: "groupByConnectedServices",
    });
    expect(GROUP_BY_FIELD_NAMES[GroupingRuleKind.Alert]).toEqual({
      monitor: "groupByMonitor",
      severity: "groupBySeverity",
      title: "groupByAlertTitle",
      labels: "groupByAlertLabels",
      monitorLabels: "groupByMonitorLabels",
      connectedServices: "groupByConnectedServices",
    });
  });
});

describe("getGroupingMode", () => {
  test.each(KINDS)(
    "%s: reads every one of the 64 switch combinations",
    (kind: GroupingRuleKind) => {
      const names: GroupByFieldNames = GROUP_BY_FIELD_NAMES[kind];

      for (const values of everySwitchCombination(kind)) {
        const on: number = countOn(values);
        let expected: GroupingMode = GroupingMode.Custom;

        if (on === 0) {
          expected = GroupingMode.Everything;
        } else if (on === 1 && values[names.monitor]) {
          expected = GroupingMode.Monitor;
        } else if (on === 1 && values[names.severity]) {
          expected = GroupingMode.Severity;
        } else if (on === 1 && values[names.title]) {
          expected = GroupingMode.Title;
        } else if (on === 1 && values[names.connectedServices]) {
          expected = GroupingMode.ConnectedServices;
        }

        expect({ values, mode: getGroupingMode(values, kind) }).toEqual({
          values,
          mode: expected,
        });
      }
    },
  );

  test("a rule with no switches loaded reads as everything together, as the engines group it", () => {
    expect(getGroupingMode({}, GroupingRuleKind.Incident)).toBe(
      GroupingMode.Everything,
    );
  });

  test("only a switch that is on counts", () => {
    expect(
      getGroupingMode(
        {
          groupByMonitor: true,
          groupBySeverity: false,
          groupByIncidentTitle: null,
        },
        GroupingRuleKind.Incident,
      ),
    ).toBe(GroupingMode.Monitor);
  });

  test("labels on their own have no card of their own, so they are custom", () => {
    expect(
      getGroupingMode(
        { groupByIncidentLabels: true },
        GroupingRuleKind.Incident,
      ),
    ).toBe(GroupingMode.Custom);
    expect(
      getGroupingMode({ groupByMonitorLabels: true }, GroupingRuleKind.Alert),
    ).toBe(GroupingMode.Custom);
  });

  test("reads the alert switches for an alert rule, not the incident ones", () => {
    expect(
      getGroupingMode({ groupByIncidentTitle: true }, GroupingRuleKind.Alert),
    ).toBe(GroupingMode.Everything);
    expect(
      getGroupingMode({ groupByAlertTitle: true }, GroupingRuleKind.Alert),
    ).toBe(GroupingMode.Title);
  });
});

describe("getGroupByValuesForMode", () => {
  test.each(KINDS)(
    "%s: sets exactly one switch per named answer",
    (kind: GroupingRuleKind) => {
      const names: GroupByFieldNames = GROUP_BY_FIELD_NAMES[kind];

      expect(getGroupByValuesForMode(GroupingMode.Monitor, kind)).toEqual({
        [names.monitor]: true,
        [names.severity]: false,
        [names.title]: false,
        [names.labels]: false,
        [names.monitorLabels]: false,
        [names.connectedServices]: false,
      });
      expect(getGroupByValuesForMode(GroupingMode.Severity, kind)).toEqual({
        [names.monitor]: false,
        [names.severity]: true,
        [names.title]: false,
        [names.labels]: false,
        [names.monitorLabels]: false,
        [names.connectedServices]: false,
      });
      expect(getGroupByValuesForMode(GroupingMode.Title, kind)).toEqual({
        [names.monitor]: false,
        [names.severity]: false,
        [names.title]: true,
        [names.labels]: false,
        [names.monitorLabels]: false,
        [names.connectedServices]: false,
      });
      expect(getGroupByValuesForMode(GroupingMode.Everything, kind)).toEqual({
        [names.monitor]: false,
        [names.severity]: false,
        [names.title]: false,
        [names.labels]: false,
        [names.monitorLabels]: false,
        [names.connectedServices]: false,
      });
      expect(
        getGroupByValuesForMode(GroupingMode.ConnectedServices, kind),
      ).toEqual({
        [names.monitor]: false,
        [names.severity]: false,
        [names.title]: false,
        [names.labels]: false,
        [names.monitorLabels]: false,
        [names.connectedServices]: true,
      });
    },
  );

  test("custom leaves the switches to the person", () => {
    for (const kind of KINDS) {
      expect(getGroupByValuesForMode(GroupingMode.Custom, kind)).toBeNull();
    }
  });

  test.each(KINDS)(
    "%s: every named answer reads back as itself",
    (kind: GroupingRuleKind) => {
      for (const mode of [
        GroupingMode.Monitor,
        GroupingMode.Severity,
        GroupingMode.Title,
        GroupingMode.Everything,
        GroupingMode.ConnectedServices,
      ]) {
        expect(
          getGroupingMode(
            getGroupByValuesForMode(mode, kind) as GroupingRuleValues,
            kind,
          ),
        ).toBe(mode);
      }
    },
  );
});

describe("an existing rule keeps every switch it has", () => {
  test.each(KINDS)(
    "%s: re-picking the answer a rule's switches already give changes none of them",
    (kind: GroupingRuleKind) => {
      for (const values of everySwitchCombination(kind)) {
        const mode: GroupingMode = getGroupingMode(values, kind);
        const updates: GroupingRuleValues = getValuesForGroupingModeChange({
          values: { ...values, name: "Payments storms" },
          mode,
          kind,
          translate: english,
        });

        // Whatever the change touches, the switches end where they began.
        expect({ ...values, ...updates, name: undefined }).toEqual({
          ...values,
          name: undefined,
        });
        // And a name somebody typed is theirs.
        expect(updates["name"]).toBeUndefined();
      }
    },
  );

  test.each(KINDS)(
    "%s: a custom mix opens as Custom, and Custom keeps the mix",
    (kind: GroupingRuleKind) => {
      for (const values of everySwitchCombination(kind)) {
        if (getGroupingMode(values, kind) !== GroupingMode.Custom) {
          continue;
        }

        expect(
          getValuesForGroupingModeChange({
            values,
            mode: GroupingMode.Custom,
            kind,
            translate: english,
          }),
        ).toEqual({});
      }
    },
  );
});

describe("getSelectedGroupingMode", () => {
  test("what the person picked wins over what the switches spell", () => {
    expect(
      getSelectedGroupingMode(
        {
          groupByMonitor: true,
          [GROUPING_MODE_FIELD_KEY]: GroupingMode.Custom,
        },
        GroupingRuleKind.Incident,
      ),
    ).toBe(GroupingMode.Custom);
  });

  test("falls back to the switches when nothing (or nothing valid) was picked", () => {
    expect(
      getSelectedGroupingMode(
        { groupBySeverity: true },
        GroupingRuleKind.Incident,
      ),
    ).toBe(GroupingMode.Severity);
    expect(
      getSelectedGroupingMode(
        { groupBySeverity: true, [GROUPING_MODE_FIELD_KEY]: "by-color" },
        GroupingRuleKind.Incident,
      ),
    ).toBe(GroupingMode.Severity);
    expect(
      getSelectedGroupingMode(
        { groupBySeverity: true, [GROUPING_MODE_FIELD_KEY]: true },
        GroupingRuleKind.Alert,
      ),
    ).toBe(GroupingMode.Severity);
  });

  test("isGroupingMode knows the six answers and nothing else", () => {
    for (const mode of Object.values(GroupingMode)) {
      expect(isGroupingMode(mode)).toBe(true);
    }

    for (const value of [undefined, null, "", "Monitor", 1, true, {}]) {
      expect(isGroupingMode(value)).toBe(false);
    }
  });
});

describe("the ready-made rules", () => {
  test("there are five, one per named answer, in the order the page offers them", () => {
    expect(
      GROUPING_RULE_TEMPLATES.map((template: GroupingRuleTemplate) => {
        return [template.id, template.mode];
      }),
    ).toEqual([
      ["same-monitor", GroupingMode.Monitor],
      ["happen-together", GroupingMode.Everything],
      ["connected-services", GroupingMode.ConnectedServices],
      ["same-severity", GroupingMode.Severity],
      ["same-title", GroupingMode.Title],
    ]);
  });

  test("each has a distinct name and description for both products", () => {
    for (const kind of KINDS) {
      const names: Array<string> = GROUPING_RULE_TEMPLATES.map(
        (template: GroupingRuleTemplate): string => {
          return template.name[kind];
        },
      );
      const descriptions: Array<string> = GROUPING_RULE_TEMPLATES.map(
        (template: GroupingRuleTemplate): string => {
          return template.description[kind];
        },
      );

      expect(new Set(names).size).toBe(5);
      expect(new Set(descriptions).size).toBe(5);
    }
  });

  test("the incident copy talks about incidents and the alert copy about alerts", () => {
    for (const template of GROUPING_RULE_TEMPLATES) {
      expect(template.name[GroupingRuleKind.Incident]).toMatch(/incident/i);
      expect(template.name[GroupingRuleKind.Incident]).not.toMatch(/alert/i);
      expect(template.name[GroupingRuleKind.Alert]).toMatch(/alert/i);
      expect(template.name[GroupingRuleKind.Alert]).not.toMatch(/incident/i);
      expect(template.description[GroupingRuleKind.Alert]).not.toMatch(
        /incident/i,
      );
    }
  });

  test.each([
    ["same-monitor", 30, "30 minutes"],
    ["happen-together", 10, "10 minutes"],
    ["connected-services", 30, "30 minutes"],
    ["same-severity", 30, "30 minutes"],
    ["same-title", 60, "an hour"],
  ])(
    "%s groups within %i minutes, and its description says so",
    (id: string, minutes: number, words: string) => {
      const template: GroupingRuleTemplate | undefined =
        GROUPING_RULE_TEMPLATES.find((candidate: GroupingRuleTemplate) => {
          return candidate.id === id;
        });

      expect(template?.timeWindowMinutes).toBe(minutes);

      for (const kind of KINDS) {
        expect(template?.description[kind]).toContain(words);
      }
    },
  );

  test.each(KINDS)(
    "%s: adding a template saves an enabled rule with its answer and time window",
    (kind: GroupingRuleKind) => {
      for (const template of GROUPING_RULE_TEMPLATES) {
        expect(
          getTemplateRuleValues({ template, kind, translate: marked }),
        ).toEqual({
          name: `«${template.name[kind]}»`,
          isEnabled: true,
          ...getGroupByValuesForMode(template.mode, kind),
          enableTimeWindow: true,
          timeWindowMinutes: template.timeWindowMinutes,
        });
      }
    },
  );

  test("a template never presets the rule's place in the list", () => {
    for (const kind of KINDS) {
      for (const template of GROUPING_RULE_TEMPLATES) {
        expect(
          getTemplateRuleValues({ template, kind, translate: english }),
        ).not.toHaveProperty("priority");
      }
    }
  });

  test("getGroupingRuleTemplate finds each named answer's template, and none for custom", () => {
    expect(getGroupingRuleTemplate(GroupingMode.Monitor)?.id).toBe(
      "same-monitor",
    );
    expect(getGroupingRuleTemplate(GroupingMode.Everything)?.id).toBe(
      "happen-together",
    );
    expect(getGroupingRuleTemplate(GroupingMode.Severity)?.id).toBe(
      "same-severity",
    );
    expect(getGroupingRuleTemplate(GroupingMode.Title)?.id).toBe("same-title");
    expect(getGroupingRuleTemplate(GroupingMode.ConnectedServices)?.id).toBe(
      "connected-services",
    );
    expect(getGroupingRuleTemplate(GroupingMode.Custom)).toBeNull();
  });

  test("each answer starts with its template's time window", () => {
    expect(getDefaultTimeWindowMinutes(GroupingMode.Monitor)).toBe(30);
    expect(getDefaultTimeWindowMinutes(GroupingMode.Everything)).toBe(10);
    expect(getDefaultTimeWindowMinutes(GroupingMode.Severity)).toBe(30);
    expect(getDefaultTimeWindowMinutes(GroupingMode.Title)).toBe(60);
    expect(getDefaultTimeWindowMinutes(GroupingMode.ConnectedServices)).toBe(
      30,
    );
    expect(getDefaultTimeWindowMinutes(GroupingMode.Custom)).toBeNull();
  });
});

describe("the cards of the Group-by question", () => {
  test("offer the five answers and Custom, the recommended one first", () => {
    expect(
      GROUPING_MODE_OPTIONS.map((option: GroupingModeOption) => {
        return option.mode;
      }),
    ).toEqual([
      GroupingMode.Monitor,
      GroupingMode.Everything,
      GroupingMode.ConnectedServices,
      GroupingMode.Severity,
      GroupingMode.Title,
      GroupingMode.Custom,
    ]);
  });

  test("each card has a title, an icon and a description for both products", () => {
    for (const option of GROUPING_MODE_OPTIONS) {
      expect(option.title.length).toBeGreaterThan(0);
      expect(option.icon).toBeTruthy();

      for (const kind of KINDS) {
        expect(option.description[kind].length).toBeGreaterThan(10);
      }
    }
  });
});

describe("the suggested name", () => {
  test.each(KINDS)(
    "%s: is the template's name, in the reader's language",
    (kind: GroupingRuleKind) => {
      for (const template of GROUPING_RULE_TEMPLATES) {
        expect(
          getSuggestedRuleName({
            mode: template.mode,
            kind,
            translate: marked,
          }),
        ).toBe(`«${template.name[kind]}»`);
      }

      expect(
        getSuggestedRuleName({
          mode: GroupingMode.Custom,
          kind,
          translate: marked,
        }),
      ).toBeNull();
    },
  );

  test("recognises a suggestion in English or in the reader's language, trimmed", () => {
    const name: string =
      GROUPING_RULE_TEMPLATES[1]!.name[GroupingRuleKind.Incident];

    expect(
      isSuggestedRuleName({
        name,
        kind: GroupingRuleKind.Incident,
        translate: marked,
      }),
    ).toBe(true);
    expect(
      isSuggestedRuleName({
        name: `  «${name}» `,
        kind: GroupingRuleKind.Incident,
        translate: marked,
      }),
    ).toBe(true);
  });

  test("does not mistake a typed name, another product's suggestion or a non-string for one", () => {
    expect(
      isSuggestedRuleName({
        name: "Payments storms",
        kind: GroupingRuleKind.Incident,
        translate: english,
      }),
    ).toBe(false);
    expect(
      isSuggestedRuleName({
        name: GROUPING_RULE_TEMPLATES[0]!.name[GroupingRuleKind.Alert],
        kind: GroupingRuleKind.Incident,
        translate: english,
      }),
    ).toBe(false);
    expect(
      isSuggestedRuleName({
        name: undefined,
        kind: GroupingRuleKind.Incident,
        translate: english,
      }),
    ).toBe(false);
  });
});

describe("getValuesForGroupingModeChange", () => {
  const kind: GroupingRuleKind = GroupingRuleKind.Incident;

  function startingRule(extra?: GroupingRuleValues): GroupingRuleValues {
    return {
      ...getNewGroupingRuleValues({ kind, translate: english }),
      ...extra,
    };
  }

  test("moves the switches, the suggested name and the untouched time window to the new answer", () => {
    expect(
      getValuesForGroupingModeChange({
        values: startingRule(),
        mode: GroupingMode.Everything,
        kind,
        translate: english,
      }),
    ).toEqual({
      ...getGroupByValuesForMode(GroupingMode.Everything, kind),
      name: "Group incidents that happen together",
      timeWindowMinutes: 10,
    });
  });

  test("keeps a name somebody typed", () => {
    expect(
      getValuesForGroupingModeChange({
        values: startingRule({ name: "Payments" }),
        mode: GroupingMode.Severity,
        kind,
        translate: english,
      })["name"],
    ).toBeUndefined();
  });

  test("names an unnamed rule", () => {
    for (const name of [undefined, "", "   "]) {
      expect(
        getValuesForGroupingModeChange({
          values: startingRule({ name }),
          mode: GroupingMode.Title,
          kind,
          translate: english,
        })["name"],
      ).toBe("Group repeats of the same incident");
    }
  });

  test("a suggestion in the reader's language follows the answer too", () => {
    expect(
      getValuesForGroupingModeChange({
        values: startingRule({
          name: "«Group incidents from the same monitor»",
        }),
        mode: GroupingMode.Severity,
        kind,
        translate: marked,
      })["name"],
    ).toBe("«Group incidents by severity»");
  });

  test("Custom keeps the name, the switches and the time window", () => {
    expect(
      getValuesForGroupingModeChange({
        values: startingRule(),
        mode: GroupingMode.Custom,
        kind,
        translate: english,
      }),
    ).toEqual({});
  });

  test("keeps a time window somebody set", () => {
    expect(
      getValuesForGroupingModeChange({
        values: startingRule({ timeWindowMinutes: 45 }),
        mode: GroupingMode.Everything,
        kind,
        translate: english,
      }),
    ).not.toHaveProperty("timeWindowMinutes");
  });

  test("leaves a switched-off time window alone", () => {
    expect(
      getValuesForGroupingModeChange({
        values: startingRule({ enableTimeWindow: false }),
        mode: GroupingMode.Everything,
        kind,
        translate: english,
      }),
    ).not.toHaveProperty("timeWindowMinutes");
  });

  test("fills in a switched-on time window with no usable minutes", () => {
    for (const timeWindowMinutes of [undefined, "", "0", 0]) {
      expect(
        getValuesForGroupingModeChange({
          values: startingRule({ timeWindowMinutes }),
          mode: GroupingMode.Title,
          kind,
          translate: english,
        })["timeWindowMinutes"],
      ).toBe(60);
    }
  });

  test("compares against the answer that was picked, not the one the switches spell", () => {
    // Custom with only monitor on: the half hour is not Custom's to move.
    expect(
      getValuesForGroupingModeChange({
        values: startingRule({
          [GROUPING_MODE_FIELD_KEY]: GroupingMode.Custom,
        }),
        mode: GroupingMode.Everything,
        kind,
        translate: english,
      }),
    ).not.toHaveProperty("timeWindowMinutes");
  });

  test("changes alert switches for an alert rule", () => {
    const updates: GroupingRuleValues = getValuesForGroupingModeChange({
      values: getNewGroupingRuleValues({
        kind: GroupingRuleKind.Alert,
        translate: english,
      }),
      mode: GroupingMode.Title,
      kind: GroupingRuleKind.Alert,
      translate: english,
    });

    expect(updates["groupByAlertTitle"]).toBe(true);
    expect(updates).not.toHaveProperty("groupByIncidentTitle");
    expect(updates["name"]).toBe("Group repeats of the same alert");
  });
});

describe("getNewGroupingRuleValues", () => {
  test.each(KINDS)(
    "%s: a blank rule starts enabled, grouping by monitor within half an hour",
    (kind: GroupingRuleKind) => {
      expect(getNewGroupingRuleValues({ kind, translate: marked })).toEqual({
        name: `«${GROUPING_RULE_TEMPLATES[0]!.name[kind]}»`,
        isEnabled: true,
        ...getGroupByValuesForMode(GroupingMode.Monitor, kind),
        enableTimeWindow: true,
        timeWindowMinutes: DEFAULT_TIME_WINDOW_MINUTES,
      });
    },
  );

  test("regression: a new rule is never created switched off", () => {
    for (const kind of KINDS) {
      expect(
        getNewGroupingRuleValues({ kind, translate: english })["isEnabled"],
      ).toBe(true);
    }
  });

  test("never presets the rule's place in the list", () => {
    expect(
      getNewGroupingRuleValues({
        kind: GroupingRuleKind.Incident,
        translate: english,
      }),
    ).not.toHaveProperty("priority");
  });
});

describe("parseMinutes", () => {
  test.each([
    [1, 1],
    [30, 30],
    [MAX_SETTING_MINUTES, MAX_SETTING_MINUTES],
    ["45", 45],
    [" 12 ", 12],
    ["0045", 45],
  ])("reads %j as %j", (value: unknown, expected: number) => {
    expect(parseMinutes(value)).toBe(expected);
  });

  test.each([
    [0],
    [-5],
    [1.5],
    [MAX_SETTING_MINUTES + 1],
    [NaN],
    [Infinity],
    [""],
    ["  "],
    ["0"],
    ["-3"],
    ["1.5"],
    ["1e3"],
    ["30 minutes"],
    [null],
    [undefined],
    [true],
    [{}],
  ])("refuses %j", (value: unknown) => {
    expect(parseMinutes(value)).toBeNull();
  });
});

describe("getMinutesValidationError", () => {
  test("a switched-off setting is never checked - the engines do not read its minutes", () => {
    for (const minutes of [undefined, "", 0, "abc", -1]) {
      for (const enabled of [false, undefined, null, "true"]) {
        expect(
          getMinutesValidationError({ enabled, minutes, translate: english }),
        ).toBeNull();
      }
    }
  });

  test("a switched-on setting needs whole minutes in range in its box", () => {
    expect(
      getMinutesValidationError({
        enabled: true,
        minutes: 30,
        translate: english,
      }),
    ).toBeNull();
    expect(
      getMinutesValidationError({
        enabled: true,
        minutes: "30",
        translate: english,
      }),
    ).toBeNull();

    // Typed into the box: the box hands over anything but a whole number as text.
    for (const minutes of [
      "",
      "0",
      "-5",
      "1.5",
      "abc",
      String(MAX_SETTING_MINUTES + 1),
    ]) {
      expect(
        getMinutesValidationError({
          enabled: true,
          minutes,
          translate: english,
        }),
      ).toBe(
        `Enter a whole number of minutes between 1 and ${MAX_SETTING_MINUTES}.`,
      );
    }
  });

  test("a value a rule was saved with is never refused - the engines fall back on it", () => {
    /*
     * The old form saved 0 when a switch was ticked and its box left empty,
     * and the API takes any whole number. Refusing those would stop somebody
     * renaming a rule that has worked the same way for years.
     */
    for (const minutes of [undefined, null, 0, -3, MAX_SETTING_MINUTES + 1]) {
      expect(
        getMinutesValidationError({
          enabled: true,
          minutes,
          translate: english,
        }),
      ).toBeNull();
    }
  });

  test("a stored value that is not a whole number is refused", () => {
    expect(
      getMinutesValidationError({
        enabled: true,
        minutes: 1.5,
        translate: english,
      }),
    ).not.toBeNull();
  });

  test("the message is translated whole, with the limit filled in", () => {
    expect(
      getMinutesValidationError({
        enabled: true,
        minutes: "",
        translate: marked,
      }),
    ).toBe(
      `«${english(MINUTES_VALIDATION_MESSAGE, { max: MAX_SETTING_MINUTES })}»`,
    );
  });
});

describe("getMinutesSettingDisplay", () => {
  test("shows a switched-off setting off, with its saved minutes", () => {
    expect(
      getMinutesSettingDisplay({
        enabled: false,
        minutes: 45,
        fallbackMinutes: 60,
      }),
    ).toEqual({ enabled: false, minutes: 45 });
    expect(
      getMinutesSettingDisplay({
        enabled: undefined,
        minutes: undefined,
        fallbackMinutes: null,
      }),
    ).toEqual({ enabled: false, minutes: undefined });
  });

  test("shows a switched-on setting with usable minutes as it is", () => {
    expect(
      getMinutesSettingDisplay({
        enabled: true,
        minutes: 15,
        fallbackMinutes: null,
      }),
    ).toEqual({ enabled: true, minutes: 15 });
    expect(
      getMinutesSettingDisplay({
        enabled: true,
        minutes: MAX_SETTING_MINUTES + 1,
        fallbackMinutes: null,
      }),
    ).toEqual({ enabled: true, minutes: MAX_SETTING_MINUTES + 1 });
  });

  test("shows whatever is being typed, so the box never jumps under the cursor", () => {
    for (const minutes of ["", "0", "4", "abc"]) {
      expect(
        getMinutesSettingDisplay({
          enabled: true,
          minutes,
          fallbackMinutes: 60,
        }),
      ).toEqual({ enabled: true, minutes });
    }
  });

  test("a time window saved on with no minutes shows the engines' hour", () => {
    for (const minutes of [undefined, null, 0, -1]) {
      expect(
        getMinutesSettingDisplay({
          enabled: true,
          minutes,
          fallbackMinutes: ENGINE_FALLBACK_TIME_WINDOW_MINUTES,
        }),
      ).toEqual({ enabled: true, minutes: 60 });
    }
  });

  test("a lifecycle switch saved on with no minutes shows off, as the engines treat it", () => {
    for (const minutes of [undefined, null, 0, -1]) {
      expect(
        getMinutesSettingDisplay({
          enabled: true,
          minutes,
          fallbackMinutes: null,
        }),
      ).toEqual({ enabled: false, minutes });
    }
  });
});

describe("getMinutesSettingValues", () => {
  test("keeps usable minutes as a number", () => {
    expect(
      getMinutesSettingValues({
        enabled: true,
        minutes: "15",
        defaultMinutes: 30,
      }),
    ).toEqual({ enabled: true, minutes: 15 });
    expect(
      getMinutesSettingValues({
        enabled: false,
        minutes: 15,
        defaultMinutes: 30,
      }),
    ).toEqual({ enabled: false, minutes: 15 });
  });

  test("keeps what was typed while the setting is on, so validation can say what is wrong", () => {
    expect(
      getMinutesSettingValues({
        enabled: true,
        minutes: "",
        defaultMinutes: 30,
      }),
    ).toEqual({ enabled: true, minutes: "" });
    expect(
      getMinutesSettingValues({
        enabled: true,
        minutes: "0",
        defaultMinutes: 30,
      }),
    ).toEqual({ enabled: true, minutes: "0" });
  });

  test("starts a setting turned on with nothing in it from its default", () => {
    expect(
      getMinutesSettingValues({
        enabled: true,
        minutes: undefined,
        defaultMinutes: 5,
      }),
    ).toEqual({ enabled: true, minutes: 5 });
  });

  test("never leaves a cleared box to be saved into the column once the setting is off", () => {
    for (const minutes of ["", "0", undefined, null, -2]) {
      expect(
        getMinutesSettingValues({
          enabled: false,
          minutes,
          defaultMinutes: 60,
        }),
      ).toEqual({ enabled: false, minutes: 60 });
    }
  });
});

describe("formatGroupingDuration", () => {
  test.each([
    [1, "1 minute"],
    [2, "2 minutes"],
    [45, "45 minutes"],
    [59, "59 minutes"],
    [60, "1 hour"],
    [90, "90 minutes"],
    [120, "2 hours"],
    [1500, "25 hours"],
    [1440, "1 day"],
    [2880, "2 days"],
    [4320, "3 days"],
  ])("%i minutes reads %j", (minutes: number, text: string) => {
    expect(formatGroupingDuration({ minutes, translate: english })).toBe(text);
  });

  test("uses the Dashboard's shared duration phrases, translated whole", () => {
    expect(formatGroupingDuration({ minutes: 1, translate: marked })).toBe(
      `«${GROUPING_SUMMARY_COPY.minute}»`,
    );
    expect(formatGroupingDuration({ minutes: 180, translate: marked })).toBe(
      "«3 hours»",
    );
  });
});

describe("getEffectiveTimeWindowMinutes", () => {
  test("a switched-off time window is no time window", () => {
    expect(
      getEffectiveTimeWindowMinutes({
        enableTimeWindow: false,
        timeWindowMinutes: 30,
      }),
    ).toBeNull();
    expect(getEffectiveTimeWindowMinutes({})).toBeNull();
  });

  test("a switched-on one is its minutes, with the engines' own fallback for none", () => {
    expect(
      getEffectiveTimeWindowMinutes({
        enableTimeWindow: true,
        timeWindowMinutes: 15,
      }),
    ).toBe(15);

    for (const timeWindowMinutes of [undefined, null, 0, "abc"]) {
      expect(
        getEffectiveTimeWindowMinutes({
          enableTimeWindow: true,
          timeWindowMinutes,
        }),
      ).toBe(ENGINE_FALLBACK_TIME_WINDOW_MINUTES);
    }

    expect(ENGINE_FALLBACK_TIME_WINDOW_MINUTES).toBe(60);
  });
});

describe("getGroupingRuleSummary", () => {
  function summarize(
    rule: GroupingRuleValues,
    kind: GroupingRuleKind = GroupingRuleKind.Incident,
  ): GroupingRuleSummary {
    return getGroupingRuleSummary({ rule, kind, translate: english });
  }

  test("a rule from each template reads in plain words", () => {
    const kind: GroupingRuleKind = GroupingRuleKind.Incident;

    const rules: Array<GroupingRuleValues> = GROUPING_RULE_TEMPLATES.map(
      (template: GroupingRuleTemplate): GroupingRuleValues => {
        return getTemplateRuleValues({ template, kind, translate: english });
      },
    );

    expect(
      rules.map((rule: GroupingRuleValues) => {
        return summarize(rule);
      }),
    ).toEqual([
      {
        grouping: "One episode per monitor",
        timing:
          "New incidents join while they arrive within 30 minutes of the last one",
        details: [],
      },
      {
        grouping: "All matching incidents share one episode",
        timing:
          "New incidents join while they arrive within 10 minutes of the last one",
        details: [],
      },
      {
        grouping: "Incidents on connected services share one episode",
        timing:
          "New incidents join while they arrive within 30 minutes of the last one",
        details: [],
      },
      {
        grouping: "One episode per severity",
        timing:
          "New incidents join while they arrive within 30 minutes of the last one",
        details: [],
      },
      {
        grouping: "One episode per title",
        timing:
          "New incidents join while they arrive within 1 hour of the last one",
        details: [],
      },
    ]);
  });

  test("speaks about alerts on the alert page", () => {
    expect(
      summarize(
        { enableTimeWindow: false, groupByAlertTitle: false },
        GroupingRuleKind.Alert,
      ),
    ).toEqual({
      grouping: "All matching alerts share one episode",
      timing: "New alerts keep joining until the episode is resolved",
      details: [],
    });
  });

  test("a rule without a time window keeps taking incidents until its episode resolves", () => {
    expect(summarize({ groupByMonitor: true }).timing).toBe(
      "New incidents keep joining until the episode is resolved",
    );
  });

  test("a time window switched on with no minutes reads as the engines' hour", () => {
    expect(
      summarize({ enableTimeWindow: true, timeWindowMinutes: 0 }).timing,
    ).toBe(
      "New incidents join while they arrive within 1 hour of the last one",
    );
  });

  test("a custom mix lists its switches by their own names, in a fixed order", () => {
    expect(
      summarize({
        groupByMonitorLabels: true,
        groupByIncidentTitle: true,
        groupByMonitor: true,
      }).grouping,
    ).toBe("One episode per combination of: Monitor, Title, Monitor Labels");
    expect(
      summarize({
        groupByMonitor: true,
        groupBySeverity: true,
        groupByIncidentTitle: true,
        groupByIncidentLabels: true,
        groupByMonitorLabels: true,
      }).grouping,
    ).toBe(
      "One episode per combination of: Monitor, Severity, Title, Incident Labels, Monitor Labels",
    );
    expect(summarize({ groupByIncidentLabels: true }).grouping).toBe(
      "One episode per combination of: Incident Labels",
    );
    expect(
      summarize({ groupByAlertLabels: true }, GroupingRuleKind.Alert).grouping,
    ).toBe("One episode per combination of: Alert Labels");
    // Connected services last, as the Group By step draws it.
    expect(
      summarize({ groupByConnectedServices: true, groupBySeverity: true })
        .grouping,
    ).toBe("One episode per combination of: Severity, Connected Services");
  });

  test("connected services on their own read as the card says, for each product", () => {
    expect(summarize({ groupByConnectedServices: true }).grouping).toBe(
      "Incidents on connected services share one episode",
    );
    expect(
      summarize({ groupByConnectedServices: true }, GroupingRuleKind.Alert)
        .grouping,
    ).toBe("Alerts on connected services share one episode");
  });

  test("notes the lifecycle settings that are on, and only those", () => {
    expect(
      summarize({
        groupByMonitor: true,
        enableReopenWindow: true,
        reopenWindowMinutes: 30,
        enableResolveDelay: true,
        resolveDelayMinutes: 5,
        enableInactivityTimeout: true,
        inactivityTimeoutMinutes: 120,
      }).details,
    ).toEqual([
      "Reopens episodes resolved in the last 30 minutes",
      "Waits 5 minutes before resolving",
      "Resolves after 2 hours without new incidents",
    ]);
  });

  test("a setting that is off, or on with no minutes, is not noted - the engines ignore it too", () => {
    expect(
      summarize({
        enableReopenWindow: false,
        reopenWindowMinutes: 30,
        enableResolveDelay: true,
        resolveDelayMinutes: 0,
        enableInactivityTimeout: true,
        inactivityTimeoutMinutes: undefined,
      }).details,
    ).toEqual([]);
  });

  test("notes paging and status pages", () => {
    expect(
      summarize({
        onCallDutyPolicies: [{ _id: "a" }],
        showEpisodeOnStatusPage: true,
      }).details,
    ).toEqual(["Runs 1 on-call policy", "Shows episodes on status pages"]);
    expect(
      summarize({
        onCallDutyPolicies: [{ _id: "a" }, { _id: "b" }, { _id: "c" }],
      }).details,
    ).toEqual(["Runs 3 on-call policies"]);
    expect(summarize({ onCallDutyPolicies: [] }).details).toEqual([]);
  });

  test("the alert page notes quiet episodes in alerts", () => {
    expect(
      summarize(
        { enableInactivityTimeout: true, inactivityTimeoutMinutes: 60 },
        GroupingRuleKind.Alert,
      ).details,
    ).toEqual(["Resolves after 1 hour without new alerts"]);
  });

  test("every phrase is translated whole", () => {
    expect(
      getGroupingRuleSummary({
        rule: {
          groupByMonitor: true,
          enableTimeWindow: true,
          timeWindowMinutes: 30,
          onCallDutyPolicies: [{ _id: "a" }, { _id: "b" }],
        },
        kind: GroupingRuleKind.Incident,
        translate: marked,
      }),
    ).toEqual({
      grouping: "«One episode per monitor»",
      timing:
        "«New incidents join while they arrive within «30 minutes» of the last one»",
      details: ["«Runs 2 on-call policies»"],
    });
  });

  test("the CSV cell is the same words in one line", () => {
    expect(
      getGroupingRuleSummaryText({
        rule: {
          groupBySeverity: true,
          enableTimeWindow: true,
          timeWindowMinutes: 15,
          showEpisodeOnStatusPage: true,
        },
        kind: GroupingRuleKind.Incident,
        translate: english,
      }),
    ).toBe(
      "One episode per severity. New incidents join while they arrive within 15 minutes of the last one. Shows episodes on status pages",
    );
  });
});

describe("getGroupingRuleSummarySelect", () => {
  test.each(KINDS)(
    "%s: selects every column the summary reads",
    (kind: GroupingRuleKind) => {
      const select: Record<string, unknown> =
        getGroupingRuleSummarySelect(kind);
      const names: GroupByFieldNames = GROUP_BY_FIELD_NAMES[kind];

      for (const column of [
        names.monitor,
        names.severity,
        names.title,
        names.labels,
        names.monitorLabels,
        "enableTimeWindow",
        "timeWindowMinutes",
        "enableReopenWindow",
        "reopenWindowMinutes",
        "enableResolveDelay",
        "resolveDelayMinutes",
        "enableInactivityTimeout",
        "inactivityTimeoutMinutes",
        MINIMUM_COUNT_FIELD_NAMES[kind].enabled,
        MINIMUM_COUNT_FIELD_NAMES[kind].count,
      ]) {
        expect(select[column]).toBe(true);
      }

      expect(select["onCallDutyPolicies"]).toEqual({ _id: true });
      expect(select).not.toHaveProperty("priority");
    },
  );

  test("only the incident model has a status page switch to read", () => {
    expect(
      getGroupingRuleSummarySelect(GroupingRuleKind.Incident)[
        "showEpisodeOnStatusPage"
      ],
    ).toBe(true);
    expect(
      getGroupingRuleSummarySelect(GroupingRuleKind.Alert),
    ).not.toHaveProperty("showEpisodeOnStatusPage");
  });
});

/*
 * What a lifecycle setting - reopen recently resolved episodes, wait before
 * resolving one, resolve quiet ones - says on the folded header of the
 * rule's More fields: its minutes while the engines act on it, nothing
 * otherwise. It must agree with what the switch shows
 * (getMinutesSettingDisplay), so a chip never says a setting is on that the
 * opened fold shows off, or the other way round.
 */
describe("getMinutesSettingFoldedValue", () => {
  const folded: (
    enabled: unknown,
    minutes: unknown,
    fallbackMinutes?: number | null,
  ) => string | null = (
    enabled: unknown,
    minutes: unknown,
    fallbackMinutes: number | null = null,
  ): string | null => {
    return getMinutesSettingFoldedValue({
      enabled,
      minutes,
      fallbackMinutes,
      translate: english,
    });
  };

  test("says the minutes of a setting that is on, the way the list's summary says them", () => {
    expect(folded(true, 30)).toBe("30 minutes");
    expect(folded(true, 1)).toBe("1 minute");
    expect(folded(true, 60)).toBe("1 hour");
    expect(folded(true, 240)).toBe("4 hours");
    expect(folded(true, 1440)).toBe("1 day");
    expect(folded(true, 2880)).toBe("2 days");
    expect(folded(true, 90)).toBe("90 minutes");
    expect(folded(true, MAX_SETTING_MINUTES)).toBe("365 days");
  });

  test("says nothing for a setting that is off, whatever minutes it keeps", () => {
    expect(folded(false, 30)).toBeNull();
    expect(folded(undefined, 30)).toBeNull();
    expect(folded(null, undefined)).toBeNull();
    // Only true is on: the engines read the column the same way.
    expect(folded("true", 30)).toBeNull();
    expect(folded(1, 30)).toBeNull();
  });

  test("says nothing for a setting the old form saved on with no minutes - the engines skip it", () => {
    expect(folded(true, 0)).toBeNull();
    expect(folded(true, null)).toBeNull();
    expect(folded(true, undefined)).toBeNull();
    expect(folded(true, -5)).toBeNull();
  });

  test("says the engines' fallback for a setting that has one", () => {
    // The time window's hour: not folded today, but read the same way.
    expect(folded(true, 0, ENGINE_FALLBACK_TIME_WINDOW_MINUTES)).toBe("1 hour");
  });

  test("says minutes saved before the box had a ceiling, as the engines use them", () => {
    expect(folded(true, MAX_SETTING_MINUTES + 60)).toBe(
      english(GROUPING_SUMMARY_COPY.hours, {
        count: (MAX_SETTING_MINUTES + 60) / 60,
      }),
    );
  });

  test("names a setting switched on while its minutes are still being typed, without them", () => {
    expect(folded(true, "")).toBe("");
    expect(folded(true, "abc")).toBe("");
    expect(folded(true, "0")).toBe("");
    // A whole number typed is read like a stored one.
    expect(folded(true, "45")).toBe("45 minutes");
    expect(folded(true, " 120 ")).toBe("2 hours");
  });

  test("is in the reader's language", () => {
    expect(
      getMinutesSettingFoldedValue({
        enabled: true,
        minutes: 30,
        fallbackMinutes: null,
        translate: marked,
      }),
    ).toBe("«30 minutes»");
  });

  test.each([
    [true, 45],
    [true, 0],
    [false, 45],
    [true, "abc"],
    [true, "15"],
    [undefined, undefined],
    [true, MAX_SETTING_MINUTES + 1],
  ])(
    "agrees with what the switch shows for enabled %j and minutes %j",
    (enabled: unknown, minutes: unknown) => {
      const shown: boolean = getMinutesSettingDisplay({
        enabled,
        minutes,
        fallbackMinutes: null,
      }).enabled;

      expect(folded(enabled, minutes) !== null).toBe(shown);
    },
  );

  test("a blank rule and every template's rule have no lifecycle setting on", () => {
    for (const kind of KINDS) {
      const rules: Array<GroupingRuleValues> = [
        getNewGroupingRuleValues({ kind, translate: english }),
        ...GROUPING_RULE_TEMPLATES.map(
          (template: GroupingRuleTemplate): GroupingRuleValues => {
            return getTemplateRuleValues({
              template,
              kind,
              translate: english,
            });
          },
        ),
      ];

      for (const rule of rules) {
        for (const [enabledField, minutesField] of [
          ["enableReopenWindow", "reopenWindowMinutes"],
          ["enableResolveDelay", "resolveDelayMinutes"],
          ["enableInactivityTimeout", "inactivityTimeoutMinutes"],
        ] as Array<[string, string]>) {
          expect(folded(rule[enabledField], rule[minutesField])).toBeNull();
        }
      }
    }
  });
});

/*
 * The sentence under the folded More fields header while a rule still has
 * the old default assignee. The line that settles it is inside the fold,
 * which stays folded on an edit form, so the header says it is there.
 */
describe("getGroupingRuleMoreFieldsSummary", () => {
  const USER: string = "0000000e-0000-4000-8000-000000000001";
  const TEAM: string = "0000000b-0000-4000-8000-000000000001";

  test.each([
    ["a user", { defaultAssignToUserId: USER }],
    ["a team, as an ObjectID", { defaultAssignToTeamId: new ObjectID(TEAM) }],
    ["both", { defaultAssignToUserId: USER, defaultAssignToTeamId: TEAM }],
    ["a related row the API returned", { defaultAssignToUser: { _id: USER } }],
  ])(
    "says the rule still has one when it names %s",
    (_label: string, values: GroupingRuleValues) => {
      expect(getGroupingRuleMoreFieldsSummary(values)).toEqual([
        GROUPING_RULE_COPY.legacyAssigneeFoldedSummary,
      ]);
    },
  );

  test.each([
    ["a blank rule", {}],
    [
      "a settled one",
      { defaultAssignToUserId: null, defaultAssignToTeamId: null },
    ],
    ["owners only", { episodeOwnerUsers: [USER], episodeOwnerTeams: [TEAM] }],
    [
      "every other setting",
      {
        enableReopenWindow: true,
        reopenWindowMinutes: 30,
        onCallDutyPolicies: ["policy"],
        description: "Production payments",
      },
    ],
  ])("says nothing for %s", (_label: string, values: GroupingRuleValues) => {
    expect(getGroupingRuleMoreFieldsSummary(values)).toBeUndefined();
  });

  test("says nothing for a new rule of either kind, or a template's", () => {
    for (const kind of KINDS) {
      expect(
        getGroupingRuleMoreFieldsSummary(
          getNewGroupingRuleValues({ kind, translate: english }),
        ),
      ).toBeUndefined();

      for (const template of GROUPING_RULE_TEMPLATES) {
        expect(
          getGroupingRuleMoreFieldsSummary(
            getTemplateRuleValues({ template, kind, translate: english }),
          ),
        ).toBeUndefined();
      }
    }
  });

  test("is one whole sentence pair that says where to settle it, in the copy every locale translates", () => {
    const sentence: string = GROUPING_RULE_COPY.legacyAssigneeFoldedSummary;

    expect(sentence).toContain("default assignee");
    expect(sentence).toContain("older version of this form");
    expect(sentence).toContain("Open this section");
    expect(sentence).toContain("add them as owners or remove it");
    expect(getGroupingRuleUiStrings()).toContain(sentence);
  });
});

describe("getGroupingRuleUiStrings", () => {
  const strings: Array<string> = getGroupingRuleUiStrings();

  test("lists each string once", () => {
    expect(new Set(strings).size).toBe(strings.length);
  });

  test("covers the copy, the cards, the templates, the summary and the validation message", () => {
    expect(strings).toEqual(
      expect.arrayContaining([
        GROUPING_RULE_COPY.cardDescription[GroupingRuleKind.Incident],
        GROUPING_RULE_COPY.cardDescription[GroupingRuleKind.Alert],
        GROUPING_RULE_COPY.reopenWindowTitle,
        GROUPING_MODE_OPTIONS[1]!.title,
        GROUPING_RULE_TEMPLATES[3]!.description[GroupingRuleKind.Alert],
        GROUPING_SUMMARY_COPY.perCombination,
        GROUPING_SUMMARY_COPY.resolvesWhenQuiet[GroupingRuleKind.Incident],
        MINUTES_VALIDATION_MESSAGE,
        GROUPING_RULE_COPY.minimumCountTitle[GroupingRuleKind.Incident],
        GROUPING_RULE_COPY.minimumCountTitle[GroupingRuleKind.Alert],
        GROUPING_RULE_COPY.minimumCountDescription[GroupingRuleKind.Incident],
        GROUPING_RULE_COPY.minimumCountSentence[GroupingRuleKind.Alert],
        GROUPING_RULE_COPY.minimumCountLabel[GroupingRuleKind.Incident],
        GROUPING_SUMMARY_COPY.opensOnceOngoing[GroupingRuleKind.Alert],
        GROUPING_SUMMARY_COPY.minimumCount[GroupingRuleKind.Incident],
        COUNT_VALIDATION_MESSAGE,
      ]),
    );
  });

  test("holds nothing but non-empty strings", () => {
    for (const text of strings) {
      expect(typeof text).toBe("string");
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  test("no longer holds the Show advanced settings switch, which More fields replaced", () => {
    expect(GROUPING_RULE_COPY).not.toHaveProperty("showAdvancedTitle");
    expect(GROUPING_RULE_COPY).not.toHaveProperty("showAdvancedDescription");

    for (const text of strings) {
      expect(text).not.toMatch(/advanced settings/i);
    }
  });
});

/*
 * Who owns the episodes a rule opens: Episode Owners, one people picker
 * kept in the rule's episodeOwnerUsers and episodeOwnerTeams. It replaced a
 * Default Assign To Team / User pair that nothing showed; a rule that still
 * has the pair is told so, and the line's two buttons settle it.
 */
describe("episode owners and the old default assignee", () => {
  const USER: string = "0000000e-0000-4000-8000-000000000001";
  const OTHER_USER: string = "0000000e-0000-4000-8000-000000000002";
  const TEAM: string = "0000000b-0000-4000-8000-000000000001";

  test("name the rule's own columns", () => {
    expect(EPISODE_OWNERS_FIELD_KEY).toBe("episodeOwners");
    expect(EPISODE_OWNER_USERS_COLUMN).toBe("episodeOwnerUsers");
    expect(EPISODE_OWNER_TEAMS_COLUMN).toBe("episodeOwnerTeams");
    expect(LEGACY_DEFAULT_ASSIGNEE_FIELD_KEY).toBe("legacyDefaultAssignee");
    expect(LEGACY_DEFAULT_ASSIGNEE_USER_COLUMN).toBe("defaultAssignToUserId");
    expect(LEGACY_DEFAULT_ASSIGNEE_TEAM_COLUMN).toBe("defaultAssignToTeamId");
  });

  test("a rule that still has the old pair is told so, and one that settled it is not", () => {
    expect(getLegacyDefaultAssignee({ defaultAssignToUserId: USER })).toEqual({
      userId: USER,
      teamId: null,
    });
    expect(
      getLegacyDefaultAssignee({ defaultAssignToTeamId: new ObjectID(TEAM) }),
    ).toEqual({ userId: null, teamId: TEAM });
    expect(
      getLegacyDefaultAssignee({
        defaultAssignToUserId: null,
        defaultAssignToTeamId: null,
      }),
    ).toBeNull();
    // Owners are a setting of their own, not the old pair.
    expect(
      getLegacyDefaultAssignee({
        episodeOwnerUsers: [USER],
        episodeOwnerTeams: [{ _id: TEAM }],
      }),
    ).toBeNull();
  });

  test.each([
    ["a plain id", USER],
    ["an ObjectID", new ObjectID(USER)],
    ["a related row", { _id: USER }],
    ["an id as the API serialises it", { _type: "ObjectID", value: USER }],
  ])("reads the old user from %s", (_label: string, value: unknown) => {
    expect(getLegacyDefaultAssignee({ defaultAssignToUserId: value })).toEqual({
      userId: USER,
      teamId: null,
    });
  });

  test("reads the old pair from its relations too, as the API returns a rule", () => {
    expect(
      getLegacyDefaultAssignee({
        defaultAssignToUser: { _id: USER, name: "Ada" },
        defaultAssignToTeam: { _id: TEAM, name: "Platform" },
      }),
    ).toEqual({ userId: USER, teamId: TEAM });
  });

  test("a rule with no old pair, or one that was cleared, has none", () => {
    expect(getLegacyDefaultAssignee({})).toBeNull();
    expect(
      getLegacyDefaultAssignee({
        defaultAssignToUserId: null,
        defaultAssignToTeamId: undefined,
      }),
    ).toBeNull();
    expect(
      getLegacyDefaultAssignee({ defaultAssignToTeamId: "  " }),
    ).toBeNull();
    // A new rule never has one.
    for (const kind of KINDS) {
      expect(
        getLegacyDefaultAssignee(
          getNewGroupingRuleValues({ kind, translate: english }),
        ),
      ).toBeNull();
    }
  });

  test("tells the line's own changes from anything else", () => {
    expect(
      isLegacyDefaultAssigneeChange({
        action: LegacyDefaultAssigneeAction.AddAsOwners,
      }),
    ).toBe(true);
    expect(
      isLegacyDefaultAssigneeChange({
        action: LegacyDefaultAssigneeAction.Remove,
      }),
    ).toBe(true);
    expect(isLegacyDefaultAssigneeChange("add-as-owners")).toBe(false);
    expect(isLegacyDefaultAssigneeChange({ action: "delete" })).toBe(false);
    expect(isLegacyDefaultAssigneeChange(null)).toBe(false);
    expect(isLegacyDefaultAssigneeChange(undefined)).toBe(false);
  });

  test("Add as owners puts the old pair into the owners, once, and clears it", () => {
    expect(
      getValuesForLegacyDefaultAssigneeChange({
        values: {
          defaultAssignToUserId: new ObjectID(USER),
          defaultAssignToTeamId: new ObjectID(TEAM),
          episodeOwnerUsers: [OTHER_USER],
        },
        change: {
          action: LegacyDefaultAssigneeAction.AddAsOwners,
          userId: USER,
          teamId: TEAM,
        },
      }),
    ).toEqual({
      defaultAssignToUserId: null,
      defaultAssignToTeamId: null,
      episodeOwnerUsers: [OTHER_USER, USER],
      episodeOwnerTeams: [TEAM],
    });
  });

  test("Add as owners never adds someone who already owns the episodes, in any case", () => {
    expect(
      getValuesForLegacyDefaultAssigneeChange({
        values: {
          episodeOwnerUsers: [{ _id: USER.toUpperCase() }],
          episodeOwnerTeams: [TEAM],
        },
        change: {
          action: LegacyDefaultAssigneeAction.AddAsOwners,
          userId: USER,
          teamId: TEAM,
        },
      }),
    ).toEqual({
      defaultAssignToUserId: null,
      defaultAssignToTeamId: null,
      episodeOwnerUsers: [USER.toUpperCase()],
      episodeOwnerTeams: [TEAM],
    });
  });

  test("Add as owners leaves a list alone when it has nothing for it", () => {
    expect(
      getValuesForLegacyDefaultAssigneeChange({
        values: { episodeOwnerUsers: [OTHER_USER] },
        change: {
          action: LegacyDefaultAssigneeAction.AddAsOwners,
          userId: null,
          teamId: TEAM,
        },
      }),
    ).toEqual({
      defaultAssignToUserId: null,
      defaultAssignToTeamId: null,
      episodeOwnerTeams: [TEAM],
    });
  });

  test("Remove only clears the old pair - its relations too, when the values carry them", () => {
    expect(
      getValuesForLegacyDefaultAssigneeChange({
        values: {
          defaultAssignToUser: { _id: USER },
          defaultAssignToTeamId: TEAM,
          episodeOwnerUsers: [OTHER_USER],
        },
        change: {
          action: LegacyDefaultAssigneeAction.Remove,
          userId: USER,
          teamId: TEAM,
        },
      }),
    ).toEqual({
      defaultAssignToUserId: null,
      defaultAssignToTeamId: null,
      defaultAssignToUser: null,
    });
  });

  test("the copy says what owners are, and what the old pair is", () => {
    expect(GROUPING_RULE_COPY.episodeOwnersTitle).toBe("Episode Owners");
    expect(GROUPING_RULE_COPY.episodeOwnersDescription).toBe(
      "Added as owners of every episode this rule opens, and notified like any other owner.",
    );
    expect(GROUPING_RULE_COPY.legacyAssigneeTitle).toBe("Default assignee");
    expect(GROUPING_RULE_COPY.legacyAssigneeDescription).toContain(
      "not shown anywhere",
    );
    expect(GROUPING_RULE_COPY.legacyAssigneeDescription).toContain(
      "Add them as owners to make them responsible",
    );
    expect(GROUPING_RULE_COPY.legacyAssigneeAddAsOwners).toBe("Add as owners");
    expect(GROUPING_RULE_COPY.legacyAssigneeRemove).toBe("Remove");

    const strings: Array<string> = getGroupingRuleUiStrings();

    for (const text of [
      GROUPING_RULE_COPY.episodeOwnersTitle,
      GROUPING_RULE_COPY.episodeOwnersDescription,
      GROUPING_RULE_COPY.legacyAssigneeTitle,
      GROUPING_RULE_COPY.legacyAssigneeDescription,
      GROUPING_RULE_COPY.legacyAssigneeAddAsOwners,
      GROUPING_RULE_COPY.legacyAssigneeRemove,
      GROUPING_RULE_COPY.legacyAssigneeLookupFailed,
    ]) {
      expect(strings).toContain(text);
    }
  });
});

/*
 * WAIT FOR MORE INCIDENTS BEFORE OPENING AN EPISODE (issue #5374).
 *
 * A switch and a count, like the lifecycle switches and their minutes, read
 * with the engines' own rule (Common/Utils/Episode/EpisodeOpeningThreshold):
 * off on every rule until someone turns it on, a count of 2 to 100 while it
 * is on, and what the form shows - the switch, the chip on the folded More
 * fields header, the list's Grouping column - always what the engines do.
 */
describe("the minimum count columns each model has", () => {
  test("are named after what the rule counts", () => {
    expect(MINIMUM_COUNT_FIELD_NAMES[GroupingRuleKind.Incident]).toEqual({
      enabled: "enableMinimumIncidentCount",
      count: "minimumIncidentCount",
    });
    expect(MINIMUM_COUNT_FIELD_NAMES[GroupingRuleKind.Alert]).toEqual({
      enabled: "enableMinimumAlertCount",
      count: "minimumAlertCount",
    });
  });

  test("start the box at 3, and take 2 to 100", () => {
    expect(DEFAULT_MINIMUM_COUNT).toBe(3);
    expect(MIN_MINIMUM_COUNT).toBe(2);
    expect(MAX_MINIMUM_COUNT).toBe(100);
  });
});

describe("parseMinimumCount", () => {
  test.each([
    [2, 2],
    [3, 3],
    [100, 100],
    ["5", 5],
    [" 12 ", 12],
    ["100", 100],
  ] as Array<[unknown, number]>)(
    "reads %j as %d",
    (value: unknown, count: number) => {
      expect(parseMinimumCount(value)).toBe(count);
    },
  );

  test.each([
    ["1, which waits for nothing", 1],
    ["0", 0],
    ["101", 101],
    ["a fraction", 2.5],
    ["fraction text", "2.5"],
    ["a negative number", -3],
    ["empty text", ""],
    ["words", "three"],
    ["a sign", "+4"],
    ["null", null],
    ["undefined", undefined],
    ["NaN", NaN],
  ] as Array<[string, unknown]>)(
    "refuses %s",
    (_name: string, value: unknown) => {
      expect(parseMinimumCount(value)).toBeNull();
    },
  );
});

describe("getMinimumCountValidationError", () => {
  test("says nothing while the switch is off, whatever the box holds", () => {
    for (const count of ["", "abc", 0, 1, 500, undefined]) {
      expect(
        getMinimumCountValidationError({
          enabled: false,
          count: count,
          translate: english,
        }),
      ).toBeNull();
    }
  });

  test("on, takes any count the box takes", () => {
    for (
      let count: number = MIN_MINIMUM_COUNT;
      count <= MAX_MINIMUM_COUNT;
      count++
    ) {
      expect(
        getMinimumCountValidationError({
          enabled: true,
          count: count,
          translate: english,
        }),
      ).toBeNull();
    }
  });

  test("on, takes what the rule was saved with: the API only takes counts the engines act on", () => {
    for (const count of [1, 3, 100, undefined, null]) {
      expect(
        getMinimumCountValidationError({
          enabled: true,
          count: count,
          translate: english,
        }),
      ).toBeNull();
    }
  });

  test.each(["", "1", "0", "101", "2.5", "x", "-2"])(
    "on, refuses %j typed into the box, in the reader's language",
    (typed: string) => {
      expect(
        getMinimumCountValidationError({
          enabled: true,
          count: typed,
          translate: english,
        }),
      ).toBe("Enter a whole number between 2 and 100.");
      expect(
        getMinimumCountValidationError({
          enabled: true,
          count: typed,
          translate: marked,
        }),
      ).toBe("«Enter a whole number between 2 and 100.»");
    },
  );
});

describe("getMinimumCountDisplay", () => {
  test("off shows off", () => {
    expect(getMinimumCountDisplay({ enabled: false, count: 5 })).toEqual({
      enabled: false,
      count: 5,
    });
    expect(getMinimumCountDisplay({ enabled: undefined, count: 3 })).toEqual({
      enabled: false,
      count: 3,
    });
  });

  test("on with a count shows it", () => {
    expect(getMinimumCountDisplay({ enabled: true, count: 4 })).toEqual({
      enabled: true,
      count: 4,
    });
  });

  test("on with a count that waits for nothing shows off, as the engines read it", () => {
    for (const count of [1, 0, undefined, null]) {
      expect(getMinimumCountDisplay({ enabled: true, count: count })).toEqual({
        enabled: false,
        count: count,
      });
    }
  });

  test("on with more than the most shows the most the engines wait for", () => {
    expect(getMinimumCountDisplay({ enabled: true, count: 250 })).toEqual({
      enabled: true,
      count: MAX_MINIMUM_COUNT,
    });
  });

  test("shows text typed into the box as typed, so its check can say what is wrong", () => {
    expect(getMinimumCountDisplay({ enabled: true, count: "1" })).toEqual({
      enabled: true,
      count: "1",
    });
    expect(getMinimumCountDisplay({ enabled: true, count: "" })).toEqual({
      enabled: true,
      count: "",
    });
  });
});

describe("getMinimumCountValues", () => {
  test("turned on with nothing in the box starts at 3", () => {
    expect(getMinimumCountValues({ enabled: true, count: undefined })).toEqual({
      enabled: true,
      count: DEFAULT_MINIMUM_COUNT,
    });
    // A stored 1 waits for nothing, so turning the switch on starts afresh.
    expect(getMinimumCountValues({ enabled: true, count: 1 })).toEqual({
      enabled: true,
      count: DEFAULT_MINIMUM_COUNT,
    });
  });

  test("keeps a count the box takes, on or off", () => {
    expect(getMinimumCountValues({ enabled: true, count: 7 })).toEqual({
      enabled: true,
      count: 7,
    });
    expect(getMinimumCountValues({ enabled: false, count: "12" })).toEqual({
      enabled: false,
      count: 12,
    });
  });

  test("keeps text the box does not take while on, and never saves it while off", () => {
    expect(getMinimumCountValues({ enabled: true, count: "1" })).toEqual({
      enabled: true,
      count: "1",
    });
    expect(getMinimumCountValues({ enabled: false, count: "abc" })).toEqual({
      enabled: false,
      count: DEFAULT_MINIMUM_COUNT,
    });
    expect(getMinimumCountValues({ enabled: false, count: "" })).toEqual({
      enabled: false,
      count: DEFAULT_MINIMUM_COUNT,
    });
  });

  test("saves only counts the API takes, or text the form refuses to save", () => {
    const inputs: Array<unknown> = [
      undefined,
      null,
      "",
      "x",
      "0",
      "1",
      "2",
      "99",
      "100",
      "101",
      0,
      1,
      2,
      50,
      100,
      101,
      2.5,
    ];

    for (const enabled of [true, false]) {
      for (const count of inputs) {
        const values: { enabled: boolean; count: number | string } =
          getMinimumCountValues({ enabled: enabled, count: count });

        expect(values.enabled).toBe(enabled);

        if (typeof values.count === "number") {
          expect(values.count).toBeGreaterThanOrEqual(MIN_MINIMUM_COUNT);
          expect(values.count).toBeLessThanOrEqual(MAX_MINIMUM_COUNT);
        } else {
          // Text is only kept while on, where validation stops the save.
          expect(enabled).toBe(true);
          expect(
            getMinimumCountValidationError({
              enabled: true,
              count: values.count,
              translate: english,
            }),
          ).not.toBeNull();
        }
      }
    }
  });
});

describe("getMinimumCountFoldedValue", () => {
  test.each(KINDS)(
    "%s: says the count while on, in the reader's language",
    (kind: GroupingRuleKind) => {
      const noun: string =
        kind === GroupingRuleKind.Incident ? "incidents" : "alerts";

      expect(
        getMinimumCountFoldedValue({
          enabled: true,
          count: 3,
          kind,
          translate: english,
        }),
      ).toBe(`3 ${noun}`);
      expect(
        getMinimumCountFoldedValue({
          enabled: true,
          count: 12,
          kind,
          translate: marked,
        }),
      ).toBe(`«12 ${noun}»`);
    },
  );

  test.each(KINDS)(
    "%s: says nothing while off, or while on with a count that waits for nothing",
    (kind: GroupingRuleKind) => {
      for (const setting of [
        { enabled: false, count: 5 },
        { enabled: undefined, count: 5 },
        { enabled: true, count: 1 },
        { enabled: true, count: undefined },
      ]) {
        expect(
          getMinimumCountFoldedValue({ ...setting, kind, translate: english }),
        ).toBeNull();
      }
    },
  );

  test("leaves the chip its name alone while the box holds text it does not take", () => {
    expect(
      getMinimumCountFoldedValue({
        enabled: true,
        count: "1",
        kind: GroupingRuleKind.Incident,
        translate: english,
      }),
    ).toBe("");
    expect(
      getMinimumCountFoldedValue({
        enabled: true,
        count: "8",
        kind: GroupingRuleKind.Incident,
        translate: english,
      }),
    ).toBe("8 incidents");
  });

  test("never disagrees with the switch the form draws", () => {
    const counts: Array<unknown> = [
      undefined,
      null,
      0,
      1,
      2,
      3,
      100,
      101,
      "",
      "1",
      "4",
      "x",
    ];

    for (const kind of KINDS) {
      for (const enabled of [true, false, undefined]) {
        for (const count of counts) {
          const folded: string | null = getMinimumCountFoldedValue({
            enabled,
            count,
            kind,
            translate: english,
          });

          expect(folded !== null).toBe(
            getMinimumCountDisplay({ enabled, count }).enabled,
          );
        }
      }
    }
  });
});

describe("getEffectiveMinimumCount", () => {
  test.each(KINDS)(
    "%s: reads the rule's own columns as the engines do",
    (kind: GroupingRuleKind) => {
      const names: MinimumCountFieldNames = MINIMUM_COUNT_FIELD_NAMES[kind];

      expect(getEffectiveMinimumCount({}, kind)).toBe(1);
      expect(
        getEffectiveMinimumCount(
          { [names.enabled]: false, [names.count]: 5 },
          kind,
        ),
      ).toBe(1);
      expect(
        getEffectiveMinimumCount(
          { [names.enabled]: true, [names.count]: 5 },
          kind,
        ),
      ).toBe(5);
      expect(
        getEffectiveMinimumCount(
          { [names.enabled]: true, [names.count]: 1 },
          kind,
        ),
      ).toBe(1);
      expect(
        getEffectiveMinimumCount(
          { [names.enabled]: true, [names.count]: 400 },
          kind,
        ),
      ).toBe(100);
    },
  );

  test("reads only its own kind's columns", () => {
    expect(
      getEffectiveMinimumCount(
        { enableMinimumAlertCount: true, minimumAlertCount: 5 },
        GroupingRuleKind.Incident,
      ),
    ).toBe(1);
    expect(
      getEffectiveMinimumCount(
        { enableMinimumIncidentCount: true, minimumIncidentCount: 5 },
        GroupingRuleKind.Alert,
      ),
    ).toBe(1);
  });

  test.each(KINDS)(
    "%s: a new rule and every ready-made one wait for nothing",
    (kind: GroupingRuleKind) => {
      expect(
        getEffectiveMinimumCount(
          getNewGroupingRuleValues({ kind, translate: english }),
          kind,
        ),
      ).toBe(1);

      for (const template of GROUPING_RULE_TEMPLATES) {
        expect(
          getEffectiveMinimumCount(
            getTemplateRuleValues({ template, kind, translate: english }),
            kind,
          ),
        ).toBe(1);
      }
    },
  );
});

describe("the Grouping column of a rule that waits", () => {
  test.each(KINDS)(
    "%s: says first how many must be ongoing",
    (kind: GroupingRuleKind) => {
      const names: MinimumCountFieldNames = MINIMUM_COUNT_FIELD_NAMES[kind];
      const noun: string =
        kind === GroupingRuleKind.Incident ? "incidents" : "alerts";
      const rule: GroupingRuleValues = {
        ...getGroupByValuesForMode(GroupingMode.Everything, kind),
        enableTimeWindow: true,
        timeWindowMinutes: 10,
        enableReopenWindow: true,
        reopenWindowMinutes: 30,
        [names.enabled]: true,
        [names.count]: 3,
      };

      const summary: GroupingRuleSummary = getGroupingRuleSummary({
        rule,
        kind,
        translate: english,
      });

      expect(summary.grouping).toBe(
        english(GROUPING_SUMMARY_COPY.everything[kind]),
      );
      expect(summary.details[0]).toBe(
        `Opens an episode once 3 matching ${noun} are ongoing`,
      );
      expect(summary.details[1]).toBe(
        "Reopens episodes resolved in the last 30 minutes",
      );
      expect(
        getGroupingRuleSummaryText({ rule, kind, translate: english }),
      ).toContain(
        `New ${noun} join while they arrive within 10 minutes of the last one. Opens an episode once 3 matching ${noun} are ongoing.`,
      );
    },
  );

  test.each(KINDS)(
    "%s: says nothing of waiting for a rule that does not wait",
    (kind: GroupingRuleKind) => {
      const names: MinimumCountFieldNames = MINIMUM_COUNT_FIELD_NAMES[kind];

      for (const setting of [
        {},
        { [names.enabled]: false, [names.count]: 5 },
        { [names.enabled]: true, [names.count]: 1 },
      ]) {
        const summary: GroupingRuleSummary = getGroupingRuleSummary({
          rule: {
            ...getGroupByValuesForMode(GroupingMode.Monitor, kind),
            ...setting,
          },
          kind,
          translate: english,
        });

        for (const detail of summary.details) {
          expect(detail).not.toMatch(/Opens an episode once/);
        }
      }
    },
  );

  test("says it in the reader's language", () => {
    const summary: GroupingRuleSummary = getGroupingRuleSummary({
      rule: { enableMinimumIncidentCount: true, minimumIncidentCount: 4 },
      kind: GroupingRuleKind.Incident,
      translate: marked,
    });

    expect(summary.details).toContain(
      "«Opens an episode once 4 matching incidents are ongoing»",
    );
  });
});
