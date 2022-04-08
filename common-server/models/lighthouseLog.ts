import mongoose, { RequiredFields, UniqueFields } from '../infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    monitorId: { type: String, ref: 'Monitor', index: true }, // which monitor does this belong to.
    probeId: { type: String, ref: 'Probe', index: true }, // which probe does this belong to.
    data: Object,
    url: URL,
    performance: Number,
    accessibility: Number,
    bestPractices: Number,
    seo: Number,
    pwa: Number,
    createdAt: {
        type: Date,
        default: Date.now,
    },
    scanning: Boolean,
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];

export const sligifyField: string = '';

export default mongoose.model('LighthouseLog', schema);
