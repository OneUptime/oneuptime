import mongoose from '../utils/orm';

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
    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },
    createdAt: Date,
    updatedAt: Date,
});

export default mongoose.model(
    'PerformanceTrackerMetric',
    performanceTrackerMetricSchema
);
