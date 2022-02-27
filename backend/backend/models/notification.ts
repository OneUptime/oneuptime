import mongoose from '../config/db';

const Schema = mongoose.Schema;
const notificationSchema = new Schema({
    projectId: { type: String, ref: 'Project', index: true },
    createdAt: { type: Date, default: Date.now },
    createdBy: { type: String, ref: 'User', index: true },
    message: String,
    read: [{ type: String, ref: 'User', index: true }],
    closed: [{ type: String, ref: 'User', index: true }],
    icon: String,
    deleted: { type: Boolean, default: false },
    meta: {
        type: Object,
    },
    deletedAt: {
        type: Date,
    },
    deletedById: { type: String, ref: 'User', index: true },
});
export default mongoose.model('Notification', notificationSchema);
