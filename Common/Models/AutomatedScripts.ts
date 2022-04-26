import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        name: string,
        script: string,
        scriptType: string,
        slug: string,
        project: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            index: true,
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
        successEvent: [
            {
                automatedScript: {
                    type: Schema.Types.ObjectId,
                    ref: 'AutomationSript',
                    index: true,
                },
                callSchedule: {
                    type: Schema.Types.ObjectId,
                    ref: 'Schedule',
                    index: true,
                },
            },
        ],
        failureEvent: [
            {
                automatedScript: {
                    type: Schema.Types.ObjectId,
                    ref: 'AutomationSript',
                    index: true,
                },
                callSchedule: {
                    type: Schema.Types.ObjectId,
                    ref: 'Schedule',
                    index: true,
                },
            },
        ],
    },
    { timestamps: true }
);









