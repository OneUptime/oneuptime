import Email from '../Email';
import Dictionary from '../Dictionary';
import EmailTemplateType from './EmailTemplateType';

export default interface EmailMessage {
    toEmail: Email;
    subject: string;
    templateType?: EmailTemplateType;
    vars: Dictionary<string>;
    body?: string;
}
