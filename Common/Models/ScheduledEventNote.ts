import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    {
        scheduledEventId: {
            type: Schema.Types.ObjectId,
            ref: 'ScheduledEvent',
            index: true,
        },
        content: string,
        type: {
            type: string,
            enum: ['investigation', 'internal'],
            required: true,
        },
        event_state: string,
        createdByUser: { type: Schema.Types.ObjectId, ref: 'User', index: true },
        updated: boolean,
        
        deletedAt: Date,
        deletedByUser: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    },
    { timestamps: true }
);








