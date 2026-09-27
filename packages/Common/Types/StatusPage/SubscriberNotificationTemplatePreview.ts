import SafeHtml from "../SafeHtml";
import StatusPageSubscriberNotificationEventType from "./StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "./StatusPageSubscriberNotificationMethod";
import SubscriberNotificationPreview from "./SubscriberNotificationPreview";
import SubscriberNotificationTemplateCompiler, {
  SubscriberNotificationEmailBodyTemplateVariables,
  SubscriberNotificationTextTemplateVariables,
} from "./SubscriberNotificationTemplateCompiler";
import SubscriberNotificationTemplateVariables, {
  SubscriberNotificationTemplateDynamicVariable,
  SubscriberNotificationTemplateVariable,
} from "./SubscriberNotificationTemplateVariables";

/*
 * The live preview of a custom subscriber notification template while it is
 * written: the template filled with sample values, by the compiler the
 * subscriber jobs fill it with (SubscriberNotificationTemplateCompiler).
 *
 * Each value comes in the format its channel gets it in, as the jobs give
 * them: an email body gets HTML for the variables that are HTML there (a
 * description, a note, the resource list) and every other value escaped;
 * the subject and SMS get plain text; Slack and Teams get Markdown. So what
 * the preview shows is what a template does with real values - including a
 * placeholder the event does not offer, which is sent as written and is
 * listed as such.
 *
 * The report template is the exception: it is rendered by the full
 * Handlebars engine with a structured report, which placeholders cannot
 * stand in for, so it has no preview.
 *
 * Kept free of React and of the server, so the dashboard renders it and
 * tests can read it directly.
 */

// One sample value, in the three forms the channels take.
interface SampleValue {
  text: string;
  markdown?: string | undefined;
  // For a variable that is HTML in an email body.
  html?: string | undefined;
}

const SAMPLE_STATUS_PAGE_URL: string = "https://status.example.com";

const SAMPLE_VALUES: Record<string, SampleValue> = {
  statusPageName: { text: "Acme Status" },
  statusPageUrl: { text: SAMPLE_STATUS_PAGE_URL },
  unsubscribeUrl: {
    text: SubscriberNotificationPreview.getPreviewUnsubscribeUrl(
      SAMPLE_STATUS_PAGE_URL,
    ),
  },
  confirmationUrl: {
    text: `${SAMPLE_STATUS_PAGE_URL}/confirm-subscription/sample`,
  },
  manageSubscriptionUrl: {
    text: `${SAMPLE_STATUS_PAGE_URL}/update-subscription/sample`,
  },
  detailsUrl: { text: `${SAMPLE_STATUS_PAGE_URL}/incidents/sample` },
  resourcesAffected: {
    text: "Europe: Checkout API; Americas: Payments API",
    html: "Europe: Checkout API<br/>Americas: Payments API",
  },
  incidentTitle: { text: "Checkout requests are failing" },
  incidentDescription: {
    text: "Customers in Europe cannot complete a checkout. We are investigating.",
    markdown:
      "Customers in **Europe** cannot complete a checkout. We are investigating.",
    html: "<p>Customers in <strong>Europe</strong> cannot complete a checkout. We are investigating.</p>",
  },
  incidentSeverity: { text: "Major" },
  incidentState: { text: "Identified" },
  incidentLabels: { text: "Europe, Payments" },
  affectedStatusPages: { text: "Acme Status, Acme Europe Status" },
  postedAt: { text: "Sep 27, 2026, 10:30 AM UTC" },
  note: {
    text: "We found the cause and are rolling out a fix. Next update in 30 minutes.",
    markdown:
      "We found the cause and are rolling out a fix. **Next update in 30 minutes.**",
    html: "<p>We found the cause and are rolling out a fix. <strong>Next update in 30 minutes.</strong></p>",
  },
  postmortemNote: {
    text: "A configuration change overloaded the payment gateway. We have added a safeguard.",
    markdown:
      "A configuration change overloaded the payment gateway. We have added a **safeguard**.",
    html: "<p>A configuration change overloaded the payment gateway. We have added a <strong>safeguard</strong>.</p>",
  },
  announcementTitle: { text: "New status page features" },
  announcementDescription: {
    text: "You can now choose which services you hear about.",
    markdown: "You can now choose **which services** you hear about.",
    html: "<p>You can now choose <strong>which services</strong> you hear about.</p>",
  },
  scheduledMaintenanceTitle: { text: "Database upgrade" },
  scheduledMaintenanceDescription: {
    text: "Checkout may be slow for up to ten minutes.",
    markdown: "Checkout may be slow for up to **ten minutes**.",
    html: "<p>Checkout may be slow for up to <strong>ten minutes</strong>.</p>",
  },
  scheduledMaintenanceState: { text: "Scheduled" },
  scheduledStartTime: { text: "Sep 30, 2026, 02:00 AM UTC" },
  scheduledEndTime: { text: "Sep 30, 2026, 03:00 AM UTC" },
  episodeTitle: { text: "Checkout degradation" },
  episodeDescription: {
    text: "Several incidents are affecting checkout.",
    markdown: "Several incidents are affecting **checkout**.",
    html: "<p>Several incidents are affecting <strong>checkout</strong>.</p>",
  },
  episodeSeverity: { text: "Major" },
  episodeState: { text: "Identified" },
};

export interface SubscriberNotificationTemplateSampleValues {
  // An email template's body: HTML values as SafeHtml, the rest plain.
  emailBody: SubscriberNotificationEmailBodyTemplateVariables;
  // An email subject, SMS and webhook.
  plainText: SubscriberNotificationTextTemplateVariables;
  // Slack and Microsoft Teams.
  markdown: SubscriberNotificationTextTemplateVariables;
}

export interface SubscriberNotificationTemplatePreviewResult {
  // False when this event's templates cannot be previewed (the report).
  isAvailable: boolean;
  // Whether body is HTML (an email template's body).
  isHtml: boolean;
  // An email template's subject, filled in; null for other channels, or none.
  subject: string | null;
  body: string;
  // Placeholders the event does not offer: they are sent as written.
  unknownPlaceholders: Array<string>;
}

export default class SubscriberNotificationTemplatePreview {
  public static isAvailableForEventType(
    eventType: StatusPageSubscriberNotificationEventType | undefined,
  ): boolean {
    return (
      Boolean(eventType) &&
      Object.values(StatusPageSubscriberNotificationEventType).includes(
        eventType!,
      ) &&
      eventType !== StatusPageSubscriberNotificationEventType.SubscriberReport
    );
  }

  /*
   * A sample for every variable the event offers, and for each custom field
   * placeholder these templates place ({{customFields.<key>}}), in each
   * channel's format.
   */
  public static getSampleValues(data: {
    eventType: StatusPageSubscriberNotificationEventType;
    templates: Array<string | null | undefined>;
  }): SubscriberNotificationTemplateSampleValues {
    const values: SubscriberNotificationTemplateSampleValues = {
      emailBody: {},
      plainText: {},
      markdown: {},
    };

    for (const variable of SubscriberNotificationTemplateVariables.getAvailableVariablesForEventType(
      data.eventType,
    )) {
      this.addSample({
        values: values,
        name: variable.name,
        sample: SAMPLE_VALUES[variable.name] || {
          text: `[${variable.name}]`,
        },
        isHtmlInEmailBody: this.isHtmlInEmailBody(variable),
      });
    }

    for (const name of SubscriberNotificationTemplateCompiler.getPlaceholderNames(
      data.templates,
    )) {
      const dynamicVariable: SubscriberNotificationTemplateDynamicVariable | null =
        SubscriberNotificationTemplateVariables.getDynamicVariableForName(
          data.eventType,
          name,
        );

      if (!dynamicVariable) {
        continue;
      }

      this.addSample({
        values: values,
        name: name,
        sample: {
          text: `Sample ${name.slice(dynamicVariable.prefix.length)}`,
        },
        isHtmlInEmailBody: false,
      });
    }

    return values;
  }

  // The template, filled with sample values as its channel would be.
  public static render(data: {
    eventType: StatusPageSubscriberNotificationEventType | undefined;
    notificationMethod: StatusPageSubscriberNotificationMethod | undefined;
    templateBody: string | null | undefined;
    emailSubject?: string | null | undefined;
  }): SubscriberNotificationTemplatePreviewResult {
    const isEmail: boolean =
      data.notificationMethod === StatusPageSubscriberNotificationMethod.Email;
    const templateBody: string = data.templateBody || "";
    const emailSubject: string = (isEmail && data.emailSubject) || "";

    if (!this.isAvailableForEventType(data.eventType)) {
      return {
        isAvailable: false,
        isHtml: isEmail,
        subject: null,
        body: "",
        unknownPlaceholders: [],
      };
    }

    const eventType: StatusPageSubscriberNotificationEventType =
      data.eventType!;

    const values: SubscriberNotificationTemplateSampleValues =
      this.getSampleValues({
        eventType: eventType,
        templates: [templateBody, emailSubject],
      });

    const unknownPlaceholders: Array<string> = Array.from(
      SubscriberNotificationTemplateCompiler.getPlaceholderNames([
        templateBody,
        emailSubject,
      ]),
    )
      .filter((name: string): boolean => {
        return !SubscriberNotificationTemplateVariables.isVariableOffered(
          eventType,
          name,
        );
      })
      .sort();

    if (isEmail) {
      return {
        isAvailable: true,
        isHtml: true,
        subject: emailSubject
          ? SubscriberNotificationTemplateCompiler.compileTemplate(
              emailSubject,
              values.plainText,
            )
          : null,
        body: SubscriberNotificationTemplateCompiler.compileEmailBodyTemplate(
          templateBody,
          values.emailBody,
        ),
        unknownPlaceholders: unknownPlaceholders,
      };
    }

    const isMarkdownChannel: boolean =
      data.notificationMethod ===
        StatusPageSubscriberNotificationMethod.Slack ||
      data.notificationMethod ===
        StatusPageSubscriberNotificationMethod.MicrosoftTeams;

    return {
      isAvailable: true,
      isHtml: false,
      subject: null,
      body: SubscriberNotificationTemplateCompiler.compileTemplate(
        templateBody,
        isMarkdownChannel ? values.markdown : values.plainText,
      ),
      unknownPlaceholders: unknownPlaceholders,
    };
  }

  private static isHtmlInEmailBody(
    variable: SubscriberNotificationTemplateVariable,
  ): boolean {
    return variable.isHtmlInEmailBody === true;
  }

  private static addSample(data: {
    values: SubscriberNotificationTemplateSampleValues;
    name: string;
    sample: SampleValue;
    isHtmlInEmailBody: boolean;
  }): void {
    data.values.plainText[data.name] = data.sample.text;
    data.values.markdown[data.name] = data.sample.markdown || data.sample.text;
    data.values.emailBody[data.name] =
      data.isHtmlInEmailBody && data.sample.html
        ? SafeHtml.fromTrustedHtml(data.sample.html)
        : data.sample.text;
  }
}
