import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
   Schema
} from '../Infrastructure/ORM';


class Schema extends mongoose.Schema{}

const schema: Schema = new Schema({
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
