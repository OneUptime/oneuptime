import Hostname from "../API/Hostname";
import URL from "../API/URL";
import Dictionary from "../Dictionary";
import IP from "../IP/IP";
import { JSONObject } from "../JSON";
import CustomCodeMonitor from "../Monitor/CustomCodeMonitor/CustomCodeMonitor";
import SslMonitor from "../Monitor/SSLMonitor/SslMonitor";
import SyntheticMonitor from "../Monitor/SyntheticMonitors/SyntheticMonitor";
import ObjectID from "../ObjectID";
import Port from "../Port";

export default interface ProbeMonitor {
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
  sslResponse?: SslMonitor | undefined;
  syntheticMonitor?: Array<SyntheticMonitor> | undefined;
  customCodeMonitor?: CustomCodeMonitor | undefined;
  monitoredAt: Date;
}
