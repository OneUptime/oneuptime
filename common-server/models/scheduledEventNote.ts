import mongoose from '../utils/ORM';

const Schema = mongoose.Schema;
const scheduledEventNoteSchema = new Schema(
    {
        scheduledEventId: {
            type: Schema.Types.ObjectId,
            ref: 'ScheduledEvent',
            index: true,
        },
        content: String,
        type: {
            type: String,
            enum: ['investigation', 'internal'],
            required: true,
        },
        event_state: String,
        createdById: { type: Schema.Types.ObjectId, ref: 'User', index: true },
        updated: { type: Boolean, default: false },
        deleted: { type: Boolean, default: false },
        deletedAt: Date,
        deletedById: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    },
    { timestamps: true }
);

export default mongoose.model('ScheduledEventNote', scheduledEventNoteSchema);
