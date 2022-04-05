import mongoose, { RequiredFields } from '../utils/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    projectId: { type: String, ref: 'Project', index: true },
    createdById: { type: String, ref: 'User', index: true },
    airtableId: String,
    message: String,
    page: String,
    deleted: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    deletedAt: {
        type: Date,
    },
    deletedById: { type: String, ref: 'User', index: true },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export default mongoose.model('Feedback', schema);
