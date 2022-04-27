import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    {
        name: string,
        project: { ref: 'Project', type: Schema.Types.ObjectId, index: true },
        isDefault: boolean,
        duration: { type: string, default: '60' },
        alertTime: string,
        
        deletedAt: Date,
    },
    { timestamps: true } //Automatically adds createdAt and updatedAt to the collection
);









