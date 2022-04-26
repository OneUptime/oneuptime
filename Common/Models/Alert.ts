import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    project: { type: string, ref: 'Project', index: true },
    user: User,
    alertVia: string,
    alertStatus: string,
    eventType: {
        type: string,
        enum: ['identified', 'acknowledged', 'resolved'],
        required: true,
    },
    monitorId: { type: string, ref: 'Monitor', index: true },
    createdAt: { type: Date, default: Date.now, index: true },
    incidentId: { type: string, ref: 'Incident' },
    onCallScheduleStatus: {
        type: Schema.Types.ObjectId,
        ref: 'OnCallScheduleStatus',
        index: true,
    },
    schedule: { type: Schema.Types.ObjectId, ref: 'Schedule', index: true },
    escalation: { type: Schema.Types.ObjectId, ref: 'Escalation', index: true },
    error: { type: Boolean, default: false },
    errorMessage: string,
    alertProgress: string


    deletedByUser: User,
}









