import BasicInfrastructureMetrics from "../../Infrastructure/BasicMetrics";
import ObjectID from "../../ObjectID";

export interface ServerProcess {
  pid: number;
  name: string;
  command: string;
}

export default interface ServerMonitorResponse {
  projectId: ObjectID;
  monitorId: ObjectID;
  hostname: string; // Hostname of the server
  basicInfrastructureMetrics?: BasicInfrastructureMetrics | undefined;
  requestReceivedAt: Date;
  onlyCheckRequestReceivedAt: boolean;
  processes?: ServerProcess[] | undefined;
  failureCause?: string | undefined;
  timeNow?: Date | undefined; // Time when the response was generated
}
