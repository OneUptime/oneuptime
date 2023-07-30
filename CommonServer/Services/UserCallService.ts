import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/UserCall';
import DatabaseService, { OnCreate, OnDelete } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import ProjectService from './ProjectService';
import Project from 'Model/Models/Project';
import BadDataException from 'Common/Types/Exception/BadDataException';
import CallService from './CallService';
import logger from '../Utils/Logger';
import ObjectID from 'Common/Types/ObjectID';
import Text from 'Common/Types/Text';
import CallRequest from 'Common/Types/Call/CallRequest';
import DeleteBy from '../Types/Database/DeleteBy';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import UserNotificationRuleService from './UserNotificationRuleService';

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
                    userCallId: item.id!,
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

        // check if this project has SMS and Call mEnabled.

        const project: Project | null = await ProjectService.findOneById({
            id: createBy.data.projectId!,
            props: {
                isRoot: true,
            },
            select: {
                enableCallNotifications: true,
                smsOrCallCurrentBalanceInUSDCents: true,
            },
        });

        if (!project) {
            throw new BadDataException('Project not found');
        }

        if (!project.enableCallNotifications) {
            throw new BadDataException(
                'Call notifications are disabled for this project. Please enable them in Project Settings > Notification Settings.'
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
        const callRequest: CallRequest = {
            to: item.phone!,
            data: [
                {
                    sayMessage: 'This call is from One Uptime.',
                },
                {
                    sayMessage:
                        'Your verification code is ' +
                        item.verificationCode?.split('').join('  '), // add space to make it more clear and slow down the message
                },
                {
                    sayMessage:
                        'Your verification code is ' +
                        item.verificationCode?.split('').join('  '), // add space to make it more clear and slow down the message
                },
                {
                    sayMessage:
                        'Your verification code is ' +
                        item.verificationCode?.split('').join('  '), // add space to make it more clear and slow down the message
                },
                {
                    sayMessage: 'Thank you for using One Uptime. Goodbye.',
                },
            ],
        };

        // send verification sms.
        CallService.makeCall(callRequest, {
            projectId: item.projectId,
            isSensitive: true,
        }).catch((err: Error) => {
            logger.error(err);
        });
    }
}

export default new Service();
