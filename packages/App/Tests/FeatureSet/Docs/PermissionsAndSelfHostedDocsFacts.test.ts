import { readPage } from "./DocsContentSupport";
import { escapeRegExp } from "./DocsTranslationChecks";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import Label from "Common/Models/DatabaseModels/Label";
import Team from "Common/Models/DatabaseModels/Team";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import AndroidNotificationChannel from "Common/Types/PushNotification/AndroidNotificationChannel";
import PushNotificationLevel, {
  DEFAULT_PUSH_NOTIFICATION_LEVEL,
} from "Common/Types/NotificationRule/PushNotificationLevel";
import {
  MAX_NOTIFICATION_REPEATS,
  NO_NOTIFICATION_REPEAT,
  REPEAT_EVERY_MINUTES_OPTIONS,
  getDueRepeatNumber,
  getRepeatEveryMinutes,
} from "Common/Types/NotificationRule/NotificationRepeat";
import CriticalAlertSound, {
  CRITICAL_ALERT_SOUNDS,
  CriticalAlertSoundDefinition,
  DEFAULT_CRITICAL_ALERT_SOUND,
  getCriticalAlertSoundDefinition,
} from "Common/Types/PushNotification/CriticalAlertSound";
import {
  CRITICAL_ALERT_VOLUME_OPTIONS,
  DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT,
} from "Common/Types/PushNotification/CriticalAlertVolume";
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
  userNotificationRule:
    "packages/Common/Models/DatabaseModels/UserNotificationRule.ts",
  notificationRuleService: `${COMMON_SERVER}/Services/UserNotificationRuleService.ts`,
  pushLevelControl: `${DASHBOARD}/Components/NotificationRule/PushNotificationLevelControl.tsx`,
  onCallRulesTable: `${DASHBOARD}/Components/NotificationRule/OnCallRulesTable.tsx`,
  userPushApi: `${COMMON_SERVER}/API/UserPushAPI.ts`,
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
  pushCriticalAlertStatus: `${DASHBOARD}/Components/NotificationMethods/PushDeviceCriticalAlertStatus.tsx`,
  pushCriticalAlerts: `${DASHBOARD}/Components/NotificationMethods/PushDeviceCriticalAlerts.ts`,
  userSettingsSideMenu: `${DASHBOARD}/Pages/UserSettings/SideMenu.tsx`,
  mobileAppJson: `${MOBILE_APP}/app.json`,
  mobileAppConfig: `${MOBILE_APP}/app.config.js`,
  mobileEas: `${MOBILE_APP}/eas.json`,
  mobileChannels: `${MOBILE_APP}/src/notifications/channels.ts`,
  mobileCriticalAlerts: `${MOBILE_APP}/src/notifications/criticalAlerts.ts`,
  mobileSettingsScreen: `${MOBILE_APP}/src/screens/SettingsScreen.tsx`,
  mobileAlarmSounds: `${MOBILE_APP}/src/notifications/criticalAlertSounds.ts`,
  mobileAlarmSoundScreen: `${MOBILE_APP}/src/screens/settings/CriticalAlertSoundScreen.tsx`,
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

// A row of a Markdown table, and the row under a table's header.
const TABLE_ROW: RegExp = /^\|.*\|$/;
const TABLE_SEPARATOR: RegExp = /^\|(?:\s*:?-+:?\s*\|)+$/;

const INLINE_CODE: RegExp = /`([^`]+)`/g;

// A fenced code block, from its opening fence to its closing one.
const FENCED_BLOCK: RegExp = /^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm;

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

// The ingress location's upstream: the app's own host name and port.
const INGRESS_TO_APP: RegExp =
  /set \$backend_app http:\/\/\$\{SERVER_APP_HOSTNAME\}:\$\{APP_PORT\};/;

// "A, B and C" or "A, B or C": what separates the items of a list in a sentence.
const LIST_SEPARATOR: RegExp = /, | and | or /;

// 'title: "Klaxon",' - the title of each of the mobile app's alarm sounds.
const TITLE_LITERAL: RegExp = /title: "([^"]+)"/g;

// The numbers of an array literal, as "[\n  25, 50, 75, 100,\n]" writes them.
const NUMBER_LITERAL: RegExp = /\d+/g;

/*
 * A source's comments: a block comment, and a line comment at the start of a
 * line or after a space (not the "//" of "https://").
 */
const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|\s)\/\/.*$/gm;

function readSource(key: string): string {
  const relativePath: string | undefined = SOURCES[key];

  expect({ key, known: Boolean(relativePath) }).toEqual({ key, known: true });

  return fs.readFileSync(path.join(REPO_DIR, relativePath as string), "utf8");
}

function english(page: string): string {
  return readPage("en", page);
}

function inlineCodes(text: string): Array<string> {
  return [...text.matchAll(INLINE_CODE)].map(
    (match: RegExpExecArray): string => {
      return match[1] as string;
    },
  );
}

// A page without its fenced code blocks, whose backticks pair up otherwise.
function withoutFences(markdown: string): string {
  return markdown.replace(FENCED_BLOCK, "");
}

/*
 * The paths of the https URLs a text writes as code, parsed rather than
 * matched as text.
 */
function httpsPathsIn(text: string): Array<string> {
  return inlineCodes(text).flatMap((code: string): Array<string> => {
    try {
      const url: URL = new URL(code);

      return url.protocol === "https:" ? [url.pathname] : [];
    } catch {
      return [];
    }
  });
}

// A cell's text without the backticks around it.
function unwrapCode(cell: string): string {
  return cell.startsWith("`") && cell.endsWith("`") ? cell.slice(1, -1) : cell;
}

// What a text says between two pieces of it, each of which it must have.
function textBetween(text: string, start: string, end: string): string {
  const from: number = text.indexOf(start);

  expect({ start, found: from > -1 }).toEqual({ start, found: true });

  const to: number = text.indexOf(end, from + start.length);

  expect({ end, found: to > -1 }).toEqual({ end, found: true });

  return text.slice(from + start.length, to);
}

// The items of a list a sentence writes, in order: "A, B and C".
function listItems(text: string): Array<string> {
  return text.split(LIST_SEPARATOR).map((item: string): string => {
    return item.trim();
  });
}

/*
 * A source without its comments, so a fact holds what the code does - a
 * comment that names a constant is not the code using it.
 */
function codeOf(source: string): string {
  return source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "$1");
}

// The numbers of the array literal a source assigns to a constant.
function arrayLiteralNumbers(
  source: string,
  declaration: string,
): Array<number> {
  const start: number = source.indexOf(declaration);

  expect({ declaration, found: start > -1 }).toEqual({
    declaration,
    found: true,
  });

  return [
    ...source
      .slice(start + declaration.length, source.indexOf("];", start))
      .matchAll(NUMBER_LITERAL),
  ].map((match: RegExpExecArray): number => {
    return Number(match[0]);
  });
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
  const direct: string = `\\$\\.Values\\.${escapeRegExp(dottedPath)}\\b`;
  const guarded: string = `\\(\\$\\.Values\\.${escapeRegExp(
    parts[0] as string,
  )}\\)\\.${escapeRegExp(parts.slice(1).join("."))}\\b`;

  return new RegExp(
    `- name: ${escapeRegExp(variable)}\\n\\s*value: [^\\n]*(?:${direct}|${guarded})`,
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

  it("says the device list shows each device's critical alerts, and how to turn them on, as the Push card draws them", () => {
    const card: string = readSource("pushCard");

    // A column of each device's state, drawn as a status...
    expect(card).toContain('title: "Critical Alerts"');
    expect(card).toContain("<PushDeviceCriticalAlertStatus");

    // ...which, for a phone with it off, offers the steps that turn it on.
    const status: string = readSource("pushCriticalAlertStatus");

    expect(status).toContain('translator.translateText("How to turn on")');
    expect(readSource("pushCriticalAlerts")).toContain(
      'criticalAlertsSwitch: "Critical On-Call Alerts",',
    );

    expect(page).toContain(
      "The same list shows whether each device has critical alerts on and, for a phone that does not, how to turn them on.",
    );
  });

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

  it("marks the page critical as the page says: for iOS, and on Android a critical channel - the original one unless the device chose an alarm", () => {
    const service: string = codeOf(readSource("pushService"));
    const start: number = service.indexOf(
      "public static getExpoDeliveryOptions(",
    );

    expect(start).toBeGreaterThan(-1);

    // The method, up to the brace that closes it.
    const options: string = service.slice(
      start,
      service.indexOf("\n  }\n", start),
    );

    expect(options).toContain('interruptionLevel: "critical",');

    // A critical page's Android channel is the channel of the device's sound.
    const sound: number = options.indexOf("getCriticalAlertSoundDefinition(");

    expect(sound).toBeGreaterThan(-1);
    expect(options.indexOf(".androidChannelId", sound)).toBeGreaterThan(sound);

    // The original critical channel for the phone's own sound, the default...
    expect(AndroidNotificationChannel.Critical).toBe("oncall_critical");
    expect(getCriticalAlertSoundDefinition(undefined).androidChannelId).toBe(
      AndroidNotificationChannel.Critical,
    );
    expect(
      CRITICAL_ALERT_SOUNDS.find(
        (definition: CriticalAlertSoundDefinition): boolean => {
          return definition.sound === CriticalAlertSound.Default;
        },
      )?.androidChannelId,
    ).toBe(AndroidNotificationChannel.Critical);

    // ...and a critical channel whichever sound it is.
    for (const definition of CRITICAL_ALERT_SOUNDS) {
      expect({
        sound: definition.sound,
        critical: definition.androidChannelId.startsWith(
          AndroidNotificationChannel.Critical,
        ),
      }).toEqual({ sound: definition.sound, critical: true });
    }

    expect(page).toContain(
      "plus `interruptionLevel: critical` for iOS, and targets a critical notification channel for Android: `oncall_critical`, or the chosen alarm's own channel (see [Choosing the alarm sound](#choosing-the-alarm-sound)).",
    );
  });

  it("leaves the level to each on-call rule, Critical unless the rule is set to Standard", () => {
    const model: string = readSource("userNotificationRule");
    const column: number = model.indexOf(
      "public pushNotificationLevel?: PushNotificationLevel",
    );

    expect(column).toBeGreaterThan(-1);
    expect(model.slice(column - 400, column)).toContain(
      "default: PushNotificationLevel.Critical,",
    );
    expect(DEFAULT_PUSH_NOTIFICATION_LEVEL).toBe(
      PushNotificationLevel.Critical,
    );

    // The page's fourth condition is the rule's half of the server's decision.
    const service: string = readSource("notificationRuleService");

    expect(service).toContain("isCriticalPushNotification({");
    expect(service).toContain(
      "pushNotificationLevel: notificationRuleItem.pushNotificationLevel,",
    );

    expect(page).toContain(
      "Four things must all be true for a page to override silent mode.",
    );
    expect(page).toContain(
      "Stored per rule in `UserNotificationRule.pushNotificationLevel`.",
    );
    expect(page).toContain(
      'Rule{"Its on-call rule set<br/>to Critical alert?"}',
    );
  });

  it("names the On-Call Rules page where the user settings menu shows it, and the levels as a rule's row draws them", () => {
    expect(
      objectMenu(readSource("userSettingsSideMenu")).get(
        "Alerts & Notifications",
      ),
    ).toContain("On-Call Rules");

    const control: string = readSource("pushLevelControl");

    expect(control).toContain('title: translationKey("Critical alert"),');
    expect(control).toContain('title: translationKey("Standard"),');

    // The device list's own word on the switch says the same as the page.
    expect(readSource("pushCard")).toContain(
      "override silent mode and Do Not Disturb, except from on-call rules set to Standard.",
    );

    expect(page).toContain(
      "Under **User Settings > On-Call Rules**, every rule that notifies a phone is set to Critical alert, the default, or Standard, which follows the phone's sound settings",
    );
    expect(page).toContain(
      "- Check the on-call rule for that severity under **User Settings > On-Call Rules**: a push rule set to Standard follows the phone's sound settings",
    );
  });

  it("creates every critical channel in the app with Do Not Disturb bypass and the alarm stream, the alarm sounds' channels included", () => {
    const channels: string = codeOf(readSource("mobileChannels"));

    expect(channels).toContain('CRITICAL: "oncall_critical",');

    const critical: string = channels.slice(
      channels.indexOf("export const CRITICAL_CHANNEL"),
    );

    expect(critical).toContain("bypassDnd: true,");
    expect(critical).toContain("usage: Notifications.AndroidAudioUsage.ALARM,");

    // Each alarm's channel is the critical channel in all but its sound.
    expect(
      channels.slice(channels.indexOf("function criticalSoundChannel(")),
    ).toContain("...CRITICAL_CHANNEL,");

    for (const definition of CRITICAL_ALERT_SOUNDS) {
      expect({
        channel: definition.androidChannelId,
        created: channels.includes(`"${definition.androidChannelId}"`),
      }).toEqual({ channel: definition.androidChannelId, created: true });
    }

    expect(page).toContain(
      "- Every critical notification channel - `oncall_critical`, and one for each alarm sound - requests `bypassDnd`, which covers Do Not Disturb",
    );
    expect(page).toContain(
      "- The same channels use the **alarm** audio stream",
    );
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

describe("Push Notifications: the alarm sound and repeating a page, against the server, the Dashboard and the mobile app", () => {
  const page: string = english(PUSH);

  // The alarms a responder can pick: every sound but the phone's own.
  const alarms: Array<CriticalAlertSoundDefinition> =
    CRITICAL_ALERT_SOUNDS.filter(
      (definition: CriticalAlertSoundDefinition): boolean => {
        return definition.sound !== DEFAULT_CRITICAL_ALERT_SOUND;
      },
    );

  const titleOf: (definition: CriticalAlertSoundDefinition) => string = (
    definition: CriticalAlertSoundDefinition,
  ): string => {
    return definition.title;
  };

  it("plays the phone's own critical sound on the original channel until the device chooses another, and the choice on the test notification too", () => {
    const fallback: CriticalAlertSoundDefinition =
      getCriticalAlertSoundDefinition(undefined);

    expect(fallback.sound).toBe(DEFAULT_CRITICAL_ALERT_SOUND);
    expect(fallback.iosSoundName).toBe("default");
    expect(fallback.androidChannelId).toBe(AndroidNotificationChannel.Critical);

    // Stored per device, the phone's own sound until the app writes a choice.
    const model: string = codeOf(readSource("userPush"));
    const column: number = model.indexOf(
      "public criticalAlertSound?: CriticalAlertSound",
    );

    expect(column).toBeGreaterThan(-1);
    expect(model.slice(column - 400, column)).toContain(
      "default: CriticalAlertSound.Default,",
    );

    // The test notification carries the device's alarm, as a page does.
    expect(codeOf(readSource("userPushApi"))).toContain(
      "testMessage.criticalAlertSound = device.criticalAlertSound;",
    );

    expect(page).toContain(
      "A critical page plays the phone's own critical alert sound unless the responder picks another.",
    );
    expect(page).toContain(
      "The choice belongs to the device and is stored in `UserPush.criticalAlertSound`, and the test notification plays it too.",
    );
    expect(page).toContain(
      "A device keeps the system sound until it runs a version of the app that offers the choice",
    );
  });

  it("names the five alarms the server and the app both offer, as both title them", () => {
    expect(alarms.length).toBe(5);
    expect(page).toContain("offers five louder alarms made to wake people: ");
    expect(
      listItems(
        textBetween(
          page,
          "made to wake people: ",
          ", which starts soft and keeps getting louder.",
        ),
      ),
    ).toEqual(alarms.map(titleOf));

    // The last one named is the one that starts soft.
    expect(alarms[alarms.length - 1]?.sound).toBe(CriticalAlertSound.Rising);

    // The app's own list of sounds, the phone's own first, titled the same.
    const appSounds: string = codeOf(readSource("mobileAlarmSounds"));

    expect(
      [...appSounds.matchAll(TITLE_LITERAL)].map(
        (match: RegExpExecArray): string => {
          return match[1] as string;
        },
      ),
    ).toEqual(CRITICAL_ALERT_SOUNDS.map(titleOf));
    expect(appSounds).toContain(
      'description: "Starts soft, then keeps getting louder',
    );
  });

  it("names the app's Alarm sound row where its Settings screen shows it, once Critical On-Call Alerts is on, and the screen that plays each sound", () => {
    const screen: string = codeOf(readSource("mobileSettingsScreen"));
    const start: number = screen.indexOf('<ListGroup title="Notifications">');

    expect(start).toBeGreaterThan(-1);

    const group: string = screen.slice(
      start,
      screen.indexOf("</ListGroup>", start),
    );
    const toggle: number = group.indexOf('title="Critical On-Call Alerts"');
    const row: number = group.indexOf('title="Alarm sound"');

    expect(toggle).toBeGreaterThan(-1);
    expect(row).toBeGreaterThan(toggle);

    // The row is drawn only while the switch above it is on.
    expect(group.slice(toggle, row)).toContain("{criticalAlerts.isEnabled ? (");

    const soundScreen: string = codeOf(readSource("mobileAlarmSoundScreen"));

    expect(soundScreen).toContain('title="Alarm sound"');
    // Every sound has a button beside it that plays it.
    expect(soundScreen).toContain("void alarm.preview(option.id);");
    // And the screen says when a sound's channel cannot ring through Do Not Disturb.
    expect(soundScreen).toContain(
      'title="This sound cannot ring through Do Not Disturb"',
    );

    expect(page).toContain(
      "In the app, **Settings > Notifications > Alarm sound**, shown once Critical On-Call Alerts is on, offers",
    );
    expect(page).toContain("Each one can be played before it is chosen.");
    expect(page).toContain(
      "- **Android**: if you chose an alarm sound, its own notification channel must be allowed to override Do Not Disturb too; the app's Alarm sound screen says when it is not",
    );
  });

  it("names the sound and its volume in an iPhone's page, from the steps the app offers, full by default", () => {
    const service: string = codeOf(readSource("pushService"));

    expect(service).toContain("name: sound.iosSoundName,");
    expect(service).toContain(
      "volume: toCriticalAlertSoundVolume(message.criticalAlertVolume),",
    );

    const steps: Array<string> = listItems(
      textBetween(
        page,
        "at the volume chosen on the same screen: ",
        ", the default.",
      ),
    );

    expect(steps).toEqual(
      CRITICAL_ALERT_VOLUME_OPTIONS.map((percent: number): string => {
        return `${percent}%`;
      }),
    );
    // "100%, the default": the step the page names last is the default.
    expect(steps[steps.length - 1]).toBe(
      `${DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT}%`,
    );

    // The app offers the same steps, on the screen that offers the sounds.
    const appSounds: string = codeOf(readSource("mobileAlarmSounds"));

    expect(
      arrayLiteralNumbers(
        appSounds,
        "export const CRITICAL_ALERT_VOLUME_OPTIONS: ReadonlyArray<number> = [",
      ),
    ).toEqual([...CRITICAL_ALERT_VOLUME_OPTIONS]);
    expect(appSounds).toContain(
      `export const DEFAULT_CRITICAL_ALERT_VOLUME: number = ${DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT};`,
    );
    expect(codeOf(readSource("mobileAlarmSoundScreen"))).toContain(
      "CRITICAL_ALERT_VOLUME_OPTIONS.map(",
    );

    const model: string = codeOf(readSource("userPush"));
    const column: number = model.indexOf("public criticalAlertVolume?: number");

    expect(column).toBeGreaterThan(-1);
    expect(model.slice(column - 400, column)).toContain(
      "default: DEFAULT_CRITICAL_ALERT_VOLUME_PERCENT,",
    );
    expect(page).toContain(
      "The volume is stored in `UserPush.criticalAlertVolume`.",
    );
  });

  it("gives each alarm a critical channel of its own on Android, and sends the page on the chosen one", () => {
    const channelOf: (sound: CriticalAlertSound) => string | undefined = (
      sound: CriticalAlertSound,
    ): string | undefined => {
      return alarms.find(
        (definition: CriticalAlertSoundDefinition): boolean => {
          return definition.sound === sound;
        },
      )?.androidChannelId;
    };

    expect(channelOf(CriticalAlertSound.Klaxon)).toBe(
      AndroidNotificationChannel.CriticalKlaxon,
    );
    expect(channelOf(CriticalAlertSound.Siren)).toBe(
      AndroidNotificationChannel.CriticalSiren,
    );

    // One channel per alarm, none of them the original critical channel.
    expect(
      new Set([
        AndroidNotificationChannel.Critical,
        ...alarms.map((definition: CriticalAlertSoundDefinition): string => {
          return definition.androidChannelId;
        }),
      ]).size,
    ).toBe(alarms.length + 1);

    const line: string =
      page.split("\n").find((pageLine: string): boolean => {
        return pageLine.startsWith(
          "- **Android**: each alarm has a notification channel of its own",
        );
      }) || "";

    expect(inlineCodes(line)).toEqual([
      AndroidNotificationChannel.CriticalKlaxon,
      AndroidNotificationChannel.CriticalSiren,
    ]);
    expect(line).toContain(
      "and so on), because Android fixes a channel's sound when the channel is created.",
    );

    // The server names the chosen sound's channel.
    expect(codeOf(readSource("pushService"))).toContain(
      "? sound.androidChannelId",
    );

    // The app creates those channels.
    const channels: string = codeOf(readSource("mobileChannels"));

    expect(channels).toContain(
      `CRITICAL_KLAXON: "${AndroidNotificationChannel.CriticalKlaxon}",`,
    );
    expect(channels).toContain(
      `CRITICAL_SIREN: "${AndroidNotificationChannel.CriticalSiren}",`,
    );
    expect(page).toContain(
      "The server sends the page on the chosen alarm's channel, and it plays at the phone's alarm volume.",
    );
  });

  it("repeats a push rule's page at the intervals the server accepts, at most 10 more times, and sends it once by default", () => {
    expect(REPEAT_EVERY_MINUTES_OPTIONS[0]).toBe(1);
    expect(
      listItems(
        textBetween(
          page,
          "on the rule's row: every minute, or every ",
          " minutes. ",
        ),
      ).map((minutes: string): number => {
        return Number(minutes);
      }),
    ).toEqual(REPEAT_EVERY_MINUTES_OPTIONS.slice(1));

    // Sent again each interval, and never more than the most repeats.
    expect(
      getDueRepeatNumber({
        minutesSinceStart: 10,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 5,
      }),
    ).toBe(2);
    expect(
      getDueRepeatNumber({
        minutesSinceStart: 24 * 60,
        notifyAfterMinutes: 0,
        repeatEveryMinutes: 1,
      }),
    ).toBe(MAX_NOTIFICATION_REPEATS);
    expect(page).toContain(
      `The page is sent again at that interval, up to ${MAX_NOTIFICATION_REPEATS} more times, and stops as soon as the incident, alert or episode is acknowledged.`,
    );

    // A rule that never chose sends once.
    expect(getRepeatEveryMinutes(undefined)).toBe(NO_NOTIFICATION_REPEAT);

    const model: string = codeOf(readSource("userNotificationRule"));
    const column: number = model.indexOf("public repeatEveryMinutes?: number");

    expect(column).toBeGreaterThan(-1);
    expect(model.slice(column - 400, column)).toContain(
      "default: NO_NOTIFICATION_REPEAT,",
    );
    expect(page).toContain(
      `It is stored per rule in \`UserNotificationRule.repeatEveryMinutes\`, where ${NO_NOTIFICATION_REPEAT}, the default, sends the page once.`,
    );
  });

  it("names the field as the On-Call Rules form titles it on a new push rule, changed later from the rule's row", () => {
    const table: string = codeOf(readSource("onCallRulesTable"));
    const title: number = table.indexOf('title: "Repeat until acknowledged",');

    expect(title).toBeGreaterThan(-1);

    const field: string = table.slice(
      title,
      table.indexOf("dataTestId:", title),
    );

    expect(field).toContain("dropdownOptions: PUSH_REPEAT_DROPDOWN_OPTIONS,");
    // Asked when a rule is added; the form that edits a rule leaves it out.
    expect(field).toContain("doNotShowWhenEditing: true,");
    // The field's own help gives the page's limit.
    expect(field).toContain(`up to ${MAX_NOTIFICATION_REPEATS} more times.`);
    // A push rule's row changes it later.
    expect(table).toContain("<PushRepeatControl");
    expect(dashboardLabel("Repeat until acknowledged")).toBe(
      "Repeat until acknowledged",
    );

    expect(page).toContain(
      "Under **User Settings > On-Call Rules**, set **Repeat until acknowledged** when adding a push rule, or change it later on the rule's row",
    );
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
    // The webhook URLs the page gives, by their paths: the route, with its secret.
    expect(httpsPathsIn(withoutFences(page))).toContain(
      "/incoming-email/sendgrid/YOUR_SECRET",
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

    expect(location).toMatch(INGRESS_TO_APP);
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
    // The addresses the page shows, by their local part.
    const localParts: Array<string> = inlineCodes(withoutFences(page))
      .filter((code: string): boolean => {
        return code.split("@").length === 2;
      })
      .map((code: string): string => {
        return code.split("@")[0] as string;
      });

    expect(localParts).toContain("monitor-abc123");
    expect(localParts).toContain("workflow-…");
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
