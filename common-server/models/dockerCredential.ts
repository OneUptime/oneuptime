import mongoose, { RequiredFields } from '../utils/ORM';

const Schema = mongoose.Schema;

const schema = new Schema(
    {
        dockerRegistryurl: URL,
        dockerUsername: String,
        dockerPassword: String,
        iv: Schema.Types.Buffer,
        projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
        deleted: {
            type: Boolean,
            default: false,
        },
        deletedAt: Date,
    },
    { timestamps: true }
);
export const requiredFields: RequiredFields = schema.requiredPaths();

export default mongoose.model('DockerCredential', schema);
