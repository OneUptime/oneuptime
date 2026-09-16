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
 * - Webhook defaults reproduce the JSON payload the workers send when no
 *   custom template is configured, so a Webhook template saved unchanged keeps
 *   the payload webhook consumers already rely on. Variables are filled in as
 *   JSON-escaped text, which is why each one sits inside a JSON string.
 * - Only the event type / channel pairs a sender actually delivers have a
 *   default here (see SubscriberNotificationTemplateChannels).
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
      <p style="margin: 0; font-size: 15px; line-height: 24px; color: #0f172a; font-weight: 500;">${field.value}</p>
    </div>`;
    })
    .join("\n");

  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; width: 100%; max-width: 600px; box-sizing: border-box; margin: 0 auto; padding: 32px 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #475569; overflow-wrap: anywhere; word-break: break-word;">
  <h1 style="color: #0f172a; font-size: 28px; line-height: 36px; letter-spacing: -0.6px; font-weight: 700; margin: 0 0 16px 0;">${params.title}</h1>
  <p style="color: #475569; font-size: 15px; line-height: 24px; margin: 0 0 16px 0;">${params.intro}</p>
  <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 4px 20px; margin: 0 0 24px 0;">
${fieldsHtml}
  </div>
  <p style="margin: 0 0 24px 0;">
    <a href="${params.buttonUrl}" style="display: inline-block; max-width: 100%; box-sizing: border-box; text-align: center; line-height: 22px; background-color: #111111; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 600;">${params.buttonText}</a>
  </p>
  <p style="color: #64748b; font-size: 12px; line-height: 18px; margin: 32px 0 0 0;">
    If you no longer wish to receive these notifications, you can <a href="{{unsubscribeUrl}}" style="color: #64748b;">unsubscribe</a>.
  </p>
</div>`;
};

/*
 * The default webhook payload: a fixed envelope around event-specific `data`.
 * Each `data` entry is [payload key, value template].
 */
const buildWebhookJson: (
  eventType: string,
  data: Array<[string, string]>,
) => string = (eventType: string, data: Array<[string, string]>): string => {
  const dataJson: string = data
    .map(([key, value]: [string, string]): string => {
      return `    "${key}": "${value}"`;
    })
    .join(",\n");

  return `{
  "eventType": "${eventType}",
  "statusPageId": "{{statusPageId}}",
  "statusPageName": "{{statusPageName}}",
  "statusPageUrl": "{{statusPageUrl}}",
  "unsubscribeUrl": "{{unsubscribeUrl}}",
  "data": {
${dataJson}
  }
}`;
};

const INCIDENT_NOTE_WEBHOOK_DATA: Array<[string, string]> = [
  ["incidentId", "{{incidentId}}"],
  ["incidentNumber", "{{incidentNumber}}"],
  ["incidentTitle", "{{incidentTitle}}"],
  ["incidentSeverity", "{{incidentSeverity}}"],
  ["resourcesAffected", "{{resourcesAffected}}"],
  ["note", "{{note}}"],
  ["detailsUrl", "{{detailsUrl}}"],
];

const ANNOUNCEMENT_WEBHOOK_DATA: Array<[string, string]> = [
  ["announcementId", "{{announcementId}}"],
  ["announcementTitle", "{{announcementTitle}}"],
  ["announcementDescription", "{{announcementDescription}}"],
  ["detailsUrl", "{{detailsUrl}}"],
];

const SM_NOTE_WEBHOOK_DATA: Array<[string, string]> = [
  ["scheduledMaintenanceId", "{{scheduledMaintenanceId}}"],
  ["scheduledMaintenanceTitle", "{{scheduledMaintenanceTitle}}"],
  ["scheduledMaintenanceDescription", "{{scheduledMaintenanceDescription}}"],
  ["resourcesAffected", "{{resourcesAffected}}"],
  ["note", "{{note}}"],
  ["detailsUrl", "{{detailsUrl}}"],
];

// Episode payloads keep the incident* keys webhook consumers already read.
const EPISODE_NOTE_WEBHOOK_DATA: Array<[string, string]> = [
  ["episodeId", "{{episodeId}}"],
  ["episodeTitle", "{{episodeTitle}}"],
  ["incidentSeverity", "{{episodeSeverity}}"],
  ["resourcesAffected", "{{resourcesAffected}}"],
  ["note", "{{note}}"],
  ["detailsUrl", "{{detailsUrl}}"],
];

// The "you have subscribed" message Slack and Microsoft Teams subscribers get.
const SUBSCRIBED_CHAT_MESSAGE: string = `## 📢 New Subscription to {{statusPageName}}

**You have successfully subscribed to receive status updates!**

🔗 **Status Page:** [{{statusPageName}}]({{statusPageUrl}})
📧 **Manage Subscription:** [Update preferences or unsubscribe]({{unsubscribeUrl}})

You will receive real-time notifications for:
• Incidents and outages
• Scheduled maintenance events
• Service announcements
• Status updates

Stay informed about service availability! 🚀`;

const MANAGE_SUBSCRIPTION_MESSAGE: string = `You have selected to manage your subscription for the status page: {{statusPageName}}. You can manage your subscription here: {{manageSubscriptionUrl}}`;

const subscriptionConfirmationDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "{{statusPageName}} - Please confirm your subscription",
    body: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; width: 100%; max-width: 600px; box-sizing: border-box; margin: 0 auto; padding: 32px 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #475569; overflow-wrap: anywhere; word-break: break-word;">
  <h1 style="color: #0f172a; font-size: 28px; line-height: 36px; letter-spacing: -0.6px; font-weight: 700; margin: 0 0 16px 0;">{{statusPageName}} - Please confirm your subscription</h1>
  <p style="color: #475569; font-size: 15px; line-height: 24px; margin: 0 0 16px 0;">You will be the first to hear from us when there are any incidents, announcements or scheduled maintenance events.</p>
  <p style="margin: 0 0 24px 0;">
    <a href="{{confirmationUrl}}" style="display: inline-block; max-width: 100%; box-sizing: border-box; text-align: center; line-height: 22px; background-color: #111111; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 600;">Confirm Subscription</a>
  </p>
  <p style="color: #475569; font-size: 15px; line-height: 24px; margin: 0 0 4px 0;">You can also view the status page by visiting this link:</p>
  <p style="color: #475569; font-size: 15px; line-height: 24px; margin: 0 0 24px 0;"><a href="{{statusPageUrl}}" style="color: #111111; overflow-wrap: anywhere; word-break: break-all;">{{statusPageUrl}}</a></p>
  <p style="color: #64748b; font-size: 12px; line-height: 18px; margin: 32px 0 0 0;">
    If you no longer wish to receive these notifications, you can <a href="{{unsubscribeUrl}}" style="color: #64748b;">unsubscribe</a>.
  </p>
</div>`,
  },
};

const subscribedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "You have been subscribed to {{statusPageName}}",
    body: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; width: 100%; max-width: 600px; box-sizing: border-box; margin: 0 auto; padding: 32px 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #475569; overflow-wrap: anywhere; word-break: break-word;">
  <h1 style="color: #0f172a; font-size: 28px; line-height: 36px; letter-spacing: -0.6px; font-weight: 700; margin: 0 0 16px 0;">You have been subscribed to status page - {{statusPageName}}</h1>
  <p style="color: #475569; font-size: 15px; line-height: 24px; margin: 0 0 16px 0;">You will be the first to hear from us when there are any incidents, announcements or scheduled maintenance events.</p>
  <p style="margin: 0 0 24px 0;">
    <a href="{{statusPageUrl}}" style="display: inline-block; max-width: 100%; box-sizing: border-box; text-align: center; line-height: 22px; background-color: #111111; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 600;">Go to Status Page</a>
  </p>
  <p style="color: #475569; font-size: 15px; line-height: 24px; margin: 0 0 4px 0;">You can also view the status page by visiting this link:</p>
  <p style="color: #475569; font-size: 15px; line-height: 24px; margin: 0 0 24px 0;"><a href="{{statusPageUrl}}" style="color: #111111; overflow-wrap: anywhere; word-break: break-all;">{{statusPageUrl}}</a></p>
  <p style="color: #64748b; font-size: 12px; line-height: 18px; margin: 32px 0 0 0;">
    If you no longer wish to receive these notifications, you can <a href="{{unsubscribeUrl}}" style="color: #64748b;">unsubscribe</a>.
  </p>
</div>`,
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `You have been subscribed to {{statusPageName}}. To unsubscribe, click on the link: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: SUBSCRIBED_CHAT_MESSAGE,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: SUBSCRIBED_CHAT_MESSAGE,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: buildWebhookJson("SubscriberSubscribed", [
      ["message", "You have been subscribed to {{statusPageName}}."],
    ]),
  },
};

const manageSubscriptionDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "Manage your Subscription for {{statusPageName}}",
    body: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; width: 100%; max-width: 600px; box-sizing: border-box; margin: 0 auto; padding: 32px 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #475569; overflow-wrap: anywhere; word-break: break-word;">
  <h1 style="color: #0f172a; font-size: 28px; line-height: 36px; letter-spacing: -0.6px; font-weight: 700; margin: 0 0 16px 0;">{{statusPageName}} - Manage Subscription</h1>
  <p style="color: #475569; font-size: 15px; line-height: 24px; margin: 0 0 16px 0;">Please click on the link below to manage or unsubscribe from status page notifications.</p>
  <p style="margin: 0 0 24px 0;">
    <a href="{{manageSubscriptionUrl}}" style="display: inline-block; max-width: 100%; box-sizing: border-box; text-align: center; line-height: 22px; background-color: #111111; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 600;">Manage Subscription</a>
  </p>
  <p style="color: #475569; font-size: 15px; line-height: 24px; margin: 0 0 4px 0;">You can also view the status page by visiting this link:</p>
  <p style="color: #475569; font-size: 15px; line-height: 24px; margin: 0 0 24px 0;"><a href="{{statusPageUrl}}" style="color: #111111; overflow-wrap: anywhere; word-break: break-all;">{{statusPageUrl}}</a></p>
</div>`,
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: MANAGE_SUBSCRIPTION_MESSAGE,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: MANAGE_SUBSCRIPTION_MESSAGE,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: MANAGE_SUBSCRIPTION_MESSAGE,
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
    body: buildWebhookJson("IncidentCreated", [
      ["incidentId", "{{incidentId}}"],
      ["incidentNumber", "{{incidentNumber}}"],
      ["incidentTitle", "{{incidentTitle}}"],
      ["incidentDescription", "{{incidentDescription}}"],
      ["incidentSeverity", "{{incidentSeverity}}"],
      ["resourcesAffected", "{{resourcesAffected}}"],
      ["detailsUrl", "{{detailsUrl}}"],
    ]),
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
    body: buildWebhookJson("IncidentStateChanged", [
      ["incidentId", "{{incidentId}}"],
      ["incidentNumber", "{{incidentNumber}}"],
      ["incidentTitle", "{{incidentTitle}}"],
      ["incidentSeverity", "{{incidentSeverity}}"],
      ["incidentState", "{{incidentState}}"],
      ["resourcesAffected", "{{resourcesAffected}}"],
      ["detailsUrl", "{{detailsUrl}}"],
    ]),
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
    body: buildWebhookJson("IncidentNoteCreated", INCIDENT_NOTE_WEBHOOK_DATA),
  },
};

const incidentNoteUpdatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "Incident Note Updated: {{incidentTitle}}",
    body: buildEmailHtml({
      title: "Incident: {{incidentTitle}}",
      intro:
        "A note on this incident has been updated. Here is the latest version:",
      fields: [
        { label: "Incident Title", value: "{{incidentTitle}}" },
        { label: "Resources Affected", value: "{{resourcesAffected}}" },
        { label: "Severity", value: "{{incidentSeverity}}" },
        { label: "Updated Note", value: "{{note}}" },
      ],
      buttonUrl: "{{detailsUrl}}",
      buttonText: "View Incident Details",
    }),
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `Incident update: {{incidentTitle}} on {{statusPageName}}. A note has been updated. Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `## Incident - {{incidentTitle}}

**A note on this incident has been updated**

**Resources Affected:** {{resourcesAffected}}
**Severity:** {{incidentSeverity}}

**Note:**
{{note}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `## Incident - {{incidentTitle}}

**A note on this incident has been updated**

**Resources Affected:** {{resourcesAffected}}
**Severity:** {{incidentSeverity}}

**Note:**
{{note}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: buildWebhookJson("IncidentNoteUpdated", INCIDENT_NOTE_WEBHOOK_DATA),
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
    body: buildWebhookJson("IncidentPostmortemPublished", [
      ["incidentId", "{{incidentId}}"],
      ["incidentNumber", "{{incidentNumber}}"],
      ["incidentTitle", "{{incidentTitle}}"],
      ["incidentSeverity", "{{incidentSeverity}}"],
      ["resourcesAffected", "{{resourcesAffected}}"],
      ["postmortemNote", "{{postmortemNote}}"],
      ["detailsUrl", "{{detailsUrl}}"],
    ]),
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
    body: buildWebhookJson("AnnouncementCreated", ANNOUNCEMENT_WEBHOOK_DATA),
  },
};

const announcementUpdatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "📢 Announcement Updated: {{announcementTitle}}",
    body: buildEmailHtml({
      title: "📢 Announcement Updated: {{announcementTitle}}",
      intro:
        "An announcement on {{statusPageName}} has been updated. Here is the latest version.",
      fields: [
        { label: "Announcement", value: "{{announcementTitle}}" },
        { label: "Details", value: "{{announcementDescription}}" },
      ],
      buttonUrl: "{{detailsUrl}}",
      buttonText: "View Announcement",
    }),
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `Announcement updated: {{announcementTitle}} on {{statusPageName}}. Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `## 📢 Announcement Updated - {{announcementTitle}}

**Description:** {{announcementDescription}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `## 📢 Announcement Updated - {{announcementTitle}}

**Description:** {{announcementDescription}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: buildWebhookJson("AnnouncementUpdated", ANNOUNCEMENT_WEBHOOK_DATA),
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
    body: buildWebhookJson("ScheduledMaintenanceCreated", [
      ["scheduledMaintenanceId", "{{scheduledMaintenanceId}}"],
      ["scheduledMaintenanceTitle", "{{scheduledMaintenanceTitle}}"],
      [
        "scheduledMaintenanceDescription",
        "{{scheduledMaintenanceDescription}}",
      ],
      ["scheduledStartTime", "{{scheduledStartTime}}"],
      ["scheduledEndTime", "{{scheduledEndTime}}"],
      ["resourcesAffected", "{{resourcesAffected}}"],
      ["detailsUrl", "{{detailsUrl}}"],
    ]),
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
    body: buildWebhookJson("ScheduledMaintenanceStateChanged", [
      ["scheduledMaintenanceId", "{{scheduledMaintenanceId}}"],
      ["scheduledMaintenanceTitle", "{{scheduledMaintenanceTitle}}"],
      ["scheduledMaintenanceState", "{{scheduledMaintenanceState}}"],
      ["resourcesAffected", "{{resourcesAffected}}"],
      ["detailsUrl", "{{detailsUrl}}"],
    ]),
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
    body: buildWebhookJson(
      "ScheduledMaintenanceNoteCreated",
      SM_NOTE_WEBHOOK_DATA,
    ),
  },
};

const scheduledMaintenanceNoteUpdatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject:
      "Scheduled Maintenance Note Updated: {{scheduledMaintenanceTitle}}",
    body: buildEmailHtml({
      title: "Scheduled Maintenance: {{scheduledMaintenanceTitle}}",
      intro:
        "A note on this scheduled event has been updated. Here is the latest version:",
      fields: [
        { label: "Event Title", value: "{{scheduledMaintenanceTitle}}" },
        { label: "Updated Note", value: "{{note}}" },
      ],
      buttonUrl: "{{detailsUrl}}",
      buttonText: "View Maintenance Details",
    }),
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `Maintenance note updated: {{scheduledMaintenanceTitle}} on {{statusPageName}}. Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `## Scheduled Maintenance Update - {{statusPageName}}

**Event:** {{scheduledMaintenanceTitle}}

**Note Updated**

**Note:** {{note}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `## Scheduled Maintenance Update - {{statusPageName}}

**Event:** {{scheduledMaintenanceTitle}}

**Note Updated**

**Note:** {{note}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: buildWebhookJson(
      "ScheduledMaintenanceNoteUpdated",
      SM_NOTE_WEBHOOK_DATA,
    ),
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
    body: buildWebhookJson("EpisodeCreated", [
      ["episodeId", "{{episodeId}}"],
      ["episodeTitle", "{{episodeTitle}}"],
      ["episodeDescription", "{{episodeDescription}}"],
      ["incidentSeverity", "{{episodeSeverity}}"],
      ["resourcesAffected", "{{resourcesAffected}}"],
      ["detailsUrl", "{{detailsUrl}}"],
    ]),
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
    body: buildWebhookJson("EpisodeStateChanged", [
      ["episodeId", "{{episodeId}}"],
      ["episodeTitle", "{{episodeTitle}}"],
      ["incidentSeverity", "{{episodeSeverity}}"],
      ["incidentState", "{{episodeState}}"],
      ["resourcesAffected", "{{resourcesAffected}}"],
      ["detailsUrl", "{{detailsUrl}}"],
    ]),
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
    body: buildWebhookJson("EpisodeNoteCreated", EPISODE_NOTE_WEBHOOK_DATA),
  },
};

const episodeNoteUpdatedDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "Incident Note Updated: {{episodeTitle}}",
    body: buildEmailHtml({
      title: "Incident: {{episodeTitle}}",
      intro:
        "A note on this incident has been updated. Here is the latest version:",
      fields: [
        { label: "Incident Title", value: "{{episodeTitle}}" },
        { label: "Resources Affected", value: "{{resourcesAffected}}" },
        { label: "Severity", value: "{{episodeSeverity}}" },
        { label: "Updated Note", value: "{{note}}" },
      ],
      buttonUrl: "{{detailsUrl}}",
      buttonText: "View Incident Details",
    }),
  },
  [StatusPageSubscriberNotificationMethod.SMS]: {
    body: `Incident update: {{episodeTitle}} on {{statusPageName}}. A note has been updated. Details: {{detailsUrl}}. Unsub: {{unsubscribeUrl}}`,
  },
  [StatusPageSubscriberNotificationMethod.Slack]: {
    body: `## Incident - {{episodeTitle}}

**A note on this incident has been updated**

**Resources Affected:** {{resourcesAffected}}
**Severity:** {{episodeSeverity}}

**Note:**
{{note}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.MicrosoftTeams]: {
    body: `## Incident - {{episodeTitle}}

**A note on this incident has been updated**

**Resources Affected:** {{resourcesAffected}}
**Severity:** {{episodeSeverity}}

**Note:**
{{note}}

[View Status Page]({{statusPageUrl}}) | [Unsubscribe]({{unsubscribeUrl}})`,
  },
  [StatusPageSubscriberNotificationMethod.Webhook]: {
    body: buildWebhookJson("EpisodeNoteUpdated", EPISODE_NOTE_WEBHOOK_DATA),
  },
};

/*
 * The recurring report is the one subscriber notification rendered through the
 * real Handlebars engine (templateType omitted on the notification side), so
 * the default body below can use loops ({{#each report.resources}}) and
 * conditionals ({{#if report.totalResources}}) over the structured `report`
 * object. It is kept self-contained with inline CSS so it renders correctly in
 * email clients without depending on OneUptime's chrome partials (those remain
 * available to power users who add {{> Start this}} etc.).
 * Reports are sent by email only (Status Page > Reports), so there is no
 * default for any other channel.
 */
const reportDefaults: EventDefaults = {
  [StatusPageSubscriberNotificationMethod.Email]: {
    subject: "[Report] {{statusPageName}}",
    body: `<style>
  @media only screen and (max-width: 600px) {
    .st-StandaloneReport .st-ReportIndent { margin-left: 0 !important; }
    .st-StandaloneReport table[aria-label="Uptime by resource"] td { padding: 10px 6px !important; font-size: 12px !important; line-height: 18px !important; }
    .st-StandaloneReport table[aria-label="Uptime by resource"] th { padding: 10px 4px !important; font-size: 11px !important; line-height: 16px !important; }
  }
</style>
<div class="st-StandaloneReport" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; width: 100%; max-width: 600px; box-sizing: border-box; margin: 0 auto; padding: 32px 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #475569; overflow-wrap: anywhere; word-break: break-word;">
  <h1 style="color: #0f172a; font-size: 28px; line-height: 36px; letter-spacing: -0.6px; font-weight: 700; margin: 0 0 8px 0;">Uptime Report: {{statusPageName}}</h1>
  <p style="color: #475569; font-size: 15px; line-height: 24px; margin: 0 0 24px 0;">Here is your status summary for {{report.reportPeriodName}}.</p>
  {{#if report.totalResources}}
  <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px 24px; text-align: center; margin: 0 0 14px 0;">
    <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: 600; letter-spacing: 0.6px; text-transform: uppercase; color: #64748b;">Average Uptime</p>
    <p style="margin: 0; font-size: 44px; line-height: 52px; letter-spacing: -1.2px; font-weight: 700; color: #0f172a;">{{report.averageUptimePercent}}</p>
    <p style="margin: 10px 0 0 0; font-size: 13px; color: #64748b;">{{report.reportStartDate}} &ndash; {{report.reportEndDate}} ({{report.reportTimezone}})</p>
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width: 100%; table-layout: fixed; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin: 0 0 24px 0;">
    <tr>
      <td width="33%" align="center" style="padding: 18px 8px; border-right: 1px solid #e2e8f0;">
        <p style="margin: 0; font-size: 24px; font-weight: 700; color: #0f172a;">{{report.totalDowntimeInHoursAndMinutes}}</p>
        <p style="margin: 6px 0 0 0; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: #64748b;">Downtime</p>
      </td>
      <td width="33%" align="center" style="padding: 18px 8px; border-right: 1px solid #e2e8f0;">
        <p style="margin: 0; font-size: 24px; font-weight: 700; color: #0f172a;">{{report.totalIncidents}}</p>
        <p style="margin: 6px 0 0 0; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: #64748b;">Incidents</p>
      </td>
      <td width="34%" align="center" style="padding: 18px 8px;">
        <p style="margin: 0; font-size: 24px; font-weight: 700; color: #0f172a;">{{report.totalResources}}</p>
        <p style="margin: 6px 0 0 0; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: #64748b;">Resources</p>
      </td>
    </tr>
  </table>
  <h2 style="color: #0f172a; font-size: 16px; font-weight: 700; margin: 0 0 12px 0;">{{#if report.hasGroups}}Breakdown by group{{else}}Per-resource breakdown{{/if}}</h2>
  <table aria-label="Uptime by resource" width="100%" cellpadding="0" cellspacing="0" style="width: 100%; table-layout: fixed; overflow-wrap: anywhere; word-break: break-word; border-collapse: separate; border-spacing: 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin: 0 0 24px 0;">
    <thead>
      <tr>
        <th scope="col" width="34%" align="left" style="background-color: #f8fafc; color: #64748b; padding: 12px 8px; font-size: 12px; line-height: 18px; font-weight: 600;">{{#if report.hasGroups}}Group / Resource{{else}}Resource{{/if}}</th>
        <th scope="col" width="22%" align="right" style="background-color: #f8fafc; color: #64748b; padding: 12px 8px; font-size: 12px; line-height: 18px; font-weight: 600;">Uptime</th>
        <th scope="col" width="22%" align="right" style="background-color: #f8fafc; color: #64748b; padding: 12px 8px; font-size: 12px; line-height: 18px; font-weight: 600;">Downtime</th>
        <th scope="col" width="22%" align="right" style="background-color: #f8fafc; color: #64748b; padding: 12px 8px; font-size: 12px; line-height: 18px; font-weight: 600;">Incidents</th>
      </tr>
    </thead>
    <tbody>
      {{!-- report.rows is the status page's group hierarchy flattened into render order, so any depth of nesting renders without recursion. Loop over report.resources instead for a flat list. --}}
      {{#each report.rows}}
      {{#if this.isGroup}}
      <tr style="background-color: #f1f5f9;">
        <td align="left" style="padding: 12px 8px; border-top: 1px solid #e2e8f0; font-size: 13px; line-height: 20px; color: #0f172a; font-weight: 700;"><div class="st-ReportIndent" style="margin-left: {{this.indentInPixels}}px;">{{this.name}}</div></td>
        <td align="right" style="padding: 12px 8px; border-top: 1px solid #e2e8f0; font-size: 13px; line-height: 20px; color: #0f172a; font-weight: 700;">{{this.uptimePercentAsString}}</td>
        <td align="right" style="padding: 12px 8px; border-top: 1px solid #e2e8f0; font-size: 13px; line-height: 20px; color: #0f172a; font-weight: 600;">{{this.downtimeInHoursAndMinutes}}</td>
        <td align="right" style="padding: 12px 8px; border-top: 1px solid #e2e8f0; font-size: 13px; line-height: 20px; color: #0f172a; font-weight: 700;">{{this.totalIncidentCount}}</td>
      </tr>
      {{else}}
      <tr>
        <td align="left" style="padding: 12px 8px; border-top: 1px solid #e2e8f0; font-size: 13px; line-height: 20px; color: #475569; font-weight: 500;"><div class="st-ReportIndent" style="margin-left: {{this.indentInPixels}}px;">{{this.name}}</div></td>
        <td align="right" style="padding: 12px 8px; border-top: 1px solid #e2e8f0; font-size: 13px; line-height: 20px; color: #0f172a; font-weight: 600;">{{this.uptimePercentAsString}}</td>
        <td align="right" style="padding: 12px 8px; border-top: 1px solid #e2e8f0; font-size: 13px; line-height: 20px; color: #475569;">{{this.downtimeInHoursAndMinutes}}</td>
        <td align="right" style="padding: 12px 8px; border-top: 1px solid #e2e8f0; font-size: 13px; line-height: 20px; color: #0f172a; font-weight: 600;">{{this.totalIncidentCount}}</td>
      </tr>
      {{/if}}
      {{/each}}
    </tbody>
  </table>
  {{else}}
  <p style="color: #475569; font-size: 15px; line-height: 24px; margin: 0 0 24px 0;">No resources have been added to this status page yet, so there is nothing to report this period. Once you add resources, their uptime and incident history will appear in future reports.</p>
  {{/if}}
  <p style="margin: 0 0 24px 0;">
    <a href="{{detailsUrl}}" style="display: inline-block; max-width: 100%; box-sizing: border-box; text-align: center; line-height: 22px; background-color: #111111; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-size: 15px; font-weight: 600;">View Full Status Page</a>
  </p>
  {{#if subscriberEmailNotificationFooterText}}
  <p style="color: #64748b; font-size: 13px; line-height: 20px; margin: 0 0 16px 0;">{{subscriberEmailNotificationFooterText}}</p>
  {{/if}}
  {{#if unsubscribeUrl}}
  <p style="color: #64748b; font-size: 12px; line-height: 18px; margin: 32px 0 0 0;">
    If you no longer wish to receive these notifications, you can <a href="{{unsubscribeUrl}}" style="color: #64748b;">unsubscribe</a>.
  </p>
  {{/if}}
</div>`,
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
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated]:
    incidentNoteUpdatedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberIncidentPostmortemPublished]:
    incidentPostmortemPublishedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberAnnouncementCreated]:
    announcementCreatedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberAnnouncementUpdated]:
    announcementUpdatedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated]:
    scheduledMaintenanceCreatedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceStateChanged]:
    scheduledMaintenanceStateChangedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteCreated]:
    scheduledMaintenanceNoteCreatedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceNoteUpdated]:
    scheduledMaintenanceNoteUpdatedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeCreated]:
    episodeCreatedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeStateChanged]:
    episodeStateChangedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteCreated]:
    episodeNoteCreatedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberEpisodeNoteUpdated]:
    episodeNoteUpdatedDefaults,
  [StatusPageSubscriberNotificationEventType.SubscriberReport]: reportDefaults,
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
