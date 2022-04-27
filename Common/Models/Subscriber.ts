import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    monitorId: { type: Schema.Types.ObjectId, ref: 'Monitor', index: true },
    project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    statusPageId: {
        type: Schema.Types.ObjectId,
        ref: 'StatusPage',
        index: true,
    },
    alertVia: {
        type: string,
        enum: ['sms', 'email', 'webhook'],
        required: true,
    },
    contactEmail: string,
    contactPhone: string,
    countryCode: string,
    contactWebhook: string,
    webhookMethod: {
        type: string,
        enum: ['get', 'post'],
        required: true,
    },
    notificationType: {
        incident: boolean,
        announcement: boolean,
        scheduledEvent: boolean,
    },
    createdAt: { type: Date, default: Date.now }

    subscribed: boolean,
    deletedByUser: { type: Schema.Types.ObjectId, ref: 'User', index: true },
}









