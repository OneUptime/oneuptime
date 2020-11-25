const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const issueMemberSchema = new Schema({
    issueId: {
        type: Schema.Types.ObjectId,
        ref: 'Issue',
        alias: 'issue',
    }, // which issue does this belongs to.
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        alias: 'user',
    }, // which team member is this.
    createdAt: {
        type: Date,
        default: Date.now,
    },
    createdById: { type: String, ref: 'User' },
    removed: { type: Boolean, default: false }, // this removed is the flag to be used to know if the member has been unassigned from the issue

    removedAt: {
        type: Date,
    },
    removedById: { type: String, ref: 'User' },
});
issueMemberSchema.virtual('issue', {
    localField: '_id',
    foreignField: 'issueId',
    ref: 'Issue',
    justOne: true,
});

module.exports = mongoose.model('IssueMember', issueMemberSchema);
