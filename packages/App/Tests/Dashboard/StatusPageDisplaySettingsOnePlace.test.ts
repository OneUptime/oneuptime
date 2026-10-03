import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import TableColumnType from "Common/Types/Database/TableColumnType";
import StatusPageDisplaySettingsCopy, {
  DaysParseResult,
  DISPLAY_DAYS,
  DISPLAY_DAYS_SENTENCE,
  DISPLAY_SECTIONS,
  DISPLAY_SETTING_COLUMNS,
  DISPLAY_SWITCHES,
  DisplayDaysDefinition,
  DisplayOptionDefinition,
  DisplaySectionDefinition,
  DisplaySettingColumn,
  DisplaySwitchDefinition,
  getDisplayDaysTestId,
  getDisplaySectionTestId,
  getDisplaySettingDefault,
  getDisplaySettingsSelect,
  getDisplaySwitchDescription,
  getDisplaySwitchTestId,
  MAX_UPTIME_HISTORY_DAYS,
  parseDisplayDays,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCopy";
import IncidentStatusPageScopeCopy from "../../FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What a status page shows its visitors is set in one place: the "What your
 * status page shows" card on Advanced -> Advanced Settings.
 *
 * Those fourteen settings used to be six cards on that page, each behind its
 * own Edit button and dialog, the incidents one a two-step dialog - and a
 * dialog saved every field it held, so on a plan that could not change one
 * of them, none of them could be changed. A seventh, unlinked page
 * (/advanced-options) repeated Embedded Status's badge settings.
 *
 * This checks the card's definitions against the model (columns, types,
 * defaults, the plan each needs is the model's own), the number-of-days
 * rule, that no other Dashboard file grows a second home for one of these
 * settings, what Advanced Settings now holds, that the unlinked page is gone
 * with its URL kept as a redirect, the header card's title, and that every
 * new string is translated in all seventeen Dashboard locales.
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

const COLUMN_PATTERN: RegExp = new RegExp(
  `\\b(${DISPLAY_SETTING_COLUMNS.join("|")})\\b`,
  "g",
);

const LIST_SWITCH_COLUMNS: Array<string> = [
  "showIncidentsOnStatusPage",
  "showEpisodesOnStatusPage",
  "showAnnouncementsOnStatusPage",
  "showScheduledMaintenanceEventsOnStatusPage",
];

describe("the card's settings", () => {
  test("are fourteen columns of the status page, each once", () => {
    expect(DISPLAY_SETTING_COLUMNS).toHaveLength(14);
    expect(new Set(DISPLAY_SETTING_COLUMNS).size).toBe(14);

    const columns: Array<string> = new StatusPage().getTableColumns().columns;

    for (const column of DISPLAY_SETTING_COLUMNS) {
      expect([column, columns.includes(column)]).toEqual([column, true]);
    }

    expect(Object.keys(getDisplaySettingsSelect()).sort()).toEqual(
      [...DISPLAY_SETTING_COLUMNS].sort(),
    );
  });

  test("switch booleans and hold numbers of days, with the defaults the docs give them", () => {
    const statusPage: StatusPage = new StatusPage();

    const defaults: Record<DisplaySettingColumn, boolean | number> = {
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
      hidePoweredByOneUptimeBranding: false,
    };

    expect([...DISPLAY_SETTING_COLUMNS].sort()).toEqual(
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

    for (const column of DISPLAY_SETTING_COLUMNS) {
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
      ["uptime-history", undefined, "showUptimeHistoryInDays", []],
      ["powered-by", "hidePoweredByOneUptimeBranding", undefined, []],
    ]);
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
      ...DISPLAY_SECTIONS.map((section: DisplaySectionDefinition) => {
        return getDisplaySectionTestId(section.id);
      }),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });
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

  test.each([[""], [" "], ["0"], ["-1"], ["1.5"], ["1e3"], ["abc"], ["14 days"], ["99999999999999999999"]])(
    "%j is not a number of days",
    (text: string) => {
      const result: DaysParseResult = parseDisplayDays(text);

      expect(result).toEqual({
        isValid: false,
        error: StatusPageDisplaySettingsCopy.daysTooFew,
        values: {},
      });
    },
  );

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
      "Components/StatusPage/StatusPageDisplaySettingsCopy.ts": [
        ...DISPLAY_SETTING_COLUMNS,
      ],
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
    expect(card).toContain("select: getDisplaySettingsSelect(),");
    // No Edit button, no dialog, no form.
    expect(card).not.toContain("CardModelDetail");
    expect(card).not.toContain("ModelForm");
    expect(card).not.toContain("editButtonText");
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

  test("has no card with an Edit button or a form left on it", () => {
    for (const leftover of [
      "CardModelDetail",
      "editButtonText",
      "formFields",
      "formSteps",
      "Edit Settings",
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

    expect(embedded).toContain("enableEmbeddedOverallStatus: true,");
    expect(embedded).toContain('title: "Embedded Status Badge",');
    expect(embedded).toContain('title="Regenerate Security Token"');
  });
});

describe("the Header page", () => {
  test("titles its card for what it holds: the logo and the cover image", () => {
    const header: string = readView("HeaderStyle.tsx");

    expect(header).toContain('title: "Logo and Cover Image",');
    expect(header).not.toContain("Logo, Cover and Favicon");
    expect(header).not.toMatch(/favicon/i);
  });

  test("the favicon is on Essential Branding", () => {
    const branding: string = readView("Branding.tsx");

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
    StatusPageDisplaySettingsCopy.saved,
    StatusPageDisplaySettingsCopy.saving,
    "Logo and Cover Image",
  ];

  const sentences: Array<string> = [
    StatusPageDisplaySettingsCopy.cardTitle,
    StatusPageDisplaySettingsCopy.cardDescription,
    StatusPageDisplaySettingsCopy.hiddenListDescription,
    StatusPageDisplaySettingsCopy.uptimeDescription,
    StatusPageDisplaySettingsCopy.daysTooFew,
    StatusPageDisplaySettingsCopy.daysOutOfRange,
    DISPLAY_DAYS_SENTENCE.other,
    "Show Powered By OneUptime Branding",
    "This status page hides these event types, so its subscribers are not notified about them:",
    "Change what your status page shows",
  ];

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

      expect(translations[StatusPageDisplaySettingsCopy.uptimeDescription]).toContain(
        "{{max}}",
      );
      expect(translations[StatusPageDisplaySettingsCopy.daysOutOfRange]).toContain(
        "{{max}}",
      );
    },
  );
});
