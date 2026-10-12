import { readPage } from "./DocsContentSupport";
import { boldSpans, inlineCode } from "./DocsTranslationChecks";
import FormsCopy from "../../../FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import IncidentVideoCall from "Common/Models/DatabaseModels/IncidentVideoCall";
import VideoCallConnection from "Common/Models/DatabaseModels/VideoCallConnection";
import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import {
  FORM_SUBMITTER_FIELD_DEFINITIONS,
  FormSubmitterField,
} from "Common/Types/Form/FormField";
import FormTargetType, {
  FORM_TARGET_TYPE_TEXT,
} from "Common/Types/Form/FormTargetType";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import NotificationRuleEventType from "Common/Types/Workspace/NotificationRules/EventType";
import WorkspaceNoteReactionUtil, {
  WorkspaceNoteType,
} from "Common/Types/Workspace/WorkspaceNoteReaction";
import { EVERY_DAY, EVERY_MINUTE } from "Common/Utils/CronTime";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The English Slack, Microsoft Teams, Video Calls, Building a Form, What a
 * Submission Creates and Sharing & Security pages against the product they
 * describe (docs overhaul task 19).
 *
 * Markdown is not compiled, so nothing else notices when a menu loses an
 * entry, a form gains a step, a button is renamed or a refusal is reworded
 * while the pages keep the old words. Each test reads the source of truth -
 * a side menu, a form's steps, a card's buttons, the Slack app's manifest,
 * the Teams bot's help, a model's permissions, a job's schedule - and checks
 * the page still says the same. Dashboard pages are read as text: an App
 * test must not import a React page. What earlier suites hold stays with
 * them: the forms' answer types, fields, limits, refusals and private note
 * (FormsDocs, FormBrandingDocs), the video call providers' setup
 * (VideoCallsDocs), who may test-send (TestSendDocs), what the chats' forms
 * and buttons act as (PhoneNumberAndChatFormRolesDocs,
 * ChatButtonsActAsMemberDocs) and the summaries' clock
 * (WorkspaceSummaryTimezoneDocs). WorkspaceAndFormsDocsTranslations holds the
 * other sixteen languages to these pages.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const DASHBOARD: string = "App/FeatureSet/Dashboard/src";
const WORKSPACE_UTILS: string = "Common/Server/Utils/Workspace";

const SOURCES: Record<string, string> = {
  settingsSideMenu: `${DASHBOARD}/Pages/Settings/SideMenu.tsx`,
  workspaceSideMenuSection: `${DASHBOARD}/Components/Workspace/WorkspaceSideMenuSection.ts`,
  incidentsSideMenu: `${DASHBOARD}/Pages/Incidents/SideMenu.tsx`,
  alertsSideMenu: `${DASHBOARD}/Pages/Alerts/SideMenu.tsx`,
  scheduledMaintenanceSideMenu: `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/SideMenu.tsx`,
  monitorsSideMenu: `${DASHBOARD}/Pages/Monitor/SideMenu.tsx`,
  onCallSideMenu: `${DASHBOARD}/Pages/OnCallDuty/SideMenu.tsx`,
  userSettingsSideMenu: `${DASHBOARD}/Pages/UserSettings/SideMenu.tsx`,
  ruleTable: `${DASHBOARD}/Components/Workspace/WorkspaceNotificationRulesTable.tsx`,
  ruleForm: `${DASHBOARD}/Components/Workspace/NotificationRuleForm/NotificationRuleForm.tsx`,
  ruleVideoCallForm: `${DASHBOARD}/Components/Workspace/NotificationRuleForm/NotificationRuleVideoCallForm.tsx`,
  summaryTable: `${DASHBOARD}/Components/Workspace/WorkspaceSummaryTable.tsx`,
  planLeftoverCopy: `${DASHBOARD}/Components/Billing/PlanLeftoverCopy.ts`,
  planLeftoverGate: `${DASHBOARD}/Components/Workspace/WorkspacePlanLeftoverGate.tsx`,
  slackCard: `${DASHBOARD}/Components/Slack/SlackIntegration.tsx`,
  teamsCard: `${DASHBOARD}/Components/MicrosoftTeams/MicrosoftTeamsIntegration.tsx`,
  teamsChatsCard: `${DASHBOARD}/Components/MicrosoftTeams/MicrosoftTeamsChatsCard.tsx`,
  connectCallbackMessage: `${DASHBOARD}/Utils/Workspace/ConnectCallbackMessage.ts`,
  notificationMethodTabs: `${DASHBOARD}/Components/NotificationMethods/NotificationMethodTabs.tsx`,
  slackNotificationMethod: `${DASHBOARD}/Components/NotificationMethods/Slack.tsx`,
  teamsNotificationMethod: `${DASHBOARD}/Components/NotificationMethods/MicrosoftTeams.tsx`,
  notificationLogsTabs: `${DASHBOARD}/Components/NotificationLogs/NotificationLogsTabs.tsx`,
  workspaceLogsTable: `${DASHBOARD}/Components/NotificationLogs/WorkspaceLogsTable.tsx`,
  incidentsSlackPage: `${DASHBOARD}/Pages/Incidents/WorkspaceConnectionSlack.tsx`,
  incidentsTeamsPage: `${DASHBOARD}/Pages/Incidents/WorkspaceConnectionMicrosoftTeams.tsx`,
  alertsSlackPage: `${DASHBOARD}/Pages/Alerts/WorkspaceConnectionSlack.tsx`,
  alertsTeamsPage: `${DASHBOARD}/Pages/Alerts/WorkspaceConnectionMicrosoftTeams.tsx`,
  scheduledMaintenanceSlackPage: `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/WorkspaceConnectionSlack.tsx`,
  scheduledMaintenanceTeamsPage: `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/WorkspaceConnectionMicrosoftTeams.tsx`,
  monitorsSlackPage: `${DASHBOARD}/Pages/Monitor/WorkspaceConnectionSlack.tsx`,
  monitorsTeamsPage: `${DASHBOARD}/Pages/Monitor/WorkspaceConnectionMicrosoftTeams.tsx`,
  onCallSlackPage: `${DASHBOARD}/Pages/OnCallDuty/WorkspaceConnectionSlack.tsx`,
  onCallTeamsPage: `${DASHBOARD}/Pages/OnCallDuty/WorkspaceConnectionMicrosoftTeams.tsx`,
  eventVideoCallsCard: `${DASHBOARD}/Components/VideoCall/EventVideoCallsCard.tsx`,
  videoCallConnectionsTable: `${DASHBOARD}/Components/VideoCall/VideoCallConnectionsTable.tsx`,
  videoCallOAuthConnectModal: `${DASHBOARD}/Components/VideoCall/VideoCallOAuthConnectModal.tsx`,
  videoCallTestPanel: `${DASHBOARD}/Components/VideoCall/VideoCallTestPanel.tsx`,
  startVideoCallModal: `${DASHBOARD}/Components/VideoCall/StartVideoCallModal.tsx`,
  questionPalette: `${DASHBOARD}/Components/FormBuilder/Builder/QuestionPalette.tsx`,
  questionCard: `${DASHBOARD}/Components/FormBuilder/Builder/QuestionCard.tsx`,
  formSharePage: `${DASHBOARD}/Pages/Forms/View/Share.tsx`,
  formStatusCard: `${DASHBOARD}/Components/FormBuilder/FormStatusCard.tsx`,
  formShareLinkCard: `${DASHBOARD}/Components/FormBuilder/FormShareLinkCard.tsx`,
  accountsLocale: "App/FeatureSet/Accounts/src/Locales/en.json",
  oauthState: `${WORKSPACE_UTILS}/WorkspaceOAuthState.ts`,
  slackManifest: `${WORKSPACE_UTILS}/Slack/app-manifest.json`,
  teamsBot: `${WORKSPACE_UTILS}/MicrosoftTeams/MicrosoftTeams.ts`,
  teamsReplies: `${WORKSPACE_UTILS}/MicrosoftTeams/MicrosoftTeamsReplies.ts`,
  teamsIncidentActions: `${WORKSPACE_UTILS}/MicrosoftTeams/Actions/Incident.ts`,
  teamsOnCallActions: `${WORKSPACE_UTILS}/MicrosoftTeams/Actions/OnCallDutyPolicy.ts`,
  actionAuthorization: `${WORKSPACE_UTILS}/WorkspaceActionAuthorization.ts`,
  memberActions: `${WORKSPACE_UTILS}/WorkspaceMemberActions.ts`,
  testSendAccess: "Common/Server/API/TestSendAccess.ts",
  notificationRuleService:
    "Common/Server/Services/WorkspaceNotificationRuleService.ts",
  teamsReactionJob:
    "App/FeatureSet/Workers/Jobs/MicrosoftTeams/SyncReactionNotes.ts",
  videoCallMessages: "Common/Server/Utils/VideoCall/VideoCallMessages.ts",
  videoCallTokenStore:
    "Common/Server/Utils/VideoCall/OAuth/VideoCallOAuthTokenStore.ts",
  videoCallKeepAliveJob:
    "App/FeatureSet/Workers/Jobs/VideoCall/KeepVideoCallSignInsAlive.ts",
};

const SLACK: string = "workspace-connections/slack";
const TEAMS: string = "workspace-connections/microsoft-teams";
const VIDEO_CALLS: string = "workspace-connections/video-calls";
const BUILDING: string = "forms/building";
const SHARING: string = "forms/sharing-and-security";

const CHAT_PAGES: ReadonlyArray<string> = [SLACK, TEAMS];

const HEADING: RegExp = /^(#{1,6}) (.+)$/;
const TABLE_ROW: RegExp = /^\|.*\|$/;
const TABLE_DIVIDER: RegExp = /^\|(\s*:?-+:?\s*\|)+$/;
const STRING_TITLE: RegExp = /title: "([^"]+)"/g;
const TAB_NAME: RegExp = /name: "([^"]+)"/g;
const PERMISSION_NAME: RegExp = /Permission\.(\w+)/g;
const EMOJI: RegExp = /\p{Extended_Pictographic}/gu;
// A side menu's Workspace section given a page to connect a workspace from.
const CONNECT_PAGE: RegExp = /connect: PageMap\.\w+/;

function readSource(name: string): string {
  const relative: string | undefined = SOURCES[name];

  expect({ name, known: Boolean(relative) }).toEqual({ name, known: true });

  return fs.readFileSync(path.join(PACKAGES_DIR, relative as string), "utf8");
}

function englishPage(page: string): string {
  return readPage("en", page);
}

// A heading's section: its body up to the next heading of its level or above.
function section(markdown: string, level: number, title: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line === `${"#".repeat(level)} ${title}`;
  });

  expect({ title, found: start >= 0 }).toEqual({ title, found: true });

  const body: Array<string> = [];
  let inFence: boolean = false;

  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("```")) {
      inFence = !inFence;
    }

    const heading: RegExpMatchArray | null = inFence
      ? null
      : line.match(HEADING);

    if (heading && (heading[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

// The tables of a piece of markdown, each as rows of trimmed cells, its header first.
function tables(markdown: string): Array<Array<Array<string>>> {
  const found: Array<Array<Array<string>>> = [];
  let current: Array<Array<string>> | null = null;

  for (const line of markdown.split("\n")) {
    if (!TABLE_ROW.test(line.trim())) {
      current = null;
      continue;
    }

    if (TABLE_DIVIDER.test(line.trim())) {
      continue;
    }

    const cells: Array<string> = line
      .trim()
      .slice(1, -1)
      .split("|")
      .map((cell: string): string => {
        return cell.trim();
      });

    if (!current) {
      current = [];
      found.push(current);
    }

    current.push(cells);
  }

  return found;
}

// The table whose header's first cell is the one given.
function tableHeaded(
  markdown: string,
  firstHeader: string,
): Array<Array<string>> {
  const table: Array<Array<string>> | undefined = tables(markdown).find(
    (rows: Array<Array<string>>): boolean => {
      return rows[0]?.[0] === firstHeader;
    },
  );

  expect({ firstHeader, found: Boolean(table) }).toEqual({
    firstHeader,
    found: true,
  });

  return (table as Array<Array<string>>).slice(1);
}

// The line of a piece of markdown that starts with the words given.
function lineStarting(markdown: string, start: string): string {
  const line: string | undefined = markdown
    .split("\n")
    .find((candidate: string): boolean => {
      return candidate.startsWith(start);
    });

  expect({ start, found: Boolean(line) }).toEqual({ start, found: true });

  return line as string;
}

// Whether a source spells the text as a string literal: "x", 'x' or `x`.
function sourceSays(source: string, text: string): boolean {
  return [`"${text}"`, `'${text}'`, `\`${text}\``].some(
    (quoted: string): boolean => {
      return source.includes(quoted);
    },
  );
}

// The part of a source from an opening bracket to the bracket that closes it.
function bracketed(source: string, openAt: number): string {
  const open: string = source.charAt(openAt);
  const close: string = open === "[" ? "]" : open === "{" ? "}" : ")";
  let depth: number = 0;

  for (let index: number = openAt; index < source.length; index++) {
    const char: string = source.charAt(index);

    if (char === open) {
      depth++;
    }

    if (char === close) {
      depth--;

      if (depth === 0) {
        return source.slice(openAt, index + 1);
      }
    }
  }

  return source.slice(openAt);
}

// The items of a side-menu section written as objects: { title, items: [...] }.
function menuSectionItems(source: string, sectionTitle: string): Array<string> {
  const titleAt: number = source.indexOf(`title: "${sectionTitle}",`);

  expect({ sectionTitle, found: titleAt >= 0 }).toEqual({
    sectionTitle,
    found: true,
  });

  const items: string = bracketed(
    source,
    source.indexOf("[", source.indexOf("items:", titleAt)),
  );

  return Array.from(items.matchAll(/link: \{\s*title: "([^"]+)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The step titles of the first formSteps a source passes, in order.
function formStepTitles(source: string): Array<string> {
  const stepsAt: number = source.indexOf("formSteps={[");

  expect(stepsAt).toBeGreaterThan(-1);

  return Array.from(
    bracketed(source, source.indexOf("[", stepsAt)).matchAll(STRING_TITLE),
  ).map((match: RegExpMatchArray): string => {
    return match[1] as string;
  });
}

// A string constant of a source: NAME: string =\n "...".
function stringConstant(source: string, name: string): string {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`${name}: string =\\s*"([^"]+)"`),
  );

  expect({ name, found: Boolean(match) }).toEqual({ name, found: true });

  return (match as RegExpMatchArray)[1] as string;
}

function titlesOf(permissions: ReadonlyArray<Permission>): Array<string> {
  return permissions.map((permission: Permission): string => {
    return PermissionHelper.getTitle(permission);
  });
}

// The permissions a source's array literal names, as the docs title them.
function namedPermissions(source: string, arrayAt: number): Array<string> {
  return Array.from(
    bracketed(source, source.indexOf("[", arrayAt)).matchAll(PERMISSION_NAME),
  ).map((match: RegExpMatchArray): string => {
    const permission: Permission | undefined =
      Permission[match[1] as keyof typeof Permission];

    expect({ name: match[1], known: Boolean(permission) }).toEqual({
      name: match[1],
      known: true,
    });

    return PermissionHelper.getTitle(permission as Permission);
  });
}

function sorted(values: ReadonlyArray<string>): Array<string> {
  return [...values].sort();
}

describe("Slack and Microsoft Teams, against the Dashboard and the server", () => {
  it("finds both pages, and Video Calls, under Project Settings > Workspace, as the settings menu lists them", () => {
    expect(
      menuSectionItems(readSource("settingsSideMenu"), "Workspace"),
    ).toEqual(["Slack", "Microsoft Teams", "Video Calls"]);

    expect(englishPage(SLACK)).toContain(
      "**Project Settings** > **Workspace** > **Slack**",
    );
    expect(englishPage(TEAMS)).toContain(
      "**Project Settings** > **Workspace** > **Microsoft Teams**",
    );
    expect(englishPage(VIDEO_CALLS)).toContain(
      "**Project Settings** > **Workspace** > **Video Calls**",
    );
  });

  it("names the products' Workspace section and its connect entry as the five product menus draw them", () => {
    const section: string = readSource("workspaceSideMenuSection");

    expect(section).toContain(
      'export const WORKSPACE_SECTION_TITLE: string = "Workspace";',
    );

    const entryTitles: Record<string, string> = Object.fromEntries(
      Array.from(
        section.matchAll(/\[WorkspaceMenuEntry\.(\w+)\]: "([^"]+)"/g),
      ).map((match: RegExpMatchArray): [string, string] => {
        return [match[1] as string, match[2] as string];
      }),
    );

    expect(entryTitles).toEqual({
      Slack: "Slack",
      MicrosoftTeams: "Microsoft Teams",
      Connect: "Connect Slack or Teams",
    });

    // Incidents, Alerts, Scheduled Maintenance, Monitors and On-Call send a project with nothing connected to connect one.
    for (const menu of [
      "incidentsSideMenu",
      "alertsSideMenu",
      "scheduledMaintenanceSideMenu",
      "monitorsSideMenu",
      "onCallSideMenu",
    ]) {
      const source: string = readSource(menu);

      expect({
        menu,
        workspace: source.includes("useWorkspaceSideMenuSection("),
      }).toEqual({
        menu,
        workspace: true,
      });
      expect({ menu, connect: CONNECT_PAGE.test(source) }).toEqual({
        menu,
        connect: true,
      });
    }

    // User Settings lists the connected workspaces, and has nothing to connect.
    const userSettings: string = readSource("userSettingsSideMenu");

    expect(userSettings).toContain("useWorkspaceSideMenuSection(");
    expect(CONNECT_PAGE.test(userSettings)).toBe(false);

    for (const page of CHAT_PAGES) {
      const markdown: string = englishPage(page);

      expect(markdown).toContain(
        "the **Workspace** section of the Incidents, Alerts, Scheduled Maintenance, Monitors and On-Call menus holds **Connect Slack or Teams**",
      );
      expect(markdown).toContain(
        "The **Workspace** section lists only the chat workspaces your project has connected",
      );
    }
  });

  it("lists each product's tabs as its Slack and Microsoft Teams pages draw them", () => {
    const pages: Record<string, { slack: string; teams: string }> = {
      Incidents: { slack: "incidentsSlackPage", teams: "incidentsTeamsPage" },
      Alerts: { slack: "alertsSlackPage", teams: "alertsTeamsPage" },
      "Scheduled Maintenance": {
        slack: "scheduledMaintenanceSlackPage",
        teams: "scheduledMaintenanceTeamsPage",
      },
      Monitors: { slack: "monitorsSlackPage", teams: "monitorsTeamsPage" },
      "On-Call Duty": { slack: "onCallSlackPage", teams: "onCallTeamsPage" },
    };

    for (const page of CHAT_PAGES) {
      const rows: Array<Array<string>> = tableHeaded(
        section(englishPage(page), 2, "Notification rules"),
        "Product",
      );

      expect(
        rows.map((row: Array<string>): string => {
          return row[0] as string;
        }),
      ).toEqual(
        Object.keys(pages).map((product: string): string => {
          return `**${product}**`;
        }),
      );

      for (const row of rows) {
        const product: string = (row[0] as string).slice(2, -2);
        const source: string = readSource(
          page === SLACK
            ? (pages[product] as { slack: string }).slack
            : (pages[product] as { teams: string }).teams,
        );
        const tabs: Array<string> = source.includes("<Tabs")
          ? Array.from(source.matchAll(TAB_NAME)).map(
              (match: RegExpMatchArray): string => {
                return match[1] as string;
              },
            )
          : [];

        if (tabs.length === 0) {
          expect({ page, product, cell: row[1] }).toEqual({
            page,
            product,
            cell: "One list of rules",
          });
          continue;
        }

        expect({ page, product, tabs: boldSpans(row[1] as string) }).toEqual({
          page,
          product,
          tabs,
        });
      }
    }
  });

  it("walks a notification rule's steps as the form does, the Video Call step for incidents and alerts only", () => {
    const table: string = readSource("ruleTable");
    const steps: Array<string> = formStepTitles(table);

    expect(steps).toEqual(["Basic", "Conditions", "Destination", "Video Call"]);

    // The Video Call step is offered for exactly the incident and alert rules.
    const canStart: string = bracketed(
      table,
      table.indexOf(
        "{",
        table.indexOf("export function canRuleStartVideoCall("),
      ),
    );

    expect(
      sorted(
        Array.from(canStart.matchAll(/NotificationRuleEventType\.(\w+)/g)).map(
          (match: RegExpMatchArray): string => {
            return match[1] as string;
          },
        ),
      ),
    ).toEqual(["Alert", "Incident"]);
    expect(table).toContain("...(canRuleStartVideoCall(props.eventType)");

    for (const page of CHAT_PAGES) {
      const rows: Array<Array<string>> = tableHeaded(
        section(englishPage(page), 2, "Notification rules"),
        "Step",
      );

      expect(
        rows.map((row: Array<string>): string => {
          return row[0] as string;
        }),
      ).toEqual(
        steps.map((step: string): string => {
          return `**${step}**`;
        }),
      );
      expect(rows[3]?.[1]).toMatch(/^Incidents and alerts only: /);
      expect(rows[0]?.[1]).toBe("**Rule Name** and **Rule Description**.");
      expect(
        sourceSays(readSource("ruleTable"), "Rule Name") &&
          sourceSays(readSource("ruleTable"), "Rule Description"),
      ).toBe(true);
    }
  });

  it("names a channel a rule creates as the form asks for it and the server builds it", () => {
    const form: string = readSource("ruleForm");
    const service: string = readSource("notificationRuleService");

    expect(form).toContain(
      "title: `New ${getWorkspaceTypeDisplayName(props.workspaceType)} Channel Name`",
    );
    expect(englishPage(SLACK)).toContain("**New Slack Channel Name**");
    expect(englishPage(TEAMS)).toContain(
      "**New Microsoft Teams Channel Name**",
    );

    /*
     * The name, then the record's number with what a channel name may not
     * hold taken out: "#42" is "42".
     */
    expect(service).toContain(
      "`oneuptime-${data.notificationEventType.toLowerCase()}-`",
    );
    expect(service).toContain('.replace(/[^a-z0-9\\-_]/g, "")');
    expect(service).toContain(
      "const channelName: string = notificationChannels + sanitizedSuffix;",
    );

    const example: string = `oneuptime-${NotificationRuleEventType.Incident.toLowerCase()}-42`;

    for (const page of CHAT_PAGES) {
      expect(inlineCode(englishPage(page))).toContain(example);
      expect(englishPage(page)).toContain(
        `followed by the record's number, such as \`${example}\``,
      );
    }
  });

  it("walks a summary's steps as its form does", () => {
    const summaryTable: string = readSource("summaryTable");
    const steps: Array<string> = formStepTitles(summaryTable);

    expect(steps).toEqual(["Basic Info", "Schedule", "Content", "Filters"]);
    expect(sourceSays(summaryTable, "What to Include")).toBe(true);
    expect(sourceSays(summaryTable, "Team Name")).toBe(true);

    for (const page of CHAT_PAGES) {
      const line: string = lineStarting(
        section(englishPage(page), 2, "Summaries"),
        "The summary form has four steps: ",
      );

      expect(
        boldSpans(line).filter((span: string): boolean => {
          return steps.includes(span);
        }),
      ).toEqual(steps);
      expect(line).toContain("**Content** (**What to Include**)");
    }

    // Teams asks which team each channel is in.
    expect(
      lineStarting(englishPage(TEAMS), "The summary form has four steps: "),
    ).toContain(
      "**Basic Info** (its name, the channels and their **Team Name**)",
    );
  });

  it("names what a project below the Growth plan still lists, as the page titles it", () => {
    const copy: string = readSource("planLeftoverCopy");
    const gate: string = readSource("planLeftoverGate");
    const titleOf: (key: string) => string = (key: string): string => {
      const match: RegExpMatchArray | null = copy.match(
        new RegExp(`  ${key}: translationKey\\("([^"]+)"\\)`),
      );

      expect({ key, found: Boolean(match) }).toEqual({ key, found: true });

      return (match as RegExpMatchArray)[1] as string;
    };

    expect(gate).toContain("PlanLeftoverTitle.notificationRules");
    expect(gate).toContain("PlanLeftoverTitle.summaries");

    for (const page of CHAT_PAGES) {
      const below: string = section(
        englishPage(page),
        2,
        "Notification rules below the Growth plan",
      );

      expect(below).toContain(
        `(**${titleOf("notificationRules")}**, **${titleOf("summaries")}**)`,
      );
    }
  });

  it("names the settings cards' buttons as the cards draw them", () => {
    const buttons: Array<{ page: string; source: string; label: string }> = [
      { page: SLACK, source: "slackCard", label: "Connect with Slack" },
      {
        page: SLACK,
        source: "slackCard",
        label: "Connect my account with Slack",
      },
      {
        page: SLACK,
        source: "slackCard",
        label: "Uninstall OneUptime from Slack",
      },
      { page: SLACK, source: "slackCard", label: "Disconnect" },
      { page: TEAMS, source: "teamsCard", label: "Grant Admin Consent" },
      { page: TEAMS, source: "teamsCard", label: "Admin Consent Completed" },
      {
        page: TEAMS,
        source: "teamsCard",
        label: "Connect with Microsoft Teams",
      },
      { page: TEAMS, source: "teamsCard", label: "View Teams" },
      { page: TEAMS, source: "teamsCard", label: "Open Teams Store" },
      { page: TEAMS, source: "teamsCard", label: "Download App Manifest Zip" },
      {
        page: TEAMS,
        source: "teamsCard",
        label: "Connect my account with Microsoft Teams",
      },
      {
        page: TEAMS,
        source: "teamsCard",
        label: "Uninstall OneUptime from Microsoft Teams",
      },
      { page: TEAMS, source: "teamsCard", label: "Disconnect" },
      { page: TEAMS, source: "teamsChatsCard", label: "Refresh Chats" },
    ];

    for (const button of buttons) {
      expect({
        label: button.label,
        drawn: sourceSays(readSource(button.source), button.label),
      }).toEqual({ label: button.label, drawn: true });
      expect({
        label: button.label,
        named: boldSpans(englishPage(button.page)).includes(button.label),
      }).toEqual({ label: button.label, named: true });
    }
  });

  it("names a connection that did not finish as the page's notice does", () => {
    const notices: string = readSource("connectCallbackMessage");

    for (const [page, notice] of [
      [SLACK, "Slack was not connected"],
      [TEAMS, "Microsoft Teams was not connected"],
    ] as Array<[string, string]>) {
      expect(sourceSays(notices, notice)).toBe(true);
      expect(englishPage(page)).toContain(
        `the page you started from says **${notice}**`,
      );
    }
  });

  it("names who may connect a workspace, and who may uninstall it, as the server holds them", () => {
    const oauthState: string = readSource("oauthState");
    const connect: Array<string> = namedPermissions(
      oauthState,
      oauthState.indexOf("MANAGE_CONNECTION_PERMISSIONS: Array<Permission> ="),
    );
    const uninstall: Array<string> = titlesOf(
      new WorkspaceProjectAuthToken().getDeletePermissions(),
    );

    expect(connect).toEqual([
      "Project Owner",
      "Project Admin",
      "Project Member",
    ]);
    expect(uninstall).toEqual(["Project Owner", "Project Admin"]);

    for (const page of CHAT_PAGES) {
      const line: string = lineStarting(
        section(englishPage(page), 2, "Before you begin"),
        "- **A role that may connect the project:**",
      );
      const [connecting, uninstalling] = line.split("Uninstalling") as [
        string,
        string,
      ];

      expect(
        boldSpans(connecting).filter((span: string): boolean => {
          return !span.endsWith(":");
        }),
      ).toEqual(connect);
      expect(boldSpans(uninstalling)).toEqual(uninstall);
    }
  });

  it("adds Slack and Microsoft Teams as notification methods on the Workspace Apps tab", () => {
    expect(readSource("notificationMethodTabs")).toContain(
      'translationKey("Workspace Apps")',
    );

    for (const [page, source, add] of [
      [SLACK, "slackNotificationMethod", "Add Slack Account"],
      [TEAMS, "teamsNotificationMethod", "Add Microsoft Teams Account"],
    ] as Array<[string, string, string]>) {
      const methodSource: string = readSource(source);
      const steps: string = section(
        englishPage(page),
        2,
        page === SLACK
          ? "Getting paged in Slack"
          : "Getting paged in Microsoft Teams",
      );

      expect(sourceSays(methodSource, add)).toBe(true);
      expect(sourceSays(methodSource, "Send Test Message")).toBe(true);
      expect(steps).toContain(
        `Go to **User Settings** > **Notification Methods**, open the **Workspace Apps** tab and click **${add}**.`,
      );
      expect(steps).toContain("Click **Send Test Message** on its row.");
    }
  });

  it("saves the reactions each page's table names as the notes it names", () => {
    for (const page of CHAT_PAGES) {
      const rows: Array<Array<string>> = tableHeaded(
        section(englishPage(page), 2, "Saving messages as notes"),
        "Reaction",
      );

      expect(rows).toHaveLength(2);

      for (const row of rows) {
        const expected: WorkspaceNoteType = (row[1] as string).startsWith(
          "A private note",
        )
          ? WorkspaceNoteType.Private
          : WorkspaceNoteType.Public;
        const emojis: Array<string> = Array.from(
          (row[0] as string).matchAll(EMOJI),
        ).map((match: RegExpMatchArray): string => {
          return match[0];
        });

        expect(emojis.length).toBeGreaterThan(0);

        for (const emoji of emojis) {
          expect({
            page,
            emoji,
            note: WorkspaceNoteReactionUtil.getNoteType(emoji),
          }).toEqual({
            page,
            emoji,
            note: expected,
          });
        }
      }
    }

    // Slack names its emojis: a pin, a megaphone or a loudspeaker.
    expect(WorkspaceNoteReactionUtil.getNoteType("pushpin")).toBe(
      WorkspaceNoteType.Private,
    );

    for (const name of ["megaphone", "loudspeaker"]) {
      expect(WorkspaceNoteReactionUtil.getNoteType(name)).toBe(
        WorkspaceNoteType.Public,
      );
      expect(englishPage(SLACK)).toContain(name);
    }

    // Pinning with Slack's own Pin to channel arrives as its own event.
    const manifest: {
      settings: { event_subscriptions: { bot_events: Array<string> } };
    } = JSON.parse(readSource("slackManifest"));

    expect(manifest.settings.event_subscriptions.bot_events).toContain(
      "pin_added",
    );
    expect(englishPage(SLACK)).toContain("Slack's own **Pin to channel**");
  });

  it("picks a Microsoft Teams reaction up within a minute, as its job runs", () => {
    expect(EVERY_MINUTE).toBe("* * * * *");
    expect(readSource("teamsReactionJob")).toContain("schedule: EVERY_MINUTE,");
    expect(englishPage(TEAMS)).toContain(
      "It picks the reaction up within a minute",
    );
  });

  it("lists the Slack app's commands and shortcuts, and the events questions need, as its manifest does", () => {
    const manifest: {
      features: {
        slash_commands: Array<{ command: string }>;
        shortcuts: Array<{ name: string }>;
      };
      settings: { event_subscriptions: { bot_events: Array<string> } };
    } = JSON.parse(readSource("slackManifest"));
    const markdown: string = englishPage(SLACK);
    const code: Array<string> = inlineCode(markdown);

    expect(
      sorted(
        manifest.features.slash_commands.map(
          (command: { command: string }): string => {
            return command.command;
          },
        ),
      ),
    ).toEqual(["/incident", "/maintenance", "/oneuptime"]);
    expect(code).toContain("/incident");
    expect(code).toContain("/maintenance");
    expect(
      code.some((span: string): boolean => {
        return span.startsWith("/oneuptime ask ");
      }),
    ).toBe(true);

    for (const shortcut of manifest.features.shortcuts) {
      expect(boldSpans(markdown)).toContain(shortcut.name);
    }

    // A mention in a channel, or a direct message, reaches the app.
    expect(manifest.settings.event_subscriptions.bot_events).toEqual(
      expect.arrayContaining(["app_mention", "message.im"]),
    );
    expect(markdown).toContain(
      "@mention OneUptime in a channel, or send it a direct message, and it answers in the thread",
    );
  });

  it("lists the bot's commands as its help message does", () => {
    const bot: string = readSource("teamsBot");
    const help: string = bot.slice(
      bot.indexOf("private static getHelpMessage(): string {"),
      bot.indexOf("private static async getActiveIncidentsMessage("),
    );
    const commands: Array<string> = Array.from(
      help.matchAll(/^- \*\*(.+?)\*\* - /gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(commands).toHaveLength(8);

    const rows: Array<Array<string>> = tableHeaded(
      section(englishPage(TEAMS), 2, "Talking to the OneUptime bot"),
      "Message",
    );
    const listed: Array<string> = rows.flatMap(
      (row: Array<string>): Array<string> => {
        return Array.from((row[0] as string).matchAll(/`([^`]+)`/g)).map(
          (match: RegExpMatchArray): string => {
            return match[1] as string;
          },
        );
      },
    );

    expect(sorted(listed)).toEqual(sorted(commands));

    // The bot's own example of a question in plain language.
    expect(help).toContain('"which monitors are down right now?"');
    expect(englishPage(TEAMS)).toContain(
      '"which monitors are down right now?"',
    );
  });

  it("quotes the chats' refusals as the server words them", () => {
    const testRefusal: string = stringConstant(
      readSource("testSendAccess"),
      "TEST_NOTIFICATION_PERMISSION_MESSAGE",
    );
    const notReadable: string = stringConstant(
      readSource("actionAuthorization"),
      "NOT_FOUND_OR_NOT_READABLE",
    );
    const noStates: string = stringConstant(
      readSource("teamsIncidentActions"),
      "NO_STATES_MESSAGE",
    );
    const memberActions: string = readSource("memberActions");

    expect(memberActions).toContain(
      "There is no later state to move this ${this.getNoun(type)} to.",
    );
    expect(memberActions).toMatch(
      /\[WorkspaceEventType\.Incident\]: \{\s*noun: "incident",/,
    );

    for (const page of CHAT_PAGES) {
      const markdown: string = englishPage(page);

      expect(markdown).toContain(`"${testRefusal}"`);
      expect(markdown).toContain(`"${notReadable}"`);
      expect(markdown).toContain(`"${noStates}"`);
      expect(markdown).toContain(
        '"There is no later state to move this incident to."',
      );
    }

    // Microsoft Teams' own: a form naming what the project no longer has, and an Escalate without a record.
    const unavailable: string = stringConstant(
      readSource("teamsReplies"),
      "MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE",
    );
    const escalate: string = stringConstant(
      readSource("teamsOnCallActions"),
      "ESCALATE_NEEDS_RECORD_MESSAGE",
    );
    const elided: string = `${unavailable.slice(0, unavailable.indexOf(" ("))} ...${unavailable.slice(unavailable.indexOf(")") + 1)}`;

    expect(elided).toBe(
      "One of the values you picked ... is not available in this project any more. Please pick it again.",
    );
    expect(englishPage(TEAMS)).toContain(`"${elided}"`);
    expect(englishPage(TEAMS)).toContain(`"${escalate}"`);
  });

  it("finds every post in Notification Logs, on its Workspace tab", () => {
    expect(
      menuSectionItems(readSource("settingsSideMenu"), "Notifications"),
    ).toContain("Notification Logs");
    expect(readSource("notificationLogsTabs")).toContain('name: "Workspace",');
    expect(englishPage(SLACK)).toContain(
      "is listed in **Project Settings** > **Notifications** > **Notification Logs**, on the **Workspace** tab.",
    );
  });
});

describe("Video Calls, against the Dashboard and the worker", () => {
  it("names the rule's switch, the calls' buttons and the connections' states as the Dashboard draws them", () => {
    const labels: Array<{ source: string; drawn: string; named: string }> = [
      {
        source: "ruleVideoCallForm",
        drawn: "Start a video call for the {{eventNoun}}",
        named: "Start a video call for the incident",
      },
      { source: "eventVideoCallsCard", drawn: "Join call", named: "Join call" },
      {
        source: "eventVideoCallsCard",
        drawn: "Start call",
        named: "Start call",
      },
      {
        source: "eventVideoCallsCard",
        drawn: "Start another",
        named: "Start another",
      },
      {
        source: "eventVideoCallsCard",
        drawn: "Join huddle",
        named: "Join huddle",
      },
      {
        source: "startVideoCallModal",
        drawn: "Slack huddle",
        named: "Slack huddle",
      },
      {
        source: "videoCallConnectionsTable",
        drawn: "Not working",
        named: "Not working",
      },
      {
        source: "videoCallConnectionsTable",
        drawn: "Start a test meeting",
        named: "Start a test meeting",
      },
      {
        source: "videoCallTestPanel",
        drawn: "Start test meeting",
        named: "Start test meeting",
      },
      {
        source: "videoCallOAuthConnectModal",
        drawn: "Continue to {{signInWith}}",
        named: "Continue to Zoom",
      },
      {
        source: "videoCallOAuthConnectModal",
        drawn: "Use your own {{provider}} app",
        named: "Use your own Zoom app",
      },
    ];
    const bold: Array<string> = boldSpans(englishPage(VIDEO_CALLS));

    for (const label of labels) {
      expect({
        drawn: label.drawn,
        found: readSource(label.source).includes(label.drawn),
      }).toEqual({ drawn: label.drawn, found: true });
      expect({ named: label.named, found: bold.includes(label.named) }).toEqual(
        {
          named: label.named,
          found: true,
        },
      );
    }
  });

  it("lists a rule's call in the workspace logs as Start Video Call", () => {
    expect(readSource("workspaceLogsTable")).toContain(
      'translationKey("Start Video Call")',
    );
    expect(englishPage(VIDEO_CALLS)).toContain(
      "The rule's run is listed in the workspace notification logs as **Start Video Call**",
    );
  });

  it("says the feed tells why a rule's call did not start, and to start one by hand", () => {
    const messages: string = readSource("videoCallMessages");

    expect(messages).toContain("could not be started. Start one from this");
    expect(englishPage(VIDEO_CALLS)).toContain(
      "the incident's feed says the rule's call could not be started, with the provider's reason, so responders know to start one from the incident's page",
    );
  });

  it("keeps a sign-in alive as the worker does: daily, refreshing one not refreshed for a week", () => {
    expect(readSource("videoCallTokenStore")).toMatch(
      /KEEP_ALIVE_AFTER_IN_MS: number =\s*7 \* 24 \* 60 \* 60 \* 1000;/,
    );
    expect(EVERY_DAY).toBe("0 8 * * *");
    expect(readSource("videoCallKeepAliveJob")).toContain(
      "schedule: EVERY_DAY,",
    );

    const markdown: string = englishPage(VIDEO_CALLS);

    expect(markdown).toContain(
      "OneUptime keeps the sign-in's refresh token, encrypted, and refreshes it at least once a week",
    );
    expect(markdown).toContain(
      "Every day the worker refreshes the sign-ins that are due, so it needs the same values as the app.",
    );
  });

  it("names who may start and remove calls, and who may connect a provider, as the models hold them", () => {
    const call: IncidentVideoCall = new IncidentVideoCall();
    const callRoles: Array<string> = titlesOf(
      call.getCreatePermissions().filter((permission: Permission): boolean => {
        return permission !== Permission.CreateIncidentVideoCall;
      }),
    );

    expect(
      titlesOf(
        call
          .getDeletePermissions()
          .filter((permission: Permission): boolean => {
            return permission !== Permission.DeleteIncidentVideoCall;
          }),
      ),
    ).toEqual(callRoles);
    expect(call.getCreatePermissions()).toContain(
      Permission.CreateIncidentVideoCall,
    );
    expect(call.getDeletePermissions()).toContain(
      Permission.DeleteIncidentVideoCall,
    );

    const byHand: string = lineStarting(
      section(englishPage(VIDEO_CALLS), 2, "Starting a call by hand"),
      "Starting and removing calls needs permission",
    );

    expect(boldSpans(byHand)).toEqual([
      ...callRoles,
      PermissionHelper.getTitle(Permission.CreateIncidentVideoCall),
      PermissionHelper.getTitle(Permission.DeleteIncidentVideoCall),
    ]);

    const connection: VideoCallConnection = new VideoCallConnection();
    const connectionRoles: Array<string> = titlesOf(
      connection
        .getCreatePermissions()
        .filter((permission: Permission): boolean => {
          return permission !== Permission.CreateVideoCallConnection;
        }),
    );

    expect(
      titlesOf(
        connection
          .getUpdatePermissions()
          .filter((permission: Permission): boolean => {
            return permission !== Permission.EditVideoCallConnection;
          }),
      ),
    ).toEqual(connectionRoles);

    const connecting: string = lineStarting(
      section(englishPage(VIDEO_CALLS), 2, "Providers"),
      "Connecting a provider needs",
    );

    expect(boldSpans(connecting)).toEqual([
      ...connectionRoles,
      PermissionHelper.getTitle(Permission.CreateVideoCallConnection),
      PermissionHelper.getTitle(Permission.EditVideoCallConnection),
    ]);
  });
});

describe("Forms, against the builder, the Share page and the public page", () => {
  it("lists the palette's four groups as the builder names them", () => {
    const palette: string = readSource("questionPalette");

    for (const key of [
      "paletteQuestions",
      "paletteIncidentFields",
      "paletteScheduledMaintenanceFields",
      "paletteCustomFields",
      "paletteSubmitter",
    ]) {
      expect({ key, used: palette.includes(`FormsCopy.${key}`) }).toEqual({
        key,
        used: true,
      });
    }

    expect(
      boldSpans(
        lineStarting(
          englishPage(BUILDING),
          `**${FormsCopy.addQuestionTitle}** lists four groups:`,
        ),
      ),
    ).toEqual([
      FormsCopy.addQuestionTitle,
      FormsCopy.paletteQuestions,
      FormsCopy.paletteIncidentFields,
      FormsCopy.paletteScheduledMaintenanceFields,
      FormsCopy.paletteCustomFields,
      FormsCopy.paletteSubmitter,
    ]);
  });

  it("quotes the four flags a question's card can show, word for word", () => {
    const rows: Array<Array<string>> = tableHeaded(
      section(englishPage(BUILDING), 2, "When the builder flags a question"),
      "The card says",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      [
        FormsCopy.issueCustomFieldDeleted,
        FormsCopy.issueNoAllowedOptions,
        FormsCopy.issueNoOptions,
        FormsCopy.issueNoLabel,
      ].map((issue: string): string => {
        return `**${issue}**`;
      }),
    );
  });

  it("names the builder's and the Templates page's buttons as they draw them, and a card's badge as it composes it", () => {
    const bold: Array<string> = boldSpans(englishPage(BUILDING));

    for (const label of [
      FormsCopy.addQuestionTitle,
      FormsCopy.done,
      FormsCopy.moveUp,
      FormsCopy.moveDown,
      FormsCopy.duplicate,
      FormsCopy.saveChanges,
      FormsCopy.unsavedChanges,
      FormsCopy.discardChanges,
      FormsCopy.editFormDetails,
      FormsCopy.editBranding,
      FormsCopy.preview,
      FormsCopy.previewAgain,
      FormsCopy.paletteAdded,
      FormsCopy.addTemplate,
      FormsCopy.copyLink,
      FormsCopy.settingFormDefaultHidden,
      `${FormsCopy.choicesOffered}.`,
    ]) {
      expect({ label, named: bold.includes(label) }).toEqual({
        label,
        named: true,
      });
    }

    const card: string = readSource("questionCard");

    expect(card).toContain(
      "${tx(FORM_TARGET_TYPE_TEXT[props.targetType].title)} · ${tx(",
    );
    expect(card).toContain("${tx(FormsCopy.badgeCustomField)} · ${");
    expect(card).toContain("${tx(FormsCopy.badgeSubmitter)} · ${tx(");

    for (const badge of [
      `${FORM_TARGET_TYPE_TEXT[FormTargetType.Incident].title} · Severity`,
      `${FormsCopy.badgeCustomField} · Region`,
      `${FormsCopy.badgeSubmitter} · ${FORM_SUBMITTER_FIELD_DEFINITIONS[FormSubmitterField.Email].title}`,
    ]) {
      expect({ badge, named: bold.includes(badge) }).toEqual({
        badge,
        named: true,
      });
    }
  });

  it("lists the Share page's cards in the order the page shows them, with the link card's buttons", () => {
    const share: string = readSource("formSharePage");
    const order: Array<number> = [
      share.indexOf("<FormStatusCard"),
      share.indexOf("<FormShareLinkCard"),
      share.indexOf("title: FormsCopy.afterSubmittingTitle"),
      share.indexOf('title: "Access"'),
    ];

    expect(
      order.every((at: number, index: number): boolean => {
        return at >= 0 && (index === 0 || at > (order[index - 1] as number));
      }),
    ).toBe(true);
    expect(readSource("formStatusCard")).toContain(
      "title={FormsCopy.statusCardTitle}",
    );

    const linkCard: string = readSource("formShareLinkCard");

    for (const key of ["shareLinkTitle", "copyLink", "openForm", "resetLink"]) {
      expect({ key, used: linkCard.includes(`FormsCopy.${key}`) }).toEqual({
        key,
        used: true,
      });
    }

    const rows: Array<Array<string>> = tableHeaded(
      section(englishPage(SHARING), 2, "The Share page"),
      "Card",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      [
        FormsCopy.statusCardTitle,
        FormsCopy.shareLinkTitle,
        FormsCopy.afterSubmittingTitle,
        "Access",
      ].map((title: string): string => {
        return `**${title}**`;
      }),
    );
    expect(rows[1]?.[1]).toBe(
      `The link, with **${FormsCopy.copyLink}**, **${FormsCopy.openForm}** and **${FormsCopy.resetLink}**.`,
    );
    expect(rows[0]?.[1]).toContain(`**${FormsCopy.acceptingSubmissions}**`);
    expect(rows[2]?.[1]).toContain(`**${FormsCopy.successMessageTitle}**`);
    expect(rows[3]?.[1]).toContain(`**${FormsCopy.ipAllowlistTitle}**`);
  });

  it("quotes the public page's words as the Accounts locale has them", () => {
    const locale: {
      common: { submit: string };
      form: {
        templateLabel: string;
        successTitle: string;
        reference: string;
        submitAnother: string;
      };
    } = JSON.parse(readSource("accountsLocale"));
    const markdown: string = englishPage(BUILDING);
    const bold: Array<string> = boldSpans(markdown);

    expect(bold).toContain(locale.form.templateLabel);
    expect(bold).toContain(locale.common.submit);
    expect(bold).toContain(locale.form.submitAnother);
    expect(markdown).toContain(`"${locale.form.successTitle}"`);
    expect(markdown).toContain(
      `"${locale.form.reference.split("{{reference}}").join("INC-42")}"`,
    );
  });
});
