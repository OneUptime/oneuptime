import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    webHookName: string,
    project: Project,
    createdByUser: { type: Schema.Types.ObjectId, ref: 'User', alias: 'user' },
    integrationType: {
        type: string,
        enum: ['slack', 'webhook', 'msteams'],
        required: true,
    },
    data: {},
    monitors: [
        {
            monitorId: {
                type: Schema.Types.ObjectId,
                ref: 'Monitor',
                index: true,
            },
        },
    ],
    ,
    notificationOptions: {
        incidentCreated: { type: Boolean, default: false },
        incidentAcknowledged: { type: Boolean, default: false },
        incidentResolved: { type: Boolean, default: false },
        incidentNoteAdded: { type: Boolean, default: false },
    },

    

    deletedByUser: User,
}

schema.index({ project: 1, teamId: -1 }









