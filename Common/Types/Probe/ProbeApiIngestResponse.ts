import ObjectID from '../ObjectID';

export default interface ProbeApiIngestResponse {
    monitorId: ObjectID;
    ingestedMonitorStepId?: ObjectID | undefined;
    nextMonitorStepId?: ObjectID | undefined;
    criteriaMetId?: string | undefined;
}
