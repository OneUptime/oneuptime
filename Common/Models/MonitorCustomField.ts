import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    {
        fieldName: string,
        fieldType: { type: string, enum: ['text', 'number'] },
        project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
        uniqueField: boolean,
        
        deletedAt: Date,
    },
    { timestamps: true }
);








