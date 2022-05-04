import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Project from './Project';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public project!: Project;

    @Column()
    public slug!: string;

    @Column()
    public title!: string;

    @Column()
    public name!: string;

    @Column()
    public isPrivate!: boolean;

    @Column()
    public isSubscriberEnabled!: boolean;

    @Column()
    public isGroupedByMonitorCategory!: boolean;

    @Column()
    public showScheduledEvents!: boolean;
    // Show incident to the top of status page

    @Column()
    public moveIncidentToTheTop!: boolean;
    // Show or hide the probe bar

    @Column()
    public hideProbeBar!: boolean;
    // Show or hide uptime (%) on the status page

    @Column()
    public hideUptime!: boolean;

    @Column()
    public multipleNotificationTypes!: boolean;
    // Show or hide resolved incident on the status page

    @Column()
    public hideResolvedIncident!: boolean;

    @Column()
    public description!: string;

    @Column()
    public copyright!: string;

    @Column()
    public faviconPath!: string;

    @Column()
    public logoPath!: string;

    @Column()
    public bannerPath!: string;

    @Column()
    public colors!: Object;

    @Column()
    public layout!: Object;

    @Column()
    public headerHTML!: string;

    @Column()
    public footerHTML!: string;

    @Column()
    public customCSS!: string;

    @Column()
    public customJS!: string;

    @Column()
    public statusBubble!: string;

    @Column()
    public embeddedCss!: string;

    @Column()
    public enableRSSFeed!: boolean;

    @Column()
    public emailNotification!: boolean;

    @Column()
    public smsNotification!: boolean;

    @Column()
    public webhookNotification!: boolean;

    @Column()
    public selectIndividualMonitors!: boolean;

    @Column()
    public enableIpWhitelist!: boolean;

    @Column()
    public incidentHistoryDays!: number;

    @Column()
    public scheduleHistoryDays!: number;

    @Column()
    public announcementLogsHistory!: number;

    @Column()
    public onlineText!: string;

    @Column()
    public offlineText!: string;

    @Column()
    public degradedText!: string;

    @Column()
    public twitterHandle!: string;

    @Column()
    public enableMultipleLanguage!: boolean;

    @Column()
    public deletedByUser!: User;

    @Column()
    public theme!: string;
}
