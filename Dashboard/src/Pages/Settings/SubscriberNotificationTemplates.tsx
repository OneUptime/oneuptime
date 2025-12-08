import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { RouteUtil } from "../../Utils/RouteMap";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";

// Function to get available variables documentation based on event type
const getVariablesDocumentation = (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
): string => {
  const commonVariables: string = `### Common Variables (Available for ALL Event Types)

| Variable | Description |
|----------|-------------|
| \`{{statusPageName}}\` | Name of the status page |
| \`{{statusPageUrl}}\` | URL of the status page |
| \`{{unsubscribeUrl}}\` | URL for subscribers to unsubscribe from notifications |
| \`{{resourcesAffected}}\` | List of affected resources/monitors |

`;

  if (!eventType) {
    return `## Available Template Variables

Please select an **Event Type** above to see the available variables for that event.

${commonVariables}`;
  }

  let eventSpecificVariables: string = "";

  switch (eventType) {
    case StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated:
      eventSpecificVariables = `### Incident Created Variables

| Variable | Description |
|----------|-------------|
| \`{{incidentTitle}}\` | Title of the incident |
| \`{{incidentDescription}}\` | Description of the incident |
| \`{{incidentSeverity}}\` | Severity level of the incident |
| \`{{detailsUrl}}\` | URL to view incident details |

**Example Email Subject:**
\`\`\`
{{statusPageName}}: {{incidentTitle}}
\`\`\`

**Example Email Body:**
\`\`\`html
<h2>{{incidentTitle}}</h2>
<p>{{incidentDescription}}</p>
<p><strong>Severity:</strong> {{incidentSeverity}}</p>
<p><strong>Affected Resources:</strong> {{resourcesAffected}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>
\`\`\``;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged:
      eventSpecificVariables = `### Incident State Changed Variables

| Variable | Description |
|----------|-------------|
| \`{{incidentTitle}}\` | Title of the incident |
| \`{{incidentDescription}}\` | Description of the incident |
| \`{{incidentSeverity}}\` | Severity level of the incident |
| \`{{incidentState}}\` | Current state of the incident (e.g., Investigating, Identified, Resolved) |
| \`{{detailsUrl}}\` | URL to view incident details |

**Example Email Subject:**
\`\`\`
{{statusPageName}}: {{incidentTitle}} - {{incidentState}}
\`\`\`

**Example Email Body:**
\`\`\`html
<h2>{{incidentTitle}}</h2>
<p>Status changed to: <strong>{{incidentState}}</strong></p>
<p>{{incidentDescription}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>
\`\`\``;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated:
      eventSpecificVariables = `### Incident Note Created Variables

| Variable | Description |
|----------|-------------|
| \`{{incidentTitle}}\` | Title of the incident |
| \`{{incidentSeverity}}\` | Severity level of the incident |
| \`{{incidentState}}\` | Current state of the incident |
| \`{{postedAt}}\` | Date and time when the note was posted |
| \`{{note}}\` | Content of the note |
| \`{{detailsUrl}}\` | URL to view incident details |

**Example Email Subject:**
\`\`\`
{{statusPageName}}: Update on {{incidentTitle}}
\`\`\`

**Example Email Body:**
\`\`\`html
<h2>Update: {{incidentTitle}}</h2>
<p><strong>Posted:</strong> {{postedAt}}</p>
<p>{{note}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>
\`\`\``;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated:
      eventSpecificVariables = `### Announcement Created Variables

| Variable | Description |
|----------|-------------|
| \`{{announcementTitle}}\` | Title of the announcement |
| \`{{announcementDescription}}\` | Description/content of the announcement |
| \`{{detailsUrl}}\` | URL to view announcement details |

**Example Email Subject:**
\`\`\`
{{statusPageName}}: {{announcementTitle}}
\`\`\`

**Example Email Body:**
\`\`\`html
<h2>📢 {{announcementTitle}}</h2>
<p>{{announcementDescription}}</p>
<p><a href="{{detailsUrl}}">View Announcement</a></p>
\`\`\``;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated:
      eventSpecificVariables = `### Scheduled Maintenance Created Variables

| Variable | Description |
|----------|-------------|
| \`{{scheduledMaintenanceTitle}}\` | Title of the scheduled maintenance |
| \`{{scheduledMaintenanceDescription}}\` | Description of the scheduled maintenance |
| \`{{scheduledStartTime}}\` | When the maintenance is scheduled to start |
| \`{{scheduledEndTime}}\` | When the maintenance is scheduled to end |
| \`{{detailsUrl}}\` | URL to view scheduled maintenance details |

**Example Email Subject:**
\`\`\`
{{statusPageName}}: Scheduled Maintenance - {{scheduledMaintenanceTitle}}
\`\`\`

**Example Email Body:**
\`\`\`html
<h2>🔧 {{scheduledMaintenanceTitle}}</h2>
<p>{{scheduledMaintenanceDescription}}</p>
<p><strong>Start:</strong> {{scheduledStartTime}}</p>
<p><strong>End:</strong> {{scheduledEndTime}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>
\`\`\``;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceStateChanged:
      eventSpecificVariables = `### Scheduled Maintenance State Changed Variables

| Variable | Description |
|----------|-------------|
| \`{{scheduledMaintenanceTitle}}\` | Title of the scheduled maintenance |
| \`{{scheduledMaintenanceDescription}}\` | Description of the scheduled maintenance |
| \`{{scheduledMaintenanceState}}\` | Current state (e.g., Scheduled, In Progress, Completed) |
| \`{{detailsUrl}}\` | URL to view scheduled maintenance details |

**Example Email Subject:**
\`\`\`
{{statusPageName}}: {{scheduledMaintenanceTitle}} - {{scheduledMaintenanceState}}
\`\`\`

**Example Email Body:**
\`\`\`html
<h2>🔧 {{scheduledMaintenanceTitle}}</h2>
<p>Status changed to: <strong>{{scheduledMaintenanceState}}</strong></p>
<p>{{scheduledMaintenanceDescription}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>
\`\`\``;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated:
      eventSpecificVariables = `### Scheduled Maintenance Note Created Variables

| Variable | Description |
|----------|-------------|
| \`{{scheduledMaintenanceTitle}}\` | Title of the scheduled maintenance |
| \`{{scheduledMaintenanceState}}\` | Current state of the scheduled maintenance |
| \`{{postedAt}}\` | Date and time when the note was posted |
| \`{{note}}\` | Content of the note |
| \`{{detailsUrl}}\` | URL to view scheduled maintenance details |

**Example Email Subject:**
\`\`\`
{{statusPageName}}: Update on {{scheduledMaintenanceTitle}}
\`\`\`

**Example Email Body:**
\`\`\`html
<h2>Update: {{scheduledMaintenanceTitle}}</h2>
<p><strong>Posted:</strong> {{postedAt}}</p>
<p>{{note}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>
\`\`\``;
      break;

    default:
      eventSpecificVariables =
        "Please select an event type to see available variables.";
  }

  return `## Available Template Variables

Use these variables in your template with the \`{{variableName}}\` syntax.

${commonVariables}
${eventSpecificVariables}`;
};

const SubscriberNotificationTemplates: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <ModelTable<StatusPageSubscriberNotificationTemplate>
        modelType={StatusPageSubscriberNotificationTemplate}
        id="subscriber-notification-templates-table"
        userPreferencesKey="subscriber-notification-templates-table"
        name="Settings > Subscriber Notification Templates"
        isDeleteable={false}
        viewPageRoute={RouteUtil.populateRouteParams(props.pageRoute)}
        isEditable={false}
        isCreateable={true}
        isViewable={true}
        cardProps={{
          title: "Subscriber Notification Templates",
          description:
            "Create custom notification templates for status page subscribers. These templates allow you to customize the messages sent via Email, SMS, Slack, Microsoft Teams, and Webhooks for different event types.",
        }}
        noItemsMessage={"No subscriber notification templates found."}
        query={{
          projectId: ProjectUtil.getCurrentProjectId()!,
        }}
        showViewIdButton={true}
        formSteps={[
          {
            title: "Template Info",
            id: "template-info",
          },
          {
            title: "Template Settings",
            id: "template-settings",
          },
          {
            title: "Template Content",
            id: "template-content",
          },
        ]}
        formFields={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            stepId: "template-info",
            description: "A friendly name for this notification template",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            placeholder: "My Custom Template",
          },
          {
            field: {
              templateDescription: true,
            },
            title: "Template Description",
            stepId: "template-info",
            description: "Optional description for this template",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
            placeholder: "Description of what this template is used for",
          },
          {
            field: {
              eventType: true,
            },
            title: "Event Type",
            stepId: "template-settings",
            description:
              "Select the type of event this template will be used for",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              StatusPageSubscriberNotificationEventType,
            ),
            required: true,
            placeholder: "Select Event Type",
          },
          {
            field: {
              notificationMethod: true,
            },
            title: "Notification Method",
            stepId: "template-settings",
            description:
              "Select the notification method (Email, SMS, Slack, Microsoft Teams, or Webhook)",
            fieldType: FormFieldSchemaType.Dropdown,
            dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              StatusPageSubscriberNotificationMethod,
            ),
            required: true,
            placeholder: "Select Notification Method",
          },
          {
            title: "Available Template Variables",
            stepId: "template-content",
            description:
              "These are the variables you can use in your template based on the selected event type.",
            fieldType: FormFieldSchemaType.CustomComponent,
            getCustomElement: (
              values: FormValues<StatusPageSubscriberNotificationTemplate>,
            ): ReactElement => {
              const eventType: StatusPageSubscriberNotificationEventType | undefined =
                values.eventType as
                  | StatusPageSubscriberNotificationEventType
                  | undefined;
              return (
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 mb-4">
                  <MarkdownViewer text={getVariablesDocumentation(eventType)} />
                </div>
              );
            },
          },
          {
            field: {
              emailSubject: true,
            },
            title: "Email Subject",
            stepId: "template-content",
            description:
              "Subject line for email notifications. Only used when notification method is Email. You can use template variables like {{incidentTitle}}.",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "{{statusPageName}}: {{incidentTitle}}",
          },
          {
            field: {
              templateBody: true,
            },
            title: "Template Body",
            stepId: "template-content",
            description:
              "The template content. For Email: Use HTML. For SMS: Use plain text. For Slack/Teams: Use Markdown. You can use template variables like {{incidentTitle}}, {{statusPageName}}, etc.",
            fieldType: FormFieldSchemaType.HTML,
            required: true,
            placeholder:
              "<p>Hello {{subscriberName}},</p><p>{{incidentTitle}} has been created.</p>",
          },
        ]}
        showRefreshButton={true}
        filters={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            type: FieldType.Text,
          },
          {
            field: {
              eventType: true,
            },
            title: "Event Type",
            type: FieldType.Dropdown,
            filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              StatusPageSubscriberNotificationEventType,
            ),
          },
          {
            field: {
              notificationMethod: true,
            },
            title: "Notification Method",
            type: FieldType.Dropdown,
            filterDropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(
              StatusPageSubscriberNotificationMethod,
            ),
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.Date,
          },
        ]}
        columns={[
          {
            field: {
              templateName: true,
            },
            title: "Template Name",
            type: FieldType.Text,
          },
          {
            field: {
              eventType: true,
            },
            title: "Event Type",
            type: FieldType.Text,
          },
          {
            field: {
              notificationMethod: true,
            },
            title: "Notification Method",
            type: FieldType.Text,
          },
          {
            field: {
              createdAt: true,
            },
            title: "Created",
            type: FieldType.DateTime,
          },
        ]}
      />
    </Fragment>
  );
};

export default SubscriberNotificationTemplates;
