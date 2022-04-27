import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
@Entity({
    name: "UserAlerts"
})
export default class Model extends BaseModel{
 
 @Column()
    project!: Project; //Which project this statuspage belongs to.
 
 @Column()
    domains!: [
        {
 
 @Column()
            domain!: string; // Complete domain eg status.oneuptime.com
 
 @Column()
            cert!: string; // Filename gridfs
 
 @Column()
            privateKey!: string; // Filename gridfs
 
 @Column()
            enableHttps!: boolean;
 
 @Column()
            autoProvisioning!: boolean;
 
 @Column()
            domainVerificationToken!: {
 
 @Column()
                type!: Schema.Types.ObjectId;
 
 @Column()
                ref!: 'DomainVerificationToken';
 
 @Column()
                index!: true;
            };
        };
    ];
 
 @Column()
    monitors!: [
        {
 
 @Column()
            monitor!: {
 
 @Column()
                type!: Schema.Types.ObjectId;
 
 @Column()
                ref!: 'Monitor';
 
 @Column()
                index!: true;
            };
 
 @Column()
            statusPageCategory!: {
 
 @Column()
                type!: Schema.Types.ObjectId;
 
 @Column()
                ref!: 'StatusPageCategory';
 
 @Column()
                index!: true;
            };
 
 @Column()
            description!: string;
 
 @Column()
            uptime!: Boolean;
 
 @Column()
            memory!: Boolean;
 
 @Column()
            cpu!: Boolean;
 
 @Column()
            storage!: Boolean;
 
 @Column()
            responseTime!: Boolean;
 
 @Column()
            temperature!: Boolean;
 
 @Column()
            runtime!: Boolean;
        };
    ];
 
 @Column()
    links!: Array;
 
 @Column()
    slug!: string;
 
 @Column()
    title: { type: string, default!: 'Status Page' };
 
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
    statusBubbleId!: string;
 
 @Column()
    embeddedCss!: string;
    ;
 
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
    ipWhitelist: { type: Array; default!: [] }
 
 @Column()
    incidentHistoryDays: { type: Number, default!: 14 };
 
 @Column()
    scheduleHistoryDays: { type: Number, default!: 14 };
 
 @Column()
    announcementLogsHistory: { type: Number, default!: 14 };
 
 @Column()
    onlineText: { type: string, default!: 'Operational' };
 
 @Column()
    offlineText: { type: string, default!: 'Offline' };
 
 @Column()
    degradedText: { type: string, default!: 'Degraded' };
 
 @Column()
    twitterHandle!: string;
 
 @Column()
    enableMultipleLanguage!: boolean;
 
 @Column()
    multipleLanguages: { type: Array, default!: [] };


 
 @Column()
    deletedByUser: User;
 
 @Column()
    theme: { type: string, default!: 'Clean Theme' };
}




 
 @Column()
export const requiredFields!: RequiredFields = ['name'; 'project'];


