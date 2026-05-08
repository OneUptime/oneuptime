import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";

export interface DefaultSubscriberNotificationTemplate {
  subject?: string;
  body: string;
}

type EventDefaults = Partial<
  Record<
    StatusPageSubscriberNotificationMethod,
    DefaultSubscriberNotificationTemplate
  >
>;

const incidentCreatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "{{statusPageName}}: {{incidentTitle}}",
    body: `<h2>{{incidentTitle}}</h2>
<p>{{incidentDescription}}</p>
<p><strong>Severity:</strong> {{incidentSeverity}}</p>
<p><strong>Affected Resources:</strong> {{resourcesAffected}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>
<p style="font-size: 12px; color: #888;"><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `{{statusPageName}}: {{incidentTitle}} - {{incidentSeverity}}. {{incidentDescription}} Details: {{detailsUrl}} Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `## :rotating_light: Incident - {{incidentTitle}}

**Severity:** {{incidentSeverity}}
**Affected Resources:** {{resourcesAffected}}
**Description:** {{incidentDescription}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `## Incident - {{incidentTitle}}
**Severity:** {{incidentSeverity}}
**Affected Resources:** {{resourcesAffected}}
**Description:** {{incidentDescription}}
[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "incident.created",
  "statusPage": "{{statusPageName}}",
  "incident": {
    "title": "{{incidentTitle}}",
    "description": "{{incidentDescription}}",
    "severity": "{{incidentSeverity}}",
    "resourcesAffected": "{{resourcesAffected}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const incidentStateChangedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "{{statusPageName}}: {{incidentTitle}} - {{incidentState}}",
    body: `<h2>{{incidentTitle}}</h2>
<p>Status changed to: <strong>{{incidentState}}</strong></p>
<p>{{incidentDescription}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>
<p style="font-size: 12px; color: #888;"><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `{{statusPageName}}: {{incidentTitle}} is now {{incidentState}}. Details: {{detailsUrl}} Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `**{{incidentTitle}}**

Status changed to: **{{incidentState}}**

{{incidentDescription}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `**{{incidentTitle}}**

Status changed to: **{{incidentState}}**

{{incidentDescription}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "incident.stateChanged",
  "statusPage": "{{statusPageName}}",
  "incident": {
    "title": "{{incidentTitle}}",
    "description": "{{incidentDescription}}",
    "severity": "{{incidentSeverity}}",
    "state": "{{incidentState}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const incidentNoteCreatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "{{statusPageName}}: Update on {{incidentTitle}}",
    body: `<h2>Update: {{incidentTitle}}</h2>
<p><strong>Posted:</strong> {{postedAt}}</p>
<p>{{note}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>
<p style="font-size: 12px; color: #888;"><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `{{statusPageName}}: Update on {{incidentTitle}} - {{note}} Details: {{detailsUrl}} Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `**Update: {{incidentTitle}}**

**Posted:** {{postedAt}}

{{note}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `**Update: {{incidentTitle}}**

**Posted:** {{postedAt}}

{{note}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "incident.noteCreated",
  "statusPage": "{{statusPageName}}",
  "incident": {
    "title": "{{incidentTitle}}",
    "severity": "{{incidentSeverity}}",
    "state": "{{incidentState}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "note": "{{note}}",
  "postedAt": "{{postedAt}}",
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const announcementCreatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "{{statusPageName}}: {{announcementTitle}}",
    body: `<h2>{{announcementTitle}}</h2>
<p>{{announcementDescription}}</p>
<p><a href="{{detailsUrl}}">View Announcement</a></p>
<p style="font-size: 12px; color: #888;"><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `{{statusPageName}}: {{announcementTitle}} - {{announcementDescription}} Details: {{detailsUrl}} Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `**{{announcementTitle}}**

{{announcementDescription}}

[View Announcement]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `**{{announcementTitle}}**

{{announcementDescription}}

[View Announcement]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "announcement.created",
  "statusPage": "{{statusPageName}}",
  "announcement": {
    "title": "{{announcementTitle}}",
    "description": "{{announcementDescription}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const scheduledMaintenanceCreatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject:
      "{{statusPageName}}: Scheduled Maintenance - {{scheduledMaintenanceTitle}}",
    body: `<h2>{{scheduledMaintenanceTitle}}</h2>
<p>{{scheduledMaintenanceDescription}}</p>
<p><strong>Start:</strong> {{scheduledStartTime}}</p>
<p><strong>End:</strong> {{scheduledEndTime}}</p>
<p><strong>Affected Resources:</strong> {{resourcesAffected}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>
<p style="font-size: 12px; color: #888;"><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `{{statusPageName}}: Maintenance scheduled - {{scheduledMaintenanceTitle}}. Start: {{scheduledStartTime}}, End: {{scheduledEndTime}}. Details: {{detailsUrl}} Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `**{{scheduledMaintenanceTitle}}**

{{scheduledMaintenanceDescription}}

**Start:** {{scheduledStartTime}}
**End:** {{scheduledEndTime}}
**Affected Resources:** {{resourcesAffected}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `**{{scheduledMaintenanceTitle}}**

{{scheduledMaintenanceDescription}}

**Start:** {{scheduledStartTime}}
**End:** {{scheduledEndTime}}
**Affected Resources:** {{resourcesAffected}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "scheduledMaintenance.created",
  "statusPage": "{{statusPageName}}",
  "scheduledMaintenance": {
    "title": "{{scheduledMaintenanceTitle}}",
    "description": "{{scheduledMaintenanceDescription}}",
    "scheduledStartTime": "{{scheduledStartTime}}",
    "scheduledEndTime": "{{scheduledEndTime}}",
    "resourcesAffected": "{{resourcesAffected}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const scheduledMaintenanceStateChangedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject:
      "{{statusPageName}}: {{scheduledMaintenanceTitle}} - {{scheduledMaintenanceState}}",
    body: `<h2>{{scheduledMaintenanceTitle}}</h2>
<p>Status changed to: <strong>{{scheduledMaintenanceState}}</strong></p>
<p>{{scheduledMaintenanceDescription}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>
<p style="font-size: 12px; color: #888;"><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `{{statusPageName}}: {{scheduledMaintenanceTitle}} is now {{scheduledMaintenanceState}}. Details: {{detailsUrl}} Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `**{{scheduledMaintenanceTitle}}**

Status changed to: **{{scheduledMaintenanceState}}**

{{scheduledMaintenanceDescription}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `**{{scheduledMaintenanceTitle}}**

Status changed to: **{{scheduledMaintenanceState}}**

{{scheduledMaintenanceDescription}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "scheduledMaintenance.stateChanged",
  "statusPage": "{{statusPageName}}",
  "scheduledMaintenance": {
    "title": "{{scheduledMaintenanceTitle}}",
    "description": "{{scheduledMaintenanceDescription}}",
    "state": "{{scheduledMaintenanceState}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const scheduledMaintenanceNoteCreatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "{{statusPageName}}: Update on {{scheduledMaintenanceTitle}}",
    body: `<h2>Update: {{scheduledMaintenanceTitle}}</h2>
<p><strong>Posted:</strong> {{postedAt}}</p>
<p>{{note}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>
<p style="font-size: 12px; color: #888;"><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `{{statusPageName}}: Update on {{scheduledMaintenanceTitle}} - {{note}} Details: {{detailsUrl}} Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `**Update: {{scheduledMaintenanceTitle}}**

**Posted:** {{postedAt}}

{{note}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `**Update: {{scheduledMaintenanceTitle}}**

**Posted:** {{postedAt}}

{{note}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "scheduledMaintenance.noteCreated",
  "statusPage": "{{statusPageName}}",
  "scheduledMaintenance": {
    "title": "{{scheduledMaintenanceTitle}}",
    "state": "{{scheduledMaintenanceState}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "note": "{{note}}",
  "postedAt": "{{postedAt}}",
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const episodeCreatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "{{statusPageName}}: {{episodeTitle}}",
    body: `<h2>{{episodeTitle}}</h2>
<p>{{episodeDescription}}</p>
<p><strong>Severity:</strong> {{episodeSeverity}}</p>
<p><strong>Affected Resources:</strong> {{resourcesAffected}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>
<p style="font-size: 12px; color: #888;"><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `{{statusPageName}}: {{episodeTitle}} - {{episodeSeverity}}. {{episodeDescription}} Details: {{detailsUrl}} Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `**{{episodeTitle}}**

{{episodeDescription}}

**Severity:** {{episodeSeverity}}
**Affected Resources:** {{resourcesAffected}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `**{{episodeTitle}}**

{{episodeDescription}}

**Severity:** {{episodeSeverity}}
**Affected Resources:** {{resourcesAffected}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "episode.created",
  "statusPage": "{{statusPageName}}",
  "episode": {
    "title": "{{episodeTitle}}",
    "description": "{{episodeDescription}}",
    "severity": "{{episodeSeverity}}",
    "resourcesAffected": "{{resourcesAffected}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const episodeStateChangedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "{{statusPageName}}: {{episodeTitle}} - {{episodeState}}",
    body: `<h2>{{episodeTitle}}</h2>
<p>Status changed to: <strong>{{episodeState}}</strong></p>
<p><strong>Severity:</strong> {{episodeSeverity}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>
<p style="font-size: 12px; color: #888;"><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `{{statusPageName}}: {{episodeTitle}} is now {{episodeState}}. Details: {{detailsUrl}} Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `**{{episodeTitle}}**

Status changed to: **{{episodeState}}**

**Severity:** {{episodeSeverity}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `**{{episodeTitle}}**

Status changed to: **{{episodeState}}**

**Severity:** {{episodeSeverity}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "episode.stateChanged",
  "statusPage": "{{statusPageName}}",
  "episode": {
    "title": "{{episodeTitle}}",
    "severity": "{{episodeSeverity}}",
    "state": "{{episodeState}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const episodeNoteCreatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "{{statusPageName}}: Update on {{episodeTitle}}",
    body: `<h2>Update: {{episodeTitle}}</h2>
<p>{{note}}</p>
<p><a href="{{detailsUrl}}">View Details</a></p>
<p style="font-size: 12px; color: #888;"><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `{{statusPageName}}: Update on {{episodeTitle}} - {{note}} Details: {{detailsUrl}} Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `**Update: {{episodeTitle}}**

{{note}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `**Update: {{episodeTitle}}**

{{note}}

[View Details]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "episode.noteCreated",
  "statusPage": "{{statusPageName}}",
  "episode": {
    "title": "{{episodeTitle}}",
    "severity": "{{episodeSeverity}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "note": "{{note}}",
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const incidentPostmortemPublishedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "{{statusPageName}}: Postmortem - {{incidentTitle}}",
    body: `<h2>Postmortem: {{incidentTitle}}</h2>
<p>A postmortem has been published for this incident.</p>
<p><a href="{{detailsUrl}}">View Postmortem</a></p>
<p style="font-size: 12px; color: #888;"><a href="{{unsubscribeUrl}}">Unsubscribe</a></p>`,
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `{{statusPageName}}: Postmortem published for {{incidentTitle}}. Details: {{detailsUrl}} Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `**Postmortem: {{incidentTitle}}**

A postmortem has been published for this incident.

[View Postmortem]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `**Postmortem: {{incidentTitle}}**

A postmortem has been published for this incident.

[View Postmortem]({{detailsUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "incident.postmortemPublished",
  "statusPage": "{{statusPageName}}",
  "incident": {
    "title": "{{incidentTitle}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const defaultsByEvent: Record<
  StatusPageSubscriberNotificationEventType,
  EventDefaults
> = {
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated]:
    incidentCreatedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentStateChanged]:
    incidentStateChangedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated]:
    incidentNoteCreatedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished]:
    incidentPostmortemPublishedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated]:
    announcementCreatedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated]:
    scheduledMaintenanceCreatedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceStateChanged]:
    scheduledMaintenanceStateChangedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated]:
    scheduledMaintenanceNoteCreatedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated]:
    episodeCreatedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeStateChanged]:
    episodeStateChangedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated]:
    episodeNoteCreatedDefaults,
};

export const getDefaultSubscriberNotificationTemplate: (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
  notificationMethod: StatusPageSubscriberNotificationMethod,
) => DefaultSubscriberNotificationTemplate | null = (
  eventType: StatusPageSubscriberNotificationEventType | undefined,
  notificationMethod: StatusPageSubscriberNotificationMethod,
): DefaultSubscriberNotificationTemplate | null => {
  if (!eventType) {
    return null;
  }

  return defaultsByEvent[eventType]?.[notificationMethod] || null;
};

export const getDefaultTemplateLanguage: (
  notificationMethod: StatusPageSubscriberNotificationMethod,
) => string = (
  notificationMethod: StatusPageSubscriberNotificationMethod,
): string => {
  switch (notificationMethod) {
    case StatusPageSubscriberNotificationMethod.Email:
      return "html";
    case StatusPageSubscriberNotificationMethod.Webhook:
      return "json";
    case StatusPageSubscriberNotificationMethod.Slack:
    case StatusPageSubscriberNotificationMethod.MicrosoftTeams:
      return "markdown";
    case StatusPageSubscriberNotificationMethod.SMS:
    default:
      return "text";
  }
};
