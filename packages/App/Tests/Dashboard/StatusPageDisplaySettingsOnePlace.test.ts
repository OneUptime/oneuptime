import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import TableColumnType from "Common/Types/Database/TableColumnType";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import StatusPageDisplaySettingsCopy, {
  DaysParseResult,
  DISPLAY_CHOICES,
  DISPLAY_DAYS,
  DISPLAY_DAYS_SENTENCE,
  DISPLAY_SECTIONS,
  DISPLAY_SETTING_COLUMNS,
  DISPLAY_STATUSES,
  DISPLAY_SWITCHES,
  DISPLAY_VALUE_COLUMNS,
  DisplayChoiceDefinition,
  DisplayChoiceOption,
  DisplayDaysDefinition,
  DisplayOptionDefinition,
  DisplaySectionDefinition,
  DisplayStatusesDefinition,
  DisplaySwitchDefinition,
  DisplayValueColumn,
  getDisplayChoiceOptions,
  getDisplayChoiceTestId,
  getDisplayChoiceWrite,
  getDisplayDaysTestId,
  getDisplaySectionTestId,
  getDisplaySettingDefault,
  getDisplaySettingsSelect,
  getDisplayStatusesDescription,
  getDisplayStatusesProblem,
  getDisplayStatusesTestId,
  getDisplayStatusesWrite,
  getDisplaySwitchDescription,
  getDisplaySwitchTestId,
  isSameStatusList,
  MAX_UPTIME_HISTORY_DAYS,
  parseDisplayDays,
  UPTIME_PRECISION_OPTIONS,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCopy";
import IncidentStatusPageScopeCopy from "../../FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What a status page shows its visitors is set in one place: the "What your
 * status page shows" card on Advanced -> Advanced Settings.
 *
 * Those seventeen settings used to be eight cards on that page, each behind
 * its own Edit button and dialog, the incidents one a two-step dialog - and
 * a dialog saved every field it held, so on a plan that could not change one
 * of them, none of them could be changed (the free uptime precision shared
 * its dialog with the Scale plan's Show Overall Uptime Percent). A seventh,
 * unlinked page (/advanced-options) repeated Embedded Status's badge
 * settings.
 *
 * This checks the card's definitions against the model (columns, types,
 * defaults, the plan each needs is the model's own), the number-of-days
 * rule, the uptime precision and downtime statuses rules, that no other
 * Dashboard file grows a second home for one of these settings, what
 * Advanced Settings now holds, that the unlinked page is gone with its URL
 * kept as a redirect, the logo card's title, and that every new string is
 * translated in all seventeen Dashboard locales.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const VIEW_DIR: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "StatusPages",
  "View",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// Without its comments, collapsed to one line.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\{\s*\}/g, "{}")
    .replace(/\s+/g, " ");
}

function readView(file: string): string {
  return readSource(path.join(VIEW_DIR, file));
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

function listSources(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "Locales") {
        continue;
      }

      found.push(...listSources(full));
      continue;
    }

    if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

function relative(file: string): string {
  return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

/*
 * The statuses that count as downtime are a column of the status page and,
 * under the same name, of an SLO - and a prop of the uptime charts. Only
 * the status page's own code is held to naming it in one place.
 */
const SHARED_COLUMN_NAMES: Array<string> = DISPLAY_STATUSES.map(
  (definition: DisplayStatusesDefinition): string => {
    return definition.column;
  },
);

const COLUMN_PATTERN: RegExp = new RegExp(
  `\\b(${DISPLAY_SETTING_COLUMNS.filter((column: string): boolean => {
    return !SHARED_COLUMN_NAMES.includes(column);
  }).join("|")})\\b`,
  "g",
);

const SHARED_COLUMN_PATTERN: RegExp = new RegExp(
  `\\b(${SHARED_COLUMN_NAMES.join("|")})\\b`,
  "g",
);

// The status page's own pages and components.
const STATUS_PAGE_SOURCE_DIRECTORIES: Array<string> = [
  path.join(DASHBOARD_SRC, "Pages", "StatusPages"),
  path.join(DASHBOARD_SRC, "Components", "StatusPage"),
];

const LIST_SWITCH_COLUMNS: Array<string> = [
  "showIncidentsOnStatusPage",
  "showEpisodesOnStatusPage",
  "showAnnouncementsOnStatusPage",
  "showScheduledMaintenanceEventsOnStatusPage",
];

describe("the card's settings", () => {
  test("are seventeen columns of the status page, each once", () => {
    expect(DISPLAY_SETTING_COLUMNS).toHaveLength(17);
    expect(new Set(DISPLAY_SETTING_COLUMNS).size).toBe(17);

    const columns: Array<string> = new StatusPage().getTableColumns().columns;

    for (const column of DISPLAY_SETTING_COLUMNS) {
      expect([column, columns.includes(column)]).toEqual([column, true]);
    }

    expect(Object.keys(getDisplaySettingsSelect()).sort()).toEqual(
      [...DISPLAY_SETTING_COLUMNS].sort(),
    );
  });

  test("reads each single value as itself, and of the downtime statuses what each chip shows", () => {
    const select: Record<string, unknown> = getDisplaySettingsSelect();

    for (const column of DISPLAY_VALUE_COLUMNS) {
      expect([column, select[column]]).toEqual([column, true]);
    }

    expect(select["downtimeMonitorStatuses"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
  });

  test("switch booleans, hold numbers of days or a precision, with the defaults the docs give them", () => {
    const statusPage: StatusPage = new StatusPage();

    const defaults: Record<DisplayValueColumn, boolean | number | string> = {
      showIncidentsOnStatusPage: true,
      showIncidentHistoryInDays: 14,
      showIncidentLabelsOnStatusPage: false,
      onlyShowScopedIncidents: false,
      showEpisodesOnStatusPage: true,
      showEpisodeHistoryInDays: 14,
      showEpisodeLabelsOnStatusPage: false,
      showAnnouncementsOnStatusPage: true,
      showAnnouncementHistoryInDays: 14,
      showScheduledMaintenanceEventsOnStatusPage: true,
      showScheduledEventHistoryInDays: 14,
      showScheduledEventLabelsOnStatusPage: false,
      showUptimeHistoryInDays: 90,
      showOverallUptimePercentOnStatusPage: false,
      overallUptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
      hidePoweredByOneUptimeBranding: false,
    };

    expect([...DISPLAY_VALUE_COLUMNS].sort()).toEqual(
      Object.keys(defaults).sort(),
    );

    for (const definition of DISPLAY_SWITCHES) {
      expect([
        definition.column,
        statusPage.getTableColumnMetadata(definition.column)?.type,
      ]).toEqual([definition.column, TableColumnType.Boolean]);
    }

    for (const definition of DISPLAY_DAYS) {
      expect([
        definition.column,
        statusPage.getTableColumnMetadata(definition.column)?.type,
      ]).toEqual([definition.column, TableColumnType.Number]);
    }

    for (const definition of DISPLAY_CHOICES) {
      expect([
        definition.column,
        statusPage.getTableColumnMetadata(definition.column)?.type,
      ]).toEqual([definition.column, TableColumnType.ShortText]);
    }

    for (const column of DISPLAY_VALUE_COLUMNS) {
      expect([column, getDisplaySettingDefault(column)]).toEqual([
        column,
        defaults[column],
      ]);
      expect([
        column,
        statusPage.getTableColumnMetadata(column)?.defaultValue,
      ]).toEqual([column, defaults[column]]);
    }
  });

  test("the downtime statuses are a list of the project's monitor statuses, with no model default: the server fills a new page's", () => {
    expect(DISPLAY_STATUSES).toHaveLength(1);

    const statuses: DisplayStatusesDefinition = DISPLAY_STATUSES[0]!;
    const metadata: ReturnType<StatusPage["getTableColumnMetadata"]> =
      new StatusPage().getTableColumnMetadata(statuses.column);

    expect(statuses.column).toBe("downtimeMonitorStatuses");
    expect(metadata?.type).toBe(TableColumnType.EntityArray);
    expect(metadata?.modelType).toBe(MonitorStatus);
    expect(metadata?.defaultValue).toBeUndefined();

    // A new page counts the project's statuses that are not operational.
    const service: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Common",
        "Server",
        "Services",
        "StatusPageService.ts",
      ),
      "utf8",
    );

    expect(service).toContain("if (!createBy.data.downtimeMonitorStatuses) {");
    expect(service).toContain("return !monitorStatus.isOperationalState;");
  });

  test("come as a row per list, then uptime history, then the Powered by line", () => {
    expect(
      DISPLAY_SECTIONS.map((section: DisplaySectionDefinition) => {
        return [
          section.id,
          section.show?.column,
          section.days?.column,
          section.options.map((option: DisplayOptionDefinition) => {
            return option.column;
          }),
        ];
      }),
    ).toEqual([
      [
        "incidents",
        "showIncidentsOnStatusPage",
        "showIncidentHistoryInDays",
        ["showIncidentLabelsOnStatusPage", "onlyShowScopedIncidents"],
      ],
      [
        "episodes",
        "showEpisodesOnStatusPage",
        "showEpisodeHistoryInDays",
        ["showEpisodeLabelsOnStatusPage"],
      ],
      [
        "announcements",
        "showAnnouncementsOnStatusPage",
        "showAnnouncementHistoryInDays",
        [],
      ],
      [
        "scheduled-maintenance",
        "showScheduledMaintenanceEventsOnStatusPage",
        "showScheduledEventHistoryInDays",
        ["showScheduledEventLabelsOnStatusPage"],
      ],
      [
        "uptime-history",
        undefined,
        "showUptimeHistoryInDays",
        ["showOverallUptimePercentOnStatusPage"],
      ],
      ["powered-by", "hidePoweredByOneUptimeBranding", undefined, []],
    ]);
  });

  /*
   * The overall uptime % and the statuses that count as downtime were two
   * cards of their own under the card, while the card's uptime row held
   * the number of days: one subject in three places.
   */
  test("everything about uptime is in the uptime row: the days, the overall percentage with its precision, and what counts as downtime", () => {
    const uptime: DisplaySectionDefinition = DISPLAY_SECTIONS.find(
      (section: DisplaySectionDefinition) => {
        return section.id === "uptime-history";
      },
    )!;

    expect(uptime.days?.column).toBe("showUptimeHistoryInDays");
    expect(uptime.options).toHaveLength(1);
    expect(uptime.options[0]!.column).toBe(
      "showOverallUptimePercentOnStatusPage",
    );
    expect(uptime.options[0]!.choiceWhileOn?.column).toBe(
      "overallUptimePercentPrecision",
    );
    expect(uptime.statuses?.column).toBe("downtimeMonitorStatuses");

    // Nowhere else on the card.
    for (const section of DISPLAY_SECTIONS) {
      if (section.id === "uptime-history") {
        continue;
      }

      expect([section.id, section.statuses]).toEqual([section.id, undefined]);

      for (const option of section.options) {
        expect([option.column, option.choiceWhileOn]).toEqual([
          option.column,
          undefined,
        ]);
      }
    }
  });

  test("hiding a list says what that does, and takes away only the settings it makes pointless", () => {
    for (const section of DISPLAY_SECTIONS) {
      if (!section.show || !LIST_SWITCH_COLUMNS.includes(section.show.column)) {
        continue;
      }

      expect(getDisplaySwitchDescription(section.show, false)).toBe(
        StatusPageDisplaySettingsCopy.hiddenListDescription,
      );
      expect(getDisplaySwitchDescription(section.show, true)).toBeUndefined();

      for (const option of section.options) {
        // Only the scope switch still matters while incidents are hidden.
        expect([option.column, option.isOnlyWhileShown]).toEqual([
          option.column,
          option.column !== "onlyShowScopedIncidents",
        ]);
      }
    }

    expect(StatusPageDisplaySettingsCopy.hiddenListDescription).toContain(
      "subscribers aren't notified",
    );
  });

  test("the scope switch keeps its own name and its sentence, whichever way it is set", () => {
    const scope: DisplaySwitchDefinition = DISPLAY_SWITCHES.find(
      (definition: DisplaySwitchDefinition) => {
        return definition.column === "onlyShowScopedIncidents";
      },
    )!;

    expect(scope.title).toBe(
      IncidentStatusPageScopeCopy.onlyShowScopedIncidentsTitle,
    );

    for (const isOn of [true, false]) {
      expect(getDisplaySwitchDescription(scope, isOn)).toBe(
        IncidentStatusPageScopeCopy.onlyShowScopedIncidentsDescription,
      );
    }
  });

  test("every switch reads on = visitors see it: only the Powered by column is stored the other way round", () => {
    expect(
      DISPLAY_SWITCHES.filter((definition: DisplaySwitchDefinition) => {
        return definition.isInverted;
      }).map((definition: DisplaySwitchDefinition) => {
        return definition.column;
      }),
    ).toEqual(["hidePoweredByOneUptimeBranding"]);

    for (const definition of DISPLAY_SWITCHES) {
      expect(definition.title).toMatch(/^(Show|Only Show) /);
    }
  });

  test("uptime history stops at 90 days, as the model says and the API clamps", () => {
    expect(MAX_UPTIME_HISTORY_DAYS).toBe(90);

    const uptime: DisplayDaysDefinition = DISPLAY_DAYS.find(
      (definition: DisplayDaysDefinition) => {
        return definition.column === "showUptimeHistoryInDays";
      },
    )!;

    expect(uptime.maxDays).toBe(MAX_UPTIME_HISTORY_DAYS);
    expect(
      new StatusPage().getTableColumnMetadata("showUptimeHistoryInDays")
        ?.description,
    ).toContain("Maximum is 90 days.");
    expect(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "Common",
          "Server",
          "API",
          "StatusPageAPI.ts",
        ),
        "utf8",
      ),
    ).toContain("if (uptimeHistoryDays > 90) {");

    // The lists' history has no upper limit, as before.
    for (const definition of DISPLAY_DAYS) {
      if (definition.column !== "showUptimeHistoryInDays") {
        expect([definition.column, definition.maxDays]).toEqual([
          definition.column,
          undefined,
        ]);
      }
    }
  });

  test("every control has its own test id", () => {
    const ids: Array<string> = [
      ...DISPLAY_SWITCHES.map((definition: DisplaySwitchDefinition) => {
        return getDisplaySwitchTestId(definition.column);
      }),
      ...DISPLAY_DAYS.map((definition: DisplayDaysDefinition) => {
        return getDisplayDaysTestId(definition.column);
      }),
      ...DISPLAY_CHOICES.map((definition: DisplayChoiceDefinition) => {
        return getDisplayChoiceTestId(definition.column);
      }),
      ...DISPLAY_STATUSES.map((definition: DisplayStatusesDefinition) => {
        return getDisplayStatusesTestId(definition.column);
      }),
      ...DISPLAY_SECTIONS.map((section: DisplaySectionDefinition) => {
        return getDisplaySectionTestId(section.id);
      }),
    ];

    expect(ids).toHaveLength(
      DISPLAY_SETTING_COLUMNS.length + DISPLAY_SECTIONS.length,
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the overall uptime percentage", () => {
  const overall: DisplayOptionDefinition = DISPLAY_SECTIONS.find(
    (section: DisplaySectionDefinition) => {
      return section.id === "uptime-history";
    },
  )!.options[0]!;

  const precision: DisplayChoiceDefinition = overall.choiceWhileOn!;

  test("keeps the name it has always had, and says what visitors see", () => {
    expect(overall.title).toBe("Show Overall Uptime Percent");
    expect(overall.isInverted).toBeFalsy();

    // The same sentence whichever way it is set.
    for (const isOn of [true, false]) {
      expect(getDisplaySwitchDescription(overall, isOn)).toBe(
        StatusPageDisplaySettingsCopy.overallUptimeDescription,
      );
    }

    expect(StatusPageDisplaySettingsCopy.overallUptimeDescription).toContain(
      "beside its overall status while everything is operational",
    );
  });

  test("is shown beside the overall status only while everything is operational, as the status page draws it", () => {
    const overview: string = readSource(
      path.join(
        __dirname,
        "..",
        "..",
        "FeatureSet",
        "StatusPage",
        "src",
        "Pages",
        "Overview",
        "Overview.tsx",
      ),
    );

    expect(overview).toContain(
      "currentStatus.isOperationalState && statusPage?.showOverallUptimePercentOnStatusPage",
    );
    expect(overview).toContain(
      "StatusPageResourceUptimeUtil.calculateAvgUptimePercentageOfAllResources(",
    );
  });

  test("offers its precision only while it is on: that is all the precision is for", () => {
    expect(overall.isOnlyWhileShown).toBe(false);
    expect(precision.column).toBe("overallUptimePercentPrecision");
    expect(precision.label).toBe(StatusPageDisplaySettingsCopy.precisionLabel);
    expect(DISPLAY_CHOICES).toEqual([precision]);
  });

  test("offers every precision there is, fewest decimals first, each as the example a visitor would read", () => {
    expect(precision.options).toBe(UPTIME_PRECISION_OPTIONS);
    expect(
      UPTIME_PRECISION_OPTIONS.map((option: DisplayChoiceOption) => {
        return option.value;
      }),
    ).toEqual(Object.values(UptimePrecision));
    expect(
      UPTIME_PRECISION_OPTIONS.map((option: DisplayChoiceOption) => {
        return option.label;
      }),
    ).toEqual(["99%", "99.9%", "99.99%", "99.999%"]);

    // Each label is how the stored value starts: "99.99% (Two Decimal)".
    for (const option of UPTIME_PRECISION_OPTIONS) {
      expect(option.value.startsWith(`${option.label} (`)).toBe(true);
    }
  });

  test("a precision the list leaves out is shown as it is stored, and only while the page has it", () => {
    expect(getDisplayChoiceOptions(precision, UptimePrecision.ONE_DECIMAL)).toEqual(
      [...UPTIME_PRECISION_OPTIONS],
    );
    expect(getDisplayChoiceOptions(precision, undefined)).toEqual([
      ...UPTIME_PRECISION_OPTIONS,
    ]);
    expect(getDisplayChoiceOptions(precision, "Five Decimal")).toEqual([
      ...UPTIME_PRECISION_OPTIONS,
      { value: "Five Decimal", label: "Five Decimal" },
    ]);
  });

  test("a pick sends its own column alone, so a plan below Scale can change the precision", () => {
    expect(
      getDisplayChoiceWrite(
        "overallUptimePercentPrecision",
        UptimePrecision.THREE_DECIMAL,
      ),
    ).toEqual({ overallUptimePercentPrecision: UptimePrecision.THREE_DECIMAL });

    const statusPage: StatusPage = new StatusPage();

    expect(
      statusPage.getColumnBillingAccessControl(
        "showOverallUptimePercentOnStatusPage",
      )?.update,
    ).toBe("Scale");
    expect(
      statusPage.getColumnBillingAccessControl("overallUptimePercentPrecision"),
    ).toBeFalsy();
  });
});

describe("what counts as downtime", () => {
  const statuses: DisplayStatusesDefinition = DISPLAY_STATUSES[0]!;

  test("is named for what it does, and says what it does to the page's uptime", () => {
    expect(statuses.label).toBe("Counts as downtime");
    expect(statuses.placeholder).toBe("Select monitor statuses");
    expect(getDisplayStatusesDescription(statuses, 1)).toBe(
      StatusPageDisplaySettingsCopy.downtimeDescription,
    );
    expect(getDisplayStatusesDescription(statuses, 3)).toBe(
      StatusPageDisplaySettingsCopy.downtimeDescription,
    );
  });

  test("a page with none says every uptime percentage on it reads 100%", () => {
    expect(getDisplayStatusesDescription(statuses, 0)).toBe(
      StatusPageDisplaySettingsCopy.downtimeEmptyDescription,
    );
    expect(StatusPageDisplaySettingsCopy.downtimeEmptyDescription).toContain(
      "reads 100%",
    );
  });

  test("keeps at least one status: the last one cannot be taken off", () => {
    expect(getDisplayStatusesProblem(statuses, [])).toBe(
      StatusPageDisplaySettingsCopy.downtimeKeepOne,
    );
    expect(getDisplayStatusesProblem(statuses, ["a"])).toBeNull();
    expect(getDisplayStatusesProblem(statuses, ["a", "b"])).toBeNull();
    expect(statuses.keepOne).toBe(StatusPageDisplaySettingsCopy.downtimeKeepOne);
  });

  test("sends the statuses alone, by id", () => {
    expect(
      getDisplayStatusesWrite("downtimeMonitorStatuses", ["a", "b"]),
    ).toEqual({ downtimeMonitorStatuses: ["a", "b"] });

    // A copy: the list it was given is not handed on.
    const ids: Array<string> = ["a"];
    const write: Record<string, unknown> = getDisplayStatusesWrite(
      "downtimeMonitorStatuses",
      ids,
    );

    expect(write["downtimeMonitorStatuses"]).not.toBe(ids);
    expect(
      new StatusPage().getColumnBillingAccessControl("downtimeMonitorStatuses"),
    ).toBeFalsy();
  });

  test.each([
    [[], [], true],
    [["a"], ["a"], true],
    [
      ["a", "b"],
      ["b", "a"],
      true,
    ],
    [["a"], ["b"], false],
    [["a"], ["a", "b"], false],
    [["a", "b"], ["a"], false],
    [
      ["a", "a"],
      ["a", "b"],
      false,
    ],
  ])(
    "%j and %j are the same list: %s",
    (first: Array<string>, second: Array<string>, isSame: boolean) => {
      expect(isSameStatusList(first, second)).toBe(isSame);
      expect(isSameStatusList(second, first)).toBe(isSame);
    },
  );
});

describe("a number of days", () => {
  test.each([
    ["14", 14],
    [" 14 ", 14],
    ["014", 14],
    ["1", 1],
    ["365", 365],
    ["100000", 100000],
  ])("%j is %d days", (text: string, days: number) => {
    expect(parseDisplayDays(text)).toEqual({ isValid: true, days: days });
  });

  test.each([
    [""],
    [" "],
    ["0"],
    ["-1"],
    ["1.5"],
    ["1e3"],
    ["abc"],
    ["14 days"],
    ["99999999999999999999"],
  ])("%j is not a number of days", (text: string) => {
    const result: DaysParseResult = parseDisplayDays(text);

    expect(result).toEqual({
      isValid: false,
      error: StatusPageDisplaySettingsCopy.daysTooFew,
      values: {},
    });
  });

  test("with a limit, says the range, and takes its ends", () => {
    expect(parseDisplayDays("90", 90)).toEqual({ isValid: true, days: 90 });
    expect(parseDisplayDays("1", 90)).toEqual({ isValid: true, days: 1 });

    for (const text of ["91", "0", "", "4.5"]) {
      expect(parseDisplayDays(text, 90)).toEqual({
        isValid: false,
        error: StatusPageDisplaySettingsCopy.daysOutOfRange,
        values: { max: 90 },
      });
    }
  });

  test("is typed into one sentence, in its plural forms", () => {
    expect(DISPLAY_DAYS_SENTENCE).toEqual({
      one: "Show the last {{count}} day",
      other: "Show the last {{count}} days",
    });
  });
});

describe("one place for each setting", () => {
  test("no Dashboard file names one of these columns except the card's copy, and the subscriber warning reading the four lists", () => {
    const allowed: Record<string, Array<string>> = {
      "Components/StatusPage/StatusPageDisplaySettingsCopy.ts":
        DISPLAY_SETTING_COLUMNS.filter((column: string): boolean => {
          return !SHARED_COLUMN_NAMES.includes(column);
        }),
      // Warns that a hidden list notifies nobody, and links to the card.
      "Components/StatusPage/SubscriberNotificationWarnings.tsx": [
        ...LIST_SWITCH_COLUMNS,
      ],
    };

    const found: Record<string, Array<string>> = {};

    for (const file of listSources(DASHBOARD_SRC)) {
      const columns: Array<string> = Array.from(
        new Set(
          Array.from(readSource(file).matchAll(COLUMN_PATTERN)).map(
            (match: RegExpMatchArray): string => {
              return match[1]!;
            },
          ),
        ),
      ).sort();

      if (columns.length > 0) {
        found[relative(file)] = columns;
      }
    }

    const expected: Record<string, Array<string>> = {};

    for (const [file, columns] of Object.entries(allowed)) {
      expected[file] = [...columns].sort();
    }

    expect(found).toEqual(expected);
  });

  /*
   * The SLOs have a downtimeMonitorStatuses of their own, and the uptime
   * charts a prop by that name, so this one is held to one place within the
   * status page's pages and components.
   */
  test("no status page file names the downtime statuses except the card's copy", () => {
    const found: Array<string> = STATUS_PAGE_SOURCE_DIRECTORIES.flatMap(
      (directory: string): Array<string> => {
        return listSources(directory);
      },
    )
      .filter((file: string): boolean => {
        // A pattern of its own: a global one's test() carries on from its last match.
        return new RegExp(SHARED_COLUMN_PATTERN.source).test(readSource(file));
      })
      .map(relative)
      .sort();

    expect(found).toEqual([
      "Components/StatusPage/StatusPageDisplaySettingsCopy.ts",
    ]);
  });

  test("the card draws its rows from the copy, and saves through the shared switch and days rows", () => {
    const card: string = readSource(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "StatusPage",
        "StatusPageDisplaySettingsCard.tsx",
      ),
    );

    expect(card).toContain("DISPLAY_SECTIONS.map(");
    expect(card).toContain("<StatusPageSwitchRow");
    expect(card).toContain("<StatusPageDaysSetting");
    expect(card).toContain("<StatusPageChoiceSetting");
    expect(card).toContain("<StatusPageDowntimeStatusesSetting");
    expect(card).toContain("select: getDisplaySettingsSelect(),");
    // No Edit button, no dialog, no form.
    expect(card).not.toContain("CardModelDetail");
    expect(card).not.toContain("ModelForm");
    expect(card).not.toContain("editButtonText");
  });

  test("the pick and the statuses save their own column through the copy's writes, and never lock while they save", () => {
    for (const file of [
      "StatusPageChoiceSetting.tsx",
      "StatusPageDowntimeStatusesSetting.tsx",
    ]) {
      const source: string = readSource(
        path.join(DASHBOARD_SRC, "Components", "StatusPage", file),
      );

      expect([file, source.includes("useSaveOnChange")]).toEqual([file, true]);
      expect([file, source.includes("PermissionGate.checkColumnUpdate(")]).toEqual(
        [file, true],
      );
      expect([file, source.includes("ModelAPI.updateById<StatusPage>(")]).toEqual(
        [file, true],
      );
      expect([file, source.includes("CardModelDetail")]).toEqual([file, false]);
      expect([file, source.includes("ModelForm")]).toEqual([file, false]);
    }

    expect(
      readSource(
        path.join(
          DASHBOARD_SRC,
          "Components",
          "StatusPage",
          "StatusPageChoiceSetting.tsx",
        ),
      ),
    ).toContain("data: getDisplayChoiceWrite(column, value),");

    const statuses: string = readSource(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "StatusPage",
        "StatusPageDowntimeStatusesSetting.tsx",
      ),
    );

    expect(statuses).toContain(
      "data: getDisplayStatusesWrite(column, statusIds),",
    );
    // The project's statuses, in their colours, in priority order.
    expect(statuses).toContain("modelType: MonitorStatus,");
    expect(statuses).toContain("color: true,");
    expect(statuses).toContain("priority: SortOrder.Ascending,");
    expect(statuses).toContain(
      "DropdownUtil.getDropdownOptionsFromEntityArray<MonitorStatus>(",
    );
    expect(statuses).toContain("getDisplayStatusesProblem(");
  });

  test("the subscriber warning sends people to Advanced Settings, not to a Status Page Settings that does not exist", () => {
    const warning: string = readSource(
      path.join(
        DASHBOARD_SRC,
        "Components",
        "StatusPage",
        "SubscriberNotificationWarnings.tsx",
      ),
    );

    expect(warning).toContain("RouteMap[PageMap.STATUS_PAGE_VIEW_SETTINGS]");
    expect(warning).not.toContain("Status Page Settings");
  });
});

describe("Advanced Settings", () => {
  const source: string = readView("StatusPageSettings.tsx");

  test("is the card, the page's export, then Archive", () => {
    const card: number = source.indexOf(
      "<StatusPageDisplaySettingsCard statusPageId={modelId} />",
    );
    const exportCard: number = source.indexOf(
      "<ExportModelCard modelId={modelId} modelType={StatusPage} />",
    );
    const archive: number = source.indexOf("<ArchiveResourceCard<StatusPage>");

    expect(card).toBeGreaterThan(-1);
    expect(exportCard).toBeGreaterThan(card);
    expect(archive).toBeGreaterThan(exportCard);
  });

  /*
   * Branding's Overview Page screen held two cards about uptime - the
   * overall uptime % and which statuses count as downtime - and they moved
   * here, as they were, when Branding became one page. They are rows of the
   * card's uptime row now, so no card here has an Edit button.
   */
  test("has no card with an Edit button or a form left on it", () => {
    expect(source).not.toMatch(/<CardModelDetail\b/);
    expect(source).not.toContain("CardModelDetail");

    for (const leftover of [
      "formFields",
      "formSteps",
      "editButtonText",
      '"Status Page > Settings"',
      '"Status Page > Branding > Downtime Monitor Statuses"',
      '"Overall Uptime Percent"',
      '"Downtime Monitor Statuses"',
      '"Edit Statuses"',
      "UptimePrecision",
      "MonitorStatus",
      '"Incident Settings"',
      '"Episode Settings"',
      '"Announcement Settings"',
      '"Scheduled Event Settings"',
      '"Uptime History Settings"',
      '"Powered By OneUptime Branding"',
    ]) {
      expect([leftover, source.includes(leftover)]).toEqual([leftover, false]);
    }
  });

  test("names no setting itself: the card's copy does", () => {
    expect(source).not.toMatch(COLUMN_PATTERN);
    expect(source).not.toMatch(SHARED_COLUMN_PATTERN);
  });
});

describe("the unlinked Advanced Options page", () => {
  test("is gone, with no page key or route of its own", () => {
    expect(fs.existsSync(path.join(VIEW_DIR, "AdvancedOptions.tsx"))).toBe(
      false,
    );

    for (const file of ["PageMap.ts", "RouteMap.ts"]) {
      expect(
        fs.readFileSync(path.join(DASHBOARD_SRC, "Utils", file), "utf8"),
      ).not.toMatch(/ADVANCED_OPTIONS|advanced-options/);
    }
  });

  test("its URL forwards to Embedded Status, and nothing else names it", () => {
    const routes: string = readSource(
      path.join(DASHBOARD_SRC, "Routes", "StatusPagesRoutes.tsx"),
    );

    expect(routes).toContain(
      'export const MOVED_STATUS_PAGE_ADVANCED_OPTIONS_PATH: string = "advanced-options";',
    );
    expect(routes).toContain(
      "<PageRoute path={MOVED_STATUS_PAGE_ADVANCED_OPTIONS_PATH} element={ <MovedPageRedirect pageMap={PageMap.STATUS_PAGE_VIEW_EMBEDDED} /> } />",
    );

    const naming: Array<string> = listSources(DASHBOARD_SRC)
      .filter((file: string): boolean => {
        return readSource(file).includes("advanced-options");
      })
      .map(relative);

    expect(naming).toEqual(["Routes/StatusPagesRoutes.tsx"]);
  });

  test("the badge settings it repeated are on Embedded Status", () => {
    const embedded: string = readView("EmbeddedStatus.tsx");

    // Its switch saves when flipped (ModelSwitchCard), with no Edit dialog.
    expect(embedded).toContain('column="enableEmbeddedOverallStatus"');
    expect(embedded).toContain(
      'cardTitle={translationKey("Embedded Status Badge")}',
    );
    expect(embedded).toContain('title="Regenerate Security Token"');
  });
});

describe("the Branding page", () => {
  const branding: string = readView("Branding.tsx");

  // The logo card's own source, from its name to the next card.
  const logoCard: string = branding.slice(
    branding.indexOf('name="Status Page > Branding > Header Style"'),
    branding.indexOf(
      "<CardModelDetail",
      branding.indexOf('name="Status Page > Branding > Header Style"'),
    ),
  );

  test("titles the logo card for what it holds: the logo and the cover image", () => {
    expect(logoCard).toContain('title: "Logo and Cover Image",');
    expect(branding).not.toContain("Logo, Cover and Favicon");
    expect(logoCard).not.toMatch(/favicon/i);
    // The Header screen it was on is the Branding page now.
    expect(fs.existsSync(path.join(VIEW_DIR, "HeaderStyle.tsx"))).toBe(false);
  });

  test("the favicon has a card of its own on it", () => {
    expect(branding).toContain('name="Status Page > Branding > Favicon"');
    expect(branding).toContain('title: "Favicon",');
    expect(branding).toContain("faviconFile");
  });
});

describe("translations", () => {
  // The settings' names, which every locale already had.
  const names: Array<string> = [
    ...DISPLAY_SWITCHES.map((definition: DisplaySwitchDefinition) => {
      return definition.title;
    }),
    ...DISPLAY_DAYS.map((definition: DisplayDaysDefinition) => {
      return definition.label;
    }),
    StatusPageDisplaySettingsCopy.uptimeTitle,
    StatusPageDisplaySettingsCopy.precisionLabel,
    StatusPageDisplaySettingsCopy.downtimeLabel,
    StatusPageDisplaySettingsCopy.downtimePlaceholder,
    StatusPageDisplaySettingsCopy.saved,
    StatusPageDisplaySettingsCopy.saving,
    "Logo and Cover Image",
  ];

  const sentences: Array<string> = [
    StatusPageDisplaySettingsCopy.cardTitle,
    StatusPageDisplaySettingsCopy.cardDescription,
    StatusPageDisplaySettingsCopy.hiddenListDescription,
    StatusPageDisplaySettingsCopy.uptimeDescription,
    StatusPageDisplaySettingsCopy.overallUptimeDescription,
    StatusPageDisplaySettingsCopy.downtimeDescription,
    StatusPageDisplaySettingsCopy.downtimeEmptyDescription,
    StatusPageDisplaySettingsCopy.downtimeKeepOne,
    StatusPageDisplaySettingsCopy.downtimeLabel,
    StatusPageDisplaySettingsCopy.daysTooFew,
    StatusPageDisplaySettingsCopy.daysOutOfRange,
    DISPLAY_DAYS_SENTENCE.other,
    "Show Powered By OneUptime Branding",
    "This status page hides these event types, so its subscribers are not notified about them:",
    "Change what your status page shows",
  ];

  /*
   * The two cards' own words went with them: their titles, their Edit
   * buttons and the sentences that said the same thing twice ("These
   * monitor statuses are be considered as down ...").
   */
  test("the uptime cards' own words are gone with them", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const gone of [
      "Overall Uptime Percent",
      "Settings for overall uptime percent on status page",
      "Show or hide the overall uptime percent on the status page",
      "Overall Uptime Precision",
      "Edit Statuses",
      "These monitor statuses are considered as down",
      "These monitor statuses are be considered as down when we calculate uptime %",
      "These monitor statuses are be considered as down when we calculate uptime %.",
    ]) {
      expect([gone, english[gone]]).toEqual([gone, undefined]);
    }
  });

  test("en.json maps every string to itself, and the day sentence's one form", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const text of [...names, ...sentences]) {
      expect([text, english[text]]).toEqual([text, text]);
    }

    expect(english[`${DISPLAY_DAYS_SENTENCE.other}_one`]).toBe(
      DISPLAY_DAYS_SENTENCE.one,
    );
  });

  test.each(OTHER_LOCALES)(
    "%s has every name, and its own words for every sentence",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const text of names) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
      }

      for (const text of sentences) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
        expect([text, translations[text]]).not.toEqual([text, text]);
      }

      // The sentence the box is typed into keeps its box.
      for (const key of [
        DISPLAY_DAYS_SENTENCE.other,
        `${DISPLAY_DAYS_SENTENCE.other}_one`,
      ]) {
        expect([key, translations[key]]).toEqual([
          key,
          expect.stringContaining("{{count}}"),
        ]);
      }

      expect(
        translations[StatusPageDisplaySettingsCopy.uptimeDescription],
      ).toContain("{{max}}");
      expect(
        translations[StatusPageDisplaySettingsCopy.daysOutOfRange],
      ).toContain("{{max}}");
    },
  );
});
