import mongoose from '../config/db';

const Schema = mongoose.Schema;
const issueMemberSchema = new Schema({
    issueId: {
        type: Schema.Types.ObjectId,
        ref: 'Issue',
        alias: 'issue',
        index: true,
    }, // which issue does this belongs to.
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        alias: 'user',
        index: true,
    }, // which team member is this.
    createdAt: {
        type: Date,
        default: Date.now,
    },
    createdById: { type: String, ref: 'User', index: true },
    removed: { type: Boolean, default: false }, // this removed is the flag to be used to know if the member has been unassigned from the issue

    removedAt: {
        type: Date,
    },
    removedById: { type: String, ref: 'User', index: true },
});
issueMemberSchema.virtual('issue', {
    localField: '_id',
    foreignField: 'issueId',
    ref: 'Issue',
    justOne: true,
});

export default mongoose.model('IssueMember', issueMemberSchema);
