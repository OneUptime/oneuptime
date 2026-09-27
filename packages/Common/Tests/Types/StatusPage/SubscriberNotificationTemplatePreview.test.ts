import { describe, expect, test } from "@jest/globals";
import SafeHtml from "../../../Types/SafeHtml";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import SubscriberNotificationTemplatePreview, {
  SubscriberNotificationTemplatePreviewResult,
  SubscriberNotificationTemplateSampleValues,
} from "../../../Types/StatusPage/SubscriberNotificationTemplatePreview";
import SubscriberNotificationTemplateVariables from "../../../Types/StatusPage/SubscriberNotificationTemplateVariables";

/*
 * The template editor's live preview: a custom subscriber notification
 * template filled with sample values, by the compiler the subscriber jobs use,
 * with each value in the format its channel gets it in.
 */

const INCIDENT_CREATED: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated;

function render(data: {
  method: StatusPageSubscriberNotificationMethod;
  body: string;
  subject?: string;
  eventType?: StatusPageSubscriberNotificationEventType | undefined;
}): SubscriberNotificationTemplatePreviewResult {
  return SubscriberNotificationTemplatePreview.render({
    eventType: "eventType" in data ? data.eventType : INCIDENT_CREATED,
    notificationMethod: data.method,
    templateBody: data.body,
    emailSubject: data.subject,
  });
}

describe("the email body", () => {
  test("HTML variables go in as HTML and plain ones escaped, as the jobs fill them", () => {
    const preview: SubscriberNotificationTemplatePreviewResult = render({
      method: StatusPageSubscriberNotificationMethod.Email,
      body: '<h1>{{incidentTitle}}</h1>{{incidentDescription}}<p>{{resourcesAffected}}</p><a href="{{unsubscribeUrl}}">x</a>',
      subject: "{{statusPageName}}: {{incidentTitle}}",
    });

    expect(preview.isAvailable).toBe(true);
    expect(preview.isHtml).toBe(true);
    expect(preview.body).toBe(
      '<h1>Checkout requests are failing</h1><p>Customers in <strong>Europe</strong> cannot complete a checkout. We are investigating.</p><p>Europe: Checkout API<br/>Americas: Payments API</p><a href="https://status.example.com/unsubscribe/preview">x</a>',
    );
    expect(preview.subject).toBe("Acme Status: Checkout requests are failing");
    expect(preview.unknownPlaceholders).toEqual([]);
  });

  test("a sample that looks like HTML in a plain variable is escaped, never markup", () => {
    const values: SubscriberNotificationTemplateSampleValues =
      SubscriberNotificationTemplatePreview.getSampleValues({
        eventType: INCIDENT_CREATED,
        templates: [],
      });

    // Only the variables that are HTML in an email body are SafeHtml.
    const htmlNames: Array<string> = Object.entries(values.emailBody)
      .filter(([, value]: [string, unknown]): boolean => {
        return SafeHtml.isSafeHtml(value);
      })
      .map(([name]: [string, unknown]): string => {
        return name;
      })
      .sort();

    expect(htmlNames).toEqual(
      SubscriberNotificationTemplateVariables.getEmailBodyHtmlVariableNamesForEventType(
        INCIDENT_CREATED,
      ).sort(),
    );
  });

  test("no subject: none is shown, so the default subject is said to be used", () => {
    expect(
      render({
        method: StatusPageSubscriberNotificationMethod.Email,
        body: "<p>{{incidentTitle}}</p>",
      }).subject,
    ).toBeNull();
  });
});

describe("the other channels", () => {
  test("SMS gets plain text", () => {
    const preview: SubscriberNotificationTemplatePreviewResult = render({
      method: StatusPageSubscriberNotificationMethod.SMS,
      body: "{{incidentTitle}}: {{incidentDescription}} ({{resourcesAffected}})",
      subject: "{{incidentTitle}}",
    });

    expect(preview.isHtml).toBe(false);
    expect(preview.subject).toBeNull();
    expect(preview.body).toBe(
      "Checkout requests are failing: Customers in Europe cannot complete a checkout. We are investigating. (Europe: Checkout API; Americas: Payments API)",
    );
  });

  test("Slack and Microsoft Teams get Markdown", () => {
    for (const method of [
      StatusPageSubscriberNotificationMethod.Slack,
      StatusPageSubscriberNotificationMethod.MicrosoftTeams,
    ]) {
      expect(
        render({
          method: method,
          body: "**{{incidentTitle}}**\n{{incidentDescription}}",
        }).body,
      ).toBe(
        "**Checkout requests are failing**\nCustomers in **Europe** cannot complete a checkout. We are investigating.",
      );
    }
  });
});

describe("placeholders", () => {
  test("a custom field placeholder gets a sample; one the event does not offer is listed and left as written", () => {
    const preview: SubscriberNotificationTemplatePreviewResult = render({
      method: StatusPageSubscriberNotificationMethod.SMS,
      body: "{{customFields.impact_details}} {{incidentStat}} {{scheduledMaintenanceTitle}}",
    });

    expect(preview.body).toBe(
      "Sample impact_details {{incidentStat}} {{scheduledMaintenanceTitle}}",
    );
    expect(preview.unknownPlaceholders).toEqual([
      "incidentStat",
      "scheduledMaintenanceTitle",
    ]);
  });

  test.each(
    Object.values(StatusPageSubscriberNotificationEventType).filter(
      (eventType: StatusPageSubscriberNotificationEventType): boolean => {
        return (
          eventType !==
          StatusPageSubscriberNotificationEventType.SubscriberReport
        );
      },
    ),
  )(
    "every variable %s offers has a real sample",
    (eventType: StatusPageSubscriberNotificationEventType) => {
      const values: SubscriberNotificationTemplateSampleValues =
        SubscriberNotificationTemplatePreview.getSampleValues({
          eventType: eventType,
          templates: [],
        });

      for (const name of SubscriberNotificationTemplateVariables.getVariableNamesForEventType(
        eventType,
      )) {
        expect(values.plainText[name]).toBeTruthy();
        expect(values.plainText[name]).not.toBe(`[${name}]`);
      }
    },
  );
});

describe("what has no preview", () => {
  test("the report template, and no event type", () => {
    expect(
      render({
        method: StatusPageSubscriberNotificationMethod.Email,
        body: "{{report.reportDates}}",
        eventType: StatusPageSubscriberNotificationEventType.SubscriberReport,
      }).isAvailable,
    ).toBe(false);

    expect(
      render({
        method: StatusPageSubscriberNotificationMethod.Email,
        body: "<p>x</p>",
        eventType: undefined,
      }).isAvailable,
    ).toBe(false);
  });
});
