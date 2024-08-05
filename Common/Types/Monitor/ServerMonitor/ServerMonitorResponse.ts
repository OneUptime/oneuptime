import BasicInfrastructureMetrics from "../../Infrastructure/BasicMetrics";
import ObjectID from "../../ObjectID";

export interface ServerProcess {
  pid: number;
  name: string;
  command: string;
}

export default interface ServerMonitor {
  monitorId: ObjectID;
  hostname: string; // Hostname of the server
  basicInfrastructureMetrics?: BasicInfrastructureMetrics | undefined;
  requestReceivedAt: Date;
  onlyCheckRequestReceivedAt: boolean;
  processes?: ServerProcess[] | undefined;
  failureCause?: string | undefined;
}
