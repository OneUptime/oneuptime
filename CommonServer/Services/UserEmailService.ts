import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/UserEmail';
import DatabaseService, { OnCreate } from './DatabaseService';
import MailService from './MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import logger from '../Utils/Logger';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onCreateSuccess(_onCreate: OnCreate<Model>, createdItem: Model): Promise<Model> {
        // send verification email

        MailService.sendMail({
            toEmail: createdItem.email!,
            templateType: EmailTemplateType.VerificationCode,
            vars: {
                code: createdItem.verificationCode!,
                subject:  'Verify this email address'
            },
            subject: 'Verify this email address',
        }).catch((err: Error) => {
            logger.error(err);
        });

        return createdItem;
    }
}
export default new Service();
