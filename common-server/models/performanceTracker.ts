import mongoose from '../utils/ORM';

const Schema = mongoose.Schema;
const performanceTrackerSchema = new Schema(
    {
        componentId: {
            type: Schema.Types.ObjectId,
            ref: 'Component',
            index: true,
        },
        name: String,
        slug: { type: String, index: true },
        key: String,
        showQuickStart: {
            type: Boolean,
            default: true,
        },
        createdById: { type: String, ref: 'User', index: true },
        deleted: { type: Boolean, default: false },
        deletedAt: {
            type: Date,
        },
        deletedById: { type: String, ref: 'User', index: true },
    },
    { timestamps: true }
);

export default mongoose.model('PerformanceTracker', performanceTrackerSchema);
