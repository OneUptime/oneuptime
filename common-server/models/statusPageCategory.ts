import mongoose, { RequiredFields } from '../utils/ORM';

const Schema = mongoose.Schema;
const schema = new Schema(
    {
        statusPageId: {
            type: String,
            ref: 'StatusPage',
            index: true,
        },
        name: String,
        createdById: {
            type: String,
            ref: 'User',
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
            type: String,
            ref: 'User',
            index: true,
        },
    },
    { timestamps: true }
);
export const requiredFields: RequiredFields = schema.requiredPaths();

export default mongoose.model('StatusPageCategory', schema);
