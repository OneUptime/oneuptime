import Phone from "../Phone";

export interface WhatsAppMessage {
  message: string;
}

export default interface WhatsApp extends WhatsAppMessage {
  to: Phone;
}