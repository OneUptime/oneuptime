/*
 * The text of the dashboard's incident forms pages (Incidents > Settings >
 * Forms): the list of forms, a form's own page and its Share Link card. The
 * form's Questions card has its own copy (IncidentCustomFieldCreateSettingsCopy,
 * which it shares with incident templates), and so does the public page
 * reporters fill in (in the Accounts app).
 *
 * Kept in one module free of React and of the dashboard's UI code, so the
 * pages, the card and App/Tests/Dashboard/IncidentFormsI18n all read these
 * exact strings - the dashboard translates a string by looking up its
 * English text in the seventeen Dashboard locale files, and a string with no
 * entry there silently stays English. Words the dashboard already had
 * ("Name", "Severity", "Incident Template", ...) are written where they are
 * used, as on every other page.
 *
 * No string here may contain "{{": the lookup would read it as one of its
 * own placeholders.
 */
export const IncidentFormCopy: {
  // The list of forms.
  listTitle: string;
  listDescription: string;
  listEmpty: string;

  // The form's details: the create wizard's first step and the page's first card.
  formDetailsTitle: string;
  formDetailsDescription: string;
  editFormDetails: string;
  formIdTitle: string;
  nameDescription: string;
  namePlaceholder: string;
  descriptionDescription: string;
  enabledDescription: string;

  // What the incidents start with.
  incidentSettingsDescription: string;
  editIncidentSettings: string;
  severityDescription: string;
  letReporterChooseSeverityTitle: string;
  letReporterChooseSeverityDescription: string;
  templateDescription: string;

  // What the form asks, and what it says after a report.
  formSettingsTitle: string;
  formSettingsDescription: string;
  editFormSettings: string;
  descriptionQuestionTitle: string;
  descriptionQuestionDescription: string;
  requireReporterDetailsTitle: string;
  requireReporterDetailsDescription: string;
  successMessageTitle: string;
  successMessageDescription: string;

  // The link, and resetting it.
  shareLinkTitle: string;
  shareLinkDescription: string;
  copyLink: string;
  openForm: string;
  resetLink: string;
  resetLinkConfirmation: string;
  newLinkTitle: string;
  newLinkDescription: string;
  formTurnedOff: string;
  shareLinkNotFound: string;

  // Who may open the form.
  accessDescription: string;
  accessPlanNote: string;
  editIpAllowlist: string;
  ipAllowlistTitle: string;
  ipAllowlistDescription: string;
  ipAllowlistEmpty: string;

  // The reports made through the form.
  submissionsTitle: string;
  submissionsDescription: string;
  submissionsEmpty: string;
  submission: string;
  submittedAt: string;
  reporterName: string;
  reporterEmail: string;
  deleteSubmissionTitle: string;
  deleteSubmissionDescription: string;

  // Deleting the form.
  deleteFormNote: string;
} = {
  listTitle: "Incident Forms",
  listDescription:
    "Forms anyone with the link can fill in to report an incident, without a OneUptime account. Each submission declares an incident in this project.",
  listEmpty:
    "No incident forms yet. Create one, then share its link with the people who should report incidents to you.",

  formDetailsTitle: "Form Details",
  formDetailsDescription:
    "The name and description at the top of the form's public page, and whether the form takes reports.",
  editFormDetails: "Edit Form Details",
  formIdTitle: "Incident Form ID",
  nameDescription:
    "The heading of the form's public page. Unique within the project.",
  namePlaceholder: "Report a Problem",
  descriptionDescription:
    "Shown at the top of the form's public page, above the questions: what the form is for and what happens after it is sent.",
  enabledDescription:
    "While the form is turned off, its link shows a 'not available' message and nothing can be submitted.",

  incidentSettingsDescription:
    "What the incidents reported through this form start with. With an incident template, everything the template sets applies too, including its monitors, on-call policies and a monitor status change.",
  editIncidentSettings: "Edit Incident Settings",
  severityDescription:
    "The severity of every incident reported through this form, unless you let the reporter choose one.",
  letReporterChooseSeverityTitle: "Let Reporter Choose Severity",
  letReporterChooseSeverityDescription:
    "Ask the reporter to choose one of your project's incident severities, starting with the form's own. Leave it off when reporters should not decide how urgently you are paged.",
  templateDescription:
    "Every incident reported through this form is declared from this template, and everything the template sets applies, including its monitors, on-call policies and a monitor status change. Anyone with the link can set these off, and a monitor on the incident is not checked until the incident is resolved.",

  formSettingsTitle: "Form Settings",
  formSettingsDescription:
    "What the form asks the reporter, and what it shows them once they have submitted it.",
  editFormSettings: "Edit Form Settings",
  descriptionQuestionTitle: "Description Question",
  descriptionQuestionDescription:
    "Whether the form asks the reporter to describe the incident. The title is always asked.",
  requireReporterDetailsTitle: "Require Reporter Details",
  requireReporterDetailsDescription:
    "When on, the reporter must give their name and email. Turn it off to let people report anonymously.",
  successMessageTitle: "Success Message",
  successMessageDescription:
    "Shown to the reporter after they submit the form, together with the new incident's number. Use it to say what happens next.",

  shareLinkTitle: "Share Link",
  shareLinkDescription:
    "Anyone with this link can open the form and report an incident, without a OneUptime account. Share it where the people who should report will find it.",
  copyLink: "Copy Link",
  openForm: "Open Form",
  resetLink: "Reset Link",
  resetLinkConfirmation:
    "The form gets a new link, and the current one stops working at once. Everybody you shared it with sees a 'not available' message until you send them the new one.",
  newLinkTitle: "New Link",
  newLinkDescription:
    "The form has a new link, shown on the Share Link card. The old link no longer works.",
  formTurnedOff:
    "This form is turned off, so its link shows a 'not available' message.",
  shareLinkNotFound:
    "This form's link could not be loaded. The form may have been deleted.",

  accessDescription:
    "Limit the form to your own networks: only requests from these IP addresses can open and submit it.",
  accessPlanNote: "Editing the IP allowlist needs the Scale plan.",
  editIpAllowlist: "Edit IP Allowlist",
  ipAllowlistTitle: "IP Allowlist",
  ipAllowlistDescription:
    "One IP address or CIDR range per line, such as 203.0.113.7 or 10.0.0.0/8. Leave it empty to allow every network.",
  ipAllowlistEmpty: "Any network",

  submissionsTitle: "Submissions",
  submissionsDescription:
    "Every report made through this form, newest first, with the incident it declared.",
  submissionsEmpty: "No reports have been submitted through this form yet.",
  submission: "Submission",
  submittedAt: "Submitted At",
  reporterName: "Reporter Name",
  reporterEmail: "Reporter Email",
  deleteSubmissionTitle: "Delete Submission",
  deleteSubmissionDescription:
    "Delete this submission? The reporter's name and email are removed from this list. The incident it declared is not deleted, and neither is the private note that names the reporter.",

  deleteFormNote:
    "Its submissions are deleted with it. The incidents it declared are not deleted.",
};

export default IncidentFormCopy;
