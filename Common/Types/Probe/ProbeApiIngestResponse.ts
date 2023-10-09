import ObjectID from '../ObjectID';

export default interface IngestorIngestResponse {
    monitorId: ObjectID;
    ingestedMonitorStepId?: ObjectID | undefined;
    nextMonitorStepId?: ObjectID | undefined;
    criteriaMetId?: string | undefined;
    rootCause: string | null;
}
