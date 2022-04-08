import mongoose, { RequiredFields, UniqueFields } from '../infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    componentId: {
        type: Schema.Types.ObjectId,
        ref: 'Component',
        alias: 'component',
        index: true,
    }, //which component this error tracker belongs to.
    name: { type: String, index: true },
    slug: { type: String, index: true },
    key: String,
    showQuickStart: {
        type: Boolean,
        default: true,
    },
    resourceCategory: {
        type: Schema.Types.ObjectId,
        ref: 'ResourceCategory',
        index: true,
    },
    createdById: { type: String, ref: 'User', index: true }, //userId.
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

export const sligifyField: string = '';

export default mongoose.model('ErrorTracker', schema);
