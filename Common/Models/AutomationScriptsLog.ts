import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    {
        automationScriptId: {
            type: Schema.Types.ObjectId,
            ref: 'AutomationSript',
            index: true,
        },
        triggerByUser: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        triggerByScript: {
            type: Schema.Types.ObjectId,
            ref: 'AutomationSript',
        },
        triggerByIncident: {
            type: Schema.Types.ObjectId,
            ref: 'Incident',
        },
        status: {
            type: string,
            enum: ['success', 'running', 'failed'],
            default: 'running',
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
        executionTime: Number,
        consoleLogs: [String],
        error: string,
    },
    { timestamps: true }
);









