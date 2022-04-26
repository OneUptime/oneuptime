import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema({
    project: { type: String, ref: 'Project', index: true },
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
    deletedByUser: { type: String, ref: 'User', index: true },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('Notification', schema);
