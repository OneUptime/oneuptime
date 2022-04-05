import mongoose, { RequiredFields } from '../utils/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    projectId: { type: String, ref: 'Project', index: true },
    userId: { type: String, ref: 'User', index: true },
    alertVia: String,
    alertStatus: String,
    eventType: {
        type: String,
        enum: ['identified', 'acknowledged', 'resolved'],
        required: true,
    },
    monitorId: { type: String, ref: 'Monitor', index: true },
    createdAt: { type: Date, default: Date.now, index: true },
    incidentId: { type: String, ref: 'Incident' },
    onCallScheduleStatus: {
        type: Schema.Types.ObjectId,
        ref: 'OnCallScheduleStatus',
        index: true,
    },
    schedule: { type: Schema.Types.ObjectId, ref: 'Schedule', index: true },
    escalation: { type: Schema.Types.ObjectId, ref: 'Escalation', index: true },
    error: { type: Boolean, default: false },
    errorMessage: String,
    alertProgress: { type: String },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },
    deletedById: { type: String, ref: 'User', index: true },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export default mongoose.model('Alert', schema);
