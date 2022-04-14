import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema: $TSFixMe = mongoose.Schema;
const schema: $TSFixMe = new Schema({
    userId: { type: String, ref: 'User', alias: 'users', index: true },
    sentTo: String,
    createdAt: { type: Date, default: Date.now },
    projectId: { type: String, ref: 'Project', index: true },
    parentProjectId: { type: String, ref: 'Project', index: true },
    deleted: { type: Boolean, default: false, index: true },
    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
    content: String,
    status: String,
    error: String,
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('SmsCount', schema);
