export const WhatsAppTemplateIds = {
  AlertCreated: "oneuptime_alert_created",
  IncidentCreated: "oneuptime_incident_created",
  VerificationCode: "oneuptime_verification_code",
} as const;

const WhatsAppTemplateMessages = {
  [WhatsAppTemplateIds.AlertCreated]: `This is a message from OneUptime. A new alert {{alert_title}} has been created for project {{project_name}}. To acknowledge this alert, open {{acknowledge_url}}.`,
  [WhatsAppTemplateIds.IncidentCreated]: `This is a message from OneUptime. A new incident {{incident_title}} has been created for project {{project_name}}. To acknowledge this incident, open {{acknowledge_url}}.`,
  [WhatsAppTemplateIds.VerificationCode]: `Your OneUptime verification code is {{verification_code}}. Enter this code in the dashboard to verify your WhatsApp number.`,
} as const;

export type WhatsAppTemplateId =
  (typeof WhatsAppTemplateIds)[keyof typeof WhatsAppTemplateIds];

export const WhatsAppTemplateLanguage: Record<WhatsAppTemplateId, string> = {
  [WhatsAppTemplateIds.AlertCreated]: "en",
  [WhatsAppTemplateIds.IncidentCreated]: "en",
  [WhatsAppTemplateIds.VerificationCode]: "en",
};

export const renderWhatsAppTemplate = (
  templateId: WhatsAppTemplateId,
  variables: Record<string, string>,
): string => {
  const template: string | undefined = WhatsAppTemplateMessages[templateId];

  if (!template) {
    throw new Error(`WhatsApp template ${templateId} is not defined.`);
  }

  return template.replace(/\{\{(.*?)\}\}/g, (_match: string, key: string) => {
    if (variables[key] === undefined) {
      throw new Error(
        `Missing variable "${key}" for WhatsApp template ${templateId}.`,
      );
    }

    return variables[key];
  });
};

export default WhatsAppTemplateMessages;
