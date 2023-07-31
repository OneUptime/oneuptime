import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/UserSMS';
import DatabaseService, { OnCreate, OnDelete } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import ProjectService from './ProjectService';
import Project from 'Model/Models/Project';
import BadDataException from 'Common/Types/Exception/BadDataException';
import SmsService from './SmsService';
import logger from '../Utils/Logger';
import ObjectID from 'Common/Types/ObjectID';
import Text from 'Common/Types/Text';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import UserNotificationRuleService from './UserNotificationRuleService';
import DeleteBy from '../Types/Database/DeleteBy';

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
                    userSmsId: item.id!,
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
        // check if this project has SMS and Call mEnabled.

        if (!createBy.props.isRoot && createBy.data.isVerified) {
            throw new BadDataException('isVerified cannot be set to true');
        }

        const project: Project | null = await ProjectService.findOneById({
            id: createBy.data.projectId!,
            props: {
                isRoot: true,
            },
            select: {
                enableSmsNotifications: true,
                smsOrCallCurrentBalanceInUSDCents: true,
            },
        });

        if (!project) {
            throw new BadDataException('Project not found');
        }

        if (!project.enableSmsNotifications) {
            throw new BadDataException(
                'SMS notifications are disabled for this project. Please enable them in Project Settings > Notification Settings.'
            );
        }

        if (project?.smsOrCallCurrentBalanceInUSDCents! <= 100) {
            throw new BadDataException(
                'Your SMS balance is low. Please recharge your SMS balance in Project Settings > Notification Settings.'
            );
        }

        return { carryForward: null, createBy };
    }

    protected override async onCreateSuccess(
        _onCreate: OnCreate<Model>,
        createdItem: Model
    ): Promise<Model> {
        if (!createdItem.isVerified) {
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
                phone: true,
                verificationCode: true,
                isVerified: true,
            },
        });

        if (!item) {
            throw new BadDataException(
                'Item with ID ' + itemId.toString() + ' not found'
            );
        }

        if (item.isVerified) {
            throw new BadDataException('Phone Number already verified');
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
        // send verification sms.
        SmsService.sendSms(
            {
                to: item.phone!,
                message:
                    'This message is from OneUptime. Your verification code is ' +
                    item.verificationCode,
            },
            {
                projectId: item.projectId,
                isSensitive: true,
            }
        ).catch((err: Error) => {
            logger.error(err);
        });
    }
}
export default new Service();
