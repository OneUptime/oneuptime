import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema({
    user: { type: String, ref: 'User', alias: 'users', index: true },
    sentTo: String,
    createdAt: { type: Date, default: Date.now },
    project: { type: String, ref: 'Project', index: true },
    parentproject: { type: String, ref: 'Project', index: true },
    deleted: { type: Boolean, default: false, index: true },
    deletedAt: {
        type: Date,
    },

    deletedByUser: { type: String, ref: 'User', index: true },
    content: String,
    status: String,
    error: String,
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('SmsCount', schema);
