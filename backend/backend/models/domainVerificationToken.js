import mongoose from 'mongoose'

const Schema = mongoose.Schema;
const domainVerificationTokenSchema = new Schema({
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

export default mongoose.model(
    'DomainVerificationToken',
    domainVerificationTokenSchema
);
