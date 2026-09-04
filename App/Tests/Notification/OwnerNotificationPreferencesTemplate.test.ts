import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { beforeAll, describe, expect, test } from "@jest/globals";

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);
const handlebars: typeof Handlebars = Handlebars.create();
const PREFERENCES_URL: string =
  "https://oneuptime.example.com/dashboard/11111111-1111-4111-8111-111111111111/user-settings/notification-settings";
const FALLBACK: string =
  "Dashboard > More > User Settings > Notification Settings";

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
      expect(html).toContain(
        "Choose which notifications you receive and how emails are grouped in this project.",
      );
      expect(html).not.toContain(FALLBACK);
    },
  );

  test.each<Record<string, string>>([{}, { notificationPreferencesUrl: "" }])(
    "keeps useful directions when no URL is provided: %j",
    (vars: Record<string, string>) => {
      const html: string = render("Partials/UnsubscribeOwnerEmail.hbs", vars);

      expect(html).toContain(FALLBACK);
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
