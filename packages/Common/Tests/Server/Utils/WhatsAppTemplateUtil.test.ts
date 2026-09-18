import {
  appendRecipientToWhatsAppMessage,
  createWhatsAppMessageFromTemplate,
  getWhatsAppTemplateIdForEventType,
  getWhatsAppTemplateStringForEventType,
} from "../../../Server/Utils/WhatsAppTemplateUtil";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import Phone from "../../../Types/Phone";
import WhatsAppMessage, {
  WhatsAppMessagePayload,
} from "../../../Types/WhatsApp/WhatsAppMessage";
import {
  WhatsAppTemplateIds,
  WhatsAppTemplateMessages,
} from "../../../Types/WhatsApp/WhatsAppTemplates";
import { describe, expect, test } from "@jest/globals";

/*
 * WhatsAppTemplateUtil turns an event type + variables into a rendered
 * WhatsApp template payload. The two behaviors most worth guarding:
 *
 *   1. Variable substitution is strict — a missing {{var}} throws rather than
 *      silently shipping a broken "{{alert_link}}" literal to a customer.
 *   2. The dashboard-link injection defaults the template's link variable to
 *      the action link (or the hard-coded dashboard URL) when the caller does
 *      not supply one, so link-bearing templates never render an empty URL.
 */

describe("getWhatsAppTemplateIdForEventType", () => {
  test("maps a known event type to its template id", () => {
    expect(
      getWhatsAppTemplateIdForEventType(
        NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
      ),
    ).toBe(WhatsAppTemplateIds.IncidentCreatedOwnerNotification);
  });

  test("throws for an event type that has no WhatsApp template", () => {
    expect(() => {
      return getWhatsAppTemplateIdForEventType(
        "not-a-real-event" as unknown as NotificationSettingEventType,
      );
    }).toThrow("WhatsApp template is not defined for event type");
  });
});

describe("getWhatsAppTemplateStringForEventType", () => {
  test("returns the template content string for a known event type", () => {
    const content: string = getWhatsAppTemplateStringForEventType(
      NotificationSettingEventType.SEND_MONITOR_CREATED_OWNER_NOTIFICATION,
    );

    expect(content).toBe(
      WhatsAppTemplateMessages[
        WhatsAppTemplateIds.MonitorCreatedOwnerNotification
      ],
    );
    expect(content).toContain("{{monitor_name}}");
  });

  test("throws for an unknown event type", () => {
    expect(() => {
      return getWhatsAppTemplateStringForEventType(
        "nope" as unknown as NotificationSettingEventType,
      );
    }).toThrow("WhatsApp template is not defined for event type");
  });
});

describe("createWhatsAppMessageFromTemplate", () => {
  test("renders variables from a supplied template string", () => {
    const payload: WhatsAppMessagePayload = createWhatsAppMessageFromTemplate({
      templateKey: WhatsAppTemplateIds.VerificationCode,
      templateString: "{{1}} is your code.",
      templateVariables: { "1": "123456" },
    });

    expect(payload.body).toBe("123456 is your code.");
    expect(payload.templateKey).toBe(WhatsAppTemplateIds.VerificationCode);
    expect(payload.templateLanguageCode).toBe("en");
  });

  test("resolves the template id from an event type", () => {
    const payload: WhatsAppMessagePayload = createWhatsAppMessageFromTemplate({
      eventType:
        NotificationSettingEventType.SEND_MONITOR_CREATED_OWNER_NOTIFICATION,
      templateVariables: {
        monitor_name: "API Monitor",
        monitor_link: "https://oneuptime.com/monitor/1",
      },
    });

    expect(payload.templateKey).toBe(
      WhatsAppTemplateIds.MonitorCreatedOwnerNotification,
    );
    expect(payload.body).toContain("API Monitor");
    expect(payload.body).toContain("https://oneuptime.com/monitor/1");
  });

  test("defaults the dashboard link variable to the provided action link", () => {
    const payload: WhatsAppMessagePayload = createWhatsAppMessageFromTemplate({
      templateKey: WhatsAppTemplateIds.MonitorCreatedOwnerNotification,
      actionLink: "https://oneuptime.com/dashboard/monitor/42",
      templateVariables: {
        monitor_name: "DB Monitor",
        // monitor_link intentionally omitted — should be injected
      },
    });

    expect(payload.templateVariables?.["monitor_link"]).toBe(
      "https://oneuptime.com/dashboard/monitor/42",
    );
    expect(payload.body).toContain(
      "https://oneuptime.com/dashboard/monitor/42",
    );
  });

  test("falls back to the default dashboard URL when no action link given", () => {
    const payload: WhatsAppMessagePayload = createWhatsAppMessageFromTemplate({
      templateKey: WhatsAppTemplateIds.MonitorCreatedOwnerNotification,
      templateVariables: {
        monitor_name: "DB Monitor",
      },
    });

    expect(payload.templateVariables?.["monitor_link"]).toBe(
      "https://oneuptime.com/dashboard",
    );
  });

  test("a caller-supplied link variable wins over the action link", () => {
    const payload: WhatsAppMessagePayload = createWhatsAppMessageFromTemplate({
      templateKey: WhatsAppTemplateIds.MonitorCreatedOwnerNotification,
      actionLink: "https://oneuptime.com/dashboard/fallback",
      templateVariables: {
        monitor_name: "DB Monitor",
        monitor_link: "https://oneuptime.com/explicit",
      },
    });

    expect(payload.templateVariables?.["monitor_link"]).toBe(
      "https://oneuptime.com/explicit",
    );
  });

  test("trims whitespace around the resolved link", () => {
    const payload: WhatsAppMessagePayload = createWhatsAppMessageFromTemplate({
      templateKey: WhatsAppTemplateIds.MonitorCreatedOwnerNotification,
      actionLink: "   https://oneuptime.com/trimmed   ",
      templateVariables: {
        monitor_name: "DB Monitor",
      },
    });

    expect(payload.templateVariables?.["monitor_link"]).toBe(
      "https://oneuptime.com/trimmed",
    );
  });

  test("throws when a required template variable is missing", () => {
    expect(() => {
      return createWhatsAppMessageFromTemplate({
        templateKey: WhatsAppTemplateIds.VerificationCode,
        templateString: "{{1}} is your code for {{app_name}}.",
        templateVariables: { "1": "123456" }, // app_name missing
      });
    }).toThrow('Missing variable "app_name"');
  });

  test("throws when neither template key nor event type is provided", () => {
    expect(() => {
      return createWhatsAppMessageFromTemplate({
        templateVariables: {},
      });
    }).toThrow("WhatsApp template key or event type must be provided");
  });
});

describe("appendRecipientToWhatsAppMessage", () => {
  test("attaches the recipient phone without mutating other fields", () => {
    const payload: WhatsAppMessagePayload = {
      body: "hello",
      templateKey: WhatsAppTemplateIds.VerificationCode,
      templateVariables: { "1": "1" },
      templateLanguageCode: "en",
    };

    const to: Phone = new Phone("+15551234567");
    const message: WhatsAppMessage = appendRecipientToWhatsAppMessage(
      payload,
      to,
    );

    expect(message.to).toBe(to);
    expect(message.body).toBe("hello");
    expect(message.templateKey).toBe(WhatsAppTemplateIds.VerificationCode);
    expect(message.templateLanguageCode).toBe("en");
  });
});
