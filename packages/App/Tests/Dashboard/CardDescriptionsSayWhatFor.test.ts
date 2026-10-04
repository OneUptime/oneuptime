import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The descriptions that replaced the boilerplate ("Here is a list of…",
 * "Here are more details for this X.") - see CardDescriptionBoilerplateGuard
 * for the rule. These pin the new copy where it lives, its translations in
 * all sixteen languages, the details cards that now have no description at
 * all, and the two Name fields whose placeholder named another resource.
 *
 * The App suite runs in plain Node and cannot render dashboard pages, so
 * these read the sources and the locale files. The pages themselves are
 * rendered in Common/Tests/App/Dashboard/CardDescriptionsSayWhatFor.test.tsx.
 */

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);
const COMMON_UI: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

type Locale = Record<string, unknown>;

const locales: Record<string, Locale> = {};

for (const file of fs.readdirSync(LOCALES_DIR).sort()) {
  if (file.endsWith(".json")) {
    locales[file.replace(/\.json$/, "")] = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    ) as Locale;
  }
}

const NON_ENGLISH: Array<string> = Object.keys(locales).filter(
  (code: string): boolean => {
    return code !== "en";
  },
);

function readDashboard(file: string): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, file), "utf8");
}

function readCommonUi(file: string): string {
  return fs.readFileSync(path.join(COMMON_UI, file), "utf8");
}

/*
 * A list's description is also what its empty state explains (#4269), under
 * a title such as "No incident templates yet", so each says what the items
 * are for and how to use them.
 */
const LIST_DESCRIPTIONS: Array<[string, string]> = [
  [
    "Pages/Incidents/Settings/IncidentTemplates.tsx",
    "Ready-made incidents for problems you expect, with the title, severity, monitors and on-call policy filled in. Use one with Create from Template on the Incidents page.",
  ],
  [
    "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates.tsx",
    "Ready-made maintenance events for work you do often, with the title, monitors, status pages and notifications filled in. Use one with Create from Template, or make it recurring to schedule events automatically.",
  ],
  [
    "Pages/StatusPages/Settings/StatusPageAnnouncementTemplates.tsx",
    "Ready-made announcements for news you post often, such as a planned upgrade. Use one with Create from Template on the Announcements page, and edit it before you publish.",
  ],
  [
    "Pages/MonitorGroup/MonitorGroups.tsx",
    "Monitors that together make up one service, such as Checkout. A group shows the worst status among its monitors, and a status page can show the whole group as one resource.",
  ],
  [
    "Components/IncidentEpisode/IncidentEpisodesTable.tsx",
    "Episodes group related incidents so you can respond to them together. Grouping rules open episodes for you, or you can create one yourself.",
  ],
  [
    "Components/AlertEpisode/AlertEpisodesTable.tsx",
    "Episodes group related alerts so you can respond to them together. Grouping rules open episodes for you, or you can create one yourself.",
  ],
  [
    "Pages/Global/ActiveIncidents.tsx",
    "Incidents nobody has acknowledged yet, from every project you belong to. Open one to acknowledge it.",
  ],
  [
    "Pages/Global/ActiveAlerts.tsx",
    "Alerts nobody has acknowledged yet, from every project you belong to. Open one to acknowledge it.",
  ],
  [
    "Pages/Global/ActiveIncidentEpisodes.tsx",
    "Incident episodes nobody has acknowledged yet, from every project you belong to. Open one to acknowledge it.",
  ],
  [
    "Pages/Global/ActiveAlertEpisodes.tsx",
    "Alert episodes nobody has acknowledged yet, from every project you belong to. Open one to acknowledge it.",
  ],
  [
    "Pages/Global/ProjectInvitations.tsx",
    "When someone invites you to a project or a team, the invitation waits here until you accept or reject it.",
  ],
  [
    "Pages/Settings/Invoices.tsx",
    "This project's invoices, as they are issued. Download one for your records, or pay one that is still open.",
  ],
  [
    "Pages/StatusPages/View/EmailSubscribers.tsx",
    "People who get this status page's updates by email. Visitors subscribe on the status page, or you can add them here.",
  ],
  [
    "Pages/StatusPages/View/SMSSubscribers.tsx",
    "Phone numbers that get this status page's updates by text message. Visitors subscribe on the status page, or you can add them here.",
  ],
  [
    "Pages/StatusPages/View/SlackSubscribers.tsx",
    "Slack channels that get this status page's updates. Visitors subscribe on the status page, or you can add them here.",
  ],
  [
    "Pages/StatusPages/View/MicrosoftTeamsSubscribers.tsx",
    "Microsoft Teams channels that get this status page's updates. Visitors subscribe on the status page, or you can add them here.",
  ],
  [
    "Pages/StatusPages/View/WebhookSubscribers.tsx",
    "URLs that get each of this status page's updates as a JSON POST request, for your own tools. Visitors subscribe on the status page, or you can add them here.",
  ],
  [
    "Pages/StatusPages/View/PrivateUser.tsx",
    "People who can sign in to see this status page. Each one is emailed an invitation when you add them.",
  ],
  [
    "Pages/Monitor/View/Probes.tsx",
    "Probes that check this resource. Only these probes monitor it - adding one here is what puts a probe to work on this resource.",
  ],
  [
    "Pages/MonitorGroup/View/Monitors.tsx",
    "The monitors in this group. The group shows the worst status among them.",
  ],
  [
    "Pages/Settings/UsageHistory.tsx",
    "How much telemetry each service sent each day, how long it is kept and what it cost. The pricing page has the rates.",
  ],
  [
    "Pages/UserSettings/OnCallLogs.tsx",
    "Each time an on-call policy paged you in this project. Open one to see every notification sent and whether it was delivered.",
  ],
  [
    "Pages/UserSettings/OnCallLogsTimeline.tsx",
    "Each notification sent to you, how it was sent and whether it was delivered. If one failed, its status message says why.",
  ],
  [
    "Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable.tsx",
    "Each time an on-call policy ran: what triggered it and who acknowledged it. Open one to see every notification it sent and whether it was delivered.",
  ],
  [
    "Pages/Monitor/View/Logs.tsx",
    "The result of every check of this monitor, newest first. View a summary to see what was checked and how the criteria judged it.",
  ],
  [
    "Pages/Monitor/View/StatusTimeline.tsx",
    "Each status this monitor has been in, when it began and how long it lasted.",
  ],
  [
    "Pages/Incidents/View/StateTimeline.tsx",
    "Each status this incident has been in, when it began and how long it lasted.",
  ],
  [
    "Pages/Alerts/View/StateTimeline.tsx",
    "Each status this alert has been in, when it began and how long it lasted.",
  ],
  [
    "Pages/Incidents/EpisodeView/StateTimeline.tsx",
    "Each status this episode has been in, when it began and how long it lasted.",
  ],
  [
    "Pages/Alerts/EpisodeView/StateTimeline.tsx",
    "Each status this episode has been in, when it began and how long it lasted.",
  ],
  [
    "Pages/ScheduledMaintenanceEvents/View/StateTimeline.tsx",
    "Each status this maintenance event has been in, when it began and how long it lasted.",
  ],
];

// Cards, feeds and dialogs that had something to say and now say it.
const OTHER_DESCRIPTIONS: Array<[string, string]> = [
  [
    "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplateView.tsx",
    "New events scheduled from this template start with these details. Events already scheduled from it keep their own.",
  ],
  [
    "Pages/Incidents/Settings/IncidentTemplatesView.tsx",
    "New incidents declared from this template start with these details. Incidents already declared from it keep their own.",
  ],
  [
    "Pages/StatusPages/Settings/StatusPageAnnouncementTemplateView.tsx",
    "New announcements made from this template start with these details. Announcements already made from it keep their own.",
  ],
  [
    "Pages/Settings/APIKeyView.tsx",
    "Send this key in the ApiKey header of each API request. It can do what its permissions allow, until it expires.",
  ],
  [
    "Pages/Settings/TelemetryIngestionKeyView.tsx",
    "Your apps and collectors send this key with their telemetry, so it lands in this project.",
  ],
  [
    "Pages/Global/UserProfile/Index.tsx",
    "Your name and email as your team sees them, and the time zone OneUptime shows times in.",
  ],
  [
    "Pages/Settings/NotificationSettings.tsx",
    "SMS, calls, WhatsApp and Telegram messages are paid from this balance, in USD. Recharge it, or turn on Auto Recharge so it never runs out.",
  ],
  [
    "Pages/Settings/AICredits.tsx",
    "AI features are paid from this balance, in USD. Recharge it, or turn on Auto Recharge so it never runs out.",
  ],
  [
    "Components/ApiKey/ApiKeyPermissionTable.tsx",
    "Blocks win over this key's roles and permissions. A block with labels applies only to resources that carry one of them.",
  ],
  [
    "Pages/Teams/View/Members.tsx",
    "Add and remove this team's members in your identity provider. To change them here instead, turn off Push Groups in Settings > SCIM.",
  ],
  [
    "Pages/Monitor/View/Criteria.tsx",
    "The conditions that decide this monitor's status, and the incidents and alerts it creates.",
  ],
  [
    "Pages/MonitorGroup/View/Index.tsx",
    "This group's status over the last 90 days, one bar per day.",
  ],
  [
    "Pages/Monitor/Settings/MonitorProbes.tsx",
    "Your probe connects to OneUptime with this ID and key. Keep the key secret.",
  ],
  [
    "Components/Monitor/MonitorSteps/MonitorStep.tsx",
    "How the probes check this resource: what they connect to and the settings they use.",
  ],
  [
    "Components/Monitor/SummaryView/Summary.tsx",
    "The most recent check of this monitor, and how the criteria judged it.",
  ],
  [
    "Components/Form/Monitor/LogMonitor/LogMonitorStepFrom.tsx",
    "The logs these filters match, so you can check the filters before you save.",
  ],
  [
    "Components/Form/Monitor/TraceMonitor/TraceMonitorStepForm.tsx",
    "The spans these filters match, so you can check the filters before you save.",
  ],
  [
    "Components/Form/Monitor/ExceptionMonitor/ExceptionMonitorStepForm.tsx",
    "The exceptions these filters match, so you can check the filters before you save.",
  ],
  [
    "Components/Form/Monitor/SecurityEventsMonitor/SecurityEventsMonitorStepForm.tsx",
    "The security events these filters match, so you can check the filters before you save.",
  ],
  [
    "Pages/Incidents/View/StateTimeline.tsx",
    "What OneUptime recorded when this incident changed to this status, such as the monitor check that caused it.",
  ],
  [
    "Pages/Alerts/View/StateTimeline.tsx",
    "What OneUptime recorded when this alert changed to this status, such as the monitor check that caused it.",
  ],
  [
    "Pages/Monitor/View/StatusTimeline.tsx",
    "What OneUptime recorded when this monitor changed to this status, such as the check that caused it.",
  ],
  [
    "Components/Incident/IncidentFeed.tsx",
    "Everything that has happened to this incident: status changes, notes, owners and every notification sent.",
  ],
  [
    "Components/Alert/AlertFeed.tsx",
    "Everything that has happened to this alert: status changes, notes, owners and every notification sent.",
  ],
  [
    "Components/IncidentEpisode/IncidentEpisodeFeed.tsx",
    "Everything that has happened to this episode: status changes, notes, owners and every notification sent.",
  ],
  [
    "Components/AlertEpisode/AlertEpisodeFeed.tsx",
    "Everything that has happened to this episode: status changes, notes, owners and every notification sent.",
  ],
  [
    "Components/ScheduledMaintenance/ScheduledMaintenanceFeed.tsx",
    "Everything that has happened to this maintenance event: status changes, notes, owners and every notification sent.",
  ],
  [
    "Components/OnCallPolicy/OnCallDutyPolicyFeed.tsx",
    "Everything that has happened to this on-call policy: people, teams and schedules added or removed, overrides and handoffs.",
  ],
];

/*
 * Sentences these pages now share with another page, so they read alike and
 * one translation serves both.
 */
const SHARED_DESCRIPTIONS: Array<[string, string]> = [
  [
    "Components/Monitor/MonitorFeed.tsx",
    // The monitor overview's Recent activity card.
    "Everything that has happened to this monitor, newest first.",
  ],
  [
    "Components/TelemetryService/TelemetryServiceTable.tsx",
    // The Services page.
    "The applications and microservices you run. Each service brings together its logs, traces, metrics, exceptions, incidents and owners in one place.",
  ],
  [
    "Components/OnCallPolicy/OnCallScheduleLayer/FinalPreview.tsx",
    // The schedule's Layers page.
    "A combined preview of who is on call and when, after all layers and priorities are applied. Restriction windows are resolved in this schedule's timezone — {{timezone}}.",
  ],
  [
    "Components/OnCallPolicy/OnCallScheduleLayer/FinalPreview.tsx",
    "A combined preview of who is on call and when, after all layers and priorities are applied. Shown in your local timezone — {{timezone}}.",
  ],
  [
    "Components/OnCallPolicy/OnCallScheduleLayer/LayersPreview.tsx",
    "A combined preview of who is on call and when, after all layers and priorities are applied. Restriction windows are resolved in this schedule's timezone — {{timezone}}.",
  ],
  [
    "Components/OnCallPolicy/OnCallScheduleLayer/LayersPreview.tsx",
    "A combined preview of who is on call and when, after all layers and priorities are applied. Shown in your local timezone — {{timezone}}.",
  ],
];

const RULE_VIEW_DESCRIPTION: string =
  "What this rule matches, and what it does to each match.";

const ALL_DESCRIPTIONS: Array<[string, string]> = [
  ...LIST_DESCRIPTIONS,
  ...OTHER_DESCRIPTIONS,
  ...SHARED_DESCRIPTIONS,
];

function expectTranslatedEverywhere(sentence: string): void {
  expect(locales["en"]![sentence]).toBe(sentence);

  for (const code of NON_ENGLISH) {
    const value: unknown = locales[code]![sentence];

    expect({ code: code, isString: typeof value === "string" }).toEqual({
      code: code,
      isString: true,
    });
    expect({ code: code, isTranslated: value !== sentence }).toEqual({
      code: code,
      isTranslated: true,
    });
  }
}

describe("each list says what it is for", () => {
  test.each(LIST_DESCRIPTIONS)("%s", (file: string, sentence: string) => {
    expect(readDashboard(file)).toContain(`"${sentence}"`);
  });

  test.each(LIST_DESCRIPTIONS)(
    "%s reads as the explanation under an empty list's 'No X yet'",
    (_file: string, sentence: string) => {
      // Whole sentences, not a caption, and not a second "No X yet".
      expect(sentence).toMatch(/\.$/);
      expect(sentence.length).toBeGreaterThanOrEqual(60);
      expect(sentence).not.toMatch(/^No\b/);
      expect(sentence).not.toMatch(/\bHere (is|are)\b/);
    },
  );
});

describe("cards, feeds and dialogs say what they show", () => {
  test.each([...OTHER_DESCRIPTIONS, ...SHARED_DESCRIPTIONS])(
    "%s",
    (file: string, sentence: string) => {
      expect(readDashboard(file)).toContain(`"${sentence}"`);
    },
  );

  test("the rule view every label, owner and monitor rule opens on", () => {
    expect(readCommonUi("Components/RuleRun/RuleView.tsx")).toContain(
      `"${RULE_VIEW_DESCRIPTION}"`,
    );
  });
});

describe("every new sentence is translated in every language", () => {
  test("there are sixteen languages besides English", () => {
    expect(NON_ENGLISH).toHaveLength(16);
  });

  test.each(
    [
      ...ALL_DESCRIPTIONS.map(([, sentence]: [string, string]): string => {
        return sentence;
      }),
      RULE_VIEW_DESCRIPTION,
    ].filter((sentence: string, index: number, all: Array<string>): boolean => {
      return all.indexOf(sentence) === index;
    }),
  )("%s", (sentence: string) => {
    expectTranslatedEverywhere(sentence);
  });
});

/*
 * A details card whose title already says what it holds - "Workflow
 * Details" over a workflow's name and description - had a description that
 * said it again ("Here are more details for this workflow.", "Basic
 * information about this pipeline.", "Overview of this Docker host."). Those
 * cards have no description now.
 */
const TITLE_SAYS_IT_ALL: Array<[string, string]> = [
  ["Pages/Settings/ProjectSettings.tsx", "Project Details"],
  ["Pages/Service/View/Index.tsx", "Service Details"],
  ["Pages/OnCallDuty/OnCallDutySchedule/Index.tsx", "On-Call Schedule Details"],
  [
    "Pages/OnCallDuty/IncomingCallPolicy/Index.tsx",
    "Incoming Call Policy Details",
  ],
  ["Pages/OnCallDuty/OnCallDutyPolicy/Index.tsx", "On-Call Policy Details"],
  ["Pages/CodeRepository/View/Index.tsx", "Repository Details"],
  [
    "Pages/StatusPages/AnnouncementView.tsx",
    "Status Page Announcement Details",
  ],
  ["Pages/StatusPages/View/Index.tsx", "Status Page Details"],
  ["Pages/Dashboards/Settings/DataSourceView.tsx", "Data Source Details"],
  ["Pages/Dashboards/View/Overview.tsx", "Dashboard Details"],
  ["Pages/Workflow/View/Index.tsx", "Workflow Details"],
  ["Pages/Monitor/Settings/MonitorProbeView.tsx", "Probe Details"],
  ["Pages/Monitor/Settings/MonitorProbeView.tsx", "Probe Status"],
  ["Pages/Teams/View/Index.tsx", "Team Details"],
  ["Pages/MonitorGroup/View/Index.tsx", "Monitor Group Details"],
  ["Pages/Settings/LlmProviderView.tsx", "LLM Provider Details"],
  ["Pages/Runbook/Runners/RunnerView.tsx", "Runner Status"],
  ["Pages/Traces/Settings/PipelineView.tsx", "Pipeline Details"],
  ["Pages/Logs/Settings/PipelineView.tsx", "Pipeline Details"],
  ["Pages/Traces/Settings/DropFilterView.tsx", "Drop Filter Details"],
  ["Pages/Logs/Settings/DropFilterView.tsx", "Drop Filter Details"],
  ["Pages/Kubernetes/View/Index.tsx", "Cluster Details"],
  ["Pages/Proxmox/View/Index.tsx", "Cluster Details"],
  ["Pages/VMware/View/Index.tsx", "vCenter Details"],
  ["Pages/Docker/View/Overview.tsx", "Docker Host Details"],
  ["Pages/Podman/View/Overview.tsx", "Podman Host Details"],
  ["Pages/Ceph/View/Index.tsx", "Ceph Cluster Details"],
  [
    "Pages/StatusPages/Settings/SubscriberNotificationTemplateView.tsx",
    "Template Overview",
  ],
  ["Pages/Runbook/View/Index.tsx", "Runbook"],
];

interface CardObject {
  title: string;
  properties: Array<string>;
  description: ts.Expression | undefined;
}

// Whether `node` is what a card is handed: `cardProps={{ ... }}` or `cardProps: { ... }`.
function isCardProps(node: ts.ObjectLiteralExpression): boolean {
  const parent: ts.Node = node.parent;

  if (ts.isPropertyAssignment(parent)) {
    return parent.name.getText() === "cardProps";
  }

  return (
    ts.isJsxExpression(parent) &&
    ts.isJsxAttribute(parent.parent) &&
    parent.parent.name.getText() === "cardProps"
  );
}

// Every card's props in the file with a string `title`, and their keys.
function getTitledObjects(file: string): Array<CardObject> {
  const text: string = readDashboard(file);
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const objects: Array<CardObject> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && isCardProps(node)) {
      let title: string | undefined = undefined;
      let description: ts.Expression | undefined = undefined;
      const properties: Array<string> = [];

      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) {
          continue;
        }

        const name: string = property.name.getText(source);
        properties.push(name);

        if (name === "title" && ts.isStringLiteral(property.initializer)) {
          title = property.initializer.text;
        }

        if (name === "description") {
          description = property.initializer;
        }
      }

      if (title !== undefined) {
        objects.push({
          title: title,
          properties: properties,
          description: description,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return objects;
}

describe("a details card whose title says it all has no description", () => {
  test.each(TITLE_SAYS_IT_ALL)("%s: %s", (file: string, title: string) => {
    const cards: Array<CardObject> = getTitledObjects(file).filter(
      (card: CardObject): boolean => {
        return card.title === title;
      },
    );

    expect(cards).toHaveLength(1);
    expect(cards[0]!.properties).not.toContain("description");
  });

  test("a Runner the Kubernetes agent installed still says why its form is short", () => {
    const cards: Array<CardObject> = getTitledObjects(
      "Pages/Runbook/Runners/RunnerView.tsx",
    ).filter((card: CardObject): boolean => {
      return card.title === "Runner Details";
    });

    expect(cards).toHaveLength(1);

    // The note, and nothing else: no description on an ordinary Runner.
    const description: string = cards[0]!.description!.getText();
    expect(description).toContain("kubernetesAgentRunnerNote ?");
    expect(description).toContain('data-testid="kubernetes-agent-runner-note"');
    expect(description).toMatch(/:\s*undefined$/);
    expect(description).not.toContain("translateText");
  });

  test("the summary and workflow run dialogs have no filler line", () => {
    expect(readDashboard("Pages/Monitor/View/Logs.tsx")).not.toContain(
      "Here is the summary of this monitor.",
    );
    expect(readDashboard("Pages/Monitor/View/Probes.tsx")).not.toContain(
      "Here are the latest monitoring summary for this resource.",
    );

    for (const file of [
      "Pages/Workflow/Logs.tsx",
      "Pages/Workflow/View/Logs.tsx",
    ]) {
      expect(readDashboard(file)).not.toContain(
        "Here is what happened when this workflow ran.",
      );
    }
  });
});

describe("a Name field's placeholder names its own resource", () => {
  test("a workflow's name, not a status page's", () => {
    const source: string = readDashboard("Pages/Workflow/View/Index.tsx");

    expect(source).toContain('placeholder: "Workflow Name"');
    expect(source).not.toContain("Status Page Name");
    expectTranslatedEverywhere("Workflow Name");
  });

  test("a monitor group's name, not a monitor's", () => {
    const source: string = readDashboard(
      "Pages/MonitorGroup/MonitorGroups.tsx",
    );

    expect(source).toContain('placeholder: "Monitor Group Name"');
    expect(source).not.toContain('placeholder: "Monitor Name"');
    expectTranslatedEverywhere("Monitor Group Name");
  });
});
