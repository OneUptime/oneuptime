import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema: $TSFixMe = mongoose.Schema;
const schema: $TSFixMe = new Schema({
    monitorId: { type: Schema.Types.ObjectId, ref: 'Monitor', index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    statusPageId: {
        type: Schema.Types.ObjectId,
        ref: 'StatusPage',
        index: true,
    },
    alertVia: {
        type: String,
        enum: ['sms', 'email', 'webhook'],
        required: true,
    },
    contactEmail: { type: String },
    contactPhone: { type: String },
    countryCode: { type: String },
    contactWebhook: { type: String },
    webhookMethod: {
        type: String,
        enum: ['get', 'post'],
        required: true,
    },
    notificationType: {
        incident: { type: Boolean, default: true },
        announcement: { type: Boolean, default: true },
        scheduledEvent: { type: Boolean, default: true },
    },
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },
    subscribed: { type: Boolean, default: true },
    deletedById: { type: Schema.Types.ObjectId, ref: 'User', index: true },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('Subscriber', schema);
