import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    createdAt: { type: Date, default: Date.now },
    key: string,
    name: string,
    slug: string,
    version: string,
    lastAlive: { type: Date, default: Date.now }
    deletedAt: Date,
    icon: string,
}









