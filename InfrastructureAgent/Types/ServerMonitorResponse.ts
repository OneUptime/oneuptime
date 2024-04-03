import BasicInfrastructureMetrics from './BasicMetrics';

export interface ServerProcess {
    pid: number;
    name: string;
    command: string;
}

export default interface ServerMonitorResponse {
    secretKey: string;
    basicInfrastructureMetrics?: BasicInfrastructureMetrics | undefined;
    requestReceivedAt: Date;
    onlyCheckRequestReceivedAt: boolean;
    processes?: ServerProcess[] | undefined;
}
