import mongoose, { RequiredFields, UniqueFields } from '../utils/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    domain: String, // the main or base domain eg oneuptime.com
    createdAt: { type: Date, default: Date.now },
    verificationToken: String,
    verified: {
        type: Boolean,
        default: false,
    },
    verifiedAt: Date,
    deleted: {
        type: Boolean,
        default: false,
    },
    deletedAt: Date,
    updatedAt: Date,
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        index: true,
    },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];

export const sligifyField: string = '';

export default mongoose.model('DomainVerificationToken', schema);
