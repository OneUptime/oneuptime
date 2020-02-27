const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const scheduleSchema = new Schema({
    name: String,
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
    }, //which project this schedule belongs to.
    createdById: { type: String, ref: 'User' },
    monitorIds: [
        { type: String, ref: 'Monitor', default: [], alias: 'monitors' },
    ],
    escalationIds: [
        { type: String, ref: 'Escalation', default: [], alias: 'escalations' },
    ],
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('Schedule', scheduleSchema);
