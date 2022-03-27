import mongoose from '../utils/orm';

const Schema = mongoose.Schema;
const emailTemplateSchema = new Schema({
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    subject: { type: String },
    body: { type: String },
    emailType: {
        type: String,
        enum: [
            'Subscriber Incident Created',
            'Subscriber Incident Acknowledged',
            'Subscriber Incident Resolved',
            'Investigation note is created',
            'Subscriber Scheduled Maintenance Created',
            'Subscriber Scheduled Maintenance Note',
            'Subscriber Scheduled Maintenance Resolved',
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

export default mongoose.model('EmailTemplate', emailTemplateSchema);
