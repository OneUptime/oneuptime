const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const IncidentPriority = new Schema({
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
        index: true,
    },
    name: {
        type: Schema.Types.String,
        require: true,
    },
    color: {
        type: Object,
        require: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },
    deletedById: { type: String, ref: 'User', index: true },
});

module.exports = mongoose.model('IncidentPriority', IncidentPriority);
