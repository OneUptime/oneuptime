import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    userId: { type: String, ref: 'User', index: true },
    projectId: { type: String, ref: 'Project', index: true },
    request: { type: Object },
    response: { type: Object },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: encryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('AuditLog', schema);
