import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        name: string,
        project: { ref: 'Project', type: Schema.Types.ObjectId, index: true },
        isDefault: { type: Boolean, default: false },
        duration: { type: string, default: '60' },
        alertTime: string,
        
        deletedAt: Date,
    },
    { timestamps: true } //Automatically adds createdAt and updatedAt to the collection
);









