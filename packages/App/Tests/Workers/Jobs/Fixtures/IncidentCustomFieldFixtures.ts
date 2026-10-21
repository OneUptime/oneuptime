import Label from "Common/Models/DatabaseModels/Label";
import { IncidentTemplateCustomFieldDefinition } from "Common/Server/Utils/StatusPage/IncidentTemplateVariableBuilder";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import { JSONObject } from "Common/Types/JSON";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import SubscriberNotificationTemplateVariables from "Common/Types/StatusPage/SubscriberNotificationTemplateVariables";
import { expect } from "@jest/globals";

/*
 * Incident custom fields in the incident subscriber job tests.
 *
 * The jobs read the project's incident custom fields through
 * IncidentTemplateVariableBuilder, which each job test fakes
 * (IncidentCustomFieldService.findBy). With no fields - the default in those
 * tests - every message is what it was before custom fields reached
 * subscribers; these fixtures give a project four fields, three of them
 * marked "Include in Subscriber Notifications", and the values one incident
 * holds for them.
 *
 * The Markdown renderer is faked in the job tests too, so the Rich text
 * field's rendered form is fixed here (renderImpactDetails); the real
 * renderer's escaping is pinned in IncidentTemplateVariableBuilder's own
 * tests.
 */

/*
 * The labels every incident in the job tests carries, as the join returns
 * them, and how {{incidentLabels}} reads them: alphabetically.
 */
export function incidentLabels(): Array<Label> {
  return ["Payments", "EU"].map((name: string): Label => {
    const label: Label = new Label();
    label.name = name;
    return label;
  });
}

export const INCIDENT_LABELS: string = "EU, Payments";

/*
 * A plain value with markup in it: escaped in an email, escaped for Markdown
 * in Slack and Teams (so it reads as written there), as written in SMS and
 * webhooks.
 */
export const AFFECTED_LOCATION: string = "<b>Site 03</b> & Site 07";
export const AFFECTED_LOCATION_HTML: string =
  "&lt;b&gt;Site 03&lt;/b&gt; &amp; Site 07";
export const AFFECTED_LOCATION_MARKDOWN: string =
  "\\<b>Site 03\\</b> & Site 07";

export const IMPACT_DETAILS: string = "Card payments **fail** in the EU.";
export const IMPACT_DETAILS_HTML: string =
  "<p>Card payments <strong>fail</strong> in the EU.</p>";
export const IMPACT_DETAILS_TEXT: string = "Card payments fail in the EU.";

export const INTERNAL_TICKET: string = "OPS-4411";

export const CUSTOM_FIELD_DEFINITIONS: Array<IncidentTemplateCustomFieldDefinition> =
  [
    // Listed out of order: the messages follow sortOrder.
    {
      name: "Internal Ticket",
      variableKey: "internal_ticket",
      customFieldType: CustomFieldType.Text,
      includeInSubscriberNotifications: false,
      sortOrder: 4,
    },
    {
      name: "Impact Details",
      variableKey: "impact_details",
      customFieldType: CustomFieldType.Markdown,
      includeInSubscriberNotifications: true,
      sortOrder: 3,
    },
    {
      name: "Affected Location",
      variableKey: "affected_location",
      customFieldType: CustomFieldType.Dropdown,
      includeInSubscriberNotifications: true,
      sortOrder: 1,
    },
    {
      name: "Acknowledgement",
      variableKey: "acknowledgement",
      customFieldType: CustomFieldType.Boolean,
      includeInSubscriberNotifications: true,
      sortOrder: 2,
    },
  ];

export const CUSTOM_FIELD_VALUES: JSONObject = {
  "Affected Location": AFFECTED_LOCATION,
  // false is a value: it reads "No".
  Acknowledgement: false,
  "Impact Details": IMPACT_DETAILS,
  "Internal Ticket": INTERNAL_TICKET,
};

// The default email's rows: the included fields, in their order.
export const EXPECTED_CUSTOM_FIELD_ROWS: Array<JSONObject> = [
  { title: "Affected Location", plainText: AFFECTED_LOCATION },
  { title: "Acknowledgement", plainText: "No" },
  { title: "Impact Details", renderedHtml: IMPACT_DETAILS_HTML },
];

// The same fields as Markdown lines, for the default Slack and Teams messages.
export const EXPECTED_CUSTOM_FIELD_LINES: Array<string> = [
  `**Affected Location:** ${AFFECTED_LOCATION_MARKDOWN}`,
  "**Acknowledgement:** No",
  `**Impact Details:**\n${IMPACT_DETAILS}`,
];

// What a webhook's data carries: the included fields, by key.
export const EXPECTED_WEBHOOK_CUSTOM_FIELDS: JSONObject = {
  affected_location: {
    name: "Affected Location",
    type: CustomFieldType.Dropdown,
    value: AFFECTED_LOCATION,
  },
  acknowledgement: {
    name: "Acknowledgement",
    type: CustomFieldType.Boolean,
    value: false,
  },
  impact_details: {
    name: "Impact Details",
    type: CustomFieldType.Markdown,
    value: IMPACT_DETAILS,
  },
};

// The feed item's record of the included fields, after a default message.
export const EXPECTED_INCLUDED_FIELDS_FEED: string = [
  "**Custom fields sent:**",
  "",
  "- **Affected Location:** \\<b>Site 03\\</b> & Site 07",
  "- **Acknowledgement:** No",
  "",
  "**Impact Details:**",
  "",
  IMPACT_DETAILS,
].join("\n");

/*
 * A stand-in for Markdown.convertToHTML / convertToPlainText that renders the
 * Rich text field as the real renderer would and leaves everything else to
 * the test's own fake.
 */
export function renderImpactDetails(
  otherwise: (markdown: string) => string,
): (markdown: unknown) => string {
  return (markdown: unknown): string => {
    return markdown === IMPACT_DETAILS
      ? IMPACT_DETAILS_HTML
      : otherwise(markdown as string);
  };
}

export function plainTextOfImpactDetails(
  otherwise: (markdown: string) => string,
): (markdown: unknown) => string {
  return (markdown: unknown): string => {
    return markdown === IMPACT_DETAILS
      ? IMPACT_DETAILS_TEXT
      : otherwise(markdown as string);
  };
}

/*
 * A template body that prints every custom field's placeholder as
 * name=[value], so a test sees what each channel was given. Written the
 * documented way, {{incident.customFields.<key>}}.
 */
export const CUSTOM_FIELD_PLACEHOLDERS_TEMPLATE: string = [
  "location=[{{incident.customFields.affected_location}}]",
  "ack=[{{incident.customFields.acknowledgement}}]",
  "impact=[{{incident.customFields.impact_details}}]",
  "ticket=[{{incident.customFields.internal_ticket}}]",
].join("\n");

/*
 * The same template written with the older {{customFields.<key>}}, as
 * templates saved before the variables were named after the incident are.
 * Every channel must get exactly what the documented one gets.
 */
export const OLDER_CUSTOM_FIELD_PLACEHOLDERS_TEMPLATE: string = [
  "location=[{{customFields.affected_location}}]",
  "ack=[{{customFields.acknowledgement}}]",
  "impact=[{{customFields.impact_details}}]",
  "ticket=[{{customFields.internal_ticket}}]",
].join("\n");

export interface CustomFieldPlaceholdersCase {
  // How the template names the fields, for the test title.
  written: string;
  // Prints every field as name=[value].
  template: string;
  // An email subject that places one field.
  subject: string;
}

// Each custom template test runs with both names of the fields.
export const CUSTOM_FIELD_PLACEHOLDERS_CASES: Array<CustomFieldPlaceholdersCase> =
  [
    {
      written: "{{incident.customFields.<key>}}",
      template: CUSTOM_FIELD_PLACEHOLDERS_TEMPLATE,
      subject: "Subject {{incident.customFields.affected_location}}",
    },
    {
      written: "the older {{customFields.<key>}}",
      template: OLDER_CUSTOM_FIELD_PLACEHOLDERS_TEMPLATE,
      subject: "Subject {{customFields.affected_location}}",
    },
  ];

/*
 * Variables a compile may carry beyond the listed ones: those the event's
 * dynamic families (incident.customFields.<key>, and the older
 * customFields.<key>) take in. Used by the tests that hold each channel's
 * variables to the advertised list.
 */
export function listedVariableNames(
  eventType: StatusPageSubscriberNotificationEventType,
  variables: Record<string, unknown>,
): Array<string> {
  return Object.keys(variables)
    .filter((name: string): boolean => {
      return (
        SubscriberNotificationTemplateVariables.getDynamicVariableForName(
          eventType,
          name,
        ) === null
      );
    })
    .sort();
}

// Every variable a compile carries is one the event offers.
export function expectOnlyOfferedVariables(
  eventType: StatusPageSubscriberNotificationEventType,
  variables: Record<string, unknown>,
): void {
  const notOffered: Array<string> = Object.keys(variables).filter(
    (name: string): boolean => {
      return !SubscriberNotificationTemplateVariables.isVariableOffered(
        eventType,
        name,
      );
    },
  );

  expect(notOffered).toEqual([]);
}
