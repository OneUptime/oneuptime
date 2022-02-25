import mongoose from '../config/db'

const Schema = mongoose.Schema;
const lighthouseLogSchema = new Schema({
    monitorId: { type: String, ref: 'Monitor', index: true }, // which monitor does this belong to.
    probeId: { type: String, ref: 'Probe', index: true }, // which probe does this belong to.
    data: Object,
    url: String,
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
export default mongoose.model('LighthouseLog', lighthouseLogSchema);
