import mongoose, {
    RequiredFields,
    UniqueFields,
    EncryptedFields,
    Schema,
} from '../Infrastructure/ORM';

const schema: Schema = new Schema({
    projectId: { type: String, ref: 'Project', index: true },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    deleted: { type: Boolean, default: false },

    deletedAt: {
        type: Date,
    },

    deletedById: { type: String, ref: 'User', index: true },
    phoneNumber: String,
    locality: String,
    region: String,
    capabilities: {
        MMS: { type: Boolean, default: false },
        SMS: { type: Boolean, default: false },
        voice: { type: Boolean, default: false },
    },
    routingSchema: {
        type: Object,
    } /*RoutingSchema: {
        type: ‘team-member’ || ‘schedule’
        id: 'scheduleId' || 'teamMemberId'
        introtext: 'string',
        introAudio: 'tone mongo storage name',
        introAudioName: 'original audio name',

   } */,
    sid: String,
    price: String,
    priceUnit: String,
    countryCode: String,
    numberType: String,
    stripeSubscriptionId: String,
});
export const requiredFields: RequiredFields = schema.requiredPaths();

export const uniqueFields: UniqueFields = [];
export const encryptedFields: EncryptedFields = [];

export const slugifyField: string = '';

export default mongoose.model('CallRouting', schema);
