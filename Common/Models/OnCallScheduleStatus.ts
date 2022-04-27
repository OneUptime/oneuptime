import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    createdAt: { type: Date, default: Date.now },

    project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    schedule: Schedule,
    activeEscalation: {
        type: Schema.Types.ObjectId,
        ref: 'Escalation',
        index: true,
    },

    escalations: [
        {
            escalation: {
                type: Schema.Types.ObjectId,
                ref: 'Escalation',
                index: true,
            },
            callRemindersSent: { type: Number, default: 0 },
            smsRemindersSent: { type: Number, default: 0 },
            emailRemindersSent: { type: Number, default: 0 },
            pushRemindersSent: { type: Number, default: 0 },
        },
    ],

    incident: { type: Schema.Types.ObjectId, ref: 'Incident', index: true },
    incidentAcknowledged: boolean, //Incident attached to this schedule is acknowledged.
    
    deletedAt: Date,
    deletedByUser: User,
    isOnDuty: boolean,

    alertedEveryone: boolean, //This happens when everyone in the scheudle has been alerted and they still ignore the incident.
}








