import BasicInfrastructureMetrics from "../../Infrastructure/BasicMetrics";
import ObjectID from "../../ObjectID";

export interface ServerProcess {
  pid: number;
  name: string;
  command: string;
}

export default interface ServerMonitorResponse {
  monitorId: ObjectID;
  basicInfrastructureMetrics?: BasicInfrastructureMetrics | undefined;
  requestReceivedAt: Date;
  onlyCheckRequestReceivedAt: boolean;
  processes?: ServerProcess[] | undefined;
}
