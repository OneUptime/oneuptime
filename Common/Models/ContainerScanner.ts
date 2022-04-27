import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    createdAt: { type: Date, default: Date.now },
    containerScannerKey: string,
    containerScannerName: string,
    version: string,
    lastAlive: { type: Date, default: Date.now }
    deletedAt: Date,
}








