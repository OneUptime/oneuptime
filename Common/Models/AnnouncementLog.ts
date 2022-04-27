import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    {
        announcementId: {
            type: Schema.Types.ObjectId,
            ref: 'Announcement',
            index: true,
        },
        statusPageId: {
            type: Schema.Types.ObjectId,
            ref: 'StatusPage',
            index: true,
        },
        startDate: {
            type: Date,
        },
        endDate: {
            type: Date,
        },
        deleted: boolean,
        deletedAt: {
            type: Date,
        },
        deletedByUser: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            index: true,
        },
        createdByUser: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            index: true,
        },
        updatedById: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            index: true,
        },
        active: boolean,
    },
    { timestamps: true }
);









