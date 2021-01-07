/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const alertSchema = new Schema({
    projectId: { type: String, ref: 'Project' },
    userId: { type: String, ref: 'User' },
    alertVia: String,
    alertStatus: String,
    eventType: {
        type: String,
        enum: [
            'identified',
            'acknowledged',
            'resolved'
        ],
        required: true,
    },
    monitorId: { type: String, ref: 'Monitor' },
    createdAt: { type: Date, default: Date.now },
    incidentId: { type: String, ref: 'Incident' },
    onCallScheduleStatus: {
        type: Schema.Types.ObjectId,
        ref: 'OnCallScheduleStatus',
    },
    schedule: { type: Schema.Types.ObjectId, ref: 'Schedule' },
    escalation: { type: Schema.Types.ObjectId, ref: 'Escalation' },
    error: { type: Boolean, default: false },
    errorMessage: String,
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User' },
});

module.exports = mongoose.model('Alert', alertSchema);
