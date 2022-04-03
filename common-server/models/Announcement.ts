import mongoose from '../utils/ORM';

const Schema = mongoose.Schema;
const announcementSchema = new Schema(
    {
        monitors: [
            {
                monitorId: {
                    type: Schema.Types.ObjectId,
                    ref: 'Monitor',
                    index: true,
                },
            },
        ],
        statusPageId: {
            type: Schema.Types.ObjectId,
            ref: 'StatusPage',
            index: true,
        },
        projectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
            index: true,
        },
        slug: String,
        hideAnnouncement: { type: Boolean, default: true },
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
        name: String,
        description: String,
        resolved: { type: Boolean, default: false },
    },
    { timestamps: true }
);
export default mongoose.model('Announcement', announcementSchema);
