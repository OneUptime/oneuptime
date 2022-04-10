import mongoose, { RequiredFields, UniqueFields } from '../infrastructure/ORM';
import { RoleArray } from 'common/types/Role';

const Schema = mongoose.Schema;
const schema = new Schema({
    domain: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'Sso',
    },
    project: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        required: true,
    },
    role: {
        type: String,
        required: true,
        enum: RoleArray.filter(item => item !== 'Owner'), // All roles except Owner
    },
    createdAt: {
        type: Date,
        default: Date.now,
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
    },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];

export const sligifyField: string = '';

export default mongoose.model('SsoDefaultRole', schema);
