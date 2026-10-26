import IncidentSlaBreachNotice, {
  IncidentSlaBreachFacts,
  IncidentSlaBreachMessages,
} from "../../../../Server/Utils/Incident/IncidentSlaBreachNotice";
import { getWhatsAppTemplateIdForEventType } from "../../../../Server/Utils/WhatsAppTemplateUtil";
import Color from "../../../../Types/Color";
import OneUptimeDate from "../../../../Types/Date";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import NotificationSettingEventType from "../../../../Types/NotificationSetting/NotificationSettingEventType";
import Timezone from "../../../../Types/Timezone";
import { WhatsAppTemplateIds } from "../../../../Types/WhatsApp/WhatsAppTemplates";
import {
  buildNotificationSms,
  fitNotificationSmsForSending,
} from "../../../../Utils/Sms/NotificationSms";
import { countSmsSegments } from "../../../../Utils/Sms/SmsSegments";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT AN INCIDENT'S OWNERS ARE TOLD WHEN ITS SLA IS BREACHED
 * (IncidentSlaBreachNotice, sent by Workers IncidentSla/CheckSlaBreaches).
 *
 * The notice used to borrow the "incident created" event, email and
 * WhatsApp template: the email said "A new incident has been created" and
 * WhatsApp "has been created for project ...", and switching "Incident
 * created" off silenced breaches too. Pinned here: its own event, its own
 * email, and every channel saying which deadline was missed.
 */

const NOW: Date = new Date("2026-10-26T12:00:00.000Z");
const DEADLINE: Date = new Date("2026-10-26T11:59:00.000Z");
const DECLARED: Date = new Date("2026-10-26T09:30:00.000Z");
const LINK: string =
  "https://oneuptime.com/dashboard/7f7f0000-0000-4000-8000-000000000001/incidents/7f7f0000-0000-4000-8000-000000000002";

const facts: (
  overrides?: Partial<IncidentSlaBreachFacts>,
) => IncidentSlaBreachFacts = (
  overrides?: Partial<IncidentSlaBreachFacts>,
): IncidentSlaBreachFacts => {
  return {
    breachType: "resolution",
    deadline: DEADLINE,
    slaRuleName: "P1 customer SLA",
    incidentTitle: "Checkout API is down",
    incidentNumber: 42,
    incidentNumberWithPrefix: "INC-42",
    projectName: "Acme Prod",
    currentStateName: "Investigating",
    currentStateColor: new Color("#f59e0b"),
    severityName: "Critical",
    severityColor: new Color("#dc2626"),
    openedAt: DECLARED,
    incidentViewLink: LINK,
    now: NOW,
    ...overrides,
  };
};

const messagesFor: (
  overrides?: Partial<IncidentSlaBreachFacts>,
  recipient?: { timezone?: Timezone; isOwner?: boolean },
) => IncidentSlaBreachMessages = (
  overrides?: Partial<IncidentSlaBreachFacts>,
  recipient?: { timezone?: Timezone; isOwner?: boolean },
): IncidentSlaBreachMessages => {
  return IncidentSlaBreachNotice.getMessages({
    facts: facts(overrides),
    recipient: {
      timezone: recipient?.timezone,
      isOwner: recipient?.isOwner ?? true,
    },
  });
};

describe("IncidentSlaBreachNotice", () => {
  test("goes out under its own event, never the incident created one", () => {
    const messages: IncidentSlaBreachMessages = messagesFor();

    expect(messages.eventType).toBe(
      NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION,
    );
    expect(messages.eventType).not.toBe(
      NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
    );
    expect(IncidentSlaBreachNotice.EVENT_TYPE).toBe(messages.eventType);
  });

  describe("the email", () => {
    test("is its own template, with a subject that says which deadline was missed", () => {
      const messages: IncidentSlaBreachMessages = messagesFor();

      expect(messages.emailEnvelope.templateType).toBe(
        EmailTemplateType.IncidentOwnerSlaBreached,
      );
      expect(messages.emailEnvelope.subject).toBe(
        "[SLA breached] Incident INC-42 missed its resolution deadline - Checkout API is down",
      );
      // A title is a person's text: the subject is never read as a template.
      expect(messages.emailEnvelope.isSubjectLiteral).toBe(true);
    });

    test("hands the template what happened, as plain values", () => {
      const vars: Record<string, unknown> = messagesFor().emailEnvelope
        .vars as Record<string, unknown>;

      expect(vars).toMatchObject({
        incidentTitle: "Checkout API is down",
        incidentNumber: "INC-42",
        projectName: "Acme Prod",
        breachType: "Resolution",
        breachSentence:
          "This incident was not resolved before its SLA resolution deadline.",
        slaRuleName: "P1 customer SLA",
        currentState: "Investigating",
        incidentSeverity: "Critical",
        openDuration: "2 hours, 30 minutes",
        incidentViewLink: LINK,
        isOwner: "true",
      });
      // Severity and state are drawn in their colours, as in the other emails.
      expect(vars["currentStateColor"]).toBeTruthy();
      expect(vars["incidentSeverityColor"]).toBeTruthy();
    });

    test("a response deadline says nobody acknowledged it", () => {
      const messages: IncidentSlaBreachMessages = messagesFor({
        breachType: "response",
      });
      const vars: Record<string, unknown> = messages.emailEnvelope
        .vars as Record<string, unknown>;

      expect(vars["breachType"]).toBe("Response");
      expect(vars["breachSentence"]).toBe(
        "Nobody acknowledged this incident before its SLA response deadline.",
      );
      expect(messages.emailEnvelope.subject).toBe(
        "[SLA breached] Incident INC-42 missed its response deadline - Checkout API is down",
      );
    });

    test("writes the deadline in the reader's own time zone", () => {
      const inBerlin: string = (
        messagesFor(undefined, { timezone: Timezone.EuropeBerlin })
          .emailEnvelope.vars as Record<string, string>
      )["deadline"]!;

      expect(inBerlin).toBe(
        OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
          date: DEADLINE,
          timezones: [Timezone.EuropeBerlin],
        }),
      );
      expect(inBerlin).not.toBe(
        (messagesFor().emailEnvelope.vars as Record<string, string>)[
          "deadline"
        ],
      );
    });

    test("tells a project owner why it came: the incident has no owners", () => {
      const vars: Record<string, unknown> = messagesFor(undefined, {
        isOwner: false,
      }).emailEnvelope.vars as Record<string, unknown>;

      expect(vars["isOwner"]).toBeUndefined();
    });

    test("without a deadline or a rule name, those rows are left empty - never 'undefined'", () => {
      const vars: Record<string, unknown> = messagesFor({
        deadline: undefined,
        slaRuleName: undefined,
        openedAt: undefined,
      }).emailEnvelope.vars as Record<string, unknown>;

      expect(vars["deadline"]).toBe("");
      expect(vars["slaRuleName"]).toBe("");
      expect(vars["openDuration"]).toBe("");
      expect(JSON.stringify(vars)).not.toContain("undefined");
    });
  });

  describe("the SMS", () => {
    test("says which deadline the incident missed, in the words of every notification SMS", () => {
      expect(messagesFor().smsMessage.message).toBe(
        buildNotificationSms(
          "Incident INC-42 (Checkout API is down) missed its SLA resolution deadline.",
        ),
      );
      expect(messagesFor({ breachType: "response" }).smsMessage.message).toBe(
        buildNotificationSms(
          "Incident INC-42 (Checkout API is down) missed its SLA response deadline.",
        ),
      );
    });

    test("fits one part as it goes out", () => {
      const sent: string = fitNotificationSmsForSending(
        messagesFor().smsMessage.message!,
      );

      expect(countSmsSegments(sent).segments).toBe(1);
    });

    test("an incident without a prefix is #42, and one without a number is its title", () => {
      expect(
        messagesFor({ incidentNumberWithPrefix: undefined }).smsMessage.message,
      ).toContain("Incident #42 (Checkout API is down) missed");
      expect(
        messagesFor({
          incidentNumberWithPrefix: undefined,
          incidentNumber: undefined,
        }).smsMessage.message,
      ).toContain("Incident Checkout API is down missed");
    });
  });

  test("the call says it out loud and how to end", () => {
    expect(messagesFor().callRequestMessage.data).toEqual([
      {
        sayMessage:
          "This is a message from OneUptime. Incident Checkout API is down missed its SLA resolution deadline. Please check the incident in the OneUptime Dashboard. Good bye.",
      },
    ]);
  });

  test("the push names the incident and opens it", () => {
    const push: IncidentSlaBreachMessages["pushNotificationMessage"] =
      messagesFor().pushNotificationMessage;

    expect(push.title).toBe("SLA breached: Incident INC-42");
    expect(push.body).toBe(
      "Checkout API is down missed its resolution deadline.",
    );
    expect(push.clickAction).toBe(LINK);
    expect(push.tag).toBe(IncidentSlaBreachNotice.PUSH_TAG);
    expect(push.requireInteraction).toBe(true);
  });

  describe("WhatsApp", () => {
    /*
     * WhatsApp sends only templates Meta has approved: the breach rides the
     * approved "still open" reminder, which is true of a missed deadline -
     * never the "has been created" one it had borrowed.
     */
    test("rides the approved still-open reminder template", () => {
      const whatsApp: IncidentSlaBreachMessages["whatsAppMessage"] =
        messagesFor().whatsAppMessage;

      expect(whatsApp.templateKey).toBe(
        WhatsAppTemplateIds.IncidentReminderOwnerNotification,
      );
      expect(
        getWhatsAppTemplateIdForEventType(
          NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION,
        ),
      ).toBe(WhatsAppTemplateIds.IncidentReminderOwnerNotification);
      expect(whatsApp.body).toBe(
        `Reminder: Incident #42 (Checkout API is down) is still Investigating and has been open for 2 hours, 30 minutes. Review the incident using ${LINK} on the OneUptime dashboard.`,
      );
      expect(whatsApp.body).not.toContain("has been created");
    });

    test("an incident opened moments ago still says how long", () => {
      const whatsApp: IncidentSlaBreachMessages["whatsAppMessage"] =
        messagesFor({ openedAt: NOW }).whatsAppMessage;

      expect(whatsApp.templateVariables?.["elapsed_time"]).toBe(
        "less than a minute",
      );
    });

    test("a state with no name reads Open", () => {
      expect(
        messagesFor({ currentStateName: undefined }).whatsAppMessage
          .templateVariables?.["incident_state"],
      ).toBe("Open");
    });
  });

  test("a title with Markdown, HTML or template syntax is carried as written: the template escapes it", () => {
    const title: string = '<b>Down</b> & "{{project}}" *now*';
    const messages: IncidentSlaBreachMessages = messagesFor({
      incidentTitle: title,
    });

    expect(
      (messages.emailEnvelope.vars as Record<string, string>)["incidentTitle"],
    ).toBe(title);
    expect(messages.emailEnvelope.subject).toContain(title);
    expect(messages.emailEnvelope.isSubjectLiteral).toBe(true);
  });
});
