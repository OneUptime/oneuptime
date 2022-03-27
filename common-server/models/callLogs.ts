import mongoose from '../utils/orm';

const Schema = mongoose.Schema;
const callLogsSchema = new Schema({
    from: String,
    to: String,
    projectId: { type: String, ref: 'Project', index: true },
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
    content: String,
    status: String,
    error: String,
});
export default mongoose.model('callLogs', callLogsSchema);
