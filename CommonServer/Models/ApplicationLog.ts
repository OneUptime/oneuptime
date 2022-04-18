import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema({
    componentId: {
        type: Schema.Types.ObjectId,
        ref: 'Component',
        alias: 'component',
        index: true,
    }, //Which component this application log belongs to.
    name: String,
    slug: { type: String, index: true },
    key: String,
    resourceCategory: {
        type: Schema.Types.ObjectId,
        ref: 'ResourceCategory',
        index: true,
    },
    showQuickStart: {
        type: Boolean,
        default: true,
    },
    createdById: { type: String, ref: 'User', index: true }, //UserId.
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
});

schema.virtual('component', {
    localField: '_id',
    foreignField: 'componentId',
    ref: 'Component',
    justOne: true,
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('ApplicationLog', schema);
