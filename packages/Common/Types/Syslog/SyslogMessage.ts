/*
 * A syslog message received by a probe's syslog receiver and forwarded to
 * the server, where it is matched to a NetworkDevice and written into the
 * telemetry Logs pipeline. Facility and severity are the RFC 5424
 * numerical codes decoded from the message's <PRI> prefix (facility 0-23,
 * severity 0-7); a message that came without a priority carries what a
 * relay assumes for it, 1 (user) and 5 (notice). The timestamp comes from
 * the message itself when parseable, otherwise it equals receivedAt.
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
  /*
   * The line as it arrived, priority and header included, cut to
   * MAX_SYSLOG_RAW_LENGTH. The server reads the header again from it with
   * the one reader every syslog path shares, and vendor parsers read what
   * the fields above leave out (structured data, a tag that is part of the
   * vendor's format). Absent on messages from probes older than this field:
   * the server then reads the fields above.
   */
  raw?: string | undefined;
}

/*
 * The most of a line a probe forwards as `raw`. A UDP datagram cannot
 * carry more, and a TCP sender that writes more is cut here.
 */
export const MAX_SYSLOG_RAW_LENGTH: number = 65536;
