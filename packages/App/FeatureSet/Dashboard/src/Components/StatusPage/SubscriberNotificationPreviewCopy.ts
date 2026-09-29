/*
 * Every piece of text the dashboard shows about previewing status page
 * subscriber notifications: the 'Preview notification' dialog on declaring an
 * incident and on writing a public note, its 'Send test to me', and the live
 * preview in the subscriber notification template editor.
 *
 * Kept in one React-free module so the components render these exact
 * strings, and App/Tests can check that every one of them has an entry in all
 * seventeen Dashboard locale files - the dashboard translates a string by
 * looking up its English text, so a string with no entry silently stays
 * English.
 *
 * Strings with {{placeholders}} are filled in by formatPreviewText after the
 * lookup, so the translations keep the placeholders (i18n:validate checks).
 */

export const SubscriberNotificationPreviewCopy: {
  // The button, and the dialog it opens.
  previewButton: string;
  previewButtonDisabledNoNote: string;
  dialogTitle: string;
  dialogDescription: string;
  loading: string;
  loadError: string;
  statusPageSelectLabel: string;
  subjectLabel: string;
  emailFrameTitle: string;
  sampleUnsubscribeLinkNote: string;

  // Nothing will be sent.
  nothingWillBeSent: string;
  noMonitors: string;
  hiddenIncident: string;
  privateIncident: string;
  notifyOff: string;
  noStatusPages: string;

  // Pages the caller cannot see.
  oneHiddenPageNotPreviewed: string;
  hiddenPagesNotPreviewed: string;

  // Which template, and why.
  customTemplateUsed: string;
  defaultNoCustomTemplate: string;
  defaultCustomTemplateNeedsSmtp: string;
  defaultCustomTemplateEmpty: string;

  // "Send test to me".
  sendTestButton: string;
  sendTestDescription: string;
  sendTestSent: string;
  sendTestError: string;

  // The template editor's live preview.
  livePreviewTitle: string;
  livePreviewDescription: string;
  livePreviewPickEventType: string;
  livePreviewEmptyTemplate: string;
  livePreviewNoSubject: string;
  livePreviewUnknownPlaceholders: string;
  livePreviewReportUnavailable: string;
} = {
  previewButton: "Preview notification",
  previewButtonDisabledNoNote:
    "Write the note first to preview the email it sends.",
  dialogTitle: "Preview notification",
  dialogDescription:
    "The email each status page's subscribers will get, from the same template and settings the notification is sent with.",
  loading: "Building the preview...",
  loadError: "Could not build the preview.",
  statusPageSelectLabel: "Show the email for",
  subjectLabel: "Subject",
  emailFrameTitle: "Email preview",
  sampleUnsubscribeLinkNote:
    "The unsubscribe link here is a sample: each subscriber's email carries their own.",

  nothingWillBeSent: "Nothing will be sent",
  noMonitors:
    "No monitors are attached. Subscribers hear about an incident through the monitors their status pages list.",
  hiddenIncident: "This incident is hidden from status pages.",
  privateIncident: "Private incidents are hidden from all status pages.",
  notifyOff: "'Notify Status Page Subscribers' is off.",
  noStatusPages:
    "No status page that lists these monitors will show this incident.",

  oneHiddenPageNotPreviewed:
    "1 more status page you do not have access to will be sent this notification. It is not previewed.",
  hiddenPagesNotPreviewed:
    "{{number}} more status pages you do not have access to will be sent this notification. They are not previewed.",

  customTemplateUsed:
    'This status page\'s custom email template "{{name}}" is used.',
  defaultNoCustomTemplate:
    "The default email is used: this status page has no custom email template for this event.",
  defaultCustomTemplateNeedsSmtp:
    'The default email is used: the custom template "{{name}}" is only used when the status page sends email through its own SMTP server, and this one does not.',
  defaultCustomTemplateEmpty:
    'The default email is used: the custom template "{{name}}" has no body.',

  sendTestButton: "Send test to me",
  sendTestDescription:
    "Sends this status page's email to your own account email only, with [Test] at the start of the subject.",
  sendTestSent:
    "Test email sent to {{email}}. It can take a few minutes to arrive.",
  sendTestError: "Could not send the test email.",

  livePreviewTitle: "Live preview",
  livePreviewDescription:
    "Your template filled in with sample values, the way each notification is filled in with real ones.",
  livePreviewPickEventType: "Pick an event type to see a preview.",
  livePreviewEmptyTemplate: "Write the template to see a preview.",
  livePreviewNoSubject:
    "No subject: the notification is sent with the default subject for this event.",
  livePreviewUnknownPlaceholders:
    "Not variables of this event, so sent as written: {{names}}",
  livePreviewReportUnavailable:
    "Report templates have no preview: they are filled in with the report's own data when the report is sent.",
};

// Fills {{placeholders}} in a looked-up string.
export const formatPreviewText: (
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

export default SubscriberNotificationPreviewCopy;
