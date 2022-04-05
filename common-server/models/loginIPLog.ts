import mongoose, { RequiredFields } from '../utils/ORM';
const Schema = mongoose.Schema;

const schema = new Schema({
    userId: {
        type: String,
        ref: 'User',
    },
    createdAt: {
        type: Date,
        default: Date.now(),
    },
    ipLocation: {
        type: Object,
    },
    device: {
        type: Object,
    },
    status: String,
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export default mongoose.model('LoginIPLog', schema);
