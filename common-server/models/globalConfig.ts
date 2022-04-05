import mongoose, { RequiredFields } from '../utils/ORM';

const Schema = mongoose.Schema;

const schema = new Schema({
    name: String,
    value: Object,

    createdAt: { type: Date, default: Date.now },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export default mongoose.model('GlobalConfig', schema);
