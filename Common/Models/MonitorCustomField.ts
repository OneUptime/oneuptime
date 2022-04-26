import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        fieldName: string,
        fieldType: { type: string, enum: ['text', 'number'] },
        project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
        uniqueField: { type: Boolean, default: false },
        
        deletedAt: Date,
    },
    { timestamps: true }
);








