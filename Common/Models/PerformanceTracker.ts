import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    {
        componentId: {
            type: Schema.Types.ObjectId,
            ref: 'Component',
            index: true,
        },
        name: string,
        slug: string,
        key: string,
        showQuickStart: boolean,
        createdByUser: User,
        
        deletedAt: {
            type: Date,
        },
        deletedByUser: User,
    },
    { timestamps: true }
);








