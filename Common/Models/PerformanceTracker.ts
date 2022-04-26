import BaseModel from './BaseModel';
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








