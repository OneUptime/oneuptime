import mongoose from '../config/db';

const Schema = mongoose.Schema;
const errorEventSchema = new Schema({
    errorTrackerId: {
        type: Schema.Types.ObjectId,
        ref: 'ErrorTracker',
        alias: 'errorTracker',
        index: true,
    }, //which error tracker this error event belongs to.
    issueId: {
        type: Schema.Types.ObjectId,
        ref: 'Issue',
        alias: 'issue',
        index: true,
    }, //which issue this error event belongs to.
    content: Object,
    type: {
        type: String,
        enum: ['exception', 'message', 'error'],
        required: true,
    },
    timeline: [
        {
            type: Object,
        },
    ],
    tags: [
        {
            type: Object,
        },
    ],
    sdk: Object,
    fingerprint: [
        {
            type: String,
        },
    ],
    fingerprintHash: String,
    device: Object,
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

errorEventSchema.virtual('errorTracker', {
    localField: '_id',
    foreignField: 'errorTrackerId',
    ref: 'ErrorTracker',
    justOne: true,
});

export default mongoose.model('ErrorEvent', errorEventSchema);
