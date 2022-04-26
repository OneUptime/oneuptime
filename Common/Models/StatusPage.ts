import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    project: Project, //Which project this statuspage belongs to.
    domains: [
        {
            domain: string, // Complete domain eg status.oneuptime.com
            cert: string, // Filename gridfs
            privateKey: string, // Filename gridfs
            enableHttps: { type: Boolean, default: false },
            autoProvisioning: { type: Boolean, default: false },
            domainVerificationToken: {
                type: Schema.Types.ObjectId,
                ref: 'DomainVerificationToken',
                index: true,
            },
        },
    ],
    monitors: [
        {
            monitor: {
                type: Schema.Types.ObjectId,
                ref: 'Monitor',
                index: true,
            },
            statusPageCategory: {
                type: Schema.Types.ObjectId,
                ref: 'StatusPageCategory',
                index: true,
            },
            description: string,
            uptime: Boolean,
            memory: Boolean,
            cpu: Boolean,
            storage: Boolean,
            responseTime: Boolean,
            temperature: Boolean,
            runtime: Boolean,
        },
    ],
    links: Array,
    slug: string,
    title: { type: string, default: 'Status Page' },
    name: string,
    isPrivate: boolean,
    isSubscriberEnabled: boolean,
    isGroupedByMonitorCategory: boolean,
    showScheduledEvents: boolean,
    // Show incident to the top of status page
    moveIncidentToTheTop: boolean,
    // Show or hide the probe bar
    hideProbeBar: boolean,
    // Show or hide uptime (%) on the status page
    hideUptime: boolean,
    multipleNotificationTypes: boolean,
    // Show or hide resolved incident on the status page
    hideResolvedIncident: boolean,
    description: string,
    copyright: string,
    faviconPath: string,
    logoPath: string,
    bannerPath: string,
    colors: Object,
    layout: Object,
    headerHTML: string,
    footerHTML: string,
    customCSS: string,
    customJS: string,
    statusBubbleId: string,
    embeddedCss: string,
    ,
    enableRSSFeed: boolean,
    emailNotification: boolean,
    smsNotification: boolean,
    webhookNotification: boolean,
    selectIndividualMonitors: boolean,
    enableIpWhitelist: { type: Boolean, default: false },
    ipWhitelist: { type: Array, default: [] }
    incidentHistoryDays: { type: Number, default: 14 },
    scheduleHistoryDays: { type: Number, default: 14 },
    announcementLogsHistory: { type: Number, default: 14 },
    onlineText: { type: string, default: 'Operational' },
    offlineText: { type: string, default: 'Offline' },
    degradedText: { type: string, default: 'Degraded' },
    twitterHandle: string,
    enableMultipleLanguage: { type: Boolean, default: false },
    multipleLanguages: { type: Array, default: [] },


    deletedByUser: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    theme: { type: string, default: 'Clean Theme' },
}




export const requiredFields: RequiredFields = ['name', 'project'];


