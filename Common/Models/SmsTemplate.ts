import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    body: string,
    smsType: {
        type: string,
        enum: [
            'Subscriber Incident Created',
            'Subscriber Incident Acknowledged',
            'Subscriber Incident Resolved',
            'Team Member Incident',
            'Investigation note is created',
            'Subscriber Scheduled Maintenance Created',
            'Subscriber Scheduled Maintenance Resolved',
            'Subscriber Scheduled Maintenance Note',
            'Subscriber Scheduled Maintenance Cancelled',
            'Subscriber Announcement Notification Created',
        ],
        required: true,
    },
    allowedVariables: [{ type: string, required: true }]



    deletedByUser: { type: Schema.Types.ObjectId, ref: 'User', index: true },
}








