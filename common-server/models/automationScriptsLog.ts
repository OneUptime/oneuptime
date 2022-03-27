import mongoose from '../utils/orm';

const Schema = mongoose.Schema;
const automationSriptLogSchema = new Schema(
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
            type: String,
            enum: ['success', 'running', 'failed'],
            default: 'running',
        },
        deleted: {
            type: Boolean,
            default: false,
        },
        deletedAt: {
            type: Date,
        },
        deletedById: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            index: true,
        },
        executionTime: Number,
        consoleLogs: [String],
        error: String,
    },
    { timestamps: true }
);
export default mongoose.model('AutomationSriptLog', automationSriptLogSchema);
