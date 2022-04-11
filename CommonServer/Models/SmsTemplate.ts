import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    body: { type: String },
    smsType: {
        type: String,
        enum: [
            'Subscriber Incident Created',
            'Subscriber Incident Acknowledged',
            'Subscriber Incident Resolved',
            'Team Member Incident',
            'Investigation note is created',
            'Subscriber Scheduled Maintenance Created',
            'Subscriber Scheduled Maintenance Resolved',
            'Subscriber Scheduled Maintenance Note',
            'Subscriber Scheduled Maintenance Cancelled',
            'Subscriber Announcement Notification Created',
        ],
        required: true,
    },
    allowedVariables: [{ type: String, required: true }],
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: Schema.Types.ObjectId, ref: 'User', index: true },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: encryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('SmsTemplate', schema);
