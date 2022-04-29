import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
   name: "UserAlerts"
})
export default class Model extends BaseModel {

   @Column()
   project!: Project;

   @Column()
   slug!: string;

   @Column()
   title!: string;

   @Column()
   name!: string;

   @Column()
   isPrivate!: boolean;

   @Column()
   isSubscriberEnabled!: boolean;

   @Column()
   isGroupedByMonitorCategory!: boolean;

   @Column()
   showScheduledEvents!: boolean;
   // Show incident to the top of status page

   @Column()
   moveIncidentToTheTop!: boolean;
   // Show or hide the probe bar

   @Column()
   hideProbeBar!: boolean;
   // Show or hide uptime (%) on the status page

   @Column()
   hideUptime!: boolean;

   @Column()
   multipleNotificationTypes!: boolean;
   // Show or hide resolved incident on the status page

   @Column()
   hideResolvedIncident!: boolean;

   @Column()
   description!: string;

   @Column()
   copyright!: string;

   @Column()
   faviconPath!: string;

   @Column()
   logoPath!: string;

   @Column()
   bannerPath!: string;

   @Column()
   colors!: Object;

   @Column()
   layout!: Object;

   @Column()
   headerHTML!: string;

   @Column()
   footerHTML!: string;

   @Column()
   customCSS!: string;

   @Column()
   customJS!: string;

   @Column()
   statusBubble!: string;

   @Column()
   embeddedCss!: string;

   @Column()
   enableRSSFeed!: boolean;

   @Column()
   emailNotification!: boolean;

   @Column()
   smsNotification!: boolean;

   @Column()
   webhookNotification!: boolean;

   @Column()
   selectIndividualMonitors!: boolean;

   @Column()
   enableIpWhitelist!: boolean;

   @Column()
   incidentHistoryDays!: number;

   @Column()
   scheduleHistoryDays!: number;

   @Column()
   announcementLogsHistory!: number;

   @Column()
   onlineText!: string;

   @Column()
   offlineText!: string;

   @Column()
   degradedText!: string;

   @Column()
   twitterHandle!: string;

   @Column()
   enableMultipleLanguage!: boolean;

   @Column()
   deletedByUser!: User;

   @Column()
   theme!: string;
}


