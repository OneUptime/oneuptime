import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    issueId: {
        type: Schema.Types.ObjectId,
        ref: 'Issue',
        alias: 'issue',
        index: true,
    }, // Which issue does this belongs to.
    user: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        alias: 'user',
        index: true,
    }, // Which team member is this.
    ,
    createdByUser: User,
    removed: { type: Boolean, default: false }, // This removed is the flag to be used to know if the member has been unassigned from the issue

    removedAt: {
        type: Date,
    },
    removedById: User,
}
schema.virtual('issue', {
    localField: '_id',
    foreignField: 'issueId',
    ref: 'Issue',
    justOne: true,
}








