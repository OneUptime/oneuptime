import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";

/**
 * Get available template variables documentation based on event type.
 * Returns markdown formatted documentation for use in forms and views.
 */
export const getSubscriberNotificationTemplateVariablesDocumentation = (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
): string => {
  const commonVariablesRows: string = `| \`{{statusPageName}}\` | Name of the status page |
| \`{{statusPageUrl}}\` | URL of the status page |
| \`{{unsubscribeUrl}}\` | URL for subscribers to unsubscribe from notifications |
| \`{{resourcesAffected}}\` | List of affected resources/monitors |`;

  if (!eventType) {
    return `**Available Template Variables**

Please select an **Event Type** above to see all available variables for that event.

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
      exampleSubject =
        "{{statusPageName}}: {{incidentTitle}} - {{incidentState}}";
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
      exampleSubject =
        "{{statusPageName}}: Scheduled Maintenance - {{scheduledMaintenanceTitle}}";
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
      exampleSubject =
        "{{statusPageName}}: {{scheduledMaintenanceTitle}} - {{scheduledMaintenanceState}}";
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
      exampleSubject =
        "{{statusPageName}}: Update on {{scheduledMaintenanceTitle}}";
      exampleBody = `<h2>Update: {{scheduledMaintenanceTitle}}</h2>
<p><strong>Posted:</strong> {{postedAt}}</p>
<p>{{note}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>`;
      break;

    default:
      return `**Available Template Variables**

Please select an event type to see available variables.`;
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
