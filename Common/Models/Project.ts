import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    name!: string;
 
 @Column()
    slug!: string;
 
 @Column()
    users!: [
        {
 
 @Column()
            user!: User;
 
 @Column()
            role!: {
 
 @Column()
                type!: string;
 
 @Column()
                enum!: ['Owner', 'Administrator', 'Member', 'Viewer'];
            };
 
 @Column()
            show!: boolean;
        };
    ];

 
 @Column()
    stripePlanId!: string;
 
 @Column()
    stripeSubscriptionId!: string; // This is for plans.
 
 @Column()
    parentproject!: Project;
 
 @Column()
    seats: { type: string, default!: '1' };
    



 
 @Column()
    deletedByUser!: User;

 
 @Column()
    apiKey!: string;
 
 @Column()
    alertEnable!: boolean;
 
 @Column()
    alertLimit!: string;
 
 @Column()
    alertLimitReached!: boolean;
 
 @Column()
    balance!: number;
 
 @Column()
    alertOptions!: {
 
 @Column()
        minimumBalance!: {
 
 @Column()
            type!: Number;
 
 @Column()
            enum!: [20, 50, 100];
        };
 
 @Column()
        rechargeToBalance!: {
 
 @Column()
            type!: Number;
 
 @Column()
            enum!: [40, 100, 200];
        };
 
 @Column()
        billingUS!: boolean;
 
 @Column()
        billingNonUSCountries!: boolean;
 
 @Column()
        billingRiskCountries!: boolean;
    };
 
 @Column()
    isBlocked!: boolean;
 
 @Column()
    adminNotes!: [
        {
 
 @Column()
            note!: string;
 
 @Column()
            createdAt!: Date;
        };
    ];
 
 @Column()
    sendCreatedIncidentNotificationSms!: boolean;
 
 @Column()
    sendAcknowledgedIncidentNotificationSms!: boolean;
 
 @Column()
    sendResolvedIncidentNotificationSms!: boolean;
 
 @Column()
    sendCreatedIncidentNotificationEmail!: boolean;
 
 @Column()
    sendAcknowledgedIncidentNotificationEmail!: boolean;
 
 @Column()
    sendResolvedIncidentNotificationEmail!: boolean;
 
 @Column()
    enableInvestigationNoteNotificationSMS!: boolean;
 
 @Column()
    enableInvestigationNoteNotificationEmail!: boolean;

 
 @Column()
    sendAnnouncementNotificationSms!: boolean;
 
 @Column()
    sendAnnouncementNotificationEmail!: boolean;

 
 @Column()
    sendCreatedScheduledEventNotificationSms!: boolean;
 
 @Column()
    sendCreatedScheduledEventNotificationEmail!: boolean;
 
 @Column()
    sendScheduledEventResolvedNotificationSms!: boolean;
 
 @Column()
    sendScheduledEventResolvedNotificationEmail!: boolean;
 
 @Column()
    sendNewScheduledEventInvestigationNoteNotificationSms!: boolean;
 
 @Column()
    sendNewScheduledEventInvestigationNoteNotificationEmail!: boolean;
 
 @Column()
    sendScheduledEventCancelledNotificationSms!: boolean;
 
 @Column()
    sendScheduledEventCancelledNotificationEmail!: boolean;

 
 @Column()
    enableInvestigationNoteNotificationWebhook!: boolean;
 
 @Column()
    replyAddress!: string;
 
 @Column()
    unpaidSubscriptionNotifications: { type: string, default!: '0' };
 
 @Column()
    paymentFailedDate!: Date;
 
 @Column()
    paymentSuccessDate!: Date;
}








