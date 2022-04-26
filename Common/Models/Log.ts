import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema({
    applicationLogId: {
        type: Schema.Types.ObjectId,
        ref: 'ApplicationLog',
        alias: 'applicationLog',
        index: true,
    }, //Which application log this content log belongs to.
    content: Object,
    stringifiedContent: String,
    type: {
        type: String,
        enum: ['info', 'warning', 'error'],
        required: true,
    },
    tags: [
        {
            type: String,
        },
    ],
    createdById: { type: String, ref: 'User', index: true }, //user.
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedByUser: { type: String, ref: 'User', index: true },
});

schema.virtual('applicationLog', {
    localField: '_id',
    foreignField: 'applicationLogId',
    ref: 'ApplicationLog',
    justOne: true,
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('Log', schema);
