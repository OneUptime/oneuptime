import BasicInfrastructureMetrics from '../../Infrastrucutre/BasicMetrics';
import ObjectID from '../../ObjectID';

export interface ServerMonitorResponse {
    monitorId: ObjectID;
    secretKey: ObjectID;
    basicInfrastructureMetrics: BasicInfrastructureMetrics;
}
