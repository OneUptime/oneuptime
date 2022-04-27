import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    {
        name: string,
        url: URL,
        description: string,
        statusPageId: {
            type: Schema.Types.ObjectId,
            ref: 'StatusPage',
            index: true,
        },
        project: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            index: true,
        },
        deleted: boolean,
        deletedAt: {
            type: Date,
        },
        deletedByUser: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            index: true,
        },
        createdByUser: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            index: true,
        },
    },
    { timestamps: true }
);









