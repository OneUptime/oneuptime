import Dictionary from "../Dictionary";
import Email from "../Email";
import { JSONObject } from "../JSON";
import EmailTemplateType from "./EmailTemplateType";

export interface EmailEnvelope {
  subject: string;
  /*
   * The subject is final text, not a Handlebars template. Without this the
   * mailer compiles the subject against `vars`, which is what a template
   * subject needs but breaks a subject already rendered from user-authored
   * text: an incident description quoting "{{ .Values.image.tag }}" fails to
   * parse, so the email is never sent, and "{{ x }}" renders as nothing.
   */
  isSubjectLiteral?: boolean | undefined;
  templateType?: EmailTemplateType;
  vars: Dictionary<string | JSONObject>;
  body?: string;
  /*
   * The language the email's own words are written in - the template's and
   * its partials', looked up in Common/Server/Locales - as one of the codes
   * OneUptime writes in ("de", "fa", Common/Types/ReaderLanguage). Unset is
   * English, which every email that names none reads in, exactly as it
   * always has. The values the sender puts in `vars` and the subject are
   * the sender's: it writes them in this language itself.
   */
  language?: string | undefined;
}

export default interface EmailMessage extends EmailEnvelope {
  toEmail: Email;
}
