/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const smsTemplateSchema = new Schema({
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true, },
    body: { type: String },
    smsType: {
        type: String,
        enum: [
            'Subscriber Incident Created',
            'Subscriber Incident Acknowldeged',
            'Subscriber Incident Resolved',
            'Team Member Incident',
            'Investigation note is created',
        ],
        required: true,
    },
    allowedVariables: [{ type: String, required: true }],
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: Schema.Types.ObjectId, ref: 'User', index: true, },
});

module.exports = mongoose.model('SmsTemplate', smsTemplateSchema);
