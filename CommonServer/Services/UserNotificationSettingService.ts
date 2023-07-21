import PostgresDatabase from '../Infrastructure/PostgresDatabase';
import Model from 'Model/Models/UserNotificationSetting';
import DatabaseService, { OnCreate } from './DatabaseService';
import CreateBy from '../Types/Database/CreateBy';
import BadDataException from 'Common/Types/Exception/BadDataException';
import PositiveNumber from 'Common/Types/PositiveNumber';
import ObjectID from 'Common/Types/ObjectID';
import NotificationSettingEventType from 'Common/Types/NotificationSetting/NotificationSettingEventType';
import UserNotificationSetting from 'Model/Models/UserNotificationSetting';

export class Service extends DatabaseService<Model> {
    public constructor(postgresDatabase?: PostgresDatabase) {
        super(Model, postgresDatabase);
    }

    public async addDefaultNotificationSettingsForUser(
        userId: ObjectID,
        projectId: ObjectID
    ): Promise<void> {
        const incidentCreatedNotificationEvent: PositiveNumber =
            await this.countBy({
                query: {
                    userId,
                    projectId,
                    eventType:
                        NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
                },
                props: {
                    isRoot: true,
                },
            });

        if (incidentCreatedNotificationEvent.toNumber() === 0) {
            const item = new UserNotificationSetting();
            item.userId = userId;
            item.projectId = projectId;
            item.eventType =
                NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;
            item.alertByEmail = true;

            await this.create({
                data: item,
                props: {
                    isRoot: true,
                },
            });
        }

        // check monitor state changed notification
        const monitorStateChangedNotificationEvent: PositiveNumber =
            await this.countBy({
                query: {
                    userId,
                    projectId,
                    eventType:
                        NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION,
                },
                props: {
                    isRoot: true,
                },
            });

        if (monitorStateChangedNotificationEvent.toNumber() === 0) {
            const item = new UserNotificationSetting();
            item.userId = userId;
            item.projectId = projectId;
            item.eventType =
                NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION;
            item.alertByEmail = true;

            await this.create({
                data: item,
                props: {
                    isRoot: true,
                },
            });
        }

        // check incident state changed notification
        const incidentStateChangedNotificationEvent: PositiveNumber =
            await this.countBy({
                query: {
                    userId,
                    projectId,
                    eventType:
                        NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
                },
                props: {
                    isRoot: true,
                },
            });

        if (incidentStateChangedNotificationEvent.toNumber() === 0) {
            const item = new UserNotificationSetting();
            item.userId = userId;
            item.projectId = projectId;
            item.eventType =
                NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION;
            item.alertByEmail = true;

            await this.create({
                data: item,
                props: {
                    isRoot: true,
                },
            });
        }
    }

    protected override async onBeforeCreate(
        createBy: CreateBy<Model>
    ): Promise<OnCreate<Model>> {
        // check if the same event for same user is added.
        if (!createBy.data.projectId) {
            throw new BadDataException(
                'ProjectId is required for UserNotificationSetting'
            );
        }

        if (!createBy.data.userId) {
            throw new BadDataException(
                'UserId is required for UserNotificationSetting'
            );
        }

        if (!createBy.data.eventType) {
            throw new BadDataException(
                'EventType is required for UserNotificationSetting'
            );
        }

        const count: PositiveNumber = await this.countBy({
            query: {
                projectId: createBy.data.projectId,
                userId: createBy.data.userId,
                eventType: createBy.data.eventType,
            },
            props: {
                isRoot: true,
            },
        });

        if (count.toNumber() > 0) {
            throw new BadDataException(
                'Notification Setting of the same event type already exists for the user.'
            );
        }

        return {
            createBy,
            carryForward: undefined,
        };
    }
}

export default new Service();
