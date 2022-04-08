import mongoose, { RequiredFields, UniqueFields } from '../utils/ORM';

const Schema = mongoose.Schema;

const schema = new Schema({
    webHookName: { type: String },
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
        index: true,
    },
    createdById: { type: Schema.Types.ObjectId, ref: 'User', alias: 'user' },
    integrationType: {
        type: String,
        enum: ['slack', 'webhook', 'msteams'],
        required: true,
    },
    data: {},
    monitors: [
        {
            monitorId: {
                type: Schema.Types.ObjectId,
                ref: 'Monitor',
                index: true,
            },
        },
    ],
    createdAt: {
        type: Date,
        default: Date.now,
    },
    notificationOptions: {
        incidentCreated: { type: Boolean, default: false },
        incidentAcknowledged: { type: Boolean, default: false },
        incidentResolved: { type: Boolean, default: false },
        incidentNoteAdded: { type: Boolean, default: false },
    },

    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },
    deletedById: { type: String, ref: 'User', index: true },
});

schema.index({ projectId: 1, teamId: -1 });

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];

export const sligifyField: string = '';

export default mongoose.model('Integrations', schema);
