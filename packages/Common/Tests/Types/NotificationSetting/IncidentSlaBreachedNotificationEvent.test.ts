import { describe, expect, test } from "@jest/globals";
import RollupCategory, {
  getRollupCategory,
} from "../../../Types/NotificationSetting/NotificationEmailRollupCategory";
import {
  isRollupEligible,
  NEVER_ROLLED_UP_EVENT_TYPES,
  ROLLUP_ELIGIBLE_ON_CALL_ADMIN_EVENT_TYPES,
} from "../../../Types/NotificationSetting/NotificationEmailRollupPolicy";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import { ROUTINE_EMAIL_EVENT_TYPES } from "../../../Types/NotificationSetting/RoutineEmailEvents";
import { getWhatsAppTemplateIdForEventType } from "../../../Server/Utils/WhatsAppTemplateUtil";
import {
  WhatsAppTemplateIds,
  WhatsAppTemplateMessages,
} from "../../../Types/WhatsApp/WhatsAppTemplates";

/*
 * "Incident SLA breached": an incident SLA rule's deadline passed. It had no
 * event of its own and borrowed "Incident created" - so switching that off
 * silenced SLA breaches too, and its WhatsApp message said the incident
 * "has been created". Pinned here: the event, the heading its emails are
 * filed under, and the WhatsApp template it rides.
 */

const SLA_BREACHED: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION;

describe("the incident SLA breached notification event", () => {
  test("is stored under a value that can never be reworded", () => {
    // Stored in every user's notification setting rows.
    expect(SLA_BREACHED).toBe(
      "Send notification when an incident I own misses an SLA deadline",
    );
  });

  test("is an event apart from Incident created and the incident reminder", () => {
    expect(SLA_BREACHED).not.toBe(
      NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
    );
    expect(SLA_BREACHED).not.toBe(
      NotificationSettingEventType.SEND_INCIDENT_REMINDER_OWNER_NOTIFICATION,
    );
  });

  test("files its emails under Incidents", () => {
    expect(getRollupCategory(SLA_BREACHED)).toBe(RollupCategory.Incidents);
  });

  test("is never rolled up: a deadline that has already passed is never held back", () => {
    expect(NEVER_ROLLED_UP_EVENT_TYPES.has(SLA_BREACHED)).toBe(true);
    expect(isRollupEligible(SLA_BREACHED)).toBe(false);
    expect(ROLLUP_ELIGIBLE_ON_CALL_ADMIN_EVENT_TYPES.has(SLA_BREACHED)).toBe(
      false,
    );
  });

  test("is not routine: switching routine emails off keeps SLA breaches coming", () => {
    expect(ROUTINE_EMAIL_EVENT_TYPES).not.toContain(SLA_BREACHED);
  });

  /*
   * WhatsApp sends only templates Meta has approved. The breach rides the
   * approved "still open" reminder - true of a missed deadline - and never
   * again the "has been created" one.
   */
  test("rides the approved still-open reminder template on WhatsApp", () => {
    const templateId: string = getWhatsAppTemplateIdForEventType(SLA_BREACHED);

    expect(templateId).toBe(
      WhatsAppTemplateIds.IncidentReminderOwnerNotification,
    );
    expect(templateId).not.toBe(
      WhatsAppTemplateIds.IncidentCreatedOwnerNotification,
    );
    expect(
      WhatsAppTemplateMessages[
        WhatsAppTemplateIds.IncidentReminderOwnerNotification
      ],
    ).toContain("is still {{incident_state}}");
  });
});
