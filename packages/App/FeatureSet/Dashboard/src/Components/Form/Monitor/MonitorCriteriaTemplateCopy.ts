/*
 * The help around a monitor criteria's incident and alert descriptions and
 * remediation notes, which are templates: {{monitorName}} and the rest are
 * filled in when the criteria creates the incident or alert.
 *
 * Each of those fields used to end its help with "Learn about dynamic
 * templates", a link to a dialog to copy a variable from. Their editors now
 * offer the variables themselves (under the editor, behind Insert variable,
 * and when "{{" is typed), so the help says what the field is for. The title
 * keeps the link: it is a plain text box, and the dialog is its reference.
 *
 * Kept in one React-free module so App/Tests/Dashboard/TemplateVariablesI18n
 * can check that each has an entry in all seventeen Dashboard locale files.
 */

export const MonitorCriteriaTemplateCopy: {
  incidentDescriptionHelp: string;
  incidentRemediationHelp: string;
  incidentVariablesDescription: string;
  alertDescriptionHelp: string;
  alertRemediationHelp: string;
  alertVariablesDescription: string;
} = {
  incidentDescriptionHelp: "Description for the incident.",
  incidentRemediationHelp:
    "Notes for the on-call engineer to resolve this incident.",
  incidentVariablesDescription:
    "When this criteria creates the incident, these variables are filled in from the monitor and its latest check.",
  alertDescriptionHelp: "Description for the alert.",
  alertRemediationHelp: "Notes for the on-call engineer to resolve this alert.",
  alertVariablesDescription:
    "When this criteria creates the alert, these variables are filled in from the monitor and its latest check.",
};

export default MonitorCriteriaTemplateCopy;
