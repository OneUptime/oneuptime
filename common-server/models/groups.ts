import mongoose from '../utils/ORM';

const Schema = mongoose.Schema;

const groupSchema = new Schema({
    projectId: {
        type: String,
        ref: 'Project',
        alias: 'project',
        index: true,
    },
    name: String,
    teams: [{ type: String, ref: 'User', default: null }],
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

export default mongoose.model('Groups', groupSchema);
