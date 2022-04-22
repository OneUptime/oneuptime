import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema({
    createdAt: { type: Date, default: Date.now },
    key: { type: String },
    name: { type: String },
    slug: { type: String },
    version: { type: String },
    lastAlive: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    icon: { type: String },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('Probe', schema);
