import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        token: string,
        keyAuthorization: string,
        challengeurl: URL,
        
        deletedAt: Date,
    },
    { timestamps: true }
);









