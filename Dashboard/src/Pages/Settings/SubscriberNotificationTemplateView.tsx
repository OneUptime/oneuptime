import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import React, { Fragment, FunctionComponent, ReactElement, useState, useEffect } from "react";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

// Function to get available variables documentation based on event type
const getVariablesDocumentation = (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
): string => {
  const commonVariablesRows: string = `| \`{{statusPageName}}\` | Name of the status page |
| \`{{statusPageUrl}}\` | URL of the status page |
| \`{{unsubscribeUrl}}\` | URL for subscribers to unsubscribe from notifications |
| \`{{resourcesAffected}}\` | List of affected resources/monitors |`;

  if (!eventType) {
    return `**Available Template Variables**

| Variable | Description |
|----------|-------------|
${commonVariablesRows}`;
  }

  let eventSpecificRows: string = "";
  let exampleSubject: string = "";
  let exampleBody: string = "";

  switch (eventType) {
    case StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated:
      eventSpecificRows = `| \`{{incidentTitle}}\` | Title of the incident |
| \`{{incidentDescription}}\` | Description of the incident |
| \`{{incidentSeverity}}\` | Severity level of the incident |
| \`{{detailsUrl}}\` | URL to view incident details |`;
      exampleSubject = "{{statusPageName}}: {{incidentTitle}}";
      exampleBody = `<h2>{{incidentTitle}}</h2>
<p>{{incidentDescription}}</p>
<p><strong>Severity:</strong> {{incidentSeverity}}</p>
<p><strong>Affected Resources:</strong> {{resourcesAffected}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged:
      eventSpecificRows = `| \`{{incidentTitle}}\` | Title of the incident |
| \`{{incidentDescription}}\` | Description of the incident |
| \`{{incidentSeverity}}\` | Severity level of the incident |
| \`{{incidentState}}\` | Current state of the incident (e.g., Investigating, Identified, Resolved) |
| \`{{detailsUrl}}\` | URL to view incident details |`;
      exampleSubject = "{{statusPageName}}: {{incidentTitle}} - {{incidentState}}";
      exampleBody = `<h2>{{incidentTitle}}</h2>
<p>Status changed to: <strong>{{incidentState}}</strong></p>
<p>{{incidentDescription}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated:
      eventSpecificRows = `| \`{{incidentTitle}}\` | Title of the incident |
| \`{{incidentSeverity}}\` | Severity level of the incident |
| \`{{incidentState}}\` | Current state of the incident |
| \`{{postedAt}}\` | Date and time when the note was posted |
| \`{{note}}\` | Content of the note |
| \`{{detailsUrl}}\` | URL to view incident details |`;
      exampleSubject = "{{statusPageName}}: Update on {{incidentTitle}}";
      exampleBody = `<h2>Update: {{incidentTitle}}</h2>
<p><strong>Posted:</strong> {{postedAt}}</p>
<p>{{note}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated:
      eventSpecificRows = `| \`{{announcementTitle}}\` | Title of the announcement |
| \`{{announcementDescription}}\` | Description/content of the announcement |
| \`{{detailsUrl}}\` | URL to view announcement details |`;
      exampleSubject = "{{statusPageName}}: {{announcementTitle}}";
      exampleBody = `<h2>📢 {{announcementTitle}}</h2>
<p>{{announcementDescription}}</p>
<p><a href="{{detailsUrl}}">View Announcement</a></p>`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated:
      eventSpecificRows = `| \`{{scheduledMaintenanceTitle}}\` | Title of the scheduled maintenance |
| \`{{scheduledMaintenanceDescription}}\` | Description of the scheduled maintenance |
| \`{{scheduledStartTime}}\` | When the maintenance is scheduled to start |
| \`{{scheduledEndTime}}\` | When the maintenance is scheduled to end |
| \`{{detailsUrl}}\` | URL to view scheduled maintenance details |`;
      exampleSubject = "{{statusPageName}}: Scheduled Maintenance - {{scheduledMaintenanceTitle}}";
      exampleBody = `<h2>🔧 {{scheduledMaintenanceTitle}}</h2>
<p>{{scheduledMaintenanceDescription}}</p>
<p><strong>Start:</strong> {{scheduledStartTime}}</p>
<p><strong>End:</strong> {{scheduledEndTime}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceStateChanged:
      eventSpecificRows = `| \`{{scheduledMaintenanceTitle}}\` | Title of the scheduled maintenance |
| \`{{scheduledMaintenanceDescription}}\` | Description of the scheduled maintenance |
| \`{{scheduledMaintenanceState}}\` | Current state (e.g., Scheduled, In Progress, Completed) |
| \`{{detailsUrl}}\` | URL to view scheduled maintenance details |`;
      exampleSubject = "{{statusPageName}}: {{scheduledMaintenanceTitle}} - {{scheduledMaintenanceState}}";
      exampleBody = `<h2>🔧 {{scheduledMaintenanceTitle}}</h2>
<p>Status changed to: <strong>{{scheduledMaintenanceState}}</strong></p>
<p>{{scheduledMaintenanceDescription}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated:
      eventSpecificRows = `| \`{{scheduledMaintenanceTitle}}\` | Title of the scheduled maintenance |
| \`{{scheduledMaintenanceState}}\` | Current state of the scheduled maintenance |
| \`{{postedAt}}\` | Date and time when the note was posted |
| \`{{note}}\` | Content of the note |
| \`{{detailsUrl}}\` | URL to view scheduled maintenance details |`;
      exampleSubject = "{{statusPageName}}: Update on {{scheduledMaintenanceTitle}}";
      exampleBody = `<h2>Update: {{scheduledMaintenanceTitle}}</h2>
<p><strong>Posted:</strong> {{postedAt}}</p>
<p>{{note}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>`;
      break;

    default:
      return `**Available Template Variables**

| Variable | Description |
|----------|-------------|
${commonVariablesRows}`;
  }

  return `**Available Template Variables** — Use these variables in your template with the \`{{variableName}}\` syntax.

| Variable | Description |
|----------|-------------|
${commonVariablesRows}
${eventSpecificRows}

**Example Email Subject:** \`${exampleSubject}\`

**Example Email Body:**
\`\`\`html
${exampleBody}
\`\`\``;
};

const SubscriberNotificationTemplateView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const [eventType, setEventType] = useState<StatusPageSubscriberNotificationEventType | undefined>(undefined);
  const [notificationMethod, setNotificationMethod] = useState<StatusPageSubscriberNotificationMethod | undefined>(undefined);

  useEffect(() => {
    // Fetch the template to get its event type
    const fetchTemplate = async (): Promise<void> => {
      try {
        const template = await ModelAPI.getItem<StatusPageSubscriberNotificationTemplate>({
          modelType: StatusPageSubscriberNotificationTemplate,
          id: modelId,
          select: {
            eventType: true,
            notificationMethod: true,
          },
        });
        if (template) {
          setEventType(template.eventType);
          setNotificationMethod(template.notificationMethod);
        }
      } catch (err) {
        // Handle error silently - the card will show generic variables
      }
    };
    fetchTemplate();
  }, [modelId]);

  const getTemplateBodyFieldType = (): FormFieldSchemaType => {
    if (notificationMethod === StatusPageSubscriberNotificationMethod.Email) {
      return FormFieldSchemaType.HTML;
    }
    return FormFieldSchemaType.LongText;
  };

  return (
    <Fragment>
      {/* Subscriber Notification Template Overview */}
      <CardModelDetail<StatusPageSubscriberNotificationTemplate>
        name="Subscriber Notification Template Details"
        cardProps={{
          title: "Template Overview",
          description:
            "Basic information about this subscriber notification template.",
        }}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        formSteps={[
          {
            title: "Template Info",
            id: "template-info",
          },
          {
            title: "Template Settings",
            id: "template-settings",
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
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: StatusPageSubscriberNotificationTemplate,
          id: "model-detail-subscriber-notification-template",
          fields: [
            {
              field: {
                _id: true,
              },
              title: "Template ID",
              fieldType: FieldType.ObjectID,
            },
            {
              field: {
                templateName: true,
              },
              title: "Template Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                templateDescription: true,
              },
              title: "Template Description",
              fieldType: FieldType.Text,
            },
            {
              field: {
                eventType: true,
              },
              title: "Event Type",
              fieldType: FieldType.Text,
            },
            {
              field: {
                notificationMethod: true,
              },
              title: "Notification Method",
              fieldType: FieldType.Text,
            },
            {
              field: {
                createdAt: true,
              },
              title: "Created",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                updatedAt: true,
              },
              title: "Updated",
              fieldType: FieldType.DateTime,
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Template Content Card */}
      <CardModelDetail<StatusPageSubscriberNotificationTemplate>
        name="Template Content"
        cardProps={{
          title: "Template Content",
          description:
            "The email subject and template body for this notification template.",
        }}
        createEditModalWidth={ModalWidth.Large}
        isEditable={true}
        formFields={[
          {
            field: {
              emailSubject: true,
            },
            title: "Email Subject",
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
            description:
              "The template content. For Email: Use HTML. For SMS: Use plain text. For Slack/Teams: Use Markdown. You can use template variables.",
            fieldType: getTemplateBodyFieldType(),
            required: true,
            placeholder:
              "<p>Hello,</p><p>{{incidentTitle}} has been created.</p>",
          },
        ]}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 1,
          modelType: StatusPageSubscriberNotificationTemplate,
          id: "model-detail-template-content",
          fields: [
            {
              field: {
                emailSubject: true,
              },
              title: "Email Subject",
              fieldType: FieldType.Text,
            },
            {
              field: {
                templateBody: true,
              },
              title: "Template Body",
              fieldType: FieldType.HTML,
            },
          ],
          modelId: modelId,
        }}
      />

      {/* Template Variables Reference */}
      <Card
        title="Template Variables Reference"
        description="Available variables you can use in your template body and email subject based on the selected event type."
      >
        <div className="p-4">
          <MarkdownViewer text={getVariablesDocumentation(eventType)} />
        </div>
      </Card>

      <ModelDelete
        modelType={StatusPageSubscriberNotificationTemplate}
        modelId={Navigation.getLastParamAsObjectID()}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteMap[
              PageMap.SETTINGS_STATUS_PAGE_SUBSCRIBER_NOTIFICATION_TEMPLATES
            ] as Route,
          );
        }}
      />
    </Fragment>
  );
};

export default SubscriberNotificationTemplateView;
