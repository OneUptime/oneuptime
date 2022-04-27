import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    issueId: { type: string, ref: 'Issue', index: true },
    createdByUser: User,

    ,

    status: {
        type: string,
        enum: ['ignore', 'unresolve', 'resolve', 'unignore'],
        required: true,
    },

    
    deletedAt: Date,
    deletedByUser: { type: string, ref: 'User' },
}









