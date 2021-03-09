const mongoose = require('../config/db');

const Schema = mongoose.Schema;

const integrationSchema = new Schema({
    webHookName: { type: String },
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
        index: true,
    },
    createdById: { type: Schema.Types.ObjectId, ref: 'User', alias: 'user' },
    integrationType: {
        type: String,
        enum: ['slack', 'webhook', 'msteams'],
        required: true,
    },
    data: {},
    monitorId: {
        type: Schema.Types.ObjectId,
        ref: 'Monitor',
        alias: 'monitor',
        index: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    notificationOptions: {
        incidentCreated: { type: Boolean, default: false },
        incidentAcknowledged: { type: Boolean, default: false },
        incidentResolved: { type: Boolean, default: false },
        incidentNoteAdded: { type: Boolean, default: false },
    },

    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },
    deletedById: { type: String, ref: 'User', index: true },
});

integrationSchema.index({ projectId: 1, teamId: -1 });

module.exports = mongoose.model('Integrations', integrationSchema);
