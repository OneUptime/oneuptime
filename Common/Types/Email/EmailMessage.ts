import type Email from '../Email';
import type Dictionary from '../Dictionary';
import type EmailTemplateType from './EmailTemplateType';

export default interface EmailMessage {
    toEmail: Email;
    subject: string;
    templateType?: EmailTemplateType;
    vars: Dictionary<string>;
    body?: string;
}
