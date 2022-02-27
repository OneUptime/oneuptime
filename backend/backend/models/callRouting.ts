import mongoose from '../config/db';

const Schema = mongoose.Schema;
const callRoutingSchema = new Schema({
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
    } /*routingSchema: {
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

export default mongoose.model('CallRouting', callRoutingSchema);
