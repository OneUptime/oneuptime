import mongoose from '../utils/ORM';

const Schema = mongoose.Schema;
const incidentMessageSchema = new Schema({
    incidentId: {
        type: Schema.Types.ObjectId,
        ref: 'Incident',
        alias: 'incident',
        index: true,
    },
    content: String,
    type: {
        type: String,
        enum: ['investigation', 'internal'],
        required: true,
    },
    incident_state: String,
    createdById: { type: String, ref: 'User', index: true }, //userId.
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updated: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
    postOnStatusPage: { type: Boolean, default: false },
});

incidentMessageSchema.virtual('incident', {
    localField: '_id',
    foreignField: 'incidentId',
    ref: 'Incident',
    justOne: true,
});

export default mongoose.model('IncidentMessage', incidentMessageSchema);
