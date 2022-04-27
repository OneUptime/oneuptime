import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    {
        
        deletedAt: Date,
        status: string,
        lastOperation: { type: string, enum: ['create', 'update', 'delete'] },
    },
    { timestamps: true }
);









