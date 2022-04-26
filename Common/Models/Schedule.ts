import BaseModel from './BaseModel';
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
    isDefault: { type: Boolean, default: false },
}









