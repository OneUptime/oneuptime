import Dictionary from "../Dictionary";
import Email from "../Email";
import EmailTemplateType from "./EmailTemplateType";

export interface EmailEnvelope {
  subject: string;
  templateType?: EmailTemplateType;
  vars: Dictionary<string>;
  body?: string;
}

export default interface EmailMessage extends EmailEnvelope {
  toEmail: Email;
}
