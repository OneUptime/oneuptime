import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    errorTrackerId: {
        type: Schema.Types.ObjectId,
        ref: 'ErrorTracker',
        alias: 'errorTracker',
        index: true,
    }, //Which error tracker this error event belongs to.
    issueId: {
        type: Schema.Types.ObjectId,
        ref: 'Issue',
        alias: 'issue',
        index: true,
    }, //Which issue this error event belongs to.
    content: Object,
    type: {
        type: string,
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
            type: string,
        },
    ],
    fingerprintHash: string,
    device: Object,
    ,
}

schema.virtual('errorTracker', {
    localField: '_id',
    foreignField: 'errorTrackerId',
    ref: 'ErrorTracker',
    justOne: true,
}








