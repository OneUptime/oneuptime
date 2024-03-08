import BasicInfrastructureMetrics from '../../Infrastrucutre/BasicMetrics';
import ObjectID from '../../ObjectID';

export default interface ServerMonitorResponse {
    monitorId: ObjectID;
    basicInfrastructureMetrics: BasicInfrastructureMetrics;
    metricsCollectedAt: Date;
}
