import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema({
    project: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
        index: true,
    },
    title: {
        type: Schema.Types.String,
    },
    description: {
        type: Schema.Types.String,
    },
    incidentPriority: {
        type: Schema.Types.ObjectId,
        ref: 'IncidentPriority',
        index: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    isDefault: { type: Boolean, default: false },
    name: String,
    deleted: { type: Boolean, default: false },
    deletedAt: {
        type: Date,
    },
    deletedByUser: { type: String, ref: 'User', index: true },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('IncidentSettings', schema);
