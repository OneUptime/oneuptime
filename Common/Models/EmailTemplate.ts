import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    subject: string,
    body: string,
    emailType: {
        type: string,
        enum: [
            'Subscriber Incident Created',
            'Subscriber Incident Acknowledged',
            'Subscriber Incident Resolved',
            'Investigation note is created',
            'Subscriber Scheduled Maintenance Created',
            'Subscriber Scheduled Maintenance Note',
            'Subscriber Scheduled Maintenance Resolved',
            'Subscriber Scheduled Maintenance Cancelled',
            'Subscriber Announcement Notification Created',
        ],
        required: true,
    },
    allowedVariables: [{ type: string, required: true }]



    deletedByUser: { type: Schema.Types.ObjectId, ref: 'User', index: true },
}








