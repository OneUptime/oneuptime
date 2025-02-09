import Dictionary from "../Dictionary";
import Email from "../Email";
import { JSONObject } from "../JSON";
import EmailTemplateType from "./EmailTemplateType";

export interface EmailEnvelope {
  subject: string;
  templateType?: EmailTemplateType;
  vars: Dictionary<string | JSONObject>;
  body?: string;
}

export default interface EmailMessage extends EmailEnvelope {
  toEmail: Email;
}
