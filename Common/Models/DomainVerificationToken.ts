import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    domain: string, // The main or base domain eg oneuptime.com
    createdAt: { type: Date, default: Date.now },
    verificationToken: string,
    verified: boolean,
    verifiedAt: Date,
    deleted: boolean,
    deletedAt: Date,
    updatedAt: Date,
    project: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        index: true,
    },
}









