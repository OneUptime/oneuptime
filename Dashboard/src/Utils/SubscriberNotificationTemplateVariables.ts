import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";

/**
 * Get available template variables documentation based on event type and notification method.
 * Returns markdown formatted documentation for use in forms and views.
 */
export const getSubscriberNotificationTemplateVariablesDocumentation: (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
  notificationMethod?: StatusPageSubscriberNotificationMethod | undefined,
) => string = (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
  notificationMethod?: StatusPageSubscriberNotificationMethod | undefined,
): string => {
  const commonVariablesRows: string = `| \`{{statusPageName}}\` | Name of the status page |
| \`{{statusPageUrl}}\` | URL of the status page |
| \`{{unsubscribeUrl}}\` | URL for subscribers to unsubscribe from notifications |
| \`{{resourcesAffected}}\` | List of affected resources/monitors |`;

  const isEmail: boolean =
    notificationMethod === StatusPageSubscriberNotificationMethod.Email;
  const isSMS: boolean =
    notificationMethod === StatusPageSubscriberNotificationMethod.SMS;
  const isSlack: boolean =
    notificationMethod === StatusPageSubscriberNotificationMethod.Slack;
  const isTeams: boolean =
    notificationMethod ===
    StatusPageSubscriberNotificationMethod.MicrosoftTeams;

  if (!eventType) {
    return `**Available Template Variables**

Please select an **Event Type** above to see all available variables for that event.

| Variable | Description |
|----------|-------------|
${commonVariablesRows}`;
  }

  let eventSpecificRows: string = "";
  let exampleSubject: string = "";
  let exampleEmailBody: string = "";
  let exampleSMSBody: string = "";
  let exampleSlackBody: string = "";
  let exampleTeamsBody: string = "";

  switch (eventType) {
    case StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated:
      eventSpecificRows = `| \`{{incidentTitle}}\` | Title of the incident |
| \`{{incidentDescription}}\` | Description of the incident |
| \`{{incidentSeverity}}\` | Severity level of the incident |
| \`{{detailsUrl}}\` | URL to view incident details |`;
      exampleSubject = "{{statusPageName}}: {{incidentTitle}}";
      exampleEmailBody = `<h2>{{incidentTitle}}</h2>
<p>{{incidentDescription}}</p>
<p><strong>Severity:</strong> {{incidentSeverity}}</p>
<p><strong>Affected Resources:</strong> {{resourcesAffected}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>`;
      exampleSMSBody = `{{statusPageName}}: {{incidentTitle}} - {{incidentSeverity}}. {{incidentDescription}} Details: {{detailsUrl}}`;
      exampleSlackBody = `**{{incidentTitle}}**

{{incidentDescription}}

**Severity:** {{incidentSeverity}}
**Affected Resources:** {{resourcesAffected}}

[View Details]({{detailsUrl}})`;
      exampleTeamsBody = `**{{incidentTitle}}**

{{incidentDescription}}

**Severity:** {{incidentSeverity}}
**Affected Resources:** {{resourcesAffected}}

[View Details]({{detailsUrl}})`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged:
      eventSpecificRows = `| \`{{incidentTitle}}\` | Title of the incident |
| \`{{incidentDescription}}\` | Description of the incident |
| \`{{incidentSeverity}}\` | Severity level of the incident |
| \`{{incidentState}}\` | Current state of the incident (e.g., Investigating, Identified, Resolved) |
| \`{{detailsUrl}}\` | URL to view incident details |`;
      exampleSubject =
        "{{statusPageName}}: {{incidentTitle}} - {{incidentState}}";
      exampleEmailBody = `<h2>{{incidentTitle}}</h2>
<p>Status changed to: <strong>{{incidentState}}</strong></p>
<p>{{incidentDescription}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>`;
      exampleSMSBody = `{{statusPageName}}: {{incidentTitle}} is now {{incidentState}}. Details: {{detailsUrl}}`;
      exampleSlackBody = `**{{incidentTitle}}**

Status changed to: **{{incidentState}}**

{{incidentDescription}}

[View Details]({{detailsUrl}})`;
      exampleTeamsBody = `**{{incidentTitle}}**

Status changed to: **{{incidentState}}**

{{incidentDescription}}

[View Details]({{detailsUrl}})`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated:
      eventSpecificRows = `| \`{{incidentTitle}}\` | Title of the incident |
| \`{{incidentSeverity}}\` | Severity level of the incident |
| \`{{incidentState}}\` | Current state of the incident |
| \`{{postedAt}}\` | Date and time when the note was posted |
| \`{{note}}\` | Content of the note |
| \`{{detailsUrl}}\` | URL to view incident details |`;
      exampleSubject = "{{statusPageName}}: Update on {{incidentTitle}}";
      exampleEmailBody = `<h2>Update: {{incidentTitle}}</h2>
<p><strong>Posted:</strong> {{postedAt}}</p>
<p>{{note}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>`;
      exampleSMSBody = `{{statusPageName}}: Update on {{incidentTitle}} - {{note}} Details: {{detailsUrl}}`;
      exampleSlackBody = `**Update: {{incidentTitle}}**

**Posted:** {{postedAt}}

{{note}}

[View Details]({{detailsUrl}})`;
      exampleTeamsBody = `**Update: {{incidentTitle}}**

**Posted:** {{postedAt}}

{{note}}

[View Details]({{detailsUrl}})`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated:
      eventSpecificRows = `| \`{{announcementTitle}}\` | Title of the announcement |
| \`{{announcementDescription}}\` | Description/content of the announcement |
| \`{{detailsUrl}}\` | URL to view announcement details |`;
      exampleSubject = "{{statusPageName}}: {{announcementTitle}}";
      exampleEmailBody = `<h2>📢 {{announcementTitle}}</h2>
<p>{{announcementDescription}}</p>
<p><a href="{{detailsUrl}}">View Announcement</a></p>`;
      exampleSMSBody = `{{statusPageName}}: {{announcementTitle}} - {{announcementDescription}} Details: {{detailsUrl}}`;
      exampleSlackBody = `**{{announcementTitle}}**

{{announcementDescription}}

[View Announcement]({{detailsUrl}})`;
      exampleTeamsBody = `**{{announcementTitle}}**

{{announcementDescription}}

[View Announcement]({{detailsUrl}})`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated:
      eventSpecificRows = `| \`{{scheduledMaintenanceTitle}}\` | Title of the scheduled maintenance |
| \`{{scheduledMaintenanceDescription}}\` | Description of the scheduled maintenance |
| \`{{scheduledStartTime}}\` | When the maintenance is scheduled to start |
| \`{{scheduledEndTime}}\` | When the maintenance is scheduled to end |
| \`{{detailsUrl}}\` | URL to view scheduled maintenance details |`;
      exampleSubject =
        "{{statusPageName}}: Scheduled Maintenance - {{scheduledMaintenanceTitle}}";
      exampleEmailBody = `<h2>🔧 {{scheduledMaintenanceTitle}}</h2>
<p>{{scheduledMaintenanceDescription}}</p>
<p><strong>Start:</strong> {{scheduledStartTime}}</p>
<p><strong>End:</strong> {{scheduledEndTime}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>`;
      exampleSMSBody = `{{statusPageName}}: Maintenance scheduled - {{scheduledMaintenanceTitle}}. Start: {{scheduledStartTime}}, End: {{scheduledEndTime}}. Details: {{detailsUrl}}`;
      exampleSlackBody = `**{{scheduledMaintenanceTitle}}**

{{scheduledMaintenanceDescription}}

**Start:** {{scheduledStartTime}}
**End:** {{scheduledEndTime}}

[View Details]({{detailsUrl}})`;
      exampleTeamsBody = `**{{scheduledMaintenanceTitle}}**

{{scheduledMaintenanceDescription}}

**Start:** {{scheduledStartTime}}
**End:** {{scheduledEndTime}}

[View Details]({{detailsUrl}})`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceStateChanged:
      eventSpecificRows = `| \`{{scheduledMaintenanceTitle}}\` | Title of the scheduled maintenance |
| \`{{scheduledMaintenanceDescription}}\` | Description of the scheduled maintenance |
| \`{{scheduledMaintenanceState}}\` | Current state (e.g., Scheduled, In Progress, Completed) |
| \`{{detailsUrl}}\` | URL to view scheduled maintenance details |`;
      exampleSubject =
        "{{statusPageName}}: {{scheduledMaintenanceTitle}} - {{scheduledMaintenanceState}}";
      exampleEmailBody = `<h2>🔧 {{scheduledMaintenanceTitle}}</h2>
<p>Status changed to: <strong>{{scheduledMaintenanceState}}</strong></p>
<p>{{scheduledMaintenanceDescription}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>`;
      exampleSMSBody = `{{statusPageName}}: {{scheduledMaintenanceTitle}} is now {{scheduledMaintenanceState}}. Details: {{detailsUrl}}`;
      exampleSlackBody = `**{{scheduledMaintenanceTitle}}**

Status changed to: **{{scheduledMaintenanceState}}**

{{scheduledMaintenanceDescription}}

[View Details]({{detailsUrl}})`;
      exampleTeamsBody = `**{{scheduledMaintenanceTitle}}**

Status changed to: **{{scheduledMaintenanceState}}**

{{scheduledMaintenanceDescription}}

[View Details]({{detailsUrl}})`;
      break;

    case StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated:
      eventSpecificRows = `| \`{{scheduledMaintenanceTitle}}\` | Title of the scheduled maintenance |
| \`{{scheduledMaintenanceState}}\` | Current state of the scheduled maintenance |
| \`{{postedAt}}\` | Date and time when the note was posted |
| \`{{note}}\` | Content of the note |
| \`{{detailsUrl}}\` | URL to view scheduled maintenance details |`;
      exampleSubject =
        "{{statusPageName}}: Update on {{scheduledMaintenanceTitle}}";
      exampleEmailBody = `<h2>Update: {{scheduledMaintenanceTitle}}</h2>
<p><strong>Posted:</strong> {{postedAt}}</p>
<p>{{note}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>`;
      exampleSMSBody = `{{statusPageName}}: Update on {{scheduledMaintenanceTitle}} - {{note}} Details: {{detailsUrl}}`;
      exampleSlackBody = `**Update: {{scheduledMaintenanceTitle}}**

**Posted:** {{postedAt}}

{{note}}

[View Details]({{detailsUrl}})`;
      exampleTeamsBody = `**Update: {{scheduledMaintenanceTitle}}**

**Posted:** {{postedAt}}

{{note}}

[View Details]({{detailsUrl}})`;
      break;

    default:
      return `**Available Template Variables**

Please select an event type to see available variables.`;
  }

  // Build example section based on notification method
  let exampleSection: string = "";

  if (isSMS) {
    exampleSection = `**Example SMS:**
\`${exampleSMSBody}\``;
  } else if (isEmail) {
    exampleSection = `**Example Email Subject:** \`${exampleSubject}\`

**Example Email Body:**
\`\`\`html
${exampleEmailBody}
\`\`\``;
  } else if (isSlack) {
    exampleSection = `**Example Slack Message:**
\`\`\`
${exampleSlackBody}
\`\`\`

_Note: Use standard Markdown syntax (\`**text**\` for bold, \`[text](url)\` for links). It will be automatically converted to Slack's format._`;
  } else if (isTeams) {
    exampleSection = `**Example Microsoft Teams Message:**
\`\`\`
${exampleTeamsBody}
\`\`\`

_Note: Microsoft Teams uses Markdown syntax. Use \`**text**\` for bold and \`[text](url)\` for links._`;
  } else {
    // Default fallback - show email example
    exampleSection = `**Example Email Subject:** \`${exampleSubject}\`

**Example Email Body:**
\`\`\`html
${exampleEmailBody}
\`\`\``;
  }

  return `**Available Template Variables** - Use these variables in your template with the \`{{variableName}}\` syntax.

| Variable | Description |
|----------|-------------|
${commonVariablesRows}
${eventSpecificRows}

${exampleSection}`;
};
