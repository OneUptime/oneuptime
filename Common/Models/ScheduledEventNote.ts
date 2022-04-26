import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema(
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
        deletedByUser: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    },
    { timestamps: true }
);
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('ScheduledEventNote', schema);
