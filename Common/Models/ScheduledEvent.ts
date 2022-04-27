import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    {
        project: {
            type: string,
            ref: 'Project',
            alias: 'project',
            index: true,
        },
        monitors: [
            {
                monitorId: {
                    type: Schema.Types.ObjectId,
                    ref: 'Monitor',
                    index: true,
                },
            },
        ],
        name: string,
        cancelled: boolean,
        cancelledAt: Date,

        cancelledById: {
            type: string,
            ref: 'User',
            index: true,
        },
        slug: string,
        createdByUser: {
            type: string,
            ref: 'User',
            index: true,
        },

        deleted: boolean,
        deletedAt: {
            type: Date,
        },
        deletedByUser: {
            type: string,
            ref: 'User',
            index: true,
        },
        startDate: {
            type: Date,
        },
        endDate: {
            type: Date,
        },
        description: {
            type: string,
        },
        showEventOnStatusPage: boolean,
        callScheduleOnEvent: boolean,
        monitorDuringEvent: boolean,
        recurring: boolean,
        interval: {
            type: string,
            default: null,
        },
        alertSubscriber: boolean,
        resolved: boolean,
        resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
        resolvedAt: Date,
    },
    { timestamps: true }
);








