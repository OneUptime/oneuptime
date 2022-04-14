import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema: $TSFixMe = mongoose.Schema;
const schema: $TSFixMe = new Schema(
    {
        deleted: { type: Boolean, default: false },
        deletedAt: Date,
        status: String,
        lastOperation: { type: String, enum: ['create', 'update', 'delete'] },
    },
    { timestamps: true }
);

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('ApiStatus', schema);
