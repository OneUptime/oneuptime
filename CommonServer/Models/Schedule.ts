import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
} from '../Infrastructure/ORM';

const Schema = mongoose.Schema;
const schema = new Schema({
    name: String,
    slug: String,
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
        index: true,
    }, //which project this schedule belongs to.
    createdById: { type: String, ref: 'User', index: true },
    monitorIds: [
        {
            type: Schema.Types.ObjectId,
            ref: 'Monitor',
            default: [],
            alias: 'monitors',
        },
    ],
    escalationIds: [
        {
            type: String,
            ref: 'Escalation',
            default: [],
            alias: 'escalations',
            index: true,
        },
    ],
    createdAt: { type: Date, default: Date.now },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
    isDefault: { type: Boolean, default: false },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('Schedule', schema);
