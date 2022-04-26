import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        
        deletedAt: Date,
        status: string,
        lastOperation: { type: string, enum: ['create', 'update', 'delete'] },
    },
    { timestamps: true }
);









