import mongoose from '../config/db'

const Schema = mongoose.Schema;
const callRoutingLogSchema = new Schema({
    callRoutingId: { type: String, ref: 'CallRouting', index: true },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
    callSid: String,
    price: String,
    calledFrom: String,
    calledTo: String,
    duration: String,
    dialTo: [
        {
            callSid: String,
            userId: { type: String, ref: 'User', index: true }, // user that call was forwarded to
            scheduleId: { type: String, ref: 'Schedule', index: true }, // scheduleId || ''
            phoneNumber: String, // phone number that call was forwarded to
            status: String, // completed/in progress/...
        },
    ],
});

export default mongoose.model('CallRoutingLog', callRoutingLogSchema);
