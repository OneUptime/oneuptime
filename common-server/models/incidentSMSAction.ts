import mongoose, { RequiredFields } from '../utils/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    incidentId: { type: String, ref: 'Incident', index: true }, //which project this incident belongs to.
    userId: { type: String, ref: 'User', index: true }, // which User will perfom this action.
    number: { type: String },
    name: { type: String },

    resolved: {
        type: Boolean,
        default: false,
    },
    acknowledged: {
        type: Boolean,
        default: false,
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 86400,
    },

    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export default mongoose.model('IncidentSMSAction', schema);
