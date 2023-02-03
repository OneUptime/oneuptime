import type EmailBody from './EmailBody';
import type EmailTemplateType from './EmailTemplateType';

export default interface EmailTemplate {
    allowedVariables: Array<string>;
    emailType: EmailTemplateType;
    emailBody: EmailBody;
}
