import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    incidentId: { type: String, ref: 'Incident', index: true },
    createdById: { type: String, ref: 'User', index: true }, // userId
    probeId: { type: String, ref: 'Probe', index: true }, // probeId

    createdByZapier: {
        type: Boolean,
        default: false,
    }, // is true when zapier creates incident

    createdByApi: {
        type: Boolean,
        default: false,
    },

    createdAt: {
        type: Date,
        default: Date.now,
    },

    status: { type: String },
    incident_state: String,

    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedById: { type: String, ref: 'User' },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: encryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('IncidentTimeline', schema);
