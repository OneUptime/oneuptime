import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    project: Project,
    



    deletedByUser: User,
    phoneNumber: string,
    locality: string,
    region: string,
    capabilities: {
        MMS: boolean,
        SMS: boolean,
        voice: boolean,
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








