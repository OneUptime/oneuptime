import Dictionary from "../Dictionary";
import BadOperationException from "../Exception/BadOperationException";
import EmailTemplateType from "./EmailTemplateType";

class EmailSubjects { 

    private subjectMap: Dictionary<string> = {};

    constructor() {
        this.subjectMap[EmailTemplateType.SIGNUP_WELCOME_EMAIL] = "Welcome to OneUptime.";
        this.subjectMap[EmailTemplateType.SIGNUP_VERIFICATION_EMAIL] = "Welcome to OneUptime. Please verify your email.";
    }

    getSubjectByType(emailTemplateType: EmailTemplateType): string {
        if (this.subjectMap[emailTemplateType]) {
            return this.subjectMap[emailTemplateType] as string;
        }

        throw new BadOperationException(`Subject for ${emailTemplateType} not found.`);
    }
}

export default new EmailSubjects();