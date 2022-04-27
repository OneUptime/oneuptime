import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    createdAt: { type: Date, default: Date.now },
    applicationScannerKey: string,
    applicationScannerName: string,
    slug: string,
    version: string,
    lastAlive: { type: Date, default: Date.now }
    deletedAt: Date,
    applicationScannerImage: string,
    project: Project,
    componentId: {
        type: Schema.Types.ObjectId,
        ref: 'Component',
        alias: 'component',
        index: true,
    },
}








