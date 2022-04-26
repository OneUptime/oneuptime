import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        name: string,
        slug: string,
        gitRepositoryurl: URL,
        gitCredential: {
            type: Schema.Types.ObjectId,
            ref: 'GitCredential',
            index: true,
        },
        componentId: {
            type: Schema.Types.ObjectId,
            ref: 'Component',
            index: true,
        },
        resourceCategory: {
            type: Schema.Types.ObjectId,
            ref: 'ResourceCategory',
            index: true,
        },
        deleted: boolean,
        deletedAt: Date,
        lastScan: Date,
        scanned: { type: Boolean, default: false },
        scanning: { type: Boolean, default: false },
    },
    { timestamps: true } //Automatically adds createdAt and updatedAt to the schema
);








