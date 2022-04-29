import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   name!: string;

   @Column()
   slug!: string;

   @Column()
   stripePlanId!: string;

   @Column()
   stripeSubscriptionId!: string;

   @Column()
   parentproject!: Project;

   @Column()
   seats!: number;

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
   isBlocked!: boolean;

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
   unpaidSubscriptionNotifications!: number;

   @Column()
   paymentFailedDate!: Date;

   @Column()
   paymentSuccessDate!: Date;
}








