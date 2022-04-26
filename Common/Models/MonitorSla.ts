import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema(
    {
        name: String,
        project: { ref: 'Project', type: Schema.Types.ObjectId, index: true },
        isDefault: { type: Boolean, default: false },
        frequency: { type: String, default: '30' }, // Measured in days
        monitorUptime: String,
        deleted: { type: Boolean, default: false },
        deletedAt: Date,
    },
    { timestamps: true } //Automatically adds createdAt and updatedAt to the collection
);
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('MonitorSla', schema);
