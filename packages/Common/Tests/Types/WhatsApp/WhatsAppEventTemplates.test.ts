import { describe, expect, test } from "@jest/globals";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import WhatsAppTemplateMessages, {
  WhatsAppTemplateId,
  WhatsAppTemplateIds,
  WhatsAppTemplateLanguage,
} from "../../../Types/WhatsApp/WhatsAppTemplates";
import {
  WHATSAPP_TEMPLATE_BY_EVENT_TYPE,
  getWhatsAppTemplateIdOfEvent,
  hasWhatsAppTemplate,
  isNotificationChannelOfferedForEvent,
} from "../../../Types/WhatsApp/WhatsAppEventTemplates";
import {
  createWhatsAppMessageFromTemplate,
  getWhatsAppTemplateIdForEventType,
} from "../../../Server/Utils/WhatsAppTemplateUtil";

/*
 * WHICH NOTIFICATION SETTINGS WHATSAPP CAN SEND (#9715).
 *
 * WhatsApp delivers only messages made from a template Meta has approved.
 * Notification Settings offered a WhatsApp switch for every event, and for
 * 24 of them nothing could be sent: four senders handed over a plain body,
 * which the notification service refused (a failed WhatsApp log each time),
 * and the rest handed over nothing. One map now says which events WhatsApp
 * can send, and through which approved template; the senders build their
 * messages from it and the page offers WhatsApp from it.
 */

const E: typeof NotificationSettingEventType = NotificationSettingEventType;

// Every event the issue named, with the seven owner-added events #9731 added to it.
const NO_APPROVED_TEMPLATE: ReadonlyArray<NotificationSettingEventType> = [
  E.SEND_SLO_OWNER_STATUS_CHANGE_NOTIFICATION,
  E.SEND_SLO_OWNER_ADDED_NOTIFICATION,
  E.SEND_DATA_ASSET_OWNER_ADDED_NOTIFICATION,
  E.SEND_DATA_PIPELINE_OWNER_ADDED_NOTIFICATION,
  E.SEND_DATA_STORE_OWNER_ADDED_NOTIFICATION,
  E.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION,
  E.SEND_EXCEPTION_ASSIGNED_NOTIFICATION,
  E.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
  E.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
  E.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
  E.SEND_SECURITY_CASE_TARGET_NOTIFICATION,
  E.SEND_SECURITY_CASE_TASK_ASSIGNED_NOTIFICATION,
  E.SEND_SECURITY_HUNT_FOUND_NOTIFICATION,
  E.SEND_PUBLIC_NOTE_APPROVAL_REQUESTED_NOTIFICATION,
  E.SEND_PUBLIC_NOTE_APPROVAL_DECIDED_NOTIFICATION,
  E.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
  E.SEND_SERVICE_OR_INFRASTRUCTURE_OWNER_ADDED_NOTIFICATION,
  E.SEND_DASHBOARD_OWNER_ADDED_NOTIFICATION,
  E.SEND_WORKFLOW_OWNER_ADDED_NOTIFICATION,
  E.SEND_RUNBOOK_OWNER_ADDED_NOTIFICATION,
  E.SEND_ON_CALL_POLICY_OWNER_ADDED_NOTIFICATION,
  E.SEND_ON_CALL_SCHEDULE_OWNER_ADDED_NOTIFICATION,
  E.SEND_INCOMING_CALL_POLICY_OWNER_ADDED_NOTIFICATION,
  // And the monitor group's and the Runner's new owners (#9758).
  E.SEND_MONITOR_GROUP_OWNER_ADDED_NOTIFICATION,
  E.SEND_RUNNER_OWNER_ADDED_NOTIFICATION,
];

const EVERY_EVENT: Array<NotificationSettingEventType> = Object.values(
  NotificationSettingEventType,
);

const CHANNELS: ReadonlyArray<string> = [
  "alertByEmail",
  "alertBySMS",
  "alertByCall",
  "alertByPush",
  "alertByWhatsApp",
  "alertByTelegram",
  "alertBySlack",
  "alertByMicrosoftTeams",
  "alertByMattermost",
  "alertByWebhook",
  "alertByCustomChannel",
];

describe("the events WhatsApp can send", () => {
  test("are every event but those with no approved template", () => {
    const withTemplate: Array<NotificationSettingEventType> =
      EVERY_EVENT.filter(hasWhatsAppTemplate);

    expect([...withTemplate].sort()).toEqual(
      EVERY_EVENT.filter((eventType: NotificationSettingEventType): boolean => {
        return !NO_APPROVED_TEMPLATE.includes(eventType);
      }).sort(),
    );
    expect(withTemplate.length + NO_APPROVED_TEMPLATE.length).toBe(
      EVERY_EVENT.length,
    );
  });

  test.each(NO_APPROVED_TEMPLATE)(
    "%s has none: it is never sent on WhatsApp",
    (eventType: NotificationSettingEventType) => {
      expect(hasWhatsAppTemplate(eventType)).toBe(false);
      expect(getWhatsAppTemplateIdOfEvent(eventType)).toBeNull();
      expect(WHATSAPP_TEMPLATE_BY_EVENT_TYPE[eventType]).toBeUndefined();
      // The senders' builder refuses it, so no sender can hand one over.
      expect(() => {
        return createWhatsAppMessageFromTemplate({ eventType: eventType });
      }).toThrow("WhatsApp template is not defined for event type");
    },
  );

  test.each(
    EVERY_EVENT.filter((eventType: NotificationSettingEventType): boolean => {
      return hasWhatsAppTemplate(eventType);
    }),
  )(
    "%s goes through a template the code knows, in a language it names",
    (eventType: NotificationSettingEventType) => {
      const templateId: WhatsAppTemplateId =
        getWhatsAppTemplateIdOfEvent(eventType)!;

      expect(Object.values(WhatsAppTemplateIds)).toContain(templateId);
      expect(WhatsAppTemplateMessages[templateId]).toBeTruthy();
      expect(WhatsAppTemplateLanguage[templateId]).toBe("en");
      // The server reads the same map.
      expect(getWhatsAppTemplateIdForEventType(eventType)).toBe(templateId);
    },
  );

  test("a reminder that a shift starts soon goes through the approved 'you are next on-call' template", () => {
    expect(
      getWhatsAppTemplateIdOfEvent(E.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS),
    ).toBe(WhatsAppTemplateIds.OnCallUserIsNextNotification);
  });

  test("an SLA breach goes through the approved 'still open' reminder", () => {
    expect(
      getWhatsAppTemplateIdOfEvent(
        E.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION,
      ),
    ).toBe(WhatsAppTemplateIds.IncidentReminderOwnerNotification);
  });

  test("the map cannot be changed at run time", () => {
    expect(Object.isFrozen(WHATSAPP_TEMPLATE_BY_EVENT_TYPE)).toBe(true);
  });

  test("names only real events", () => {
    for (const eventType of Object.keys(WHATSAPP_TEMPLATE_BY_EVENT_TYPE)) {
      expect(EVERY_EVENT).toContain(eventType);
    }
  });

  test("is never a verification code or a test message, which no notification setting sends", () => {
    const used: Array<WhatsAppTemplateId> = Object.values(
      WHATSAPP_TEMPLATE_BY_EVENT_TYPE,
    ) as Array<WhatsAppTemplateId>;

    expect(used).not.toContain(WhatsAppTemplateIds.VerificationCode);
    expect(used).not.toContain(WhatsAppTemplateIds.TestNotification);
  });
});

describe("whether a channel is offered for an event", () => {
  test.each(CHANNELS.filter((channel: string): boolean => {
    return channel !== "alertByWhatsApp";
  }))("%s is offered for every event", (channel: string) => {
    for (const eventType of EVERY_EVENT) {
      expect(
        isNotificationChannelOfferedForEvent({
          channel: channel,
          eventType: eventType,
        }),
      ).toBe(true);
    }
  });

  test("WhatsApp is offered exactly for the events it has an approved template for", () => {
    for (const eventType of EVERY_EVENT) {
      expect({
        eventType,
        offered: isNotificationChannelOfferedForEvent({
          channel: "alertByWhatsApp",
          eventType: eventType,
        }),
      }).toEqual({ eventType, offered: hasWhatsAppTemplate(eventType) });
    }
  });
});
