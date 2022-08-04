import { Column, Entity } from 'typeorm';
import BaseModel from 'Common/Models/BaseModel';

import User from './User';
import Project from './Project';
@Entity({
    name: 'UserAlerts',
})
export default class Model extends BaseModel {
    @Column()
    public project?: Project;

    @Column()
    public slug?: string = undefined;

    @Column()
    public title?: string = undefined;

    @Column()
    public name?: string = undefined;

    @Column()
    public isPrivate?: boolean = undefined;

    @Column()
    public isSubscriberEnabled?: boolean = undefined;

    @Column()
    public isGroupedByMonitorCategory?: boolean = undefined;

    @Column()
    public showScheduledEvents?: boolean = undefined;
    // Show incident to the top of status page

    @Column()
    public moveIncidentToTheTop?: boolean = undefined;
    // Show or hide the probe bar

    @Column()
    public hideProbeBar?: boolean = undefined;
    // Show or hide uptime (%) on the status page

    @Column()
    public hideUptime?: boolean = undefined;

    @Column()
    public multipleNotificationTypes?: boolean = undefined;
    // Show or hide resolved incident on the status page

    @Column()
    public hideResolvedIncident?: boolean = undefined;

    @Column()
    public description?: string = undefined;

    @Column()
    public copyright?: string = undefined;

    @Column()
    public faviconPath?: string = undefined;

    @Column()
    public logoPath?: string = undefined;

    @Column()
    public bannerPath?: string = undefined;

    @Column()
    public colors?: Object;

    @Column()
    public layout?: Object;

    @Column()
    public headerHTML?: string = undefined;

    @Column()
    public footerHTML?: string = undefined;

    @Column()
    public customCSS?: string = undefined;

    @Column()
    public customJS?: string = undefined;

    @Column()
    public statusBubble?: string = undefined;

    @Column()
    public embeddedCss?: string = undefined;

    @Column()
    public enableRSSFeed?: boolean = undefined;

    @Column()
    public emailNotification?: boolean = undefined;

    @Column()
    public smsNotification?: boolean = undefined;

    @Column()
    public webhookNotification?: boolean = undefined;

    @Column()
    public selectIndividualMonitors?: boolean = undefined;

    @Column()
    public enableIpWhitelist?: boolean = undefined;

    @Column()
    public incidentHistoryDays?: number;

    @Column()
    public scheduleHistoryDays?: number;

    @Column()
    public announcementLogsHistory?: number;

    @Column()
    public onlineText?: string = undefined;

    @Column()
    public offlineText?: string = undefined;

    @Column()
    public degradedText?: string = undefined;

    @Column()
    public twitterHandle?: string = undefined;

    @Column()
    public enableMultipleLanguage?: boolean = undefined;

    @Column()
    public deletedByUser?: User;

    @Column()
    public theme?: string = undefined;
}
