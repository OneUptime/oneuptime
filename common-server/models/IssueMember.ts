import mongoose, { RequiredFields, UniqueFields } from '../utils/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
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
schema.virtual('issue', {
    localField: '_id',
    foreignField: 'issueId',
    ref: 'Issue',
    justOne: true,
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];

export const sligifyField: string = '';

export default mongoose.model('IssueMember', schema);
