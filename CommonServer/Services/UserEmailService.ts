import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/UserEmail';
import DatabaseService, { OnCreate } from './DatabaseService';
import MailService from './MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import logger from '../Utils/Logger';
import ObjectID from 'Common/Types/ObjectID';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Text from 'Common/Types/Text';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onCreateSuccess(_onCreate: OnCreate<Model>, createdItem: Model): Promise<Model> {
        // send verification email
        this.sendVerificationCode(createdItem);
        return createdItem;
    }

    public async resendVerificationCode(itemId: ObjectID): Promise<void> {

        const item: Model | null = await this.findOneById({
            id: itemId,
            props: {
                isRoot: true
            },
            select: {
                email: true,
                verificationCode: true,
                isVerified: true
            }
        });

        if (!item) {
            throw new BadDataException('Item with ID '+itemId.toString()+' not found');
        }

        if(item.isVerified){
            throw new BadDataException('Email already verified');
        }

        // generate new verification code
        item.verificationCode = Text.generateRandomNumber(6);

        await this.updateOneById({
            id: item.id!,
            props: {
                isRoot: true
            },
            data: {
                verificationCode: item.verificationCode
            }
        });

        this.sendVerificationCode(item);
    }

    public sendVerificationCode(item: Model): void {
        MailService.sendMail({
            toEmail: item.email!,
            templateType: EmailTemplateType.VerificationCode,
            vars: {
                code: item.verificationCode!,
                subject:  'Verify this email address'
            },
            subject: 'Verify this email address',
        }).catch((err: Error) => {
            logger.error(err);
        });
    }
}
export default new Service();
