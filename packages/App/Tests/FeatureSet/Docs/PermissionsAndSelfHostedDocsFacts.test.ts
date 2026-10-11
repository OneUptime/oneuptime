import { readPage } from "./DocsContentSupport";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import AndroidNotificationChannel from "Common/Types/PushNotification/AndroidNotificationChannel";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Docs overhaul task 20: what the Users, Teams & Permissions page and the
 * Push Notifications, SendGrid Inbound Email, Private Network Access and
 * Architecture pages say, held to the menus, models, settings, chart, compose
 * files and apps that do it. The translations are held to these pages by
 * PermissionsAndSelfHostedDocsTranslations.
 *
 * What earlier suites hold stays with them: who may do what on the
 * permissions page (TeamAccessDocs, ApiKeyAccessDocs, the scope and read
 * suites it lists), push receipts (ExpoPushReceiptsDocs), the critical alert
 * payload (Common's CriticalPushAlertPayload and
 * PushNotificationDeliveryOptions), the Global LLM Provider paragraph
 * (PrivateNetworkAccessDocs), the probes' private network switch (Probe's
 * PrivateNetworkMonitorsDeploymentSurfaces) and the Enterprise Edition
 * (EnterpriseEditionDocs). This one holds the rest: the paths, labels and
 * plans the pages name, the settings and their defaults, the routes and the
 * components.
 *
 * Markdown is not compiled and App tests read no React module, so the
 * screens' words are read from their source files, and the scripts, compose
 * files, chart and the mobile app from the repository.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");

const PERMISSIONS: string = "permissions/index";
const PUSH: string = "self-hosted/push-notifications";
const INBOUND_EMAIL: string = "self-hosted/sendgrid-inbound-email";
const PRIVATE_NETWORK: string = "self-hosted/private-network-access";
const ARCHITECTURE: string = "self-hosted/architecture";

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";
const COMMON_SERVER: string = "packages/Common/Server";
const MOBILE_APP: string = "packages/MobileApp";
const CHART: string = "HelmChart/Public/oneuptime";

const SOURCES: Record<string, string> = {
  configExample: "config.example.env",
  compose: "docker-compose.yml",
  chartValues: `${CHART}/values.yaml`,
  chartHelpers: `${CHART}/templates/_helpers.tpl`,
  chartProbe: `${CHART}/templates/probe.yaml`,
  ingressConfig: "packages/Nginx/default.conf.template",
  environmentConfig: `${COMMON_SERVER}/EnvironmentConfig.ts`,
  projectService: `${COMMON_SERVER}/Services/ProjectService.ts`,
  pushService: `${COMMON_SERVER}/Services/PushNotificationService.ts`,
  receiptQueue: `${COMMON_SERVER}/Infrastructure/ExpoPushReceiptQueue.ts`,
  inboundFactory: `${COMMON_SERVER}/Services/InboundEmail/InboundEmailProviderFactory.ts`,
  sendGridProvider: `${COMMON_SERVER}/Services/InboundEmail/Providers/SendGridInboundProvider.ts`,
  incomingEmailApi:
    "packages/App/FeatureSet/Telemetry/API/ProbeIngest/IncomingEmail.ts",
  monitorAddress:
    "packages/Common/Utils/Monitor/IncomingEmailMonitorAddress.ts",
  workflowEmailTrigger:
    "packages/Common/Types/Workflow/IncomingEmailTrigger.ts",
  userPush: "packages/Common/Models/DatabaseModels/UserPush.ts",
  navBar: "packages/Common/UI/Components/Navbar/NavBar.tsx",
  dashboardNavBar: `${DASHBOARD}/Components/NavBar/NavBar.tsx`,
  navigationItems: `${DASHBOARD}/Utils/NavigationItems.tsx`,
  dashboardLocale: `${DASHBOARD}/Locales/en.json`,
  settingsSideMenu: `${DASHBOARD}/Pages/Settings/SideMenu.tsx`,
  usersPage: `${DASHBOARD}/Pages/Users/Index.tsx`,
  projectInvitations: `${DASHBOARD}/Pages/Global/ProjectInvitations.tsx`,
  userChip: `${DASHBOARD}/Components/User/User.tsx`,
  teamPermissionTable: `${DASHBOARD}/Components/Team/TeamPermissionTable.tsx`,
  pushCard: `${DASHBOARD}/Components/NotificationMethods/Push.tsx`,
  userSettingsSideMenu: `${DASHBOARD}/Pages/UserSettings/SideMenu.tsx`,
  mobileAppJson: `${MOBILE_APP}/app.json`,
  mobileAppConfig: `${MOBILE_APP}/app.config.js`,
  mobileEas: `${MOBILE_APP}/eas.json`,
  mobileChannels: `${MOBILE_APP}/src/notifications/channels.ts`,
  mobileCriticalAlerts: `${MOBILE_APP}/src/notifications/criticalAlerts.ts`,
  mobileSettingsScreen: `${MOBILE_APP}/src/screens/SettingsScreen.tsx`,
};

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: { load: (text: string) => unknown } = require(
  path.join(REPO_DIR, "packages", "Common", "node_modules", "js-yaml"),
);

// Where the Expo SDK the server sends with posts pushes and asks for receipts.
const expoClientValues: {
  sendApiUrl: string;
  getReceiptsApiUrl: string;
} = require(
  path.join(
    REPO_DIR,
    "packages",
    "Common",
    "node_modules",
    "expo-server-sdk",
    "build",
    "ExpoClientValues.js",
  ),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const REGEX_SPECIAL: RegExp = /[.*+?^${}()|[\]\\]/g;

// A row of a Markdown table, and the row under a table's header.
const TABLE_ROW: RegExp = /^\|.*\|$/;
const TABLE_SEPARATOR: RegExp = /^\|(?:\s*:?-+:?\s*\|)+$/;

const INLINE_CODE: RegExp = /`([^`]+)`/g;

// "**Project Settings > Basic > Labels**": a menu path in one bold span.
const PROJECT_SETTINGS_PATH: RegExp = /\*\*Project Settings > ([^*]+)\*\*/g;

// "{ title: "Basic", items: [" - a section of a menu written as data.
const OBJECT_MENU_SECTION: RegExp =
  /title: "([^"]+)",\s*(?:defaultCollapsed: (?:true|false),\s*)?items: \[/g;

// "link: { title: "Labels"," - one of a section's links.
const OBJECT_MENU_ITEM: RegExp = /link: \{\s*title: "([^"]+)"/g;

// A "KEY=value" line of config.example.env.
const CONFIG_LINE: RegExp = /^([A-Z][A-Z0-9_]*)=(.*)$/;

// "  services:" and each "  name:" under it, in a compose file.
const COMPOSE_SERVICE: RegExp = /^ {2}([a-z0-9-]+):$/;

// An array of string literals, as `[ "a", "b" ]` spells it.
const STRING_LITERAL: RegExp = /"([^"]+)"/g;

// "1.5.0": a release of the mobile app.
const SEMVER: RegExp = /^(\d+)\.(\d+)\.(\d+)$/;

// 'label: "Owned by this team or its members"' - an option of a dropdown.
const DROPDOWN_OPTION_LABEL: RegExp = /label: "([^"]+)"/g;

function readSource(key: string): string {
  const relativePath: string | undefined = SOURCES[key];

  expect({ key, known: Boolean(relativePath) }).toEqual({ key, known: true });

  return fs.readFileSync(path.join(REPO_DIR, relativePath as string), "utf8");
}

function english(page: string): string {
  return readPage("en", page);
}

function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIAL, "\\$&");
}

function inlineCodes(text: string): Array<string> {
  return [...text.matchAll(INLINE_CODE)].map(
    (match: RegExpExecArray): string => {
      return match[1] as string;
    },
  );
}

// A cell's text without the backticks around it.
function unwrapCode(cell: string): string {
  return cell.startsWith("`") && cell.endsWith("`") ? cell.slice(1, -1) : cell;
}

/*
 * The tables of a page, each as its rows of cells, header first, outside
 * fenced code.
 */
function tablesOf(markdown: string): Array<Array<Array<string>>> {
  const tables: Array<Array<Array<string>>> = [];
  let current: Array<Array<string>> | null = null;
  let inFence: boolean = false;

  for (const raw of markdown.split("\n")) {
    const line: string = raw.trim();

    if (line.startsWith("```")) {
      inFence = !inFence;
    }

    if (inFence || !TABLE_ROW.test(line)) {
      current = null;
      continue;
    }

    if (TABLE_SEPARATOR.test(line)) {
      continue;
    }

    const cells: Array<string> = line
      .slice(1, -1)
      .split("|")
      .map((cell: string): string => {
        return cell.trim();
      });

    if (!current) {
      current = [];
      tables.push(current);
    }

    current.push(cells);
  }

  return tables;
}

// The one table of a page whose header starts with these cells.
function tableHeaded(
  markdown: string,
  header: Array<string>,
): Array<Array<string>> {
  const tables: Array<Array<Array<string>>> = tablesOf(markdown).filter(
    (table: Array<Array<string>>): boolean => {
      return header.every((cell: string, index: number): boolean => {
        return table[0]?.[index] === cell;
      });
    },
  );

  expect({ header, tables: tables.length }).toEqual({ header, tables: 1 });

  return (tables[0] as Array<Array<string>>).slice(1);
}

// The value at a dotted path of the chart's values.
function chartValue(dottedPath: string): unknown {
  let value: unknown = jsYaml.load(readSource("chartValues"));

  for (const part of dottedPath.split(".")) {
    value = (value as Record<string, unknown> | null | undefined)?.[part];
  }

  return value;
}

function chartHasValue(dottedPath: string): boolean {
  let value: unknown = jsYaml.load(readSource("chartValues"));

  for (const part of dottedPath.split(".")) {
    if (
      !value ||
      typeof value !== "object" ||
      !Object.prototype.hasOwnProperty.call(value, part)
    ) {
      return false;
    }

    value = (value as Record<string, unknown>)[part];
  }

  return true;
}

// The value config.example.env gives a variable, or undefined.
function configExampleValue(variable: string): string | undefined {
  for (const line of readSource("configExample").split("\n")) {
    const match: RegExpExecArray | null = CONFIG_LINE.exec(line.trim());

    if (match && match[1] === variable) {
      return match[2] as string;
    }
  }

  return undefined;
}

/*
 * Whether a chart template renders an environment variable from a value:
 * "$.Values.vapid.subject", or "($.Values.webhooks).allowPrivateNetwork",
 * which reads a value whose parent may be missing.
 */
function chartRendersFrom(
  template: string,
  variable: string,
  dottedPath: string,
): boolean {
  const parts: Array<string> = dottedPath.split(".");
  const direct: string = `\\$\\.Values\\.${escapeRegex(dottedPath)}\\b`;
  const guarded: string = `\\(\\$\\.Values\\.${escapeRegex(
    parts[0] as string,
  )}\\)\\.${escapeRegex(parts.slice(1).join("."))}\\b`;

  return new RegExp(
    `- name: ${escapeRegex(variable)}\\n\\s*value: [^\\n]*(?:${direct}|${guarded})`,
  ).test(template);
}

// The sections of a menu written as data, each with the titles of its links.
function objectMenu(source: string): Map<string, Array<string>> {
  const sections: Map<string, Array<string>> = new Map();
  const starts: Array<RegExpExecArray> = [
    ...source.matchAll(OBJECT_MENU_SECTION),
  ];

  starts.forEach((start: RegExpExecArray, index: number): void => {
    const end: number =
      index + 1 < starts.length
        ? (starts[index + 1] as RegExpExecArray).index
        : source.length;
    const body: string = source.slice(start.index, end);

    sections.set(
      start[1] as string,
      [...body.matchAll(OBJECT_MENU_ITEM)].map(
        (item: RegExpExecArray): string => {
          return item[1] as string;
        },
      ),
    );
  });

  return sections;
}

// The services of a compose file.
function composeServices(source: string): Array<string> {
  const services: Array<string> = [];
  let inServices: boolean = false;

  for (const line of source.split("\n")) {
    if (line === "services:") {
      inServices = true;
      continue;
    }

    if (inServices && line.length > 0 && !line.startsWith(" ")) {
      break;
    }

    const match: RegExpExecArray | null = inServices
      ? COMPOSE_SERVICE.exec(line)
      : null;

    if (match) {
      services.push(match[1] as string);
    }
  }

  return services;
}

// What a new project's default teams are created with, by team name.
interface DefaultTeam {
  permission: string;
  isPermissionsEditable: boolean;
  isTeamEditable: boolean;
  isTeamDeleteable: boolean;
  shouldHaveAtLeastOneMember: boolean;
}

function defaultTeams(): Map<string, DefaultTeam> {
  const service: string = readSource("projectService");
  const start: number = service.indexOf(
    "private async addDefaultProjectTeams(",
  );

  expect(start).toBeGreaterThan(-1);

  const body: string = service.slice(start, service.indexOf("\n  }\n", start));
  const teams: Map<string, DefaultTeam> = new Map();

  // Each team is a "<variable>Team" whose permission row is "<variable>Permissions".
  for (const variable of ["owner", "admin", "member"]) {
    const flag: (name: string) => boolean = (name: string): boolean => {
      return new RegExp(`${variable}Team\\.${name} = true;`).test(body);
    };
    const name: RegExpExecArray | null = new RegExp(
      `${variable}Team\\.name = "([^"]+)";`,
    ).exec(body);
    const permission: RegExpExecArray | null = new RegExp(
      `${variable}Permissions\\.permission = Permission\\.(\\w+);`,
    ).exec(body);

    expect({
      variable,
      name: Boolean(name),
      permission: Boolean(permission),
    }).toEqual({ variable, name: true, permission: true });

    teams.set(name![1] as string, {
      permission: permission![1] as string,
      isPermissionsEditable: flag("isPermissionsEditable"),
      isTeamEditable: flag("isTeamEditable"),
      isTeamDeleteable: flag("isTeamDeleteable"),
      shouldHaveAtLeastOneMember: flag("shouldHaveAtLeastOneMember"),
    });
  }

  return teams;
}

// A key of the Dashboard's English locale.
function dashboardLabel(key: string): string {
  let label: unknown = JSON.parse(readSource("dashboardLocale"));

  for (const part of key.split(".")) {
    label = (label as Record<string, unknown> | undefined)?.[part];
  }

  expect({ key, found: typeof label === "string" }).toEqual({
    key,
    found: true,
  });

  return label as string;
}

describe("Users, Teams & Permissions, against the dashboard and the server", () => {
  const page: string = english(PERMISSIONS);

  it("opens Users and Teams from the Products menu, under Settings, as the navigation draws them", () => {
    // The navbar's menu of products is titled Products unless a page says otherwise; the Dashboard does not.
    expect(readSource("navBar")).toContain(
      'translateString(props.moreMenuTitle || "Products")',
    );
    expect(readSource("dashboardNavBar")).not.toContain("moreMenuTitle=");

    const navigation: string = readSource("navigationItems");

    expect(navigation).toContain(
      'const settingsCategory: string = t("navbar.categories.settings");',
    );

    for (const [key, label] of [
      ["navbar.items.usersTitle", "Users"],
      ["navbar.items.teamsTitle", "Teams"],
    ]) {
      const item: number = navigation.indexOf(`title: t("${key}")`);
      const next: number = navigation.indexOf("category:", item);

      expect({ key, label: dashboardLabel(key as string) }).toEqual({
        key,
        label,
      });
      expect({
        key,
        category: navigation.slice(next, navigation.indexOf("\n", next)).trim(),
      }).toEqual({ key, category: "category: settingsCategory," });
    }

    expect(dashboardLabel("navbar.categories.settings")).toBe("Settings");
    expect(page).toContain(
      "Open **Users** from the **Products** menu, under **Settings**, and click **Invite User**.",
    );
    expect(page).toContain(
      "Open **Teams** from the **Products** menu, under **Settings**, and click **Create Team**.",
    );
  });

  it("asks what the invite form asks, and has invitations accepted where the dashboard lists them", () => {
    const users: string = readSource("usersPage");

    expect(users).toContain('title: "Invite User"');
    expect(users).toContain('submitButtonText="Invite"');

    for (const field of ["Email", "Name", "Team"]) {
      expect({ field, onForm: users.includes(`title: "${field}"`) }).toEqual({
        field,
        onForm: true,
      });
    }

    expect(page).toContain(
      "Type their **Email**. Someone who has no OneUptime account yet is also asked for a **Name**.",
    );
    expect(page).toContain(
      "Pick their **Team**, which decides what they can do, and click **Invite**.",
    );

    expect(readSource("projectInvitations")).toContain(
      'title={"Project Invitations"}',
    );
    expect(page).toContain(
      "They accept from the bell at the top right, on **Project Invitations**",
    );
  });

  it("names a former member and a pending invitation as the user chip draws them", () => {
    const chip: string = readSource("userChip");

    for (const state of ["No longer a member", "Invitation not accepted yet"]) {
      expect({
        state,
        drawn: chip.includes(`translator.translateText("${state}")`),
        documented: page.includes(`**${state}**`),
      }).toEqual({ state, drawn: true, documented: true });
    }
  });

  it("lists the three teams a new project starts with, with their permission and whether they can be edited", () => {
    const teams: Map<string, DefaultTeam> = defaultTeams();
    const rows: Array<Array<string>> = tableHeaded(page, [
      "Team",
      "Permission it holds",
      "Editable",
    ]);

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([...teams.keys()]);

    for (const [name, permission, editable] of rows) {
      const team: DefaultTeam | undefined = teams.get(name as string);

      expect({
        name,
        permission: unwrapCode(permission as string),
        editable: (editable as string).startsWith("Yes"),
        atLeastOneMember: (editable as string).includes(
          "Always has at least one member",
        ),
      }).toEqual({
        name,
        permission: team?.permission,
        editable: team?.isPermissionsEditable,
        atLeastOneMember: team?.shouldHaveAtLeastOneMember,
      });
    }
  });

  it("says the Owners and Admin teams cannot be edited, renamed or deleted, and Members can be deleted", () => {
    const teams: Map<string, DefaultTeam> = defaultTeams();

    for (const name of ["Owners", "Admin"]) {
      expect({ name, ...teams.get(name) }).toMatchObject({
        name,
        isPermissionsEditable: false,
        isTeamEditable: false,
        isTeamDeleteable: false,
      });
    }

    expect(teams.get("Members")?.isTeamDeleteable).toBe(true);
    expect(page).toContain(
      "The **Owners** and **Admin** teams are deliberately locked: their permissions cannot be edited and the teams cannot be deleted or renamed.",
    );
    expect(page).toContain(
      "The Owners team must always keep at least one member.",
    );
  });

  it("names the OneUptime Cloud plan each model is gated on", () => {
    // Creating a team, and adding or changing its permissions.
    expect(new Team().createBillingPlan).toBe(PlanType.Scale);
    expect(new TeamPermission().createBillingPlan).toBe(PlanType.Scale);
    expect(new TeamPermission().updateBillingPlan).toBe(PlanType.Scale);
    expect(page).toContain(
      "On OneUptime Cloud, creating a team and changing its permissions needs the Scale plan.",
    );

    // Creating and changing labels.
    expect(new Label().createBillingPlan).toBe(PlanType.Growth);
    expect(new Label().updateBillingPlan).toBe(PlanType.Growth);
    expect(page).toContain(
      "On OneUptime Cloud, creating and changing labels needs the Growth plan.",
    );

    // API keys, whatever is done with them.
    const apiKey: ApiKey = new ApiKey();

    expect([
      apiKey.createBillingPlan,
      apiKey.readBillingPlan,
      apiKey.updateBillingPlan,
      apiKey.deleteBillingPlan,
    ]).toEqual([
      PlanType.Growth,
      PlanType.Growth,
      PlanType.Growth,
      PlanType.Growth,
    ]);
    expect(page).toContain(
      "On OneUptime Cloud, API keys need the Growth plan.",
    );
  });

  it("names every Project Settings page by the side menu's section and link", () => {
    const menu: Map<string, Array<string>> = objectMenu(
      readSource("settingsSideMenu"),
    );
    const paths: Array<string> = [...page.matchAll(PROJECT_SETTINGS_PATH)].map(
      (match: RegExpExecArray): string => {
        return match[1] as string;
      },
    );

    expect(dashboardLabel("navbar.items.projectSettingsTitle")).toBe(
      "Project Settings",
    );
    expect(new Set(paths)).toEqual(
      new Set([
        "Basic > Labels",
        "Advanced > API Keys",
        "Notifications > Notification Settings",
        "AI > AI Credits",
      ]),
    );

    for (const menuPath of paths) {
      const [section, link] = menuPath.split(" > ") as [string, string];

      expect({
        menuPath,
        inMenu: (menu.get(section) || []).includes(link),
      }).toEqual({ menuPath, inMenu: true });
    }
  });

  it("names the scopes as a team permission's Scope field offers them, All first", () => {
    const form: string = readSource("teamPermissionTable");
    const scopeField: number = form.indexOf('title: "Scope"');
    const options: Array<string> = [
      "All resources in the project",
      "Owned by this team or its members",
      "Restrict by labels (advanced)",
    ];

    expect(scopeField).toBeGreaterThan(-1);

    const field: string = form.slice(scopeField, form.indexOf("]", scopeField));

    expect(
      [...field.matchAll(DROPDOWN_OPTION_LABEL)].map(
        (match: RegExpExecArray): string => {
          return match[1] as string;
        },
      ),
    ).toEqual(options);
    expect(field).toContain("value: PermissionScope.All,");
    expect(form.slice(scopeField, scopeField + 2000)).toContain(
      "defaultValue: PermissionScope.All,",
    );

    expect(
      tableHeaded(page, ["Scope", "Meaning"]).map(
        (row: Array<string>): string => {
          return row[0] as string;
        },
      ),
    ).toEqual(options);
    expect(page).toContain(
      "Every allow permission is granted with a scope, chosen under **Scope** when you add it:",
    );
  });
});

describe("Push Notifications, against the server, the chart and the mobile app", () => {
  const page: string = english(PUSH);
  const rows: Array<Array<string>> = tableHeaded(page, [
    "Variable",
    "Helm value",
    "Default",
    "What it does",
  ]);

  it("lists the five push settings, each with its Helm value, its default and its config.example.env line", () => {
    const helpers: string = readSource("chartHelpers");

    expect(
      rows.map((row: Array<string>): string => {
        return unwrapCode(row[0] as string);
      }),
    ).toEqual([
      "PUSH_NOTIFICATION_RELAY_URL",
      "EXPO_ACCESS_TOKEN",
      "VAPID_PUBLIC_KEY",
      "VAPID_PRIVATE_KEY",
      "VAPID_SUBJECT",
    ]);

    for (const [variableCell, helmCell, defaultCell] of rows) {
      const variable: string = unwrapCode(variableCell as string);
      const helmValue: string = unwrapCode(helmCell as string);
      const documented: string =
        defaultCell === "Empty" ? "" : unwrapCode(defaultCell as string);
      const chartDefault: unknown = chartValue(helmValue);

      expect({
        variable,
        configExample: configExampleValue(variable),
        chartHasValue: chartHasValue(helmValue),
        chartDefault:
          chartDefault === null || chartDefault === undefined
            ? ""
            : String(chartDefault),
        rendered: chartRendersFrom(helpers, variable, helmValue),
      }).toEqual({
        variable,
        configExample: documented,
        chartHasValue: true,
        chartDefault: documented,
        rendered: true,
      });
    }
  });

  it("gives the defaults the server falls back to when a setting is unset", () => {
    const environment: string = readSource("environmentConfig");

    expect(environment).toMatch(
      /process\.env\["PUSH_NOTIFICATION_RELAY_URL"\] \|\|\s*"https:\/\/oneuptime\.com\/api\/notification\/push-relay\/send"/,
    );
    expect(environment).toMatch(
      /process\.env\["VAPID_SUBJECT"\] \|\| "mailto:support@oneuptime\.com"/,
    );
    expect(environment).toMatch(
      /process\.env\["EXPO_ACCESS_TOKEN"\] \|\| undefined/,
    );
  });

  it("sends through the relay without EXPO_ACCESS_TOKEN, and to Expo with it", () => {
    const service: string = readSource("pushService");

    expect(service).toContain(
      "ExpoAccessToken ? { accessToken: ExpoAccessToken } : undefined",
    );
    expect(service).toContain("return Boolean(ExpoAccessToken);");
    expect(service).toContain(
      "if (!PushNotificationService.hasExpoAccessToken()) {",
    );
    expect(page).toContain(
      "The backend sends notifications through OneUptime's push relay, or directly to Expo when `EXPO_ACCESS_TOKEN` is configured.",
    );
  });

  it("names the Expo addresses the server's Expo SDK sends to and reads receipts from", () => {
    const network: Array<Array<string>> = tableHeaded(page, [
      "Direction",
      "Destination",
    ]);
    const expoRow: Array<string> | undefined = network.find(
      (row: Array<string>): boolean => {
        return row[0] === "OneUptime → Expo";
      },
    );

    expect(inlineCodes(expoRow?.[1] || "")).toEqual([
      expoClientValues.sendApiUrl,
      expoClientValues.getReceiptsApiUrl,
    ]);
  });

  it("lists the web push services the server accepts, and no other", () => {
    const service: string = readSource("pushService");
    const start: number = service.indexOf(
      "const ALLOWED_WEB_PUSH_HOSTS: Array<string> = [",
    );

    expect(start).toBeGreaterThan(-1);

    const allowed: Array<string> = [
      ...service
        .slice(start, service.indexOf("];", start))
        .matchAll(STRING_LITERAL),
    ].map((match: RegExpExecArray): string => {
      return match[1] as string;
    });
    const sentence: string =
      page.split("\n").find((line: string): boolean => {
        return line.includes("OneUptime accepts `");
      }) || "";
    const accepted: Array<string> = inlineCodes(
      sentence.slice(
        sentence.indexOf("OneUptime accepts"),
        sentence.indexOf("including their subdomains"),
      ),
    );

    expect([...accepted].sort()).toEqual([...allowed].sort());
    expect(sentence).toContain("including their subdomains");
  });

  it("names the test and the device state as the Push Notifications card draws them", () => {
    const card: string = readSource("pushCard");

    expect(card).toContain(
      'name="User Settings > Notification Methods > Push Notifications"',
    );
    expect(card).toContain('title: "Test Notification"');
    expect(card).toContain('text="Not receiving notifications"');

    // The card is on Notification Methods, a link of the user settings menu.
    expect(
      objectMenu(readSource("userSettingsSideMenu")).get(
        "Alerts & Notifications",
      ),
    ).toContain("Notification Methods");

    expect(page).toContain(
      "Send a test from **User Settings > Notification Methods > Push Notifications** with **Test Notification**",
    );
    expect(page).toContain(
      "a device marked **Not receiving notifications** stopped receiving them",
    );
  });

  it("keeps pending receipts in Valkey and reads each about 15 minutes after its push", () => {
    const queue: string = readSource("receiptQueue");

    expect(queue).toContain('import Redis, { ClientType } from "./Redis";');
    expect(queue).toContain(
      "export const EXPO_PUSH_RECEIPT_FIRST_CHECK_AFTER_MS: number = 15 * 60 * 1000;",
    );
    expect(page).toContain(
      "For mobile pushes, OneUptime also reads Expo's delivery receipt about 15 minutes after each push",
    );
  });
});

describe("Push Notifications: critical on-call alerts, against the server and the mobile app", () => {
  const page: string = english(PUSH);

  it("stores the setting per device, off by default", () => {
    const model: string = readSource("userPush");
    const column: number = model.indexOf("public isCriticalAlertEnabled?:");

    expect(column).toBeGreaterThan(-1);
    expect(model.slice(column - 400, column)).toMatch(
      /type: ColumnType\.Boolean,\s*default: false,/,
    );
    expect(page).toContain(
      "Stored per device, off by default, in `UserPush.isCriticalAlertEnabled`.",
    );
  });

  it("marks the page critical as the page says, for iOS and Android", () => {
    const service: string = readSource("pushService");

    expect(service).toContain('interruptionLevel: "critical",');
    expect(service).toContain("AndroidNotificationChannel.Critical");
    expect(AndroidNotificationChannel.Critical).toBe("oncall_critical");
    expect(page).toContain(
      "plus `interruptionLevel: critical` for iOS, and targets the `oncall_critical` notification channel for Android.",
    );
  });

  it("creates the critical channel in the app with Do Not Disturb bypass and the alarm stream", () => {
    const channels: string = readSource("mobileChannels");

    expect(channels).toContain('CRITICAL: "oncall_critical",');

    const critical: string = channels.slice(
      channels.indexOf("export const CRITICAL_CHANNEL"),
    );

    expect(critical).toContain("bypassDnd: true,");
    expect(critical).toContain("usage: Notifications.AndroidAudioUsage.ALARM,");
    expect(page).toContain(
      "The `oncall_critical` notification channel requests `bypassDnd`",
    );
    expect(page).toContain("The same channel uses the **alarm** audio stream");
  });

  it("names the app's setting where its Settings screen shows it, and the Android screen it opens", () => {
    const screen: string = readSource("mobileSettingsScreen");
    const notifications: number = screen.indexOf(
      '<ListGroup title="Notifications">',
    );

    expect(screen).toContain('title="Settings"');
    expect(notifications).toBeGreaterThan(-1);
    expect(
      screen
        .slice(notifications, notifications + 400)
        .includes('title="Critical On-Call Alerts"'),
    ).toBe(true);
    expect(page).toContain(
      "**Settings > Notifications > Critical On-Call Alerts**",
    );

    expect(readSource("mobileCriticalAlerts")).toContain(
      '"android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS"',
    );
    expect(page).toContain(
      "the app opens **Settings > Notifications > Do Not Disturb access** for them",
    );
  });

  it("opts in to Apple's entitlement only in the production build profile, under the variable the page names", () => {
    const config: string = readSource("mobileAppConfig");

    expect(config).toContain(
      '"com.apple.developer.usernotifications.critical-alerts"',
    );
    expect(config).toContain(
      '(env || {}).EXPO_IOS_CRITICAL_ALERTS_ENTITLEMENT === "true"',
    );
    expect(page).toContain(
      "`com.apple.developer.usernotifications.critical-alerts` entitlement",
    );
    expect(page).toContain(
      "EXPO_IOS_CRITICAL_ALERTS_ENTITLEMENT=true npx expo prebuild",
    );

    const eas: {
      build: Record<string, { env?: Record<string, string> }>;
    } = JSON.parse(readSource("mobileEas"));

    for (const [profile, settings] of Object.entries(eas.build)) {
      expect({
        profile,
        entitlement: settings.env?.["EXPO_IOS_CRITICAL_ALERTS_ENTITLEMENT"],
      }).toEqual({
        profile,
        entitlement: profile === "production" ? "true" : undefined,
      });
    }

    expect(page).toContain(
      "Only the `production` profile in `packages/MobileApp/eas.json` turns it on",
    );
  });

  it("dates the entitlement to version 1.5.0 of the app, no later than the version the repository builds", () => {
    const version: string = (
      JSON.parse(readSource("mobileAppJson")) as {
        expo: { version: string };
      }
    ).expo.version;
    const parts: RegExpExecArray | null = SEMVER.exec(version);

    expect(parts).not.toBeNull();

    const [major, minor] = [Number(parts![1]), Number(parts![2])];

    expect(major > 1 || (major === 1 && minor >= 5)).toBe(true);
    expect(page).toContain("carries the entitlement from **version 1.5.0**");
  });
});

describe("SendGrid Inbound Email, against the server, the chart and the ingress", () => {
  const page: string = english(INBOUND_EMAIL);

  it("lists the three inbound email settings, each with its Helm value, its default and its config.example.env line", () => {
    const helpers: string = readSource("chartHelpers");
    const rows: Array<Array<string>> = tableHeaded(page, [
      "Variable",
      "Helm value",
      "Description",
      "Required",
      "Default",
    ]);

    expect(
      rows.map((row: Array<string>): string => {
        return unwrapCode(row[0] as string);
      }),
    ).toEqual([
      "INBOUND_EMAIL_PROVIDER",
      "INBOUND_EMAIL_DOMAIN",
      "INBOUND_EMAIL_WEBHOOK_SECRET",
    ]);

    for (const row of rows) {
      const variable: string = unwrapCode(row[0] as string);
      const helmValue: string = unwrapCode(row[1] as string);
      const documented: string =
        row[4] === "Empty" ? "" : unwrapCode(row[4] as string);
      const chartDefault: unknown = chartValue(helmValue);

      expect({
        variable,
        configExample: configExampleValue(variable),
        chartHasValue: chartHasValue(helmValue),
        chartDefault:
          chartDefault === null || chartDefault === undefined
            ? ""
            : String(chartDefault),
        rendered: chartRendersFrom(helpers, variable, helmValue),
      }).toEqual({
        variable,
        configExample: documented,
        chartHasValue: true,
        chartDefault: documented,
        rendered: true,
      });
    }
  });

  it("knows SendGrid as its only provider, and the default", () => {
    const environment: string = readSource("environmentConfig");
    const providers: string = environment.slice(
      environment.indexOf("export enum InboundEmailProviderType {"),
      environment.indexOf(
        "}",
        environment.indexOf("export enum InboundEmailProviderType {"),
      ),
    );

    expect([...providers.matchAll(STRING_LITERAL)].length).toBe(1);
    expect(providers).toContain('SendGrid = "SendGrid",');
    expect(environment).toContain("InboundEmailProviderType.SendGrid;");
    expect(page).toContain(
      "The inbound email provider. SendGrid is the only one.",
    );
  });

  it("turns incoming email on with the domain, and off without it", () => {
    expect(readSource("inboundFactory")).toContain(
      "return Boolean(InboundEmailDomain);",
    );
    expect(page).toContain("Incoming email is off until it is set.");
  });

  it("answers on the route the page gives, which needs its final segment, and checks the secret only when one is set", () => {
    const api: string = readSource("incomingEmailApi");

    expect(api).toContain('"/incoming-email/sendgrid/:secret",');
    expect(page).toContain(
      "`https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET`",
    );
    expect(page).toContain("The route requires the final path segment.");

    const provider: string = readSource("sendGridProvider");
    const validate: string = provider.slice(
      provider.indexOf("public async validateWebhook("),
      provider.indexOf("public extractSecretKeyFromEmail("),
    );

    expect(validate).toContain("if (this.config.webhookSecret) {");
    expect(validate).toContain(
      "return data.pathSecret === this.config.webhookSecret;",
    );
    expect(validate).toContain("return true;");
    expect(page).toContain(
      "OneUptime checks its value when the secret is configured; leaving the variable empty disables that check.",
    );
  });

  it("routes /incoming-email through the ingress to the app, whose logs the page sends readers to", () => {
    const ingress: string = readSource("ingressConfig");
    const start: number = ingress.indexOf("location /incoming-email {");

    expect(start).toBeGreaterThan(-1);

    // To the line that closes the block: "${...}" closes braces inside it.
    const location: string = ingress.slice(
      start,
      ingress.indexOf("\n    }", start),
    );

    expect(location).toContain(
      "set $backend_app http://${SERVER_APP_HOSTNAME}:${APP_PORT};",
    );
    expect(composeServices(readSource("compose"))).toContain("app");
    expect(page).toContain("in the logs of the OneUptime `app` service.");
  });

  it("gives monitor and workflow addresses the prefixes the server generates", () => {
    expect(readSource("monitorAddress")).toContain(
      'export const GENERATED_LOCAL_PART_PREFIX: string = "monitor-";',
    );
    expect(readSource("workflowEmailTrigger")).toContain(
      'export const INCOMING_EMAIL_TRIGGER_LOCAL_PART_PREFIX: string = "workflow-";',
    );
    expect(page).toContain("`monitor-abc123@inbound.yourdomain.com`");
    expect(page).toContain("(`workflow-…@inbound.yourdomain.com`)");
  });
});

describe("Private Network Access, against config.example.env and the chart", () => {
  const page: string = english(PRIVATE_NETWORK);

  it("names the webhook settings' Helm values, off by default", () => {
    const helpers: string = readSource("chartHelpers");
    const rows: Array<Array<string>> = tableHeaded(page, [
      "Variable",
      "Helm value",
      "What it allows",
    ]);

    expect(
      rows.map((row: Array<string>): Array<string> => {
        return [unwrapCode(row[0] as string), unwrapCode(row[1] as string)];
      }),
    ).toEqual([
      ["ALLOW_PRIVATE_NETWORK_WEBHOOKS", "webhooks.allowPrivateNetwork"],
      ["PRIVATE_NETWORK_WEBHOOK_ALLOWLIST", "webhooks.privateNetworkAllowlist"],
    ]);

    for (const row of rows) {
      const variable: string = unwrapCode(row[0] as string);
      const helmValue: string = unwrapCode(row[1] as string);

      expect({
        variable,
        rendered: chartRendersFrom(helpers, variable, helmValue),
      }).toEqual({ variable, rendered: true });
    }

    expect(configExampleValue("ALLOW_PRIVATE_NETWORK_WEBHOOKS")).toBe("false");
    expect(configExampleValue("PRIVATE_NETWORK_WEBHOOK_ALLOWLIST")).toBe("");
    expect(chartValue("webhooks.allowPrivateNetwork")).toBe(false);
    expect(chartValue("webhooks.privateNetworkAllowlist")).toBe("");
    expect(page).toContain(
      "On Docker Compose, `config.env` has an `ALLOW_PRIVATE_NETWORK_WEBHOOKS=false` line",
    );
  });

  it("names the outbound connections switch and the probes' switch where config.env and the chart keep them", () => {
    expect(configExampleValue("DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES")).toBe(
      "false",
    );
    expect(chartValue("outboundConnections.blockPrivateNetwork")).toBe(false);
    expect(
      chartRendersFrom(
        readSource("chartHelpers"),
        "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES",
        "outboundConnections.blockPrivateNetwork",
      ),
    ).toBe(true);
    expect(page).toContain(
      "On Docker Compose, `config.env` has a `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=false` line",
    );
    expect(page).toContain(
      "outboundConnections:\n  blockPrivateNetwork: true\n",
    );

    expect(configExampleValue("PROBE_ALLOW_PRIVATE_NETWORK_MONITORS")).toBe(
      "false",
    );
    expect(readSource("chartProbe")).toContain(
      "- name: PROBE_ALLOW_PRIVATE_NETWORK_MONITORS",
    );
    expect(page).toContain(
      "`config.env` already has a `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=false` line",
    );
  });
});

describe("Architecture, against the compose file and the chart", () => {
  const page: string = english(ARCHITECTURE);
  const rows: Array<Array<string>> = tableHeaded(page, [
    "Component",
    "Docker Compose service",
    "Helm chart",
    "What it does",
  ]);

  it("names every service docker-compose.yml runs, and only those", () => {
    const named: Array<string> = rows
      .map((row: Array<string>): string => {
        return row[1] as string;
      })
      .filter((cell: string): boolean => {
        return !cell.startsWith("Part of");
      })
      .map(unwrapCode);

    expect([...named].sort()).toEqual(
      [...composeServices(readSource("compose"))].sort(),
    );

    // The worker and the telemetry writer are roles of the app container.
    for (const component of ["Worker", "Telemetry writer"]) {
      const row: Array<string> | undefined = rows.find(
        (cells: Array<string>): boolean => {
          return cells[0] === component;
        },
      );

      expect({ component, compose: row?.[1] }).toEqual({
        component,
        compose: "Part of `app`",
      });
    }
  });

  it("names each component's values in the chart, and which are off by default", () => {
    for (const row of rows) {
      const component: string = row[0] as string;
      const helm: string = row[2] as string;

      for (const value of inlineCodes(helm)) {
        expect({ component, value, inChart: chartHasValue(value) }).toEqual({
          component,
          value,
          inChart: true,
        });
      }

      /*
       * Said off by default exactly when the chart ships the component's
       * own value turned off.
       */
      const value: string = inlineCodes(helm)[0] as string;

      expect({
        component,
        saysOffByDefault: helm.includes("(off by default)"),
      }).toEqual({
        component,
        saysOffByDefault: chartValue(`${value}.enabled`) === false,
      });
    }

    // The operator-managed databases are the alternatives, off unless chosen.
    expect(chartValue("postgresOperator.cnpg.enabled")).toBe(false);
    expect(chartValue("clickhouseOperator.altinity.enabled")).toBe(false);
  });

  it("runs one app image for every role, and keeps pending push receipts in Valkey", () => {
    const compose: string = readSource("compose");

    expect(compose).toContain("image: oneuptime/app:${APP_TAG}");
    expect(page).toContain(
      "All of the app's roles are the same image: Docker Compose runs them in one `app` container",
    );

    const valkey: Array<string> | undefined = rows.find(
      (row: Array<string>): boolean => {
        return row[0] === "Valkey";
      },
    );

    expect(valkey?.[3]).toContain("pending push receipts");
    expect(readSource("receiptQueue")).toContain(
      'import Redis, { ClientType } from "./Redis";',
    );
  });
});
