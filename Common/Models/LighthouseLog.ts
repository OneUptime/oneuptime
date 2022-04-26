import BaseModel from './BaseModel';
export default interface Model extends BaseModel{
    monitorId: { type: string, ref: 'Monitor', index: true }, // Which monitor does this belong to.
    probeId: { type: string, ref: 'Probe', index: true }, // Which probe does this belong to.
    data: Object,
    url: URL,
    performance: Number,
    accessibility: Number,
    bestPractices: Number,
    seo: Number,
    pwa: Number,
    ,
    scanning: Boolean,
}









