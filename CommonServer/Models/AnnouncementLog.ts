import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema: $TSFixMe = mongoose.Schema;
const schema: $TSFixMe = new Schema(
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

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('AnnouncementLog', schema);
