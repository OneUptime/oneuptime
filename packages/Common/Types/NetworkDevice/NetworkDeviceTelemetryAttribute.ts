/*
 * The attributes ingest writes on every log row it matched to one of the
 * project's network devices - a syslog line the probe received, an SNMP
 * trap (ProbeSyslogIngestService, SyslogIngestService, SnmpTrapLogWriter).
 * Ingest decides them: whatever a line said under these names is dropped
 * before they are set, so a device's own messages carry its real id.
 *
 * The log scan carries both onto every security event it reads from such
 * a line (Utils/SecurityEvent/LogParsers/SecurityLogLine), which is what
 * puts a firewall's denied connections and a VPN's failed sign-ins on that
 * device's Security Events page.
 */

// The device's id: what a device's Logs and Security Events pages read by.
export const NETWORK_DEVICE_ID_ATTRIBUTE: string = "networkDevice.id";

// The device's name in OneUptime, as it was when the line arrived.
export const NETWORK_DEVICE_NAME_ATTRIBUTE: string = "networkDevice.name";
