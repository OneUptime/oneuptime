/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const emailTemplateSchema = new Schema({
    projectId: { type: String, ref: 'Project' },
    subject: { type: String },
    body: { type: String },
    emailType: {
        type: String,
        enum: [
            'Subscriber Incident Created',
            'Subscriber Incident Acknowldeged',
            'Subscriber Incident Resolved',
        ],
        required: true,
    },
    allowedVariables: [{ type: String, required: true }],
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User' },
});

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);
