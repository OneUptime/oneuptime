/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var emailTemplateSchema = new Schema({
    projectId: { type: String, ref: 'Project' },
    subject: { type: String},
    body: { type: String },
    emailType: {
        type: String,
        enum: ['Subscriber Incident'],
        required: true
    },
    allowedVariables: [{ type: String, required: true }],
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
});

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);