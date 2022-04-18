import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
   Schema
} from '../Infrastructure/ORM';


const schema: Schema = new Schema(
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

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('AutomationSriptLog', schema);
