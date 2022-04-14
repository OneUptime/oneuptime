import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    monitorId: { type: String, ref: 'Monitor', index: true }, //which monitor does this belong to.
    probeId: { type: String, ref: 'Probe', index: true }, //which probe does this belong to.
    incidentId: { type: String, ref: 'Incident', index: true },
    status: String,
    manuallyCreated: {
        type: Boolean,
        default: false,
    },
    startTime: {
        type: Date,
        default: Date.now,
    },
    endTime: {
        type: Date,
        default: null,
    },
    lastStatus: String,
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    deletedById: { type: String, ref: 'User', index: true },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('MonitorStatus', schema);
