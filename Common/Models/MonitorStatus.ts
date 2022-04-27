import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';
export default interface Model extends BaseModel{
    monitorId: Monitor, //Which monitor does this belong to.
    probeId: { type: string, ref: 'Probe', index: true }, //Which probe does this belong to.
    incidentId: { type: string, ref: 'Incident', index: true },
    status: string,
    manuallyCreated: boolean,
    startTime: {
        type: Date,
        default: Date.now,
    },
    endTime: Date,
    lastStatus: string,
    
    deletedAt: Date,
    deletedByUser: User,
}









