import Email from 'Common/Types/Email';
import Dictionary from 'Common/Types/Dictionary';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';

export default interface Mail {
    toEmail: Email;
    subject: string;
    templateType: EmailTemplateType;
    vars: Dictionary<string>;
    body: string;
}
