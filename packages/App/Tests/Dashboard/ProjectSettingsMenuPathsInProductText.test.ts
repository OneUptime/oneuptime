import {
  BARE_SETTINGS,
  PROJECT_SETTINGS,
  SettingsMenuSection,
  SettingsMenus,
  USER_SETTINGS,
  WrittenPath,
  drawnSteps,
  drawnTitle,
  namesInOrder,
  readableText,
  settingsMenus,
  writtenPaths,
} from "./SettingsMenuPaths";
import {
  FoundText,
  PACKAGES_ROOT,
  REPO_ROOT,
  productTexts,
} from "./ProductTextScan";
import { readDashboardSource } from "../FeatureSet/Docs/DocsDashboardMenus";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY PROJECT SETTINGS PATH IN PRODUCT TEXT LEADS TO A REAL MENU.
 *
 * Project Settings folds every section of its side menu but Basic, so a page
 * in one is not on screen until its section is opened. The notification
 * texts' audit (#4845) held the paths to its Slack and Microsoft Teams pages
 * to that, and found the rest stale: "Project Settings > Billing" (in the
 * folded Billing and Invoices section), "Project Settings > Video Calls"
 * (Workspace), "Project Settings → Notification Settings" (Notifications),
 * "Project Settings → AI Features" (AI), "More -> Project Settings -> Custom
 * Domains" (no More menu, no such page), "Project Settings > Incident
 * Templates" (an Incidents page) - and "Settings > Domains", which names no
 * menu at all: every product's menu has a Settings section of its own.
 *
 * These hold every path OneUptime writes through Project Settings - the
 * server's messages, the emails, every frontend, the website, the Runner,
 * the probe, the CLI and the mobile app - to the menu as its source draws it
 * (SettingsMenuPaths reads it, and walks a path through it):
 *
 *   - its first step is a page of the menu, or a section and a page in it;
 *   - a page of a folded section is named with its section ("Project
 *     Settings > Billing and Invoices > Billing");
 *   - nothing but OneUptime or its Dashboard comes before Project Settings;
 *   - Project Settings is called by its name, never "Settings";
 *   - every translation of such a text - the Dashboard's, the Accounts
 *     pages', the API Reference's - names each step as its language's
 *     Dashboard draws it;
 *   - the Slack and Microsoft Teams pages go by their side menus' names, in
 *     the breadcrumbs and on the account cards' dialog buttons, and the
 *     status page menu names Microsoft Teams in full;
 *   - the AI agent emails, whose AI Agents page under Project Settings was
 *     retired, send their owners to a page that exists.
 *
 * Texts are read as the other menu path guards read them (ProductTextScan:
 * the TypeScript scanner, so a comment does not count; templates line by
 * line). ee/ is read where it is checked out: the App Test job deletes it,
 * and the Enterprise Edition Test workflow (test.ee.yaml) runs this suite
 * with it.
 */

const DASHBOARD_LOCALES: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Dashboard/src/Locales",
);

const MENUS: SettingsMenus = settingsMenus();

// Every text of a file that may write a path through Project Settings.
const FOUND_TEXTS: Array<FoundText> = productTexts(
  (source: string): boolean => {
    return source.includes(BARE_SETTINGS);
  },
);

interface FoundPath extends WrittenPath {
  file: string;
  line: number;
}

// The Project Settings paths among them: by its name, or as "Settings".
const FOUND_PATHS: Array<FoundPath> = FOUND_TEXTS.flatMap(
  (found: FoundText): Array<FoundPath> => {
    return writtenPaths(found.text, MENUS)
      .filter((written: WrittenPath): boolean => {
        return written.menu === PROJECT_SETTINGS;
      })
      .map((written: WrittenPath): FoundPath => {
        return { ...written, file: found.file, line: found.line };
      });
  },
);

function stepsOf(written: WrittenPath): string {
  return [written.menu, ...written.steps].join(" > ");
}

function pathsIn(file: string): Array<string> {
  return FOUND_PATHS.filter((found: FoundPath): boolean => {
    return found.file === file;
  })
    .map(stepsOf)
    .sort();
}

function projectSettingsPaths(text: string): Array<WrittenPath> {
  return writtenPaths(text, MENUS).filter((written: WrittenPath): boolean => {
    return written.menu === PROJECT_SETTINGS;
  });
}

function section(title: string): SettingsMenuSection {
  const found: SettingsMenuSection | undefined =
    MENUS.projectSettings.sections.find(
      (candidate: SettingsMenuSection): boolean => {
        return candidate.title === title;
      },
    );

  expect({ title, found: Boolean(found) }).toEqual({ title, found: true });

  return found as SettingsMenuSection;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function dashboardLocale(language: string): Record<string, unknown> {
  return readJson(path.join(DASHBOARD_LOCALES, `${language}.json`));
}

const LANGUAGES: ReadonlyArray<string> = fs
  .readdirSync(DASHBOARD_LOCALES)
  .filter((name: string): boolean => {
    return name.endsWith(".json") && name !== "en.json";
  })
  .map((name: string): string => {
    return name.slice(0, -".json".length);
  })
  .sort();

describe("the menu the paths are held to, read from its source", () => {
  test("Basic starts open; every other section starts folded, so its pages are named with it", () => {
    expect(
      MENUS.projectSettings.sections.map(
        (menuSection: SettingsMenuSection): string => {
          return `${menuSection.title}${menuSection.folded ? " (folded)" : ""}`;
        },
      ),
    ).toEqual([
      "Basic",
      "Workspace (folded)",
      "Telemetry & APM (folded)",
      "Notifications (folded)",
      "AI (folded)",
      "Advanced (folded)",
      "Security (folded)",
      "Audit Logs (folded)",
      "Danger Zone (folded)",
      // Added where billing is on, which is where texts send people to it.
      "Billing and Invoices (folded)",
    ]);
  });

  test.each([
    ["Basic", ["Project", "Labels", "Import from another tool"]],
    ["Workspace", ["Slack", "Microsoft Teams", "Video Calls"]],
    ["Telemetry & APM", ["Ingestion Keys", "Data Retention"]],
    [
      "Notifications",
      ["Notification Settings", "Notification Logs", "Mobile Apps"],
    ],
    [
      "AI",
      ["AI Features", "LLM Providers", "AI Credits", "AI Logs", "MCP Server"],
    ],
    ["Advanced", ["Domains", "API Keys", "Feature Flags"]],
    // SSO holds the project's SAML and OpenID Connect providers.
    ["Security", ["SSO", "SCIM"]],
    ["Billing and Invoices", ["Billing", "Usage History", "Invoices"]],
  ])(
    "%s holds the pages the texts name",
    (title: string, items: Array<string>) => {
      expect(section(title).items).toEqual(items);
    },
  );

  test("Project Settings is the Products menu's own entry, under Settings", () => {
    const navigation: string = readDashboardSource("Utils/NavigationItems.tsx");
    const entry: string = navigation.slice(
      navigation.indexOf('title: t("navbar.items.projectSettingsTitle")'),
      navigation.indexOf(
        "category: settingsCategory",
        navigation.indexOf('title: t("navbar.items.projectSettingsTitle")'),
      ),
    );
    const english: { navbar: { items: Record<string, unknown> } } =
      dashboardLocale("en") as { navbar: { items: Record<string, unknown> } };

    expect(entry).toContain("RouteMap[PageMap.SETTINGS]");
    expect(english.navbar.items["projectSettingsTitle"]).toBe(PROJECT_SETTINGS);
  });

  test("a page's breadcrumb title is known too, so a path that names a page by it is caught", () => {
    expect(MENUS.projectSettingsBreadcrumbs).toEqual(
      expect.arrayContaining(["Telemetry Ingestion Keys", "Domains", "SCIM"]),
    );
    // Not an entry of the menu: a path must not stop at it.
    expect(
      MENUS.projectSettings.sections.flatMap(
        (menuSection: SettingsMenuSection): Array<string> => {
          return menuSection.items;
        },
      ),
    ).not.toContain("Telemetry Ingestion Keys");
  });
});

describe("a written Project Settings path, as a reader follows it", () => {
  function problemsOf(text: string): Array<string> {
    return projectSettingsPaths(text).flatMap(
      (written: WrittenPath): Array<string> => {
        return written.problems;
      },
    );
  }

  test.each([
    [
      "the status page domain field's old pointer: a More menu, and a page the menu has no entry for",
      "Please select a verified domain from this list. If you do not see any domains in this list, please head over to More -> Project Settings -> Custom Domains to add one.",
      [
        'names no section or page of Project Settings: "Custom Domains to add one.',
        'puts "More" before Project Settings, where a path through it starts',
      ],
    ],
    [
      "the template dialogs' old pointer: an Incidents page",
      "No incident templates have been created yet. You can create these in Project Settings > Incident Templates.",
      ['names no section or page of Project Settings: "Incident Templates.'],
    ],
    [
      "the monitor messages' old pointer: an Incidents page",
      "This project has no incident severity. Add one under Project Settings > Incident Severity.",
      ['names no section or page of Project Settings: "Incident Severity.'],
    ],
    [
      "the postmortem dialog's old pointer",
      "No postmortem templates have been created yet. You can create these in Project Settings > Incident > Postmortem Templates.",
      ["names no section or page of Project Settings"],
    ],
    [
      "a product's page, under the product's name",
      "You can create templates in Project Settings > Status Pages > Subscriber Templates.",
      ['names no section or page of Project Settings: "Status Pages'],
    ],
    [
      "the Twilio notice's old pointer",
      "Go to Project Settings → Call & SMS to add your Twilio Account SID and Auth Token.",
      ['names no section or page of Project Settings: "Call & SMS'],
    ],
    [
      "the custom fields' old pointer, as JSX writes it",
      "Use Project Settings &gt; Users &gt; Custom Fields.",
      ['names no section or page of Project Settings: "Users'],
    ],
    [
      "a page of another section",
      "Go to Project Settings → AI → Feature Flags.",
      ["names no page of its AI section"],
    ],
    [
      "Notification Settings without its folded section",
      "Turn it on in Project Settings → Notification Settings.",
      [
        'names "Notification Settings" without "Notifications", the folded section it is in: write Project Settings > Notifications > Notification Settings',
      ],
    ],
    [
      "Notification Logs without its folded section",
      "If it does not come, Project Settings > Notification Logs shows what happened to it.",
      ['names "Notification Logs" without "Notifications"'],
    ],
    [
      "Video Calls without Workspace",
      "Reconnect Zoom in Project Settings > Video Calls to start calls again.",
      [
        'names "Video Calls" without "Workspace", the folded section it is in: write Project Settings > Workspace > Video Calls',
      ],
    ],
    [
      "Billing without Billing and Invoices",
      "Payment Method not added. Please go to Project Settings > Billing and add a payment method.",
      [
        'names "Billing" without "Billing and Invoices", the folded section it is in: write Project Settings > Billing and Invoices > Billing',
      ],
    ],
    [
      "Invoices without Billing and Invoices",
      "Please add a new payment method in Project Settings > Invoices to pay unpaid invoices.",
      ['names "Invoices" without "Billing and Invoices"'],
    ],
    [
      "AI Features without AI",
      "Turn AI on in Project Settings → AI Features.",
      [
        'names "AI Features" without "AI", the folded section it is in: write Project Settings > AI > AI Features',
      ],
    ],
    [
      "AI Credits without AI",
      "Review AI credits under Project Settings → AI Credits.",
      ['names "AI Credits" without "AI"'],
    ],
    [
      "MCP Server without AI, as the MCP sign-in page said it",
      "You can disconnect it at any time in Project Settings > MCP Server.",
      ['names "MCP Server" without "AI"'],
    ],
    [
      "Domains without Advanced",
      "Only domains verified in Project Settings → Domains are listed.",
      ['names "Domains" without "Advanced"'],
    ],
    [
      "API Keys without Advanced, in a link",
      "Create a key in [Project Settings → API Keys](https://oneuptime.com/dashboard) with permission to manage monitors.",
      ['names "API Keys" without "Advanced"'],
    ],
    [
      "API Keys without Advanced, each step in HTML bold",
      "Please head over to <strong>Project Settings</strong> > <strong>API Keys</strong>. Create a new API Key.",
      ['names "API Keys" without "Advanced"'],
    ],
    [
      "a page by its breadcrumb, not its menu entry",
      "Two allowlists compose (Project Settings > Telemetry Ingestion Keys).",
      [
        'names no section or page of Project Settings: "Telemetry Ingestion Keys',
      ],
    ],
    [
      "the AI agent email's old pointer, at a retired page",
      'You can view this AI agent by going to Project Settings > AI Agents "}}',
      ['names no section or page of Project Settings: "AI Agents'],
    ],
    [
      "the AI toolbox's old pointer, at an Incidents page",
      "No incident severities are configured for this project. Add one in Project Settings > Incidents > Severities first.",
      ['names no section or page of Project Settings: "Incidents'],
    ],
    [
      "Project Settings called Settings, by the domain services",
      "This domain is not verified. Please verify it by going to Settings > Domains",
      [
        'calls Project Settings "Settings", a section every product\'s menu has: write Project Settings > Domains',
        'names "Domains" without "Advanced"',
      ],
    ],
    [
      "Project Settings called Settings, by the Users page",
      "Invite or remove users from your identity provider or disable Push Groups in Settings > SCIM to manage them here.",
      ['calls Project Settings "Settings"', 'names "SCIM" without "Security"'],
    ],
    [
      "Project Settings called Settings, by the chat's provider picker",
      "No AI providers configured yet. Add one in Settings → AI → LLM Providers.",
      [
        'calls Project Settings "Settings", a section every product\'s menu has: write Project Settings > AI > LLM Providers',
      ],
    ],
    [
      "Project Settings called Settings, by the Runbook AI step, with ›",
      "Runs on the LLM provider selected below (Settings › AI › LLM Providers).",
      ['calls Project Settings "Settings"'],
    ],
    [
      "the same as HTML writes it",
      "Runs on the LLM provider selected below (Settings &rsaquo; AI &rsaquo; LLM Providers).",
      ['calls Project Settings "Settings"'],
    ],
    [
      "Project Settings in lower case, by the Microsoft Teams guide",
      "1. Go to project Settings -> Workspace -> Microsoft Teams",
      ['calls Project Settings "Settings"'],
    ],
    [
      "Project Settings called Settings, before a breadcrumb title",
      "Add your web origins in Settings &gt; Telemetry Ingestion Keys before using this snippet.",
      [
        'calls Project Settings "Settings"',
        'names no section or page of Project Settings: "Telemetry Ingestion Keys',
      ],
    ],
    [
      "Project Settings called Settings, where an instruction starts",
      "Open Settings > SCIM and turn off Push Groups.",
      ['calls Project Settings "Settings"', 'names "SCIM" without "Security"'],
    ],
  ])(
    "flags %s",
    (_case: string, text: string, expected: Array<string>): void => {
      const problems: Array<string> = problemsOf(text);

      expect(problems).toHaveLength(expected.length);

      expected.forEach((problem: string, index: number) => {
        expect(problems[index]).toContain(problem);
      });
    },
  );

  test.each([
    [
      "Turn it on in Project Settings → Notifications → Notification Settings.",
      ["Project Settings > Notifications > Notification Settings"],
    ],
    [
      "Upgrade the project in Project Settings > Billing and Invoices > Billing and they work again.",
      ["Project Settings > Billing and Invoices > Billing"],
    ],
    [
      "Please add a new payment method in Project Settings > Billing and Invoices > Invoices to pay unpaid invoices.",
      ["Project Settings > Billing and Invoices > Invoices"],
    ],
    [
      "Reconnect Zoom in Project Settings > Workspace > Video Calls.",
      ["Project Settings > Workspace > Video Calls"],
    ],
    [
      "Only domains verified in Project Settings → Advanced → Domains are listed.",
      ["Project Settings > Advanced > Domains"],
    ],
    [
      "Runs on the LLM provider selected below (Project Settings › AI › LLM Providers).",
      ["Project Settings > AI > LLM Providers"],
    ],
    [
      "Please head over to <strong>Project Settings</strong> > <strong>Advanced</strong> > <strong>API Keys</strong>.",
      ["Project Settings > Advanced > API Keys"],
    ],
    [
      "Create or copy a live key from Project Settings > Telemetry & APM > Ingestion Keys, then re-deploy the agent with it.",
      ["Project Settings > Telemetry & APM > Ingestion Keys"],
    ],
    [
      "Open Project Settings → Telemetry &amp; APM → Ingestion Keys, create a new key, then revoke the old one.",
      ["Project Settings > Telemetry & APM > Ingestion Keys"],
    ],
    [
      "disable Push Groups in Project Settings > Security > SCIM to manage them here.",
      ["Project Settings > Security > SCIM"],
    ],
    [
      "raise or remove the limit in Project Settings → AI → AI Features → More settings.",
      ["Project Settings > AI > AI Features"],
    ],
    [
      // Basic starts open: its pages need no section.
      "Please head over to <strong>Project Settings</strong> > <strong>Project</strong>. You should see your Project ID there.",
      ["Project Settings > Project"],
    ],
    [
      "Bring your team over in Project Settings > Import from another tool.",
      ["Project Settings > Import from another tool"],
    ],
    [
      // A section whose page has its name is named once.
      "Every change is listed in OneUptime Dashboard > Project Settings > Audit Logs.",
      ["Project Settings > Audit Logs"],
    ],
    [
      "Connect it again in Project Settings > Workspace > {value}.",
      ["Project Settings > Workspace > {value}"],
    ],
  ])("follows %s", (text: string, steps: Array<string>): void => {
    const written: Array<WrittenPath> = projectSettingsPaths(text);

    expect(
      written.flatMap((each: WrittenPath): Array<string> => {
        return each.problems;
      }),
    ).toEqual([]);
    expect(written.map(stepsOf)).toEqual(steps);
  });

  test.each([
    // Another device's or another tool's settings, named with them.
    "Tapped Don't Allow? Turn on Critical Alerts in iOS Settings > Notifications > {{app}}, then turn them on in the app again.",
    "Allow {{app}} in the phone's Settings > Notifications > Do Not Disturb access, then turn it on again.",
    "From **Business Settings → Accounts → WhatsApp Accounts**, create or select the account.",
    // A section alone could be any app's: Meta's app settings here.
    "Select your WhatsApp app, then navigate to **Settings → Basic**.",
    // A device's own settings: not a Project Settings page.
    "Allow it in Settings > Notifications > Do Not Disturb access, then try again.",
    "Token authentication must also be enabled on the search head (Settings > Tokens).",
    // A record's own Settings tab, and a product's own Settings section.
    "To hide a database you no longer care about, archive it instead (Settings → Archive).",
    "Turn recording on for the project (Settings > Session Replay).",
    // A step of a longer path, not where one starts.
    "You can add Twilio Config in Notification Settings > Twilio Config.",
    "Change what is recorded under Audit Logs > Settings.",
    // Another settings menu, held by SettingsMenuPathsInProductText.
    "Go to OneUptime Dashboard > User Settings > Notification Settings.",
    // A mention, not a path.
    "Project Settings are per project.",
  ])("is no Project Settings path: %s", (text: string) => {
    expect(projectSettingsPaths(text)).toEqual([]);
  });
});

describe("every Project Settings path OneUptime writes is one a reader can follow", () => {
  test("the scan reads the server's messages, the emails, every frontend, the website and the Runner", () => {
    expect(FOUND_PATHS.length).toBeGreaterThan(100);

    const files: Set<string> = new Set(
      FOUND_PATHS.map((found: FoundPath): string => {
        return found.file;
      }),
    );

    for (const expected of [
      "Common/Server/Utils/Errors.ts",
      "Common/Utils/Project/NotificationChannels.ts",
      "App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy.ts",
      "App/FeatureSet/AdminDashboard/src/Pages/Settings/Telegram/TelegramSetupGuide.ts",
      "App/FeatureSet/Telemetry/API/OTelIngest.ts",
      "App/FeatureSet/MCP/Handlers/ToolHandler.ts",
      "Home/Views/privacy.ejs",
      "Runner/Services/RegisterRunner.ts",
    ]) {
      expect({ file: expected, read: files.has(expected) }).toEqual({
        file: expected,
        read: true,
      });
    }
  });

  test.each([
    [
      "Common/Server/Services/DashboardDomainService.ts",
      ["Project Settings > Advanced > Domains"],
    ],
    [
      "Common/Server/Services/StatusPageDomainService.ts",
      ["Project Settings > Advanced > Domains"],
    ],
    [
      "App/FeatureSet/Dashboard/src/Components/CustomDomain/CustomDomainCopy.ts",
      ["Project Settings > Advanced > Domains"],
    ],
    [
      "Common/Server/Utils/Errors.ts",
      ["Project Settings > Billing and Invoices > Billing"],
    ],
    [
      "Common/Server/Services/PayAsYouGoBillingService.ts",
      ["Project Settings > Billing and Invoices > Billing"],
    ],
    [
      "Common/Server/API/BillingInvoiceAPI.ts",
      ["Project Settings > Billing and Invoices > Billing"],
    ],
    [
      "Common/Server/Utils/Billing/ActiveMonitorLimit.ts",
      ["Project Settings > Billing and Invoices > Billing"],
    ],
    [
      "Common/Server/Utils/Billing/PlanDowngradeOwnerNotice.ts",
      ["Project Settings > Billing and Invoices > Billing"],
    ],
    [
      "Common/Types/Billing/PlanCutoffCredentials.ts",
      [
        "Project Settings > Billing and Invoices > Billing",
        "Project Settings > Billing and Invoices > Billing",
      ],
    ],
    [
      "App/FeatureSet/MCP/Handlers/ToolHandler.ts",
      ["Project Settings > Billing and Invoices > Billing"],
    ],
    [
      "Common/Server/Types/Database/Permissions/BillingPermission.ts",
      ["Project Settings > Billing and Invoices > Invoices"],
    ],
    [
      "Common/Server/Types/AnalyticsDatabase/ModelPermission.ts",
      ["Project Settings > Billing and Invoices > Invoices"],
    ],
    [
      "Common/Utils/Project/NotificationChannels.ts",
      ["Project Settings > Notifications > Notification Settings"],
    ],
    [
      "Common/Utils/Project/ProjectBalance.ts",
      [
        "Project Settings > AI > AI Credits",
        "Project Settings > Billing and Invoices > Billing",
      ],
    ],
    [
      "Common/Types/AI/ProjectAiDailyLimits.ts",
      ["Project Settings > AI > AI Features"],
    ],
    [
      "Common/Server/Services/AIService.ts",
      [
        "Project Settings > AI > AI Features",
        "Project Settings > AI > LLM Providers",
      ],
    ],
    [
      "Common/Server/Services/VideoCallConnectionService.ts",
      [
        "Project Settings > Workspace > Video Calls",
        "Project Settings > Workspace > Video Calls",
        "Project Settings > Workspace > Video Calls",
      ],
    ],
    [
      "Home/Views/privacy.ejs",
      [
        "Project Settings > Workspace > Video Calls",
        "Project Settings > Workspace > Video Calls",
      ],
    ],
    [
      "App/FeatureSet/Telemetry/API/OTelIngest.ts",
      [
        "Project Settings > Telemetry & APM > Ingestion Keys",
        "Project Settings > Telemetry & APM > Ingestion Keys",
        "Project Settings > Telemetry & APM > Ingestion Keys",
      ],
    ],
    [
      "Runner/Services/RegisterRunner.ts",
      ["Project Settings > Telemetry & APM > Ingestion Keys"],
    ],
    [
      "Home/Views/ai-observability.ejs",
      ["Project Settings > Telemetry & APM > Ingestion Keys"],
    ],
    [
      "App/FeatureSet/Dashboard/src/Components/Rum/RumSetupGuide.ts",
      [
        "Project Settings > Telemetry & APM > Ingestion Keys",
        "Project Settings > Telemetry & APM > Ingestion Keys",
        "Project Settings > Telemetry & APM > Ingestion Keys",
      ],
    ],
    [
      "App/FeatureSet/Dashboard/src/Pages/Users/Index.tsx",
      [
        "Project Settings > Security > SCIM",
        "Project Settings > Security > SCIM",
      ],
    ],
    [
      "App/FeatureSet/Dashboard/src/Pages/Teams/View/Members.tsx",
      ["Project Settings > Security > SCIM"],
    ],
    [
      "App/FeatureSet/Dashboard/src/Pages/Runbook/View/Steps.tsx",
      ["Project Settings > AI > LLM Providers"],
    ],
    [
      "App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegrationDocumentation.tsx",
      [
        "Project Settings > Workspace > Microsoft Teams",
        "Project Settings > Workspace > Microsoft Teams",
      ],
    ],
    [
      "App/FeatureSet/AdminDashboard/src/Pages/Settings/Telegram/TelegramSetupGuide.ts",
      ["Project Settings > Notifications > Notification Settings"],
    ],
  ])(
    "%s names the real way there",
    (file: string, expected: Array<string>): void => {
      expect(pathsIn(file)).toEqual([...expected].sort());

      for (const found of FOUND_PATHS.filter((each: FoundPath): boolean => {
        return each.file === file;
      })) {
        expect({ file, path: found.text, problems: found.problems }).toEqual({
          file,
          path: found.text,
          problems: [],
        });
      }
    },
  );

  test("none sends a reader to a page that is not there, leaves a folded section out, or calls Project Settings Settings", () => {
    const problems: Array<string> = FOUND_PATHS.flatMap(
      (found: FoundPath): Array<string> => {
        return found.problems.map((problem: string): string => {
          return `${found.file}:${found.line} "${found.text}" ${problem}`;
        });
      },
    );

    expect(problems).toEqual([]);
  });

  test("the AI toolbox sends a project with no severity to the Incidents menu, where severities are", () => {
    const toolbox: Array<FoundText> = FOUND_TEXTS.filter(
      (found: FoundText): boolean => {
        return (
          found.file === "Common/Server/Utils/AI/Toolbox/IncidentWriteTools.ts"
        );
      },
    );
    const incidents: string = readDashboardSource(
      "Pages/Incidents/SideMenu.tsx",
    );

    expect(
      toolbox.some((found: FoundText): boolean => {
        return found.text.includes(
          "Add one in Incidents > Settings > Incident Severity first.",
        );
      }),
    ).toBe(true);
    expect(incidents).toContain('title: "Incident Severity"');
    expect(
      pathsIn("Common/Server/Utils/AI/Toolbox/IncidentWriteTools.ts"),
    ).toEqual([]);
  });
});

describe("every translation names the path as its language's Dashboard draws it", () => {
  const english: Record<string, unknown> = dashboardLocale("en");
  const keysWithPaths: Array<{ key: string; paths: Array<WrittenPath> }> =
    Object.keys(english)
      .filter((key: string): boolean => {
        return typeof english[key] === "string";
      })
      .map((key: string): { key: string; paths: Array<WrittenPath> } => {
        return { key, paths: projectSettingsPaths(key) };
      })
      .filter((entry: { key: string; paths: Array<WrittenPath> }): boolean => {
        return entry.paths.length > 0;
      });

  // The Dashboard's texts this sweep rewrote, one of each kind.
  const REWRITTEN: ReadonlyArray<string> = [
    "Go to Project Settings → AI → AI Features",
    "No AI providers configured yet. Add one in Project Settings → AI → LLM Providers.",
    "Only domains verified in Project Settings → Advanced → Domains are listed.",
    "Project Settings → Advanced → API Keys",
    "Project Settings → Notifications → Notification Settings",
    "SMS is off in this project. A project owner, a Billing Admin or someone with Manage Billing can turn it on in Project Settings → Notifications → Notification Settings.",
    "If it does not come, Project Settings > Notifications > Notification Logs shows what happened to it.",
    "It tries again within an hour. Check the payment method in Project Settings > Billing and Invoices > Billing, or recharge the balance now.",
    "Project Settings > Telemetry & APM > Ingestion Keys",
    "Invite or remove users from your identity provider or disable Push Groups in Project Settings > Security > SCIM to manage them here.",
    "The SMTP server this page sends subscriber email from. Add one in Project Settings > Notifications.",
  ];

  test("the Dashboard's texts with a Project Settings path include the ones this sweep rewrote, and every one walks the menu", () => {
    expect(
      keysWithPaths.map((entry: { key: string }): string => {
        return entry.key;
      }),
    ).toEqual(expect.arrayContaining([...REWRITTEN]));

    for (const entry of keysWithPaths) {
      for (const written of entry.paths) {
        expect({ key: entry.key, problems: written.problems }).toEqual({
          key: entry.key,
          problems: [],
        });
      }
    }
  });

  test("the texts no source writes any more, each sending people down a path that is not there, are gone", () => {
    for (const dropped of [
      "Please select a verified domain from this list. If you do not see any domains in this list, please head over to More -> Project Settings -> Custom Domains to add one.",
      "No incident templates have been created yet. You can create these in Project Settings > Incident Templates.",
      "This project has no alert severity. Add one under Project Settings > Alert Severity.",
      "Payment methods not found. Please add one in Project Settings -> Billing.",
      "Manage team members from your identity provider or disable Push Groups in Settings > SCIM to make changes here.",
      "SMS is off in this project. A project owner or someone with Manage Billing can turn it on in Project Settings → Notification Settings.",
      "MS Teams Subscribers",
    ]) {
      expect({ dropped, kept: dropped in english }).toEqual({
        dropped,
        kept: false,
      });
    }
  });

  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: every Project Settings path, each step in order, as its Dashboard draws it",
    (language: string) => {
      const locale: Record<string, unknown> = dashboardLocale(language);
      const misnamed: Array<string> = [];

      for (const entry of keysWithPaths) {
        const value: unknown = locale[entry.key];

        // Not translated yet: the reader sees the English, which is right.
        if (typeof value !== "string" || value === entry.key) {
          continue;
        }

        for (const written of entry.paths) {
          const steps: Array<string> = drawnSteps(locale, written);

          if (!namesInOrder(readableText(value), steps)) {
            misnamed.push(
              `${entry.key} -> ${value} (expected ${steps.join(" > ")})`,
            );
          }
        }
      }

      expect(misnamed).toEqual([]);
    },
  );

  test("the texts this sweep rewrote keep every translation they had: none fell back to English where it had one", () => {
    /*
     * A translated value of the keys this sweep re-keyed names the section
     * it inserted in that language; English left in its place would mean a
     * translation was lost on the way.
     */
    const translatedSomewhere: Array<string> = REWRITTEN.filter(
      (key: string): boolean => {
        return LANGUAGES.some((language: string): boolean => {
          const value: unknown = dashboardLocale(language)[key];

          return typeof value === "string" && value !== key;
        });
      },
    );

    expect(translatedSomewhere.length).toBeGreaterThanOrEqual(9);
  });
});

/*
 * The other frontends' own locale files: the Accounts pages (the MCP sign-in
 * and the cloud marketplace purchase) and the API Reference write paths
 * through Project Settings in their English and in every language.
 */
const FRONTEND_LOCALE_DIRECTORIES: ReadonlyArray<string> = [
  "App/FeatureSet/Accounts/src/Locales",
  "App/FeatureSet/APIReference/Locales",
  "App/FeatureSet/StatusPage/src/Locales",
  "App/FeatureSet/AdminDashboard/src/Locales",
  "App/FeatureSet/Docs/Locales",
];

// Every string of a nested locale file, by its dotted key.
function flatten(
  value: unknown,
  prefix: string,
  into: Record<string, string>,
): Record<string, string> {
  if (typeof value === "string") {
    into[prefix] = value;
  } else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(
      value as Record<string, unknown>,
    )) {
      flatten(inner, prefix ? `${prefix}.${key}` : key, into);
    }
  }

  return into;
}

describe("the other frontends' locale files", () => {
  interface LocaleEntry {
    directory: string;
    key: string;
    paths: Array<WrittenPath>;
  }

  const ENTRIES: Array<LocaleEntry> = FRONTEND_LOCALE_DIRECTORIES.flatMap(
    (directory: string): Array<LocaleEntry> => {
      const english: Record<string, string> = flatten(
        readJson(path.join(PACKAGES_ROOT, directory, "en.json")),
        "",
        {},
      );

      return Object.entries(english)
        .map(([key, text]: [string, string]): LocaleEntry => {
          return { directory, key, paths: writtenPaths(text, MENUS) };
        })
        .filter((entry: LocaleEntry): boolean => {
          return entry.paths.length > 0;
        });
    },
  );

  test("the scan reads the MCP sign-in note, the marketplace note and the API Reference's keys and permissions", () => {
    expect(
      ENTRIES.map((entry: LocaleEntry): string => {
        return `${entry.directory}: ${entry.key}`;
      }),
    ).toEqual(
      expect.arrayContaining([
        "App/FeatureSet/Accounts/src/Locales: mcpAuthorize.permissionsNote",
        "App/FeatureSet/Accounts/src/Locales: marketplacePurchase.billingNote",
        "App/FeatureSet/APIReference/Locales: pages.authentication.generateApiKeyBody",
        "App/FeatureSet/APIReference/Locales: pages.authentication.projectIdBody",
        "App/FeatureSet/APIReference/Locales: pages.permissions.intro",
      ]),
    );
  });

  test("every English path walks the menu", () => {
    const problems: Array<string> = ENTRIES.flatMap(
      (entry: LocaleEntry): Array<string> => {
        return entry.paths.flatMap((written: WrittenPath): Array<string> => {
          return written.problems.map((problem: string): string => {
            return `${entry.directory}: ${entry.key} ${problem}`;
          });
        });
      },
    );

    expect(problems).toEqual([]);
    expect(
      ENTRIES.flatMap((entry: LocaleEntry): Array<string> => {
        return entry.paths.map(stepsOf);
      }),
    ).toEqual(
      expect.arrayContaining([
        "Project Settings > AI > MCP Server",
        "Project Settings > Billing and Invoices > Billing",
        "Project Settings > Advanced > API Keys",
        "Project Settings > Project",
      ]),
    );
  });

  test.each(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )(
    "%s: every path, each step in order, as its Dashboard draws it",
    (language: string) => {
      const dashboard: Record<string, unknown> = dashboardLocale(language);
      const misnamed: Array<string> = [];

      for (const directory of FRONTEND_LOCALE_DIRECTORIES) {
        const file: string = path.join(
          PACKAGES_ROOT,
          directory,
          `${language}.json`,
        );

        if (!fs.existsSync(file)) {
          continue;
        }

        const translated: Record<string, string> = flatten(
          readJson(file),
          "",
          {},
        );

        for (const entry of ENTRIES.filter((each: LocaleEntry): boolean => {
          return each.directory === directory;
        })) {
          const value: string | undefined = translated[entry.key];

          if (!value) {
            continue;
          }

          for (const written of entry.paths) {
            const steps: Array<string> = drawnSteps(dashboard, written);

            if (!namesInOrder(readableText(value), steps)) {
              misnamed.push(
                `${directory}: ${entry.key} -> ${value} (expected ${steps.join(" > ")})`,
              );
            }
          }
        }
      }

      expect(misnamed).toEqual([]);
    },
  );
});

// A breadcrumb definition: the page, then its titles.
const BREADCRUMB: RegExp =
  /BuildBreadcrumbLinksByTitles\(\s*PageMap\.([A-Z_]+),\s*\[([^\]]*)\]/g;
const QUOTED: RegExp = /"([^"]+)"/g;

function breadcrumbTitles(file: string, page: string): Array<string> {
  for (const match of Array.from(
    readDashboardSource(file).matchAll(BREADCRUMB),
  )) {
    if (match[1] === page) {
      return Array.from((match[2] as string).matchAll(QUOTED)).map(
        (title: RegExpMatchArray): string => {
          return title[1] as string;
        },
      );
    }
  }

  throw new Error(`${file} has no breadcrumb for ${page}`);
}

describe("the Slack and Microsoft Teams pages go by their side menus' names", () => {
  const userWorkspace: SettingsMenuSection | undefined =
    MENUS.userSettings.sections.find(
      (candidate: SettingsMenuSection): boolean => {
        return candidate.title === MENUS.workspace;
      },
    );

  test.each([
    [
      "Utils/Breadcrumbs/UserSettingsBreadcrumbs.ts",
      "USER_SETTINGS_SLACK_INTEGRATION",
      USER_SETTINGS,
      "Slack",
    ],
    [
      "Utils/Breadcrumbs/UserSettingsBreadcrumbs.ts",
      "USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION",
      USER_SETTINGS,
      "Microsoft Teams",
    ],
    [
      "Utils/Breadcrumbs/SettingsBreadcrumbs.ts",
      "SETTINGS_SLACK_INTEGRATION",
      "Settings",
      "Slack",
    ],
    [
      "Utils/Breadcrumbs/SettingsBreadcrumbs.ts",
      "SETTINGS_MICROSOFT_TEAMS_INTEGRATION",
      "Settings",
      "Microsoft Teams",
    ],
  ])(
    "%s: %s ends at the page's menu entry",
    (file: string, page: string, parent: string, entry: string) => {
      expect(breadcrumbTitles(file, page)).toEqual(["Project", parent, entry]);
      expect(MENUS.chatWorkspaces).toContain(entry);
      expect(userWorkspace?.items).toContain(entry);
      expect(section("Workspace").items).toContain(entry);
    },
  );

  test("the User Settings and Project Settings side menus link those very pages", () => {
    const userMenu: string = readDashboardSource(
      "Pages/UserSettings/SideMenu.tsx",
    );
    const projectMenu: string = readDashboardSource(
      "Pages/Settings/SideMenu.tsx",
    );

    expect(userMenu).toContain(
      "slack: PageMap.USER_SETTINGS_SLACK_INTEGRATION",
    );
    expect(userMenu).toContain(
      "microsoftTeams: PageMap.USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION",
    );

    for (const [title, page] of [
      ["Slack", "SETTINGS_SLACK_INTEGRATION"],
      ["Microsoft Teams", "SETTINGS_MICROSOFT_TEAMS_INTEGRATION"],
    ] as Array<[string, string]>) {
      const entry: string = projectMenu.slice(
        projectMenu.indexOf(`title: "${title}"`),
        projectMenu.indexOf("icon:", projectMenu.indexOf(`title: "${title}"`)),
      );

      expect(entry).toContain(`PageMap.${page}]`);
    }
  });

  test.each([
    [
      "Components/NotificationMethods/Slack.tsx",
      "Slack",
      "USER_SETTINGS_SLACK_INTEGRATION",
    ],
    [
      "Components/NotificationMethods/MicrosoftTeams.tsx",
      "Microsoft Teams",
      "USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION",
    ],
  ])(
    "%s: the dialog's button names the page it opens as the menu does",
    (file: string, entry: string, page: string) => {
      const source: string = readDashboardSource(file);
      const dialog: string = source.slice(
        source.indexOf("submitButtonText="),
        source.indexOf("/>", source.indexOf("submitButtonText=")),
      );

      expect(dialog).toContain(`submitButtonText={"Open ${entry} Settings"}`);
      expect(dialog).toContain(`RouteMap[PageMap.${page}]`);
      expect(source).not.toContain("Integration Settings");
    },
  );

  test("the buttons are translated in every language, naming the workspace as the product", () => {
    const english: Record<string, unknown> = dashboardLocale("en");

    for (const [button, workspace] of [
      ["Open Slack Settings", "Slack"],
      ["Open Microsoft Teams Settings", "Microsoft Teams"],
    ] as Array<[string, string]>) {
      expect(english[button]).toBe(button);

      for (const language of LANGUAGES) {
        const value: string = String(dashboardLocale(language)[button]);

        expect({ language, button, translated: value !== button }).toEqual({
          language,
          button,
          translated: true,
        });
        expect({ language, value, names: value.includes(workspace) }).toEqual({
          language,
          value,
          names: true,
        });
      }
    }

    // The old labels named a page by its breadcrumb, which no menu has.
    expect(english["Open Slack Integration Settings"]).toBeUndefined();
    expect(
      english["Open Microsoft Teams Integration Settings"],
    ).toBeUndefined();
  });
});

describe("the status page side menu names Microsoft Teams in full", () => {
  test("its subscriber list is Microsoft Teams Subscribers, the title its own page gives it", () => {
    const menu: string = readDashboardSource(
      "Pages/StatusPages/View/SideMenu.tsx",
    );
    const page: string = readDashboardSource(
      "Pages/StatusPages/View/MicrosoftTeamsSubscribers.tsx",
    );

    expect(menu).toContain('title: "Microsoft Teams Subscribers"');
    expect(menu).not.toContain("MS Teams");
    expect(page).toContain('title: "Microsoft Teams Subscribers"');
  });

  test("every language draws it with the product's whole name", () => {
    for (const language of LANGUAGES) {
      const value: string = drawnTitle(
        dashboardLocale(language),
        "Microsoft Teams Subscribers",
      );

      expect({
        language,
        value,
        full: value.includes("Microsoft Teams"),
      }).toEqual({ language, value, full: true });
    }
  });
});

describe("the AI agent emails send their owners to a page that exists", () => {
  test("the link is the project's Code page, a route the Dashboard has", () => {
    const service: string = fs.readFileSync(
      path.join(PACKAGES_ROOT, "Common/Server/Services/AIAgentService.ts"),
      "utf8",
    );
    const routes: string = readDashboardSource("Utils/RouteMap.ts");

    expect(service).toContain("`/${projectId.toString()}/code`");
    expect(service).not.toContain("settings/ai-agents");
    expect(service).not.toContain("/ai/agents`");
    expect(routes).toContain(
      "[PageMap.CODE]: new Route(`/dashboard/${RouteParams.ProjectID}/code`),",
    );
    expect(routes).not.toContain("ai-agents");
  });

  test("the status email names that page by the Products menu's word for it, and its button says so", () => {
    const template: string = fs.readFileSync(
      path.join(
        PACKAGES_ROOT,
        "App/FeatureSet/Notification/Templates/AIAgentConnectionStatusChange.hbs",
      ),
      "utf8",
    );
    const english: { navbar: { items: Record<string, unknown> } } =
      dashboardLocale("en") as { navbar: { items: Record<string, unknown> } };

    expect(english.navbar.items["codeTitle"]).toBe("Code");
    expect(template).toContain(
      "Open Code to see whether AI can work in your repositories right now.",
    );
    expect(template).toContain('buttonText="Open Code"');
    expect(template).not.toContain("Tasks");
    expect(template).not.toContain("Project Settings");
  });
});

describe("ee/ is read where it is checked out", () => {
  test("the scan's roots include ee/'s server and frontends", () => {
    const eeFiles: Array<string> = FOUND_TEXTS.map(
      (found: FoundText): string => {
        return found.file;
      },
    ).filter((file: string): boolean => {
      return file.startsWith("../ee/");
    });

    if (fs.existsSync(path.join(REPO_ROOT, "ee"))) {
      expect(eeFiles.length).toBeGreaterThan(0);
    } else {
      expect(eeFiles).toEqual([]);
    }
  });
});
