import Email from '../Email';
import Dictionary from '../Dictionary';
import EmailTemplateType from '../Email/EmailTemplateType';

export default interface Mail {
    toEmail: Email;
    subject: string;
    templateType: EmailTemplateType;
    vars: Dictionary<string>;
    body: string;
}
