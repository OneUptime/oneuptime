import mongoose from '../config/db';

const Schema = mongoose.Schema;
const IncidentSettings = new Schema({
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
        index: true,
    },
    title: {
        type: Schema.Types.String,
    },
    description: {
        type: Schema.Types.String,
    },
    incidentPriority: {
        type: Schema.Types.ObjectId,
        ref: 'IncidentPriority',
        index: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    isDefault: { type: Boolean, default: false },
    name: String,
    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },
    deletedById: { type: String, ref: 'User', index: true },
});

export default mongoose.model('IncidentSettings', IncidentSettings);
