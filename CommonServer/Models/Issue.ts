import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    name: String,
    description: String,
    errorTrackerId: {
        type: Schema.Types.ObjectId,
        ref: 'ErrorTracker',
        alias: 'errorTracker',
        index: true,
    }, //which error tracker this issue belongs to.
    type: {
        type: String,
        enum: ['exception', 'message', 'error'],
        required: true,
    },
    fingerprint: [
        {
            type: String,
        },
    ],
    fingerprintHash: String,
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
    resolved: { type: Boolean, default: false },

    resolvedAt: {
        type: Date,
    },

    resolvedById: { type: String, ref: 'User', index: true },
    ignored: { type: Boolean, default: false },

    ignoredAt: {
        type: Date,
    },

    ignoredById: { type: String, ref: 'User', index: true },
});
schema.virtual('errorTracker', {
    localField: '_id',
    foreignField: 'errorTrackerId',
    ref: 'ErrorTracker',
    justOne: true,
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: encryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('Issue', schema);
