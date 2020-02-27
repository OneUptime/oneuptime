const mongoose = require('../config/db');

const Schema = mongoose.Schema;

const integrationSchema = new Schema({
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
    },
    createdById: { type: Schema.Types.ObjectId, ref: 'User', alias: 'user' },
    integrationType: {
        type: String,
        enum: ['slack', 'webhook'],
        required: true,
    },
    data: {},
    monitorId: {
        type: Schema.Types.ObjectId,
        ref: 'Monitor',
        alias: 'monitor',
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    notificationOptions: {
        incidentCreated: { type: Boolean, default: false },
        incidentAcknowledged: { type: Boolean, default: false },
        incidentResolved: { type: Boolean, default: false },
    },
    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },
    deletedById: { type: String, ref: 'User' },
});

integrationSchema.index({ projectId: 1, teamId: -1 });

module.exports = mongoose.model('Integrations', integrationSchema);
