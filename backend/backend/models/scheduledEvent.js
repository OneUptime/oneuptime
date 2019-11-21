var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var scheduledEventsSchema = new Schema({
    projectId: {
        type: String,
        ref: 'Project',
        alias: 'project'
    },
    monitorId: {
        type: String,
        ref: 'Monitor',
        alias: 'monitor'
    },
    name: String,
    createdById: {
        type: String,
        ref: 'User'
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date
    },
    deletedById: {
        type: String,
        ref: 'User'
    },
    startDate: {
        type: Date
    },
    endDate: {
        type: Date
    },
    description: {
        type: String
    },
    showEventOnStatusPage: {
        type: Boolean,
        default: false
    },
    callScheduleOnEvent: {
        type: Boolean,
        default: false
    },
    monitorDuringEvent: {
        type: Boolean,
        default: false
    },
    alertSubscriber: {
        type: Boolean,
        default: false
    }
});

module.exports = mongoose.model('ScheduledEvent', scheduledEventsSchema);