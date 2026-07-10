import Hostname from "../API/Hostname";
import URL from "../API/URL";
import Dictionary from "../Dictionary";
import IP from "../IP/IP";
import { JSONObject } from "../JSON";
import CustomCodeMonitorResponse from "../Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import SslMonitorResponse from "../Monitor/SSLMonitor/SslMonitorResponse";
import SyntheticMonitorResponse from "../Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import SnmpMonitorResponse from "../Monitor/SnmpMonitor/SnmpMonitorResponse";
import DnsMonitorResponse from "../Monitor/DnsMonitor/DnsMonitorResponse";
import PingMonitorResponse from "../Monitor/PingMonitor/PingMonitorResponse";
import DomainMonitorResponse from "../Monitor/DomainMonitor/DomainMonitorResponse";
import DnssecMonitorResponse from "../Monitor/DnssecMonitor/DnssecMonitorResponse";
import ExternalStatusPageMonitorResponse from "../Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import HttpPhaseTimings from "../Monitor/HttpPhaseTimings";
import MonitorEvaluationSummary from "../Monitor/MonitorEvaluationSummary";
import NetworkPathTrace from "../Monitor/NetworkMonitor/NetworkPathTrace";
import ObjectID from "../ObjectID";
import Port from "../Port";
import ProbeAttempt from "./ProbeAttempt";
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
  pingResponse?: PingMonitorResponse | undefined;
  /*
   * Traceroute + DNS lookup captured by the probe when a Ping/IP/Port check
   * fails — path evidence from the moment of failure.
   */
  networkPathTrace?: NetworkPathTrace | undefined;
  /*
   * DNS / TCP / TLS / TTFB / download phase breakdown for Website and API
   * checks. Absent when the request went through a proxy.
   */
  httpTimings?: HttpPhaseTimings | undefined;
  dnsResponse?: DnsMonitorResponse | undefined;
  domainResponse?: DomainMonitorResponse | undefined;
  dnssecResponse?: DnssecMonitorResponse | undefined;
  externalStatusPageResponse?: ExternalStatusPageMonitorResponse | undefined;
  monitoredAt: Date;
  isTimeout?: boolean | undefined;
  ingestedAt?: Date | undefined;
  evaluationSummary?: MonitorEvaluationSummary | undefined;
  probeAttempts?: Array<ProbeAttempt> | undefined;
  totalAttempts?: number | undefined;
}
