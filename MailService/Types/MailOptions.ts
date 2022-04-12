import Email from 'Common/Types/Email';
import EmailWithName from 'Common/Types/EmailWithName';
import Dictionary from 'Common/Types/Dictionary';

export default interface MailOptions {
    from: EmailWithName;
    to: Email;
    subject: string;
    template: string;
    context: Dictionary<String>;
}
