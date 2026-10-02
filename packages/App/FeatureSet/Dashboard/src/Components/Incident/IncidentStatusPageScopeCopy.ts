/*
 * Every piece of text the dashboard shows about limiting an incident to some
 * status pages (Incident.statusPages): the picker, its warnings, the
 * incident's 'Status page scope' card, and the "Will notify" audience summary.
 *
 * Kept in one React-free module so the pages and components render these
 * exact strings, and App/Tests can check that every one of them has an entry
 * in all seventeen Dashboard locale files - the dashboard translates a string
 * by looking up its English text, so a string with no entry silently stays
 * English.
 *
 * Strings with {{placeholders}} are filled in by formatScopeText after the
 * lookup, so the translations keep the placeholders (i18n:validate checks).
 */

export const IncidentStatusPageScopeCopy: {
  // The picker, wherever an incident or an incident template is edited.
  pickerTitle: string;
  pickerDescription: string;
  pickerPlaceholder: string;
  templatePickerDescription: string;
  noScopeSummary: string;

  // Warnings next to the picker and the fields it interacts with.
  changeMonitorStatusWarning: string;
  privateIncidentWarning: string;
  notListingMonitorsWarning: string;
  removingNotifiedPagesWarning: string;
  clearingScopeWarning: string;
  scopedToDeletedPagesWarning: string;
  templateScopedToDeletedPagesWarning: string;
  declaringFromTemplateScopedToDeletedPagesWarning: string;

  // The incident's Settings tab.
  settingsCardTitle: string;
  settingsCardDescription: string;
  settingsEditButton: string;
  scopeFieldTitle: string;

  // The incident overview.
  overviewFieldTitle: string;
  overviewEditLink: string;

  // The incidents table.
  tableFilterLabel: string;
  tableFilterSearchPlaceholder: string;

  // The status page's settings.
  onlyShowScopedIncidentsTitle: string;
  onlyShowScopedIncidentsDescription: string;

  // The audience summary.
  audienceLoading: string;
  audienceError: string;
  audienceWillNotify: string;
  audiencePageWithCounts: string;
  audiencePageWithoutSubscribers: string;
  audienceEmailCount: string;
  audienceSmsCount: string;
  audienceSlackCount: string;
  audienceMicrosoftTeamsCount: string;
  audienceWebhookCount: string;
  audienceOneHiddenPage: string;
  audienceHiddenPages: string;
  audienceOnceEachNote: string;
  audienceUpToNote: string;
  audienceNotNotified: string;
  audienceOutsideScope: string;
  audienceOnlyShowsScoped: string;
  audienceHidesIncidents: string;
  audienceAlreadyNotified: string;
  audienceNotListingMonitors: string;
  audienceNoMonitors: string;
  audienceNoStatusPages: string;
  audienceNoSubscribers: string;
  audienceHiddenIncident: string;
  audienceNotifyOff: string;
  audiencePrivateIncident: string;
} = {
  pickerTitle: "Limit to these status pages",
  pickerDescription:
    "Optional. Leave empty to show this incident on, and notify the subscribers of, every status page that lists its monitors. When you pick pages, only the picked pages among those are used. Use the Labels tab to add every page with a label.",
  pickerPlaceholder: "Every status page that lists the monitors",
  templatePickerDescription:
    "Optional. Incidents declared from this template are limited to these status pages: they show on, and notify the subscribers of, only these pages among the status pages that list their monitors.",
  noScopeSummary:
    "Not limited: shown on, and notifies, every status page that lists its monitors.",

  changeMonitorStatusWarning:
    "A monitor's status is shared by every status page that lists it. Changing it here also changes it on status pages this incident is not limited to.",
  privateIncidentWarning:
    "Private incidents are hidden from all status pages, including the ones this incident is limited to, and notify no subscribers.",
  notListingMonitorsWarning:
    "These status pages list none of this incident's monitors, so it will not show on them or notify their subscribers: {{names}}.",
  removingNotifiedPagesWarning:
    "These status pages were already told about this incident: {{names}}. Once removed, they will not hear about it again, including when it is resolved. Consider posting a closing public note before you remove them.",
  clearingScopeWarning:
    "With no status pages picked, this incident is shown on, and notifies, every status page that lists its monitors (except pages that only show incidents limited to them).",
  scopedToDeletedPagesWarning:
    "This incident is limited to status pages that have all been deleted, so it is not shown on any status page and notifies no one. Pick status pages to show it again, or clear the list to show it on every status page that lists its monitors.",
  templateScopedToDeletedPagesWarning:
    "This template was limited to status pages that have all been deleted. Incidents declared from it through the API are not shown on any status page, and the Declare Incident form starts with no status page picked. Pick status pages here, or save the list empty to stop limiting incidents declared from this template.",
  declaringFromTemplateScopedToDeletedPagesWarning:
    "The template you are declaring from was limited to status pages that have all been deleted. Pick the status pages this incident is for. Left empty, it is shown on, and notifies, every status page that lists its monitors.",

  settingsCardTitle: "Status Page Scope",
  settingsCardDescription:
    "Limit this incident to some of the status pages that list its monitors. It is shown on, and notifies the subscribers of, only those pages.",
  settingsEditButton: "Edit Status Page Scope",
  scopeFieldTitle: "Limited to Status Pages",

  overviewFieldTitle: "Status Page Scope",
  overviewEditLink: "Change in Settings",

  tableFilterLabel: "Status Page",
  tableFilterSearchPlaceholder: "Search status pages...",

  onlyShowScopedIncidentsTitle: "Only Show Incidents Scoped to This Page",
  onlyShowScopedIncidentsDescription:
    "When on, this status page shows, and notifies its subscribers about, only the incidents limited to it. Incidents that are not limited to any status page - including ones created automatically from a monitor, Slack, Microsoft Teams, the API or AI - never reach it until someone adds this page to them.",

  audienceLoading: "Working out who will be notified...",
  audienceError: "Could not work out who will be notified.",
  audienceWillNotify: "Will notify:",
  audiencePageWithCounts: "{{name}} (up to {{counts}})",
  audiencePageWithoutSubscribers: "{{name}} (no subscribers yet)",
  audienceEmailCount: "{{number}} email",
  audienceSmsCount: "{{number}} SMS",
  audienceSlackCount: "{{number}} Slack",
  audienceMicrosoftTeamsCount: "{{number}} Microsoft Teams",
  audienceWebhookCount: "{{number}} webhook",
  audienceOneHiddenPage: "1 more status page you do not have access to",
  audienceHiddenPages: "{{number}} more status pages you do not have access to",
  audienceOnceEachNote:
    "Someone subscribed to more than one of these pages gets one email or text message, not one per page.",
  audienceUpToNote:
    "Counts are the most that will be sent: subscribers who chose only some resources or event types may not get this one.",
  audienceNotNotified: "Not notified:",
  audienceOutsideScope:
    "{{name}} (not one of the pages this incident is limited to)",
  audienceOnlyShowsScoped: "{{name}} (only shows incidents limited to it)",
  audienceHidesIncidents: "{{name}} (does not show incidents)",
  audienceAlreadyNotified: "{{name}} (already sent this notification in full)",
  audienceNotListingMonitors: "{{name}} (lists none of these monitors)",
  audienceNoMonitors:
    "No status page subscribers will be notified: no monitors are attached. Subscribers hear about an incident through the monitors their status pages list.",
  audienceNoStatusPages:
    "No status page subscribers will be notified: no status page that lists these monitors will show this incident.",
  audienceNoSubscribers:
    "No one will be notified: these status pages have no subscribers yet.",
  audienceHiddenIncident:
    "Nothing will be sent: this incident is hidden from status pages.",
  audienceNotifyOff:
    "Status page subscribers will not be notified: 'Notify Status Page Subscribers' is off.",
  audiencePrivateIncident:
    "Nothing will be sent: private incidents are hidden from all status pages.",
};

// Fills {{placeholders}} in a looked-up string.
export const formatScopeText: (
  text: string,
  values: Record<string, string | number>,
) => string = (
  text: string,
  values: Record<string, string | number>,
): string => {
  let formatted: string = text;

  for (const [key, value] of Object.entries(values)) {
    formatted = formatted.split(`{{${key}}}`).join(String(value));
  }

  return formatted;
};

export default IncidentStatusPageScopeCopy;
