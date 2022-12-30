import EmailBody from './EmailBody';
import EmailTemplateType from './EmailTemplateType';

export default interface EmailTemplate {
    allowedVariables: Array<string>;
    emailType: EmailTemplateType;
    emailBody: EmailBody;
}
