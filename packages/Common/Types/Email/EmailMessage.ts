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
  /*
   * The subject the project's email log keeps (EmailLog.subject, read by its
   * members and viewers), when it must not be the one sent: an invitation
   * written in the invitee's own language would tell the inviting project
   * that the address already had an account, and which language it reads
   * (#9897, Types/Team/InvitationEmailWords). The log gets the subject in
   * the language the email has for an invitee with no language of their
   * own instead. A literal subject, as `subject` is. Left out, the log keeps
   * the subject sent; the server's own email log always does.
   */
  projectLogSubject?: string | undefined;
}

export default interface EmailMessage extends EmailEnvelope {
  toEmail: Email;
  /*
   * Who else is sent the email, openly (Cc): the person who wrote Give
   * Feedback, copied on what they sent (#8893). Each is one mailbox, sent
   * once, never the To again (EmailRecipients.getCcAddresses). Left out,
   * the email goes to toEmail alone, as every email always has.
   */
  ccEmails?: Array<Email> | undefined;
  /*
   * Where a reply goes when it should not go to the sender: the person who
   * wrote Give Feedback, so the team's answer reaches them rather than the
   * server's no-reply address (EmailRecipients.getReplyToAddress). Left
   * out, a reply goes to the sender.
   */
  replyToEmail?: Email | undefined;
}
