import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    {
        subject: string,
        altnames: Array,
        renewAt: { type: Number, default: 1 },
        expiresAt: { type: Number },
        issuedAt: { type: Number },
        
        deletedAt: { type: Number },
    },
    { timestamps: true }
);









