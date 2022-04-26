import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema(
    {
        dockerRegistryurl: URL,
        dockerUsername: String,
        dockerPassword: String,
        iv: Schema.Types.Buffer,
        project: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
        deleted: {
            type: Boolean,
            default: false,
        },
        deletedAt: Date,
    },
    { timestamps: true }
);
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = ['dockerPassword'];

export const slugifyField: string = '';

export default mongoose.model('DockerCredential', schema);
