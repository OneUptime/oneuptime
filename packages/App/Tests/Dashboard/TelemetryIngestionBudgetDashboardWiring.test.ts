import {
  TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES,
  TELEMETRY_INGESTION_BUDGET_DAILY_COLUMN_NAMES,
  TELEMETRY_INGESTION_BUDGET_RATE_COLUMN_NAMES,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE DASHBOARD'S TELEMETRY INGESTION BUDGETS (issue #5917):
 *
 *   - Project Settings > Telemetry & APM > Usage opens with today's budgets
 *     while one is set, and shows nothing more on a project with none;
 *   - an ingestion key's page edits the key's own budgets, a daily budget
 *     and a rate for each signal, and shows what the key used of them today;
 *   - each explorer draws a banner above its data while its signal's budget
 *     is past its warning or used up.
 *
 * Every locale words the new strings: they were translated with the docs
 * page that quotes them (TelemetryIngestionBudgetsDocsFacts).
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const read: (...parts: Array<string>) => string = (
  ...parts: Array<string>
): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8");
};

/*
 * Code with no whitespace and no trailing commas, so a check holds however
 * prettier wraps it.
 */
const compact: (code: string) => string = (code: string): string => {
  return code.replace(/\s+/g, "").replace(/,(?=[)}\]])/g, "");
};

const LANGUAGES: ReadonlyArray<string> = [
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

describe("the Dashboard's ingestion budgets", () => {
  test("are read from the project route, as the current project", () => {
    const helper: string = compact(
      read(
        "Components",
        "TelemetryIngestionBudget",
        "ProjectTelemetryIngestionBudget.tsx",
      ),
    );

    expect(helper).toContain(
      compact(".addRoute(TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE)"),
    );
    expect(helper).toContain("headers:ModelAPI.getCommonHeaders()");
    // The banner's link: the Usage page, where the budgets are in full.
    expect(helper).toContain("RouteMap[PageMap.SETTINGS_USAGE_HISTORY]");
  });

  test("the Usage page opens with them, and only while one is set", () => {
    const page: string = compact(read("Pages", "Settings", "UsageHistory.tsx"));
    const card: number = page.indexOf("<TelemetryIngestionBudgetStatusCard");

    expect(card).toBeGreaterThan(0);
    expect(card).toBeLessThan(page.indexOf("<TelemetryUsageOverview"));
    expect(page.slice(card, card + 200)).toContain(
      "fetchStatus={fetchProjectTelemetryIngestionBudgetStatus}hideWhenUnbudgeted={true}",
    );
  });

  test.each([
    ["Logs", "Logs"],
    ["Traces", "Traces"],
    ["Metrics", "Metrics"],
    ["Profiles", "Profiles"],
    ["SecurityEvents", "SecurityEvents"],
  ])(
    "the %s explorer draws the banner above its data",
    (folder: string, signal: string) => {
      const layout: string = compact(read("Pages", folder, "Layout.tsx"));
      const banner: number = layout.indexOf(
        compact(
          `<TelemetryIngestionBudgetExplorerBanner signal={ProductType.${signal}} />`,
        ),
      );

      expect(banner).toBeGreaterThan(0);
      expect(banner).toBeLessThan(layout.indexOf("<Outlet/>"));
    },
  );
});

describe("an ingestion key's page", () => {
  const page: string = read(
    "Pages",
    "Settings",
    "TelemetryIngestionKeyView.tsx",
  );
  const card: string = page.slice(
    page.indexOf('name="Telemetry Ingestion Key Budgets"'),
    page.indexOf("<ResetObjectID<TelemetryIngestionKey>"),
  );

  test("edits a daily budget and a rate for every signal, in two steps", () => {
    expect(compact(card)).toContain(
      compact(
        'formSteps={[{ title: "Daily Budgets", id: "daily-budgets" },{ title: "Rate Limits", id: "rate-limits" }]}',
      ),
    );

    for (const column of TELEMETRY_INGESTION_BUDGET_DAILY_COLUMN_NAMES) {
      const field: string = compact(
        card.slice(card.indexOf(`field: { ${column}: true }`)),
      ).slice(0, 200);

      expect({
        column,
        step: field.includes('stepId:"daily-budgets"'),
      }).toEqual({ column, step: true });
    }

    for (const column of TELEMETRY_INGESTION_BUDGET_RATE_COLUMN_NAMES) {
      const field: string = compact(
        card.slice(card.indexOf(`field: { ${column}: true }`)),
      ).slice(0, 200);

      expect({ column, step: field.includes('stepId:"rate-limits"') }).toEqual({
        column,
        step: true,
      });
    }
  });

  test("shows every column it edits", () => {
    const details: string = card.slice(card.indexOf("modelDetailProps"));

    for (const column of TELEMETRY_INGESTION_BUDGET_COLUMN_NAMES) {
      expect({ column, shown: details.includes(`${column}: true`) }).toEqual({
        column,
        shown: true,
      });
    }
  });

  test("shows what the key used of its own budgets today, read again after a save", () => {
    const status: string = compact(
      page.slice(page.indexOf("<TelemetryIngestionBudgetStatusCard")),
    ).slice(0, 300);

    expect(status).toContain("key={budgetRefresher}");
    expect(status).toContain("ingestionKeyId={modelId.toString()}");
    expect(status).toContain("hideWhenUnbudgeted={true}");
    expect(compact(card)).toContain(
      "onSaveSuccess={()=>{setBudgetRefresher(budgetRefresher+1);}}",
    );
  });
});

describe("the Dashboard locales", () => {
  const english: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_SRC, "Locales", "en.json"), "utf8"),
  ) as Record<string, string>;

  const STRINGS: ReadonlyArray<string> = [
    "Ingestion Budgets",
    "Edit Ingestion Budgets",
    "Ingestion Key Budgets",
    "Today's Budget Usage",
    "No ingestion budgets",
    "Used Today",
    "Past warning",
    "Used up",
    "No daily budget",
    "Instance default",
    "Set for this project",
    "This key's own",
    "See budgets",
    "Logs (GB per day)",
    "Security Events (MB per second)",
    "{{signal}}: today's ingestion budget of {{budget}} is used up, so new data is refused until the budget resets at {{resetsAt}}.",
  ];

  test("English holds every string", () => {
    for (const text of STRINGS) {
      expect({ text, held: english[text] === text }).toEqual({
        text,
        held: true,
      });
    }
  });

  test.each(LANGUAGES)("%s words every one of them", (language: string) => {
    const locale: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.join(DASHBOARD_SRC, "Locales", `${language}.json`),
        "utf8",
      ),
    ) as Record<string, string>;

    for (const text of STRINGS) {
      expect({
        language,
        text,
        worded: typeof locale[text] === "string" && locale[text] !== text,
      }).toEqual({ language, text, worded: true });
    }
  });
});
