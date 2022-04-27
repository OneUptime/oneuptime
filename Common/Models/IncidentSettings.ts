import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
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
    isDefault: boolean,
    name: string

    deletedByUser: User,
}








