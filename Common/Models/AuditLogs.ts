import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema({
    user: { type: String, ref: 'User', index: true },
    project: { type: String, ref: 'Project', index: true },
    request: { type: Object },
    response: { type: Object },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('AuditLog', schema);
