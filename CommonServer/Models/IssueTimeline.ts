import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    issueId: { type: String, ref: 'Issue', index: true },
    createdById: { type: String, ref: 'User', index: true },

    createdAt: {
        type: Date,
        default: Date.now,
    },

    status: {
        type: String,
        enum: ['ignore', 'unresolve', 'resolve', 'unignore'],
        required: true,
    },

    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedById: { type: String, ref: 'User' },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: encryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('IssueTimeline', schema);
