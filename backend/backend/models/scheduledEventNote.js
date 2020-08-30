const mongoose = require('../config/db');

const Schema = mongoose.Schema;
const scheduledEventNoteSchema = new Schema(
    {
        scheduledEventId: {
            type: Schema.Types.ObjectId,
            ref: 'ScheduledEvent',
        },
        content: String,
        type: {
            type: String,
            enum: ['investigation', 'internal'],
            required: true,
        },
        event_state: String,
        createdById: { type: Schema.Types.ObjectId, ref: 'User' },
        updated: { type: Boolean, default: false },
        deleted: { type: Boolean, default: false },
        deletedAt: Date,
        deletedById: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true }
);

module.exports = mongoose.model('ScheduledEventNote', scheduledEventNoteSchema);
