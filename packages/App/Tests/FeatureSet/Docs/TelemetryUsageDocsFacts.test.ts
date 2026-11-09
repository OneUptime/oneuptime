import { readPage, TRANSLATED_LANGUAGES } from "./DocsContentSupport";
import {
  menuSections,
  readCommonSource,
  readDashboardSource,
  sectionByTitle,
  startsCollapsed,
} from "./DocsDashboardMenus";
import { adminDashboardLabel } from "./DocsAdminDashboard";
import { navTitle, toLatinDigits } from "./DocsTranslationChecks";
import DocsNav from "../../../FeatureSet/Docs/Utils/Nav";
import {
  TELEMETRY_BILLING_EXCLUDED_ENTITY_TYPES,
  TELEMETRY_USAGE_STAGING_LOOKBACK_IN_DAYS,
} from "Common/Server/Services/TelemetryUsageBillingService";
import {
  TELEMETRY_USAGE_DEFAULT_RANGE_IN_DAYS,
  TELEMETRY_USAGE_DEFAULT_RETENTION_IN_DAYS,
  TELEMETRY_USAGE_MAX_RANGE_IN_DAYS,
  TELEMETRY_USAGE_MAX_RETENTION_IN_DAYS,
  TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS,
  TELEMETRY_USAGE_PROJECT_ROUTE,
  TELEMETRY_USAGE_RANGE_OPTIONS_IN_DAYS,
} from "Common/Types/Telemetry/TelemetryUsage";
import { EVERY_DAY } from "Common/Utils/CronTime";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  PROJECT_TELEMETRY_USAGE_READ_PERMISSIONS,
  PROJECT_USAGE_READ_PERMISSIONS,
} from "Common/Utils/Project/ProjectBilling";
import { describe, expect, test } from "@jest/globals";

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
  test("is in the Telemetry group, between Data Retention and Continuous Profiling", () => {
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
    expect(urls[index + 1]).toBe("/docs/telemetry/profiles");
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
