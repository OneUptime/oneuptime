import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema({
    projectId: { type: String, ref: 'Project', index: true },
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
            userId: { type: String, ref: 'User', index: true }, // User that call was forwarded to
            scheduleId: { type: String, ref: 'Schedule', index: true }, // ScheduleId || ''
            phoneNumber: String, // Phone number that call was forwarded to
            status: String, // Completed/in progress/...
        },
    ],
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('CallRoutingLog', schema);
