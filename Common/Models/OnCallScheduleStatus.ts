import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    createdAt: { type: Date, default: Date.now },

    project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    schedule: { type: Schema.Types.ObjectId, ref: 'Schedule', index: true },
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
    incidentAcknowledged: { type: Boolean, default: false }, //Incident attached to this schedule is acknowledged.
    
    deletedAt: Date,
    deletedByUser: User,
    isOnDuty: { type: Boolean, default: false },

    alertedEveryone: { type: Boolean, default: false }, //This happens when everyone in the scheudle has been alerted and they still ignore the incident.
}








