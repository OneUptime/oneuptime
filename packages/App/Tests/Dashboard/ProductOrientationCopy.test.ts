import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The copy that orients a new user in a very large product: what each item in
 * the Products menu is for, what each core list page holds, the Home
 * "How OneUptime works" strip and the Getting Started checklist.
 *
 * Copy fails quietly. A locale missing a key shows English (or a raw key) to
 * that user, a rewritten English string silently orphans its translations,
 * and a boilerplate description ("Here is a list of incidents for this
 * project.") tells nobody anything. The App suite runs in plain Node and cannot
 * import dashboard components (they read browser globals at load), so these
 * are source- and locale-level invariants. The rendered behaviour is pinned in
 * Common/Tests/App/Dashboard/ProductOrientation.test.tsx.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

type Locale = Record<string, unknown>;

const readSource: (...segments: Array<string>) => string = (
  ...segments: Array<string>
): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...segments), "utf8");
};

const localeFiles: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .sort();

const locales: Record<string, Locale> = {};
for (const file of localeFiles) {
  locales[file.replace(/\.json$/, "")] = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Locale;
}

const nonEnglish: Array<string> = Object.keys(locales).filter(
  (code: string): boolean => {
    return code !== "en";
  },
);

const nested: (locale: Locale, key: string) => unknown = (
  locale: Locale,
  key: string,
): unknown => {
  let cursor: unknown = locale;
  for (const part of key.split(".")) {
    if (!cursor || typeof cursor !== "object") {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
};

const unescapeLiteral: (literal: string) => string = (
  literal: string,
): string => {
  return JSON.parse(`"${literal}"`) as string;
};

/*
 * Every English literal a file hands to the UI in the shapes these files use:
 * `title: "..."`, `description:\n "..."`, `tx("...")`, JSX `title="..."` /
 * `description="..."`, and exported `HOW_IT_WORKS_*` string constants.
 */
const STRING_LITERAL: string = `"((?:[^"\\\\]|\\\\.)*)"`;
const LITERAL_PATTERNS: Array<RegExp> = [
  new RegExp(`\\btitle:\\s*${STRING_LITERAL}`, "g"),
  new RegExp(`\\bdescription:\\s*${STRING_LITERAL}`, "g"),
  new RegExp(`\\btx\\(\\s*${STRING_LITERAL}\\s*\\)`, "g"),
  new RegExp(`\\btitle=${STRING_LITERAL}`, "g"),
  new RegExp(`\\bdescription=${STRING_LITERAL}`, "g"),
  new RegExp(`HOW_IT_WORKS_\\w+: string =\\s*${STRING_LITERAL}`, "g"),
];

const uiLiterals: (source: string) => Array<string> = (
  source: string,
): Array<string> => {
  const found: Set<string> = new Set();
  for (const pattern of LITERAL_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      found.add(unescapeLiteral(match[1]!));
    }
  }
  return Array.from(found);
};

// Products menu keys this change rewrote or added.
const NAV_DESCRIPTION_KEYS: Array<string> = [
  "navbar.items.monitorsDescription",
  "navbar.items.slosDescription",
  "navbar.items.statusPagesDescription",
  "navbar.items.incidentsDescription",
  "navbar.items.alertsDescription",
  "navbar.items.onCallDutyDescription",
  "navbar.items.scheduledMaintenanceDescription",
  "navbar.items.dashboardsDescription",
  "navbar.items.workflowsDescription",
  "navbar.items.projectSettingsDescription",
];

// Single words that are legitimately spelled the same in some languages.
const COGNATE_KEYS: Array<string> = [
  "navbar.categories.infrastructure",
  "help.documentation",
];

// The core list pages and the file holding each one's card description.
const LIST_PAGES: Array<[string, Array<string>]> = [
  ["Monitors", ["Components", "Monitor", "MonitorTable.tsx"]],
  ["Incidents", ["Components", "Incident", "IncidentsTable.tsx"]],
  ["Alerts", ["Components", "Alert", "AlertsTable.tsx"]],
  [
    "Scheduled Maintenance",
    ["Components", "ScheduledMaintenance", "ScheduledMaintenanceTable.tsx"],
  ],
  ["Status Pages", ["Pages", "StatusPages", "StatusPages.tsx"]],
  ["On-Call Policies", ["Pages", "OnCallDuty", "OnCallDutyPolicies.tsx"]],
];

const cardDescription: (source: string) => string = (
  source: string,
): string => {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(
      `cardProps=\\{\\{[\\s\\S]*?description:\\s*(?:props\\.description\\s*\\|\\|\\s*)?${STRING_LITERAL}`,
    ),
  );
  expect(match).not.toBeNull();
  return unescapeLiteral(match![1]!);
};

describe("the locale files", () => {
  test("all 17 are present", () => {
    expect(localeFiles).toHaveLength(17);
  });

  test("the navbar and help sections have the same keys in the same order everywhere", () => {
    /*
     * Line-parallel locale files are what make a 17-language diff reviewable;
     * a key added to one file at a different spot still validates but drifts.
     */
    const shape: (locale: Locale) => string = (locale: Locale): string => {
      return JSON.stringify(
        ["navbar", "help"].map((section: string) => {
          return JSON.stringify(
            locale[section],
            (_key: string, value: unknown) => {
              return typeof value === "string" ? "" : value;
            },
          );
        }),
      );
    };
    for (const code of nonEnglish) {
      expect(shape(locales[code]!)).toBe(shape(locales["en"]!));
    }
  });
});

describe("Products menu copy", () => {
  test.each(Object.keys(locales))(
    "%s has a non-empty value for every rewritten or new key",
    (code: string) => {
      for (const key of [
        ...NAV_DESCRIPTION_KEYS,
        ...COGNATE_KEYS,
        "navbar.categories.analyticsAutomation",
      ]) {
        const value: unknown = nested(locales[code]!, key);
        expect(typeof value).toBe("string");
        expect((value as string).trim().length).toBeGreaterThan(0);
      }
    },
  );

  test.each(nonEnglish)(
    "%s translates every rewritten description (none left in English)",
    (code: string) => {
      for (const key of [
        ...NAV_DESCRIPTION_KEYS,
        "navbar.categories.analyticsAutomation",
      ]) {
        expect(nested(locales[code]!, key)).not.toBe(
          nested(locales["en"]!, key),
        );
      }
    },
  );

  test.each(Object.keys(locales))(
    "%s no longer names a Products menu section 'More'",
    (code: string) => {
      /*
       * The section used to be labelled with each locale's word for "More"
       * — a "More" heading inside the products menu tells nobody what is in
       * it. Compare with the locale's own flat "More" translation.
       */
      const locale: Locale = locales[code]!;
      expect(typeof locale["More"]).toBe("string");
      expect(nested(locale, "navbar.categories.analyticsAutomation")).not.toBe(
        locale["More"],
      );
    },
  );

  test("the English descriptions say what each product is for", () => {
    const en: Locale = locales["en"]!;

    expect(nested(en, "navbar.items.alertsDescription")).not.toBe(
      "Notification management.",
    );
    expect(nested(en, "navbar.items.monitorsDescription")).not.toBe(
      "Monitor any resource.",
    );
    expect(nested(en, "navbar.items.incidentsDescription")).not.toBe(
      "Detect and resolve fast.",
    );
    // The one distinction new users ask about most: who is affected.
    expect(nested(en, "navbar.items.incidentsDescription")).toContain(
      "affect your users",
    );
    expect(nested(en, "navbar.items.alertsDescription")).toContain(
      "before users notice",
    );
    expect(nested(en, "navbar.categories.infrastructure")).toBe(
      "Infrastructure",
    );
    expect(nested(en, "help.documentation")).toBe("Documentation");
  });

  test("the navigation catalog reads the new category key, with an English default", () => {
    const source: string = readSource("Utils", "NavigationItems.tsx").replace(
      /\s+/g,
      "",
    );
    expect(source).toContain(
      't("navbar.categories.infrastructure","Infrastructure",)',
    );
    expect(source).toContain("category:infrastructureCategory");
  });
});

describe("core list pages explain what they hold", () => {
  test.each(LIST_PAGES)(
    "%s describes the concept instead of 'Here is a list of ...'",
    (_name: string, file: Array<string>) => {
      const description: string = cardDescription(readSource(...file));

      expect(description).not.toMatch(/^Here is a list of/);
      // A sentence that explains something, not a caption.
      expect(description.length).toBeGreaterThanOrEqual(60);
    },
  );

  test.each(LIST_PAGES)(
    "%s description is translated in every locale",
    (_name: string, file: Array<string>) => {
      const description: string = cardDescription(readSource(...file));

      expect(locales["en"]![description]).toBe(description);
      for (const code of nonEnglish) {
        const value: unknown = locales[code]![description];
        expect(typeof value).toBe("string");
        expect(value).not.toBe(description);
      }
    },
  );

  test("the Alerts page tells users how alerts differ from incidents", () => {
    const description: string = cardDescription(
      readSource("Components", "Alert", "AlertsTable.tsx"),
    );
    expect(description).toContain("Unlike incidents");
    expect(description).toContain("status pages");
  });
});

describe("Home orientation copy", () => {
  const FILES: Array<Array<string>> = [
    ["Components", "Home", "HowOneUptimeWorks.tsx"],
    ["Components", "Home", "GettingStarted.tsx"],
  ];

  const literals: Array<string> = FILES.flatMap(
    (file: Array<string>): Array<string> => {
      return uiLiterals(readSource(...file));
    },
  );

  test("the literal scan found the copy (guards the scanner itself)", () => {
    expect(literals).toEqual(
      expect.arrayContaining([
        "How OneUptime works",
        "Incidents & Alerts",
        "Pages the right person, and escalates if nobody answers.",
        "Welcome to OneUptime 👋",
        "Dismiss",
        "steps completed",
        "Create your first monitor",
        "Route alerts and incidents to the right person at the right time.",
      ]),
    );
    expect(literals.length).toBeGreaterThanOrEqual(23);
  });

  test("every English literal is a key in en.json that maps to itself", () => {
    for (const literal of literals) {
      expect([literal, locales["en"]![literal]]).toEqual([literal, literal]);
    }
  });

  test.each(nonEnglish)("%s translates every Home literal", (code: string) => {
    for (const literal of literals) {
      const value: unknown = locales[code]![literal];
      expect([literal, typeof value]).toEqual([literal, "string"]);
      expect([literal, value]).not.toEqual([literal, literal]);
    }
  });

  test.each(nonEnglish)(
    "%s footnote names the Products menu by its translated label",
    (code: string) => {
      /*
       * The footnote sends users to "Products"; in each language that has to
       * be the word on the actual button, or they will not find it.
       */
      const footnote: string = locales[code]![
        "That is the core. Logs, metrics, traces, infrastructure and everything else are optional — find them under Products when you need them."
      ] as string;
      const productsLabel: string = locales[code]!["Products"] as string;
      expect(typeof productsLabel).toBe("string");
      expect(footnote).toContain(productsLabel);
    },
  );
});

describe("Help menu", () => {
  const source: string = readSource("Components", "Header", "Help.tsx").replace(
    /\s+/g,
    "",
  );

  test("links to this instance's docs, not a hard-coded public URL", () => {
    expect(source).toContain('import{DOCS_URL}from"Common/UI/Config";');
    expect(source).toContain("url={URL.fromString(DOCS_URL.toString())}");
    expect(source).not.toContain("oneuptime.com/docs");
  });

  test("the Documentation entry comes before every other entry", () => {
    const docs: number = source.indexOf('t("help.documentation"');
    expect(docs).toBeGreaterThan(-1);
    for (const other of [
      't("keyboardShortcuts.title"',
      't("help.supportEmail")',
      't("help.chatSlack")',
      't("help.requestDemo")',
    ]) {
      expect(source.indexOf(other)).toBeGreaterThan(docs);
    }
  });
});
