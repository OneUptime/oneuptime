const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const lighthouseLogSchema = new Schema({
    monitorId: { type: String, ref: 'Monitor' }, // which monitor does this belong to.
    probeId: { type: String, ref: 'Probe' }, // which probe does this belong to.
    data: Object,
    performance: Number,
    accessibility: Number,
    bestPractices: Number,
    seo: Number,
    pwa: Number,
    createdAt: {
        type: Date,
        default: Date.now,
    },
});
module.exports = mongoose.model('LighthouseLog', lighthouseLogSchema);
