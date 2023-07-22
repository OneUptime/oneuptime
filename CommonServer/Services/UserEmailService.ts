import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/UserEmail';
import DatabaseService, { OnCreate, OnDelete } from './DatabaseService';
import MailService from './MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import logger from '../Utils/Logger';
import ObjectID from 'Common/Types/ObjectID';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Text from 'Common/Types/Text';
import DeleteBy from '../Types/Database/DeleteBy';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import UserNotificationRuleService from './UserNotificationRuleService';
import CreateBy from '../Types/Database/CreateBy';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    protected override async onBeforeDelete(
        deleteBy: DeleteBy<Model>
    ): Promise<OnDelete<Model>> {
        const itemsToDelete: Array<Model> = await this.findBy({
            query: deleteBy.query,
            select: {
                _id: true,
                projectId: true,
            },
            skip: 0,
            limit: LIMIT_MAX,
            props: {
                isRoot: true,
            },
        });

        for (const item of itemsToDelete) {
            await UserNotificationRuleService.deleteBy({
                query: {
                    userEmailId: item.id!,
                    projectId: item.projectId!,
                },
                limit: LIMIT_MAX,
                skip: 0,
                props: {
                    isRoot: true,
                },
            });
        }

        return {
            deleteBy,
            carryForward: null,
        };
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        if (!createBy.props.isRoot && createBy.data.isVerified) {
            throw new BadDataException('isVerified cannot be set to true');
        }

        return {
            createBy,
            carryForward: null,
        };
    }

    protected override async onCreateSuccess(
        _onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        if (!createdItem.isVerified) {
            // send verification code
            this.sendVerificationCode(createdItem);
        }

        return createdItem;
    }

    public async resendVerificationCode(itemId: ObjectID): Promise<void> {
        const item: Model | null = await this.findOneById({
            id: itemId,
            props: {
                isRoot: true,
            },
            select: {
                email: true,
                verificationCode: true,
                isVerified: true,
                projectId: true,
            },
        });

        if (!item) {
            throw new BadDataException(
                'Item with ID ' + itemId.toString() + ' not found'
            );
        }

        if (item.isVerified) {
            throw new BadDataException('Email already verified');
        }

        // generate new verification code
        item.verificationCode = Text.generateRandomNumber(6);

        await this.updateOneById({
            id: item.id!,
            props: {
                isRoot: true,
            },
            data: {
                verificationCode: item.verificationCode,
            },
        });

        this.sendVerificationCode(item);
    }

    public sendVerificationCode(item: Model): void {
        MailService.sendMail(
            {
                toEmail: item.email!,
                templateType: EmailTemplateType.VerificationCode,
                vars: {
                    code: item.verificationCode!,
                    subject: 'Verify this email address',
                },
                subject: 'Verify this email address',
            },
            {
                projectId: item.projectId!,
            }
        ).catch((err: Error) => {
            logger.error(err);
        });
    }
}
export default new Service();
