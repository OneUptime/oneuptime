import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema({
    type: String,
    name: String,
    email: String,
    website: String,
    phone: String,
    whitepaperName: String,
    country: String,
    companySize: String,
    message: String,

    createdAt: { type: Date, default: Date.now },

    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },
    source: Object,
    deletedByUser: { type: String, ref: 'User', index: true },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('Lead', schema);
