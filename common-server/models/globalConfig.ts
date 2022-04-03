import mongoose from '../utils/ORM';

const Schema = mongoose.Schema;

const globalConfigSchema = new Schema({
    name: String,
    value: Object,

    createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('GlobalConfig', globalConfigSchema);
