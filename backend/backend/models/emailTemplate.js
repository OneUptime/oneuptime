/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const emailTemplateSchema = new Schema({
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    subject: { type: String },
    body: { type: String },
    emailType: {
        type: String,
        enum: [
            'Subscriber Incident Created',
            'Subscriber Incident Acknowldeged',
            'Subscriber Incident Resolved',
            'Investigation note is created',
            'Subscriber Scheduled Maintenance Created',
            'Subscriber Scheduled Maintenance Note',
            'Subscriber Scheduled Maintenance Resolved',
            'Subscriber Scheduled Maintenance Cancelled',
        ],
        required: true,
    },
    allowedVariables: [{ type: String, required: true }],
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: Schema.Types.ObjectId, ref: 'User', index: true },
});

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);
