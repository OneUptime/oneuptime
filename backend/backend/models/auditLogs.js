import mongoose from '../config/db'

const Schema = mongoose.Schema;
const auditLogsSchema = new Schema({
    userId: { type: String, ref: 'User', index: true },
    projectId: { type: String, ref: 'Project', index: true },
    request: { type: Object },
    response: { type: Object },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

export default mongoose.model('AuditLog', auditLogsSchema);
