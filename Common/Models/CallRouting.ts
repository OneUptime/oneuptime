import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    project: { type: string, ref: 'Project', index: true },
    



    deletedByUser: User,
    phoneNumber: string,
    locality: string,
    region: string,
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
    sid: string,
    price: string,
    priceUnit: string,
    countryCode: string,
    numberType: string,
    stripeSubscriptionId: string,
}








