import BasicInfrastructureMetrics from './BasicMetrics';

export default interface ServerMonitorResponse {
    secretKey: string;
    basicInfrastructureMetrics?: BasicInfrastructureMetrics | undefined;
    requestReceivedAt: Date;
    onlyCheckRequestReceivedAt: boolean;
}
