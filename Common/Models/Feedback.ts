import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema({
    project: { type: String, ref: 'Project', index: true },
    createdById: { type: String, ref: 'User', index: true },
    airtableId: String,
    message: String,
    page: String,
    deleted: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    deletedAt: {
        type: Date,
    },
    deletedByUser: { type: String, ref: 'User', index: true },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('Feedback', schema);
