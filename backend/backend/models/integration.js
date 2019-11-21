var mongoose = require('../config/db');

var Schema = mongoose.Schema;

var integrationSchema = new Schema({
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', alias: 'project' },
    createdById: { type: Schema.Types.ObjectId, ref: 'User', alias: 'user' },
    integrationType: {
        type: String,
        enum: ['slack', 'webhook'],
        required: true
    },
    data: {},
    monitors: [{ type: Schema.Types.ObjectId, ref: 'Monitor', alias: 'monitor' }],
    createdAt: {
        type: Date,
        default: Date.now,
    },

    deleted: { type: Boolean, default: false},

    deletedAt: {
        type: Date
    },

    deletedById: { type: String, ref: 'User' },
});

integrationSchema.index({ projectId: 1, teamId: -1});

module.exports = mongoose.model('Integrations', integrationSchema);