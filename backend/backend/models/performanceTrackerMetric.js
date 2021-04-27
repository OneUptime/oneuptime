const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const performanceTrackerMetricSchema = new Schema({
    type: String,
    metrics: Object,
    callIdentifier: String,
    method: String,
    performanceTrackerId: {
        type: Schema.Types.ObjectId,
        ref: 'PerformanceTracker',
        index: true,
    },
    throughput: Number,
    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },
    createdAt: Date,
    updatedAt: Date,
});

module.exports = mongoose.model(
    'PerformanceTrackerMetric',
    performanceTrackerMetricSchema
);
