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

// A node of the chart's values.schema.json.
interface ChartSchemaNode {
  properties?: Record<string, ChartSchemaNode>;
  additionalProperties?: boolean;
}

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
  chartSchema: `${CHART}/values.schema.json`,
  chartHelpers: `${CHART}/templates/_helpers.tpl`,
  chartProbe: `${CHART}/templates/probe.yaml`,
  ingressConfig: "packages/Nginx/default.conf.template",
  environmentConfig: `${COMMON_SERVER}/EnvironmentConfig.ts`,
  projectService: `${COMMON_SERVER}/Services/ProjectService.ts`,
  pushService: `${COMMON_SERVER}/Services/PushNotificationService.ts`,
  pushRelay: "packages/App/FeatureSet/Notification/API/PushRelay.ts",
  receiptQueue: `${COMMON_SERVER}/Infrastructure/ExpoPushReceiptQueue.ts`,
  inboundFactory: `${COMMON_SERVER}/Services/InboundEmail/InboundEmailProviderFactory.ts`,
  sendGridProvider: `${COMMON_SERVER}/Services/InboundEmail/Providers/SendGridInboundProvider.ts`,
  inboundProvider: `${COMMON_SERVER}/Services/InboundEmail/InboundEmailProvider.ts`,
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
  permissionScopeChoice: `${DASHBOARD}/Components/Permission/PermissionScopeChoice.ts`,
  roleCatalog: `${DASHBOARD}/Components/Permission/RoleCatalog.ts`,
  rolePickerOptions: `${DASHBOARD}/Components/Permission/RolePickerOptions.ts`,
  pushCard: `${DASHBOARD}/Components/NotificationMethods/Push.tsx`,
  pushCriticalAlertStatus: `${DASHBOARD}/Components/NotificationMethods/PushDeviceCriticalAlertStatus.tsx`,
  pushCriticalAlerts: `${DASHBOARD}/Components/NotificationMethods/PushDeviceCriticalAlerts.ts`,
  userSettingsSideMenu: `${DASHBOARD}/Pages/UserSettings/SideMenu.tsx`,
  mobileAppJson: `${MOBILE_APP}/app.json`,
  mobileAppConfig: `${MOBILE_APP}/app.config.js`,
  mobileEas: `${MOBILE_APP}/eas.json`,
  mobileChannels: `${MOBILE_APP}/src/notifications/channels.ts`,
  mobileCriticalAlerts: `${MOBILE_APP}/src/notifications/criticalAlerts.ts`,
  mobileCriticalAlertsReport: `${MOBILE_APP}/src/notifications/criticalAlertsReport.ts`,
  mobilePushNotifications: `${MOBILE_APP}/src/hooks/usePushNotifications.ts`,
  mobileUseCriticalAlerts: `${MOBILE_APP}/src/hooks/useCriticalAlerts.ts`,
  mobileSettingsScreen: `${MOBILE_APP}/src/screens/SettingsScreen.tsx`,
  mobileAlarmSounds: `${MOBILE_APP}/src/notifications/criticalAlertSounds.ts`,
  mobileAlarmSoundScreen: `${MOBILE_APP}/src/screens/settings/CriticalAlertSoundScreen.tsx`,
  emailLogoPartial:
    "packages/App/FeatureSet/Notification/Templates/Partials/Logo.hbs",
  emailLogo: `${COMMON_SERVER}/Utils/Mail/EmailLogo.ts`,
  emailBranding: "packages/App/FeatureSet/Notification/Utils/EmailBranding.ts",
  statusPageEmailLogo: `${COMMON_SERVER}/Utils/StatusPage/StatusPageEmailLogo.ts`,
  composeBase: "docker-compose.base.yml",
  updateCheckJob:
    "packages/App/FeatureSet/Workers/Jobs/InstanceUpdate/CheckForNewVersion.ts",
  checkInJob: "packages/App/FeatureSet/Workers/Jobs/InstanceCheckIn/CheckIn.ts",
  signUpApi: "packages/App/FeatureSet/Identity/API/Authentication.ts",
  registerPage: "packages/App/FeatureSet/Accounts/src/Pages/Register.tsx",
  accountsLocale: "packages/App/FeatureSet/Accounts/src/Locales/en.json",
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

// Taken out of code a fact reads, so it does not depend on prettier's wrapping.
const WHITESPACE: RegExp = /\s+/;

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

/*
 * The chart's lines for VAPID_PRIVATE_KEY: the Secret the helper names, under
 * the key it names, or else vapid.privateKey as it always was.
 */
const VAPID_PRIVATE_KEY_FROM_SECRET_OR_VALUE: RegExp =
  /^ *\{\{- if \$vapidPrivateKeySecret \}\}\n *valueFrom:\n *secretKeyRef:\n *name: \{\{ \$vapidPrivateKeySecret \| quote \}\}\n *key: \{\{ include "oneuptime\.vapid\.privateKeyKey" \$ \| quote \}\}\n *\{\{- else \}\}\n *value: \{\{ \$\.Values\.vapid\.privateKey \}\}\n *\{\{- end \}\}\n*$/;

// "  services:" and each "  name:" under it, in a compose file.
const COMPOSE_SERVICE: RegExp = /^ {2}([a-z0-9-]+):$/;

// An array of string literals, as `[ "a", "b" ]` spells it.
const STRING_LITERAL: RegExp = /"([^"]+)"/g;

// "1.5.0": a release of the mobile app.
const SEMVER: RegExp = /^(\d+)\.(\d+)\.(\d+)$/;

/*
 * '[PermissionScope.Owned]: translationKey("Only resources they own"),' -
 * an answer of the Scope choice, possibly wrapped over lines.
 */
const SCOPE_ANSWER_TITLE: RegExp =
  /\[PermissionScope\.\w+\]: translationKey\(\s*"([^"]+)",?\s*\)/g;

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
 * The lines a chart template gives an environment variable, once for each
 * place it is named: from its "- name:" line to the next variable, or to the
 * template action at the start of a line that ends its helper. A variable that
 * can also be read from a Secret keeps both of its branches in its lines.
 */
function chartEnvBlocks(
  template: string,
  variable: string,
): Array<Array<string>> {
  const lines: Array<string> = template.split("\n");
  const blocks: Array<Array<string>> = [];

  lines.forEach((line: string, index: number): void => {
    if (line !== `- name: ${variable}`) {
      return;
    }

    const rest: Array<string> = lines.slice(index + 1);
    const end: number = rest.findIndex((next: string): boolean => {
      return next.startsWith("- name: ") || next.startsWith("{{");
    });

    blocks.push(end === -1 ? rest : rest.slice(0, end));
  });

  return blocks;
}

/*
 * Whether a chart template renders an environment variable from a value:
 * "$.Values.vapid.subject", or "($.Values.webhooks).allowPrivateNetwork",
 * which reads a value whose parent may be missing - on the value: line under
 * its name, or on the value: line of the branch that does not read a Secret.
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
  const valueLine: RegExp = new RegExp(
    `^\\s*value: .*(?:${direct}|${guarded})`,
  );

  return chartEnvBlocks(template, variable).some(
    (block: Array<string>): boolean => {
      return block.some((line: string): boolean => {
        return valueLine.test(line);
      });
    },
  );
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

  /*
   * The Scope field is three plain answers, All first, the same for a
   * team's permission and a custom role's (Components/Permission/
   * PermissionScopeChoice, which both tables build their Scope field from).
   */
  it("names the scopes as a team permission's Scope field offers them, All first", () => {
    const choice: string = readSource("permissionScopeChoice");
    const form: string = readSource("teamPermissionTable");
    const options: Array<string> = [
      "All resources in the project",
      "Only resources they own",
      "Only resources with certain labels",
    ];

    const titles: string = choice.slice(
      choice.indexOf("export const PERMISSION_SCOPE_TITLES"),
      choice.indexOf("export const PERMISSION_SCOPE_DESCRIPTIONS"),
    );

    expect(
      [...titles.matchAll(SCOPE_ANSWER_TITLE)].map(
        (match: RegExpExecArray): string => {
          return match[1] as string;
        },
      ),
    ).toEqual(options);
    // In the order the form offers them, and starting on All.
    expect(choice).toMatch(
      /PERMISSION_SCOPE_ANSWERS: ReadonlyArray<PermissionScope> = \[\s*PermissionScope\.All,\s*PermissionScope\.Owned,\s*PermissionScope\.Labels,\s*\];/,
    );
    expect(choice).toContain("defaultValue: PermissionScope.All,");
    expect(choice).toContain("fieldType: FormFieldSchemaType.RadioButton,");
    expect(form).toContain("...getPermissionScopeFields<TeamPermission>({");

    expect(
      tableHeaded(page, ["Scope", "Meaning"]).map(
        (row: Array<string>): string => {
          return row[0] as string;
        },
      ),
    ).toEqual(options);
    /*
     * The Scope waits folded under the dialog's More fields line, on All:
     * both its fields are built into the More fields section.
     */
    expect(choice).toContain(
      "const moreFields: FormFieldCollapsibleSection<TEntity> =\n    getAdvancedFormSection<TEntity>();",
    );
    expect(choice.split("collapsibleSection: moreFields,").length - 1).toBe(2);
    expect(page).toContain(
      "Every allow permission is granted with a scope: when you add it, **Scope** is under **More fields**, and starts on the first of these:",
    );
  });

  /*
   * Add Role asks how far a role reaches (Components/Permission/RoleCatalog
   * and RolePicker): Whole project, with the four roles that reach all of
   * it, or One area - an area, then its level - and a search box.
   */
  it("says how Add Role asks for a role, in the picker's own words", () => {
    const catalog: string = readSource("roleCatalog");
    const options: string = readSource("rolePickerOptions");
    const paragraph: string | undefined = page
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith(
          "**Add Role** asks first how far the role reaches.",
        );
      });

    expect(paragraph).toBeDefined();

    // The two answers and the search box, as the picker names them.
    expect(catalog).toContain(
      '[RoleReach.WholeProject]: translationKey("Whole project"),',
    );
    expect(catalog).toContain(
      '[RoleReach.OneArea]: translationKey("One area"),',
    );
    expect(options).toContain('translationKey("Search roles")');
    expect(paragraph).toContain("**Whole project**");
    expect(paragraph).toContain("**One area**");
    expect(paragraph).toContain("**Search roles**");

    // The four whole-project roles, in the picker's order.
    const wholeProject: number = catalog.indexOf("WHOLE_PROJECT_ROLES");
    const order: Array<number> = [
      "Permission.ProjectOwner",
      "Permission.ProjectAdmin",
      "Permission.ProjectMember",
      "Permission.Viewer,",
    ].map((role: string): number => {
      return catalog.indexOf(role, wholeProject);
    });

    expect(
      order.every((index: number): boolean => {
        return index > wholeProject;
      }),
    ).toBe(true);
    expect(
      [...order].sort((a: number, b: number): number => {
        return a - b;
      }),
    ).toEqual(order);
    expect(paragraph).toContain(
      "the four roles that reach all of it — Project Owner, Project Admin, Project Member and Viewer —",
    );

    // An area's tile wears its product's icon; its level is picked after it.
    expect(catalog).toContain("icon: IconProp.Alert,");
    expect(paragraph).toContain(
      "**One area** lists the areas, each with its product's icon: pick one, then its level.",
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

  it("lists the six push settings, each with its Helm value, its default and its config.example.env line", () => {
    const helpers: string = readSource("chartHelpers");

    expect(
      rows.map((row: Array<string>): string => {
        return unwrapCode(row[0] as string);
      }),
    ).toEqual([
      "PUSH_NOTIFICATION_RELAY_URL",
      "EXPO_ACCESS_TOKEN",
      "PUSH_NOTIFICATION_RELAY_SERVER_ENABLED",
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

  it("keeps the private key in a Secret of the operator's on Kubernetes, as the Kubernetes tab says", () => {
    const helpers: string = readSource("chartHelpers");
    const schema: {
      properties: Record<
        string,
        { properties: Record<string, ChartSchemaNode> }
      >;
    } = JSON.parse(readSource("chartSchema"));

    expect(page).toContain(
      ":::details Keep the private key in a Secret\n`vapid.privateKey` keeps the private key in the release's values, which Helm stores with every revision. To keep it out of them, put it in a Kubernetes Secret in OneUptime's namespace, under `privateKey`, and name that Secret instead:",
    );
    expect(page).toContain(
      "Set `vapid.privateKey` or `vapid.existingSecret.name`, not both: the chart refuses the two together. If your Secret holds the private key under another key, name that key in `vapid.existingSecret.privateKeyKey`. The public key stays in `vapid.publicKey`: every browser is given it.\n:::\n:::\n",
    );

    /*
     * Most installs set the key as a value, so the Kubernetes tab shows that
     * first, and the Secret is folded away under it: the fold opens after
     * the plain example and closes, with the tab set, after its last line.
     */
    const kubernetesTab: string = textBetween(
      page,
      "@tab Kubernetes\n",
      "\n## Network Access",
    );
    const plainExample: number = kubernetesTab.indexOf(
      "  privateKey: your-private-key\n",
    );
    const fold: number = kubernetesTab.indexOf(
      ":::details Keep the private key in a Secret\n",
    );

    expect(plainExample).toBeGreaterThan(-1);
    expect(fold).toBeGreaterThan(plainExample);
    expect(kubernetesTab.indexOf("existingSecret:")).toBeGreaterThan(fold);
    expect(
      kubernetesTab.endsWith("every browser is given it.\n:::\n:::\n"),
    ).toBe(true);

    // Off until a Secret is named; read under privateKey unless another key is named.
    expect(chartHasValue("vapid.existingSecret.name")).toBe(true);
    expect(chartValue("vapid.existingSecret.name") ?? "").toBe("");
    expect(chartValue("vapid.existingSecret.privateKeyKey")).toBe("privateKey");

    // The schema takes those two, and refuses any other key in the block.
    const existingSecret: ChartSchemaNode = schema.properties["vapid"]!
      .properties["existingSecret"] as ChartSchemaNode;

    expect(Object.keys(existingSecret.properties || {}).sort()).toEqual([
      "name",
      "privateKeyKey",
    ]);
    expect(existingSecret.additionalProperties).toBe(false);

    /*
     * VAPID_PRIVATE_KEY is named once, and comes from the Secret the helper
     * names - under the key it names, privateKey when none is - or else from
     * vapid.privateKey, never from both.
     */
    const blocks: Array<Array<string>> = chartEnvBlocks(
      helpers,
      "VAPID_PRIVATE_KEY",
    );

    expect(blocks).toHaveLength(1);

    const block: string = (blocks[0] as Array<string>).join("\n");

    expect(helpers).toContain(
      '{{- $vapidPrivateKeySecret := include "oneuptime.vapid.existingSecretName" $ }}\n\n- name: VAPID_PRIVATE_KEY\n',
    );
    expect(block).toMatch(VAPID_PRIVATE_KEY_FROM_SECRET_OR_VALUE);

    const secretName: string = textBetween(
      helpers,
      '{{- define "oneuptime.vapid.existingSecretName" -}}',
      "{{- end }}",
    );
    const keyName: string = textBetween(
      helpers,
      '{{- define "oneuptime.vapid.privateKeyKey" -}}',
      "{{- end }}",
    );

    expect(secretName).toContain("($vapid.existingSecret).name");
    // The two together are refused, as the page says.
    expect(secretName).toContain(
      '{{- if and $existing (trim (toString (default "" $vapid.privateKey))) -}}\n{{- fail (printf "vapid.privateKey and vapid.existingSecret.name are both set.',
    );
    expect(keyName).toContain("($vapid.existingSecret).privateKeyKey");
    expect(keyName).toContain('| default "privateKey" -}}');

    // The public key is never read from the Secret.
    for (const publicKey of chartEnvBlocks(helpers, "VAPID_PUBLIC_KEY")) {
      expect(publicKey.join("\n")).not.toContain("secretKeyRef");
    }

    // The example creates the Secret the values example names, under the key the chart reads by default.
    const example: string | undefined = [...page.matchAll(FENCED_BLOCK)]
      .map((match: RegExpExecArray): string => {
        return match[0];
      })
      .find((fence: string): boolean => {
        return fence.includes("existingSecret:");
      });

    expect(example).toBeDefined();

    const exampleValues: unknown = jsYaml.load(
      (example as string).split("\n").slice(1, -1).join("\n"),
    );

    expect(exampleValues).toEqual({
      vapid: {
        publicKey: "your-public-key",
        existingSecret: { name: "oneuptime-vapid" },
        subject: "mailto:oncall@example.com",
      },
    });
    for (const setting of [
      "vapid.publicKey",
      "vapid.existingSecret.name",
      "vapid.subject",
    ]) {
      expect({ setting, inChart: chartHasValue(setting) }).toEqual({
        setting,
        inChart: true,
      });
    }
    /*
     * In the namespace the docs install OneUptime in, a flag a line, so the
     * command fits the article column without scrolling sideways.
     */
    expect(page).toContain(
      `\`\`\`bash\nkubectl create secret generic oneuptime-vapid \\\n  --namespace oneuptime \\\n  --from-literal=${String(
        chartValue("vapid.existingSecret.privateKeyKey"),
      )}=your-private-key\n\`\`\`\n`,
    );
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

  it("relays for other servers only where the page says: empty is off unless billing is on, and only true turns it on", () => {
    const environment: string = readSource("environmentConfig");

    expect(environment).toContain(
      'value: process.env["PUSH_NOTIFICATION_RELAY_SERVER_ENABLED"],\n    isBillingEnabled: IsBillingEnabled,',
    );
    expect(environment).toContain(
      '  if (!value) {\n    return data.isBillingEnabled;\n  }\n\n  return value === "true";',
    );
    expect(readSource("pushService")).toContain(
      "return PushNotificationRelayServerEnabled;",
    );
    expect(page).toContain(
      "Relays mobile pushes for other OneUptime servers, with this server's `EXPO_ACCESS_TOKEN`. Empty means off, unless `BILLING_ENABLED` is `true`.",
    );
    expect(page).toContain(
      "A self-hosted OneUptime server relays pushes for other servers only with `PUSH_NOTIFICATION_RELAY_SERVER_ENABLED=true` and its own `EXPO_ACCESS_TOKEN`; without the setting it answers 404 at that address. Turn it on only on the server your other OneUptime servers send through, and let only those servers reach that address.",
    );
  });

  it("answers 404 at the relay's address without the setting, as the page says, before anything else", () => {
    const relay: string = readSource("pushRelay");

    expect(relay).toContain(
      "  if (!PushNotificationService.isPushRelayServer()) {\n    res.status(404).json({ message: PUSH_RELAY_NOT_SERVED_MESSAGE });",
    );
    expect(relay.indexOf("router.use(")).toBeLessThan(
      relay.indexOf("router.post("),
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

  /*
   * The maintainer turned critical alerts off on a phone, and the device
   * list went on saying "On": the stored setting followed only the app's
   * switch, and only when it moved. The app now keeps it in step with the
   * phone, and the page says so.
   */
  it("says the app keeps the stored setting in step with the phone, as the app and the server do", () => {
    const report: string = readSource("mobileCriticalAlertsReport");
    const registration: string = readSource("mobilePushNotifications");
    const settingsHook: string = readSource("mobileUseCriticalAlerts");

    // What it reports: the switch AND what the phone's own settings allow.
    expect(report).toContain(
      "data.isChosen && data.availability === CriticalAlertAvailability.Granted",
    );

    // Each time the app is opened: every registration, and every return to it.
    expect(registration.split(WHITESPACE).join("")).toContain(
      "constcriticalAlerts:CriticalAlertsReading=awaitreadCriticalAlerts();",
    );
    expect(registration).toContain("void reportCriticalAlerts();");

    // The settings screen tells the server what it reads from the OS.
    expect(settingsHook).toContain("void reportCriticalAlerts();");

    // ...and the server takes it from a phone it already has.
    expect(readSource("userPushApi")).toContain(
      "this.service.restateCriticalAlertEnabled({",
    );

    // The release the page names is one the app has already shipped.
    const version: string = (
      JSON.parse(readSource("mobileAppJson")) as {
        expo: { version: string };
      }
    ).expo.version;
    const [major, minor] = version.split(".").map(Number);

    expect(major! > 1 || (major === 1 && minor! >= 6)).toBe(true);

    expect(page).toContain(
      "Versions of the app newer than 1.6.0 report it again each time they are opened, as off while the phone's own settings do not allow critical alerts, so the device list shows what the phone will really do.",
    );
    expect(page).toContain(
      "it reads the current state back from the OS rather than trusting what the app last requested, and tells the server what it finds",
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

  it("answers on the route the page gives, which needs its final segment, and takes an email only when that segment is the secret", () => {
    const api: string = readSource("incomingEmailApi");

    expect(api).toContain('"/incoming-email/sendgrid/:secret",');
    // The webhook URLs the page gives, by their paths: the route, with its secret.
    expect(httpsPathsIn(withoutFences(page))).toContain(
      "/incoming-email/sendgrid/YOUR_SECRET",
    );
    expect(page).toContain(
      "The route requires the final path segment, and OneUptime takes an email only when that segment is the secret.",
    );

    // SendGrid's delivery is the one posted to an address that ends with the secret.
    const provider: string = readSource("sendGridProvider");
    const check: string = provider.slice(
      provider.indexOf("protected async isFromProvider("),
      provider.indexOf("public extractSecretKeyFromEmail("),
    );

    expect(check).toContain(
      "return SecretKeyComparison.timingSafeEqual(\n      data.pathSecret,\n      data.webhookSecret,\n    );",
    );
  });

  it("refuses every email with 503 until the secret is set, or while it is a placeholder from the page", () => {
    // Every provider: no secret, no email, before the provider is asked.
    const base: string = readSource("inboundProvider");
    const validate: string = base.slice(
      base.indexOf("public async validateWebhook("),
      base.indexOf("protected abstract isFromProvider("),
    );

    expect(validate).toContain(
      "if (!webhookSecret) {\n      return false;\n    }",
    );

    // Said to the caller with 503, which SendGrid retries.
    const api: string = readSource("incomingEmailApi");
    const missing: string = api.slice(
      api.indexOf("if (!provider.hasWebhookSecret()) {"),
      api.indexOf("const isFromProvider: boolean"),
    );

    expect(missing).toContain("new ServiceUnavailableException(");
    expect(missing).toContain("INBOUND_EMAIL_NO_WEBHOOK_SECRET_MESSAGE");
    expect(page).toContain(
      "Until the secret is set, every email is refused with `503`, which SendGrid retries for up to three days.",
    );
    expect(page).toContain(
      "`INBOUND_EMAIL_WEBHOOK_SECRET` is required: OneUptime refuses every email while it is empty or still a placeholder from this page.",
    );

    // What counts as no secret: unset, blank, shipped, or the page's placeholders.
    const environment: string = readSource("environmentConfig");

    for (const placeholder of [
      '"your_secret",',
      '"your-secret",',
      '"replace-with-a-strong-random-secret",',
    ]) {
      expect(environment).toContain(placeholder);
    }
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

  /*
   * What reaches out of an install unless a setting stops it: the update
   * check, the release emails a sign-up asks for, and the probes' fallback
   * resolvers. The website's air-gapped page (/enterprise/air-gapped) says the
   * same three and links here; each is held to the code that makes it.
   */
  it("names the three connections made unless a setting stops them, as the code makes them", () => {
    const section: string = textBetween(
      page,
      "## Connections out of your network",
      "| Outbound connection |",
    );
    const items: Array<string> = section
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("- ");
      });

    expect(section).toContain(
      "Four connections are made unless you change a setting:",
    );
    expect(items).toHaveLength(4);
    expect(section).toContain(
      "Everything else reaches out only when you turn it on",
    );

    // 1. The update check: GitHub's API, once a day, until a setting stops it.
    const releaseCheckDefault: string = textBetween(
      textBetween(
        readSource("environmentConfig"),
        'process.env["LATEST_RELEASE_CHECK_URL"] ||',
        ")",
      ),
      '"',
      '"',
    );

    expect(new URL(releaseCheckDefault).host).toBe("api.github.com");
    expect(readSource("updateCheckJob")).toContain(
      "schedule: IsDevelopment ? EVERY_THREE_HOURS : EVERY_DAY,",
    );
    expect(readSource("updateCheckJob")).toContain("if (DisableUpdateCheck) {");
    expect(readSource("environmentConfig")).toContain(
      'process.env["DISABLE_UPDATE_CHECK"] === "true"',
    );
    expect(items[0]).toContain(
      "Once a day, the app asks GitHub's API (`api.github.com`) whether a newer release is out.",
    );

    /*
     * The same check reads OneUptime's published security advisories from
     * the same host, on a self-hosted installation, and tells master admins
     * when one affects the version it runs.
     */
    const advisoriesDefault: string = textBetween(
      textBetween(
        readSource("environmentConfig"),
        'process.env["SECURITY_ADVISORIES_CHECK_URL"] ||',
        ")",
      ),
      '"',
      '"',
    );

    expect(new URL(advisoriesDefault).host).toBe("api.github.com");
    expect(readSource("updateCheckJob")).toContain(
      "GitHubUpdateCheck.fetchPublishedSecurityAdvisories(",
    );
    expect(items[0]).toContain(
      "It also reads the security advisories OneUptime published, so your master admins are told when one affects the version you run ([Update and Security Checks](/docs/self-hosted/update-checks)).",
    );

    // The chart value and the Docker Compose variable the item names.
    expect(chartValue("updateCheck.disabled")).toBe(false);
    expect(readSource("chartHelpers")).toContain(
      "- name: DISABLE_UPDATE_CHECK\n  value: {{ default false $.Values.updateCheck.disabled | squote }}",
    );
    expect(configExampleValue("DISABLE_UPDATE_CHECK")).toBe("false");
    expect(readSource("composeBase")).toContain(
      "DISABLE_UPDATE_CHECK: ${DISABLE_UPDATE_CHECK:-false}",
    );
    expect(items[0]).toContain(
      "set `updateCheck.disabled: true` in the Helm chart, or `DISABLE_UPDATE_CHECK=true` in `config.env` on Docker Compose.",
    );

    /*
     * 2. The daily check-in: the install's URL and version to oneuptime.com,
     * once a day, until a setting stops it.
     */
    const checkInJob: string = readSource("checkInJob");

    expect(checkInJob).toContain(
      '"https://oneuptime.com/api/open-source-deployment/check-in"',
    );
    expect(checkInJob).toContain("schedule: EVERY_DAY,");
    expect(checkInJob).toContain("if (DisableInstanceCheckIn) {");
    expect(
      textBetween(checkInJob, "data: {", "},")
        .split("\n")
        .map((line: string): string => {
          return line.trim();
        })
        .filter(Boolean),
    ).toEqual(["instanceUrl: instanceUrl,", "oneuptimeVersion: AppVersion,"]);
    expect(readSource("environmentConfig")).toContain(
      'process.env["DISABLE_INSTANCE_CHECK_IN"] === "true"',
    );
    expect(items[1]).toContain(
      "Once a day, the app tells `oneuptime.com` your install's address and the version it runs",
    );
    expect(items[1]).toContain(
      "Nothing about your users, projects or monitoring data is sent.",
    );
    expect(chartValue("instanceCheckIn.disabled")).toBe(false);
    expect(readSource("chartHelpers")).toContain(
      "- name: DISABLE_INSTANCE_CHECK_IN\n  value: {{ default false (($.Values.instanceCheckIn).disabled) | squote }}",
    );
    expect(configExampleValue("DISABLE_INSTANCE_CHECK_IN")).toBe("false");
    expect(readSource("composeBase")).toContain(
      "DISABLE_INSTANCE_CHECK_IN: ${DISABLE_INSTANCE_CHECK_IN:-false}",
    );
    expect(items[1]).toContain(
      "set `instanceCheckIn.disabled: true` in the Helm chart, or `DISABLE_INSTANCE_CHECK_IN=true` in `config.env` on Docker Compose.",
    );

    /*
     * 3. The release emails: a self-hosted install's sign-up form shows the
     * box ticked, and with it ticked the server sends these to oneuptime.com.
     */
    const label: string = JSON.parse(readSource("accountsLocale")).register
      .notifySelfHosted;
    const register: string = readSource("registerPage");

    expect(
      textBetween(
        register,
        "if (!IsBillingEnabled) {",
        'overrideFieldKey: "notifySelfHosted"',
      ),
    ).toContain("notifySelfHosted: true");
    expect(
      textBetween(
        register,
        'overrideFieldKey: "notifySelfHosted"',
        'dataTestId: "notifySelfHosted"',
      ),
    ).toContain("defaultValue: true");
    expect(items[2]).toContain(`“${label}” ticked, as it is at first`);

    const call: string = textBetween(
      readSource("signUpApi"),
      'if (!IsBillingEnabled && miscDataProps["notifySelfHosted"] === true) {',
      "});",
    );

    expect(new URL(`https://${textBetween(call, '"https://', '"')}`).host).toBe(
      "oneuptime.com",
    );

    for (const field of [
      "email:",
      "name:",
      "companyName:",
      "companyPhoneNumber:",
      "oneuptimeVersion: AppVersion",
      "instanceUrl: instanceUrl",
    ]) {
      expect({ field, sent: call.includes(field) }).toEqual({
        field,
        sent: true,
      });
    }

    expect(items[2]).toContain(
      "sends the person's name and email, any company and phone number they gave, and your install's address and version to `oneuptime.com`.",
    );

    /*
     * 4. The probes' fallback resolvers: the chart-wide dnsConfig every probe
     * takes unless it sets its own, after the cluster's DNS (dnsPolicy stays
     * ClusterFirst, the Kubernetes default, when the chart sets none).
     */
    expect(chartValue("dnsConfig.nameservers")).toEqual(["8.8.8.8", "1.1.1.1"]);
    expect(chartValue("dnsPolicy")).toBeNull();
    expect(readSource("chartProbe")).toContain(
      "{{- else if $.Values.dnsConfig }}",
    );
    expect(items[3]).toContain(
      "probes fall back to the public resolvers `8.8.8.8` and `1.1.1.1` after your cluster's own DNS.",
    );
    expect(items[3]).toContain("Set `dnsConfig.nameservers` to `[]`");
  });

  /*
   * Issue #5124: every email's header loaded OneUptime's logo from
   * res.cloudinary.com. The page says what an email loads when opened; the
   * product is held to it here, and in OfflineAssetHygiene and
   * EmailsLoadNothingFromOutside.
   */
  it("says OneUptime's logo travels inside every email, as the email's header carries it", () => {
    expect(page).toContain(
      "OneUptime's logo travels inside every email it sends, so it shows even on a network without internet access, and opening an email asks no other host for it.",
    );

    // The header writes the logo the email carries: an image, not an address.
    expect(readSource("emailLogoPartial")).toContain(
      'src="{{{@root.oneUptimeLogoUrl}}}"',
    );
    expect(readSource("emailBranding")).toContain(
      'variables["oneUptimeLogoUrl"] = oneUptimeLogoUrl;',
    );
    expect(readSource("emailLogo")).toContain('"oneuptime-email-logo.png"');
    expect(
      fs.existsSync(
        path.join(
          REPO_DIR,
          COMMON_SERVER,
          "Static",
          "Brand",
          "oneuptime-email-logo.png",
        ),
      ),
    ).toBe(true);
  });

  it("says a logo you upload is shown from your OneUptime URL, as the emails build it", () => {
    expect(page).toContain(
      "Images you upload yourself, such as your own logo or a status page's, are shown from your OneUptime URL, which the people who read those emails need to be able to reach.",
    );

    // The installation's own logo, on HOST; a status page's, on the host given.
    expect(readSource("emailBranding")).toContain(
      "const logoUrl: string | null = toAbsoluteUrl(branding.logoUrl);",
    );
    expect(readSource("emailBranding")).toContain(
      "new URL(HttpProtocol, Host.trim())",
    );
    expect(readSource("statusPageEmailLogo")).toContain(
      "return new URL(data.httpProtocol, data.host)",
    );
  });
});
