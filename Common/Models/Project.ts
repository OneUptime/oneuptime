import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

export default interface Model extends BaseModel{
    name: string,
    slug: string,
    users: [
        {
            user: User,
            role: {
                type: string,
                enum: ['Owner', 'Administrator', 'Member', 'Viewer'],
            },
            show: boolean,
        },
    ],

    stripePlanId: string,
    stripeSubscriptionId: string, // This is for plans.
    parentproject: Project,
    seats: { type: string, default: '1' },
    



    deletedByUser: User,

    apiKey: string,
    alertEnable: boolean,
    alertLimit: string,
    alertLimitReached: boolean,
    balance: number,
    alertOptions: {
        minimumBalance: {
            type: Number,
            enum: [20, 50, 100],
        },
        rechargeToBalance: {
            type: Number,
            enum: [40, 100, 200],
        },
        billingUS: boolean,
        billingNonUSCountries: boolean,
        billingRiskCountries: boolean,
    },
    isBlocked: boolean,
    adminNotes: [
        {
            note: string,
            createdAt: Date,
        },
    ],
    sendCreatedIncidentNotificationSms: boolean,
    sendAcknowledgedIncidentNotificationSms: boolean,
    sendResolvedIncidentNotificationSms: boolean,
    sendCreatedIncidentNotificationEmail: boolean,
    sendAcknowledgedIncidentNotificationEmail: boolean,
    sendResolvedIncidentNotificationEmail: boolean,
    enableInvestigationNoteNotificationSMS: boolean,
    enableInvestigationNoteNotificationEmail: boolean,

    sendAnnouncementNotificationSms: boolean,
    sendAnnouncementNotificationEmail: boolean,

    sendCreatedScheduledEventNotificationSms: boolean,
    sendCreatedScheduledEventNotificationEmail: boolean,
    sendScheduledEventResolvedNotificationSms: boolean,
    sendScheduledEventResolvedNotificationEmail: boolean,
    sendNewScheduledEventInvestigationNoteNotificationSms: boolean,
    sendNewScheduledEventInvestigationNoteNotificationEmail: boolean,
    sendScheduledEventCancelledNotificationSms: boolean,
    sendScheduledEventCancelledNotificationEmail: boolean,

    enableInvestigationNoteNotificationWebhook: boolean,
    replyAddress: string,
    unpaidSubscriptionNotifications: { type: string, default: '0' },
    paymentFailedDate: Date,
    paymentSuccessDate: Date,
}








