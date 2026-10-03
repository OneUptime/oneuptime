import AlertPrivacySwitchCopy, {
  ALERT_PRIVACY_SWITCH_COLUMN,
} from "../../FeatureSet/Dashboard/src/Components/Alert/AlertPrivacySwitchCopy";
import ReminderRuleScope from "../../FeatureSet/Dashboard/src/Components/Reminders/ReminderRuleScope";
import RemindersSwitchCopy, {
  REMINDERS_SWITCH_COLUMN,
  REMINDERS_SWITCH_SCOPE_COPY,
  RemindersSwitchScopeCopy,
} from "../../FeatureSet/Dashboard/src/Components/Reminders/RemindersSwitchCopy";
import RunbookSwitchCopy, {
  RUNBOOK_SWITCH_COLUMN,
} from "../../FeatureSet/Dashboard/src/Components/Runbook/RunbookSwitchCopy";
import SessionReplayAllowedSwitchCopy, {
  SESSION_REPLAY_ALLOWED_SWITCH_COLUMN,
} from "../../FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayAllowedSwitchCopy";
import SloEvaluationSwitchCopy, {
  SLO_EVALUATION_SWITCH_COLUMN,
} from "../../FeatureSet/Dashboard/src/Components/Slo/SloEvaluationSwitchCopy";
import StatusPageVisibilitySwitchCopy, {
  STATUS_PAGE_VISIBILITY_KIND_COPY,
  STATUS_PAGE_VISIBILITY_SWITCH_COLUMN,
  StatusPageVisibilityKind,
  StatusPageVisibilityKindCopy,
} from "../../FeatureSet/Dashboard/src/Components/StatusPageVisibility/StatusPageVisibilitySwitchCopy";
import Alert from "Common/Models/DatabaseModels/Alert";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import Project from "Common/Models/DatabaseModels/Project";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Reminders, privacy, status page visibility and on/off switches save the
 * moment they are flipped, on the incident, alert, episode, scheduled
 * maintenance, runbook, SLO and RUM pages.
 *
 * Nine cards there each held a single yes or no behind an Edit dialog,
 * under boilerplate such as "Manage settings for this alert here.". Each is
 * the shared ModelSwitchCard now (Common/UI/Components/ModelSwitch):
 *
 *   - Reminders on an incident, an alert and a maintenance event: "Send
 *     reminders", with Next Reminder In and Reminders Sent under it
 *     (RemindersCard);
 *   - an alert's "Who can see this alert": Private Alert, asking first;
 *   - an episode's and a maintenance event's Status Pages: Visible on
 *     Status Page;
 *   - a runbook's Execution: "Run this runbook";
 *   - an SLO's Evaluation: "Evaluate this SLO", asking before it turns
 *     evaluation off, with "Turn evaluation on" on the banner;
 *   - the project's session replay master switch, asking before it turns
 *     recording on.
 *
 * This holds the pages to that, so a page written later cannot quietly
 * bring an Edit dialog or the old wording back. The behaviour is tested in
 * Common/Tests (ModelSwitchCard, UseSaveModelSwitch, RemindersCard,
 * EventSettingsSwitchPages, SessionReplayAllowedCard, SloSettings,
 * SloNoticeBanner); the one-switch cards left elsewhere are listed in
 * Common/Tests/UI/Components/Forms/OneSwitchCardsGuard.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
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

// Source with comments dropped and whitespace collapsed.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\{\s*\}/g, "{}")
    .replace(/\s+/g, " ");
}

function readDashboard(relative: string): string {
  return readSource(path.join(DASHBOARD_SRC, relative));
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

function listSources(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "Locales") {
        found.push(...listSources(full));
      }
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

function columnDefault(model: BaseModel, column: string): unknown {
  const metadata: TableColumnMetadata = model.getTableColumnMetadata(column);
  return metadata.defaultValue;
}

describe("the Settings pages draw switches, not Edit dialogs", () => {
  test("an incident's reminders are the shared reminders switch; its two forms stay", () => {
    const page: string = readDashboard("Pages/Incidents/View/Settings.tsx");

    expect(page).toContain(
      "<RemindersCard scope={ReminderRuleScope.Incident} modelId={modelId} />",
    );
    expect(page).not.toContain('name="Reminders"');
    expect(page).not.toContain("NextReminderCountdown");
    // Visible on Status Page + renotify + Private, and the scope picker.
    expect(page).toContain('name="Incident Settings"');
    expect(page).toContain('name="Status Page Scope"');
    expect(page).toContain(
      'description: "Whether this incident shows on status pages, and who in the project can see it.",',
    );
  });

  test("an alert's Settings is its privacy switch, then its reminders", () => {
    const page: string = readDashboard("Pages/Alerts/View/Settings.tsx");

    expect(page).toContain(
      "<AlertPrivacyCard alertId={modelId} /> <RemindersCard scope={ReminderRuleScope.Alert} modelId={modelId} />",
    );
    expect(page).not.toContain("CardModelDetail");
  });

  test("an episode's Settings is its status page switch, no longer a checkbox", () => {
    const page: string = readDashboard(
      "Pages/Incidents/EpisodeView/Settings.tsx",
    );

    expect(page).toContain(
      "<StatusPageVisibilityCard kind={StatusPageVisibilityKind.IncidentEpisode} modelId={modelId} />",
    );
    expect(page).not.toContain("CardModelDetail");
    expect(page).not.toContain("Checkbox");
  });

  test("a maintenance event's Settings is its status page switch, then its reminders", () => {
    const page: string = readDashboard(
      "Pages/ScheduledMaintenanceEvents/View/Settings.tsx",
    );

    expect(page).toContain(
      "<StatusPageVisibilityCard kind={StatusPageVisibilityKind.ScheduledMaintenance} modelId={modelId} /> <RemindersCard scope={ReminderRuleScope.ScheduledMaintenance} modelId={modelId} />",
    );
    expect(page).not.toContain("CardModelDetail");
  });

  test("a runbook's Settings is one switch on isEnabled, with no Status pill", () => {
    const page: string = readDashboard("Pages/Runbook/View/Settings.tsx");

    expect(page).toContain("<ModelSwitchCard<Runbook>");
    expect(page).toContain("column={RUNBOOK_SWITCH_COLUMN}");
    expect(page).not.toContain("CardModelDetail");
    expect(page).not.toContain("Pill");
  });

  test("an SLO's Evaluation is the switch card, and nothing else writes isEnabled there", () => {
    const page: string = readDashboard("Pages/Slo/View/Settings.tsx");
    const fields: string = readDashboard("Pages/Slo/SloSettingsFormFields.ts");

    expect(page).toContain("<SloEvaluationCard sloId={modelId} />");
    expect(page).not.toContain('name="SLO Evaluation"');
    expect(page).not.toContain("getSloEvaluationSettingsFormFields");
    expect(fields).not.toContain("isEnabled");
  });

  test("the RUM Session Replay page opens on the project's master switch", () => {
    const page: string = readDashboard("Pages/Rum/Settings/SessionReplay.tsx");

    expect(page).toContain(
      "<SessionReplayAllowedCard projectId={ProjectUtil.getCurrentProjectId()!} />",
    );
    expect(page).not.toContain("CardModelDetail");
  });
});

describe("the switch cards", () => {
  test("Reminders is the shared switch card on enableReminders for all three, with lines under it", () => {
    const card: string = readDashboard(
      "Components/Reminders/RemindersCard.tsx",
    );

    expect(REMINDERS_SWITCH_COLUMN).toBe("enableReminders");

    for (const model of ["Alert", "ScheduledMaintenance", "Incident"]) {
      expect([model, card.includes(`<ModelSwitchCard<${model}>`)]).toEqual([
        model,
        true,
      ]);
    }

    expect(card.split("column={REMINDERS_SWITCH_COLUMN}").length - 1).toBe(3);
    expect(card.split("getDetails={").length - 1).toBe(3);
    expect(card).toContain("<NextReminderCountdown");
    expect(card).toContain(
      "nextReminderAt={ props.isOn ? props.facts.nextReminderNotificationAt : null }",
    );
    expect(card).toContain("remindersEnabled={props.isOn}");
  });

  test("Private Alert asks before it makes an alert private, never the other way", () => {
    const card: string = readDashboard("Components/Alert/AlertPrivacyCard.tsx");

    expect(ALERT_PRIVACY_SWITCH_COLUMN).toBe("isPrivate");
    expect(card).toContain("<ModelSwitchCard<Alert>");
    expect(card).toContain("getConfirmation={getMakeAlertPrivateConfirmation}");
    expect(card).toContain("if (!isTurningOn) { return undefined; }");
  });

  test("Visible on Status Page is the shared switch card for episodes and maintenance events", () => {
    const card: string = readDashboard(
      "Components/StatusPageVisibility/StatusPageVisibilityCard.tsx",
    );

    expect(STATUS_PAGE_VISIBILITY_SWITCH_COLUMN).toBe("isVisibleOnStatusPage");
    expect(card).toContain("<ModelSwitchCard<IncidentEpisode>");
    expect(card).toContain("<ModelSwitchCard<ScheduledMaintenance>");
    expect(card).not.toContain("getConfirmation");
  });

  test("Evaluate this SLO asks before it turns evaluation off, as a danger, with Last Evaluated under it", () => {
    const card: string = readDashboard("Components/Slo/SloEvaluationCard.tsx");

    expect(SLO_EVALUATION_SWITCH_COLUMN).toBe("isEnabled");
    expect(card).toContain("<ModelSwitchCard<ServiceLevelObjective>");
    expect(card).toContain(
      "getConfirmation={getTurnOffSloEvaluationConfirmation}",
    );
    expect(card).toContain("if (isTurningOn) { return undefined; }");
    expect(card).toContain("submitButtonType: ButtonStyleType.DANGER");
    expect(card).toContain("select={{ lastEvaluatedAt: true, }}");
  });

  test("the session replay master switch asks only before it turns recording on", () => {
    const card: string = readDashboard(
      "Components/SessionReplay/SessionReplayAllowedCard.tsx",
    );

    expect(SESSION_REPLAY_ALLOWED_SWITCH_COLUMN).toBe("isSessionReplayAllowed");
    expect(card).toContain("<ModelSwitchCard<Project>");
    expect(card).toContain(
      "getConfirmation={getAllowSessionReplayConfirmation}",
    );
    expect(card).toContain("if (!isTurningOn) { return undefined; }");
    expect(card).not.toContain("ButtonStyleType.DANGER");
  });

  test("the runbook switch writes isEnabled", () => {
    expect(RUNBOOK_SWITCH_COLUMN).toBe("isEnabled");
  });
});

describe("the SLO banner turns evaluation on where it says it is off", () => {
  const banner: string = readDashboard("Components/Slo/SloNoticeBanner.tsx");

  test("its button writes what the Evaluation switch writes, gated like it", () => {
    expect(banner).toContain(
      "useSaveModelSwitch<ServiceLevelObjective>({ modelType: ServiceLevelObjective, modelId: props.sloId, column: SLO_EVALUATION_SWITCH_COLUMN, value: true, })",
    );
    expect(banner).toContain("title={SloEvaluationSwitchCopy.turnOnButton}");
    expect(banner).toContain("onClick={turnEvaluationOn.save}");
    expect(banner).toContain("disabled={!turnEvaluationOn.gate.isAllowed}");
    expect(banner).toContain("tooltip={turnEvaluationOn.gate.disabledReason}");
  });

  test("it hears the switch, wherever it is flipped", () => {
    expect(banner).toContain("subscribeToModelSwitchSaved({");
    expect(banner).toContain("column: SLO_EVALUATION_SWITCH_COLUMN");
  });

  test("the overview's data hears it too, so the hero follows the banner's button", () => {
    const data: string = readDashboard("Components/Slo/useSloOverviewData.ts");

    expect(data).toContain(
      "subscribeToModelSwitchSaved({ modelType: ServiceLevelObjective, modelId: options.sloId, column: SLO_EVALUATION_SWITCH_COLUMN,",
    );
    expect(data).toContain("unsubscribeEvaluation();");
  });
});

describe("what the switches say", () => {
  const scopes: Array<ReminderRuleScope> = [
    ReminderRuleScope.Incident,
    ReminderRuleScope.Alert,
    ReminderRuleScope.ScheduledMaintenance,
  ];

  const kinds: Array<StatusPageVisibilityKind> = [
    StatusPageVisibilityKind.IncidentEpisode,
    StatusPageVisibilityKind.ScheduledMaintenance,
  ];

  test("the switches read on = it happens", () => {
    expect(RemindersSwitchCopy.switchTitle).toBe("Send reminders");
    expect(RunbookSwitchCopy.switchTitle).toBe("Run this runbook");
    expect(SloEvaluationSwitchCopy.switchTitle).toBe("Evaluate this SLO");
    expect(StatusPageVisibilitySwitchCopy.switchTitle).toBe(
      "Visible on Status Page",
    );
    expect(AlertPrivacySwitchCopy.switchTitle).toBe("Private Alert");

    for (const title of [
      RemindersSwitchCopy.switchTitle,
      RunbookSwitchCopy.switchTitle,
      SloEvaluationSwitchCopy.switchTitle,
      StatusPageVisibilitySwitchCopy.switchTitle,
    ]) {
      expect(title).not.toMatch(/enable|disable/i);
    }
  });

  test("Private Alert says who keeps access, and warns that whoever makes it private may lose it", () => {
    for (const sentence of [
      AlertPrivacySwitchCopy.switchOnDescription,
      AlertPrivacySwitchCopy.makePrivateConfirmDescription,
    ]) {
      expect(sentence).toContain("owner users");
      expect(sentence).toContain("owner teams");
      expect(sentence).toContain("project admins");
      expect(sentence).toContain("project owners");
    }

    expect(AlertPrivacySwitchCopy.makePrivateConfirmDescription).toContain(
      "lose access",
    );
  });

  test("hiding an episode or an event says its subscribers hear nothing either", () => {
    for (const kind of kinds) {
      const copy: StatusPageVisibilityKindCopy =
        STATUS_PAGE_VISIBILITY_KIND_COPY[kind];

      expect([kind, copy.switchOffDescription]).toEqual([
        kind,
        expect.stringContaining("subscribers are not notified"),
      ]);
    }
  });

  test("turning evaluation off says it resolves the open burn rate alerts and incidents", () => {
    expect(SloEvaluationSwitchCopy.turnOffConfirmDescription).toContain(
      "resolves the burn rate alerts and incidents it has open",
    );
  });

  test("the runbook switch keeps the old card's sentence: running executions are not stopped", () => {
    expect(RunbookSwitchCopy.switchOffDescription).toContain(
      "Executions already running are not stopped.",
    );
  });

  test("each switch starts where the column's default puts a new record", () => {
    // What a new record holds, which the switch shows before anyone flips it.
    expect(columnDefault(new Incident(), REMINDERS_SWITCH_COLUMN)).toBe(true);
    expect(columnDefault(new Alert(), REMINDERS_SWITCH_COLUMN)).toBe(true);
    expect(
      columnDefault(new ScheduledMaintenance(), REMINDERS_SWITCH_COLUMN),
    ).toBe(true);
    expect(columnDefault(new Alert(), ALERT_PRIVACY_SWITCH_COLUMN)).toBe(false);
    expect(
      columnDefault(
        new IncidentEpisode(),
        STATUS_PAGE_VISIBILITY_SWITCH_COLUMN,
      ),
    ).toBe(false);
    expect(
      columnDefault(
        new ScheduledMaintenance(),
        STATUS_PAGE_VISIBILITY_SWITCH_COLUMN,
      ),
    ).toBe(true);
    expect(columnDefault(new Runbook(), RUNBOOK_SWITCH_COLUMN)).toBe(true);
    expect(
      columnDefault(new ServiceLevelObjective(), SLO_EVALUATION_SWITCH_COLUMN),
    ).toBe(true);
    expect(
      columnDefault(new Project(), SESSION_REPLAY_ALLOWED_SWITCH_COLUMN),
    ).toBe(true);
  });

  test("every reminders scope has its own card line and its own two sentences", () => {
    const sentences: Array<string> = scopes.flatMap(
      (scope: ReminderRuleScope): Array<string> => {
        const copy: RemindersSwitchScopeCopy =
          REMINDERS_SWITCH_SCOPE_COPY[scope];
        return [
          copy.cardDescription,
          copy.switchOnDescription,
          copy.switchOffDescription,
        ];
      },
    );

    expect(new Set(sentences).size).toBe(sentences.length);
  });
});

describe("the old wording is gone from the dashboard", () => {
  const sources: Array<string> = listSources(DASHBOARD_SRC);

  test.each([
    "Edit Reminders",
    "Enable / Disable Runbook",
    "Edit Evaluation",
    "Manage settings for this incident here.",
    "Manage settings for this alert here.",
    "Manage settings for this episode here.",
    "Manage your scheduled maintenance event settings here.",
    "Control reminder notifications for this incident.",
    "Control reminder notifications for this alert.",
    "Control reminder notifications for this scheduled maintenance event.",
  ])("%s", (text: string) => {
    // In code: the comments that say what was replaced may name it.
    const using: Array<string> = sources
      .filter((file: string): boolean => {
        return readSource(file).includes(text);
      })
      .map((file: string): string => {
        return path.relative(DASHBOARD_SRC, file);
      });

    expect(using).toEqual([]);
  });
});

describe("translations", () => {
  const scopeSentences: Array<string> = [
    ReminderRuleScope.Incident,
    ReminderRuleScope.Alert,
    ReminderRuleScope.ScheduledMaintenance,
  ].flatMap((scope: ReminderRuleScope): Array<string> => {
    const copy: RemindersSwitchScopeCopy = REMINDERS_SWITCH_SCOPE_COPY[scope];
    return [
      copy.cardDescription,
      copy.switchOnDescription,
      copy.switchOffDescription,
    ];
  });

  const kindSentences: Array<string> = [
    StatusPageVisibilityKind.IncidentEpisode,
    StatusPageVisibilityKind.ScheduledMaintenance,
  ].flatMap((kind: StatusPageVisibilityKind): Array<string> => {
    const copy: StatusPageVisibilityKindCopy =
      STATUS_PAGE_VISIBILITY_KIND_COPY[kind];
    return [
      copy.cardDescription,
      copy.switchOnDescription,
      copy.switchOffDescription,
    ];
  });

  // New with this change: every locale has its own words for them.
  const strings: Array<string> = [
    RemindersSwitchCopy.switchTitle,
    ...scopeSentences,
    ...kindSentences,
    AlertPrivacySwitchCopy.cardTitle,
    AlertPrivacySwitchCopy.cardDescription,
    AlertPrivacySwitchCopy.switchOnDescription,
    AlertPrivacySwitchCopy.switchOffDescription,
    AlertPrivacySwitchCopy.makePrivateConfirmTitle,
    AlertPrivacySwitchCopy.makePrivateConfirmDescription,
    AlertPrivacySwitchCopy.makePrivateConfirmButton,
    RunbookSwitchCopy.cardTitle,
    RunbookSwitchCopy.cardDescription,
    RunbookSwitchCopy.switchTitle,
    RunbookSwitchCopy.switchOnDescription,
    RunbookSwitchCopy.switchOffDescription,
    SloEvaluationSwitchCopy.cardDescription,
    SloEvaluationSwitchCopy.switchTitle,
    SloEvaluationSwitchCopy.switchOnDescription,
    SloEvaluationSwitchCopy.switchOffDescription,
    SloEvaluationSwitchCopy.turnOffConfirmTitle,
    SloEvaluationSwitchCopy.turnOffConfirmDescription,
    SloEvaluationSwitchCopy.turnOffConfirmButton,
    SloEvaluationSwitchCopy.turnOnButton,
    SessionReplayAllowedSwitchCopy.allowConfirmTitle,
    SessionReplayAllowedSwitchCopy.allowConfirmDescription,
    SessionReplayAllowedSwitchCopy.allowConfirmButton,
    "Whether this incident shows on status pages, and who in the project can see it.",
  ];

  // Names and sentences every locale already had.
  const existing: Array<string> = [
    RemindersSwitchCopy.cardTitle,
    RemindersSwitchCopy.nextReminderTitle,
    RemindersSwitchCopy.remindersSentTitle,
    AlertPrivacySwitchCopy.switchTitle,
    StatusPageVisibilitySwitchCopy.cardTitle,
    StatusPageVisibilitySwitchCopy.switchTitle,
    SloEvaluationSwitchCopy.cardTitle,
    SloEvaluationSwitchCopy.lastEvaluatedTitle,
    SloEvaluationSwitchCopy.notEvaluatedYet,
    SloEvaluationSwitchCopy.notEvaluatedYetDescription,
    SessionReplayAllowedSwitchCopy.cardTitle,
    SessionReplayAllowedSwitchCopy.cardDescription,
    SessionReplayAllowedSwitchCopy.switchTitle,
    SessionReplayAllowedSwitchCopy.switchDescription,
  ];

  test("en.json maps every string to itself", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const text of [...strings, ...existing]) {
      expect([text, english[text]]).toEqual([text, text]);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s has its own words for every new string",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const text of strings) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
        expect([text, translations[text]]).not.toEqual([text, text]);
      }

      for (const text of existing) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
      }
    },
  );
});
