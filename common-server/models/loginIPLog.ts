import mongoose from '../utils/ORM';
const Schema = mongoose.Schema;

const loginIPlogSchema = new Schema({
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

export default mongoose.model('LoginIPLog', loginIPlogSchema);
