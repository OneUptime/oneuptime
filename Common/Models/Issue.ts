import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
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
    resolved: boolean,

    resolvedAt: {
        type: Date,
    },

    resolvedById: User,
    ignored: boolean,

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








