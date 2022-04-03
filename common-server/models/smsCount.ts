import mongoose from '../utils/ORM';

const Schema = mongoose.Schema;
const smsCountSchema = new Schema({
    userId: { type: String, ref: 'User', alias: 'users', index: true },
    sentTo: String,
    createdAt: { type: Date, default: Date.now },
    projectId: { type: String, ref: 'Project', index: true },
    parentProjectId: { type: String, ref: 'Project', index: true },
    deleted: { type: Boolean, default: false, index: true },
    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
    content: String,
    status: String,
    error: String,
});
export default mongoose.model('SmsCount', smsCountSchema);
