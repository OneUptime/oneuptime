import mongoose, { RequiredFields } from '../utils/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    projectId: { type: String, ref: 'Project', index: true },
    subscriberId: { type: String, ref: 'Subscriber', index: true },
    incidentId: { type: String, ref: 'Incident', index: true },
    alertVia: {
        type: String,
        enum: ['sms', 'email', 'webhook'],
        required: true,
    },
    alertStatus: String,
    eventType: {
        type: String,
        enum: [
            'identified',
            'acknowledged',
            'resolved',
            'Investigation note created',
            'Investigation note updated',
            'Scheduled maintenance created',
            'Scheduled maintenance note created',
            'Scheduled maintenance resolved',
            'Scheduled maintenance cancelled',
            'Announcement notification created',
        ],
        required: true,
    },
    createdAt: { type: Date, default: Date.now },
    error: { type: Boolean, default: false },
    errorMessage: String,
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User' },
    totalSubscribers: { type: Number },
    identification: { type: Number },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export default mongoose.model('SubscriberAlert', schema);
