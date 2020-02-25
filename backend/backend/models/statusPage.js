const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const statusSchema = new Schema({
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', alias: 'project' }, //which project this statuspage belongs to.
    domain: String,
    monitorIds: [{ type: String, ref: 'Monitor' }],
    links: Array,
    title: String,
    name: String,
    isPrivate: {
        type: Boolean,
        default: false
    },
    isSubscriberEnabled: {
        type: Boolean,
        default: false
    },
    isGroupedByMonitorCategory: {
        type: Boolean,
        default: false
    },
    showScheduledEvents: {
        type: Boolean,
        default: true
    },
    description: String,
    copyright: String,
    faviconPath: String,
    logoPath: String,
    bannerPath: String,
    colors: Object,
    createdAt: {
        type: Date,
        default: Date.now
    },
    enableRSSFeed: {
        type: Boolean,
        default: true
    },
    emailNotification: {
        type: Boolean,
        default: true
    },
    smsNotification: {
        type: Boolean,
        default: true
    },
    webhookNotification: {
        type: Boolean,
        default: true
    },
    deleted: { type: Boolean, default: false},
    
    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('StatusPage', statusSchema);