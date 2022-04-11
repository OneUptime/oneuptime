import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    from: { type: String, ref: 'Project', index: true },
    to: { type: String, ref: 'User', index: true },
    subject: String,
    body: String,
    createdAt: { type: Date, default: Date.now },
    template: String,
    status: String,
    content: String,
    error: String,
    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
    replyTo: String,
    smtpServer: String, // which can be internal, smtp.gmail.com, etc
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('EmailSent', schema);
