import ObjectID from '../../ObjectID';

export default interface ServerMonitorRequest {
    monitorId: ObjectID;
    secretKey: ObjectID;
}
