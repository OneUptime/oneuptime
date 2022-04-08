import mongoose, { RequiredFields, UniqueFields } from '../utils/ORM';

const Schema = mongoose.Schema;

const schema = new Schema(
    {
        name: String,
        slug: { type: String, index: true },
        dockerCredential: {
            type: Schema.Types.ObjectId,
            ref: 'DockerCredential',
            index: true,
        },
        imagePath: String,
        imageTags: String,
        componentId: {
            type: Schema.Types.ObjectId,
            ref: 'Component',
            index: true,
        },
        resourceCategory: {
            type: Schema.Types.ObjectId,
            ref: 'ResourceCategory',
            index: true,
        },
        deleted: {
            type: Boolean,
            default: false,
        },
        deleteAt: Date,
        lastScan: Date,
        scanned: { type: Boolean, default: false },
        scanning: { type: Boolean, default: false },
    },
    { timestamps: true } //automatically adds createdAt and updatedAt to the schema
);
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];

export const sligifyField: string = '';

export default mongoose.model('ContainerSecurity', schema);
