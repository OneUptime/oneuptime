/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var smsTemplateSchema = new Schema({
    projectId: { type: String, ref: 'Project' },
    body: { type: String },
    smsType: {
        type: String,
        enum: ['Subscriber Incident', 'Team Member Incident'],
        required: true
    },
    allowedVariables: [{ type: String, required: true }],
    deleted: { type: Boolean, default: false, select: false },

    deletedAt: {
        type: Date,
        select: false
    },

    deletedById: { type: String, ref: 'User', select: false },
    __v: { type: Number, select: false }
});

module.exports = mongoose.model('SmsTemplate', smsTemplateSchema);