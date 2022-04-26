import BaseModel from './BaseModel';
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









