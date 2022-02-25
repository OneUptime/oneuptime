import mongoose from '../config/db'

const Schema = mongoose.Schema;
const announcementLogSchema = new Schema(
    {
        announcementId: {
            type: Schema.Types.ObjectId,
            ref: 'Announcement',
            index: true,
        },
        statusPageId: {
            type: Schema.Types.ObjectId,
            ref: 'StatusPage',
            index: true,
        },
        startDate: {
            type: Date,
        },
        endDate: {
            type: Date,
        },
        deleted: {
            type: Boolean,
            default: false,
        },
        deletedAt: {
            type: Date,
        },
        deletedById: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            index: true,
        },
        createdById: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            index: true,
        },
        updatedById: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            index: true,
        },
        active: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
);
export default mongoose.model('AnnouncementLog', announcementLogSchema);
