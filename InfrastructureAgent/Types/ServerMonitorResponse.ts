import BasicInfrastructureMetrics from './BasicMetrics';

export default interface ServerMonitorResponse {
    monitorId: string;
    basicInfrastructureMetrics?: BasicInfrastructureMetrics | undefined;
    requestReceivedAt: Date;
    onlyCheckRequestReceivedAt: boolean;
}
