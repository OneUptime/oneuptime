import mongoose, { RequiredFields } from '../utils/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    userId: { type: String, ref: 'User', index: true },
    projectId: { type: String, ref: 'Project', index: true },
    request: { type: Object },
    response: { type: Object },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export default mongoose.model('AuditLog', schema);
