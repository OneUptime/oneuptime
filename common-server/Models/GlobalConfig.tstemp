import mongoose, { RequiredFields, UniqueFields } from '../infrastructure/ORM';

const Schema = mongoose.Schema;

const schema = new Schema({
    name: String,
    value: Object,

    createdAt: { type: Date, default: Date.now },
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];

export const sligifyField: string = '';

export default mongoose.model('GlobalConfig', schema);
