const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const automationSriptLogSchema = new Schema(
    {
        automationScriptId: {
            type: Schema.Types.ObjectId,
            ref: 'AutomationSript',
            index: true,
        },
        triggerByUser: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        triggerByScript: {
            type: Schema.Types.ObjectId,
            ref: 'AutomationSript',
        },
        status: {
            type: String,
            enum: ['success', 'running', 'failed'],
            default: 'running',
        },
        deleted: {
            type: Boolean,
            default: false,
        },
        deletedAt: {
            type: Date,
        },
        deletedById: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            index: true,
        },
    },
    { timestamps: true }
);
module.exports = mongoose.model('AutomationSriptLog', automationSriptLogSchema);
