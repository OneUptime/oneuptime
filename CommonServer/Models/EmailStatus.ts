import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    fromEmail: { type: String },
    fromName: { type: String },

    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
        index: true,
    },

    toEmail: String,
    subject: String,
    body: String,
    templateType: String,
    status: String,
    errorDescription: String,
    smtpHost: String,

    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('EmailSent', schema);
