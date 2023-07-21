import Email from '../Email';
import Dictionary from '../Dictionary';
import EmailTemplateType from './EmailTemplateType';


export interface EmailEnvelope {
    subject: string;
    templateType?: EmailTemplateType;
    vars: Dictionary<string>;
    body?: string;
}


export default interface EmailMessage extends EmailEnvelope {
    toEmail: Email;
}


