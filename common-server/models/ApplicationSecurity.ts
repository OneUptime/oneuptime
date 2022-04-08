import mongoose, { RequiredFields, UniqueFields } from '../utils/ORM';

const Schema = mongoose.Schema;

const schema = new Schema(
    {
        name: String,
        slug: { type: String, index: true },
        gitRepositoryurl: URL,
        gitCredential: {
            type: Schema.Types.ObjectId,
            ref: 'GitCredential',
            index: true,
        },
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
        deletedAt: Date,
        lastScan: Date,
        scanned: { type: Boolean, default: false },
        scanning: { type: Boolean, default: false },
    },
    { timestamps: true } //automatically adds createdAt and updatedAt to the schema
);
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];

export const sligifyField: string = '';

export default mongoose.model('ApplicationSecurity', schema);
