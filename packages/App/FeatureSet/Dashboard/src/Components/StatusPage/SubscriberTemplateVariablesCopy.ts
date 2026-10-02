/*
 * The words around a custom subscriber notification template's content
 * fields, now that each field offers its variables itself (collapsed under
 * it, behind the code editor's Insert variable button, and when "{{" is
 * typed). The fields used to send the author to "the documentation below",
 * an always-open table under the editor.
 *
 * Kept in one React-free module so App/Tests/Dashboard/TemplateVariablesI18n
 * can check that each has an entry in all seventeen Dashboard locale files.
 * No string here may contain "{{": the translation lookup would read it as a
 * placeholder of its own.
 */

export const SubscriberTemplateVariablesCopy: {
  variablesDescription: string;
  emailSubjectDescription: string;
  emailBodyDescription: string;
  smsBodyDescription: string;
  webhookBodyDescription: string;
  markdownBodyDescription: string;
} = {
  variablesDescription:
    "When a notification is sent, these variables are filled in with the event's values.",
  emailSubjectDescription: "Subject line of the email.",
  emailBodyDescription: "The template content in HTML format.",
  smsBodyDescription:
    "The template content in plain text format. Keep it concise for SMS.",
  webhookBodyDescription: "The template content in JSON format.",
  markdownBodyDescription: "The template content in Markdown format.",
};

export default SubscriberTemplateVariablesCopy;
