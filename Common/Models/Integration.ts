import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
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
        incidentCreated: boolean,
        incidentAcknowledged: boolean,
        incidentResolved: boolean,
        incidentNoteAdded: boolean,
    },

    

    deletedByUser: User,
}

schema.index({ project: 1, teamId: -1 }









