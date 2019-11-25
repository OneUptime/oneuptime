var mongoose = require('../config/db');

var Schema = mongoose.Schema;
var scheduleSchema = new Schema({
    name: String,
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', alias: 'project' }, //which project this schedule belongs to.
    createdById: { type: String, ref: 'User' },
    userIds: [{ type: String, ref: 'User', default: [], alias: 'users' }],
    monitorIds: [{ type: String, ref: 'Monitor', default: [], alias: 'monitors' }],
    escalationIds: [{ type: String, ref: 'Escalation', default: [], alias: 'escalations'}],
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false},
    
    deletedAt: {
        type: Date 
    },

    deletedById: { type: String, ref: 'User' },
});
module.exports = mongoose.model('Schedule', scheduleSchema);