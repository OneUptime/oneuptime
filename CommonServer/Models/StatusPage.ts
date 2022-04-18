import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
   Schema
} from '../Infrastructure/ORM';



export default new Schema({
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
        index: true,
    }, //Which project this statuspage belongs to.
    domains: [
        {
            domain: String, // Complete domain eg status.oneuptime.com
            cert: String, // Filename gridfs
            privateKey: String, // Filename gridfs
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
            description: String,
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
    slug: String,
    title: { type: String, default: 'Status Page' },
    name: String,
    isPrivate: {
        type: Boolean,
        default: false,
    },
    isSubscriberEnabled: {
        type: Boolean,
        default: false,
    },
    isGroupedByMonitorCategory: {
        type: Boolean,
        default: false,
    },
    showScheduledEvents: {
        type: Boolean,
        default: true,
    },
    // Show incident to the top of status page
    moveIncidentToTheTop: {
        type: Boolean,
        default: false,
    },
    // Show or hide the probe bar
    hideProbeBar: {
        type: Boolean,
        default: true,
    },
    // Show or hide uptime (%) on the status page
    hideUptime: {
        type: Boolean,
        default: false,
    },
    multipleNotificationTypes: {
        type: Boolean,
        default: false,
    },
    // Show or hide resolved incident on the status page
    hideResolvedIncident: {
        type: Boolean,
        default: false,
    },
    description: String,
    copyright: String,
    faviconPath: String,
    logoPath: String,
    bannerPath: String,
    colors: Object,
    layout: Object,
    headerHTML: String,
    footerHTML: String,
    customCSS: String,
    customJS: String,
    statusBubbleId: String,
    embeddedCss: String,
    createdAt: {
        type: Date,
        default: Date.now,
    },
    enableRSSFeed: {
        type: Boolean,
        default: true,
    },
    emailNotification: {
        type: Boolean,
        default: true,
    },
    smsNotification: {
        type: Boolean,
        default: true,
    },
    webhookNotification: {
        type: Boolean,
        default: true,
    },
    selectIndividualMonitors: {
        type: Boolean,
        default: false,
    },
    enableIpWhitelist: { type: Boolean, default: false },
    ipWhitelist: { type: Array, default: [] },
    deleted: { type: Boolean, default: false },
    incidentHistoryDays: { type: Number, default: 14 },
    scheduleHistoryDays: { type: Number, default: 14 },
    announcementLogsHistory: { type: Number, default: 14 },
    onlineText: { type: String, default: 'Operational' },
    offlineText: { type: String, default: 'Offline' },
    degradedText: { type: String, default: 'Degraded' },
    twitterHandle: { type: String },
    enableMultipleLanguage: { type: Boolean, default: false },
    multipleLanguages: { type: Array, default: [] },
    deletedAt: {
        type: Date,
    },

    deletedById: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    theme: { type: String, default: 'Clean Theme' },
});

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const requiredFields: RequiredFields = ['name', 'projectId'];
