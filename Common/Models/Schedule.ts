import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema({
    name: String,
    slug: String,
    project: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
        index: true,
    }, //Which project this schedule belongs to.
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

    deletedByUser: { type: String, ref: 'User', index: true },
    isDefault: { type: Boolean, default: false },
});

export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('Schedule', schema);
