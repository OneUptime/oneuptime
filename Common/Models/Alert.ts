import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

export default interface Model extends BaseModel{
    project: Project,
    user: User,
    alertVia: string,
    alertStatus: string,
    eventType: {
        type: string,
        enum: ['identified', 'acknowledged', 'resolved'],
        required: true,
    },
    monitorId: Monitor,
    incidentId: Incident,
    onCallScheduleStatus: OnCallSchedule,
    schedule: Schedule,
    escalation: Escalation,
    error: boolean,
    errorMessage: string,
    alertProgress: string
    deletedByUser: User,
}









