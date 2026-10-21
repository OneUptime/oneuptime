import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  SettingsMenuSection,
  SettingsMenus,
  WrittenPath,
  readableText,
  settingsMenus,
  writtenPaths,
} from "../Dashboard/SettingsMenuPaths";
import {
  readCommonSource,
  readDashboardSource,
} from "../FeatureSet/Docs/DocsDashboardMenus";

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);
const handlebars: typeof Handlebars = Handlebars.create();
const PREFERENCES_URL: string =
  "https://oneuptime.example.com/dashboard/11111111-1111-4111-8111-111111111111/user-settings/notification-settings";
const FALLBACK: string = "Dashboard > User Settings > Notification Settings";

function readTemplate(name: string): string {
  return fs.readFileSync(Path.join(TEMPLATES_DIR, name), "utf8");
}

function render(name: string, vars: Record<string, string> = {}): string {
  return handlebars.compile(readTemplate(name))({
    homeURL: "https://oneuptime.example.com",
    year: "2026",
    incidentTitle: "Checkout unavailable",
    alertTitle: "High latency",
    statusPageName: "Customer status",
    statusPageViewLink:
      "https://oneuptime.example.com/dashboard/project/status-pages/page",
    unsubscribeUrl: "https://status.example.com/manage-subscription/recipient",
    ...vars,
  });
}

const ownerTemplates: Array<EmailTemplateType> = [
  EmailTemplateType.AIAgentOwnerAdded,
  EmailTemplateType.ProbeOwnerAdded,
  EmailTemplateType.MonitorOwnerAdded,
  EmailTemplateType.IncidentOwnerAdded,
  EmailTemplateType.IncidentMemberAdded,
  EmailTemplateType.AlertOwnerAdded,
  EmailTemplateType.AlertEpisodeOwnerAdded,
  EmailTemplateType.IncidentEpisodeOwnerAdded,
  EmailTemplateType.ScheduledMaintenanceOwnerAdded,
  EmailTemplateType.AIAgentConnectionStatusChange,
  EmailTemplateType.AlertEpisodeOwnerAlertAdded,
  EmailTemplateType.AlertEpisodeOwnerNotePosted,
  EmailTemplateType.AlertEpisodeOwnerResourceCreated,
  EmailTemplateType.AlertEpisodeOwnerStateChanged,
  EmailTemplateType.AlertOwnerNotePosted,
  EmailTemplateType.AlertOwnerResourceCreated,
  EmailTemplateType.AlertOwnerStateChanged,
  EmailTemplateType.AlertOwnerUnresolvedReminder,
  EmailTemplateType.IncidentEpisodeOwnerIncidentAdded,
  EmailTemplateType.IncidentEpisodeOwnerNotePosted,
  EmailTemplateType.IncidentEpisodeOwnerResourceCreated,
  EmailTemplateType.IncidentEpisodeOwnerStateChanged,
  EmailTemplateType.IncidentOwnerNotePosted,
  EmailTemplateType.IncidentOwnerResourceCreated,
  EmailTemplateType.IncidentOwnerStateChanged,
  EmailTemplateType.IncidentOwnerUnresolvedReminder,
  EmailTemplateType.MonitorOwnerResourceCreated,
  EmailTemplateType.MonitorOwnerStatusChanged,
  EmailTemplateType.MonitorProbesStatus,
  EmailTemplateType.MonitorsAffectedByProbeStatus,
  EmailTemplateType.ProbeConnectionStatusChange,
  EmailTemplateType.ScheduledMaintenanceOwnerNotePosted,
  EmailTemplateType.ScheduledMaintenanceOwnerResourceCreated,
  EmailTemplateType.ScheduledMaintenanceOwnerStateChanged,
  EmailTemplateType.ScheduledMaintenanceOwnerUnresolvedReminder,
  EmailTemplateType.SloOwnerStatusChanged,
  EmailTemplateType.StatusPageOwnerAdded,
  EmailTemplateType.StatusPageOwnerAnnouncementPosted,
  EmailTemplateType.StatusPageOwnerResourceCreated,
  EmailTemplateType.UserAddedToOnCallPolicy,
  EmailTemplateType.UserCurrentlyOnOnCallRoster,
  EmailTemplateType.UserNextOnOnCallRoster,
  EmailTemplateType.UserNoLongerActiveOnOnCallRoster,
  EmailTemplateType.UserOnCallShiftReassigned,
  EmailTemplateType.UserOnCallShiftReminder,
  EmailTemplateType.UserRemovedFromOnCallPolicy,
  EmailTemplateType.SecurityCaseOpened,
  EmailTemplateType.SecurityCaseAssigned,
  EmailTemplateType.SecurityPlaybookApprovalRequested,
];

beforeAll(() => {
  const partialsDir: string = Path.join(TEMPLATES_DIR, "Partials");
  for (const name of fs.readdirSync(partialsDir)) {
    if (name.endsWith(".hbs")) {
      handlebars.registerPartial(
        name.slice(0, -4),
        fs.readFileSync(Path.join(partialsDir, name), "utf8"),
      );
    }
  }

  handlebars.registerHelper(
    "concat",
    (first: string, second: string): string => {
      return first + second;
    },
  );
  handlebars.registerHelper(
    "ifCond",
    function (
      this: unknown,
      first: unknown,
      second: unknown,
      options: Handlebars.HelperOptions,
    ): string {
      return first === second ? options.fn(this) : options.inverse(this);
    },
  );
  handlebars.registerHelper(
    "ifNotCond",
    function (
      this: unknown,
      first: unknown,
      second: unknown,
      options: Handlebars.HelperOptions,
    ): string {
      return first !== second ? options.fn(this) : options.inverse(this);
    },
  );
});

describe("owner notification preferences footer", () => {
  test.each(ownerTemplates)(
    "%s has one direct preferences link",
    (name: string) => {
      const html: string = render(name, {
        notificationPreferencesUrl: PREFERENCES_URL,
      });

      expect(html).toContain(`href="${PREFERENCES_URL}"`);
      expect(html.match(/Manage notification preferences/g)).toHaveLength(1);
      /*
       * One link, one promise. The sentence used to offer grouping as well,
       * which stopped being true when the rollup switch moved to Email
       * Preferences and this link stayed on Notification Settings.
       */
      expect(html).toContain(
        "Choose which notifications you receive in this project.",
      );
      expect(html).not.toContain("how emails are grouped");
      expect(html).not.toContain(Handlebars.escapeExpression(FALLBACK));
    },
  );

  test.each<Record<string, string>>([{}, { notificationPreferencesUrl: "" }])(
    "keeps useful directions when no URL is provided: %j",
    (vars: Record<string, string>) => {
      const html: string = render("Partials/UnsubscribeOwnerEmail.hbs", vars);

      expect(html).toContain(Handlebars.escapeExpression(FALLBACK));
      expect(html).toContain("choose which notification emails you receive");
      expect(html).not.toContain("href=");
      expect(html).not.toContain("Manage notification preferences");
    },
  );

  test("escapes the URL once inside a quoted href", () => {
    const url: string = `${PREFERENCES_URL}?source=email&label="preferences"`;
    const html: string = render("Partials/UnsubscribeOwnerEmail.hbs", {
      notificationPreferencesUrl: url,
    });

    expect(html).toContain(`href="${Handlebars.escapeExpression(url)}"`);
    expect(html).not.toContain(`href="${url}"`);
    expect(html).not.toContain("&amp;quot;");
  });

  test.each([
    EmailTemplateType.AcknowledgeIncident,
    EmailTemplateType.AcknowledgeAlert,
    EmailTemplateType.AcknowledgeIncidentEpisode,
    EmailTemplateType.AcknowledgeAlertEpisode,
    EmailTemplateType.VerificationCode,
    EmailTemplateType.ForgotPassword,
    EmailTemplateType.PasswordChanged,
    EmailTemplateType.Invoice,
    EmailTemplateType.ProjectSubscriptionOverdue,
    EmailTemplateType.SubscriberIncidentCreated,
    EmailTemplateType.SubscribedToStatusPage,
    EmailTemplateType.ConfirmStatusPageSubscription,
    EmailTemplateType.NotificationRollup,
  ])(
    "does not alter the separate settings or actions in %s",
    (name: EmailTemplateType) => {
      const original: string = render(name);
      const withOwnerPreferences: string = render(name, {
        notificationPreferencesUrl: PREFERENCES_URL,
      });

      expect(withOwnerPreferences).toBe(original);
      expect(withOwnerPreferences).not.toContain(PREFERENCES_URL);
    },
  );
});

/*
 * Without a link (the server could not tell the Dashboard's address), the
 * footer says where to go in words. They said "Dashboard > More > User
 * Settings > Notification Settings" long after User Settings moved onto the
 * bar and the More menu became Products. They are held here to the menus as
 * the Dashboard draws them (SettingsMenuPaths), and to the page the link
 * opens.
 */
describe("the footer's directions without a link", () => {
  const menus: SettingsMenus = settingsMenus();

  function directions(vars: Record<string, unknown> = {}): string {
    return handlebars.compile(
      readTemplate("Partials/UnsubscribeOwnerEmail.hbs"),
    )(vars);
  }

  test("walk the real menus: User Settings on the bar, then Notification Settings", () => {
    const paths: Array<WrittenPath> = writtenPaths(directions(), menus);

    expect(
      paths.map((written: WrittenPath): Array<string> => {
        return [written.menu, ...written.steps];
      }),
    ).toEqual([["User Settings", "Notification Settings"]]);
    expect(paths[0]?.problems).toEqual([]);
    expect(readableText(directions())).toContain(
      "Go to OneUptime Dashboard > User Settings > Notification Settings to choose which notification emails you receive.",
    );
  });

  test("name no section: Notification Settings is in one that starts open", () => {
    const home: SettingsMenuSection | undefined =
      menus.userSettings.sections.find(
        (section: SettingsMenuSection): boolean => {
          return section.items.includes("Notification Settings");
        },
      );

    expect(home?.title).toBe("Alerts & Notifications");
    expect(home?.folded).toBe(false);
    expect(readableText(directions())).not.toContain(home?.title);
  });

  test("put nothing between the Dashboard and User Settings: no More menu", () => {
    const text: string = readableText(directions());

    expect(text).not.toContain("More");
    expect(text).toContain("Dashboard > User Settings");
    expect(
      writtenPaths(
        "Go to OneUptime Dashboard &gt; More &gt; User Settings &gt; Notification Settings to choose which notification emails you receive.",
        menus,
      )[0]?.problems,
    ).toEqual(['puts "More" before User Settings, which is on the bar itself']);
  });

  test("name the page the link opens, which the side menu's entry opens too", () => {
    const routes: string = readDashboardSource("Utils/RouteMap.ts");
    const menu: string = readDashboardSource("Pages/UserSettings/SideMenu.tsx");
    const entry: string = menu.slice(
      menu.indexOf('title: "Notification Settings"'),
      menu.indexOf("icon:", menu.indexOf('title: "Notification Settings"')),
    );

    expect(routes).toContain(
      '[PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS]: "notification-settings"',
    );
    expect(routes).toContain("/user-settings/*");
    expect(entry).toContain("PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS");
    expect(
      readCommonSource("Server/Services/UserNotificationSettingService.ts"),
    ).toContain("/user-settings/notification-settings");
    expect(new URL(PREFERENCES_URL).pathname.split("/").slice(-2)).toEqual([
      "user-settings",
      "notification-settings",
    ]);
  });

  test.each([
    ["Acme Watch", "Acme Watch"],
    ["Acme & Partners", Handlebars.escapeExpression("Acme & Partners")],
  ])(
    "an installation that goes by %s names its own Dashboard",
    (productName: string, written: string) => {
      const html: string = directions({
        isBrandRenamed: true,
        brandProductName: productName,
      });

      expect(html).toContain(
        `Go to ${written} Dashboard &gt; User Settings &gt; Notification Settings`,
      );
      expect(html).not.toContain("OneUptime");
      expect(writtenPaths(html, menus)[0]?.problems).toEqual([]);
    },
  );
});
