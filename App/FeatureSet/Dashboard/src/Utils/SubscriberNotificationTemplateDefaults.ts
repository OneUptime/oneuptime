import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";

/*
 * Default subscriber notification templates that mirror what the workers send
 * when no custom template is configured.
 *
 * - SMS / Slack / Microsoft Teams strings are kept verbatim with the worker
 *   defaults (with hard-coded values swapped for `{{templateVariables}}`) so
 *   what the user sees here matches what subscribers actually receive.
 * - Email defaults are simplified, email-safe inline-CSS HTML that mirrors the
 *   structure (title + intro + key/value detail box + action button +
 *   unsubscribe footer) and reuses the wording from the corresponding
 *   handlebars templates in `App/FeatureSet/Notification/Templates/`.
 *   The actual default email is rendered through styled handlebars partials,
 *   but a custom `templateBody` is wrapped only by `BlankTemplate.hbs` (which
 *   is just `{{{body}}}`), so the user has to provide their own styling — the
 *   HTML below produces a similar visual result that is short enough to
 *   translate.
 * - Webhook defaults are best-effort JSON since the workers don't currently
 *   dispatch webhook notifications, but the form still allows creating these
 *   templates.
 */

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

const buildEmailHtml: (params: {
  title: string;
  intro: string;
  fields: Array<{ label: string; value: string }>;
  buttonUrl: string;
  buttonText: string;
}) => string = (params: {
  title: string;
  intro: string;
  fields: Array<{ label: string; value: string }>;
  buttonUrl: string;
  buttonText: string;
}): string => {
  const fieldsHtml: string = params.fields
    .map((field: { label: string; value: string }, index: number): string => {
      const isLast: boolean = index === params.fields.length - 1;
      const borderStyle: string = isLast
        ? ""
        : " border-bottom: 1px solid #e2e8f0;";
      return `    <div style="padding: 10px 0;${borderStyle}">
      <p style="margin: 0 0 4px 0; font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">${field.label}</p>
      <p style="margin: 0; font-size: 15px; color: #1e293b; font-weight: 500;">${field.value}</p>
    </div>`;
    })
    .join("\n");

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
  <h2 style="color: #1a1a2e; font-size: 24px; line-height: 32px; font-weight: 700; margin: 0 0 16px 0;">${params.title}</h2>
  <p style="color: #374151; font-size: 15px; line-height: 26px; margin: 0 0 16px 0;">${params.intro}</p>
  <div style="background-color: #f8fafc; border-radius: 8px; padding: 4px 20px; margin: 0 0 24px 0;">
${fieldsHtml}
  </div>
  <p style="margin: 0 0 24px 0;">
    <a href="${params.buttonUrl}" style="display: inline-block; background-color: #111827; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 600;">${params.buttonText}</a>
  </p>
  <p style="color: #6b7280; font-size: 12px; line-height: 18px; margin: 32px 0 0 0;">
    If you no longer wish to receive these notifications, you can <a href="{{unsubscribeUrl}}" style="color: #6b7280;">unsubscribe</a>.
  </p>
</div>`;
};

const subscriptionConfirmationDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "{{statusPageName}} - Please confirm your subscription",
    body: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
  <h2 style="color: #1a1a2e; font-size: 24px; line-height: 32px; font-weight: 700; margin: 0 0 16px 0;">{{statusPageName}} - Please confirm your subscription</h2>
  <p style="color: #374151; font-size: 15px; line-height: 26px; margin: 0 0 16px 0;">You will be the first to hear from us when there are any incidents, announcements or scheduled maintenance events.</p>
  <p style="margin: 0 0 24px 0;">
    <a href="{{confirmationUrl}}" style="display: inline-block; background-color: #111827; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 600;">Confirm Subscription</a>
  </p>
  <p style="color: #374151; font-size: 15px; line-height: 26px; margin: 0 0 4px 0;">You can also view the status page by visiting this link:</p>
  <p style="color: #374151; font-size: 15px; line-height: 26px; margin: 0 0 24px 0;"><a href="{{statusPageUrl}}" style="color: #4f46e5;">{{statusPageUrl}}</a></p>
  <p style="color: #6b7280; font-size: 12px; line-height: 18px; margin: 32px 0 0 0;">
    If you no longer wish to receive these notifications, you can <a href="{{unsubscribeUrl}}" style="color: #6b7280;">unsubscribe</a>.
  </p>
</div>`,
  },
};

const subscribedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "You have been subscribed to {{statusPageName}}",
    body: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
  <h2 style="color: #1a1a2e; font-size: 24px; line-height: 32px; font-weight: 700; margin: 0 0 16px 0;">You have been subscribed to status page - {{statusPageName}}</h2>
  <p style="color: #374151; font-size: 15px; line-height: 26px; margin: 0 0 16px 0;">You will be the first to hear from us when there are any incidents, announcements or scheduled maintenance events.</p>
  <p style="margin: 0 0 24px 0;">
    <a href="{{statusPageUrl}}" style="display: inline-block; background-color: #111827; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 600;">Go to Status Page</a>
  </p>
  <p style="color: #374151; font-size: 15px; line-height: 26px; margin: 0 0 4px 0;">You can also view the status page by visiting this link:</p>
  <p style="color: #374151; font-size: 15px; line-height: 26px; margin: 0 0 24px 0;"><a href="{{statusPageUrl}}" style="color: #4f46e5;">{{statusPageUrl}}</a></p>
  <p style="color: #6b7280; font-size: 12px; line-height: 18px; margin: 32px 0 0 0;">
    If you no longer wish to receive these notifications, you can <a href="{{unsubscribeUrl}}" style="color: #6b7280;">unsubscribe</a>.
  </p>
</div>`,
  },
};

const manageSubscriptionDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "Manage your Subscription for {{statusPageName}}",
    body: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
  <h2 style="color: #1a1a2e; font-size: 24px; line-height: 32px; font-weight: 700; margin: 0 0 16px 0;">{{statusPageName}} - Manage Subscription</h2>
  <p style="color: #374151; font-size: 15px; line-height: 26px; margin: 0 0 16px 0;">Please click on the link below to manage or unsubscribe from status page notifications.</p>
  <p style="margin: 0 0 24px 0;">
    <a href="{{manageSubscriptionUrl}}" style="display: inline-block; background-color: #111827; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 600;">Manage Subscription</a>
  </p>
  <p style="color: #374151; font-size: 15px; line-height: 26px; margin: 0 0 4px 0;">You can also view the status page by visiting this link:</p>
  <p style="color: #374151; font-size: 15px; line-height: 26px; margin: 0 0 24px 0;"><a href="{{statusPageUrl}}" style="color: #4f46e5;">{{statusPageUrl}}</a></p>
</div>`,
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `You have selected to manage your subscription for the status page: {{statusPageName}}. You can manage your subscription here: {{manageSubscriptionUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `You have selected to manage your subscription for the status page: {{statusPageName}}. You can manage your subscription here: {{manageSubscriptionUrl}}`,
  },
};

const incidentCreatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "New Incident: {{incidentTitle}}",
    body: buildEmailHtml({
      title: "New Incident: {{incidentTitle}}",
      intro:
        "A new incident has been reported that may affect the services you're subscribed to.",
      fields: [
        { label: "Incident", value: "{{incidentTitle}}" },
        { label: "Severity", value: "{{incidentSeverity}}" },
        { label: "Affected Resources", value: "{{resourcesAffected}}" },
        { label: "Description", value: "{{incidentDescription}}" },
      ],
      buttonUrl: "{{detailsUrl}}",
      buttonText: "View Incident Details",
    }),
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `Incident {{incidentTitle}} ({{incidentSeverity}}) on {{statusPageName}}. Impact: {{resourcesAffected}}. Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `## 🚨 Incident - {{incidentTitle}}

**Severity:** {{incidentSeverity}}

**Resources Affected:** {{resourcesAffected}}

**Description:** {{incidentDescription}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `## 🚨 Incident - {{incidentTitle}}
**Severity:** {{incidentSeverity}}
**Resources Affected:** {{resourcesAffected}}
**Description:** {{incidentDescription}}
[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "incident.created",
  "statusPage": "{{statusPageName}}",
  "statusPageUrl": "{{statusPageUrl}}",
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
    subject: "{{incidentTitle}} - {{incidentState}}",
    body: buildEmailHtml({
      title: "{{incidentTitle}}",
      intro:
        "The status of an incident affecting services you're subscribed to has been updated.",
      fields: [
        { label: "Incident", value: "{{incidentTitle}}" },
        { label: "Current State", value: "{{incidentState}}" },
        { label: "Severity", value: "{{incidentSeverity}}" },
        { label: "Affected Resources", value: "{{resourcesAffected}}" },
      ],
      buttonUrl: "{{detailsUrl}}",
      buttonText: "View Incident Details",
    }),
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `Incident {{incidentTitle}} on {{statusPageName}} is {{incidentState}}. Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `🚨 ## Incident - {{incidentTitle}}


**Resources Affected:** {{resourcesAffected}}
**Severity:** {{incidentSeverity}}
**Status:** {{incidentState}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `🚨 ## Incident - {{incidentTitle}}


**Resources Affected:** {{resourcesAffected}}
**Severity:** {{incidentSeverity}}
**Status:** {{incidentState}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "incident.stateChanged",
  "statusPage": "{{statusPageName}}",
  "statusPageUrl": "{{statusPageUrl}}",
  "incident": {
    "title": "{{incidentTitle}}",
    "description": "{{incidentDescription}}",
    "severity": "{{incidentSeverity}}",
    "state": "{{incidentState}}",
    "resourcesAffected": "{{resourcesAffected}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const incidentNoteCreatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "Incident: {{incidentTitle}}",
    body: buildEmailHtml({
      title: "Incident: {{incidentTitle}}",
      intro: "A new note has been added to the incident. Here are the details:",
      fields: [
        { label: "Incident Title", value: "{{incidentTitle}}" },
        { label: "Resources Affected", value: "{{resourcesAffected}}" },
        { label: "Severity", value: "{{incidentSeverity}}" },
        { label: "Note", value: "{{note}}" },
      ],
      buttonUrl: "{{detailsUrl}}",
      buttonText: "View Incident Details",
    }),
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `Incident update: {{incidentTitle}} on {{statusPageName}}. A new note is posted. Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `## Incident - {{incidentTitle}}

**New note has been added to an incident**

**Resources Affected:** {{resourcesAffected}}
**Severity:** {{incidentSeverity}}

**Note:**
{{note}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `## Incident - {{incidentTitle}}

**New note has been added to an incident**

**Resources Affected:** {{resourcesAffected}}
**Severity:** {{incidentSeverity}}

**Note:**
{{note}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "incident.noteCreated",
  "statusPage": "{{statusPageName}}",
  "statusPageUrl": "{{statusPageUrl}}",
  "incident": {
    "title": "{{incidentTitle}}",
    "severity": "{{incidentSeverity}}",
    "state": "{{incidentState}}",
    "resourcesAffected": "{{resourcesAffected}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "note": "{{note}}",
  "postedAt": "{{postedAt}}",
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const incidentPostmortemPublishedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "Postmortem Published: {{incidentTitle}}",
    body: buildEmailHtml({
      title: "Postmortem Published: {{incidentTitle}}",
      intro:
        "A postmortem report has been published for an incident that affected services you're subscribed to.",
      fields: [
        { label: "Incident", value: "{{incidentTitle}}" },
        { label: "Severity", value: "{{incidentSeverity}}" },
        { label: "Affected Resources", value: "{{resourcesAffected}}" },
        { label: "Postmortem Summary", value: "{{postmortemNote}}" },
      ],
      buttonUrl: "{{detailsUrl}}",
      buttonText: "Read Full Postmortem",
    }),
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `Postmortem: {{incidentTitle}} ({{incidentSeverity}}) on {{statusPageName}}. Impact: {{resourcesAffected}}. Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `## 🚨 Incident Postmortem - {{incidentTitle}}

**Severity:** {{incidentSeverity}}

**Resources Affected:** {{resourcesAffected}}

**Postmortem:** {{postmortemNote}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `## 🚨 Incident Postmortem - {{incidentTitle}}
**Severity:** {{incidentSeverity}}
**Resources Affected:** {{resourcesAffected}}
**Postmortem:** {{postmortemNote}}
[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "incident.postmortemPublished",
  "statusPage": "{{statusPageName}}",
  "statusPageUrl": "{{statusPageUrl}}",
  "incident": {
    "title": "{{incidentTitle}}",
    "severity": "{{incidentSeverity}}",
    "resourcesAffected": "{{resourcesAffected}}",
    "postmortemNote": "{{postmortemNote}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const announcementCreatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "📢 Announcement: {{announcementTitle}}",
    body: buildEmailHtml({
      title: "📢 Announcement: {{announcementTitle}}",
      intro: "A new announcement has been posted for {{statusPageName}}.",
      fields: [
        { label: "Announcement", value: "{{announcementTitle}}" },
        { label: "Details", value: "{{announcementDescription}}" },
      ],
      buttonUrl: "{{detailsUrl}}",
      buttonText: "View Announcement",
    }),
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `Announcement {{announcementTitle}} on {{statusPageName}}. Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `## 📢 Announcement - {{announcementTitle}}

**Description:** {{announcementDescription}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `## 📢 Announcement - {{announcementTitle}}

**Description:** {{announcementDescription}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "announcement.created",
  "statusPage": "{{statusPageName}}",
  "statusPageUrl": "{{statusPageUrl}}",
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
    subject: "Scheduled Maintenance: {{scheduledMaintenanceTitle}}",
    body: buildEmailHtml({
      title: "Scheduled Maintenance: {{scheduledMaintenanceTitle}}",
      intro:
        "A scheduled maintenance event has been announced for services you're subscribed to.",
      fields: [
        {
          label: "Maintenance Event",
          value: "{{scheduledMaintenanceTitle}}",
        },
        { label: "Status", value: "Scheduled" },
        { label: "Scheduled Start", value: "{{scheduledStartTime}}" },
        { label: "Scheduled End", value: "{{scheduledEndTime}}" },
        { label: "Affected Resources", value: "{{resourcesAffected}}" },
        { label: "Description", value: "{{scheduledMaintenanceDescription}}" },
      ],
      buttonUrl: "{{detailsUrl}}",
      buttonText: "View Maintenance Details",
    }),
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `Scheduled Maintenance: {{scheduledMaintenanceTitle}} on {{statusPageName}}. Impact: {{resourcesAffected}}. Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `## 🔧 Scheduled Maintenance - {{scheduledMaintenanceTitle}}

**Scheduled Date:** {{scheduledStartTime}}

**Resources Affected:** {{resourcesAffected}}

**Description:** {{scheduledMaintenanceDescription}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `## 🔧 Scheduled Maintenance - {{scheduledMaintenanceTitle}}

**Scheduled Date:** {{scheduledStartTime}}

**Resources Affected:** {{resourcesAffected}}

**Description:** {{scheduledMaintenanceDescription}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "scheduledMaintenance.created",
  "statusPage": "{{statusPageName}}",
  "statusPageUrl": "{{statusPageUrl}}",
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
      "Scheduled Maintenance: {{scheduledMaintenanceTitle}} - {{scheduledMaintenanceState}}",
    body: buildEmailHtml({
      title: "Scheduled Maintenance: {{scheduledMaintenanceTitle}}",
      intro: "Here are more details for this scheduled event:",
      fields: [
        { label: "Event Title", value: "{{scheduledMaintenanceTitle}}" },
        { label: "Event State", value: "{{scheduledMaintenanceState}}" },
        { label: "Resources Affected", value: "{{resourcesAffected}}" },
      ],
      buttonUrl: "{{detailsUrl}}",
      buttonText: "View Maintenance Details",
    }),
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `Maintenance {{scheduledMaintenanceTitle}} on {{statusPageName}} is {{scheduledMaintenanceState}}. Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `## Scheduled Maintenance State Update - {{statusPageName}}

**Event:** {{scheduledMaintenanceTitle}}

**State Changed To:** {{scheduledMaintenanceState}}

**Resources Affected:** {{resourcesAffected}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `## Scheduled Maintenance State Update - {{statusPageName}}
**Event:** {{scheduledMaintenanceTitle}}
**State Changed To:** {{scheduledMaintenanceState}}
**Resources Affected:** {{resourcesAffected}}
[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "scheduledMaintenance.stateChanged",
  "statusPage": "{{statusPageName}}",
  "statusPageUrl": "{{statusPageUrl}}",
  "scheduledMaintenance": {
    "title": "{{scheduledMaintenanceTitle}}",
    "description": "{{scheduledMaintenanceDescription}}",
    "state": "{{scheduledMaintenanceState}}",
    "resourcesAffected": "{{resourcesAffected}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const scheduledMaintenanceNoteCreatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "Scheduled Maintenance: {{scheduledMaintenanceTitle}}",
    body: buildEmailHtml({
      title: "Scheduled Maintenance: {{scheduledMaintenanceTitle}}",
      intro: "Here are more details for this scheduled event:",
      fields: [
        { label: "Event Title", value: "{{scheduledMaintenanceTitle}}" },
        {
          label: "Event Description",
          value: "{{scheduledMaintenanceDescription}}",
        },
        { label: "Resources Affected", value: "{{resourcesAffected}}" },
        { label: "Note", value: "{{note}}" },
      ],
      buttonUrl: "{{detailsUrl}}",
      buttonText: "View Maintenance Details",
    }),
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `Maintenance update: {{scheduledMaintenanceTitle}} on {{statusPageName}}. Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `## Scheduled Maintenance Update - {{statusPageName}}

**Event:** {{scheduledMaintenanceTitle}}

**New Note Added**

**Note:** {{note}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `## Scheduled Maintenance Update - {{statusPageName}}

**Event:** {{scheduledMaintenanceTitle}}

**New Note Added**

**Note:** {{note}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "scheduledMaintenance.noteCreated",
  "statusPage": "{{statusPageName}}",
  "statusPageUrl": "{{statusPageUrl}}",
  "scheduledMaintenance": {
    "title": "{{scheduledMaintenanceTitle}}",
    "description": "{{scheduledMaintenanceDescription}}",
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
    subject: "New Incident: {{episodeTitle}}",
    body: buildEmailHtml({
      title: "New Incident: {{episodeTitle}}",
      intro:
        "A new incident has been reported that may affect the services you're subscribed to.",
      fields: [
        { label: "Incident", value: "{{episodeTitle}}" },
        { label: "Severity", value: "{{episodeSeverity}}" },
        { label: "Affected Resources", value: "{{resourcesAffected}}" },
        { label: "Description", value: "{{episodeDescription}}" },
      ],
      buttonUrl: "{{detailsUrl}}",
      buttonText: "View Incident Details",
    }),
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `Incident {{episodeTitle}} ({{episodeSeverity}}) on {{statusPageName}}. Impact: {{resourcesAffected}}. Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `## 🚨 Incident - {{episodeTitle}}

**Severity:** {{episodeSeverity}}

**Resources Affected:** {{resourcesAffected}}

**Description:** {{episodeDescription}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `## 🚨 Incident - {{episodeTitle}}
**Severity:** {{episodeSeverity}}
**Resources Affected:** {{resourcesAffected}}
**Description:** {{episodeDescription}}
[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "episode.created",
  "statusPage": "{{statusPageName}}",
  "statusPageUrl": "{{statusPageUrl}}",
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
    subject: "{{episodeTitle}} - {{episodeState}}",
    body: buildEmailHtml({
      title: "{{episodeTitle}}",
      intro:
        "The status of an incident affecting services you're subscribed to has been updated.",
      fields: [
        { label: "Incident", value: "{{episodeTitle}}" },
        { label: "Current State", value: "{{episodeState}}" },
        { label: "Severity", value: "{{episodeSeverity}}" },
        { label: "Affected Resources", value: "{{resourcesAffected}}" },
      ],
      buttonUrl: "{{detailsUrl}}",
      buttonText: "View Incident Details",
    }),
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `Incident {{episodeTitle}} on {{statusPageName}} is {{episodeState}}. Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `🚨 ## Incident - {{episodeTitle}}


**Resources Affected:** {{resourcesAffected}}
**Severity:** {{episodeSeverity}}
**Status:** {{episodeState}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `🚨 ## Incident - {{episodeTitle}}


**Resources Affected:** {{resourcesAffected}}
**Severity:** {{episodeSeverity}}
**Status:** {{episodeState}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "episode.stateChanged",
  "statusPage": "{{statusPageName}}",
  "statusPageUrl": "{{statusPageUrl}}",
  "episode": {
    "title": "{{episodeTitle}}",
    "severity": "{{episodeSeverity}}",
    "state": "{{episodeState}}",
    "resourcesAffected": "{{resourcesAffected}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const episodeNoteCreatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "Incident: {{episodeTitle}}",
    body: buildEmailHtml({
      title: "Incident: {{episodeTitle}}",
      intro: "A new note has been added to the incident. Here are the details:",
      fields: [
        { label: "Incident Title", value: "{{episodeTitle}}" },
        { label: "Resources Affected", value: "{{resourcesAffected}}" },
        { label: "Severity", value: "{{episodeSeverity}}" },
        { label: "Note", value: "{{note}}" },
      ],
      buttonUrl: "{{detailsUrl}}",
      buttonText: "View Incident Details",
    }),
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `Incident update: {{episodeTitle}} on {{statusPageName}}. A new note is posted. Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `## Incident - {{episodeTitle}}

**New note has been added to an incident**

**Resources Affected:** {{resourcesAffected}}
**Severity:** {{episodeSeverity}}

**Note:**
{{note}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `## Incident - {{episodeTitle}}

**New note has been added to an incident**

**Resources Affected:** {{resourcesAffected}}
**Severity:** {{episodeSeverity}}

**Note:**
{{note}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: `{
  "event": "episode.noteCreated",
  "statusPage": "{{statusPageName}}",
  "statusPageUrl": "{{statusPageUrl}}",
  "episode": {
    "title": "{{episodeTitle}}",
    "severity": "{{episodeSeverity}}",
    "resourcesAffected": "{{resourcesAffected}}",
    "detailsUrl": "{{detailsUrl}}"
  },
  "note": "{{note}}",
  "unsubscribeUrl": "{{unsubscribeUrl}}"
}`,
  },
};

const defaultsByEvent: Record<
  StatusPageSubscriberNotificationEventType,
  EventDefaults
> = {
  [StatusPageSubscriberNotificationEventType.SubscriberSubscriptionConfirmation]:
    subscriptionConfirmationDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberSubscribed]:
    subscribedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberManageSubscription]:
    manageSubscriptionDefaults,
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
