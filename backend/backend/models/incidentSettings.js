const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const IncidentPriority = new Schema({
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
    },
    title: {
        type: Schema.Types.String,
    },
    description: {
        type: Schema.Types.String,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },
    deletedById: { type: String, ref: 'User' },
});

module.exports = mongoose.model('IncidentSettings', IncidentPriority);
