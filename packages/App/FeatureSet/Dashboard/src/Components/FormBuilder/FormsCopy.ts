import CustomFieldType from "Common/Types/CustomField/CustomFieldType";

/*
 * The text of the Forms product's pages: the list of forms, the form
 * builder, the On Submit page, the Share page and the submissions.
 *
 * Kept in one module free of React and of the dashboard's UI code, so the
 * pages, the builder and App/Tests/Dashboard/FormsI18n all read these exact
 * strings - the dashboard translates a string by looking up its English text
 * in the seventeen Dashboard locale files, and a string with no entry there
 * silently stays English. Words the dashboard already has ("Name", "Labels",
 * "Delete", ...) are written where they are used, as on every other page.
 *
 * No string here may contain "{{": the lookup would read it as one of its
 * own placeholders. Every string is a whole sentence or a whole name, so a
 * translation never has to be put together from pieces.
 */
export const FormsCopy: {
  // The product.
  productTitle: string;
  productDescription: string;

  // The list of forms.
  listDescription: string;
  listEmpty: string;
  nameDescription: string;
  namePlaceholder: string;
  descriptionDescription: string;
  createsTitle: string;
  createsDescription: string;
  statusTitle: string;
  statusAccepting: string;
  statusOff: string;

  // The builder.
  builderTitle: string;
  builderDescription: string;
  preview: string;
  saveChanges: string;
  discardChanges: string;
  unsavedChanges: string;
  savedChanges: string;
  editFormDetails: string;
  noDescription: string;
  emptyCanvasTitle: string;
  emptyCanvasDescription: string;
  addQuestionTitle: string;
  addQuestionDescription: string;
  paletteQuestions: string;
  paletteIncidentFields: string;
  paletteScheduledMaintenanceFields: string;
  paletteCustomFields: string;
  paletteSubmitter: string;
  paletteAdded: string;
  paletteFull: string;
  noCustomFieldsIncident: string;
  noCustomFieldsScheduledMaintenance: string;
  manageCustomFields: string;
  newQuestionLabel: string;

  // A question on the canvas, and its settings.
  dragToReorder: string;
  moveUp: string;
  moveDown: string;
  duplicate: string;
  deleteQuestion: string;
  done: string;
  questionLabel: string;
  questionLabelPlaceholder: string;
  helpText: string;
  helpTextPlaceholder: string;
  required: string;
  requiredDescription: string;
  requiredLocked: string;
  answerType: string;
  options: string;
  choicesOffered: string;
  choicesOfferedMustChoose: string;
  choicesOfferedSeverity: string;
  choicesOfferedPlaceholder: string;
  linkedTargetFieldNote: string;
  linkedCustomFieldNote: string;
  submitterNote: string;
  questionNote: string;
  issueCustomFieldDeleted: string;
  issueNoAllowedOptions: string;
  issueNoOptions: string;
  issueNoLabel: string;
  badgeCustomField: string;
  badgeSubmitter: string;
  inputPlaceholderText: string;
  inputPlaceholderChoose: string;
  inputPlaceholderChooseMany: string;
  inputPlaceholderDate: string;
  inputPlaceholderDateTime: string;
  inputPlaceholderNumber: string;
  inputPlaceholderEmail: string;
  inputPlaceholderRichText: string;
  inputCheckbox: string;

  // The preview.
  previewTitle: string;
  previewDescription: string;
  previewSubmitted: string;
  previewAgain: string;
  previewSkipped: string;

  // On Submit.
  onSubmitTitle: string;
  targetCardTitle: string;
  targetCardDescription: string;
  changeTargetTitle: string;
  changeTargetToIncident: string;
  changeTargetToScheduledMaintenance: string;
  changeTargetConfirm: string;
  mappingIncidentTitle: string;
  mappingScheduledMaintenanceTitle: string;
  mappingIncidentDescription: string;
  mappingScheduledMaintenanceDescription: string;
  editOnSubmitSettings: string;
  mappingFieldColumn: string;
  mappingSourceColumn: string;
  fromAnswer: string;
  ifLeftEmpty: string;
  alwaysAdded: string;
  notAsked: string;
  notSet: string;
  formNameAsTitle: string;
  defaultTitle: string;
  defaultTitleDescription: string;
  defaultSeverity: string;
  defaultSeverityDescription: string;
  noSeverityWarning: string;
  severityFromTemplate: string;
  incidentTemplate: string;
  incidentTemplateDescription: string;
  noTemplate: string;
  alwaysMonitors: string;
  alwaysMonitorsDescription: string;
  alwaysLabels: string;
  alwaysLabelsDescription: string;
  alwaysStatusPages: string;
  alwaysStatusPagesDescription: string;
  onCallPolicies: string;
  onCallPoliciesDescription: string;
  ownerUsers: string;
  ownerUsersDescription: string;
  ownerTeams: string;
  ownerTeamsDescription: string;
  showOnStatusPages: string;
  showOnStatusPagesDescription: string;
  notifySubscribers: string;
  notifySubscribersDescription: string;
  customFieldsRow: string;
  otherAnswersRow: string;
  otherAnswersIncident: string;
  otherAnswersScheduledMaintenance: string;
  statusPagesIncident: string;
  yes: string;
  no: string;
  stepDefaults: string;
  stepAlwaysAttach: string;
  stepOwners: string;
  stepPublishing: string;
  deletedRecord: string;

  // Share.
  shareTitle: string;
  statusCardTitle: string;
  statusCardDescription: string;
  acceptingSubmissions: string;
  acceptingSubmissionsOn: string;
  acceptingSubmissionsOff: string;
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
  afterSubmittingTitle: string;
  afterSubmittingDescription: string;
  editSuccessMessage: string;
  successMessageTitle: string;
  successMessageDescription: string;
  successMessageEmpty: string;
  accessDescription: string;
  accessPlanNote: string;
  editIpAllowlist: string;
  ipAllowlistTitle: string;
  ipAllowlistDescription: string;
  ipAllowlistEmpty: string;

  // Submissions.
  submissionsTitle: string;
  submissionsDescription: string;
  allSubmissionsDescription: string;
  submissionsEmpty: string;
  submission: string;
  submittedAt: string;
  submittedBy: string;
  submitterName: string;
  submitterEmail: string;
  anonymous: string;
  created: string;
  createdDeleted: string;
  viewAnswers: string;
  answersTitle: string;
  noAnswers: string;
  deleteSubmissionTitle: string;
  deleteSubmissionDescription: string;

  // Deleting the form.
  deleteFormNote: string;
} = {
  productTitle: "Forms",
  productDescription:
    "Forms anyone can fill in that create incidents or scheduled maintenance events.",

  listDescription:
    "Forms anyone with the link can fill in, without a OneUptime account. Each submission creates an incident or a scheduled maintenance event.",
  listEmpty:
    "No forms yet. Create one, choose its questions, then share its link with the people who should use it.",
  nameDescription:
    "The heading of the form's public page. Unique within the project.",
  namePlaceholder: "Report a Problem",
  descriptionDescription:
    "Shown at the top of the form's public page: what the form is for and what happens after it is sent.",
  createsTitle: "Each Submission Creates",
  createsDescription:
    "You can change this later on the form's On Submit page.",
  statusTitle: "Status",
  statusAccepting: "Accepting submissions",
  statusOff: "Off",

  builderTitle: "Questions",
  builderDescription:
    "What people are asked when they open the form's link. Drag a question to move it, and select it to edit it.",
  preview: "Preview",
  saveChanges: "Save Changes",
  discardChanges: "Discard Changes",
  unsavedChanges: "Unsaved changes",
  savedChanges: "All changes saved",
  editFormDetails: "Edit Name and Description",
  noDescription: "No description. Add one to tell people what the form is for.",
  emptyCanvasTitle: "This form asks nothing yet",
  emptyCanvasDescription:
    "Add a question from the list. A submission with no answers still creates its incident or event, from the On Submit settings.",
  addQuestionTitle: "Add a Question",
  addQuestionDescription:
    "Questions of your own, fields of what the form creates, and who is submitting.",
  paletteQuestions: "Questions",
  paletteIncidentFields: "Incident Fields",
  paletteScheduledMaintenanceFields: "Scheduled Maintenance Fields",
  paletteCustomFields: "Custom Fields",
  paletteSubmitter: "Submitter",
  paletteAdded: "Added",
  paletteFull: "This form has as many questions as a form can have.",
  noCustomFieldsIncident:
    "No incident custom fields yet. Create them in Incidents > Settings > Custom Fields.",
  noCustomFieldsScheduledMaintenance:
    "No scheduled maintenance custom fields yet. Create them in Scheduled Maintenance > Settings > Custom Fields.",
  manageCustomFields: "Manage Custom Fields",
  newQuestionLabel: "Untitled question",

  dragToReorder: "Drag to move this question",
  moveUp: "Move Up",
  moveDown: "Move Down",
  duplicate: "Duplicate",
  deleteQuestion: "Delete Question",
  done: "Done",
  questionLabel: "Question",
  questionLabelPlaceholder: "What would you like to ask?",
  helpText: "Help Text",
  helpTextPlaceholder: "Shown under the question. Optional.",
  required: "Required",
  requiredDescription: "The form cannot be submitted without an answer.",
  requiredLocked:
    "Always required: a scheduled maintenance event cannot be created without it.",
  answerType: "Answer Type",
  options: "Options",
  choicesOffered: "Choices Offered",
  choicesOfferedMustChoose:
    "Only the ones you choose are listed on the public form.",
  choicesOfferedSeverity: "Leave it empty to offer every severity.",
  choicesOfferedPlaceholder: "Choose what to offer",
  linkedTargetFieldNote: "The answer fills in this field of what the form creates.",
  linkedCustomFieldNote:
    "The answer fills in this custom field. Its type and options come from the custom field.",
  submitterNote:
    "Kept with the submission and named on the private note. Never shown on the incident or event itself.",
  questionNote:
    "The answer is kept with the submission and listed on the private note of what the form creates.",
  issueCustomFieldDeleted:
    "This custom field was deleted, so the question is not asked. Delete the question.",
  issueNoAllowedOptions:
    "Choose at least one to offer, or the question is not asked.",
  issueNoOptions: "Add at least one option.",
  issueNoLabel: "Write the question.",
  badgeCustomField: "Custom Field",
  badgeSubmitter: "Submitter",
  inputPlaceholderText: "Short answer",
  inputPlaceholderChoose: "Choose one",
  inputPlaceholderChooseMany: "Choose one or more",
  inputPlaceholderDate: "Pick a date",
  inputPlaceholderDateTime: "Pick a date and time",
  inputPlaceholderNumber: "A number",
  inputPlaceholderEmail: "name@example.com",
  inputPlaceholderRichText: "Long answer, with formatting",
  inputCheckbox: "Checked or not",

  previewTitle: "Preview",
  previewDescription:
    "The form as people see it when they open its link. Nothing you enter here is submitted.",
  previewSubmitted:
    "Looks good. This is a preview, so nothing was submitted.",
  previewAgain: "Fill It In Again",
  previewSkipped:
    "Some questions are not shown, because they cannot be answered yet. Their cards say why.",

  onSubmitTitle: "On Submit",
  targetCardTitle: "What Each Submission Creates",
  targetCardDescription:
    "Every submission through this form creates one of these in your project.",
  changeTargetTitle: "Change What Submissions Create",
  changeTargetToIncident:
    "From now on, each submission declares an incident. Questions linked to scheduled maintenance fields become questions of the form's own, and the On Submit settings start over.",
  changeTargetToScheduledMaintenance:
    "From now on, each submission schedules a maintenance event. Questions linked to incident fields become questions of the form's own, the On Submit settings start over, and the form asks when the maintenance starts and ends.",
  changeTargetConfirm: "Change",
  mappingIncidentTitle: "How a Submission Becomes an Incident",
  mappingScheduledMaintenanceTitle:
    "How a Submission Becomes a Scheduled Maintenance Event",
  mappingIncidentDescription:
    "Each field of the new incident, and where its value comes from: an answer, or a setting of this form. Whatever is still unset comes from the incident template, if you choose one.",
  mappingScheduledMaintenanceDescription:
    "Each field of the new scheduled maintenance event, and where its value comes from: an answer, or a setting of this form.",
  editOnSubmitSettings: "Edit Settings",
  mappingFieldColumn: "Field",
  mappingSourceColumn: "Comes From",
  fromAnswer: "Answer to the question:",
  ifLeftEmpty: "If it is left empty:",
  alwaysAdded: "Always added:",
  notAsked: "Not asked",
  notSet: "Not set",
  formNameAsTitle: "The form's name",
  defaultTitle: "Default Title",
  defaultTitleDescription:
    "The title when the form does not ask for one, or it is left empty. Without it, the form's name is the title.",
  defaultSeverity: "Severity",
  defaultSeverityDescription:
    "The severity when the form does not ask for one, or it is left empty.",
  noSeverityWarning:
    "No severity: submissions are refused until you choose one here, or an incident template that sets one.",
  severityFromTemplate: "The incident template's severity",
  incidentTemplate: "Incident Template",
  incidentTemplateDescription:
    "Incidents are declared from this template. It fills in whatever the answers and these settings leave unset: its state, monitors, labels, on-call policies, owners and custom field values.",
  noTemplate: "No template",
  alwaysMonitors: "Monitors",
  alwaysMonitorsDescription:
    "Attached to every submission, together with any the submitter chooses.",
  alwaysLabels: "Labels",
  alwaysLabelsDescription:
    "Added to every submission, together with any the submitter chooses.",
  alwaysStatusPages: "Status Pages",
  alwaysStatusPagesDescription:
    "The status pages the event belongs to, together with any the submitter chooses.",
  onCallPolicies: "On-Call Policies",
  onCallPoliciesDescription: "Executed for every incident the form declares.",
  ownerUsers: "Owner Users",
  ownerUsersDescription: "Own every submission, and are told about it.",
  ownerTeams: "Owner Teams",
  ownerTeamsDescription: "Own every submission, and are told about it.",
  showOnStatusPages: "Show on Status Pages",
  showOnStatusPagesDescription:
    "Off: the event stays off its status pages until someone on your team shows it. Turn it on only when you trust everyone with the link.",
  notifySubscribers: "Notify Subscribers",
  notifySubscribersDescription:
    "Off: status page subscribers are not told about the event when it is created, starts or ends.",
  customFieldsRow: "Custom Fields",
  otherAnswersRow: "Other Answers",
  otherAnswersIncident:
    "Listed on a private note on the incident, with who submitted it.",
  otherAnswersScheduledMaintenance:
    "Listed on a private note on the event, with who submitted it.",
  statusPagesIncident:
    "Never shown on status pages, and subscribers are not told, until someone on your team publishes it.",
  yes: "Yes",
  no: "No",
  stepDefaults: "Defaults",
  stepAlwaysAttach: "Always Attach",
  stepOwners: "Owners",
  stepPublishing: "Publishing",
  deletedRecord: "Deleted",

  shareTitle: "Share",
  statusCardTitle: "Status",
  statusCardDescription:
    "Turn the form off to stop submissions without deleting it. Its link then shows a not-available message.",
  acceptingSubmissions: "Accepting Submissions",
  acceptingSubmissionsOn: "The form's link works, and submissions are accepted.",
  acceptingSubmissionsOff:
    "The form's link shows a not-available message. Nothing can be submitted.",
  shareLinkTitle: "Share Link",
  shareLinkDescription:
    "Anyone with this link can open the form and submit it, without a OneUptime account. Share it where the people who should use it will find it.",
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
  afterSubmittingTitle: "After Submitting",
  afterSubmittingDescription:
    "What people see once they submit the form, together with the number of what it created.",
  editSuccessMessage: "Edit Message",
  successMessageTitle: "Thank-You Message",
  successMessageDescription:
    "Shown after the form is submitted. Use it to say what happens next.",
  successMessageEmpty: "The standard thank-you message",
  accessDescription:
    "Limit the form to your own networks: only requests from these IP addresses can open and submit it.",
  accessPlanNote: "Editing the IP allowlist needs the Scale plan.",
  editIpAllowlist: "Edit IP Allowlist",
  ipAllowlistTitle: "IP Allowlist",
  ipAllowlistDescription:
    "One IP address or IPv4 CIDR range per line, such as 203.0.113.7, 2001:db8::1 or 10.0.0.0/8. IPv6 ranges are not supported. Leave it empty to allow every network.",
  ipAllowlistEmpty: "Any network",

  submissionsTitle: "Submissions",
  submissionsDescription:
    "Every submission made through this form, newest first, with what it created.",
  allSubmissionsDescription:
    "Every submission made through your forms, newest first, with what it created.",
  submissionsEmpty: "Nothing has been submitted yet.",
  submission: "Submission",
  submittedAt: "Submitted At",
  submittedBy: "Submitted By",
  submitterName: "Submitter Name",
  submitterEmail: "Submitter Email",
  anonymous: "Anonymous",
  created: "Created",
  createdDeleted: "Deleted since",
  viewAnswers: "View Answers",
  answersTitle: "Answers",
  noAnswers: "This submission has no answers.",
  deleteSubmissionTitle: "Delete Submission",
  deleteSubmissionDescription:
    "Delete this submission? Its answers and the submitter's name and email are removed from this list. What it created is not deleted, and neither is the private note on it.",

  deleteFormNote:
    "Its submissions are deleted with it. The incidents and events it created are not.",
};

// How each kind of question of the form's own is named in the builder.
export const FORM_QUESTION_TYPE_TEXT: Record<
  CustomFieldType,
  { title: string; description: string }
> = {
  [CustomFieldType.Text]: {
    title: "Short Answer",
    description: "One line of text.",
  },
  [CustomFieldType.LongText]: {
    title: "Paragraph",
    description: "Several lines of text.",
  },
  [CustomFieldType.Markdown]: {
    title: "Rich Text",
    description: "Text with formatting and links.",
  },
  [CustomFieldType.Number]: {
    title: "Number",
    description: "A number.",
  },
  [CustomFieldType.Dropdown]: {
    title: "Dropdown",
    description: "One choice from a list.",
  },
  [CustomFieldType.MultiSelectDropdown]: {
    title: "Multi-Select",
    description: "Any number of choices from a list.",
  },
  [CustomFieldType.Boolean]: {
    title: "Checkbox",
    description: "A box to tick, such as a confirmation.",
  },
  [CustomFieldType.Date]: {
    title: "Date",
    description: "A day.",
  },
  [CustomFieldType.DateTime]: {
    title: "Date and Time",
    description: "A day and a time.",
  },
};

export default FormsCopy;
