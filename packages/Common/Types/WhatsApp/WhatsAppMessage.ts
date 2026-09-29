import Phone from "../Phone";

export interface WhatsAppMessagePayload {
  body: string;
  templateKey?: string | undefined;
  templateVariables?: Record<string, string> | undefined;
  templateLanguageCode?: string | undefined;
}

export default interface WhatsAppMessage extends WhatsAppMessagePayload {
  to: Phone;
}
