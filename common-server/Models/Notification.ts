import mongoose, { RequiredFields, UniqueFields } from '../Infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    projectId: { type: String, ref: 'Project', index: true },
    createdAt: { type: Date, default: Date.now },
    createdBy: { type: String, ref: 'User', index: true },
    message: String,
    read: [{ type: String, ref: 'User', index: true }],
    closed: [{ type: String, ref: 'User', index: true }],
    icon: String,
    deleted: { type: Boolean, default: false },
    meta: {
        type: Object,
    },
    deletedAt: {
        type: Date,
    },
    deletedById: { type: String, ref: 'User', index: true },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];

export const sligifyField: string = '';

export default mongoose.model('Notification', schema);
