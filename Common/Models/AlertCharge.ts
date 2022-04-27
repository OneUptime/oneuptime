import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    project: Project,
    chargeAmount: { type: Number, default: 0 },
    closingAccountBalance: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    alertId: { type: string, ref: 'Alert', index: true },
    subscriberAlertId: { type: string, ref: 'SubscriberAlert', index: true },
    monitorId: { type: Schema.Types.ObjectId, ref: 'Monitor', index: true },
    incidentId: { type: Schema.Types.ObjectId, ref: 'Incident', index: true },
    sentTo: string,
}








