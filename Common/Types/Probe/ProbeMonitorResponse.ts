import Hostname from "../API/Hostname";
import URL from "../API/URL";
import Dictionary from "../Dictionary";
import IP from "../IP/IP";
import { JSONObject } from "../JSON";
import CustomCodeMonitorResponse from "../Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import SslMonitorResponse from "../Monitor/SSLMonitor/SslMonitorResponse";
import SyntheticMonitorResponse from "../Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import SnmpMonitorResponse from "../Monitor/SnmpMonitor/SnmpMonitorResponse";
import MonitorEvaluationSummary from "../Monitor/MonitorEvaluationSummary";
import ObjectID from "../ObjectID";
import Port from "../Port";
import RequestFailedDetails from "./RequestFailedDetails";

export default interface ProbeMonitorResponse {
  projectId: ObjectID;
  isOnline?: boolean | undefined;
  monitorDestination?: URL | IP | Hostname | undefined;
  monitorDestinationPort?: Port | undefined;
  responseTimeInMs?: number | undefined;
  responseCode?: number | undefined;
  responseHeaders?: Dictionary<string> | undefined;
  responseBody?: string | JSONObject | undefined;
  monitorStepId: ObjectID;
  monitorId: ObjectID;
  probeId: ObjectID;
  failureCause: string;
  requestFailedDetails?: RequestFailedDetails | undefined;
  sslResponse?: SslMonitorResponse | undefined;
  syntheticMonitorResponse?: Array<SyntheticMonitorResponse> | undefined;
  customCodeMonitorResponse?: CustomCodeMonitorResponse | undefined;
  snmpResponse?: SnmpMonitorResponse | undefined;
  monitoredAt: Date;
  isTimeout?: boolean | undefined;
  ingestedAt?: Date | undefined;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
}
