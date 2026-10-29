import {
  buildPageSearchCommandDescriptors,
  BuildPageSearchCommandsInput,
  getOfferedPageSettings,
  getPageSearchCommandRanking,
  getPageSearchIndexEntries,
  PageSearchAvailability,
  PageSearchCommandDescriptor,
  PageSearchIndexEntry,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import { PROJECT_AI_DAILY_LIMITS_CARD_KEY } from "../../FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import { RETENTION_BY_TELEMETRY_TYPE_PLACE } from "../../FeatureSet/Dashboard/src/Components/TelemetryResource/TelemetryRetentionFold";
import {
  getPageSearchAreas,
  PageSearchArea,
  PageSearchGate,
  PageSearchPage,
  PageSearchSetting,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import {
  filterPaletteCommands,
  PaletteCommandMatch,
} from "Common/UI/Components/CommandPalette/PaletteFilter";
import { PaletteCommand } from "Common/UI/Components/CommandPalette/Types";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * A setting is found by the name it goes by.
 *
 * Search (Cmd/Ctrl+K) found a settings page by its menu entry only: "SSO",
 * "Feature Flags", "Billing". The settings on those pages - the names their
 * cards and switches show - found nothing: "require sso for login",
 * "monitor groups", "cancel plan", "customer support access", "business
 * details", "notification channels" (that one found the Slack pages), "ai
 * context" (the MCP pages), "timezone" (the on-call Schedule Timeline). A
 * settings page now lists its settings (PageSearchPage.settings), and each
 * is a result of its own, named as its card names it, that says the page it
 * is on and opens it - in English and in the reader's language.
 *
 * Held here:
 *   - every setting the index lists is a result that opens its own page,
 *     among the first three for its name, and never before its page;
 *   - a setting folded under its page's More settings opens the fold at its
 *     card;
 *   - what people searched for and found nothing (the list above) lands
 *     where the setting is;
 *   - a setting there only on OneUptime Cloud is offered only there;
 *   - each name is the one its card or switch shows: it is written in the
 *     Dashboard's source, so a renamed card cannot leave a stale name here;
 *   - every card a settings page writes by name (cardProps' title, a Card's
 *     title, a switch card's cardTitle) is a way to its page: a card added
 *     later is found too, or this fails until it is.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);
const REPO_ROOT: string = path.join(__dirname, "..", "..", "..", "..");
const EE_DASHBOARD: string = path.join(REPO_ROOT, "ee", "Dashboard");
const IS_EE_PRESENT: boolean = fs.existsSync(path.join(REPO_ROOT, "ee"));

const AREAS: Array<PageSearchArea> = getPageSearchAreas();
const ENTRIES: Array<PageSearchIndexEntry> = getPageSearchIndexEntries(AREAS);

const ALL_ON: PageSearchAvailability = {
  isBillingEnabled: true,
  isMonitorGroupsEnabled: true,
  canDeleteProject: true,
};

const SELF_HOSTED: PageSearchAvailability = {
  ...ALL_ON,
  isBillingEnabled: false,
};

const TEMPLATE: (key: string) => string = (key: string): string => {
  return `/dashboard/:projectId/${key.toLowerCase()}`;
};

const build: (
  overrides?: Partial<BuildPageSearchCommandsInput>,
) => Array<PageSearchCommandDescriptor> = (
  overrides?: Partial<BuildPageSearchCommandsInput>,
): Array<PageSearchCommandDescriptor> => {
  return buildPageSearchCommandDescriptors({
    areas: AREAS,
    availability: ALL_ON,
    getRouteTemplate: TEMPLATE,
    getRoutePath: (key: string): string => {
      return TEMPLATE(key).replace(":projectId", "project-a");
    },
    getProductTitle: (): string | undefined => {
      return undefined;
    },
    translate: (text: string): string => {
      return text;
    },
    catalog: [],
    ...overrides,
  });
};

const toCommands: (
  descriptors: Array<PageSearchCommandDescriptor>,
) => Array<PaletteCommand> = (
  descriptors: Array<PageSearchCommandDescriptor>,
): Array<PaletteCommand> => {
  return descriptors.map(
    (descriptor: PageSearchCommandDescriptor): PaletteCommand => {
      return {
        id: descriptor.id,
        title: descriptor.title,
        titleAliases: descriptor.titleAliases,
        keywords: descriptor.keywords,
        breadcrumb: descriptor.breadcrumb,
        breadcrumbKeywords: descriptor.breadcrumbKeywords,
        category: descriptor.isAction ? "Actions" : "Pages",
        isSearchOnly: true,
        // As the palette ranks them.
        ...getPageSearchCommandRanking(descriptor),
        onSelect: (): void => {},
      };
    },
  );
};

// The page key a result opens ("/dashboard/project-a/settings_sso" -> SETTINGS_SSO).
const pageKeyOf: (command: PaletteCommand) => string = (
  command: PaletteCommand,
): string => {
  const descriptor: PageSearchCommandDescriptor | undefined = build().find(
    (candidate: PageSearchCommandDescriptor): boolean => {
      return candidate.id === command.id;
    },
  );

  return (descriptor?.routePath.split("/").pop() || "")
    .split("#")[0]!
    .toUpperCase();
};

const results: (
  query: string,
  commands: Array<PaletteCommand>,
) => Array<PaletteCommand> = (
  query: string,
  commands: Array<PaletteCommand>,
): Array<PaletteCommand> => {
  return filterPaletteCommands(commands, query).map(
    (match: PaletteCommandMatch): PaletteCommand => {
      return match.command;
    },
  );
};

const settingName: (setting: string | PageSearchSetting) => string = (
  setting: string | PageSearchSetting,
): string => {
  return typeof setting === "string" ? setting : setting.name;
};

const ENTRIES_WITH_SETTINGS: Array<PageSearchIndexEntry> = ENTRIES.filter(
  (entry: PageSearchIndexEntry): boolean => {
    return Boolean(entry.page.settings && entry.page.settings.length > 0);
  },
);

describe("every setting the index lists finds its own page first", () => {
  const commands: Array<PaletteCommand> = toCommands(build());

  const cases: Array<[string, string]> = ENTRIES_WITH_SETTINGS.flatMap(
    (entry: PageSearchIndexEntry): Array<[string, string]> => {
      return (entry.page.settings || []).map(
        (setting: string | PageSearchSetting): [string, string] => {
          return [settingName(setting), entry.page.page];
        },
      );
    },
  );

  test("the index lists the settings of every settings page it should", () => {
    expect(cases.length).toBeGreaterThanOrEqual(65);
  });

  /*
   * A setting's name is what a card or a switch is called, not a sentence:
   * a long one ("Record and transcribe incident calls") also caught the
   * search's typo fallback, and "incidnet" opened Video Calls rather than
   * Incidents (SearchDocs).
   */
  test.each(cases)("%s is a name, not a sentence", (name: string) => {
    expect(name.split(SPACES).length).toBeLessThanOrEqual(6);
  });

  test.each(cases)("%s finds %s", (name: string, pageKey: string) => {
    const found: Array<PaletteCommand> = results(name, commands);
    expect(found.length).toBeGreaterThan(0);

    /*
     * A name two pages hold (Current Balance, on Notification Settings and
     * on AI Credits) finds one of them first: either is where it is.
     */
    const holders: Array<string> = ENTRIES_WITH_SETTINGS.filter(
      (entry: PageSearchIndexEntry): boolean => {
        return (entry.page.settings || []).some(
          (setting: string | PageSearchSetting): boolean => {
            return settingName(setting).toLowerCase() === name.toLowerCase();
          },
        );
      },
    ).map((entry: PageSearchIndexEntry): string => {
      return entry.page.page;
    });

    expect(holders).toContain(pageKey);

    /*
     * Its page is offered among the first three: what comes before it is a
     * page whose own name holds the words ("Call Logs" is also the incoming
     * call policies' page; "On-Call Logs" holds "call" and "logs"), or one
     * people call so ("Security keys" are also Passkeys').
     */
    const at: number = found.map(pageKeyOf).indexOf(pageKey);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThanOrEqual(2);
  });
});

describe("what people searched for, and found nothing, lands where the setting is", () => {
  const commands: Array<PaletteCommand> = toCommands(build());

  test.each([
    ["require sso for login", PageMap.SETTINGS_SSO],
    ["require sso", PageMap.SETTINGS_SSO],
    ["test single sign on", PageMap.SETTINGS_SSO],
    ["customer support access", PageMap.SETTINGS],
    ["project details", PageMap.SETTINGS],
    ["cancel plan", PageMap.SETTINGS_BILLING],
    ["business details", PageMap.SETTINGS_BILLING],
    ["billing address", PageMap.SETTINGS_BILLING],
    ["current plan", PageMap.SETTINGS_BILLING],
    ["notification channels", PageMap.SETTINGS_NOTIFICATION_SETTINGS],
    ["ai context", PageMap.SETTINGS_AI_FEATURES],
    ["daily limits", PageMap.SETTINGS_AI_FEATURES],
    ["call transcripts", PageMap.SETTINGS_VIDEO_CALLS],
    ["retention by telemetry type", PageMap.SETTINGS_TELEMETRY_SETTINGS],
    ["global llm providers", PageMap.SETTINGS_AI_LLM_PROVIDERS],
    ["connected mcp clients", PageMap.SETTINGS_MCP_SERVER],
    ["telemetry usage history", PageMap.SETTINGS_USAGE_HISTORY],
    ["on-call policy logs", PageMap.ON_CALL_DUTY_EXECUTION_LOGS],
    ["timezone", PageMap.USER_PROFILE_OVERVIEW],
    ["time zone", PageMap.USER_PROFILE_OVERVIEW],
    ["remind me before shifts", PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED],
    ["email rollup", PageMap.USER_SETTINGS_EMAIL_PREFERENCES],
    ["whatsapp numbers", PageMap.USER_SETTINGS_NOTIFICATION_METHODS],
    ["backup codes", PageMap.USER_TWO_FACTOR_AUTH],
    ["team member custom fields", PageMap.USER_CUSTOM_FIELDS],
    ["my custom fields", PageMap.USER_SETTINGS_CUSTOM_FIELDS],
  ])('"%s" opens %s first', (query: string, pageKey: string) => {
    const found: Array<PaletteCommand> = results(query, commands);
    expect(found.length).toBeGreaterThan(0);
    expect(pageKeyOf(found[0]!)).toBe(pageKey);
  });

  /*
   * Monitor Groups are behind a switch. While it is off there is no Monitor
   * Groups page, and the name finds the switch; once it is on, the page
   * comes first and the switch still follows.
   */
  test('"monitor groups" finds the switch while monitor groups are off', () => {
    const off: Array<PaletteCommand> = toCommands(
      build({
        availability: { ...ALL_ON, isMonitorGroupsEnabled: false },
      }),
    );

    expect(pageKeyOf(results("monitor groups", off)[0]!)).toBe(
      PageMap.SETTINGS_FEATURE_FLAGS,
    );
  });

  test('"monitor groups" opens the groups once they are on, the switch next', () => {
    const keys: Array<string> = results("monitor groups", commands).map(
      pageKeyOf,
    );

    expect(keys[0]).toBe(PageMap.MONITOR_GROUPS);
    expect(keys).toContain(PageMap.SETTINGS_FEATURE_FLAGS);
  });

  test('"timezone" no longer opens the on-call Schedule Timeline first', () => {
    const found: Array<PaletteCommand> = results("timezone", commands);
    expect(pageKeyOf(found[0]!)).not.toBe(
      PageMap.ON_CALL_DUTY_SCHEDULE_TIMELINE,
    );
  });

  test('"notification channels" no longer opens a Slack page first', () => {
    const found: Array<PaletteCommand> = results(
      "notification channels",
      commands,
    );
    // The setting itself, on the page it is on.
    expect(found[0]!.title).toBe("Notification Channels");
    expect(found[0]!.breadcrumb).toEqual([
      "Project Settings",
      "Notifications",
      "Notification Settings",
    ]);
    expect(pageKeyOf(found[0]!)).toBe(PageMap.SETTINGS_NOTIFICATION_SETTINGS);
  });
});

/*
 * A row called "Billing" for "cancel plan" never said why it was found: a
 * setting is a result of its own, by the name its card shows, under the
 * page it is on, and opens that page.
 */
describe("each setting is a result of its own", () => {
  const descriptors: Array<PageSearchCommandDescriptor> = build();

  const settingRows: Array<PageSearchCommandDescriptor> = descriptors.filter(
    (descriptor: PageSearchCommandDescriptor): boolean => {
      return descriptor.isSetting;
    },
  );

  test("one for every setting the index lists, and only those", () => {
    const listed: number = ENTRIES_WITH_SETTINGS.reduce(
      (count: number, entry: PageSearchIndexEntry): number => {
        return count + getOfferedPageSettings(entry.page, ALL_ON).length;
      },
      0,
    );

    expect(settingRows.length).toBe(listed);
    expect(settingRows.length).toBeGreaterThanOrEqual(65);

    for (const row of settingRows) {
      expect(row.isAction).toBe(false);
    }
  });

  test("each has an id of its own, kept across languages", () => {
    const ids: Array<string> = settingRows.map(
      (row: PageSearchCommandDescriptor): string => {
        return row.id;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);

    const german: Array<string> = build({
      translate: (text: string): string => {
        return `[de] ${text}`;
      },
    })
      .filter((descriptor: PageSearchCommandDescriptor): boolean => {
        return descriptor.isSetting;
      })
      .map((descriptor: PageSearchCommandDescriptor): string => {
        return descriptor.id;
      });

    expect(german).toEqual(ids);
  });

  test.each(
    ENTRIES_WITH_SETTINGS.flatMap(
      (entry: PageSearchIndexEntry): Array<[string, PageSearchIndexEntry]> => {
        return getOfferedPageSettings(entry.page, ALL_ON).map(
          (setting: PageSearchSetting): [string, PageSearchIndexEntry] => {
            return [setting.name, entry];
          },
        );
      },
    ),
  )(
    "%s is named as its card names it, under the page it is on, which it opens",
    (name: string, entry: PageSearchIndexEntry) => {
      const page: PageSearchCommandDescriptor | undefined = descriptors.find(
        (descriptor: PageSearchCommandDescriptor): boolean => {
          return (
            !descriptor.isSetting &&
            !descriptor.isAction &&
            descriptor.routePath.split("#")[0] ===
              TEMPLATE(entry.page.page).replace(":projectId", "project-a")
          );
        },
      );
      const row: PageSearchCommandDescriptor | undefined = settingRows.find(
        (candidate: PageSearchCommandDescriptor): boolean => {
          return (
            candidate.title === name &&
            candidate.onPageId === page?.id &&
            Boolean(page)
          );
        },
      );

      expect(page).toBeDefined();
      expect(row).toBeDefined();
      // Where it lives: the page's own breadcrumb, then the page.
      expect(row!.breadcrumb).toEqual(
        page!.breadcrumb[page!.breadcrumb.length - 1] === page!.title
          ? page!.breadcrumb
          : [...page!.breadcrumb, page!.title],
      );
      expect(row!.routePath.split("#")[0]).toBe(page!.routePath);
      expect(row!.icon).toBe(page!.icon);
    },
  );

  test("between equally good matches a page comes first, and a setting never before its page", () => {
    const sso: PageSearchCommandDescriptor | undefined = descriptors.find(
      (descriptor: PageSearchCommandDescriptor): boolean => {
        return !descriptor.isSetting && descriptor.title === "SSO";
      },
    );
    const saml: PageSearchCommandDescriptor | undefined = settingRows.find(
      (row: PageSearchCommandDescriptor): boolean => {
        return row.title === "SAML";
      },
    );

    expect(getPageSearchCommandRanking(sso!)).toEqual({ searchPriority: 1 });
    expect(getPageSearchCommandRanking(saml!)).toEqual({
      searchPriority: 0.5,
      onPageCommandId: sso!.id,
    });

    const commands: Array<PaletteCommand> = toCommands(descriptors);

    /*
     * "saml" is a word for the SSO page and its SAML card's name; "single
     * sign-on" a word for the page and in its test card's name. The page
     * first, then the card.
     */
    expect(
      results("saml", commands)
        .slice(0, 2)
        .map((command: PaletteCommand): string => {
          return command.title;
        }),
    ).toEqual(["SSO", "SAML"]);
    expect(
      results("single sign-on", commands)
        .slice(0, 2)
        .map((command: PaletteCommand): string => {
          return command.title;
        }),
    ).toEqual(["SSO", "Test Single Sign On (SSO)"]);
  });

  test("a setting never repeats the name of the page it is on", () => {
    for (const entry of ENTRIES_WITH_SETTINGS) {
      for (const setting of entry.page.settings || []) {
        expect(settingName(setting).trim().toLowerCase()).not.toBe(
          entry.page.title.trim().toLowerCase(),
        );
      }
    }
  });
});

/*
 * A setting that waits folded under its page's More settings: a result that
 * opened the page at its top landed on the page with the setting it was for
 * hidden. It opens the page at the setting's card, where the fold opens by
 * itself (AdvancedPageSection), as the project's own mail servers and
 * Twilio accounts do.
 */
describe("a folded setting opens its fold at its card", () => {
  // In the order the index lists them.
  const FOLDED: Array<{ name: string; pageKey: string; place: string }> = [
    {
      name: "Retention by Telemetry Type",
      pageKey: PageMap.SETTINGS_TELEMETRY_SETTINGS,
      place: RETENTION_BY_TELEMETRY_TYPE_PLACE,
    },
    {
      name: "Daily limits",
      pageKey: PageMap.SETTINGS_AI_FEATURES,
      place: PROJECT_AI_DAILY_LIMITS_CARD_KEY,
    },
    {
      name: "Daily AI Token Limit",
      pageKey: PageMap.SETTINGS_AI_FEATURES,
      place: PROJECT_AI_DAILY_LIMITS_CARD_KEY,
    },
    {
      name: "Daily AI Spend Limit (USD)",
      pageKey: PageMap.SETTINGS_AI_FEATURES,
      place: PROJECT_AI_DAILY_LIMITS_CARD_KEY,
    },
  ];

  test.each(FOLDED)(
    "$name opens its page at its card",
    (folded: { name: string; pageKey: string; place: string }) => {
      const row: PageSearchCommandDescriptor | undefined = build().find(
        (descriptor: PageSearchCommandDescriptor): boolean => {
          return descriptor.isSetting && descriptor.title === folded.name;
        },
      );

      expect(row?.routePath).toBe(
        `${TEMPLATE(folded.pageKey).replace(":projectId", "project-a")}#${folded.place}`,
      );
    },
  );

  test("only those carry a place, and each place is its card's", () => {
    const anchored: Array<string> = ENTRIES_WITH_SETTINGS.flatMap(
      (entry: PageSearchIndexEntry): Array<string> => {
        return (entry.page.settings || [])
          .filter((setting: string | PageSearchSetting): boolean => {
            return typeof setting !== "string" && Boolean(setting.anchor);
          })
          .map((setting: string | PageSearchSetting): string => {
            return settingName(setting);
          });
      },
    );

    expect(anchored).toEqual(
      FOLDED.map((folded: { name: string }): string => {
        return folded.name;
      }),
    );
    expect([
      PROJECT_AI_DAILY_LIMITS_CARD_KEY,
      RETENTION_BY_TELEMETRY_TYPE_PLACE,
    ]).toEqual(["DailyLimits", "retention-by-telemetry-type"]);
  });

  test("a setting in sight opens its page as it is", () => {
    const row: PageSearchCommandDescriptor | undefined = build().find(
      (descriptor: PageSearchCommandDescriptor): boolean => {
        return descriptor.isSetting && descriptor.title === "Cancel Plan";
      },
    );

    expect(row?.routePath).toBe("/dashboard/project-a/settings_billing");
  });
});

describe("a setting there only on OneUptime Cloud is offered only there", () => {
  const project: PageSearchPage = ENTRIES.find(
    (entry: PageSearchIndexEntry): boolean => {
      return entry.page.page === PageMap.SETTINGS;
    },
  )!.page;

  const offeredNames: (
    page: PageSearchPage,
    availability: PageSearchAvailability,
  ) => Array<string> = (
    page: PageSearchPage,
    availability: PageSearchAvailability,
  ): Array<string> => {
    return getOfferedPageSettings(page, availability).map(
      (setting: PageSearchSetting): string => {
        return setting.name;
      },
    );
  };

  test("Customer Support Access finds the Project page on OneUptime Cloud", () => {
    expect(offeredNames(project, ALL_ON)).toContain("Customer Support Access");
  });

  test("and nothing where the card is not drawn", () => {
    const names: Array<string> = offeredNames(project, SELF_HOSTED);

    expect(names).not.toContain("Customer Support Access");
    // The project's own details are everywhere.
    expect(names).toContain("Project Details");

    const commands: Array<PaletteCommand> = toCommands(
      build({ availability: SELF_HOSTED }),
    );
    const found: Array<PaletteCommand> = results(
      "customer support access",
      commands,
    );
    expect(
      found.map((command: PaletteCommand): string => {
        return pageKeyOf(command);
      }),
    ).not.toContain(PageMap.SETTINGS);
  });

  test("Notification Settings' balance is named only where there is one", () => {
    const notificationSettings: PageSearchPage = ENTRIES.find(
      (entry: PageSearchIndexEntry): boolean => {
        return entry.page.page === PageMap.SETTINGS_NOTIFICATION_SETTINGS;
      },
    )!.page;
    expect(offeredNames(notificationSettings, ALL_ON)).toEqual([
      "Notification Channels",
      "Current Balance",
      "Auto Recharge",
    ]);
    expect(offeredNames(notificationSettings, SELF_HOSTED)).toEqual([
      "Notification Channels",
    ]);
  });
});

describe("in the reader's language", () => {
  const german: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_SRC, "Locales", "de.json"), "utf8"),
  ) as Record<string, unknown>;

  const translate: (text: string) => string = (text: string): string => {
    const value: unknown = german[text];
    return typeof value === "string" ? value : text;
  };

  const commands: Array<PaletteCommand> = toCommands(
    build({ translate: translate }),
  );

  test.each([
    ["Require SSO for Login", PageMap.SETTINGS_SSO],
    ["Customer Support Access", PageMap.SETTINGS],
    ["Cancel Plan", PageMap.SETTINGS_BILLING],
    ["Notification Channels", PageMap.SETTINGS_NOTIFICATION_SETTINGS],
    ["Remind me before shifts", PageMap.USER_SETTINGS_ON_CALL_CALENDAR_FEED],
  ])(
    "the German name of %s finds its page, and so does the English",
    (english: string, pageKey: string) => {
      const shown: string = translate(english);
      expect(shown).not.toBe(english);

      expect(pageKeyOf(results(shown, commands)[0]!)).toBe(pageKey);
      expect(pageKeyOf(results(english, commands)[0]!)).toBe(pageKey);
    },
  );

  test("a setting reads in German, and its English name is searched as its name", () => {
    const germanRows: Array<PageSearchCommandDescriptor> = build({
      translate: translate,
    }).filter((descriptor: PageSearchCommandDescriptor): boolean => {
      return descriptor.isSetting;
    });

    const requireSso: PageSearchCommandDescriptor | undefined = germanRows.find(
      (row: PageSearchCommandDescriptor): boolean => {
        return row.titleAliases.includes("Require SSO for Login");
      },
    );

    expect(requireSso?.title).toBe("SSO für die Anmeldung erzwingen");
    expect(requireSso?.titleAliases).toEqual(["Require SSO for Login"]);

    // "SAML" reads the same in German: no second name for it.
    const saml: PageSearchCommandDescriptor | undefined = germanRows.find(
      (row: PageSearchCommandDescriptor): boolean => {
        return row.title === "SAML";
      },
    );

    expect(saml?.titleAliases).toEqual([]);
  });
});

const SOURCE_FILE: RegExp = /\.tsx?$/;
const SPACES: RegExp = /\s+/;

// Every .ts/.tsx under a folder, as text.
const readSources: (dir: string) => Array<string> = (
  dir: string,
): Array<string> => {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const sources: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "Locales") {
      continue;
    }

    const full: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      sources.push(...readSources(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      if (full.endsWith(path.join("CommandPalette", "PageSearchIndex.ts"))) {
        continue;
      }

      sources.push(fs.readFileSync(full, "utf8"));
    }
  }

  return sources;
};

/*
 * Names written only by the Enterprise Edition's own pages: checked when
 * ee/ is here, as it is where the Enterprise Edition is built.
 */
const ENTERPRISE_ONLY_NAMES: Array<string> = [
  "SCIM (System for Cross-domain Identity Management)",
];

describe("each name is the one its card or switch shows", () => {
  const dashboardSources: string = readSources(DASHBOARD_SRC).join("\n");
  const enterpriseSources: string = readSources(EE_DASHBOARD).join("\n");

  const names: Array<string> = ENTRIES_WITH_SETTINGS.flatMap(
    (entry: PageSearchIndexEntry): Array<string> => {
      return (entry.page.settings || []).map(settingName);
    },
  );

  // "Cancel Plan" or `Cancel Plan`: a string the source writes whole.
  const isWritten: (sources: string, name: string) => boolean = (
    sources: string,
    name: string,
  ): boolean => {
    return (
      sources.includes(JSON.stringify(name)) || sources.includes(`\`${name}\``)
    );
  };

  test.each(names)(
    "%s is written in the Dashboard's source",
    (name: string) => {
      if (ENTERPRISE_ONLY_NAMES.includes(name)) {
        if (IS_EE_PRESENT) {
          expect(isWritten(enterpriseSources, name)).toBe(true);
        }
        return;
      }

      expect(isWritten(dashboardSources, name)).toBe(true);
    },
  );
});

/*
 * The routes files of the settings areas: which page file each page key
 * draws.
 */
const ROUTE_FILES: Array<string> = [
  path.join(DASHBOARD_SRC, "Routes", "SettingsRoutes.tsx"),
  path.join(DASHBOARD_SRC, "Routes", "UserSettingsRoutes.tsx"),
  path.join(DASHBOARD_SRC, "Routes", "TeamsRoutes.tsx"),
  path.join(DASHBOARD_SRC, "Routes", "UsersRoutes.tsx"),
  path.join(DASHBOARD_SRC, "App.tsx"),
];

// The settings areas' page folders.
const SETTINGS_PAGE_DIRS: Array<string> = [
  path.join(DASHBOARD_SRC, "Pages", "Settings"),
  path.join(DASHBOARD_SRC, "Pages", "UserSettings"),
  path.join(DASHBOARD_SRC, "Pages", "Teams"),
  path.join(DASHBOARD_SRC, "Pages", "Users"),
  path.join(DASHBOARD_SRC, "Pages", "Global", "UserProfile"),
];

const parse: (file: string) => ts.SourceFile = (
  file: string,
): ts.SourceFile => {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
};

const PAGE_MAP_KEY: RegExp = /PageMap\.([A-Z0-9_]+)/;

// page file (absolute, no extension) -> the page keys it is drawn for
const readPageFiles: () => Map<string, Set<string>> = (): Map<
  string,
  Set<string>
> => {
  const pageFiles: Map<string, Set<string>> = new Map();

  for (const routesFile of ROUTE_FILES) {
    const sourceFile: ts.SourceFile = parse(routesFile);
    const importedFrom: Map<string, string> = new Map();

    const resolve: (specifier: string) => string = (
      specifier: string,
    ): string => {
      return path.resolve(path.dirname(routesFile), specifier);
    };

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      // import X from "../Pages/Settings/File";
      if (
        ts.isImportDeclaration(node) &&
        node.importClause?.name &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        importedFrom.set(
          node.importClause.name.getText(sourceFile),
          resolve(node.moduleSpecifier.text),
        );
      }

      // const X = lazy(() => import("../Pages/Settings/File"));
      if (
        ts.isVariableDeclaration(node) &&
        node.initializer &&
        node.initializer.getText(sourceFile).startsWith("lazy(")
      ) {
        const lazyImport: RegExpExecArray | null = LAZY_IMPORT.exec(
          node.initializer.getText(sourceFile),
        );

        if (lazyImport) {
          importedFrom.set(
            node.name.getText(sourceFile),
            resolve(lazyImport[1]!),
          );
        }
      }

      // <PageRoute path={...PageMap.X...} element={<X ... />} />
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        node.tagName.getText(sourceFile) === "PageRoute"
      ) {
        let pageKey: string | undefined;
        let elementName: string | undefined;

        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute) || !attribute.initializer) {
            continue;
          }

          const name: string = attribute.name.getText(sourceFile);
          const text: string = attribute.initializer.getText(sourceFile);

          if (name === "path" || name === "element") {
            const key: RegExpExecArray | null = PAGE_MAP_KEY.exec(text);

            if (key && !pageKey) {
              pageKey = key[1];
            }
          }

          if (name === "element") {
            const tag: RegExpExecArray | null = ELEMENT_TAG.exec(text);

            if (tag) {
              elementName = tag[1];
            }
          }
        }

        const file: string | undefined = elementName
          ? importedFrom.get(elementName)
          : undefined;

        if (pageKey && file) {
          const keys: Set<string> = pageFiles.get(file) || new Set<string>();
          keys.add(pageKey);
          pageFiles.set(file, keys);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return pageFiles;
};

const LAZY_IMPORT: RegExp = /import\(\s*"([^"]+)"\s*\)/;
const ELEMENT_TAG: RegExp = /^\{\s*<([A-Za-z0-9_]+)/;

// The literal card titles a page file writes.
const readCardTitles: (file: string) => Array<string> = (
  file: string,
): Array<string> => {
  const sourceFile: ts.SourceFile = parse(file);
  const titles: Array<string> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name: string = node.name.getText(sourceFile);
      const element: ts.Node = node.parent.parent;
      const tag: string =
        ts.isJsxSelfClosingElement(element) || ts.isJsxOpeningElement(element)
          ? element.tagName.getText(sourceFile)
          : "";

      // cardProps={{ title: "..." }} on a CardModelDetail or a ModelTable.
      if (
        name === "cardProps" &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression &&
        ts.isObjectLiteralExpression(node.initializer.expression)
      ) {
        for (const property of node.initializer.expression.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            property.name.getText(sourceFile) === "title" &&
            ts.isStringLiteral(property.initializer)
          ) {
            titles.push(property.initializer.text);
          }
        }
      }

      // <Card title="..."> and a switch card's cardTitle="...".
      if ((name === "title" && tag === "Card") || name === "cardTitle") {
        if (ts.isStringLiteral(node.initializer)) {
          titles.push(node.initializer.text);
        } else if (
          ts.isJsxExpression(node.initializer) &&
          node.initializer.expression &&
          (ts.isStringLiteral(node.initializer.expression) ||
            ts.isNoSubstitutionTemplateLiteral(node.initializer.expression))
        ) {
          titles.push(node.initializer.expression.text);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return titles;
};

/*
 * Every way a page is found: its title, keywords, settings and actions -
 * and, for the first page of a product (All Teams), the product's own name,
 * which the products menu's entry finds.
 */
const namesOf: (page: PageSearchPage) => Array<string> = (
  page: PageSearchPage,
): Array<string> => {
  const area: PageSearchArea | undefined = AREAS.find(
    (candidate: PageSearchArea): boolean => {
      return candidate.productPage === page.page;
    },
  );

  return [
    ...(area ? [area.title] : []),
    page.title,
    ...(page.keywords || []),
    ...(page.settings || []).map(settingName),
    ...(page.actions || []).map((action: { title: string }): string => {
      return action.title;
    }),
  ].map((name: string): string => {
    return name.trim().toLowerCase();
  });
};

/*
 * Cards a settings page writes by name that are not settings to look for:
 * each with the reason.
 */
const NOT_A_SETTING: Record<string, string> = {
  Providers:
    "A heading on the Video Calls page, under its own name: 'video calls' and each provider's name (Zoom, Google Meet) find it.",
  "Cannot Delete Account":
    "What Delete Account says instead of its button while the account still owns a project: not a setting of its own.",
};

describe("every card a settings page writes by name is a way to its page", () => {
  const pageFiles: Map<string, Set<string>> = readPageFiles();

  const pageFilesInSettings: Array<string> = [...pageFiles.keys()].filter(
    (file: string): boolean => {
      return SETTINGS_PAGE_DIRS.some((dir: string): boolean => {
        return file.startsWith(dir + path.sep);
      });
    },
  );

  test("the routes are read: the settings pages are found", () => {
    expect(pageFilesInSettings.length).toBeGreaterThanOrEqual(40);
  });

  const indexed: Map<string, PageSearchPage> = new Map(
    ENTRIES.map((entry: PageSearchIndexEntry): [string, PageSearchPage] => {
      return [entry.page.page, entry.page];
    }),
  );

  test("each card title is the page's name, a word for it, or one of its settings", () => {
    const missing: Array<string> = [];
    let checked: number = 0;

    for (const file of pageFilesInSettings) {
      const fileWithExtension: string = fs.existsSync(`${file}.tsx`)
        ? `${file}.tsx`
        : `${file}.ts`;

      if (!fs.existsSync(fileWithExtension)) {
        continue;
      }

      for (const pageKey of pageFiles.get(file) || []) {
        const page: PageSearchPage | undefined = indexed.get(pageKey);

        // A record's own page (an API key's) is not a page Search offers.
        if (!page) {
          continue;
        }

        const names: Array<string> = namesOf(page);

        for (const title of readCardTitles(fileWithExtension)) {
          if (title in NOT_A_SETTING) {
            expect(NOT_A_SETTING[title]!.length).toBeGreaterThan(20);
            continue;
          }

          checked += 1;

          if (!names.includes(title.trim().toLowerCase())) {
            missing.push(
              `${path.relative(DASHBOARD_SRC, fileWithExtension)} (${pageKey}): "${title}"`,
            );
          }
        }
      }
    }

    expect(missing).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(15);
  });

  test("a gate a setting carries is one the index knows", () => {
    for (const entry of ENTRIES_WITH_SETTINGS) {
      for (const setting of entry.page.settings || []) {
        if (typeof setting !== "string" && setting.gate) {
          expect(Object.values(PageSearchGate)).toContain(setting.gate);
        }
      }
    }
  });
});
