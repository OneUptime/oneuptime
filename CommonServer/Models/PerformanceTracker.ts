import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema: $TSFixMe = mongoose.Schema;
const schema: $TSFixMe = new Schema(
    {
        componentId: {
            type: Schema.Types.ObjectId,
            ref: 'Component',
            index: true,
        },
        name: String,
        slug: { type: String, index: true },
        key: String,
        showQuickStart: {
            type: Boolean,
            default: true,
        },
        createdById: { type: String, ref: 'User', index: true },
        deleted: { type: Boolean, default: false },
        deletedAt: {
            type: Date,
        },
        deletedById: { type: String, ref: 'User', index: true },
    },
    { timestamps: true }
);
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('PerformanceTracker', schema);
