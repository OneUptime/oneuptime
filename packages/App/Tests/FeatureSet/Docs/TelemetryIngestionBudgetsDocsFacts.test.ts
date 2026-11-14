import { describe, expect, jest, test } from "@jest/globals";

/*
 * THE INGESTION BUDGETS PAGE SAYS WHAT THE PRODUCT DOES (issue #5917).
 *
 * docs/telemetry/ingestion-budgets tells a reader how a daily byte budget
 * and a per-second rate are set for every project, for one project and for
 * one ingestion key, how bytes are counted, what a refused sender is told,
 * when the warning and the reset happen, where today's usage and drops are
 * shown, and how to alert on the budget metrics. Each claim is held here to
 * the code that makes it true, and every translation to its English page:
 * line for line, with the same code, numbers and links, and each label as
 * that language's Dashboard or Admin Dashboard draws it.
 */

// The ingest orchestrator's settings and counters reach Postgres and Redis.
jest.mock(
  "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetSettings",
  () => {
    return { __esModule: true, default: {} };
  },
);

jest.mock(
  "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetCounter",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetCounter",
    ) as Record<string, unknown>;

    return { __esModule: true, ...actual, default: {} };
  },
);

import {
  readPage,
  scanMarkdown,
  TRANSLATED_LANGUAGES,
} from "./DocsContentSupport";
import { adminDashboardLabel } from "./DocsAdminDashboard";
import { readCommonSource, readDashboardSource } from "./DocsDashboardMenus";
import { drawnActionLabel } from "./DocsDashboardLabels";
import { lineShape } from "./DocsPageShape";
import { inlineCode, navTitle, toLatinDigits } from "./DocsTranslationChecks";
import DocsNav from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DAILY_BUDGET_TITLES,
  RATE_LIMIT_TITLES,
} from "../../../FeatureSet/AdminDashboard/src/Utils/IngestionBudgetFormFields";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionBudget from "Common/Server/Utils/Telemetry/TelemetryIngestionBudget";
import { getTelemetryIngestionBudgetHttpStatus } from "Common/Server/Utils/Telemetry/TelemetryIngestionBudgetHttp";
import { GRPC_RESOURCE_EXHAUSTED_CODE } from "Common/Server/Utils/Telemetry/GoogleRpcStatus";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import {
  getTelemetryIngestionBudgetDay,
  getTelemetryIngestionBudgetSignalSlug,
  resolveTelemetryIngestionBudget,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
  TELEMETRY_INGESTION_BUDGET_BYTES_PER_MB,
  TELEMETRY_INGESTION_BUDGET_DEFAULT_RESET_TIME,
  TELEMETRY_INGESTION_BUDGET_DEFAULT_TIMEZONE,
  TELEMETRY_INGESTION_BUDGET_DEFAULT_WARNING_PERCENT,
  TELEMETRY_INGESTION_BUDGET_MAX_WARNING_PERCENT,
  TELEMETRY_INGESTION_BUDGET_MIN_WARNING_PERCENT,
  TELEMETRY_INGESTION_BUDGET_SIGNALS,
  getEmptyTelemetryIngestionBudgetStoredSettings,
  TelemetryIngestionBudgetDay,
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetScope,
  TelemetryIngestionBudgetStoredSettings,
} from "Common/Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestionBudgetMetricType from "Common/Types/Telemetry/TelemetryIngestionBudgetMetricType";
import TelemetryIngestionBudgetMetricTypeUtil, {
  TELEMETRY_INGESTION_BUDGET_METRIC_INGESTION_KEY_ID_ATTRIBUTE,
  TELEMETRY_INGESTION_BUDGET_METRIC_INGESTION_KEY_NAME_ATTRIBUTE,
  TELEMETRY_INGESTION_BUDGET_METRIC_INTERVAL_MINUTES,
  TELEMETRY_INGESTION_BUDGET_METRIC_NAME_PREFIX,
  TELEMETRY_INGESTION_BUDGET_METRIC_PROJECT_ID_ATTRIBUTE,
  TELEMETRY_INGESTION_BUDGET_METRIC_SCOPE_ATTRIBUTE,
  TELEMETRY_INGESTION_BUDGET_METRIC_SIGNAL_ATTRIBUTE,
} from "Common/Utils/Telemetry/TelemetryIngestionBudgetMetricType";
import fs from "fs";
import path from "path";

const PAGE: string = "telemetry/ingestion-budgets";
const ENGLISH: string = readPage("en", PAGE);
const ENGLISH_LINES: Array<string> = ENGLISH.split("\n");

const APP_DIR: string = path.resolve(__dirname, "../../..");

const readAppSource: (relative: string) => string = (
  relative: string,
): string => {
  return fs.readFileSync(path.join(APP_DIR, relative), "utf8");
};

const ADMIN_SETTINGS_MENU: string = readAppSource(
  "FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu.tsx",
);
const ADMIN_PROJECT_MENU: string = readAppSource(
  "FeatureSet/AdminDashboard/src/Pages/Projects/View/SideMenu.tsx",
);
const ADMIN_SETTINGS_PAGE: string = readAppSource(
  "FeatureSet/AdminDashboard/src/Pages/Settings/IngestionBudgets/Index.tsx",
);
const KEY_PAGE: string = readDashboardSource(
  "Pages/Settings/TelemetryIngestionKeyView.tsx",
);
const USAGE_PAGE: string = readDashboardSource(
  "Pages/Settings/UsageHistory.tsx",
);
const STATUS_CARD: string = readCommonSource(
  "UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetStatusCard.tsx",
);
const WORDS: string = readCommonSource(
  "UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetWords.ts",
);
const BANNER: string = readCommonSource(
  "UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetBanner.tsx",
);
const METRICS: string = readCommonSource(
  "Server/Utils/Telemetry/TelemetryIngestionBudgetMetrics.ts",
);
const SETTINGS: string = readCommonSource(
  "Server/Utils/Telemetry/TelemetryIngestionBudgetSettings.ts",
);
const QUEUE: string = readAppSource(
  "FeatureSet/Telemetry/Services/Queue/TelemetryQueueService.ts",
);

// Code with no whitespace, so a check holds however prettier wraps it.
const compact: (code: string) => string = (code: string): string => {
  return code.replace(/\s+/g, "");
};

interface NavLink {
  title: string;
  url: string;
}

interface NavGroup {
  title: string;
  links: Array<NavLink>;
}

/*
 * The Admin Dashboard labels the page names in bold, by the keys the
 * Admin Dashboard draws them from: a translation names each as its own
 * Admin locale words it.
 */
const ADMIN_LABELS: ReadonlyArray<[string, string]> = [
  ["Telemetry", "sideMenu.settingsTelemetry"],
  ["Default Daily Budgets", "pages.settings.ingestionBudgets.dailyCardTitle"],
  [
    "Edit Default Daily Budgets",
    "pages.settings.ingestionBudgets.dailyEditButton",
  ],
  ["Default Rate Limits", "pages.settings.ingestionBudgets.rateCardTitle"],
  [
    "Edit Default Rate Limits",
    "pages.settings.ingestionBudgets.rateEditButton",
  ],
  ["Warning and Reset", "pages.settings.ingestionBudgets.resetCardTitle"],
  ["Edit Warning and Reset", "pages.settings.ingestionBudgets.resetEditButton"],
  [
    "Daily Budgets for This Project",
    "pages.projectView.ingestionBudgets.dailyCardTitle",
  ],
  ["Edit Daily Budgets", "pages.projectView.ingestionBudgets.dailyEditButton"],
  [
    "Rate Limits for This Project",
    "pages.projectView.ingestionBudgets.rateCardTitle",
  ],
  ["Edit Rate Limits", "pages.projectView.ingestionBudgets.rateEditButton"],
  ["Logs (GB per day)", "Logs (GB per day)"],
  ["Logs (MB per second)", "Logs (MB per second)"],
  ["Warning Threshold (%)", "Warning Threshold (%)"],
  ["Reset Time", "Reset Time"],
  ["Reset Time Zone", "Reset Time Zone"],
];

// The Dashboard labels the page names in bold, as the Dashboard draws them.
const DASHBOARD_LABELS: ReadonlyArray<string> = [
  "Edit Ingestion Budgets",
  "Daily Budgets",
  "Rate Limits",
  "Ingestion Key Budgets",
  "Signal",
  "Used Today",
  "Daily Budget",
  "Rate Limit",
  "Dropped",
  "Throttled",
  "Status",
  "Instance default",
  "Set for this project",
  "This key's own",
  "Within budget",
  "Past warning",
  "Used up",
  "No daily budget",
  "Unknown",
  "Today's Budget Usage",
  "See budgets",
];

// The English lines that name a label in bold, by label.
const linesNaming: (bold: string) => Array<number> = (
  bold: string,
): Array<number> => {
  return ENGLISH_LINES.map((line: string, index: number): number => {
    return line.includes(`**${bold}**`) ||
      line.includes(`**${bold} →`) ||
      line.includes(`→ ${bold}**`) ||
      line.includes(`→ ${bold} →`)
      ? index
      : -1;
  }).filter((index: number): boolean => {
    return index >= 0;
  });
};

const LOGS_DAILY_REFUSAL: string =
  "This project's daily logs ingestion budget of 10 GB is used up, so OneUptime is not storing logs from this project until the budget resets at 2026-11-10 00:00 UTC.";

describe("the page in the docs", () => {
  test("is in the Telemetry group, between Telemetry Usage and Continuous Profiling", () => {
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
    expect(urls[index - 1]).toBe("/docs/telemetry/usage");
    expect(urls[index + 1]).toBe("/docs/telemetry/profiles");
    expect(telemetry.links[index]!.title).toBe("Ingestion Budgets");
  });

  test.each(["en", ...TRANSLATED_LANGUAGES])(
    "is titled by its nav link in %s",
    (language: string) => {
      expect(readPage(language, PAGE).split("\n")[0]).toBe(
        `# ${navTitle(language, "Ingestion Budgets")}`,
      );
    },
  );

  test.each(["en", ...TRANSLATED_LANGUAGES])(
    "is linked from Telemetry Usage and Ingestion Keys in %s",
    (language: string) => {
      for (const page of ["telemetry/usage", "telemetry/ingestion-keys"]) {
        const links: Array<string> = scanMarkdown(readPage(language, page))
          .links.map((link: { target: string }): string => {
            return link.target;
          })
          .filter((target: string): boolean => {
            return target === `/docs/${PAGE}`;
          });

        expect({ language, page, links: links.length }).toEqual({
          language,
          page,
          links: 2,
        });
      }
    },
  );
});

describe("how budgets work", () => {
  test("five signals, session replay not among them", () => {
    expect([...TELEMETRY_INGESTION_BUDGET_SIGNALS]).toEqual([
      ProductType.Logs,
      ProductType.Traces,
      ProductType.Metrics,
      ProductType.Profiles,
      ProductType.SecurityEvents,
    ]);
    expect(ENGLISH).toContain(
      "Logs, traces, metrics, profiles and security events each have a budget of their own.",
    );
  });

  test("a GB and an MB are binary", () => {
    expect(TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB).toBe(1024 ** 3);
    expect(TELEMETRY_INGESTION_BUDGET_BYTES_PER_MB).toBe(1024 ** 2);
    expect(ENGLISH).toContain("A GB is 1024³ bytes, and an MB 1024² bytes.");
  });

  test("a project's own budget wins, 0 lifts the default, and a key is held to its project's", () => {
    const stored: (
      logs: number | null,
    ) => TelemetryIngestionBudgetStoredSettings = (
      logs: number | null,
    ): TelemetryIngestionBudgetStoredSettings => {
      const settings: TelemetryIngestionBudgetStoredSettings =
        getEmptyTelemetryIngestionBudgetStoredSettings();
      settings[ProductType.Logs] = {
        dailyBudgetInGB: logs,
        rateLimitInMBPerSecond: null,
      };
      return settings;
    };

    const lifted: ReturnType<typeof resolveTelemetryIngestionBudget> =
      resolveTelemetryIngestionBudget({
        signal: ProductType.Logs,
        instance: stored(10),
        project: stored(0),
        ingestionKey: null,
      });
    expect(lifted.project.dailyBudget.bytes).toBe(null);

    const held: ReturnType<typeof resolveTelemetryIngestionBudget> =
      resolveTelemetryIngestionBudget({
        signal: ProductType.Logs,
        instance: stored(10),
        project: stored(2),
        ingestionKey: stored(5),
      });
    expect(held.ingestionKey!.dailyBudget.bytes).toBe(
      2 * TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
    );

    expect(ENGLISH).toContain(
      "or 0 for no limit at all. Leave a signal empty to keep the instance default.",
    );
    expect(ENGLISH).toContain(
      "When the project's budget is lowered below a key's, the key is held to the project's.",
    );
  });

  test("changes reach every server within a minute", () => {
    expect(SETTINGS).toContain(
      "export const TELEMETRY_INGESTION_BUDGET_SETTINGS_TTL_MS: number = 60 * 1000;",
    );
    expect(ENGLISH).toContain(
      "**Changes reach every server within a minute.**",
    );
  });
});

describe("where budgets are set", () => {
  test("the instance's are under Settings, in a Telemetry section that starts folded", () => {
    expect(adminDashboardLabel("en", "breadcrumbs.settings")).toBe("Settings");
    expect(adminDashboardLabel("en", "sideMenu.settingsTelemetry")).toBe(
      "Telemetry",
    );
    expect(adminDashboardLabel("en", "sideMenu.settingsIngestionBudgets")).toBe(
      "Ingestion Budgets",
    );

    const section: string = ADMIN_SETTINGS_MENU.slice(
      ADMIN_SETTINGS_MENU.indexOf('title={t("sideMenu.settingsTelemetry")}'),
    );
    expect(section.slice(0, 200)).toContain("defaultCollapsed={true}");
    expect(section.slice(0, 600)).toContain(
      't("sideMenu.settingsIngestionBudgets")',
    );

    expect(ENGLISH).toContain(
      "In the Admin Dashboard, go to **Settings → Telemetry → Ingestion Budgets**. **Telemetry** starts collapsed in the side menu: click it to open it.",
    );
  });

  test("a project's are on its own page under Projects", () => {
    expect(ADMIN_PROJECT_MENU).toContain('t("sideMenu.ingestionBudgets")');
    expect(adminDashboardLabel("en", "sideMenu.ingestionBudgets")).toBe(
      "Ingestion Budgets",
    );
    expect(ENGLISH).toContain(
      "In the Admin Dashboard, go to **Projects**, click the project, and click **Ingestion Budgets** in its side menu.",
    );
  });

  test.each(
    ADMIN_LABELS.map((pair: [string, string]) => {
      return [...pair];
    }),
  )(
    "names the Admin Dashboard's %s as it draws it",
    (english: string, key: string) => {
      expect(adminDashboardLabel("en", key)).toBe(english);
      expect(linesNaming(english).length).toBeGreaterThan(0);
    },
  );

  test("titles the fields as the forms do, each signal in GB per day or MB per second", () => {
    expect(DAILY_BUDGET_TITLES[ProductType.Logs]).toBe("Logs (GB per day)");
    expect(RATE_LIMIT_TITLES[ProductType.Logs]).toBe("Logs (MB per second)");

    for (const title of [
      'title: "Warning Threshold (%)"',
      'title: "Reset Time"',
      'title: "Reset Time Zone"',
    ]) {
      expect(ADMIN_SETTINGS_PAGE).toContain(title);
    }
  });

  test("a key's own budget is on its page, in two steps, for whoever edits the key", () => {
    expect(KEY_PAGE).toContain('title: "Ingestion Budgets"');
    expect(KEY_PAGE).toContain('editButtonText="Edit Ingestion Budgets"');
    expect(KEY_PAGE).toContain(
      '{ title: "Daily Budgets", id: "daily-budgets" }',
    );
    expect(KEY_PAGE).toContain('{ title: "Rate Limits", id: "rate-limits" }');

    expect(
      new TelemetryIngestionKey().getColumnAccessControlFor(
        "logsDailyIngestionBudgetInGB",
      )?.update,
    ).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditTelemetryIngestionKey,
    ]);
    expect(
      PermissionHelper.getTitle(Permission.EditTelemetryIngestionKey),
    ).toBe("Edit Ingestion Key");
    expect(ENGLISH).toContain(
      "Project Owner or Project Admin, or a custom role with the Edit Ingestion Key permission.",
    );
  });
});

describe("what senders see", () => {
  test("403 for a used-up budget, 429 with Retry-After for a rate, RESOURCE_EXHAUSTED over gRPC", () => {
    expect(
      getTelemetryIngestionBudgetHttpStatus({
        kind: TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
      } as never),
    ).toBe(403);
    expect(
      getTelemetryIngestionBudgetHttpStatus({
        kind: TelemetryIngestionBudgetRefusalKind.RateLimited,
      } as never),
    ).toBe(429);
    expect(GRPC_RESOURCE_EXHAUSTED_CODE).toBe(8);

    expect(ENGLISH).toContain(
      "| A daily budget is used up | `403` | `RESOURCE_EXHAUSTED` |",
    );
    expect(ENGLISH).toContain(
      "| A rate limit is exceeded | `429` with `Retry-After` | `RESOURCE_EXHAUSTED` with a retry delay |",
    );
  });

  test("quotes the refusal word for word", () => {
    expect(
      TelemetryIngestionBudget.getRefusalMessage({
        kind: TelemetryIngestionBudgetRefusalKind.DailyBudgetExhausted,
        scope: TelemetryIngestionBudgetScope.Project,
        signal: ProductType.Logs,
        limitBytes: 10 * TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
        resetsAt: new Date("2026-11-10T00:00:00.000Z"),
        retryAfterSeconds: null,
      }),
    ).toBe(LOGS_DAILY_REFUSAL);
    expect(ENGLISH).toContain(`\`\`\`text\n${LOGS_DAILY_REFUSAL}\n\`\`\``);
  });

  test("MQTT and the cloud streams are dropped, not refused", () => {
    expect(QUEUE).toContain("mode: TelemetryIngestionBudgetAdmissionMode.Drop");
    expect(ENGLISH).toContain(
      "Telemetry that arrives over MQTT or from a cloud provider's stream is dropped once its budget is used up.",
    );
  });
});

describe("the warning and the reset", () => {
  test("warns at 80% unless changed, from 1 to 99, and resets at 00:00 UTC", () => {
    expect(TELEMETRY_INGESTION_BUDGET_DEFAULT_WARNING_PERCENT).toBe(80);
    expect(TELEMETRY_INGESTION_BUDGET_MIN_WARNING_PERCENT).toBe(1);
    expect(TELEMETRY_INGESTION_BUDGET_MAX_WARNING_PERCENT).toBe(99);
    expect(TELEMETRY_INGESTION_BUDGET_DEFAULT_RESET_TIME).toBe("00:00");
    expect(TELEMETRY_INGESTION_BUDGET_DEFAULT_TIMEZONE).toBe("UTC");

    expect(ENGLISH).toContain("80% unless the instance admin changes it");
    expect(ENGLISH).toContain("**Warning Threshold (%)**, from 1 to 99");
    expect(ENGLISH).toContain(
      "Each budget day starts again at 00:00 UTC unless the instance admin changes it.",
    );
  });

  test("emails the project's owners", () => {
    expect(METRICS).toContain("ProjectService.sendEmailToProjectOwners(");
    expect(ENGLISH).toContain("the project's owners get an email");
  });

  test("follows the time zone's clock through daylight saving time", () => {
    const springForward: TelemetryIngestionBudgetDay =
      getTelemetryIngestionBudgetDay({
        now: new Date("2026-03-29T12:00:00Z"),
        resetTime: "00:00",
        timezone: "Europe/Berlin",
      });
    expect(
      springForward.resetsAt.getTime() - springForward.startsAt.getTime(),
    ).toBe(23 * 60 * 60 * 1000);

    // 02:30 does not exist in Berlin that day: it happens at 03:30.
    const skipped: TelemetryIngestionBudgetDay = getTelemetryIngestionBudgetDay(
      {
        now: new Date("2026-03-29T12:00:00Z"),
        resetTime: "02:30",
        timezone: "Europe/Berlin",
      },
    );
    expect(skipped.startsAt.toISOString()).toBe("2026-03-29T01:30:00.000Z");

    expect(ENGLISH).toContain(
      "The reset follows the time zone's clock, so the budget day the clocks change on is an hour shorter or longer.",
    );
  });

  test("a changed reset starts a new day", () => {
    const now: Date = new Date("2026-11-09T12:00:00Z");

    expect(
      getTelemetryIngestionBudgetDay({
        now,
        resetTime: "00:00",
        timezone: "UTC",
      }).id,
    ).not.toBe(
      getTelemetryIngestionBudgetDay({
        now,
        resetTime: "06:00",
        timezone: "UTC",
      }).id,
    );
    expect(ENGLISH).toContain(
      "Changing the reset time or the time zone starts a new budget day at once, with nothing counted yet.",
    );
  });
});

describe("where today's usage and drops are shown", () => {
  test("first on the Usage page, only while a budget or a rate is set", () => {
    const card: number = USAGE_PAGE.indexOf(
      "<TelemetryIngestionBudgetStatusCard",
    );
    const overview: number = USAGE_PAGE.indexOf("<TelemetryUsageOverview");

    expect(card).toBeGreaterThan(0);
    expect(card).toBeLessThan(overview);
    expect(USAGE_PAGE.slice(card, overview)).toContain(
      "hideWhenUnbudgeted={true}",
    );
  });

  test("names the cards, the columns, the sources and the states as the card draws them", () => {
    for (const title of [
      "Ingestion Budgets",
      "Ingestion Key Budgets",
      "Today's Budget Usage",
    ]) {
      expect(compact(STATUS_CARD)).toContain(
        compact(`translationKey("${title}"`),
      );
    }

    for (const column of [
      "Signal",
      "Used Today",
      "Daily Budget",
      "Rate Limit",
      "Dropped",
      "Throttled",
      "Status",
    ]) {
      expect(STATUS_CARD).toContain(`translator.translateText("${column}")`);
      expect(ENGLISH).toContain(`| **${column}** |`);
    }

    for (const label of [
      "Instance default",
      "Set for this project",
      "This key's own",
      "No daily budget",
      "Within budget",
      "Past warning",
      "Used up",
      "Unknown",
    ]) {
      expect(compact(WORDS)).toContain(compact(`translationKey("${label}"`));
      expect(ENGLISH).toContain(`**${label}**`);
    }

    expect(BANNER).toContain('translationKey("See budgets")');
  });

  test("the banner is above each explorer's data", () => {
    for (const [layout, signal] of [
      ["Pages/Logs/Layout.tsx", "Logs"],
      ["Pages/Traces/Layout.tsx", "Traces"],
      ["Pages/Metrics/Layout.tsx", "Metrics"],
      ["Pages/Profiles/Layout.tsx", "Profiles"],
      ["Pages/SecurityEvents/Layout.tsx", "SecurityEvents"],
    ] as Array<[string, string]>) {
      const source: string = compact(readDashboardSource(layout));
      const banner: number = source.indexOf(
        compact(
          `<TelemetryIngestionBudgetExplorerBanner signal={ProductType.${signal}} />`,
        ),
      );

      expect({ layout, banner: banner > 0 }).toEqual({ layout, banner: true });
      expect(banner).toBeLessThan(source.indexOf("<Outlet/>"));
    }

    expect(ENGLISH).toContain(
      "a banner above the Logs, Traces, Metrics, Profiles and Security Events data",
    );
  });
});

describe("the budget metrics", () => {
  const rows: Array<Array<string>> = ENGLISH_LINES.filter((line: string) => {
    return line.startsWith("| `oneuptime.telemetry.budget.");
  }).map((line: string): Array<string> => {
    return line
      .split("|")
      .slice(1, -1)
      .map((cell: string): string => {
        return cell.trim();
      });
  });

  test("lists every metric the sweep writes, with its unit", () => {
    expect(
      rows.map((row: Array<string>): [string, string] => {
        return [row[0] as string, row[1] as string];
      }),
    ).toEqual(
      TelemetryIngestionBudgetMetricTypeUtil.getAll().map(
        (name: TelemetryIngestionBudgetMetricType): [string, string] => {
          return [
            `\`${name}\``,
            `\`${TelemetryIngestionBudgetMetricTypeUtil.getUnit(name)}\``,
          ];
        },
      ),
    );
  });

  test("every 5 minutes, with the attributes each point carries", () => {
    expect(TELEMETRY_INGESTION_BUDGET_METRIC_INTERVAL_MINUTES).toBe(5);
    expect(ENGLISH).toContain(
      "Every 5 minutes, OneUptime writes each budget's figures for the day as metrics of the project",
    );

    for (const attribute of [
      TELEMETRY_INGESTION_BUDGET_METRIC_PROJECT_ID_ATTRIBUTE,
      TELEMETRY_INGESTION_BUDGET_METRIC_SIGNAL_ATTRIBUTE,
      TELEMETRY_INGESTION_BUDGET_METRIC_SCOPE_ATTRIBUTE,
      TELEMETRY_INGESTION_BUDGET_METRIC_INGESTION_KEY_ID_ATTRIBUTE,
      TELEMETRY_INGESTION_BUDGET_METRIC_INGESTION_KEY_NAME_ATTRIBUTE,
    ]) {
      expect(ENGLISH).toContain(`| \`${attribute}\` |`);
    }

    const slugs: string = TELEMETRY_INGESTION_BUDGET_SIGNALS.map(
      (signal: (typeof TELEMETRY_INGESTION_BUDGET_SIGNALS)[number]): string => {
        return `\`${getTelemetryIngestionBudgetSignalSlug(signal)}\``;
      },
    ).join(", ");
    expect(ENGLISH).toContain(
      `| \`signal\` | ${slugs.replace(/, ([^,]*)$/, " or $1")}. |`,
    );
    expect(ENGLISH).toContain(
      `| \`scope\` | \`${TelemetryIngestionBudgetScope.Project}\`, or \`${TelemetryIngestionBudgetScope.IngestionKey}\` for a key's own budget. |`,
    );
  });

  test("are kept as long as monitor metrics, and their names are reserved", () => {
    expect(METRICS).toContain("const DEFAULT_RETENTION_DAYS: number = 30;");
    expect(METRICS).toContain("monitorMetricRetentionInDays: true");
    expect(ENGLISH).toContain("30 days unless the instance admin changes it");
    expect(ENGLISH).toContain(
      `Metric names that start with \`${TELEMETRY_INGESTION_BUDGET_METRIC_NAME_PREFIX}\` are reserved for them`,
    );
  });
});

describe("every translation", () => {
  const ENGLISH_SHAPE: Array<string> = lineShape(ENGLISH);
  const ENGLISH_TEXT_BLOCK: string = scanMarkdown(ENGLISH)
    .fences.filter((fence: { lang: string }): boolean => {
      return fence.lang === "text";
    })
    .map((fence: { code: string }): string => {
      return fence.code;
    })
    .join("\n");

  test.each(TRANSLATED_LANGUAGES)(
    "%s has the English page's lines, each in its place",
    (language: string) => {
      const page: string = readPage(language, PAGE);

      expect(lineShape(page)).toEqual(ENGLISH_SHAPE);
    },
  );

  test.each(TRANSLATED_LANGUAGES)(
    "%s keeps the code, the refusal and the metric names as written",
    (language: string) => {
      const lines: Array<string> = readPage(language, PAGE).split("\n");

      ENGLISH_LINES.forEach((line: string, index: number) => {
        if (line.startsWith("```") || line.startsWith("    ")) {
          return;
        }

        expect({
          language,
          line: index + 1,
          code: inlineCode(lines[index] || ""),
        }).toEqual({ language, line: index + 1, code: inlineCode(line) });
      });

      expect(
        scanMarkdown(readPage(language, PAGE))
          .fences.filter((fence: { lang: string }): boolean => {
            return fence.lang === "text";
          })
          .map((fence: { code: string }): string => {
            return fence.code;
          })
          .join("\n"),
      ).toBe(ENGLISH_TEXT_BLOCK);
    },
  );

  test.each(TRANSLATED_LANGUAGES)(
    "%s keeps the numbers the product counts by",
    (language: string) => {
      const text: string = toLatinDigits(readPage(language, PAGE));

      for (const number of [
        "403",
        "429",
        "80",
        "99",
        "00:00",
        "1024",
        "15",
        "30",
        "90",
        "100",
      ]) {
        expect({ language, number, kept: text.includes(number) }).toEqual({
          language,
          number,
          kept: true,
        });
      }
    },
  );

  test.each(TRANSLATED_LANGUAGES)(
    "%s names the Admin Dashboard's labels as its Admin Dashboard draws them",
    (language: string) => {
      const lines: Array<string> = readPage(language, PAGE).split("\n");

      for (const [english, key] of ADMIN_LABELS) {
        const drawn: string = adminDashboardLabel(language, key);

        for (const index of linesNaming(english)) {
          expect({
            language,
            label: english,
            line: index + 1,
            named: (lines[index] || "").includes(drawn),
          }).toEqual({
            language,
            label: english,
            line: index + 1,
            named: true,
          });
        }
      }
    },
  );

  test.each(TRANSLATED_LANGUAGES)(
    "%s names the Dashboard's labels as its Dashboard draws them",
    (language: string) => {
      const lines: Array<string> = readPage(language, PAGE).split("\n");

      for (const english of DASHBOARD_LABELS) {
        const drawn: string = drawnActionLabel(language, english);

        for (const index of linesNaming(english)) {
          expect({
            language,
            label: english,
            line: index + 1,
            named: (lines[index] || "").includes(`**${drawn}**`),
          }).toEqual({
            language,
            label: english,
            line: index + 1,
            named: true,
          });
        }
      }
    },
  );
});
