import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    project: Project,
    title: {
        type: Schema.Types.String,
    },
    description: {
        type: Schema.Types.String,
    },
    incidentPriority: {
        type: Schema.Types.ObjectId,
        ref: 'IncidentPriority',
        index: true,
    },
    ,
    isDefault: { type: Boolean, default: false },
    name: string

    deletedByUser: User,
}








