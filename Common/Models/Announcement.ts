import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        monitors: [
            {
                monitorId: {
                    type: Schema.Types.ObjectId,
                    ref: 'Monitor',
                    index: true,
                },
            },
        ],
        statusPageId: {
            type: Schema.Types.ObjectId,
            ref: 'StatusPage',
            index: true,
        },
        project: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            index: true,
        },
        slug: string,
        hideAnnouncement: boolean,
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
        name: string,
        description: string,
        resolved: { type: Boolean, default: false },
    },
    { timestamps: true }
);









