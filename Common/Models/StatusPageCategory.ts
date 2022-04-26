import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        statusPageId: {
            type: string,
            ref: 'StatusPage',
            index: true,
        },
        name: string,
        createdByUser: {
            type: string,
            ref: 'User',
            index: true,
        },
        deleted: boolean,
        deletedAt: {
            type: Date,
        },
        deletedByUser: {
            type: string,
            ref: 'User',
            index: true,
        },
    },
    { timestamps: true }
);








