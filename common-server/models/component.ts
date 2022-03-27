import mongoose from '../utils/orm';

const Schema = mongoose.Schema;
const componentSchema = new Schema({
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
        index: true,
    },

    name: String,
    slug: { type: String, index: true },

    createdById: { type: String, ref: 'User', index: true },
    createdAt: {
        type: Date,
        default: Date.now,
    },

    deleted: { type: Boolean, default: false },

    deletedById: { type: String, ref: 'User', index: true },
    deletedAt: {
        type: Date,
    },
});

componentSchema.virtual('project', {
    localField: '_id',
    foreignField: 'projectId',
    ref: 'Project',
    justOne: true,
});

export default mongoose.model('Component', componentSchema);
