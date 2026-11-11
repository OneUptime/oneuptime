import { readPage, TRANSLATED_LANGUAGES } from "./DocsContentSupport";
import {
  menuSections,
  readCommonSource,
  readDashboardSource,
  sectionByTitle,
  startsCollapsed,
} from "./DocsDashboardMenus";
import { adminDashboardLabel } from "./DocsAdminDashboard";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { navTitle, toLatinDigits } from "./DocsTranslationChecks";
import DocsNav from "../../../FeatureSet/Docs/Utils/Nav";
import {
  TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES,
  TELEMETRY_USAGE_STAGING_LOOKBACK_IN_DAYS,
} from "Common/Server/Services/TelemetryUsageBillingService";
import {
  TELEMETRY_USAGE_DEFAULT_RANGE_IN_DAYS,
  TELEMETRY_USAGE_DEFAULT_RETENTION_IN_DAYS,
  TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
  TELEMETRY_USAGE_MAX_RANGE_IN_DAYS,
  TELEMETRY_USAGE_MAX_RETENTION_IN_DAYS,
  TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS,
  TELEMETRY_USAGE_PRODUCT_TYPES,
  TELEMETRY_USAGE_PROJECT_ROUTE,
  TELEMETRY_USAGE_RANGE_OPTIONS_IN_DAYS,
  TELEMETRY_USAGE_SIGNALS,
} from "Common/Types/Telemetry/TelemetryUsage";
import { TELEMETRY_INGESTION_BUDGET_SIGNALS } from "Common/Types/Telemetry/TelemetryIngestionBudget";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { EVERY_DAY } from "Common/Utils/CronTime";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  PROJECT_TELEMETRY_USAGE_READ_PERMISSIONS,
  PROJECT_USAGE_READ_PERMISSIONS,
} from "Common/Utils/Project/ProjectBilling";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE TELEMETRY USAGE PAGE SAYS WHAT THE PRODUCT DOES (issue #5916).
 *
 * docs/telemetry/usage tells a reader where to see telemetry usage on any
 * install - the project's Usage page, the Admin Dashboard, the API - how it
 * is counted, who sees it, and how long it is kept. Each claim is held here
 * to the code that makes it true, so a page and a product that drift apart
 * fail the suite.
 */

const PAGE: string = "telemetry/usage";
const ENGLISH: string = readPage("en", PAGE);

const SETTINGS_MENU: string = readDashboardSource(
  "Pages/Settings/SideMenu.tsx",
);
const OVERVIEW: string = readCommonSource(
  "UI/Components/TelemetryUsage/TelemetryUsageOverview.tsx",
);
const USAGE_PAGE: string = readDashboardSource(
  "Pages/Settings/UsageHistory.tsx",
);

interface NavLink {
  title: string;
  url: string;
}

interface NavGroup {
  title: string;
  links: Array<NavLink>;
}

const titleOf: (permission: Permission) => string = (
  permission: Permission,
): string => {
  return PermissionHelper.getTitle(permission);
};

describe("the page in the docs", () => {
  test("is in the Telemetry group, between Data Retention and Ingestion Budgets", () => {
    const telemetry: NavGroup = (DocsNav as unknown as Array<NavGroup>).find(
      (group: NavGroup): boolean => {
        return group.title === "Telemetry";
      },
    )!;
    const urls: Array<string> = telemetry.links.map((link: NavLink): string => {
      return link.url;
    });
    const index: number = urls.indexOf(`/docs/${PAGE}`);

    expect(index).toBeGreaterThan(0);
    expect(urls[index - 1]).toBe("/docs/telemetry/data-retention");
    expect(urls[index + 1]).toBe("/docs/telemetry/ingestion-budgets");
    expect(telemetry.links[index]!.title).toBe("Telemetry Usage");
  });

  test.each(["en", ...TRANSLATED_LANGUAGES])(
    "is titled by its nav link in %s",
    (language: string) => {
      expect(readPage(language, PAGE).split("\n")[0]).toBe(
        `# ${navTitle(language, "Telemetry Usage")}`,
      );
    },
  );
});

describe("a project's Usage page", () => {
  test("is under Telemetry & APM, which starts folded, as the page says", () => {
    expect(ENGLISH).toContain(
      "Go to **Project Settings → Telemetry & APM → Usage**. **Telemetry & APM** starts collapsed in the side menu: click it to open it.",
    );
    expect(
      sectionByTitle(menuSections(SETTINGS_MENU), "Telemetry & APM").items,
    ).toContain("Usage");
    expect(startsCollapsed(SETTINGS_MENU, "Telemetry & APM")).toBe(true);
  });

  test("opens on the last 30 days, and offers 7 and 90", () => {
    expect(TELEMETRY_USAGE_DEFAULT_RANGE_IN_DAYS).toBe(30);
    expect([...TELEMETRY_USAGE_RANGE_OPTIONS_IN_DAYS]).toEqual([7, 30, 90]);
    expect(ENGLISH).toContain(
      "The page opens on **Last 30 days**. Pick **Last 7 days** or **Last 90 days**",
    );
    expect(OVERVIEW).toContain('one: "Last {{count}} day"');
    expect(OVERVIEW).toContain('other: "Last {{count}} days"');
  });

  test("names the cards and columns as the page draws them", () => {
    expect(OVERVIEW).toContain('title="Telemetry Usage"');
    expect(OVERVIEW).toContain('title="Usage by Resource"');
    expect(USAGE_PAGE).toContain('title: "Telemetry Usage History"');

    for (const column of [
      'title: "Resource"',
      'title: "Total"',
      'title: "Retention"',
    ]) {
      expect(OVERVIEW).toContain(column);
    }

    for (const label of [
      "| **Telemetry Usage** |",
      "| **Usage by Resource** |",
      "| **Telemetry Usage History** |",
      "**Total**",
      "**Resource**",
      "**Retention**",
      "**Product**, **Day** and **Service**",
      "**Unknown Service**",
    ]) {
      expect(ENGLISH).toContain(label);
    }

    expect(USAGE_PAGE).toContain('title: "Product"');
    expect(USAGE_PAGE).toContain('title: "Day"');
    expect(USAGE_PAGE).toContain('title: "Service"');
  });
});

describe("how usage is counted", () => {
  test("once a day, by about 08:00 UTC, when billing's own run counts it", () => {
    expect(EVERY_DAY).toBe("0 8 * * *");
    expect(ENGLISH).toContain("by about 08:00 UTC the next day");
  });

  test("a day that failed is tried again for a week", () => {
    expect(TELEMETRY_USAGE_STAGING_LOOKBACK_IN_DAYS).toBe(7);
    expect(ENGLISH).toContain(
      "A day that could not be counted is tried again for a week.",
    );
  });

  test("leaves out the telemetry OneUptime writes itself", () => {
    for (const type of [
      ServiceType.Monitor,
      ServiceType.Alert,
      ServiceType.Incident,
      ServiceType.ServiceLevelObjective,
      ServiceType.DataStore,
    ]) {
      expect(TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES).toContain(type);
    }

    expect(ENGLISH).toContain(
      "Monitor, alert, incident and SLO readings, Data Observability readings and the session replay budget metrics are written by OneUptime itself.",
    );
  });

  test("never charges for what was counted without billing", () => {
    expect(ENGLISH).toContain(
      "On an installation without billing, usage is counted at no cost, and nothing is charged for it, even if billing is turned on later.",
    );
  });
});

describe("who sees usage", () => {
  const rows: Array<string> = ENGLISH.split("\n").filter((line: string) => {
    return (
      line.startsWith("| ") && line.includes("| How much each resource sent")
    );
  });

  test("everyone who reads the project's telemetry, and the billing roles", () => {
    const named: Array<string> = rows
      .flatMap((row: string): Array<string> => {
        return (row.split("|")[1] || "").split(",");
      })
      .map((name: string): string => {
        return name.trim();
      })
      .sort();

    expect(named).toEqual(
      PROJECT_TELEMETRY_USAGE_READ_PERMISSIONS.map(titleOf).sort(),
    );
  });

  test("what it cost: only the billing readers, on OneUptime Cloud", () => {
    const costRow: string = rows.find((row: string): boolean => {
      return row.includes("what it cost");
    })!;
    const named: Array<string> = (costRow.split("|")[1] || "")
      .split(",")
      .map((name: string): string => {
        return name.trim();
      })
      .sort();

    expect(named).toEqual(PROJECT_USAGE_READ_PERMISSIONS.map(titleOf).sort());
  });
});

describe("every project's usage, and how long it is kept", () => {
  test("the Admin Dashboard's menus name the pages as the docs do", () => {
    // The menu's item, and a project's own page under Projects.
    expect(adminDashboardLabel("en", "Telemetry Usage")).toBe(
      "Telemetry Usage",
    );
    expect(adminDashboardLabel("en", "sideMenu.telemetryUsage")).toBe(
      "Telemetry Usage",
    );
    expect(ENGLISH).toContain(
      "In the Admin Dashboard, open the menu and click **Telemetry Usage**.",
    );
    expect(ENGLISH).toContain(
      "Its **Telemetry Usage** page, under **Projects** in the Admin Dashboard,",
    );
  });

  test("the retention card, button and field are the Admin Dashboard's", () => {
    expect(
      adminDashboardLabel("en", "pages.settings.dataRetention.usageCardTitle"),
    ).toBe("Telemetry Usage Retention");
    expect(
      adminDashboardLabel("en", "pages.settings.dataRetention.usageEditButton"),
    ).toBe("Edit Telemetry Usage Retention");
    expect(adminDashboardLabel("en", "Telemetry Usage Retention (Days)")).toBe(
      "Telemetry Usage Retention (Days)",
    );
    expect(ENGLISH).toContain(
      "On the **Telemetry Usage Retention** card, click **Edit Telemetry Usage Retention**, enter **Telemetry Usage Retention (Days)** from 30 to 1095",
    );
  });

  test("keeps usage 120 days unless changed, from 30 to 1095", () => {
    expect(TELEMETRY_USAGE_DEFAULT_RETENTION_IN_DAYS).toBe(120);
    expect(TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS).toBe(30);
    expect(TELEMETRY_USAGE_MAX_RETENTION_IN_DAYS).toBe(1095);
    expect(ENGLISH).toContain(
      "Usage is kept for 120 days unless you change it, with billing on or off.",
    );
    expect(ENGLISH).toContain(
      "The retention is never shorter than 30 days: a day that is counted is never deleted and counted again.",
    );
  });
});

describe("the API", () => {
  test("is the route the pages read, with the longest range the server takes", () => {
    expect(TELEMETRY_USAGE_PROJECT_ROUTE).toBe("/telemetry-usage/project");
    expect(TELEMETRY_USAGE_MAX_RANGE_IN_DAYS).toBe(1095);
    expect(ENGLISH).toContain(`\`GET /api${TELEMETRY_USAGE_PROJECT_ROUTE}\``);
    expect(ENGLISH).toContain(
      `https://oneuptime.com/api${TELEMETRY_USAGE_PROJECT_ROUTE}?startDay=`,
    );
    expect(ENGLISH).toContain("a range can be up to 1095 days long");
  });
});

describe("every translation", () => {
  // Persian digits as Latin ones, and 1.095 or 1 095 as one number.
  const numbersOf: (text: string) => string = (text: string): string => {
    return toLatinDigits(text).replace(
      /(\d)[.,\s\u00a0\u202f\u066c](?=\d{3}(?!\d))/g,
      "$1",
    );
  };

  test.each(TRANSLATED_LANGUAGES)(
    "%s keeps the numbers the product counts by",
    (language: string) => {
      const text: string = numbersOf(readPage(language, PAGE));

      for (const number of ["120", "30", "1095", "08:00"]) {
        expect({ language, number, kept: text.includes(number) }).toEqual({
          language,
          number,
          kept: true,
        });
      }

      // The command is code: kept exactly as written.
      expect(readPage(language, PAGE)).toContain(
        "curl 'https://oneuptime.com/api/telemetry-usage/project?startDay=2026-10-01&endDay=2026-10-31' \\",
      );
    },
  );

  test.each(TRANSLATED_LANGUAGES)(
    "%s names the Admin Dashboard's menu, card, button and field as its Admin Dashboard does",
    (language: string) => {
      const page: string = readPage(language, PAGE);

      for (const key of [
        "Telemetry Usage",
        "pages.settings.dataRetention.usageCardTitle",
        "pages.settings.dataRetention.usageEditButton",
        "Telemetry Usage Retention (Days)",
      ]) {
        const label: string = adminDashboardLabel(language, key);

        expect({ language, key, named: page.includes(`**${label}**`) }).toEqual(
          { language, key, named: true },
        );
      }
    },
  );
});

/*
 * Issue #6356: exceptions are a signal of their own on the usage pages and
 * in the API, apart from the traces they are billed with. Each thing the
 * page says about them is held to the code that makes it so.
 */
describe("exceptions, apart from traces", () => {
  const BILLING_SERVICE: string = readCommonSource(
    "Server/Services/TelemetryUsageBillingService.ts",
  );
  const READS: string = readCommonSource(
    "Server/Utils/TelemetryUsage/TelemetryUsageReads.ts",
  );
  const WORDS: string = readCommonSource(
    "UI/Components/TelemetryUsage/TelemetryUsageWords.ts",
  );
  const METERED_PLAN: string = readCommonSource(
    "Server/Types/Billing/MeteredPlan/TelemetryMeteredPlan.ts",
  );

  test("are a signal the pages and the API show, after Traces, and never a product of their own", () => {
    expect(TELEMETRY_USAGE_EXCEPTIONS_SIGNAL).toBe("Exceptions");
    expect(
      TELEMETRY_USAGE_SIGNALS.indexOf(TELEMETRY_USAGE_EXCEPTIONS_SIGNAL),
    ).toBe(TELEMETRY_USAGE_SIGNALS.indexOf(ProductType.Traces) + 1);
    expect(TELEMETRY_USAGE_PRODUCT_TYPES).not.toContain(
      TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
    );
    expect(Object.values(ProductType)).not.toContain(
      TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
    );

    expect(ENGLISH).toContain(
      "sends: logs, metrics, traces, exceptions, profiles, session replays and security events.",
    );
    expect(ENGLISH).toContain(
      "- **Exceptions are shown on their own.** The exceptions recorded from spans and logs have a total, a column and a part of the chart of their own, and **Traces** counts spans.",
    );
    // The overview draws a tile, a column and a part of the chart per signal.
    expect(OVERVIEW).toContain("TELEMETRY_USAGE_SIGNALS.filter(");
    expect(OVERVIEW).toContain("TELEMETRY_USAGE_EXCEPTIONS_SIGNAL");
  });

  test("come from spans and logs, as the column's (i) says", () => {
    expect(WORDS).toContain('"Exceptions recorded from spans and logs."');
    expect(ENGLISH).toContain("The exceptions recorded from spans and logs");

    /*
     * Both ingests write the exception rows usage counts: the traces' span
     * events, and the exceptions found in logs.
     */
    for (const ingest of [
      "OtelTracesIngestService.ts",
      "OtelLogsIngestService.ts",
    ]) {
      expect({
        ingest,
        writesExceptionRows: fs
          .readFileSync(
            path.resolve(
              __dirname,
              "../../../FeatureSet/Telemetry/Services",
              ingest,
            ),
            "utf8",
          )
          .includes("ExceptionInstanceService"),
      }).toEqual({ ingest, writesExceptionRows: true });
    }

    // What usage counts as exceptions: every row of that one table.
    expect(BILLING_SERVICE).toContain(
      "ExceptionInstanceService.groupTelemetryUsageByService(",
    );
  });

  test("have no row of their own: the traces row says how much of it was exceptions", () => {
    expect(ENGLISH).toContain(
      "They have no row of their own: each traces row says how much of it was exceptions.",
    );
    expect(BILLING_SERVICE).toContain("exceptionDataIngestedInGB:");
    expect(READS).toContain('AS "exceptionDataIngestedInGB"');
  });

  test("are billed inside Traces, at the traces price, from all the row holds", () => {
    expect(ENGLISH).toContain(
      "- **Exceptions are billed as part of Traces.** On OneUptime Cloud, traces are billed for their spans and their exceptions together, at the traces price, as they always were. Showing exceptions apart changes nothing you are billed, and they are never charged twice.",
    );

    // The cost is the price of everything the row holds; the part is never priced.
    expect(BILLING_SERVICE.replace(/\s+/g, " ")).toContain(
      "serverMeteredPlan.getTotalCostInUSD({ dataIngestedInGB: data.dataIngestedInGB, retentionInDays: data.retentionInDays, })",
    );
    expect(METERED_PLAN).not.toContain("exceptionDataIngestedInGB");
    expect(WORDS).toContain(
      '"Exceptions recorded from spans and logs. They are billed as part of Traces."',
    );
  });

  test("days counted before they were shown apart keep them inside Traces", () => {
    expect(ENGLISH).toContain(
      "A day counted before exceptions were shown apart still has them inside **Traces**, as it did.",
    );
    // Such a row has no part: the reads take none out of its Traces.
    expect(READS).toContain(
      `COALESCE(\${alias}"exceptionDataIngestedInGB", 0)`,
    );
    expect(ENGLISH).toContain(
      ":::details Traces went down on the day Exceptions appeared",
    );
  });

  test("have no ingestion budget of their own", () => {
    expect([...TELEMETRY_INGESTION_BUDGET_SIGNALS]).not.toContain(
      TELEMETRY_USAGE_EXCEPTIONS_SIGNAL,
    );
    expect(TELEMETRY_INGESTION_BUDGET_SIGNALS).toContain(ProductType.Traces);
    expect(TELEMETRY_INGESTION_BUDGET_SIGNALS).toContain(ProductType.Logs);
    expect(ENGLISH).toContain(
      "Exceptions have no budget of their own: they count in the budget of the traces or logs they arrive in.",
    );
  });

  test("a Traces row of the history says how much of it was exceptions, under Data Ingested (in GB)", () => {
    expect(USAGE_PAGE).toContain('title: "Data Ingested (in GB)"');
    expect(USAGE_PAGE).toContain("exceptionDataIngestedInGB: true,");
    expect(USAGE_PAGE).toContain("formatTelemetryUsageExceptionsPart(");
    expect(ENGLISH).toContain(
      "A **Traces** row holds its spans and exceptions together, as traces are billed, and says under **Data Ingested (in GB)** how much of it was exceptions.",
    );
  });

  test("the API answers them under Exceptions, apart from Traces", () => {
    expect(ENGLISH).toContain(
      "Exceptions are under `Exceptions`, apart from `Traces`, and a day counted before exceptions were shown apart has them inside `Traces`.",
    );
    expect(`\`${TELEMETRY_USAGE_EXCEPTIONS_SIGNAL}\``).toBe("`Exceptions`");
    expect(`\`${ProductType.Traces}\``).toBe("`Traces`");
  });

  test.each(TRANSLATED_LANGUAGES)(
    "%s names Traces, Exceptions and the history's column as its Dashboard draws them, and keeps the API's keys",
    (language: string) => {
      const page: string = readPage(language, PAGE);

      for (const label of [
        "Traces",
        "Exceptions",
        "Data Ingested (in GB)",
        "Telemetry Usage History",
        "Product",
      ]) {
        const drawn: string = drawnDashboardLabel(language, label);

        expect({
          language,
          label,
          named: page.includes(`**${drawn}**`),
        }).toEqual({ language, label, named: true });
      }

      // The answer's keys are code, in English in every language.
      expect(page).toContain("`Exceptions`");
      expect(page).toContain("`Traces`");

      // The troubleshooting entry for the day Exceptions appeared, as in English.
      expect(
        page.split("\n").filter((line: string): boolean => {
          return line.startsWith(":::details ");
        }).length,
      ).toBe(
        ENGLISH.split("\n").filter((line: string): boolean => {
          return line.startsWith(":::details ");
        }).length,
      );
    },
  );
});
