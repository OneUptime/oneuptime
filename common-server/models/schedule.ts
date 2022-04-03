import mongoose from '../utils/ORM';

const Schema = mongoose.Schema;
const scheduleSchema = new Schema({
    name: String,
    slug: String,
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
        index: true,
    }, //which project this schedule belongs to.
    createdById: { type: String, ref: 'User', index: true },
    monitorIds: [
        {
            type: Schema.Types.ObjectId,
            ref: 'Monitor',
            default: [],
            alias: 'monitors',
        },
    ],
    escalationIds: [
        {
            type: String,
            ref: 'Escalation',
            default: [],
            alias: 'escalations',
            index: true,
        },
    ],
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
    isDefault: { type: Boolean, default: false },
});
export default mongoose.model('Schedule', scheduleSchema);
