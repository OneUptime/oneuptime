import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
   Schema
} from '../Infrastructure/ORM';


const schema: Schema = new Schema({
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project',
        alias: 'project',
        index: true,
    },

    name: String,
    slug: { type: String, index: true },

    createdById: { type: String, ref: 'User', index: true },
    createdAt: {
        type: Date,
        default: Date.now,
    },

    deleted: { type: Boolean, default: false },

    deletedById: { type: String, ref: 'User', index: true },
    deletedAt: {
        type: Date,
    },
});

schema.virtual('project', {
    localField: '_id',
    foreignField: 'projectId',
    ref: 'Project',
    justOne: true,
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('Component', schema);
