import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    name: string,
    description: string,
    errorTrackerId: {
        type: Schema.Types.ObjectId,
        ref: 'ErrorTracker',
        alias: 'errorTracker',
        index: true,
    }, //Which error tracker this issue belongs to.
    type: {
        type: string,
        enum: ['exception', 'message', 'error'],
        required: true,
    },
    fingerprint: [
        {
            type: string,
        },
    ],
    fingerprintHash: string,
    



    deletedByUser: User,
    resolved: { type: Boolean, default: false },

    resolvedAt: {
        type: Date,
    },

    resolvedById: User,
    ignored: { type: Boolean, default: false },

    ignoredAt: {
        type: Date,
    },

    ignoredById: User,
}
schema.virtual('errorTracker', {
    localField: '_id',
    foreignField: 'errorTrackerId',
    ref: 'ErrorTracker',
    justOne: true,
}








