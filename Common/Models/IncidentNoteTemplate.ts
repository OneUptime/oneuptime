import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        project: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            alias: 'project',
            index: true,
        },
        incidentState: {
            type: Schema.Types.String,
        },
        incidentNote: {
            type: Schema.Types.String,
        },
        name: string,
        
        deletedAt: {
            type: Date,
        },
    },
    { timestamps: true }
);









