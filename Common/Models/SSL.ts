import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    {
        token: string,
        keyAuthorization: string,
        challengeurl: URL,
        
        deletedAt: Date,
    },
    { timestamps: true }
);









