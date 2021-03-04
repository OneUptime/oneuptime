const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const statusSchema = new Schema({
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
        index: true,
    }, //which project this statuspage belongs to.
    domains: [
        {
            domain: String, // complete domain eg status.fyipe.com
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
    title: String,
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
    // show incident to the top of status page
    moveIncidentToTheTop: {
        type: Boolean,
        default: false,
    },
    description: String,
    copyright: String,
    faviconPath: String,
    logoPath: String,
    bannerPath: String,
    colors: Object,
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

    deletedAt: {
        type: Date,
    },

    deletedById: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    theme: { type: String },
});
module.exports = mongoose.model('StatusPage', statusSchema);
