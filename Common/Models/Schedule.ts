import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    name: string,
    slug: string,
    project: Project, //Which project this schedule belongs to.
    createdByUser: User,
    monitorIds: [
        {
            type: Schema.Types.ObjectId,
            ref: 'Monitor',
            default: [],
            alias: 'monitors',
        },
    ],
    escalationIds: [
        {
            type: string,
            ref: 'Escalation',
            default: [],
            alias: 'escalations',
            index: true,
        },
    ],
    createdAt: { type: Date, default: Date.now }



    deletedByUser: User,
    isDefault: boolean,
}









