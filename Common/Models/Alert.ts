import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema({
    project: { type: String, ref: 'Project', index: true },
    user: { type: String, ref: 'User', index: true },
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
    deletedByUser: { type: String, ref: 'User', index: true },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('Alert', schema);
