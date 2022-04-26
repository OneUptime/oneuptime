import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    type: string,
    metrics: Object,
    callIdentifier: string,
    method: string,
    performanceTrackerId: {
        type: Schema.Types.ObjectId,
        ref: 'PerformanceTracker',
        index: true,
    }

    createdAt: Date,
    updatedAt: Date,
}









