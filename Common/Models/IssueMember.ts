import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
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
    removed: boolean, // This removed is the flag to be used to know if the member has been unassigned from the issue

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








