import mongoose from '../utils/orm';

const Schema = mongoose.Schema;
const resourceCategorySchema = new Schema({
    projectId: {
        type: String,
        ref: 'Project',
        alias: 'project',
        index: true,
    },
    name: String,
    createdById: {
        type: String,
        ref: 'User',
        index: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: {
        type: Boolean,
        default: false,
    },
    deletedAt: {
        type: Date,
    },
    deletedById: {
        type: String,
        ref: 'User',
        index: true,
    },
});

export default mongoose.model('ResourceCategory', resourceCategorySchema);
