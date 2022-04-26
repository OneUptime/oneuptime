import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    incidentId: { type: string, ref: 'Incident', index: true },
    createdByUser: User, // user
    probeId: { type: string, ref: 'Probe', index: true }, // ProbeId

    createdByZapier: boolean, // Is true when zapier creates incident

    createdByApi: boolean,

    ,

    status: string,
    incident_state: string,

    
    deletedAt: Date,
    deletedByUser: { type: string, ref: 'User' },
}









