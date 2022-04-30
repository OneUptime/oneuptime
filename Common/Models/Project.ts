import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';
import EncryptedColumns from '../Types/Database/EncryptedColumns';
import UniqueColumns from '../Types/Database/UniqueColumns';
import RequiredColumns from '../Types/Database/RequiredColumns';
import User from './User';
import Project from './Project';

@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    public constructor() {
        super(
            new EncryptedColumns([]),
            new UniqueColumns([]),
            new RequiredColumns([]),
            null
        );
    }
    @Column()
    public name!: string;

    @Column()
    public slug!: string;

    @Column()
    public stripePlanId!: string;

    @Column()
    public stripeSubscriptionId!: string;

    @Column()
    public parentproject!: Project;

    @Column()
    public seats!: number;

    @Column()
    public deletedByUser!: User;

    @Column()
    public apiKey!: string;

    @Column()
    public alertEnable!: boolean;

    @Column()
    public alertLimit!: string;

    @Column()
    public alertLimitReached!: boolean;

    @Column()
    public balance!: number;

    @Column()
    public isBlocked!: boolean;

    @Column()
    public sendCreatedIncidentNotificationSms!: boolean;

    @Column()
    public sendAcknowledgedIncidentNotificationSms!: boolean;

    @Column()
    public sendResolvedIncidentNotificationSms!: boolean;

    @Column()
    public sendCreatedIncidentNotificationEmail!: boolean;

    @Column()
    public sendAcknowledgedIncidentNotificationEmail!: boolean;

    @Column()
    public sendResolvedIncidentNotificationEmail!: boolean;

    @Column()
    public enableInvestigationNoteNotificationSMS!: boolean;

    @Column()
    public enableInvestigationNoteNotificationEmail!: boolean;

    @Column()
    public sendAnnouncementNotificationSms!: boolean;

    @Column()
    public sendAnnouncementNotificationEmail!: boolean;

    @Column()
    public sendCreatedScheduledEventNotificationSms!: boolean;

    @Column()
    public sendCreatedScheduledEventNotificationEmail!: boolean;

    @Column()
    public sendScheduledEventResolvedNotificationSms!: boolean;

    @Column()
    public sendScheduledEventResolvedNotificationEmail!: boolean;

    @Column()
    public sendNewScheduledEventInvestigationNoteNotificationSms!: boolean;

    @Column()
    public sendNewScheduledEventInvestigationNoteNotificationEmail!: boolean;

    @Column()
    public sendScheduledEventCancelledNotificationSms!: boolean;

    @Column()
    public sendScheduledEventCancelledNotificationEmail!: boolean;

    @Column()
    public enableInvestigationNoteNotificationWebhook!: boolean;

    @Column()
    public replyAddress!: string;

    @Column()
    public unpaidSubscriptionNotifications!: number;

    @Column()
    public paymentFailedDate!: Date;

    @Column()
    public paymentSuccessDate!: Date;
}
