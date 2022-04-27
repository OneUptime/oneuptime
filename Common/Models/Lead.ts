import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    type: string,
    name: string,
    email: string,
    website: string,
    phone: string,
    whitepaperName: string,
    country: string,
    companySize: string,
    message: string,

    createdAt: { type: Date, default: Date.now },

    


    source: Object,
    deletedByUser: User,
}









