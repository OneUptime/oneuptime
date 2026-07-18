/*
 * A syslog message received by a probe's syslog receiver and forwarded to
 * the server, where it is correlated to a NetworkDevice by source IP and
 * written into the telemetry Logs pipeline. Facility and severity are the
 * RFC 5424 numerical codes decoded from the message's <PRI> prefix
 * (facility 0-23, severity 0-7). The timestamp comes from the message
 * itself when parseable, otherwise it equals receivedAt.
 */
export default interface SyslogMessage {
  sourceIpAddress: string;
  facility: number;
  severity: number;
  timestamp: Date;
  hostname?: string | undefined;
  appName?: string | undefined;
  message: string;
  receivedAt: Date;
}
