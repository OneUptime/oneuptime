import PageMap from "../../FeatureSet/AdminDashboard/src/Utils/PageMap";
import RouteMap from "../../FeatureSet/AdminDashboard/src/Utils/RouteMap";
import {
  DAILY_BUDGET_TITLES,
  getDailyBudgetFormFields,
  getRateLimitFormFields,
  IngestionBudgetLevel,
  INSTANCE_EMPTY_PLACEHOLDER,
  PROJECT_EMPTY_PLACEHOLDER,
  RATE_LIMIT_TITLES,
} from "../../FeatureSet/AdminDashboard/src/Utils/IngestionBudgetFormFields";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import Route from "Common/Types/API/Route";
import {
  TELEMETRY_INGESTION_BUDGET_COLUMNS,
  TELEMETRY_INGESTION_BUDGET_MAX_DAILY_GB,
  TELEMETRY_INGESTION_BUDGET_MAX_RATE_MB_PER_SECOND,
  TELEMETRY_INGESTION_BUDGET_SIGNALS,
  TelemetryIngestionBudgetSignal,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import FormField from "Common/UI/Components/Forms/Types/Field";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { ADMIN_DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import {
  RouteAttributes,
  pageRoutesIn,
  routeMapPath,
  routesAt,
} from "../Helpers/PageRoutes";

/*
 * THE INSTANCE ADMIN'S TELEMETRY INGESTION BUDGETS (issue #5917):
 *
 *   - Settings > Telemetry > Ingestion Budgets: the daily budget and the
 *     per-second rate every project gets for each signal, and the warning
 *     and the reset;
 *   - Projects > a project > Ingestion Budgets: what the project used of its
 *     budgets today, and its own budgets and rates (0 for no limit).
 *
 * The wiring is hand-written and fails silently (a misspelt column renders
 * an empty field and 400s on save), so it is held here against the source
 * and the locales; what the shared status card draws is rendered in Common's
 * TelemetryIngestionBudgetStatusCard.test.tsx.
 */

const ADMIN_SRC: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "AdminDashboard",
  "src",
);
const DASHBOARD_LOCALES: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);
const ADMIN_STRINGS: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
  "Components",
  "TelemetryIngestionBudget",
);

const read: (...parts: Array<string>) => string = (
  ...parts: Array<string>
): string => {
  return fs.readFileSync(path.join(ADMIN_SRC, ...parts), "utf8");
};

/*
 * Code with no whitespace and no trailing commas, so a check holds however
 * prettier wraps it.
 */
const compact: (code: string) => string = (code: string): string => {
  return code.replace(/\s+/g, "").replace(/,(?=[)}\]])/g, "");
};

type Locale = Record<string, unknown>;

const readLocale: (folder: string, language: string) => Locale = (
  folder: string,
  language: string,
): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(folder, `${language}.json`), "utf8"),
  ) as Locale;
};

const valueAt: (locale: Locale, key: string) => unknown = (
  locale: Locale,
  key: string,
): unknown => {
  let value: unknown = locale;

  for (const part of key.split(".")) {
    value = (value as Locale | undefined)?.[part];
  }

  return value;
};

const LANGUAGES: ReadonlyArray<string> = [...ADMIN_DASHBOARD_LANGUAGES];

const NESTED_KEYS: ReadonlyArray<string> = [
  "breadcrumbs.ingestionBudgets",
  "sideMenu.ingestionBudgets",
  "sideMenu.settingsTelemetry",
  "sideMenu.settingsIngestionBudgets",
  "pages.settings.ingestionBudgets.dailyCardTitle",
  "pages.settings.ingestionBudgets.dailyCardDescription",
  "pages.settings.ingestionBudgets.dailyEditButton",
  "pages.settings.ingestionBudgets.resetCardTitle",
  "pages.settings.ingestionBudgets.resetCardDescription",
  "pages.settings.ingestionBudgets.resetEditButton",
  "pages.settings.ingestionBudgets.rateCardTitle",
  "pages.settings.ingestionBudgets.rateCardDescription",
  "pages.settings.ingestionBudgets.rateEditButton",
  "pages.projectView.ingestionBudgets.dailyCardTitle",
  "pages.projectView.ingestionBudgets.dailyCardDescription",
  "pages.projectView.ingestionBudgets.dailyEditButton",
  "pages.projectView.ingestionBudgets.rateCardTitle",
  "pages.projectView.ingestionBudgets.rateCardDescription",
  "pages.projectView.ingestionBudgets.rateEditButton",
];

// The words of the shared card and its forms, which the Admin locales hold flat.
const FLAT_STRINGS: ReadonlyArray<string> = [
  ...Object.values(DAILY_BUDGET_TITLES),
  ...Object.values(RATE_LIMIT_TITLES),
  "Warning Threshold (%)",
  "Reset Time",
  "Reset Time Zone",
  "Ingestion Budgets",
  "Ingestion Key Budgets",
  "No ingestion budgets",
  "Used Today",
  "Daily Budget",
  "Rate Limit",
  "Dropped",
  "Throttled",
  "No daily budget",
  "Within budget",
  "Past warning",
  "Used up",
  "Set for this project",
  "This key's own",
  "{{size}} per second",
];

describe("the Admin Dashboard's ingestion budget pages", () => {
  test("are at /admin/settings/ingestion-budgets and /admin/projects/:id/ingestion-budgets", () => {
    expect(
      (RouteMap[PageMap.SETTINGS_INGESTION_BUDGETS] as Route).toString(),
    ).toBe("/admin/settings/ingestion-budgets");
    expect(
      (RouteMap[PageMap.PROJECT_INGESTION_BUDGETS] as Route).toString(),
    ).toBe("/admin/projects/:id/ingestion-budgets");
  });

  test("are routed, each to its own page", () => {
    const app: string = compact(read("App.tsx"));

    expect(app).toContain(
      compact(
        'import SettingsIngestionBudgets from "./Pages/Settings/IngestionBudgets/Index";',
      ),
    );
    expect(app).toContain(
      compact(
        'import ProjectIngestionBudgets from "./Pages/Projects/View/IngestionBudgets";',
      ),
    );

    const routes: Array<RouteAttributes> = pageRoutesIn(
      path.join(ADMIN_SRC, "App.tsx"),
    );

    expect(
      routesAt(routes, routeMapPath("SETTINGS_INGESTION_BUDGETS")),
    ).toEqual([
      {
        path: routeMapPath("SETTINGS_INGESTION_BUDGETS"),
        element: "<SettingsIngestionBudgets />",
      },
    ]);
    expect(routesAt(routes, routeMapPath("PROJECT_INGESTION_BUDGETS"))).toEqual(
      [
        {
          path: routeMapPath("PROJECT_INGESTION_BUDGETS"),
          element: "<ProjectIngestionBudgets />",
        },
      ],
    );
  });

  test("Settings has a Telemetry section, folded like its neighbours, with Ingestion Budgets in it", () => {
    const menu: string = compact(read("Pages", "Settings", "SideMenu.tsx"));
    const section: string = menu.slice(
      menu.indexOf(compact('title={t("sideMenu.settingsTelemetry")}')),
    );

    expect(section.slice(0, 80)).toContain("defaultCollapsed={true}");
    expect(section.slice(0, 400)).toContain(
      compact('title: t("sideMenu.settingsIngestionBudgets")'),
    );
    expect(section.slice(0, 400)).toContain(
      "RouteMap[PageMap.SETTINGS_INGESTION_BUDGETS]",
    );
  });

  test("a project's Ingestion Budgets is in its side menu's Basic section, after Telemetry Usage", () => {
    const menu: string = read("Pages", "Projects", "View", "SideMenu.tsx");
    const basic: string = menu.slice(
      menu.indexOf('t("sideMenu.basic")'),
      menu.indexOf("</SideMenuSection>"),
    );

    expect(basic.indexOf('t("sideMenu.ingestionBudgets")')).toBeGreaterThan(
      basic.indexOf('t("sideMenu.telemetryUsage")'),
    );
    expect(basic).toContain("RouteMap[PageMap.PROJECT_INGESTION_BUDGETS]");
  });

  test("the project page reads today's budgets as the master admin, and edits the project's own", () => {
    const page: string = compact(
      read("Pages", "Projects", "View", "IngestionBudgets.tsx"),
    );
    const utils: string = compact(read("Utils", "TelemetryIngestionBudget.ts"));

    expect(page).toContain("<TelemetryIngestionBudgetStatusCard");
    expect(page).toContain("fetchProjectIngestionBudgetStatus(modelId)");
    expect(page).toContain(
      compact(
        "getDailyBudgetFormFields<Project>(IngestionBudgetLevel.Project)",
      ),
    );
    expect(page).toContain(
      compact("getRateLimitFormFields<Project>(IngestionBudgetLevel.Project)"),
    );
    expect(utils).toContain(
      compact(
        "`${TELEMETRY_INGESTION_BUDGET_ADMIN_PROJECTS_ROUTE}/${projectId.toString()}`",
      ),
    );
  });

  test("the settings page edits GlobalConfig's defaults, warning and reset", () => {
    const page: string = compact(
      read("Pages", "Settings", "IngestionBudgets", "Index.tsx"),
    );

    for (const column of [
      "telemetryIngestionBudgetWarningPercent:true",
      "telemetryIngestionBudgetResetTime:true",
      "telemetryIngestionBudgetResetTimezone:true",
    ]) {
      expect(page).toContain(column);
    }

    expect(page).toContain(
      compact(
        "getDailyBudgetFormFields<GlobalConfig>(IngestionBudgetLevel.Instance)",
      ),
    );
    expect(page).toContain(
      compact(
        "getRateLimitFormFields<GlobalConfig>(IngestionBudgetLevel.Instance)",
      ),
    );
    expect(page).toContain("modelId:ObjectID.getZeroObjectID()");
  });
});

describe("the budget and rate fields", () => {
  const columnOf: (field: FormField<GlobalConfig>) => string = (
    field: FormField<GlobalConfig>,
  ): string => {
    return Object.keys(field.field as Record<string, unknown>)[0] as string;
  };

  test.each([IngestionBudgetLevel.Instance, IngestionBudgetLevel.Project])(
    "one field per signal and column, in the Usage page's order, at the %s level",
    (level: IngestionBudgetLevel) => {
      const daily: Array<FormField<GlobalConfig>> =
        getDailyBudgetFormFields<GlobalConfig>(level);
      const rate: Array<FormField<GlobalConfig>> =
        getRateLimitFormFields<GlobalConfig>(level);

      expect(daily.map(columnOf)).toEqual(
        TELEMETRY_INGESTION_BUDGET_SIGNALS.map(
          (signal: TelemetryIngestionBudgetSignal): string => {
            return TELEMETRY_INGESTION_BUDGET_COLUMNS[signal].dailyBudgetInGB;
          },
        ),
      );
      expect(rate.map(columnOf)).toEqual(
        TELEMETRY_INGESTION_BUDGET_SIGNALS.map(
          (signal: TelemetryIngestionBudgetSignal): string => {
            return TELEMETRY_INGESTION_BUDGET_COLUMNS[signal]
              .rateLimitInMBPerSecond;
          },
        ),
      );

      for (const field of daily) {
        expect(field.validation?.maxValue).toBe(
          TELEMETRY_INGESTION_BUDGET_MAX_DAILY_GB,
        );
      }

      for (const field of rate) {
        expect(field.validation?.maxValue).toBe(
          TELEMETRY_INGESTION_BUDGET_MAX_RATE_MB_PER_SECOND,
        );
      }
    },
  );

  test("a project may enter 0 (no limit); an empty field is the instance default there, and no limit on the instance", () => {
    for (const field of getDailyBudgetFormFields<GlobalConfig>(
      IngestionBudgetLevel.Project,
    )) {
      expect(field.validation?.minValue).toBe(0);
      expect(field.placeholder).toBe(PROJECT_EMPTY_PLACEHOLDER);
    }

    for (const field of getDailyBudgetFormFields<GlobalConfig>(
      IngestionBudgetLevel.Instance,
    )) {
      // The server refuses 0 on the instance: empty is how no limit is said.
      expect(field.validation?.minValue).toBeUndefined();
      expect(field.placeholder).toBe(INSTANCE_EMPTY_PLACEHOLDER);
    }
  });
});

describe("the Admin locales", () => {
  test.each(["en", ...LANGUAGES])(
    "%s words every menu item, card and button of the pages",
    (language: string) => {
      const locale: Locale = readLocale(
        path.join(ADMIN_SRC, "Locales"),
        language,
      );

      for (const key of NESTED_KEYS) {
        const value: unknown = valueAt(locale, key);

        expect({
          language,
          key,
          worded: typeof value === "string" && value.trim() !== "",
        }).toEqual({
          language,
          key,
          worded: true,
        });
      }

      for (const english of FLAT_STRINGS) {
        expect({
          language,
          english,
          held: typeof locale[english] === "string",
        }).toEqual({
          language,
          english,
          held: true,
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s has its own words for the cards, and words the shared card as its Dashboard does",
    (language: string) => {
      const english: Locale = readLocale(path.join(ADMIN_SRC, "Locales"), "en");
      const locale: Locale = readLocale(
        path.join(ADMIN_SRC, "Locales"),
        language,
      );
      const dashboard: Locale = readLocale(DASHBOARD_LOCALES, language);

      for (const key of NESTED_KEYS) {
        if (key.endsWith("Description")) {
          expect({
            language,
            key,
            own: valueAt(locale, key) !== valueAt(english, key),
          }).toEqual({
            language,
            key,
            own: true,
          });
        }
      }

      for (const text of FLAT_STRINGS) {
        if (typeof dashboard[text] === "string") {
          expect({ language, text, admin: locale[text] }).toEqual({
            language,
            text,
            admin: dashboard[text],
          });
        }
      }
    },
  );

  test("the shared card's words are the ones its components look up", () => {
    const sources: string = compact(
      [
        "TelemetryIngestionBudgetStatusCard.tsx",
        "TelemetryIngestionBudgetWords.ts",
      ]
        .map((file: string): string => {
          return fs.readFileSync(path.join(ADMIN_STRINGS, file), "utf8");
        })
        .join("\n"),
    );

    for (const text of [
      "Ingestion Budgets",
      "Ingestion Key Budgets",
      "No ingestion budgets",
      "Used Today",
      "Daily Budget",
      "Rate Limit",
      "Dropped",
      "Throttled",
      "No daily budget",
      "Within budget",
      "Past warning",
      "Used up",
      "Set for this project",
      "This key's own",
      "{{size}} per second",
    ]) {
      expect({ text, used: sources.includes(compact(`"${text}"`)) }).toEqual({
        text,
        used: true,
      });
    }
  });
});
