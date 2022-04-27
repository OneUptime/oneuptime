import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    {
        name: string,
        slug: string,
        dockerCredential: {
            type: Schema.Types.ObjectId,
            ref: 'DockerCredential',
            index: true,
        },
        imagePath: string,
        imageTags: string,
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
        deleteAt: Date,
        lastScan: Date,
        scanned: boolean,
        scanning: boolean,
    },
    { timestamps: true } //Automatically adds createdAt and updatedAt to the schema
);








