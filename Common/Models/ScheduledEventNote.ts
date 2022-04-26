import BaseModel from './BaseModel';
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
        updated: { type: Boolean, default: false },
        
        deletedAt: Date,
        deletedByUser: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    },
    { timestamps: true }
);








