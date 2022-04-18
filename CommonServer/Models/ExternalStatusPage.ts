import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema(
    {
        name: String,
        url: URL,
        description: String,
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
    },
    { timestamps: true }
);

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('ExternalStatusPage', schema);
