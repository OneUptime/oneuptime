import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    project: { type: string, ref: 'Project', index: true },
    subscriberId: { type: string, ref: 'Subscriber', index: true },
    incidentId: { type: string, ref: 'Incident', index: true },
    alertVia: {
        type: string,
        enum: ['sms', 'email', 'webhook'],
        required: true,
    },
    alertStatus: string,
    eventType: {
        type: string,
        enum: [
            'identified',
            'acknowledged',
            'resolved',
            'Investigation note created',
            'Investigation note updated',
            'Scheduled maintenance created',
            'Scheduled maintenance note created',
            'Scheduled maintenance resolved',
            'Scheduled maintenance cancelled',
            'Announcement notification created',
        ],
        required: true,
    },
    createdAt: { type: Date, default: Date.now },
    error: { type: Boolean, default: false },
    errorMessage: string



    deletedByUser: { type: string, ref: 'User' },
    totalSubscribers: { type: Number },
    identification: { type: Number },
}









