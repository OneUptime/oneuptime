import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
   Schema
} from '../Infrastructure/ORM';



const schema: Schema = new Schema({
    name: String,
    value: Object,
    iv: Schema.Types.Buffer,
    createdAt: { type: Date, default: Date.now },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = ['value'];

export const slugifyField: string = '';

export default mongoose.model('GlobalConfig', schema);
